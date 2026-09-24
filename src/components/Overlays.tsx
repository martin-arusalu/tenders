import { useState } from 'react';
import {
  activeProjects,
  bidRange,
  boardFull,
  currentBidder,
  dueRoundIfWon,
  rankings,
  rebidTender,
  workBacklog,
} from '../game/engine';
import type { GameState, Player, Project } from '../game/types';
import { Coin, PLAYER_COLORS, TenderCard } from './Pieces';

export interface BiddingActions {
  showBidEntry: () => void;
  submitBid: (bid: { tenderId: string; amount: number } | null) => void;
  revealBids: () => void;
}

/** Full-screen cover for secret bidding: pass-the-device, or against the AI seats. */
export function BiddingOverlay({
  game,
  aiPlayerIds,
  actions,
}: {
  game: GameState;
  /** Empty in a pass-the-device game. */
  aiPlayerIds: string[];
  actions: BiddingActions;
}) {
  const b = game.bidding!;
  const player = currentBidder(game)!;
  const colorOf = (id: string) => PLAYER_COLORS[game.players.findIndex((p) => p.id === id)];
  const rebidOn = rebidTender(game);
  const rebidBanner = rebidOn && (
    <div className="rebid-banner">
      <b>Tie at {b.cap}</b> on {rebidOn.name}, with the same number of projects. Tie-break rebid {b.rebid}: bid {b.cap}{' '}
      or lower, lowest wins.
    </div>
  );

  let body;
  if (b.stage === 'done') {
    body = (
      <>
        {rebidBanner}
        <h2>All bids recorded.</h2>
        <p className="big-text">
          {aiPlayerIds.length ? 'The sealed bids are on the table.' : 'Put the device back in the middle of the table.'}
        </p>
        <button className="primary big" onClick={actions.revealBids}>
          REVEAL BIDS
        </button>
      </>
    );
  } else if (b.stage === 'handoff' && aiPlayerIds.length) {
    // Against the AI there is no device to pass: the human's form opens automatically.
    body = aiPlayerIds.includes(player.id) ? (
      <>
        {rebidBanner}
        {b.index > 0 && <h2>Bid recorded.</h2>}
        <p className="big-text">
          <b style={{ color: colorOf(player.id) }}>{player.name}</b> is {rebidOn ? 'rebidding' : 'choosing a tender'}
          <span className="dots" />
        </p>
      </>
    ) : null;
  } else if (b.stage === 'handoff') {
    body = (
      <>
        {rebidBanner}
        {b.index > 0 && <h2>Bid recorded.</h2>}
        <p className="big-text">
          PASS THE DEVICE TO <b style={{ color: colorOf(player.id) }}>{player.name}</b>
        </p>
        <p className="muted">
          Bidder {b.index + 1} of {b.order.length}
        </p>
        <button className="primary big" onClick={actions.showBidEntry}>
          I am {player.name}. Continue
        </button>
      </>
    );
  } else {
    body = (
      <>
        {rebidBanner}
        <BidEntry key={`${player.id}-${b.rebid}`} game={game} player={player} onSubmit={actions.submitBid} />
      </>
    );
  }

  return (
    <div className="overlay">
      <div className="overlay-box wide">{body}</div>
    </div>
  );
}

