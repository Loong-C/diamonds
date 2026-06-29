export interface AlphaZeroModel {
  stateSize: number;
  actionSize: number;
  policyHiddenSize: number;
  valueHiddenSize: number;
  policyWeightsInputHidden: number[];
  policyBiasHidden: number[];
  policyWeightsHiddenOutput: number[];
  policyBiasOutput: number;
  valueWeightsInputHidden: number[];
  valueBiasHidden: number[];
  valueWeightsHiddenOutput: number[];
  valueBiasOutput: number;
  metadata: {
    algorithm: "local-alphazero-lite";
    generatedAt: string;
    trainingIterations: number;
    selfPlayGames: number;
    trainingSamples: number;
    mctsSimulations: number;
    epochs: number;
    evaluationWinRate: number;
  };
}

export interface HiddenPass {
  hidden: number[];
  output: number;
}

function assertSize(name: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`${name} expected ${expected} inputs but received ${actual}.`);
  }
}

function dotHidden(weights: number[], bias: number[], input: number[], hiddenSize: number): number[] {
  const hidden: number[] = [];

  for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
    let activation = bias[hiddenIndex];

    for (let inputIndex = 0; inputIndex < input.length; inputIndex += 1) {
      activation += input[inputIndex] * weights[hiddenIndex * input.length + inputIndex];
    }

    hidden.push(Math.tanh(activation));
  }

  return hidden;
}

function outputFromHidden(hidden: number[], weights: number[], bias: number, squash: boolean): number {
  let output = bias;

  for (let index = 0; index < hidden.length; index += 1) {
    output += hidden[index] * weights[index];
  }

  return squash ? Math.tanh(output) : output;
}

export function encodePolicyInput(stateInput: number[], actionInput: number[]): number[] {
  return [...stateInput, ...actionInput];
}

export function forwardPolicy(model: AlphaZeroModel, stateInput: number[], actionInput: number[]): HiddenPass {
  assertSize("Policy state", stateInput.length, model.stateSize);
  assertSize("Policy action", actionInput.length, model.actionSize);

  const input = encodePolicyInput(stateInput, actionInput);
  const hidden = dotHidden(model.policyWeightsInputHidden, model.policyBiasHidden, input, model.policyHiddenSize);

  return {
    hidden,
    output: outputFromHidden(hidden, model.policyWeightsHiddenOutput, model.policyBiasOutput, false),
  };
}

export function forwardValue(model: AlphaZeroModel, stateInput: number[]): HiddenPass {
  assertSize("Value state", stateInput.length, model.stateSize);

  const hidden = dotHidden(model.valueWeightsInputHidden, model.valueBiasHidden, stateInput, model.valueHiddenSize);

  return {
    hidden,
    output: outputFromHidden(hidden, model.valueWeightsHiddenOutput, model.valueBiasOutput, true),
  };
}

export function softmax(logits: number[], temperature = 1): number[] {
  const safeTemperature = Math.max(0.001, temperature);
  const max = Math.max(...logits);
  const exp = logits.map((logit) => Math.exp((logit - max) / safeTemperature));
  const total = exp.reduce((sum, value) => sum + value, 0);

  return exp.map((value) => value / total);
}
