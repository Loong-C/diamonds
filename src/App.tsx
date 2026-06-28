import {
  Archive,
  Bot,
  CircleDollarSign,
  Gem,
  Hammer,
  Hourglass,
  PackageOpen,
  RefreshCw,
  ScrollText,
  Swords,
  Tags,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import mineralTabletop from "./assets/mineral-tabletop.png";
import { chooseAiCommand } from "./game/ai";
import { COUNTER_LIMIT, STORAGE_LIMIT, WINNING_COINS } from "./game/cards";
import { applyCommand, createGame, getLegalCommands, isCooling } from "./game/engine";
import type { GameCommand, GameMode, GameState, GemCard, PlayerId } from "./game/types";

type PendingAction = "collect" | "consign" | "sell" | "attack" | null;
type ZoneKind = "mine" | "storage" | "counter";

interface CardClickContext {
  zone: ZoneKind;
  ownerId?: PlayerId;
  card: GemCard;
}

const actionConfig = [
  { type: "mine", label: "开采", icon: Hammer, hint: "从牌堆翻开 2 张宝石" },
  { type: "collect", label: "收纳", icon: PackageOpen, hint: "选择公共矿区 1 张宝石" },
  { type: "consign", label: "寄售", icon: Tags, hint: "选择收纳区非冷却宝石" },
  { type: "sell", label: "卖出", icon: CircleDollarSign, hint: "选择柜台区可售宝石" },
  { type: "attack", label: "攻击", icon: Swords, hint: "先选攻击宝石，再选目标" },
] as const;

const quadrantClass: Record<GemCard["quadrant"], string> = {
  "high-hard-high-value": "gem-card--prism",
  "high-hard-low-value": "gem-card--jade",
  "low-hard-high-value": "gem-card--violet",
  "low-hard-low-value": "gem-card--smoke",
};

function createFreshGame(mode: GameMode): GameState {
  return createGame({ mode, seed: Date.now() });
}

function commandMatchesType(command: GameCommand, type: GameCommand["type"]): boolean {
  return command.type === type;
}

function commandKey(command: GameCommand): string {
  return JSON.stringify(command);
}

function isLegalCommand(legalCommands: GameCommand[], command: GameCommand): boolean {
  return legalCommands.some((legalCommand) => commandKey(legalCommand) === commandKey(command));
}

function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === 0 ? 1 : 0;
}

function describePending(pendingAction: PendingAction, attackSource: string | null): string {
  if (pendingAction === "collect") {
    return "从公共矿区点选 1 张宝石放入当前玩家收纳区。";
  }

  if (pendingAction === "consign") {
    return "从当前玩家收纳区点选 1 张非冷却宝石放上柜台。";
  }

  if (pendingAction === "sell") {
    return "从当前玩家柜台区点选 1 张上回合前已寄售的宝石卖出。";
  }

  if (pendingAction === "attack") {
    return attackSource ? "再点选对方柜台区中硬度更低的目标。" : "先点选当前玩家收纳区中非冷却的攻击宝石。";
  }

  return "选择右侧行动，或直接结束回合。";
}

function winnerText(state: GameState): string {
  if (state.winner === "draw") {
    return "平局";
  }

  if (state.winner === null) {
    return "";
  }

  return `${state.players[state.winner].name} 获胜`;
}

