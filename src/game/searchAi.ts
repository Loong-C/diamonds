import { COUNTER_LIMIT, STORAGE_LIMIT, WINNING_COINS } from "./cards";
import { applyCommand, getLegalCommands, isCommandLegal, isCooling } from "./engine";
import { shuffle } from "./random";
import type { GameCommand, GameState, GemCard, PlayerId, PlayerState } from "./types";

interface SearchOptions {
  maxDepth?: number;
  samples?: number;
  timeBudgetMs?: number;
  now?: () => number;
}

interface SearchCandidate {
  command: GameCommand;
  visits: number;
  totalScore: number;
  seedScore: number;
}

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_SAMPLES = 6;
const DEFAULT_TIME_BUDGET_MS = 320;
const WIN_SCORE = 1_000_000;

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
  const playerKeys = state.players
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
    .join("|");

  return [
    state.turn,
    state.currentPlayer,
    state.actionPoints,
    state.actionsTaken,
    playerKeys,
    sortedCardKeys(state.mine),
    sortedCardKeys(state.discard),
    sortedCardKeys(state.deck),
  ].join("|");
}

function createHiddenDeckSample(state: GameState, sampleIndex: number): GameState {
  const publicKey = publicInformationKey(state);
  const deckWithoutOrder = [...state.deck].sort((a, b) => a.instanceId.localeCompare(b.instanceId));

  return {
    ...state,
    deck: shuffle(deckWithoutOrder, hashText(`${publicKey}:${sampleIndex}`)),
  };
}

function sumCards(cards: GemCard[], valueWeight: number, hardnessWeight: number): number {
  return cards.reduce((total, card) => total + card.value * valueWeight + card.hardness * hardnessWeight, 0);
}

function sellableValue(player: PlayerState, turn: number): number {
  return player.counter
    .filter((card) => card.listedOnTurn !== turn)
    .reduce((total, card) => total + card.value, 0);
}

function bestAttackSwing(attacker: PlayerState, defender: PlayerState): number {
  let best = 0;

  for (const attackingCard of attacker.storage) {
    if (isCooling(attackingCard)) {
      continue;
    }

    for (const target of defender.counter) {
      if (attackingCard.hardness <= target.hardness) {
        continue;
      }

      best = Math.max(best, target.value * 8 + target.hardness - attackingCard.value * 0.5);
    }
  }

  return best;
}

function availableStorage(player: PlayerState): number {
  return Math.max(0, STORAGE_LIMIT - player.storage.length);
}

function availableCounter(player: PlayerState): number {
  return Math.max(0, COUNTER_LIMIT - player.counter.length);
}

function playerPositionScore(player: PlayerState, opponent: PlayerState, turn: number): number {
  const coolingPenalty = player.storage.filter(isCooling).length * 8;
  const readyStorage = player.storage.filter((card) => !isCooling(card));
  const storageJamPenalty = availableStorage(player) === 0 ? 35 : 0;
  const counterJamPenalty = availableCounter(player) === 0 ? sumCards(readyStorage, 2.5, 0.8) : 0;
  const salePressure = player.counter.some(
    (card) => card.listedOnTurn !== turn && player.coins + card.value >= WINNING_COINS,
  )
    ? 2_500
    : 0;

  return (
    player.coins * 120 +
    sumCards(player.storage, 6, 2.5) +
    sumCards(player.counter, 10, 1.5) +
    availableStorage(player) * 6 +
    availableCounter(player) * 4 +
    sellableValue(player, turn) * 18 +
    bestAttackSwing(player, opponent) * 1.5 +
    salePressure -
    coolingPenalty -
    storageJamPenalty -
    counterJamPenalty
  );
}

function mineOpportunityScore(state: GameState, perspective: PlayerId): number {
  if (state.actionPoints <= 0 || state.mine.length === 0) {
    return 0;
  }

  const current = state.players[state.currentPlayer];
  const collectCount = Math.min(state.actionPoints, availableStorage(current), state.mine.length);

  if (collectCount <= 0) {
    return 0;
  }

  const opportunity = [...state.mine]
    .sort((a, b) => b.value * 4 + b.hardness - (a.value * 4 + a.hardness))
    .slice(0, collectCount)
    .reduce((total, card) => total + card.value * 16 + card.hardness * 3, 0);

  return state.currentPlayer === perspective ? opportunity : -opportunity;
}

function evaluateState(state: GameState, perspective: PlayerId): number {
  if (state.winner === "draw") {
    return 0;
  }

  if (state.winner === perspective) {
    return WIN_SCORE + state.players[perspective].coins;
  }

  if (state.winner === otherPlayer(perspective)) {
    return -WIN_SCORE - state.players[otherPlayer(perspective)].coins;
  }

  const player = state.players[perspective];
  const opponent = state.players[otherPlayer(perspective)];

  return (
    playerPositionScore(player, opponent, state.turn) -
    playerPositionScore(opponent, player, state.turn) +
    (state.currentPlayer === perspective ? state.actionPoints * 5 : -state.actionPoints * 5) +
    mineOpportunityScore(state, perspective)
  );
}

