import {
  ACTION_POINTS_PER_TURN,
  COUNTER_LIMIT,
  STORAGE_LIMIT,
  WINNING_COINS,
  createDeck,
} from "./cards";
import { normalizeSeed, shuffle } from "./random";
import type { GameCommand, GameState, GemCard, NewGameOptions, PlayerId, PlayerState, Winner } from "./types";

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function createPlayer(id: PlayerId, name: string, coins = 0): PlayerState {
  return {
    id,
    name,
    coins,
    storage: [],
    counter: [],
    sold: [],
    turnsStarted: 0,
  };
}

function appendLog(state: GameState, entry: string): string[] {
  return [entry, ...state.log].slice(0, 12);
}

function cloneCard(card: GemCard): GemCard {
  return { ...card };
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      storage: player.storage.map(cloneCard),
      counter: player.counter.map(cloneCard),
      sold: player.sold.map(cloneCard),
    })) as [PlayerState, PlayerState],
    deck: state.deck.map(cloneCard),
    mine: state.mine.map(cloneCard),
    discard: state.discard.map(cloneCard),
    log: [...state.log],
  };
}

function markTurnStarted(state: GameState, playerId: PlayerId): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[playerId] = {
    ...players[playerId],
    turnsStarted: players[playerId].turnsStarted + 1,
  };

  return { ...state, players };
}

function releaseCooldowns(state: GameState, playerId: PlayerId): GameState {
  const player = state.players[playerId];
  const released = player.storage.filter(
    (card) => card.cooldownReleaseTurn !== null && card.cooldownReleaseTurn <= player.turnsStarted,
  );

  if (released.length === 0) {
    return state;
  }

  const players = [...state.players] as [PlayerState, PlayerState];
  players[playerId] = {
    ...player,
    storage: player.storage.map((card) =>
      card.cooldownReleaseTurn !== null && card.cooldownReleaseTurn <= player.turnsStarted
        ? { ...card, cooldownReleaseTurn: null }
        : card,
    ),
  };

  return {
    ...state,
    players,
    log: appendLog(state, `${player.name} 的 ${released.map((card) => card.name).join("、")} 冷却结束。`),
  };
}

function checkWinner(state: GameState): Winner {
  const winningPlayer = state.players.find((player) => player.coins >= WINNING_COINS);
  if (winningPlayer) {
    return winningPlayer.id;
  }

  const noCardsRemain =
    state.deck.length === 0 &&
    state.mine.length === 0 &&
    state.players.every((player) => player.storage.length === 0 && player.counter.length === 0);

  if (!noCardsRemain) {
    return null;
  }

  if (state.players[0].coins === state.players[1].coins) {
    return "draw";
  }

  return state.players[0].coins > state.players[1].coins ? 0 : 1;
}

function finishAction(state: GameState, logEntry: string): GameState {
  const nextState = {
    ...state,
    actionPoints: state.actionPoints - 1,
    actionsTaken: state.actionsTaken + 1,
    log: appendLog(state, logEntry),
  };

  return { ...nextState, winner: checkWinner(nextState) };
}

export function createGame(options: NewGameOptions): GameState {
  const seed = normalizeSeed(options.seed);
  const deck = shuffle(createDeck(), seed);
  const firstPlayer = options.firstPlayer ?? (seed % 2 === 0 ? 0 : 1);
  const secondPlayer = otherPlayer(firstPlayer);
  const players: [PlayerState, PlayerState] = [
    createPlayer(0, options.mode === "ai" ? "你" : "玩家一"),
    createPlayer(1, options.mode === "ai" ? "AI 鉴定师" : "玩家二"),
  ];

  players[secondPlayer] = {
    ...players[secondPlayer],
    coins: 2,
  };

  const state: GameState = {
    mode: options.mode,
    seed,
    turn: 1,
    currentPlayer: firstPlayer,
    actionPoints: ACTION_POINTS_PER_TURN,
    actionsTaken: 0,
    players,
    deck,
    mine: [],
    discard: [],
    log: [`${players[firstPlayer].name} 先手，${players[secondPlayer].name} 获得 2 金币补偿。`],
    winner: null,
  };

  return markTurnStarted(state, firstPlayer);
}

export function getCurrentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayer];
}

export function isCooling(card: { cooldownReleaseTurn: number | null }): boolean {
  return card.cooldownReleaseTurn !== null;
}

export function canSellOnThisTurn(state: GameState, cardId: string, playerId = state.currentPlayer): boolean {
  const card = state.players[playerId].counter.find((item) => item.instanceId === cardId);
  return Boolean(card && card.listedOnTurn !== state.turn);
}

