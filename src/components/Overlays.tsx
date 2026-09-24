import { useState } from 'react';
import { activeProjects, bidRange, boardFull, currentBidder, dueRoundIfWon, rankings, rebidTender, workBacklog } from '../game/engine';
import type { GameState, Player, Project } from '../game/types';
import { Coin, PLAYER_COLORS, TenderCard } from './Pieces';

export interface BiddingActions {
  showBidEntry: () => void;
  submitBid: (bid: { tenderId: string; amount: number } | null) => void;
  revealBids: () => void;
}

/** Full-screen cover for secret bidding: pass-the-device, or against the AI seat. */
export function BiddingOverlay({
  game,
  aiPlayerId,
  actions,
}: {
  game: GameState;
  aiPlayerId: string | null;
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
          {aiPlayerId ? 'The sealed bids are on the table.' : 'Put the device back in the middle of the table.'}
        </p>
        <button className="primary big" onClick={actions.revealBids}>
          REVEAL BIDS
        </button>
      </>
    );
  } else if (b.stage === 'handoff' && aiPlayerId) {
    // Against the AI there is no device to pass: the human's form opens automatically.
    body =
      player.id === aiPlayerId ? (
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
  const [value, setValue] = useState('');
  const tender = choices.find((t) => t.id === pickedId) ?? null;
  const range = tender ? bidRange(game, tender) : null;
  const n = Number(value);
  const valid = !!range && value.trim() !== '' && Number.isInteger(n) && n >= range.min && n <= range.max;
  const color = PLAYER_COLORS[game.players.findIndex((p) => p.id === player.id)];
  const backlog = workBacklog(player);
  const full = boardFull(player);
  const canPass = !rebidOn;

  return (
    <>
      <h2 style={{ color }}>
        {player.name}: your secret {rebidOn ? 'rebid' : 'bid'}
      </h2>
      <div className="bidder-status">
        Money <b>{player.money}</b> · {activeProjects(player).length} cards on your board · backlog <b>{backlog}</b> work (~
        {Math.ceil(backlog / player.workers)} rounds)
      </div>
      {full ? (
        <p className="warn">
          Your board is full ({activeProjects(player).length} projects). Finish one before bidding again.
        </p>
      ) : (
        <p>
          {choices.length > 1 ? (
            <>
              <b>Pick one tender</b> to bid on. The lowest bid on each tender wins it.
            </>
          ) : (
            <>
              What price will you do it for? <b>Lowest bid wins.</b>
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
            onSelect={full ? undefined : () => setPickedId(t.id)}
          />
        ))}
      </div>
      {tender && !full && (
        <p className="muted small">
          {tender.name}: if you win it, it's due <b>R{dueRoundIfWon(game.round, tender)}</b>. Bid between {range!.min} and{' '}
          {range!.max}
          {rebidOn ? '' : ' (the client’s budget)'}.
        </p>
      )}
      <form
        className="row gap wrap center"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && tender) onSubmit({ tenderId: tender.id, amount: n });
        }}
      >
        {!full && (
          <>
            <input
              className="bid-input"
              type="number"
              inputMode="numeric"
              min={range?.min}
              max={range?.max}
              step={1}
              autoFocus
              autoComplete="off"
              placeholder={tender ? 'Bid' : 'Pick a tender'}
              disabled={!tender}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <button type="submit" className="primary big" disabled={!valid}>
              Confirm bid
            </button>
          </>
        )}
        {canPass && (
          <button type="button" className="big" onClick={() => onSubmit(null)}>
            Pass
          </button>
        )}
      </form>
    </>
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
            {broke.map((p) => p.name).join(' & ')} went bankrupt in round {broke[0].bankruptRound}.
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
