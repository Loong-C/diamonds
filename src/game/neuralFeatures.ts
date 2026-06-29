import { COUNTER_LIMIT, STORAGE_LIMIT, WINNING_COINS } from "./cards";
import { isCooling } from "./engine";
import type { GameCommand, GameState, GemCard, PlayerId, PlayerState } from "./types";

export const CARD_FEATURE_SIZE = 8;
export const STATE_FEATURE_SIZE = 192;
export const ACTION_FEATURE_SIZE = 30;

const MAX_VALUE = 14;
const MAX_HARDNESS = 10;
const MAX_TURN = 48;
const MAX_DECK_SIZE = 72;
const MINE_SLOTS = 6;

const commandTypes: GameCommand["type"][] = ["mine", "collect", "consign", "sell", "attack", "endTurn"];

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function pushScaled(features: number[], value: number, scale: number): void {
  features.push(clampUnit(value / scale));
}

function sortCards(cards: GemCard[]): GemCard[] {
  return [...cards].sort(
    (a, b) => b.value - a.value || b.hardness - a.hardness || a.instanceId.localeCompare(b.instanceId),
  );
}

function sumValue(cards: GemCard[]): number {
  return cards.reduce((total, card) => total + card.value, 0);
}

function sumHardness(cards: GemCard[]): number {
  return cards.reduce((total, card) => total + card.hardness, 0);
}

function getCardById(state: GameState, cardId: string): GemCard | null {
  for (const card of state.mine) {
    if (card.instanceId === cardId) {
      return card;
    }
  }

  for (const player of state.players) {
    const card = [...player.storage, ...player.counter, ...player.sold].find((item) => item.instanceId === cardId);
    if (card) {
      return card;
    }
  }

  return state.discard.find((card) => card.instanceId === cardId) ?? null;
}

function pushCardFeatures(features: number[], card: GemCard | null, turn: number): void {
  if (!card) {
    for (let index = 0; index < CARD_FEATURE_SIZE; index += 1) {
      features.push(0);
    }
    return;
  }

  pushScaled(features, card.value, MAX_VALUE);
  pushScaled(features, card.hardness, MAX_HARDNESS);
  features.push(card.listedOnTurn === null ? 0 : 1);
  features.push(card.listedOnTurn !== null && card.listedOnTurn !== turn ? 1 : 0);
  features.push(isCooling(card) ? 1 : 0);
  features.push(card.hardness >= 7.5 ? 1 : 0);
  features.push(card.value >= 9 ? 1 : 0);
  pushScaled(features, card.cooldownReleaseTurn === null ? 0 : card.cooldownReleaseTurn - turn, MAX_TURN);
}

function pushCardSlots(features: number[], cards: GemCard[], slots: number, turn: number): void {
  const sorted = sortCards(cards);

  for (let index = 0; index < slots; index += 1) {
    pushCardFeatures(features, sorted[index] ?? null, turn);
  }
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
      if (attackingCard.hardness > target.hardness) {
        best = Math.max(best, target.value + target.hardness * 0.2 - attackingCard.value * 0.1);
      }
    }
  }

  return best;
}

function pushPlayerFeatures(features: number[], player: PlayerState, opponent: PlayerState, turn: number): void {
  pushScaled(features, player.coins, WINNING_COINS);
  pushScaled(features, player.storage.length, STORAGE_LIMIT);
  pushScaled(features, player.counter.length, COUNTER_LIMIT);
  pushScaled(features, player.sold.length, MAX_DECK_SIZE);
  pushScaled(features, sumValue(player.sold), WINNING_COINS);
  pushScaled(features, player.turnsStarted, MAX_TURN);
  pushScaled(features, player.storage.filter(isCooling).length, STORAGE_LIMIT);
  pushScaled(features, sellableValue(player, turn), WINNING_COINS);
  pushScaled(features, bestAttackSwing(player, opponent), MAX_VALUE);
  features.push(player.counter.some((card) => card.listedOnTurn !== turn && player.coins + card.value >= WINNING_COINS) ? 1 : 0);
  pushCardSlots(features, player.storage, STORAGE_LIMIT, turn);
  pushCardSlots(features, player.counter, COUNTER_LIMIT, turn);
}

