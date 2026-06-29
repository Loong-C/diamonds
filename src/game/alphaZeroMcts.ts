import { applyCommand, getLegalCommands } from "./engine";
import { encodeActionInput, encodeStateInput } from "./neuralFeatures";
import { NEURAL_AI_MODEL } from "./neuralModel.generated";
import { forwardPolicy, forwardValue, softmax, type AlphaZeroModel } from "./neuralNetwork";
import { shuffle } from "./random";
import type { GameCommand, GameState, GemCard, PlayerId } from "./types";

interface TreeNode {
  state: GameState;
  prior: number;
  visits: number;
  valueSum: number;
  command: GameCommand | null;
  children: Map<string, TreeNode>;
}

export interface MctsPolicyEntry {
  command: GameCommand;
  visits: number;
  probability: number;
}

export interface AlphaZeroMctsOptions {
  model?: AlphaZeroModel;
  simulations?: number;
  deckSamples?: number;
  cPuct?: number;
  temperature?: number;
  timeBudgetMs?: number;
  now?: () => number;
}

const DEFAULT_SIMULATIONS = 72;
const DEFAULT_DECK_SAMPLES = 3;
const DEFAULT_C_PUCT = 1.45;
const DEFAULT_TEMPERATURE = 0.35;
const DEFAULT_TIME_BUDGET_MS = 420;

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function defaultNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function commandKey(command: GameCommand): string {
  return JSON.stringify(command);
}

function cardKey(card: GemCard): string {
  return `${card.instanceId}:${card.listedOnTurn ?? "-"}:${card.cooldownReleaseTurn ?? "-"}`;
}

function hashText(text: string): number {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) || 1;
}

function sortedCardKeys(cards: GemCard[]): string {
  return [...cards].map(cardKey).sort().join(",");
}

function publicInformationKey(state: GameState): string {
  return [
    state.turn,
    state.currentPlayer,
    state.actionPoints,
    state.actionsTaken,
    state.players
      .map((player) =>
        [
          player.id,
          player.coins,
          player.turnsStarted,
          sortedCardKeys(player.storage),
          sortedCardKeys(player.counter),
          sortedCardKeys(player.sold),
        ].join("/"),
      )
      .join("|"),
    sortedCardKeys(state.mine),
    sortedCardKeys(state.discard),
    sortedCardKeys(state.deck),
  ].join("|");
}

function createHiddenDeckSample(state: GameState, sampleIndex: number): GameState {
  const deckWithoutOrder = [...state.deck].sort((a, b) => a.instanceId.localeCompare(b.instanceId));

  return {
    ...state,
    deck: shuffle(deckWithoutOrder, hashText(`${publicInformationKey(state)}:${sampleIndex}`)),
  };
}

function createNode(state: GameState, prior: number, command: GameCommand | null): TreeNode {
  return {
    state,
    prior,
    visits: 0,
    valueSum: 0,
    command,
    children: new Map(),
  };
}

function terminalValueForCurrentPlayer(state: GameState): number {
  if (state.winner === null) {
    return 0;
  }

  if (state.winner === "draw") {
    return 0;
  }

  return state.winner === state.currentPlayer ? 1 : -1;
}

function evaluateLeaf(model: AlphaZeroModel, node: TreeNode): number {
  if (node.state.winner !== null) {
    return terminalValueForCurrentPlayer(node.state);
  }

  const legalCommands = getLegalCommands(node.state);
  if (legalCommands.length === 0) {
    return 0;
  }

  const stateInput = encodeStateInput(node.state);
  const logits = legalCommands.map((command) => forwardPolicy(model, stateInput, encodeActionInput(node.state, command)).output);
  const priors = softmax(logits);

  for (let index = 0; index < legalCommands.length; index += 1) {
    const command = legalCommands[index];
    node.children.set(commandKey(command), createNode(applyCommand(node.state, command), priors[index], command));
  }

  return forwardValue(model, stateInput).output;
}

function childScore(parent: TreeNode, child: TreeNode, cPuct: number): number {
  const childQ = child.visits === 0 ? 0 : child.valueSum / child.visits;
  const qForParent = child.state.currentPlayer === parent.state.currentPlayer ? childQ : -childQ;
  const exploration = cPuct * child.prior * Math.sqrt(parent.visits + 1) / (1 + child.visits);

  return qForParent + exploration;
}