function App() {
  const [mode, setMode] = useState<GameMode>("ai");
  const [state, setState] = useState<GameState>(() => createFreshGame("ai"));
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [attackSource, setAttackSource] = useState<string | null>(null);

  const legalCommands = useMemo(() => getLegalCommands(state), [state]);
  const isAiThinking = state.mode === "ai" && state.currentPlayer === 1 && state.winner === null;
  const currentPlayer = state.players[state.currentPlayer];

  useEffect(() => {
    setPendingAction(null);
    setAttackSource(null);
  }, [state.currentPlayer, state.turn]);

  useEffect(() => {
    if (!isAiThinking) {
      return;
    }

    const timer = window.setTimeout(() => {
      setState((current) => applyCommand(current, chooseAiCommand(current)));
    }, 650);

    return () => window.clearTimeout(timer);
  }, [isAiThinking, state]);

  function restart(nextMode = mode) {
    setMode(nextMode);
    setPendingAction(null);
    setAttackSource(null);
    setState(createFreshGame(nextMode));
  }

  function runCommand(command: GameCommand) {
    if (isAiThinking || state.winner !== null || !isLegalCommand(legalCommands, command)) {
      return;
    }

    setState((current) => applyCommand(current, command));
  }

  function selectAction(type: (typeof actionConfig)[number]["type"]) {
    if (isAiThinking || state.winner !== null) {
      return;
    }

    if (type === "mine") {
      runCommand({ type: "mine" });
      return;
    }

    setAttackSource(null);
    setPendingAction((current) => (current === type ? null : type));
  }

  function handleCardClick({ zone, ownerId, card }: CardClickContext) {
    if (isAiThinking || state.winner !== null) {
      return;
    }

    if (pendingAction === "collect" && zone === "mine") {
      runCommand({ type: "collect", cardId: card.instanceId });
    }

    if (pendingAction === "consign" && zone === "storage" && ownerId === state.currentPlayer) {
      runCommand({ type: "consign", cardId: card.instanceId });
    }

    if (pendingAction === "sell" && zone === "counter" && ownerId === state.currentPlayer) {
      runCommand({ type: "sell", cardId: card.instanceId });
    }

    if (pendingAction !== "attack") {
      return;
    }

    if (!attackSource && zone === "storage" && ownerId === state.currentPlayer) {
      const hasAttack = legalCommands.some(
        (command) => command.type === "attack" && command.attackerId === card.instanceId,
      );
      if (hasAttack) {
        setAttackSource(card.instanceId);
      }
      return;
    }

    if (attackSource && zone === "counter" && ownerId === opponentOf(state.currentPlayer)) {
      runCommand({ type: "attack", attackerId: attackSource, targetId: card.instanceId });
    }
  }

  function isSelectable(context: CardClickContext): boolean {
    const { zone, ownerId, card } = context;

    if (pendingAction === "collect" && zone === "mine") {
      return isLegalCommand(legalCommands, { type: "collect", cardId: card.instanceId });
    }

    if (pendingAction === "consign" && zone === "storage" && ownerId === state.currentPlayer) {
      return isLegalCommand(legalCommands, { type: "consign", cardId: card.instanceId });
    }

    if (pendingAction === "sell" && zone === "counter" && ownerId === state.currentPlayer) {
      return isLegalCommand(legalCommands, { type: "sell", cardId: card.instanceId });
    }

    if (pendingAction === "attack" && !attackSource && zone === "storage" && ownerId === state.currentPlayer) {
      return legalCommands.some((command) => command.type === "attack" && command.attackerId === card.instanceId);
    }

    if (pendingAction === "attack" && attackSource && zone === "counter" && ownerId === opponentOf(state.currentPlayer)) {
      return isLegalCommand(legalCommands, {
        type: "attack",
        attackerId: attackSource,
        targetId: card.instanceId,
      });
    }

    return false;
  }

  const backgroundStyle = {
    "--tabletop-image": `url(${mineralTabletop})`,
  } as React.CSSProperties;

  return (
    <main className="game-shell" style={backgroundStyle}>
      <aside className="brand-rail" aria-label="游戏与模式">
        <div className="brand-mark" aria-hidden="true">
          <Gem size={30} strokeWidth={1.7} />
        </div>
        <div>
          <h1>宝石寄售</h1>
        </div>

        <div className="mode-switch" role="group" aria-label="模式选择">
          <button className={mode === "ai" ? "is-active" : ""} type="button" onClick={() => restart("ai")}>
            <Bot size={18} />
            人机对战
          </button>
          <button className={mode === "local" ? "is-active" : ""} type="button" onClick={() => restart("local")}>
            <UsersRound size={18} />
            双人对战
          </button>
        </div>

        <section className="log-panel" aria-label="日志">
          <div className="section-title">
            <ScrollText size={16} />
            日志
          </div>
          <ol>
            {state.log.map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ol>
        </section>
      </aside>

      <section className="board" aria-label="游戏棋盘">
        <PlayerBand
          playerId={1}
          state={state}
          onCardClick={handleCardClick}
          isSelectable={isSelectable}
          attackSource={attackSource}
        />

        <MineBand
          state={state}
          onCardClick={handleCardClick}
          isSelectable={isSelectable}
        />

        <PlayerBand
          playerId={0}
          state={state}
          onCardClick={handleCardClick}
          isSelectable={isSelectable}
          attackSource={attackSource}
        />
      </section>

      <aside className="action-rail" aria-label="行动面板">
        <StatusPanel state={state} isAiThinking={isAiThinking} />

        <div className="action-list">
          {actionConfig.map(({ type, label, icon: Icon, hint }) => {
            const hasLegalCommand = legalCommands.some((command) => commandMatchesType(command, type));
            const isActive = pendingAction === type;
            return (
              <button
                className={isActive ? "action-button is-active" : "action-button"}
                disabled={!hasLegalCommand || isAiThinking || state.winner !== null}
                key={type}
                type="button"
                onClick={() => selectAction(type)}
                title={hint}
              >
                <Icon size={21} />
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="turn-hint">
          {state.winner ? winnerText(state) : `${currentPlayer.name}：${describePending(pendingAction, attackSource)}`}
        </div>

        <button
          className="end-turn-button"
          disabled={!isLegalCommand(legalCommands, { type: "endTurn" }) || isAiThinking || state.winner !== null}
          type="button"
          onClick={() => runCommand({ type: "endTurn" })}
        >
          <RefreshCw size={20} />
          结束回合
        </button>

        <button className="quiet-button" type="button" onClick={() => restart()}>
          重新开局
        </button>
      </aside>
    </main>
  );
}

interface PlayerBandProps {
  playerId: PlayerId;
  state: GameState;
  attackSource: string | null;
  onCardClick: (context: CardClickContext) => void;
  isSelectable: (context: CardClickContext) => boolean;
}

function PlayerBand({ playerId, state, attackSource, onCardClick, isSelectable }: PlayerBandProps) {
  const player = state.players[playerId];
  const isCurrent = state.currentPlayer === playerId && state.winner === null;

  return (
    <section className={isCurrent ? "player-band is-current" : "player-band"} aria-label={`${player.name} 区域`}>
      <PlayerSummary player={player} isCurrent={isCurrent} />
      <Zone
        title="收纳区"
        subtitle={`${player.storage.length}/${STORAGE_LIMIT}`}
        cards={player.storage}
        emptySlots={STORAGE_LIMIT - player.storage.length}
        zone="storage"
        ownerId={playerId}
        onCardClick={onCardClick}
        isSelectable={isSelectable}
        selectedId={attackSource}
      />
      <Zone
        title="柜台区"
        subtitle={`${player.counter.length}/${COUNTER_LIMIT}`}
        cards={player.counter}
        emptySlots={COUNTER_LIMIT - player.counter.length}
        zone="counter"
        ownerId={playerId}
        onCardClick={onCardClick}
        isSelectable={isSelectable}
      />
    </section>
  );
}

function PlayerSummary({ player, isCurrent }: { player: GameState["players"][number]; isCurrent: boolean }) {
  return (
    <div className="player-summary">
      <div className="portrait" aria-hidden="true">
        <Gem size={30} strokeWidth={1.4} />
      </div>
      <div>
        <p>{isCurrent ? "行动中" : "等待"}</p>
        <h2>{player.name}</h2>
      </div>
      <div className="player-stats">
        <span>
          <CircleDollarSign size={16} />
          {player.coins}
        </span>
        <span>
          <Archive size={16} />
          {player.sold.length}
        </span>
      </div>
    </div>
  );
}

interface MineBandProps {
  state: GameState;
  onCardClick: (context: CardClickContext) => void;
  isSelectable: (context: CardClickContext) => boolean;
}

function MineBand({ state, onCardClick, isSelectable }: MineBandProps) {
  return (
    <section className="mine-band" aria-label="公共矿区">
      <div className="pile-column">
        <div className="deck-stack" aria-label={`牌堆剩余 ${state.deck.length} 张`}>
          <div className="deck-card" />
          <div className="deck-card deck-card--offset" />
          <span>{state.deck.length}</span>
        </div>
        <p>卡牌堆</p>
      </div>

      <Zone
        title="公共矿区"
        subtitle={`${state.mine.length} 张可收纳`}
        cards={state.mine}
        emptySlots={Math.max(0, 4 - state.mine.length)}
        zone="mine"
        onCardClick={onCardClick}
        isSelectable={isSelectable}
        wide
      />

      <div className="pile-column">
        <div className="discard-stack" aria-label={`弃置区 ${state.discard.length} 张`}>
          <Swords size={26} />
          <span>{state.discard.length}</span>
        </div>
        <p>弃置堆</p>
      </div>
    </section>
  );
}

interface ZoneProps {
  title: string;
  subtitle: string;
  cards: GemCard[];
  emptySlots: number;
  zone: ZoneKind;
  ownerId?: PlayerId;
  wide?: boolean;
  selectedId?: string | null;
  onCardClick: (context: CardClickContext) => void;
  isSelectable: (context: CardClickContext) => boolean;
}

function Zone({
  title,
  subtitle,
  cards,
  emptySlots,
  zone,
  ownerId,
  wide = false,
  selectedId,
  onCardClick,
  isSelectable,
}: ZoneProps) {
  return (
    <section className={[wide ? "zone zone--wide" : "zone", `zone--${zone}`].join(" ")}>
      <div className="zone-heading">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      <div className="card-row">
        {cards.map((card) => {
          const context = { zone, ownerId, card };
          return (
            <GemCardView
              card={card}
              key={card.instanceId}
              isSelected={selectedId === card.instanceId}
              isSelectable={isSelectable(context)}
              onClick={() => onCardClick(context)}
            />
          );
        })}
        {Array.from({ length: emptySlots }, (_, index) => (
          <div className="empty-slot" key={`${title}-${index}`} aria-hidden="true">
            <Gem size={24} strokeWidth={1.2} />
          </div>
        ))}
      </div>
    </section>
  );
}

function GemCardView({
  card,
  isSelectable,
  isSelected,
  onClick,
}: {
  card: GemCard;
  isSelectable: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const cooling = isCooling(card);

  return (
    <button
      className={[
        "gem-card",
        quadrantClass[card.quadrant],
        isSelectable ? "is-selectable" : "",
        isSelected ? "is-selected" : "",
        cooling ? "is-cooling" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      onClick={onClick}
    >
      <span className="gem-card__name">{card.name}</span>
      <span className="gem-card__stone" aria-hidden="true" />
      <span className="gem-card__meta">
        <span>硬 {card.hardness}</span>
        <span>值 {card.value}</span>
      </span>
      {cooling && (
        <span className="cooldown-chip">
          <Hourglass size={12} />
          冷却
        </span>
      )}
      {card.listedOnTurn !== null && (
        <span className="listed-chip">{card.listedOnTurn === null ? "" : "寄售"}</span>
      )}
    </button>
  );
}

function StatusPanel({ state, isAiThinking }: { state: GameState; isAiThinking: boolean }) {
  const current = state.players[state.currentPlayer];
  const winner = winnerText(state);

  return (
    <section className="status-panel" aria-label="回合状态">
      <div className="round-line">
        <span>回合 {state.turn}</span>
        <strong>{state.winner ? winner : `${current.name} 行动中`}</strong>
      </div>
      <div className="ap-row" aria-label={`行动点 ${state.actionPoints}`}>
        <span>行动点</span>
        <strong>{state.actionPoints}/2</strong>
      </div>
      <div className="ap-dots" aria-hidden="true">
        {Array.from({ length: 2 }, (_, index) => (
          <span className={index < state.actionPoints ? "is-filled" : ""} key={index} />
        ))}
      </div>
      <div className="score-track">
        {state.players.map((player) => (
          <div key={player.id}>
            <span>{player.name}</span>
            <meter max={WINNING_COINS} min={0} value={Math.min(player.coins, WINNING_COINS)} />
          </div>
        ))}
      </div>
      {isAiThinking && <p className="thinking">AI 正在评估柜台价值...</p>}
    </section>
  );
}

export default App;