function pushDeckAggregate(features: number[], deck: GemCard[]): void {
  if (deck.length === 0) {
    features.push(0, 0, 0, 0, 0, 0);
    return;
  }

  const values = deck.map((card) => card.value);
  const hardnesses = deck.map((card) => card.hardness);

  pushScaled(features, sumValue(deck) / deck.length, MAX_VALUE);
  pushScaled(features, sumHardness(deck) / deck.length, MAX_HARDNESS);
  pushScaled(features, Math.max(...values), MAX_VALUE);
  pushScaled(features, Math.max(...hardnesses), MAX_HARDNESS);
  pushScaled(features, deck.filter((card) => card.value >= 9).length, deck.length);
  pushScaled(features, deck.filter((card) => card.hardness >= 7.5).length, deck.length);
}

function opponentHasImmediateSale(state: GameState): boolean {
  const opponent = state.players[otherPlayer(state.currentPlayer)];
  return opponent.counter.some(
    (card) => card.listedOnTurn !== state.turn && opponent.coins + card.value >= WINNING_COINS,
  );
}

function commandBlocksImmediateSale(state: GameState, command: GameCommand): boolean {
  if (command.type !== "attack") {
    return false;
  }

  const opponent = state.players[otherPlayer(state.currentPlayer)];
  const target = opponent.counter.find((card) => card.instanceId === command.targetId);
  return Boolean(target && target.listedOnTurn !== state.turn && opponent.coins + target.value >= WINNING_COINS);
}

function commandCards(state: GameState, command: GameCommand): { primary: GemCard | null; secondary: GemCard | null } {
  if (command.type === "collect" || command.type === "consign" || command.type === "sell") {
    return { primary: getCardById(state, command.cardId), secondary: null };
  }

  if (command.type === "attack") {
    return {
      primary: getCardById(state, command.attackerId),
      secondary: getCardById(state, command.targetId),
    };
  }

  return { primary: null, secondary: null };
}

export function encodeStateInput(state: GameState): number[] {
  const perspective = state.currentPlayer;
  const player = state.players[perspective];
  const opponent = state.players[otherPlayer(perspective)];
  const features: number[] = [];

  pushScaled(features, state.turn, MAX_TURN);
  pushScaled(features, state.actionPoints, 2);
  pushScaled(features, state.actionsTaken, 2);
  pushScaled(features, state.mine.length, MAX_DECK_SIZE);
  pushScaled(features, state.deck.length, MAX_DECK_SIZE);
  features.push(perspective === 1 ? 1 : 0);
  pushPlayerFeatures(features, player, opponent, state.turn);
  pushPlayerFeatures(features, opponent, player, state.turn);
  pushCardSlots(features, state.mine, MINE_SLOTS, state.turn);
  pushDeckAggregate(features, state.deck);

  if (features.length !== STATE_FEATURE_SIZE) {
    throw new Error(`State feature size drifted to ${features.length}; expected ${STATE_FEATURE_SIZE}.`);
  }

  return features;
}

export function encodeActionInput(state: GameState, command: GameCommand): number[] {
  const player = state.players[state.currentPlayer];
  const features: number[] = [];

  for (const type of commandTypes) {
    features.push(command.type === type ? 1 : 0);
  }

  const { primary, secondary } = commandCards(state, command);
  pushCardFeatures(features, primary, state.turn);
  pushCardFeatures(features, secondary, state.turn);

  features.push(command.type === "endTurn" ? 1 : 0);
  features.push(command.type === "attack" ? 1 : 0);
  features.push(command.type === "sell" ? 1 : 0);
  features.push(command.type === "mine" ? 1 : 0);
  features.push(primary && command.type === "sell" && player.coins + primary.value >= WINNING_COINS ? 1 : 0);
  features.push(opponentHasImmediateSale(state) ? 1 : 0);
  features.push(commandBlocksImmediateSale(state, command) ? 1 : 0);
  pushScaled(features, primary && secondary ? primary.hardness - secondary.hardness : 0, MAX_HARDNESS);

  if (features.length !== ACTION_FEATURE_SIZE) {
    throw new Error(`Action feature size drifted to ${features.length}; expected ${ACTION_FEATURE_SIZE}.`);
  }

  return features;
}
