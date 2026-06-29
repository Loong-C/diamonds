import { WINNING_COINS } from "./cards";
import { getCurrentPlayer, getLegalCommands, isCooling } from "./engine";
import { chooseSearchAiCommand } from "./searchAi";
import type { GameCommand, GameState } from "./types";

function otherPlayer(player: 0 | 1): 0 | 1 {
  return player === 0 ? 1 : 0;
}

function commandKey(command: GameCommand): string {
  return JSON.stringify(command);
}

function legalSet(state: GameState): Set<string> {
  return new Set(getLegalCommands(state).map(commandKey));
}

function pickLegal(state: GameState, command: GameCommand): GameCommand | null {
  return legalSet(state).has(commandKey(command)) ? command : null;
}

export function chooseHeuristicAiCommand(state: GameState): GameCommand {
  const player = getCurrentPlayer(state);
  const opponent = state.players[otherPlayer(state.currentPlayer)];

  const winningSale = [...player.counter]
    .filter((card) => card.listedOnTurn !== state.turn && player.coins + card.value >= WINNING_COINS)
    .sort((a, b) => b.value - a.value)[0];

  if (winningSale) {
    return { type: "sell", cardId: winningSale.instanceId };
  }

  if (state.actionsTaken === 0) {
    const attacks = player.storage
      .filter((attacker) => !isCooling(attacker))
      .flatMap((attacker) =>
        opponent.counter
          .filter((target) => attacker.hardness > target.hardness)
          .map((target) => ({
            command: { type: "attack", attackerId: attacker.instanceId, targetId: target.instanceId } as const,
            score:
              target.value * 4 +
              (opponent.coins + target.value >= WINNING_COINS ? 20 : 0) +
              attacker.hardness -
              attacker.value * 0.2,
          })),
      )
      .sort((a, b) => b.score - a.score);

    if (attacks[0] && attacks[0].score >= 26) {
      return attacks[0].command;
    }
  }

  const bestSale = [...player.counter]
    .filter((card) => card.listedOnTurn !== state.turn)
    .sort((a, b) => b.value - a.value || b.hardness - a.hardness)[0];

  if (bestSale) {
    return { type: "sell", cardId: bestSale.instanceId };
  }

  const bestConsign = [...player.storage]
    .filter((card) => !isCooling(card))
    .sort((a, b) => b.value - a.value || b.hardness - a.hardness)[0];

  if (bestConsign) {
    const command = pickLegal(state, { type: "consign", cardId: bestConsign.instanceId });
    if (command) {
      return command;
    }
  }

  const bestCollect = [...state.mine]
    .sort((a, b) => b.value + b.hardness * 0.4 - (a.value + a.hardness * 0.4))[0];

  if (bestCollect) {
    const command = pickLegal(state, { type: "collect", cardId: bestCollect.instanceId });
    if (command) {
      return command;
    }
  }

  const mine = pickLegal(state, { type: "mine" });
  if (mine) {
    return mine;
  }

  return { type: "endTurn" };
}

export function chooseAiCommand(state: GameState): GameCommand {
  const searchCommand = chooseSearchAiCommand(state);
  const legalCommands = legalSet(state);

  if (legalCommands.has(commandKey(searchCommand))) {
    return searchCommand;
  }

  return chooseHeuristicAiCommand(state);
}
