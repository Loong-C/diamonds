import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chooseAlphaZeroMctsCommand, getAlphaZeroMctsPolicy } from "../src/game/alphaZeroMcts";
import { applyCommand, createGame, getLegalCommands } from "../src/game/engine";
import { ACTION_FEATURE_SIZE, STATE_FEATURE_SIZE, encodeActionInput, encodeStateInput } from "../src/game/neuralFeatures";
import { NEURAL_AI_MODEL } from "../src/game/neuralModel.generated";
import {
  encodePolicyInput,
  forwardPolicy,
  forwardValue,
  softmax,
  type AlphaZeroModel,
} from "../src/game/neuralNetwork";
import { createRng, shuffle } from "../src/game/random";
import { chooseSearchAiCommand } from "../src/game/searchAi";
import type { GameCommand, GameState, PlayerId, Winner } from "../src/game/types";

interface TrainingExample {
  stateInput: number[];
  actionInputs: number[][];
  policyTarget: number[];
  player: PlayerId;
  valueTarget: number;
}

interface AlphaZeroConfig {
  iterations: number;
  selfPlayGames: number;
  maxMovesPerGame: number;
  mctsSimulations: number;
  deckSamples: number;
  epochs: number;
  policyHiddenSize: number;
  valueHiddenSize: number;
  learningRate: number;
  replayLimit: number;
  evaluationGames: number;
  evaluationSimulations: number;
}

const config: AlphaZeroConfig = {
  iterations: Number(process.env.AZ_ITERATIONS ?? 3),
  selfPlayGames: Number(process.env.AZ_SELF_PLAY_GAMES ?? 16),
  maxMovesPerGame: Number(process.env.AZ_MAX_MOVES ?? 110),
  mctsSimulations: Number(process.env.AZ_MCTS_SIMULATIONS ?? 48),
  deckSamples: Number(process.env.AZ_DECK_SAMPLES ?? 3),
  epochs: Number(process.env.AZ_EPOCHS ?? 5),
  policyHiddenSize: Number(process.env.AZ_POLICY_HIDDEN ?? 64),
  valueHiddenSize: Number(process.env.AZ_VALUE_HIDDEN ?? 64),
  learningRate: Number(process.env.AZ_LR ?? 0.01),
  replayLimit: Number(process.env.AZ_REPLAY_LIMIT ?? 12000),
  evaluationGames: Number(process.env.AZ_EVAL_GAMES ?? 8),
  evaluationSimulations: Number(process.env.AZ_EVAL_SIMULATIONS ?? 72),
};

function commandKey(command: GameCommand): string {
  return JSON.stringify(command);
}

function createModel(seed: number): AlphaZeroModel {
  const rng = createRng(seed);
  const randomWeight = () => (rng() - 0.5) * 0.12;

  return {
    stateSize: STATE_FEATURE_SIZE,
    actionSize: ACTION_FEATURE_SIZE,
    policyHiddenSize: config.policyHiddenSize,
    valueHiddenSize: config.valueHiddenSize,
    policyWeightsInputHidden: Array.from(
      { length: config.policyHiddenSize * (STATE_FEATURE_SIZE + ACTION_FEATURE_SIZE) },
      randomWeight,
    ),
    policyBiasHidden: Array.from({ length: config.policyHiddenSize }, () => 0),
    policyWeightsHiddenOutput: Array.from({ length: config.policyHiddenSize }, randomWeight),
    policyBiasOutput: 0,
    valueWeightsInputHidden: Array.from({ length: config.valueHiddenSize * STATE_FEATURE_SIZE }, randomWeight),
    valueBiasHidden: Array.from({ length: config.valueHiddenSize }, () => 0),
    valueWeightsHiddenOutput: Array.from({ length: config.valueHiddenSize }, randomWeight),
    valueBiasOutput: 0,
    metadata: {
      algorithm: "local-alphazero-lite",
      generatedAt: new Date().toISOString(),
      trainingIterations: 0,
      selfPlayGames: 0,
      trainingSamples: 0,
      mctsSimulations: config.mctsSimulations,
      epochs: 0,
      evaluationWinRate: 0,
    },
  };
}