export function getLegalCommands(state: GameState): GameCommand[] {
  if (state.winner !== null) {
    return [];
  }

  const player = getCurrentPlayer(state);
  const opponent = state.players[otherPlayer(state.currentPlayer)];
  const commands: GameCommand[] = [{ type: "endTurn" }];

  if (state.actionPoints > 0) {
    if (state.deck.length > 0) {
      commands.push({ type: "mine" });
    }

    if (player.storage.length < STORAGE_LIMIT) {
      commands.push(...state.mine.map((card) => ({ type: "collect" as const, cardId: card.instanceId })));
    }

    if (player.counter.length < COUNTER_LIMIT) {
      commands.push(
        ...player.storage
          .filter((card) => !isCooling(card))
          .map((card) => ({ type: "consign" as const, cardId: card.instanceId })),
      );
    }

    commands.push(
      ...player.counter
        .filter((card) => card.listedOnTurn !== state.turn)
        .map((card) => ({ type: "sell" as const, cardId: card.instanceId })),
    );
  }

  if (state.actionsTaken === 0) {
    for (const attacker of player.storage.filter((card) => !isCooling(card))) {
      for (const target of opponent.counter) {
        if (attacker.hardness > target.hardness) {
          commands.push({ type: "attack", attackerId: attacker.instanceId, targetId: target.instanceId });
        }
      }
    }
  }

  return commands;
}

export function applyCommand(sourceState: GameState, command: GameCommand): GameState {
  if (sourceState.winner !== null) {
    return sourceState;
  }

  if (!isCommandLegal(sourceState, command)) {
    return sourceState;
  }

  const state = cloneState(sourceState);
  const player = state.players[state.currentPlayer];
  const opponentId = otherPlayer(state.currentPlayer);
  const opponent = state.players[opponentId];

  if (command.type === "endTurn") {
    return endTurn(state);
  }

  if (command.type === "mine") {
    const drawn = state.deck.splice(-2).reverse();
    state.mine.push(...drawn);
    return finishAction(state, `${player.name} 开采出 ${drawn.map((card) => card.name).join("、")}。`);
  }

  if (command.type === "collect") {
    const mineIndex = state.mine.findIndex((card) => card.instanceId === command.cardId);
    const [card] = state.mine.splice(mineIndex, 1);
    player.storage.push(card);
    return finishAction(state, `${player.name} 收纳了 ${card.name}。`);
  }

  if (command.type === "consign") {
    const storageIndex = player.storage.findIndex((card) => card.instanceId === command.cardId);
    const [card] = player.storage.splice(storageIndex, 1);
    player.counter.push({ ...card, listedOnTurn: state.turn });
    return finishAction(state, `${player.name} 将 ${card.name} 放上柜台寄售。`);
  }

  if (command.type === "sell") {
    const counterIndex = player.counter.findIndex((card) => card.instanceId === command.cardId);
    const [card] = player.counter.splice(counterIndex, 1);
    player.sold.push(card);
    player.coins += card.value;
    return finishAction(state, `${player.name} 卖出 ${card.name}，获得 ${card.value} 金币。`);
  }

  const attacker = player.storage.find((card) => card.instanceId === command.attackerId);
  const targetIndex = opponent.counter.findIndex((card) => card.instanceId === command.targetId);
  const target = opponent.counter[targetIndex];
  opponent.counter.splice(targetIndex, 1);
  state.discard.push(target);

  if (attacker) {
    attacker.cooldownReleaseTurn = player.turnsStarted + 1;
  }

  const attackedState = {
    ...state,
    actionPoints: 0,
    actionsTaken: 1,
    log: appendLog(
      state,
      `${player.name} 用 ${attacker?.name ?? "宝石"} 击碎 ${opponent.name} 柜台上的 ${target.name}。`,
    ),
  };

  return endTurn({ ...attackedState, winner: checkWinner(attackedState) });
}

export function isCommandLegal(state: GameState, command: GameCommand): boolean {
  return getLegalCommands(state).some((legalCommand) => JSON.stringify(legalCommand) === JSON.stringify(command));
}

export function endTurn(state: GameState): GameState {
  const releasedState = releaseCooldowns(state, state.currentPlayer);
  const nextPlayer = otherPlayer(releasedState.currentPlayer);
  const winner = checkWinner(releasedState);

  if (winner !== null) {
    return { ...releasedState, winner };
  }

  const nextState = {
    ...releasedState,
    turn: releasedState.turn + 1,
    currentPlayer: nextPlayer,
    actionPoints: ACTION_POINTS_PER_TURN,
    actionsTaken: 0,
  };

  const startedState = markTurnStarted(nextState, nextPlayer);

  return {
    ...startedState,
    log: appendLog(startedState, `轮到 ${startedState.players[nextPlayer].name}。`),
    winner: checkWinner(startedState),
  };
}
