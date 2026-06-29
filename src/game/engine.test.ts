import { describe, expect, it } from "vitest";
import { chooseAlphaZeroMctsCommand } from "./alphaZeroMcts";
import { chooseAiCommand } from "./ai";
import { createDeck } from "./cards";
import { applyCommand, createGame, getLegalCommands, isCooling } from "./engine";
import { ACTION_FEATURE_SIZE, STATE_FEATURE_SIZE, encodeActionInput, encodeStateInput } from "./neuralFeatures";
import { chooseSearchAiCommand } from "./searchAi";
import type { GameState } from "./types";

function playUntilCurrentPlayer(state: GameState, player: 0 | 1): GameState {
  let next = state;
  while (next.currentPlayer !== player) {
    next = applyCommand(next, { type: "endTurn" });
  }
  return next;
}

describe("宝石寄售规则引擎", () => {
  it("builds the documented 72-card gem deck", () => {
    expect(createDeck()).toHaveLength(72);
  });

  it("mines two cards into the public mine", () => {
    const state = createGame({ mode: "local", seed: 10, firstPlayer: 0 });
    const mined = applyCommand(state, { type: "mine" });

    expect(mined.deck).toHaveLength(70);
    expect(mined.mine).toHaveLength(2);
    expect(mined.actionPoints).toBe(1);
  });

  it("prevents selling a gem consigned during the same turn", () => {
    let state = createGame({ mode: "local", seed: 4, firstPlayer: 0 });
    state = applyCommand(state, { type: "mine" });
    state = applyCommand(state, { type: "collect", cardId: state.mine[0].instanceId });
    state = applyCommand(state, { type: "endTurn" });
    state = playUntilCurrentPlayer(state, 0);
    state = applyCommand(state, { type: "consign", cardId: state.players[0].storage[0].instanceId });

    const counterCard = state.players[0].counter[0];
    const attemptedSale = applyCommand(state, { type: "sell", cardId: counterCard.instanceId });

    expect(attemptedSale.players[0].coins).toBe(state.players[0].coins);
    expect(attemptedSale.players[0].counter).toHaveLength(1);
  });

  it("cools the attacking gem until the attacker's next own turn ends", () => {
    let state = createGame({ mode: "local", seed: 6, firstPlayer: 0 });
    const attacker = { ...createDeck().find((card) => card.name === "钻石")!, instanceId: "attacker" };
    const target = { ...createDeck().find((card) => card.name === "磷叶石")!, instanceId: "target", listedOnTurn: 0 };
    state.players[0].storage.push(attacker);
    state.players[1].counter.push(target);

    state = applyCommand(state, { type: "attack", attackerId: "attacker", targetId: "target" });

    expect(state.currentPlayer).toBe(1);
    expect(isCooling(state.players[0].storage[0])).toBe(true);
    expect(state.discard[0].instanceId).toBe("target");

    state = applyCommand(state, { type: "endTurn" });
    expect(state.currentPlayer).toBe(0);
    expect(isCooling(state.players[0].storage[0])).toBe(true);

    state = applyCommand(state, { type: "endTurn" });
    expect(isCooling(state.players[0].storage[0])).toBe(false);
  });

  it("removes an attacked target from the counter so it cannot be sold later", () => {
    let state = createGame({ mode: "local", seed: 6, firstPlayer: 0 });
    const attacker = { ...createDeck().find((card) => card.name === "钻石")!, instanceId: "attacker" };
    const target = { ...createDeck().find((card) => card.name === "磷叶石")!, instanceId: "target", listedOnTurn: 0 };
    state.players[0].storage.push(attacker);
    state.players[1].counter.push(target);

    state = applyCommand(state, { type: "attack", attackerId: "attacker", targetId: "target" });

    expect(state.discard.map((card) => card.instanceId)).toContain("target");
    expect(state.players[1].counter.map((card) => card.instanceId)).not.toContain("target");

    const coinsBeforeSaleAttempt = state.players[1].coins;
    const afterSaleAttempt = applyCommand(state, { type: "sell", cardId: "target" });

    expect(afterSaleAttempt.players[1].coins).toBe(coinsBeforeSaleAttempt);
    expect(afterSaleAttempt.players[1].sold.map((card) => card.instanceId)).not.toContain("target");
  });

  it("does not leak attack cooldown back into the source state snapshot", () => {
    const state = createGame({ mode: "local", seed: 6, firstPlayer: 0 });
    const attacker = { ...createDeck().find((card) => card.name === "钻石")!, instanceId: "attacker" };
    const target = { ...createDeck().find((card) => card.name === "磷叶石")!, instanceId: "target", listedOnTurn: 0 };
    state.players[0].storage.push(attacker);
    state.players[1].counter.push(target);

    const nextState = applyCommand(state, { type: "attack", attackerId: "attacker", targetId: "target" });

    expect(isCooling(nextState.players[0].storage[0])).toBe(true);
    expect(isCooling(state.players[0].storage[0])).toBe(false);
    expect(state.players[1].counter.map((card) => card.instanceId)).toContain("target");
    expect(state.discard).toHaveLength(0);
  });

  it("clears AI attack cooldown after the AI completes its next normal turn", () => {
    let state = createGame({ mode: "ai", seed: 6, firstPlayer: 1 });
    const attacker = { ...createDeck().find((card) => card.name === "钻石")!, instanceId: "ai-attacker" };
    const target = { ...createDeck().find((card) => card.name === "磷叶石")!, instanceId: "human-target", listedOnTurn: 0 };
    state.players[1].storage.push(attacker);
    state.players[0].counter.push(target);

    state = applyCommand(state, { type: "attack", attackerId: "ai-attacker", targetId: "human-target" });
    expect(state.currentPlayer).toBe(0);
    expect(isCooling(state.players[1].storage[0])).toBe(true);

    state = applyCommand(state, { type: "endTurn" });
    expect(state.currentPlayer).toBe(1);
    expect(isCooling(state.players[1].storage[0])).toBe(true);

    state = applyCommand(state, { type: "mine" });
    state = applyCommand(state, { type: "mine" });
    state = applyCommand(state, { type: "endTurn" });

    expect(state.currentPlayer).toBe(0);
    expect(isCooling(state.players[1].storage[0])).toBe(false);
  });

  it("allows a player to attack a lower-hardness counter gem at the start of their turn", () => {
    let state = createGame({ mode: "local", seed: 6, firstPlayer: 0 });
    const attacker = { ...createDeck().find((card) => card.name === "钻石")!, instanceId: "attacker" };
    const target = { ...createDeck().find((card) => card.name === "磷叶石")!, instanceId: "target", listedOnTurn: 0 };
    state.players[0].storage.push(attacker);
    state.players[1].counter.push(target);

    expect(getLegalCommands(state)).toContainEqual({
      type: "attack",
      attackerId: "attacker",
      targetId: "target",
    });
  });

  it("returns control to the human with end turn available after an AI attack", () => {
    let state = createGame({ mode: "ai", seed: 6, firstPlayer: 1 });
    const attacker = { ...createDeck().find((card) => card.name === "钻石")!, instanceId: "ai-attacker" };
    const target = { ...createDeck().find((card) => card.name === "磷叶石")!, instanceId: "human-target", listedOnTurn: 0 };
    state.players[1].storage.push(attacker);
    state.players[0].counter.push(target);

    const aiCommand = chooseAiCommand(state);
    expect(aiCommand).toEqual({
      type: "attack",
      attackerId: "ai-attacker",
      targetId: "human-target",
    });

    state = applyCommand(state, aiCommand);

    expect(state.currentPlayer).toBe(0);
    expect(getLegalCommands(state)).toContainEqual({ type: "endTurn" });

    state = applyCommand(state, { type: "endTurn" });
    expect(state.currentPlayer).toBe(1);
  });

  it("keeps the search AI from depending on the hidden deck order", () => {
    const state = createGame({ mode: "ai", seed: 21, firstPlayer: 1 });
    const reversedDeckState = {
      ...state,
      deck: [...state.deck].reverse(),
    };

    expect(chooseSearchAiCommand(state, { maxDepth: 3, samples: 3, timeBudgetMs: 1_000 })).toEqual(
      chooseSearchAiCommand(reversedDeckState, { maxDepth: 3, samples: 3, timeBudgetMs: 1_000 }),
    );
  });

  it("uses search to take an immediate winning sale", () => {
    let state = createGame({ mode: "ai", seed: 6, firstPlayer: 1 });
    const winningCard = {
      ...createDeck().find((card) => card.value >= 11)!,
      instanceId: "winning-sale",
      listedOnTurn: 0,
    };
    state = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          coins: 40,
          counter: [winningCard],
        },
      ],
    };

    expect(chooseAiCommand(state)).toEqual({ type: "sell", cardId: "winning-sale" });
  });

  it("uses search to block an opponent's immediate winning sale", () => {
    let state = createGame({ mode: "ai", seed: 6, firstPlayer: 1 });
    const attacker = { ...createDeck().find((card) => card.id === "diamond")!, instanceId: "ai-blocker" };
    const target = {
      ...createDeck().find((card) => card.id === "phosphophyllite")!,
      instanceId: "human-winning-target",
      listedOnTurn: 0,
    };

    state = {
      ...state,
      players: [
        {
          ...state.players[0],
          coins: 40,
          counter: [target],
        },
        {
          ...state.players[1],
          storage: [attacker],
        },
      ],
    };

    expect(chooseAiCommand(state)).toEqual({
      type: "attack",
      attackerId: "ai-blocker",
      targetId: "human-winning-target",
    });
  });

  it("uses search to collect a strong public gem before mining again", () => {
    let state = createGame({ mode: "ai", seed: 13, firstPlayer: 1 });
    const strongPublicGem = {
      ...createDeck().find((card) => card.id === "diamond")!,
      instanceId: "public-diamond",
    };
    const weakPublicGem = {
      ...createDeck().find((card) => card.id === "obsidian")!,
      instanceId: "public-obsidian",
    };

    state = {
      ...state,
      mine: [weakPublicGem, strongPublicGem],
    };

    expect(chooseSearchAiCommand(state, { maxDepth: 4, samples: 4, timeBudgetMs: 1_000 })).toEqual({
      type: "collect",
      cardId: "public-diamond",
    });
  });

  it("keeps AlphaZero feature vectors at their declared sizes", () => {
    const state = createGame({ mode: "ai", seed: 42, firstPlayer: 1 });
    const command = getLegalCommands(state)[0];

    expect(encodeStateInput(state)).toHaveLength(STATE_FEATURE_SIZE);
    expect(encodeActionInput(state, command)).toHaveLength(ACTION_FEATURE_SIZE);
  });

  it("returns a legal command from AlphaZero MCTS even before long training", () => {
    const state = createGame({ mode: "ai", seed: 42, firstPlayer: 1 });
    const command = chooseAlphaZeroMctsCommand(state, {
      simulations: 6,
      deckSamples: 1,
      timeBudgetMs: 1_000,
      now: () => 0,
    });

    expect(command).not.toBeNull();
    expect(getLegalCommands(state)).toContainEqual(command);
  });
});
