import type { CSSProperties, PointerEvent } from 'react';
import { GAME, TABLE } from '../config';
import { MAX_WORK, activeProjects, isReady, lastPayingRound, payroll, projectedPayout, wagesDue } from '../game/engine';
import type { Allocation, GameState, Player, Project } from '../game/types';
import { Coin, Meeple } from './Pieces';

const SPACES = Array.from({ length: MAX_WORK }, (_, i) => i + 1);

/** A card currently being dragged along its row, with its live (uncommitted) allocation. */
export interface DragPreview {
  projectId: string;
  alloc: number;
}

interface Props {
  game: GameState;
  player: Player;
  color: string;
  allocation: Allocation;
  dragPreview: DragPreview | null;
  onCardGrab: (projectId: string, e: PointerEvent) => void;
  onComplete: (projectId: string) => void;
  onHire: () => void;
  onRelease: () => void;
}

export function PlayerSide(props: Props) {
  const { game, player: p, color, allocation, dragPreview } = props;
  const active = activeProjects(p);
  // Live allocation: a card being dragged counts at its dragged position.
  const liveAlloc = (id: string) => (dragPreview?.projectId === id ? dragPreview.alloc : (allocation[id] ?? 0));
  const assigned = game.phase === 'allocation' ? active.reduce((sum, pr) => sum + liveAlloc(pr.id), 0) : 0;
  const idle = p.workers - assigned;
  const rows = Math.max(TABLE.fixedLanes, ...active.map((pr) => pr.lane + 1));
  const byLane = new Map(active.map((pr) => [pr.lane, pr]));

  return (
    <section className="side" style={{ '--pc': color, '--spaces': MAX_WORK } as CSSProperties}>
      <div className="workboard">
        <div className="wb-scroll">
          <div className="wb-inner">
            <div className="wb-head">
              <div className="wb-head-label" />
              {SPACES.map((k) => (
                <div key={k} className="wb-head-cell">
                  {k}
                </div>
              ))}
            </div>
            {Array.from({ length: rows }, (_, laneIdx) => {
              const pr = byLane.get(laneIdx);
              if (!pr) {
                return (
                  <div key={`empty${laneIdx}`} className="lane">
                    <Track />
                  </div>
                );
              }
              return (
                <Lane
                  key={pr.id}
                  game={game}
                  color={color}
                  project={pr}
                  assigned={liveAlloc(pr.id)}
                  dragging={dragPreview?.projectId === pr.id}
                  onCardGrab={props.onCardGrab}
                  onComplete={props.onComplete}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="side-aside">
        <div className="plate">
          <div className="plate-name">{p.name}</div>
          <Coin amount={p.money} big />
          <div className="crew-box">
            <div className="crew-row">
              <span>Crew</span>
              <b>{p.workers}</b>
            </div>
            <div className="crew-row">
              <span>Freelancers ({GAME.freelancerSalary}/rd each)</span>
              <span className="row gap-sm">
                <button className="icon" onClick={props.onRelease} disabled={p.hiredWorkers === 0}>
                  −
                </button>
                <b>
                  {p.hiredWorkers}/{GAME.maxFreelancers}
                </b>
                <button className="icon" onClick={props.onHire} disabled={p.hiredWorkers >= GAME.maxFreelancers}>
                  +
                </button>
              </span>
            </div>
          </div>
          <div className="plate-sub">{wagesDue(game, p) > 0 ? `wages −${wagesDue(game, p)} per round` : "shop closed: no wages"}</div>
        </div>

        <div className="pool">
          <div className="pool-title">Idle workers</div>
          <div className="pool-meeples">
            {Array.from({ length: idle }, (_, i) => (
              <span key={i} className="worker">
                <Meeple color={color} size={30} />
              </span>
            ))}
            {idle === 0 && <span className="pool-empty">everyone is on a card</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The player across the table: their board is hidden, only what they'd openly show. */
export function OpponentStrip({
  player: p,
  color,
  onSwitch,
  ai,
}: {
  player: Player;
  color: string;
  /** Omitted when the seat is played by the AI. */
  onSwitch?: () => void;
  ai?: { thinking: boolean };
}) {
  const projects = activeProjects(p).length;
  return (
    <section className="opponent" style={{ '--pc': color } as CSSProperties}>
      <span className="opp-name">
        {p.name}
        {ai && <span className="ai-badge">{ai.thinking ? 'AI · thinking…' : 'AI'}</span>}
      </span>
      <Coin amount={p.money} />
      <span className="opp-facts">
        {p.workers} workers · wages −{payroll(p)}/rd · {projects} project{projects === 1 ? '' : 's'} on board
      </span>
      {onSwitch && (
        <button className="opp-switch" onClick={onSwitch} title="Pass the device: show this player's board at the bottom">
          ⇅ Switch to {p.name}'s seat
        </button>
      )}
    </section>
  );
}

function Lane({
  game,
  color,
  project: pr,
  assigned,
  dragging,
  onCardGrab,
  onComplete,
}: {
  game: GameState;
  color: string;
  project: Project;
  assigned: number;
  dragging: boolean;
  onCardGrab: (projectId: string, e: PointerEvent) => void;
  onComplete: (projectId: string) => void;
}) {
  const ready = isReady(pr);
  const pos = Math.min(pr.completedWork, pr.requiredWork);
  // Only while placing work does the allocation move the card; afterwards it is already in completedWork.
  const moving = game.phase === 'allocation' ? assigned : 0;
  const target = Math.min(pos + moving, pr.requiredWork);
  const fresh = pr.wonRound === game.round && (game.phase === 'bidReveal' || game.phase === 'allocation');
  const { roundsLate, net } = projectedPayout(game, pr);
  const draggable = game.phase === 'allocation' && !ready;

  return (
    <div className="lane">
      <Track required={pr.requiredWork} />
      <div
        className={[
          'pcard',
          roundsLate > 0 ? 'late' : '',
          ready ? 'ready' : '',
          fresh ? 'fresh' : '',
          draggable ? 'draggable' : '',
          dragging ? 'dragging' : '',
        ].join(' ')}
        style={{ '--at': target } as CSSProperties}
        onPointerDown={draggable ? (e) => onCardGrab(pr.id, e) : undefined}
      >
        <div className="pc-head">
          <i className="pc-dot" />
          {pr.tender.name}
        </div>
        <div className="pc-stats">
          <span title="Your winning bid, paid when you complete the card">
            <small>Pays</small> <b>{pr.payout}</b>
          </span>
          <span title="Finish by the end of this round to be on time">
            <small>Due</small> <b>R{pr.dueRound}</b>
          </span>
          <span title="Deducted from the pay again for every round late">
            <small>Late/rd</small> <b>−{pr.latePenalty}</b>
          </span>
        </div>
        {!ready && roundsLate > 0 && (
          <div className="pc-status">
            <span className="st-late">
              {roundsLate} round{roundsLate > 1 ? 's' : ''} late · pays {net} · lost after R{lastPayingRound(pr)}
            </span>
          </div>
        )}
        {ready ? (
          <button className="complete-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => onComplete(pr.id)}>
            Complete ✓ <small>pays {net}</small>
          </button>
        ) : (
          <div className="pc-crew">
            {Array.from({ length: moving }, (_, i) => (
              <span key={i} className="worker">
                <Meeple color={color} size={17} />
              </span>
            ))}
            {draggable && moving === 0 && <span className="pc-idle">drag me forward</span>}
            <span
              className="pc-work"
              title={`Card estimate ${pr.tender.work}, rolled ${pr.workRoll.die}: ${pr.requiredWork} to do`}
            >
              {pos}/{pr.requiredWork}
              {moving > 0 ? ` +${moving}` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** One row of the shared grid. A card overlays it from the left edge; the checkered column is its finish. */
function Track({ required }: { required?: number }) {
  return (
    <div className="track">
      {SPACES.map((k) => (
        <div
          key={k}
          className={['space', required !== undefined && k > required ? 'void' : '', k === required ? 'finish' : ''].join(' ')}
        >
        </div>
      ))}
    </div>
  );
}