function selectChild(node: TreeNode, cPuct: number): TreeNode {
  let bestChild: TreeNode | null = null;
  let bestScore = -Infinity;

  for (const child of node.children.values()) {
    const score = childScore(node, child, cPuct);

    if (score > bestScore) {
      bestScore = score;
      bestChild = child;
    }
  }

  if (!bestChild) {
    throw new Error("MCTS selection reached a node without children.");
  }

  return bestChild;
}

function runSimulation(node: TreeNode, model: AlphaZeroModel, cPuct: number): number {
  if (node.state.winner !== null) {
    const value = terminalValueForCurrentPlayer(node.state);
    node.visits += 1;
    node.valueSum += value;
    return value;
  }

  if (node.children.size === 0) {
    const value = evaluateLeaf(model, node);
    node.visits += 1;
    node.valueSum += value;
    return value;
  }

  const child = selectChild(node, cPuct);
  const childValue = runSimulation(child, model, cPuct);
  const valueForNode = child.state.currentPlayer === node.state.currentPlayer ? childValue : -childValue;

  node.visits += 1;
  node.valueSum += valueForNode;

  return valueForNode;
}

function addPolicyFromRoot(root: TreeNode, totals: Map<string, MctsPolicyEntry>): void {
  for (const child of root.children.values()) {
    if (!child.command) {
      continue;
    }

    const key = commandKey(child.command);
    const existing = totals.get(key);

    if (existing) {
      existing.visits += child.visits;
    } else {
      totals.set(key, {
        command: child.command,
        visits: child.visits,
        probability: 0,
      });
    }
  }
}

function normalizePolicy(entries: MctsPolicyEntry[], temperature: number): MctsPolicyEntry[] {
  const adjusted = entries.map((entry) => ({
    ...entry,
    probability: entry.visits <= 0 ? 0 : entry.visits ** (1 / Math.max(0.001, temperature)),
  }));
  const total = adjusted.reduce((sum, entry) => sum + entry.probability, 0);

  if (total <= 0) {
    const uniform = adjusted.length === 0 ? 0 : 1 / adjusted.length;
    return adjusted.map((entry) => ({ ...entry, probability: uniform }));
  }

  return adjusted.map((entry) => ({ ...entry, probability: entry.probability / total }));
}

export function getAlphaZeroMctsPolicy(state: GameState, options: AlphaZeroMctsOptions = {}): MctsPolicyEntry[] {
  const model = options.model ?? NEURAL_AI_MODEL;
  const legalCommands = getLegalCommands(state);

  if (legalCommands.length === 0) {
    return [];
  }

  const now = options.now ?? defaultNow;
  const deadline = now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const simulations = options.simulations ?? DEFAULT_SIMULATIONS;
  const deckSamples = Math.max(1, options.deckSamples ?? DEFAULT_DECK_SAMPLES);
  const cPuct = options.cPuct ?? DEFAULT_C_PUCT;
  const totals = new Map<string, MctsPolicyEntry>();

  for (let sampleIndex = 0; sampleIndex < deckSamples; sampleIndex += 1) {
    const sampledState = createHiddenDeckSample(state, sampleIndex);
    const root = createNode(sampledState, 1, null);
    evaluateLeaf(model, root);

    const sampleSimulations = Math.max(1, Math.floor(simulations / deckSamples));
    for (let simulation = 0; simulation < sampleSimulations; simulation += 1) {
      if (now() >= deadline) {
        break;
      }

      runSimulation(root, model, cPuct);
    }

    addPolicyFromRoot(root, totals);

    if (now() >= deadline) {
      break;
    }
  }

  const legalKeys = new Set(legalCommands.map(commandKey));
  const entries = [...totals.values()].filter((entry) => legalKeys.has(commandKey(entry.command)));

  if (entries.length === 0) {
    return legalCommands.map((command) => ({
      command,
      visits: 1,
      probability: 1 / legalCommands.length,
    }));
  }

  return normalizePolicy(entries, options.temperature ?? DEFAULT_TEMPERATURE).sort(
    (a, b) => b.probability - a.probability || commandKey(a.command).localeCompare(commandKey(b.command)),
  );
}

export function chooseAlphaZeroMctsCommand(state: GameState, options: AlphaZeroMctsOptions = {}): GameCommand | null {
  return getAlphaZeroMctsPolicy(state, options)[0]?.command ?? null;
}

export function isAlphaZeroModelTrained(model: AlphaZeroModel = NEURAL_AI_MODEL): boolean {
  return (
    model.metadata.selfPlayGames >= 16 &&
    model.metadata.trainingSamples >= 500 &&
    model.policyHiddenSize > 1 &&
    model.valueHiddenSize > 1
  );
}