function BidEntry({
  game,
  player,
  onSubmit,
}: {
  game: GameState;
  player: Player;
  onSubmit: (bid: { tenderId: string; amount: number } | null) => void;
}) {
  const rebidOn = rebidTender(game);
  const choices = rebidOn ? [rebidOn] : game.market.map((o) => o.tender);
  const [pickedId, setPickedId] = useState<string | null>(choices.length === 1 ? choices[0].id : null);
  const tender = choices.find((t) => t.id === pickedId) ?? null;
  const range = tender ? bidRange(game, tender) : null;
  /** Starts in the middle of the range whenever a tender is picked. */
  const [value, setValue] = useState(() => (range ? String(Math.round((range.min + range.max) / 2)) : ''));
  const n = Number(value);
  const valid = !!range && value.trim() !== '' && Number.isInteger(n) && n >= range.min && n <= range.max;
  const color = PLAYER_COLORS[game.players.findIndex((p) => p.id === player.id)];
  const backlog = workBacklog(player);
  const full = boardFull(player);
  const canPass = !rebidOn;
  const pick = (id: string) => {
    const t = choices.find((c) => c.id === id)!;
    const r = bidRange(game, t);
    setPickedId(id);
    setValue(String(Math.round((r.min + r.max) / 2)));
  };
  const nudge = (d: number) =>
    range && setValue(String(Math.min(range.max, Math.max(range.min, (valid ? n : range.min) + d))));

  return (
    <form
      className="bid-entry"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && tender) onSubmit({ tenderId: tender.id, amount: n });
      }}
    >
      <h2 style={{ color }}>
        {player.name}: your secret {rebidOn ? 'rebid' : 'bid'}
      </h2>
      <div className="bidder-status">
        Money <b>{player.money}</b> · {activeProjects(player).length} card
        {activeProjects(player).length === 1 ? '' : 's'} on your board · backlog <b>{backlog}</b> work
        {backlog > 0 && ` (~${Math.ceil(backlog / player.workers)} rounds)`}
      </div>

      {full ? (
        <p className="warn">
          Your board is full ({activeProjects(player).length} projects). Finish one before bidding again.
        </p>
      ) : (
        <p className="bid-step">
          {choices.length > 1 ? (
            <>
              <b>1. Pick one tender.</b> The lowest bid on each tender wins it.
            </>
          ) : (
            <>
              <b>{rebidOn ? 'Tie-break rebid.' : 'One tender on the table.'}</b> Lowest bid wins.
            </>
          )}
        </p>
      )}
      <div className="market">
        {choices.map((t) => (
          <TenderCard
            key={t.id}
            tender={t}
            small
            selected={t.id === pickedId}
            onSelect={full ? undefined : () => pick(t.id)}
          />
        ))}
      </div>

      {!full && (
        <div className={`price-panel ${tender ? '' : 'waiting'}`}>
          {tender && range ? (
            <>
              <p className="bid-step">
                <b>{choices.length > 1 ? '2. Your price' : 'Your price'}</b> for {tender.name}
              </p>
              <div className="stepper">
                <button
                  type="button"
                  className="icon big-icon"
                  onClick={() => nudge(-1)}
                  disabled={!valid || n <= range.min}
                  aria-label="Lower"
                >
                  −
                </button>
                <input
                  className="bid-input"
                  type="number"
                  inputMode="numeric"
                  min={range.min}
                  max={range.max}
                  step={1}
                  autoFocus
                  autoComplete="off"
                  aria-label="Your bid"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <button
                  type="button"
                  className="icon big-icon"
                  onClick={() => nudge(1)}
                  disabled={!valid || n >= range.max}
                  aria-label="Higher"
                >
                  +
                </button>
              </div>
              <div className="slider">
                <input
                  className="bid-slider"
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={1}
                  value={valid ? n : range.min}
                  onChange={(e) => setValue(e.target.value)}
                  aria-label="Your bid"
                />
                <div className="slider-ends">
                  <span>{range.min} minimum</span>
                  <span>
                    {range.max} {rebidOn ? 'tied bid' : 'client’s budget'}
                  </span>
                </div>
              </div>
              {!valid && (
                <p className="warn small">
                  Enter a whole number from {range.min} to {range.max}.
                </p>
              )}
              <p className="muted small">
                If you win, it's due by the end of <b>round {dueRoundIfWon(game.round, tender)}</b>. Your crew's wages
                for {tender.work} work are about <b>{tender.work * player.salaryPerWorker}</b>.
              </p>
            </>
          ) : (
            <p className="muted">Pick a tender above to set your price.</p>
          )}
        </div>
      )}

      <div className="bid-actions">
        {canPass && (
          <button type="button" className="big" onClick={() => onSubmit(null)}>
            Pass this round
          </button>
        )}
        {!full && (
          <button type="submit" className="primary big" disabled={!valid}>
            {valid ? `Confirm bid of ${n}` : 'Confirm bid'}
          </button>
        )}
      </div>
    </form>
  );
}