function cloneOrCreateModel(): AlphaZeroModel {
  if (
    NEURAL_AI_MODEL.stateSize === STATE_FEATURE_SIZE &&
    NEURAL_AI_MODEL.actionSize === ACTION_FEATURE_SIZE &&
    NEURAL_AI_MODEL.policyHiddenSize === config.policyHiddenSize &&
    NEURAL_AI_MODEL.valueHiddenSize === config.valueHiddenSize
  ) {
    return {
      ...NEURAL_AI_MODEL,
      policyWeightsInputHidden: [...NEURAL_AI_MODEL.policyWeightsInputHidden],
      policyBiasHidden: [...NEURAL_AI_MODEL.policyBiasHidden],
      policyWeightsHiddenOutput: [...NEURAL_AI_MODEL.policyWeightsHiddenOutput],
      valueWeightsInputHidden: [...NEURAL_AI_MODEL.valueWeightsInputHidden],
      valueBiasHidden: [...NEURAL_AI_MODEL.valueBiasHidden],
      valueWeightsHiddenOutput: [...NEURAL_AI_MODEL.valueWeightsHiddenOutput],
      metadata: { ...NEURAL_AI_MODEL.metadata },
    };
  }

  return createModel(424242);
}

function sampleCommand(policy: { command: GameCommand; probability: number }[], rng: () => number): GameCommand {
  const roll = rng();
  let cumulative = 0;

  for (const entry of policy) {
    cumulative += entry.probability;
    if (roll <= cumulative) {
      return entry.command;
    }
  }

  return policy[policy.length - 1].command;
}

function alignPolicyTarget(state: GameState, policy: { command: GameCommand; probability: number }[]): TrainingExample {
  const legalCommands = getLegalCommands(state);
  const probabilityByCommand = new Map(policy.map((entry) => [commandKey(entry.command), entry.probability]));
  const policyTarget = legalCommands.map((command) => probabilityByCommand.get(commandKey(command)) ?? 0);
  const total = policyTarget.reduce((sum, value) => sum + value, 0);

  return {
    stateInput: encodeStateInput(state),
    actionInputs: legalCommands.map((command) => encodeActionInput(state, command)),
    policyTarget: total > 0 ? policyTarget.map((value) => value / total) : legalCommands.map(() => 1 / legalCommands.length),
    player: state.currentPlayer,
    valueTarget: 0,
  };
}

function outcomeForPlayer(winner: Winner, player: PlayerId): number {
  if (winner === "draw" || winner === null) {
    return 0;
  }

  return winner === player ? 1 : -1;
}

function playSelfPlayGame(model: AlphaZeroModel, gameIndex: number, rng: () => number): TrainingExample[] {
  let state = createGame({
    mode: "ai",
    seed: 50_000 + gameIndex * 131,
    firstPlayer: gameIndex % 2 === 0 ? 0 : 1,
  });
  const examples: TrainingExample[] = [];

  for (let moveIndex = 0; moveIndex < config.maxMovesPerGame && state.winner === null; moveIndex += 1) {
    const policy = getAlphaZeroMctsPolicy(state, {
      model,
      simulations: config.mctsSimulations,
      deckSamples: config.deckSamples,
      temperature: moveIndex < 14 ? 1 : 0.22,
      timeBudgetMs: 60_000,
      now: () => 0,
    });

    if (policy.length === 0) {
      break;
    }

    examples.push(alignPolicyTarget(state, policy));
    state = applyCommand(state, sampleCommand(policy, rng));
  }

  for (const example of examples) {
    example.valueTarget = outcomeForPlayer(state.winner, example.player);
  }

  return examples;
}

