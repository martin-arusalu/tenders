import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { fetchAiStatus, loadApiKey, openAiAdvisor, remoteAdvisor, rulesAdvisor, saveApiKey, type AiStatus } from './ai/advisors';
import { useAiOpponents } from './ai/useAiOpponents';
import * as E from './game/engine';
import type { GameState } from './game/types';
import { BiddingOverlay, CompletionModal, GameOverOverlay } from './components/Overlays';
import { Rulebook } from './components/Rulebook';
import { PLAYER_COLORS } from './components/Pieces';
import { OpponentStrip, PlayerSide, type DragPreview } from './components/PlayerSide';
import { Setup } from './components/Setup';
import { DebugPanel, GameLog } from './components/Sidebar';
import { TableCenter } from './components/TableCenter';

/** Fixed at pointerdown; only the live allocation changes as the card is dragged. */
interface CardDragStart {
  playerId: string;
  projectId: string;
  startAlloc: number;
  maxAlloc: number;
  cellWidth: number;
  startX: number;
}

export default function App() {
  /** The player's own OpenAI key, kept in this browser. */
  const [apiKey, setApiKey] = useState(loadApiKey);
  /** The dev server's AI backend (key in .env.local). Not there on a static host like GitHub Pages. */
  const [serverStatus, setServerStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    fetchAiStatus().then(setServerStatus);
  }, []);
  const changeApiKey = useCallback((key: string) => {
    saveApiKey(key);
    setApiKey(key);
  }, []);
  /** Who prices the AI's bids: the player's key first, then the dev server, else the rules. */
  const advisor = useMemo(
    () => (apiKey ? openAiAdvisor(apiKey) : serverStatus?.ready ? remoteAdvisor() : rulesAdvisor),
    [apiKey, serverStatus],
  );

  const [game, setGame] = useState<GameState | null>(null);
  const [names, setNames] = useState<string[] | undefined>();
  /** AI opponents across the table; 0 = pass-the-device game for 2. */
  const [aiCount, setAiCount] = useState(2);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragRef = useRef<CardDragStart | null>(null);
  const [flipped, setFlipped] = useState<{ playerId: string; projectId: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The rulebook opens by itself whenever a game starts, and from the Rules button any time. */
  const [rulesOpen, setRulesOpen] = useState(false);
  const closeRules = useCallback(() => setRulesOpen(false), []);
  /** Index of the player sitting at the bottom; everyone else's board is hidden. */
  const [seat, setSeat] = useState(0);

  const act = useCallback((fn: (g: GameState) => GameState) => setGame((g) => (g ? fn(g) : g)), []);
  // You sit at seat 0; the AIs take the other seats. Stable per game, since it's an effect dependency.
  const playerIds = game?.players.map((p) => p.id).join(',') ?? '';
  const aiIds = useMemo(() => (aiCount > 0 && playerIds ? playerIds.split(',').slice(1) : []), [aiCount, playerIds]);
  const ai = useAiOpponents(game, act, aiIds, advisor);

  // A card is dragged along its row, up to however many spaces its assigned workers allow.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const deltaSpaces = Math.round(dx / d.cellWidth);
      const alloc = Math.max(0, Math.min(d.maxAlloc, d.startAlloc + deltaSpaces));
      setDragPreview({ projectId: d.projectId, alloc });
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      setDragPreview((prev) => {
        const alloc = prev && prev.projectId === d.projectId ? prev.alloc : d.startAlloc;
        act((g) => E.setAllocation(g, d.playerId, d.projectId, alloc));
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  if (!game) {
    return (
      <main className="app">
        <Setup
          initialNames={names}
          initialAiCount={aiCount}
          apiKey={apiKey}
          onApiKeyChange={changeApiKey}
          serverStatus={serverStatus}
          onStart={(n, ais) => {
            setNames(n);
            setAiCount(ais);
            setSeat(0);
            setGame(E.createGame(n));
            setRulesOpen(true);
          }}
          onShowRules={() => setRulesOpen(true)}
        />
        {rulesOpen && <Rulebook onClose={closeRules} />}
      </main>
    );
  }

  const backToSetup = () => setGame(null);
  const flippedPlayer = flipped && game.players.find((p) => p.id === flipped.playerId);
  const flippedProject = flippedPlayer?.projects.find((pr) => pr.id === flipped!.projectId);

  const grabCard = (playerIdx: number, projectId: string, e: ReactPointerEvent) => {
    e.preventDefault();
    const p = game.players[playerIdx];
    const pr = E.activeProjects(p).find((x) => x.id === projectId);
    if (!pr) return;
    const alloc = game.allocations[p.id]?.[projectId] ?? 0;
    const others = E.assignedWorkers(game, p.id) - alloc;
    const maxAlloc = Math.min(E.remainingWork(pr), p.workers - others);
    const trackEl = (e.currentTarget as HTMLElement).closest('.lane')?.querySelector('.track') as HTMLElement | null;
    const cellWidth = trackEl ? trackEl.getBoundingClientRect().width / E.MAX_WORK : 40;
    dragRef.current = {
      playerId: p.id,
      projectId,
      startAlloc: alloc,
      maxAlloc,
      cellWidth,
      startX: e.clientX,
    };
    setDragPreview({ projectId, alloc });
  };

  const side = (i: number) => {
    const p = game.players[i];
    return (
      <PlayerSide
        game={game}
        player={p}
        color={PLAYER_COLORS[i]}
        allocation={game.allocations[p.id] ?? {}}
        dragPreview={dragPreview}
        onCardGrab={(projectId, e) => grabCard(i, projectId, e)}
        onComplete={(projectId) => {
          act((g) => E.completeProject(g, p.id, projectId));
          setFlipped({ playerId: p.id, projectId });
        }}
        onHire={() => act((g) => E.hireWorker(g, p.id))}
        onRelease={() => act((g) => E.releaseWorker(g, p.id))}
      />
    );
  };

  return (
    <main className={`table ${dragPreview ? 'is-card-dragging' : ''}`}>
      <button className="rules-btn" onClick={() => setRulesOpen(true)} title="How to play">
        Rules
      </button>
      <button className="menu-btn" onClick={() => setMenuOpen(true)} title="Game log & debug tools">
        ☰
      </button>

      <div className="opponents">
        {game.players.map((p, i) =>
          i === seat ? null : (
            <OpponentStrip
              key={p.id}
              player={p}
              color={PLAYER_COLORS[i]}
              onSwitch={aiIds.length ? undefined : () => setSeat(i)}
              ai={aiIds.includes(p.id) ? { thinking: ai.thinking.has(p.id) } : undefined}
            />
          ),
        )}
      </div>
      <TableCenter
        game={game}
        aiNotes={ai.lastDecisions}
        actions={{
          beginBidding: () => act(E.beginBidding),
          proceedToAllocation: () => act(E.proceedToAllocation),
          resolveRound: () => act(E.resolveRound),
          nextRound: () => act(E.nextRound),
        }}
      />
      {side(seat)}

      {menuOpen && (
        <div className="drawer-backdrop" onClick={() => setMenuOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <b>Menu</b>
              <button onClick={() => setMenuOpen(false)}>Close</button>
            </div>
            <DebugPanel
              game={game}
              actions={{
                restart: backToSetup,
                redealTenders: () => act(E.debugRedealMarket),
                advanceRound: () => act(E.debugAdvanceRound),
                adjustMoney: (id, d) => act((g) => E.debugAdjustMoney(g, id, d)),
              }}
            />
            <GameLog game={game} />
          </aside>
        </div>
      )}

      {game.phase === 'bidding' && (
        <BiddingOverlay
          game={game}
          aiPlayerIds={aiIds}
          actions={{
            showBidEntry: () => act(E.showBidEntry),
            submitBid: (bid) => act((g) => E.submitBid(g, bid)),
            revealBids: () => act(E.revealBids),
          }}
        />
      )}
      {flippedPlayer && flippedProject && (
        <CompletionModal
          player={flippedPlayer}
          project={flippedProject}
          color={PLAYER_COLORS[game.players.indexOf(flippedPlayer)]}
          onClose={() => setFlipped(null)}
        />
      )}
      {game.phase === 'gameOver' && !flipped && (
        <GameOverOverlay
          game={game}
          onNewGame={() => {
            setSeat(0);
            setGame(E.createGame(game.players.map((p) => p.name)));
            setRulesOpen(true);
          }}
          onSetup={backToSetup}
        />
      )}
      {rulesOpen && <Rulebook onClose={closeRules} />}
    </main>
  );
}
