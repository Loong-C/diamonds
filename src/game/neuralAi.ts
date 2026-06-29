import { getLegalCommands } from "./engine";
import { encodeActionInput, encodeStateInput } from "./neuralFeatures";
import { NEURAL_AI_MODEL } from "./neuralModel.generated";
import { forwardPolicy, forwardValue, softmax } from "./neuralNetwork";
import type { GameCommand, GameState } from "./types";

export interface NeuralCommandScore {
  command: GameCommand;
  prior: number;
  logit: number;
}

function commandKey(command: GameCommand): string {
  return JSON.stringify(command);
}

export function scoreNeuralCommands(state: GameState): NeuralCommandScore[] {
  const legalCommands = getLegalCommands(state);
  const stateInput = encodeStateInput(state);
  const logits = legalCommands.map((command) =>
    forwardPolicy(NEURAL_AI_MODEL, stateInput, encodeActionInput(state, command)).output,
  );
  const priors = softmax(logits);

  return legalCommands
    .map((command, index) => ({
      command,
      prior: priors[index],
      logit: logits[index],
    }))
    .sort((a, b) => b.prior - a.prior || commandKey(a.command).localeCompare(commandKey(b.command)));
}

export function evaluateNeuralState(state: GameState): number {
  return forwardValue(NEURAL_AI_MODEL, encodeStateInput(state)).output;
}

export function chooseNeuralAiCommand(state: GameState): GameCommand | null {
  return scoreNeuralCommands(state)[0]?.command ?? null;
}