function trainExample(model: AlphaZeroModel, example: TrainingExample, learningRate: number): number {
  const policyPasses = example.actionInputs.map((actionInput) => forwardPolicy(model, example.stateInput, actionInput));
  const probabilities = softmax(policyPasses.map((pass) => pass.output));
  const policyOutputWeights = [...model.policyWeightsHiddenOutput];
  const valuePass = forwardValue(model, example.stateInput);
  const valueOutputWeights = [...model.valueWeightsHiddenOutput];
  let policyLoss = 0;

  for (let actionIndex = 0; actionIndex < example.actionInputs.length; actionIndex += 1) {
    const target = example.policyTarget[actionIndex];
    const probability = probabilities[actionIndex];
    const gradientLogit = probability - target;
    const pass = policyPasses[actionIndex];
    const input = encodePolicyInput(example.stateInput, example.actionInputs[actionIndex]);

    policyLoss -= target * Math.log(Math.max(probability, 1e-8));

    for (let hiddenIndex = 0; hiddenIndex < model.policyHiddenSize; hiddenIndex += 1) {
      model.policyWeightsHiddenOutput[hiddenIndex] -= learningRate * gradientLogit * pass.hidden[hiddenIndex];
    }
    model.policyBiasOutput -= learningRate * gradientLogit;

    for (let hiddenIndex = 0; hiddenIndex < model.policyHiddenSize; hiddenIndex += 1) {
      const hiddenGradient = gradientLogit * policyOutputWeights[hiddenIndex] * (1 - pass.hidden[hiddenIndex] ** 2);
      model.policyBiasHidden[hiddenIndex] -= learningRate * hiddenGradient;

      for (let inputIndex = 0; inputIndex < input.length; inputIndex += 1) {
        const weightIndex = hiddenIndex * input.length + inputIndex;
        model.policyWeightsInputHidden[weightIndex] -= learningRate * hiddenGradient * input[inputIndex];
      }
    }
  }

  const valueError = valuePass.output - example.valueTarget;
  const valueGradient = valueError * (1 - valuePass.output ** 2);

  for (let hiddenIndex = 0; hiddenIndex < model.valueHiddenSize; hiddenIndex += 1) {
    model.valueWeightsHiddenOutput[hiddenIndex] -= learningRate * valueGradient * valuePass.hidden[hiddenIndex];
  }
  model.valueBiasOutput -= learningRate * valueGradient;

  for (let hiddenIndex = 0; hiddenIndex < model.valueHiddenSize; hiddenIndex += 1) {
    const hiddenGradient = valueGradient * valueOutputWeights[hiddenIndex] * (1 - valuePass.hidden[hiddenIndex] ** 2);
    model.valueBiasHidden[hiddenIndex] -= learningRate * hiddenGradient;

    for (let inputIndex = 0; inputIndex < example.stateInput.length; inputIndex += 1) {
      const weightIndex = hiddenIndex * example.stateInput.length + inputIndex;
      model.valueWeightsInputHidden[weightIndex] -= learningRate * hiddenGradient * example.stateInput[inputIndex];
    }
  }

  return policyLoss + valueError ** 2;
}

function evaluateAgainstSearch(model: AlphaZeroModel): number {
  if (config.evaluationGames <= 0) {
    return 0;
  }

  let modelScore = 0;

  for (let gameIndex = 0; gameIndex < config.evaluationGames; gameIndex += 1) {
    const modelPlayer: PlayerId = gameIndex % 2 === 0 ? 0 : 1;
    let state = createGame({
      mode: "ai",
      seed: 90_000 + gameIndex * 257,
      firstPlayer: gameIndex % 2 === 0 ? 0 : 1,
    });

    for (let moveIndex = 0; moveIndex < config.maxMovesPerGame && state.winner === null; moveIndex += 1) {
      const command =
        state.currentPlayer === modelPlayer
          ? chooseAlphaZeroMctsCommand(state, {
              model,
              simulations: config.evaluationSimulations,
              deckSamples: config.deckSamples,
              temperature: 0.05,
              timeBudgetMs: 60_000,
              now: () => 0,
            })
          : chooseSearchAiCommand(state, {
              maxDepth: 4,
              samples: 3,
              timeBudgetMs: 60_000,
              now: () => 0,
            });

      if (!command) {
        break;
      }

      state = applyCommand(state, command);
    }

    if (state.winner === modelPlayer) {
      modelScore += 1;
    } else if (state.winner === "draw" || state.winner === null) {
      modelScore += 0.5;
    }
  }

  return modelScore / config.evaluationGames;
}

function formatNumber(value: number): string {
  if (Math.abs(value) < 0.0000005) {
    return "0";
  }

  return Number(value.toFixed(6)).toString();
}

function formatArray(values: number[]): string {
  const chunks: string[] = [];

  for (let index = 0; index < values.length; index += 12) {
    chunks.push(`    ${values.slice(index, index + 12).map(formatNumber).join(", ")}`);
  }

  return `[\n${chunks.join(",\n")}\n  ]`;
}

