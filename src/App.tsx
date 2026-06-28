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
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import mineralTabletop from "./assets/mineral-tabletop.png";
import { chooseAiCommand } from "./game/ai";
import { COUNTER_LIMIT, STORAGE_LIMIT, WINNING_COINS } from "./game/cards";
import { applyCommand, createGame, getLegalCommands, isCooling } from "./game/engine";
import type { GameCommand, GameMode, GameState, GemCard, PlayerId } from "./game/types";

type PendingAction = "collect" | "consign" | "sell" | "attack" | null;
type DevEndgameFixture = "win" | "loss" | "draw";
type ZoneKind = "mine" | "storage" | "counter";

interface CardClickContext {
  zone: ZoneKind;
  ownerId?: PlayerId;
  card: GemCard;
}

interface AttackFeedback {
  id: string;
  attackerName: string;
  defenderName: string;
  targetName: string;
}

const actionConfig = [
  { type: "mine", label: "开采", icon: Hammer, hint: "从牌堆翻开 2 张宝石" },
  { type: "collect", label: "收纳", icon: PackageOpen, hint: "选择公共矿区 1 张宝石" },
  { type: "consign", label: "寄售", icon: Tags, hint: "选择收纳区非冷却宝石" },
  { type: "sell", label: "卖出", icon: CircleDollarSign, hint: "选择柜台区可售宝石" },
  { type: "attack", label: "攻击", icon: Swords, hint: "选攻击宝石或目标" },
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

function createInitialGame(mode: GameMode): GameState {
  const fixture = getDevEndgameFixture();
  return fixture ? createEndgameFixture(mode, fixture) : createFreshGame(mode);
}

function getDevEndgameFixture(): DevEndgameFixture | null {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return null;
  }

  const fixture = new URLSearchParams(window.location.search).get("endgame");
  return fixture === "win" || fixture === "loss" || fixture === "draw" ? fixture : null;
}

function createEndgameFixture(mode: GameMode, fixture: DevEndgameFixture): GameState {
  const baseState = createGame({ mode, seed: 832491, firstPlayer: 0 });
  const winner: GameState["winner"] = fixture === "draw" ? "draw" : fixture === "loss" ? 1 : 0;
  const coinTotals: Record<PlayerId, number> =
    fixture === "loss" ? { 0: 28, 1: WINNING_COINS } : fixture === "draw" ? { 0: 32, 1: 32 } : { 0: WINNING_COINS, 1: 24 };
  const soldCounts: Record<PlayerId, number> =
    fixture === "loss" ? { 0: 3, 1: 5 } : fixture === "draw" ? { 0: 4, 1: 4 } : { 0: 5, 1: 3 };
  const playerZeroSold = baseState.deck.slice(0, soldCounts[0]);
  const playerOneSold = baseState.deck.slice(soldCounts[0], soldCounts[0] + soldCounts[1]);

  return {
    ...baseState,
    actionPoints: 0,
    actionsTaken: 2,
    currentPlayer: winner === 1 ? 1 : 0,
    deck: baseState.deck.slice(soldCounts[0] + soldCounts[1]),
    log: [
      fixture === "loss"
        ? `${baseState.players[1].name} 率先达到 ${WINNING_COINS} 金币。`
        : fixture === "draw"
          ? "牌堆耗尽，双方金币持平。"
          : `${baseState.players[0].name} 率先达到 ${WINNING_COINS} 金币。`,
      `${baseState.players[0].name} 完成一次高价值售出。`,
      `${baseState.players[1].name} 调整了柜台陈列。`,
    ],
    players: [
      { ...baseState.players[0], coins: coinTotals[0], sold: playerZeroSold },
      { ...baseState.players[1], coins: coinTotals[1], sold: playerOneSold },
    ],
    turn: 9,
    winner,
  };
}

function commandMatchesType(command: GameCommand, type: GameCommand["type"]): boolean {
  return command.type === type;
}