function scoreCommand(state: GameState, command: GameCommand, perspective: PlayerId): number {
  const before = evaluateState(state, perspective);
  const after = applyCommand(state, command);
  let score = evaluateState(after, perspective) - before;

  if (command.type === "endTurn" && state.actionPoints > 0) {
    score -= state.currentPlayer === perspective ? state.actionPoints * 12 : -state.actionPoints * 12;
  }

  if (command.type === "sell") {
    const card = state.players[state.currentPlayer].counter.find((item) => item.instanceId === command.cardId);
    score += (card?.value ?? 0) * (state.currentPlayer === perspective ? 35 : -35);
  }

  if (command.type === "attack") {
    const target = state.players[otherPlayer(state.currentPlayer)].counter.find(
      (item) => item.instanceId === command.targetId,
    );
    score += (target?.value ?? 0) * (state.currentPlayer === perspective ? 30 : -30);
  }

  return score;
}

function orderCommands(state: GameState, commands: GameCommand[], perspective: PlayerId): GameCommand[] {
  const maximizing = state.currentPlayer === perspective;

  return [...commands].sort((a, b) => {
    const scoreA = scoreCommand(state, a, perspective);
    const scoreB = scoreCommand(state, b, perspective);
    return maximizing ? scoreB - scoreA : scoreA - scoreB;
  });
}

function getImmediateTacticalCommand(state: GameState): GameCommand | null {
  const player = state.players[state.currentPlayer];
  const opponent = state.players[otherPlayer(state.currentPlayer)];
  const legalCommands = getLegalCommands(state);

  const winningSale = player.counter
    .filter((card) => card.listedOnTurn !== state.turn && player.coins + card.value >= WINNING_COINS)
    .sort((a, b) => b.value - a.value)[0];

  if (winningSale) {
    return { type: "sell", cardId: winningSale.instanceId };
  }

  const opponentWinningTargets = opponent.counter
    .filter((card) => card.listedOnTurn !== state.turn && opponent.coins + card.value >= WINNING_COINS)
    .sort((a, b) => b.value - a.value);

  for (const target of opponentWinningTargets) {
    const block = legalCommands
      .filter((command): command is Extract<GameCommand, { type: "attack" }> => command.type === "attack")
      .filter((command) => command.targetId === target.instanceId)
      .sort((a, b) => {
        const attackerA = player.storage.find((card) => card.instanceId === a.attackerId);
        const attackerB = player.storage.find((card) => card.instanceId === b.attackerId);
        return (attackerA?.value ?? 0) - (attackerB?.value ?? 0);
      })[0];

    if (block) {
      return block;
    }
  }

  return null;
}

function minimax(
  state: GameState,
  depth: number,
  perspective: PlayerId,
  deadline: number,
  now: () => number,
  alpha: number,
  beta: number,
): number {
  if (state.winner !== null || depth <= 0 || now() >= deadline) {
    return evaluateState(state, perspective);
  }

  const legalCommands = getLegalCommands(state);
  if (legalCommands.length === 0) {
    return evaluateState(state, perspective);
  }

  const maximizing = state.currentPlayer === perspective;
  const orderedCommands = orderCommands(state, legalCommands, perspective);

  if (maximizing) {
    let value = -Infinity;

    for (const command of orderedCommands) {
      value = Math.max(value, minimax(applyCommand(state, command), depth - 1, perspective, deadline, now, alpha, beta));
      alpha = Math.max(alpha, value);

      if (alpha >= beta || now() >= deadline) {
        break;
      }
    }

    return value;
  }

  let value = Infinity;

  for (const command of orderedCommands) {
    value = Math.min(value, minimax(applyCommand(state, command), depth - 1, perspective, deadline, now, alpha, beta));
    beta = Math.min(beta, value);

    if (alpha >= beta || now() >= deadline) {
      break;
    }
  }

  return value;
}

export function chooseSearchAiCommand(state: GameState, options: SearchOptions = {}): GameCommand {
  const legalCommands = getLegalCommands(state);
  if (legalCommands.length === 0) {
    return { type: "endTurn" };
  }

  const tacticalCommand = getImmediateTacticalCommand(state);
  if (tacticalCommand) {
    return tacticalCommand;
  }

  const perspective = state.currentPlayer;
  const now = options.now ?? defaultNow;
  const deadline = now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const candidates: SearchCandidate[] = orderCommands(state, legalCommands, perspective).map((command) => ({
    command,
    visits: 0,
    totalScore: 0,
    seedScore: scoreCommand(state, command, perspective),
  }));

  const candidateByKey = new Map(candidates.map((candidate) => [commandKey(candidate.command), candidate]));

  search: for (let depth = 1; depth <= maxDepth; depth += 1) {
    for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
      const sampledState = createHiddenDeckSample(state, sampleIndex);

      for (const command of candidates.map((candidate) => candidate.command)) {
        if (now() >= deadline) {
          break search;
        }

        if (!isCommandLegal(sampledState, command)) {
          continue;
        }

        const score = minimax(
          applyCommand(sampledState, command),
          depth - 1,
          perspective,
          deadline,
          now,
          -Infinity,
          Infinity,
        );
        const candidate = candidateByKey.get(commandKey(command));

        if (candidate) {
          candidate.visits += 1;
          candidate.totalScore += score;
        }
      }
    }
  }

  return candidates
    .sort((a, b) => {
      const scoreA = a.visits > 0 ? a.totalScore / a.visits : a.seedScore;
      const scoreB = b.visits > 0 ? b.totalScore / b.visits : b.seedScore;
      return scoreB - scoreA;
    })[0].command;
}
