export type PlayerId = 0 | 1;

export type GameMode = "local" | "ai";

export type GemQuadrant = "high-hard-high-value" | "high-hard-low-value" | "low-hard-high-value" | "low-hard-low-value";

export interface GemDefinition {
  id: string;
  name: string;
  hardness: number;
  value: number;
  count: number;
  quadrant: GemQuadrant;
}

export interface GemCard extends GemDefinition {
  instanceId: string;
  listedOnTurn: number | null;
  cooldownReleaseTurn: number | null;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  coins: number;
  storage: GemCard[];
  counter: GemCard[];
  sold: GemCard[];
  turnsStarted: number;
}

export type Winner = PlayerId | "draw" | null;

export interface GameState {
  mode: GameMode;
  seed: number;
  turn: number;
  currentPlayer: PlayerId;
  actionPoints: number;
  actionsTaken: number;
  players: [PlayerState, PlayerState];
  deck: GemCard[];
  mine: GemCard[];
  discard: GemCard[];
  log: string[];
  winner: Winner;
}

export type GameCommand =
  | { type: "mine" }
  | { type: "collect"; cardId: string }
  | { type: "consign"; cardId: string }
  | { type: "sell"; cardId: string }
  | { type: "attack"; attackerId: string; targetId: string }
  | { type: "endTurn" };

export interface NewGameOptions {
  mode: GameMode;
  seed?: number;
  firstPlayer?: PlayerId;
}

export interface ActionOption {
  command: GameCommand;
  label: string;
  score?: number;
}