function getActionLabel(type: GameCommand["type"]): string {
  return actionConfig.find((action) => action.type === type)?.label ?? "行动";
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

function describePending(pendingAction: PendingAction, attackSource: string | null, attackTarget: string | null): string {
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
    if (attackSource) {
      return "再选可击碎目标。";
    }

    if (attackTarget) {
      return "再选硬度更高的宝石。";
    }

    return "选攻击宝石或目标，顺序不限。";
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

function endgameTitle(state: GameState): string {
  if (state.winner === "draw") {
    return "平局";
  }

  if (state.winner === null) {
    return "";
  }

  if (state.mode === "ai") {
    return state.winner === 0 ? "胜利" : "失败";
  }

  return `${state.players[state.winner].name} 获胜`;
}

function endgameCopy(state: GameState): string {
  if (state.winner === "draw") {
    return `双方都停在 ${state.players[0].coins} 金币，矿灯熄灭时仍难分高下。`;
  }

  if (state.winner === null) {
    return "";
  }

  const winner = state.players[state.winner];

  if (state.mode === "ai") {
    return state.winner === 0
      ? `你以 ${winner.coins} 金币完成了更漂亮的寄售。`
      : `${winner.name} 以 ${winner.coins} 金币先完成结算。`;
  }

  return `${winner.name} 以 ${winner.coins} 金币完成结算。`;
}

function endgameTone(state: GameState): string {
  if (state.winner === "draw") {
    return "is-draw";
  }

  if (state.mode === "ai" && state.winner === 1) {
    return "is-loss";
  }

  return "is-win";
}

function getAttackFeedback(command: GameCommand, sourceState: GameState): AttackFeedback | null {
  if (command.type !== "attack") {
    return null;
  }

  const player = sourceState.players[sourceState.currentPlayer];
  const opponent = sourceState.players[opponentOf(sourceState.currentPlayer)];
  const attacker = player.storage.find((card) => card.instanceId === command.attackerId);
  const target = opponent.counter.find((card) => card.instanceId === command.targetId);

  if (!attacker || !target) {
    return null;
  }

  return {
    id: `${sourceState.turn}-${sourceState.currentPlayer}-${command.attackerId}-${command.targetId}-${sourceState.log.length}`,
    attackerName: attacker.name,
    defenderName: opponent.name,
    targetName: target.name,
  };
}

function getSafeAiCommand(sourceState: GameState): GameCommand | null {
  const legalCommands = getLegalCommands(sourceState);
  const preferredCommand = chooseAiCommand(sourceState);

  if (isLegalCommand(legalCommands, preferredCommand)) {
    return preferredCommand;
  }

  return legalCommands.find((command) => command.type === "endTurn") ?? legalCommands[0] ?? null;
}

function App() {
  const [mode, setMode] = useState<GameMode>("ai");
  const [state, setState] = useState<GameState>(() => createInitialGame("ai"));
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [attackSource, setAttackSource] = useState<string | null>(null);
  const [attackTarget, setAttackTarget] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [attackFeedback, setAttackFeedback] = useState<AttackFeedback | null>(null);
  const attackSourceRef = useRef<string | null>(null);
  const attackTargetRef = useRef<string | null>(null);
  const pendingAttackFeedback = useRef<AttackFeedback | null>(null);

  const legalCommands = useMemo(() => getLegalCommands(state), [state]);
  const isAiThinking = state.mode === "ai" && state.currentPlayer === 1 && state.winner === null;
  const currentPlayer = state.players[state.currentPlayer];

  useEffect(() => {
    setPendingAction(null);
    clearAttackSelection();
    setActionNotice(null);
  }, [state.currentPlayer, state.turn]);

  useEffect(() => {
    if (!pendingAttackFeedback.current) {
      return;
    }

    const feedback = pendingAttackFeedback.current;
    pendingAttackFeedback.current = null;
    setAttackFeedback(feedback);
  }, [state]);

  useEffect(() => {
    if (!isAiThinking) {
      return;
    }

    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.mode !== "ai" || current.currentPlayer !== 1 || current.winner !== null) {
          return current;
        }

        const command = getSafeAiCommand(current);
        if (!command) {
          return current;
        }

        const feedback = getAttackFeedback(command, current);
        if (feedback) {
          pendingAttackFeedback.current = feedback;
        }

        return applyCommand(current, command);
      });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [isAiThinking, state]);

  useEffect(() => {
    if (!attackFeedback) {
      return;
    }

    const timer = window.setTimeout(() => setAttackFeedback(null), 2400);
    return () => window.clearTimeout(timer);
  }, [attackFeedback]);

  useEffect(() => {
    if (pendingAction !== "attack" || !attackSource || !attackTarget || isAiThinking || state.winner !== null) {
      return;
    }

    const command: GameCommand = { type: "attack", attackerId: attackSource, targetId: attackTarget };
    const feedback = getAttackFeedback(command, state);
    if (feedback) {
      showAttackFeedbackAfterState(feedback);
    }
    setState((current) => applyCommand(current, command));
  }, [attackSource, attackTarget, isAiThinking, pendingAction, state.winner]);

  function restart(nextMode = mode) {
    setMode(nextMode);
    setPendingAction(null);
    clearAttackSelection();
    setActionNotice(null);
    setAttackFeedback(null);
    pendingAttackFeedback.current = null;
    setState(createFreshGame(nextMode));
  }

  function clearAttackSelection() {
    attackSourceRef.current = null;
    attackTargetRef.current = null;
    setAttackSource(null);
    setAttackTarget(null);
  }

  function selectAttackSource(cardId: string | null) {
    attackSourceRef.current = cardId;
    setAttackSource(cardId);
  }

  function selectAttackTarget(cardId: string | null) {
    attackTargetRef.current = cardId;
    setAttackTarget(cardId);
  }

  function showAttackFeedbackAfterState(feedback: AttackFeedback | null) {
    pendingAttackFeedback.current = feedback;

    if (!feedback) {
      setAttackFeedback(null);
    }
  }

  function runCommand(command: GameCommand) {
    if (isAiThinking || state.winner !== null) {
      return;
    }

    if (!isLegalCommand(legalCommands, command)) {
      setActionNotice(describeIllegalCommand(command));
      return;
    }

    setActionNotice(null);
    const feedback = getAttackFeedback(command, state);
    showAttackFeedbackAfterState(feedback);
    setState((current) => applyCommand(current, command));
  }

  function runAttackCommand(attackerId: string, targetId: string) {
    const command: GameCommand = { type: "attack", attackerId, targetId };
    if (!isLegalCommand(getLegalCommands(state), command)) {
      setActionNotice(describeIllegalCommand(command));
      return;
    }

    const feedback = getAttackFeedback(command, state);
    if (feedback) {
      pendingAttackFeedback.current = feedback;
    }

    setActionNotice(null);
    setPendingAction(null);
    clearAttackSelection();
    setState(applyCommand(state, command));
  }

  function selectAction(type: (typeof actionConfig)[number]["type"]) {
    if (isAiThinking || state.winner !== null) {
      return;
    }

    if (!legalCommands.some((command) => commandMatchesType(command, type))) {
      setActionNotice(describeUnavailableAction(type));
      return;
    }

    if (type === "mine") {
      runCommand({ type: "mine" });
      return;
    }

    clearAttackSelection();
    setActionNotice(null);
    setPendingAction((current) => (current === type ? null : type));
  }

  function handleCardClick({ zone, ownerId, card }: CardClickContext) {
    if (isAiThinking || state.winner !== null) {
      return;
    }

    if (pendingAction === "collect" && zone === "mine") {
      setActionNotice(null);
      runCommand({ type: "collect", cardId: card.instanceId });
    }

    if (pendingAction === "consign" && zone === "storage" && ownerId === state.currentPlayer) {
      setActionNotice(null);
      runCommand({ type: "consign", cardId: card.instanceId });
    }

    if (pendingAction === "sell" && zone === "counter" && ownerId === state.currentPlayer) {
      setActionNotice(null);
      runCommand({ type: "sell", cardId: card.instanceId });
    }

    if (pendingAction !== "attack") {
      return;
    }

    if (zone === "storage" && ownerId === state.currentPlayer) {
      const selectedTarget = attackTargetRef.current;
      if (selectedTarget) {
        runAttackCommand(card.instanceId, selectedTarget);
        return;
      }

      if (hasLegalAttack({ attackerId: card.instanceId })) {
        setActionNotice(null);
        selectAttackSource(card.instanceId);
      } else {
        setActionNotice("这张宝石不能作为当前攻击宝石。攻击宝石必须在己方收纳区、未冷却，并且硬度高于目标。");
      }
      return;
    }

    if (zone === "counter" && ownerId === opponentOf(state.currentPlayer)) {
      const selectedSource = attackSourceRef.current;
      if (selectedSource) {
        runAttackCommand(selectedSource, card.instanceId);
        return;
      }

      if (hasLegalAttack({ targetId: card.instanceId })) {
        setActionNotice(null);
        selectAttackTarget(card.instanceId);
      } else {
        setActionNotice("这个目标当前不能被攻击。攻击宝石硬度必须严格高于目标宝石。");
      }
    }
  }

  function handleBoardPointerUp(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    const cardElement = (event.target as HTMLElement).closest<HTMLButtonElement>(".gem-card");
    if (!cardElement) {
      return;
    }

    const cardId = cardElement.dataset.cardId;
    const zone = cardElement.dataset.zone as ZoneKind | undefined;
    if (!cardId || !zone) {
      return;
    }

    const card = findCard(cardId);
    if (!card) {
      return;
    }

    const ownerId = cardElement.dataset.ownerId === "" ? undefined : (Number(cardElement.dataset.ownerId) as PlayerId);
    event.preventDefault();
    window.setTimeout(() => handleCardClick({ zone, ownerId, card }), 0);
  }

  function findCard(cardId: string): GemCard | null {
    for (const card of state.mine) {
      if (card.instanceId === cardId) {
        return card;
      }
    }

    for (const player of state.players) {
      const card = [...player.storage, ...player.counter].find((item) => item.instanceId === cardId);
      if (card) {
        return card;
      }
    }

    return null;
  }

  function hasLegalAttack(filter: { attackerId?: string; targetId?: string }): boolean {
    return legalCommands.some(
      (command) =>
        command.type === "attack" &&
        (!filter.attackerId || command.attackerId === filter.attackerId) &&
        (!filter.targetId || command.targetId === filter.targetId),
    );
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

    if (pendingAction === "attack" && zone === "storage" && ownerId === state.currentPlayer) {
      return hasLegalAttack({
        attackerId: card.instanceId,
        targetId: attackTargetRef.current ?? attackTarget ?? undefined,
      });
    }

    if (pendingAction === "attack" && zone === "counter" && ownerId === opponentOf(state.currentPlayer)) {
      return hasLegalAttack({
        attackerId: attackSourceRef.current ?? attackSource ?? undefined,
        targetId: card.instanceId,
      });
    }

    return false;
  }

  function describeIllegalCommand(command: GameCommand): string {
    if (command.type === "attack") {
      return "这组攻击不合法：攻击宝石必须在己方收纳区、未冷却，且硬度严格高于对方柜台目标。";
    }

    return `${getActionLabel(command.type)}现在不能执行。`;
  }

  function describeUnavailableAction(type: (typeof actionConfig)[number]["type"]): string {
    if (type !== "attack") {
      return `${getActionLabel(type)}现在不可用。`;
    }

    if (state.actionsTaken > 0) {
      return "攻击只能作为本回合第一件事。你本回合已经执行过行动，请结束回合后再攻击。";
    }

    const player = state.players[state.currentPlayer];
    const opponent = state.players[opponentOf(state.currentPlayer)];
    const readyStorage = player.storage.filter((card) => !isCooling(card));

    if (player.storage.length === 0) {
      return "不能攻击：己方收纳区没有宝石。攻击宝石必须先在收纳区。";
    }

    if (readyStorage.length === 0) {
      return "不能攻击：己方收纳区的宝石都在冷却。";
    }

    if (opponent.counter.length === 0) {
      return "不能攻击：对方柜台区没有目标。只能攻击对方柜台上的宝石。";
    }

    const highestHardness = Math.max(...readyStorage.map((card) => card.hardness));
    const targetHardness = Math.min(...opponent.counter.map((card) => card.hardness));

    return `不能攻击：己方可用宝石最高硬度 ${highestHardness}，对方柜台最低硬度 ${targetHardness}。攻击必须硬度严格更高。`;
  }

  const backgroundStyle = {
    "--tabletop-image": `url(${mineralTabletop})`,
  } as CSSProperties;

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
          <button
            className={mode === "ai" ? "is-active" : ""}
            data-mode="ai"
            type="button"
            onClick={() => restart("ai")}
          >
            <Bot size={18} />
            人机对战
          </button>
          <button
            className={mode === "local" ? "is-active" : ""}
            data-mode="local"
            type="button"
            onClick={() => restart("local")}
          >
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

      <section className="board" aria-label="游戏棋盘" onPointerUpCapture={handleBoardPointerUp}>
        <PlayerBand
          playerId={1}
          state={state}
          onCardClick={handleCardClick}
          isSelectable={isSelectable}
          attackSource={attackSource}
          attackTarget={attackTarget}
        />

        <MineBand
          state={state}
          attackFeedback={attackFeedback}
          onCardClick={handleCardClick}
          isSelectable={isSelectable}
        />

        <PlayerBand
          playerId={0}
          state={state}
          onCardClick={handleCardClick}
          isSelectable={isSelectable}
          attackSource={attackSource}
          attackTarget={attackTarget}
        />
      </section>

      <aside className="action-rail" aria-label="行动面板">
        <StatusPanel state={state} isAiThinking={isAiThinking} />

        <div className="action-list">
          {actionConfig.map(({ type, label, icon: Icon, hint }) => {
            const hasLegalCommand = legalCommands.some((command) => commandMatchesType(command, type));
            const isActive = pendingAction === type;
            const unavailableReason = hasLegalCommand ? null : describeUnavailableAction(type);
            return (
              <button
                aria-disabled={!hasLegalCommand}
                className={[
                  "action-button",
                  isActive ? "is-active" : "",
                  !hasLegalCommand ? "is-unavailable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={isAiThinking || state.winner !== null}
                data-action={type}
                key={type}
                type="button"
                onClick={() => selectAction(type)}
                title={unavailableReason ?? hint}
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

        {attackFeedback && <AttackFeedbackBanner feedback={attackFeedback} key={attackFeedback.id} />}

        <div className="turn-hint">
          {state.winner !== null
            ? winnerText(state)
            : `${currentPlayer.name}：${actionNotice ?? describePending(pendingAction, attackSource, attackTarget)}`}
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

      {state.winner !== null && <EndGameOverlay state={state} onRestart={() => restart()} />}
    </main>
  );
}

interface PlayerBandProps {
  playerId: PlayerId;
  state: GameState;
  attackSource: string | null;
  attackTarget: string | null;
  onCardClick: (context: CardClickContext) => void;
  isSelectable: (context: CardClickContext) => boolean;
}

function PlayerBand({ playerId, state, attackSource, attackTarget, onCardClick, isSelectable }: PlayerBandProps) {
  const player = state.players[playerId];
  const isCurrent = state.currentPlayer === playerId && state.winner === null;

  return (
    <section
      className={isCurrent ? "player-band is-current" : "player-band"}
      data-current={isCurrent ? "true" : "false"}
      data-player-id={playerId}
      aria-label={`${player.name} 区域`}
    >
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
        selectedId={attackTarget}
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
  attackFeedback: AttackFeedback | null;
  onCardClick: (context: CardClickContext) => void;
  isSelectable: (context: CardClickContext) => boolean;
}

function MineBand({ state, attackFeedback, onCardClick, isSelectable }: MineBandProps) {
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
        <div
          className={attackFeedback ? "discard-stack is-hit" : "discard-stack"}
          aria-label={`弃置区 ${state.discard.length} 张`}
        >
          <Swords size={26} />
          <span>{state.discard.length}</span>
        </div>
        <p>弃置堆</p>
      </div>
    </section>
  );
}

function AttackFeedbackBanner({ feedback }: { feedback: AttackFeedback }) {
  return (
    <div className="attack-feedback" role="status" aria-live="polite">
      <Swords size={18} />
      <span>
        <strong>{feedback.targetName} 已进弃置堆</strong>
        <small>
          {feedback.attackerName} 击碎了 {feedback.defenderName} 的柜台目标
        </small>
      </span>
    </div>
  );
}

function EndGameOverlay({ state, onRestart }: { state: GameState; onRestart: () => void }) {
  const winnerId = typeof state.winner === "number" ? state.winner : null;
  const recentLogs = state.log.slice(0, 3);

  return (
    <section
      aria-describedby="endgame-copy"
      aria-labelledby="endgame-title"
      aria-modal="true"
      className={["endgame-overlay", endgameTone(state)].join(" ")}
      role="dialog"
    >
      <div className="endgame-panel">
        <div className="endgame-mark" aria-hidden="true">
          <Gem size={28} strokeWidth={1.6} />
        </div>
        <p className="endgame-kicker">最终结算</p>
        <h2 id="endgame-title">{endgameTitle(state)}</h2>
        <p className="endgame-copy" id="endgame-copy">
          {endgameCopy(state)}
        </p>

        <div className="endgame-scoreboard" aria-label="最终比分">
          {state.players.map((player) => (
            <div
              className={player.id === winnerId ? "endgame-score-row is-winner" : "endgame-score-row"}
              key={player.id}
            >
              <strong>{player.name}</strong>
              <span className="endgame-stat">
                <CircleDollarSign size={15} />
                {player.coins}
              </span>
              <span className="endgame-stat">
                <Archive size={15} />
                {player.sold.length}
              </span>
            </div>
          ))}
        </div>

        {recentLogs.length > 0 && (
          <div className="endgame-log">
            <span>最近结算</span>
            <ol>
              {recentLogs.map((entry, index) => (
                <li key={`${entry}-${index}`}>{entry}</li>
              ))}
            </ol>
          </div>
        )}

        <button autoFocus className="endgame-primary" type="button" onClick={onRestart}>
          <RefreshCw size={20} />
          再来一局
        </button>
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
              ownerId={ownerId}
              isSelected={selectedId === card.instanceId}
              isSelectable={isSelectable(context)}
              zone={zone}
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
  ownerId,
  zone,
  onClick,
}: {
  card: GemCard;
  isSelectable: boolean;
  isSelected: boolean;
  ownerId?: PlayerId;
  zone: ZoneKind;
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
      data-card-id={card.instanceId}
      data-card-name={card.name}
      data-hardness={card.hardness}
      data-owner-id={ownerId ?? ""}
      data-value={card.value}
      data-zone={zone}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        onClick();
      }}
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
        <strong>{state.winner !== null ? winner : `${current.name} 行动中`}</strong>
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
