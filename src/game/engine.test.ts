import { describe, expect, it } from "vitest";
import { createDeck } from "./cards";
import { applyCommand, createGame, getLegalCommands, isCooling } from "./engine";
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
});
