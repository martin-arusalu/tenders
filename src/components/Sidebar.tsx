import { TABLE } from '../config';
import type { GameState } from '../game/types';

export function GameLog({ game }: { game: GameState }) {
  const rounds = [...new Set(game.log.map((e) => e.round))].sort((a, b) => b - a);
  return (
    <details className="panel log" open>
      <summary>Game log</summary>
      {rounds.map((r) => (
        <div key={r} className="log-round">
          <div className="log-round-title">Round {r}</div>
          {game.log
            .filter((e) => e.round === r)
            .map((e, i) => (
              <div key={i} className={`log-entry ${e.kind}`}>
                {e.text}
              </div>
            ))}
        </div>
      ))}
    </details>
  );
}

export interface DebugActions {
  restart: () => void;
  redealTenders: () => void;
  advanceRound: () => void;
  adjustMoney: (playerId: string, delta: number) => void;
}

export function DebugPanel({ game, actions }: { game: GameState; actions: DebugActions }) {
  const canRedeal = game.market.length > 0 && (game.phase === 'tenderReveal' || game.phase === 'bidding');
  return (
    <details className="panel debug">
      <summary>Debug / Playtest</summary>
      <div className="row gap wrap">
        <button onClick={actions.restart}>Restart game</button>
        <button onClick={actions.redealTenders} disabled={!canRedeal}>
          Discard &amp; redeal tenders
        </button>
        <button onClick={actions.advanceRound} disabled={game.phase === 'gameOver'} title="Tenders on offer get no bids; unassigned players auto-assign; round resolves">
          Advance one round
        </button>
      </div>

      <h4>Money</h4>
      {game.players.map((p) => (
        <div key={p.id} className="row between debug-money">
          <span>
            {p.name}: <b>{p.money}</b>
          </span>
          <span className="row gap-sm">
            {TABLE.debugMoneySteps.map((d) => (
              <button key={d} className="icon" onClick={() => actions.adjustMoney(p.id, d)}>
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </span>
        </div>
      ))}

      <h4>Remaining deck ({game.deck.length}, in draw order)</h4>
      {game.deck.length === 0 && <p className="muted small">Empty.</p>}
      <ol className="small deck-list">
        {game.deck.map((t) => (
          <li key={t.id}>
            {t.name} — W{t.work} D{t.deadline} P{t.penalty}
          </li>
        ))}
      </ol>
    </details>
  );
}