function writeModel(model: AlphaZeroModel): void {
  const outputPath = resolve(process.cwd(), "src/game/neuralModel.generated.ts");
  mkdirSync(dirname(outputPath), { recursive: true });

  writeFileSync(
    outputPath,
    `import type { AlphaZeroModel } from "./neuralNetwork";\n\n` +
      `export const NEURAL_AI_MODEL: AlphaZeroModel = {\n` +
      `  stateSize: ${model.stateSize},\n` +
      `  actionSize: ${model.actionSize},\n` +
      `  policyHiddenSize: ${model.policyHiddenSize},\n` +
      `  valueHiddenSize: ${model.valueHiddenSize},\n` +
      `  policyWeightsInputHidden: ${formatArray(model.policyWeightsInputHidden)},\n` +
      `  policyBiasHidden: ${formatArray(model.policyBiasHidden)},\n` +
      `  policyWeightsHiddenOutput: ${formatArray(model.policyWeightsHiddenOutput)},\n` +
      `  policyBiasOutput: ${formatNumber(model.policyBiasOutput)},\n` +
      `  valueWeightsInputHidden: ${formatArray(model.valueWeightsInputHidden)},\n` +
      `  valueBiasHidden: ${formatArray(model.valueBiasHidden)},\n` +
      `  valueWeightsHiddenOutput: ${formatArray(model.valueWeightsHiddenOutput)},\n` +
      `  valueBiasOutput: ${formatNumber(model.valueBiasOutput)},\n` +
      `  metadata: ${JSON.stringify(model.metadata, null, 4).replace(/\n/g, "\n  ")},\n` +
      `};\n`,
  );
}

const rng = createRng(20260629);
const model = cloneOrCreateModel();
let replay: TrainingExample[] = [];

console.log(
  `AlphaZero local training: iterations=${config.iterations}, games/iteration=${config.selfPlayGames}, simulations=${config.mctsSimulations}, deckSamples=${config.deckSamples}`,
);

for (let iteration = 0; iteration < config.iterations; iteration += 1) {
  const newExamples: TrainingExample[] = [];

  for (let gameIndex = 0; gameIndex < config.selfPlayGames; gameIndex += 1) {
    const gameExamples = playSelfPlayGame(model, iteration * config.selfPlayGames + gameIndex, rng);
    newExamples.push(...gameExamples);

    console.log(
      `iteration ${iteration + 1}/${config.iterations} self-play ${gameIndex + 1}/${
        config.selfPlayGames
      } examples=${gameExamples.length}`,
    );
  }

  replay = [...replay, ...newExamples].slice(-config.replayLimit);

  for (let epoch = 0; epoch < config.epochs; epoch += 1) {
    const epochExamples = shuffle(replay, 70_000 + iteration * 100 + epoch);
    const learningRate = config.learningRate * (1 - epoch / (config.epochs * 1.5));
    let loss = 0;

    for (const example of epochExamples) {
      loss += trainExample(model, example, learningRate);
    }

    console.log(
      `iteration ${iteration + 1}/${config.iterations} epoch ${epoch + 1}/${config.epochs} examples=${
        epochExamples.length
      } loss=${(loss / Math.max(1, epochExamples.length)).toFixed(4)}`,
    );
  }

  model.metadata.trainingIterations += 1;
  model.metadata.selfPlayGames += config.selfPlayGames;
  model.metadata.trainingSamples = replay.length;
  model.metadata.mctsSimulations = config.mctsSimulations;
  model.metadata.epochs += config.epochs;
  model.metadata.generatedAt = new Date().toISOString();
  writeModel(model);

  console.log(
    `checkpoint iteration ${iteration + 1}/${config.iterations}: replay=${replay.length}, selfPlayGames=${
      model.metadata.selfPlayGames
    }`,
  );
}

model.metadata.evaluationWinRate = Number(evaluateAgainstSearch(model).toFixed(4));
writeModel(model);

console.log(
  `wrote AlphaZero model: samples=${model.metadata.trainingSamples}, evalWinRate=${(
    model.metadata.evaluationWinRate * 100
  ).toFixed(1)}%`,
);