/** The card has been flipped: show what it paid. */
export function CompletionModal({
  player,
  project: c,
  color,
  onClose,
}: {
  player: Player;
  project: Project;
  color: string;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-box flip-box" onClick={(e) => e.stopPropagation()}>
        <div className="flip-card" style={{ borderColor: color }}>
          <div className="flip-head" style={{ background: color }}>
            {c.tender.name}
          </div>
          <div className="flip-title">{c.roundsLate > 0 ? 'Completed late' : 'Completed on time'}</div>
          <div className="flip-when">
            Finished in round {c.completedRound}, due round {c.dueRound}
          </div>
          <table className="flip-lines">
            <tbody>
              <tr>
                <td>Contract payment</td>
                <td className="pos">+{c.payout}</td>
              </tr>
              {c.roundsLate > 0 && (
                <tr>
                  <td>
                    {c.roundsLate} round{c.roundsLate > 1 ? 's' : ''} late × {c.latePenalty}
                  </td>
                  <td className="neg">−{c.penaltyCharged}</td>
                </tr>
              )}
              <tr className="flip-total">
                <td>{player.name} gains</td>
                <td className={c.netPayout < 0 ? 'neg' : 'pos'}>
                  {c.netPayout >= 0 ? '+' : ''}
                  {c.netPayout}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="flip-money">
            <Coin amount={player.money - c.netPayout} /> → <Coin amount={player.money} big />
          </div>
        </div>
        <button className="primary big" autoFocus onClick={onClose}>
          Collect
        </button>
      </div>
    </div>
  );
}

export function GameOverOverlay({
  game,
  onNewGame,
  onSetup,
}: {
  game: GameState;
  onNewGame: () => void;
  onSetup: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const ranked = rankings(game);
  const color = (p: Player) => PLAYER_COLORS[game.players.indexOf(p)];

  if (hidden) {
    return (
      <button className="primary show-results" onClick={() => setHidden(false)}>
        Show final results
      </button>
    );
  }

  const rows: [string, (p: Player) => number | string][] = [
    ['Tenders won', (p) => p.stats.tendersWon],
    ['Total bid value', (p) => p.stats.totalBidValue],
    ['Lowest winning bid', (p) => p.stats.lowestWinningBid ?? '—'],
    ['Contracts completed late', (p) => p.stats.contractsCompletedLate],
    ['Contracts lost (too late)', (p) => p.stats.contractsLost],
    ['Total late penalties paid', (p) => p.stats.latePenaltiesPaid],
    ['Total payroll paid', (p) => p.stats.payrollPaid],
    ['Final money', (p) => p.money],
  ];

  const broke = game.players.filter((p) => p.bankruptRound !== null);
  return (
    <div className="overlay">
      <div className="overlay-box">
        <h2>Final results after {game.round} rounds</h2>
        {broke.length > 0 && (
          <p className="warn big-text">
            {broke.map((p) => `${p.name} went bankrupt in round ${p.bankruptRound}.`).join(' ')}
          </p>
        )}
        <ol className="ranking">
          {ranked.map((p, i) => (
            <li key={p.id} style={{ color: color(p) }}>
              {i === 0 && p.bankruptRound === null && '🏆 '}
              {p.name}: <b>{p.money}</b>
              {p.bankruptRound !== null && ' (bankrupt)'}
            </li>
          ))}
        </ol>
        <div className="table-wrap">
          <table className="stats">
            <thead>
              <tr>
                <th></th>
                {ranked.map((p) => (
                  <th key={p.id} style={{ color: color(p) }}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, fn]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {ranked.map((p) => (
                    <td key={p.id}>{fn(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row gap wrap center">
          <button className="primary big" onClick={onNewGame}>
            New game (same players)
          </button>
          <button className="big" onClick={onSetup}>
            Back to setup
          </button>
          <button className="big" onClick={() => setHidden(true)}>
            View table
          </button>
        </div>
      </div>
    </div>
  );
}
