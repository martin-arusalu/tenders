import type { CSSProperties } from 'react';
import { isGameFinished, pendingFlips } from '../game/engine';
import type { AuctionResult, GameState } from '../game/types';
import { DeckPile, PLAYER_COLORS, TenderCard, TenderMini, WorkRollBadge } from './Pieces';

export interface TableActions {
  beginBidding: () => void;
  proceedToAllocation: () => void;
  resolveRound: () => void;
  nextRound: () => void;
}

const STEPS = ['Tenders', 'Secret bids', 'Place workers', 'Work & wages'];
const STEP_OF: Record<GameState['phase'], number> = {
  tenderReveal: 0,
  bidding: 1,
  bidReveal: 1,
  allocation: 2,
  roundSummary: 3,
  gameOver: 3,
};

/** An AI's comment on its own bid, shown at the reveal. */
export interface AiNote {
  playerId: string;
  reasoning: string;
  source: string;
}

const TIE_NOTE: Record<NonNullable<AuctionResult['tieBreak']>, string> = {
  fewerProjects: 'tie: fewer projects wins',
  rebid: 'after a tie-break rebid',
  random: 'tie that couldn’t go lower: coin flip',
};

export function TableCenter({ game, actions, aiNotes = [] }: { game: GameState; actions: TableActions; aiNotes?: AiNote[] }) {
  const colorOf = (id: string) => PLAYER_COLORS[game.players.findIndex((p) => p.id === id)];
  const nameOf = (id: string) => game.players.find((p) => p.id === id)!.name;
  const step = STEP_OF[game.phase];
  const biddingOpen = game.phase === 'tenderReveal' || game.phase === 'bidding';
  // After the auctions: what will be on the table next round (unclaimed leftovers + new cards, face up).
  const nextRound = biddingOpen || game.phase === 'gameOver' ? [] : [
    ...game.market.map((o) => ({ tender: o.tender, again: true })),
    ...game.deck.slice(0, Math.max(0, game.tendersPerRound - game.market.length)).map((t) => ({ tender: t, again: false })),
  ];

  return (
    <div className="center">
      <div className="center-left">
        <DeckPile count={game.deck.length} dealt={game.tendersDealt} total={game.tendersPerGame} />
        {nextRound.length > 0 && (
          <div className="next-up">
            <span className="next-up-label">Next round</span>
            {nextRound.map(({ tender, again }) => (
              <TenderMini key={tender.id} tender={tender} note={again ? 'still on offer' : undefined} />
            ))}
          </div>
        )}
        <div className="stage">{renderStage()}</div>
      </div>
      <div className="round-disc" style={{ '--p': (step + 1) / STEPS.length } as CSSProperties}>
        <div className="round-inner">
          <small>Round</small>
          <b>{game.round}</b>
          <span>{STEPS[step]}</span>
        </div>
      </div>
      <div className="control">
        <div className="control-body">
          <div className="steps">
            {STEPS.map((s, i) => (
              <span key={s} className={i === step ? 'on' : i < step ? 'past' : ''}>
                {s}
              </span>
            ))}
          </div>
          {renderControl()}
        </div>
      </div>
    </div>
  );

  function renderStage() {
    switch (game.phase) {
      case 'tenderReveal':
      case 'bidding':
        return (
          <div className="market">
            {game.market.map((o) => (
              <TenderCard key={o.tender.id} tender={o.tender} small note={o.age > 1 ? 'Second round on offer' : undefined} />
            ))}
          </div>
        );
      case 'bidReveal':
        return (
          <div className="reveal">
            <div className="market">
              {game.lastAuctions.map((a) => (
                <div key={a.tender.id} className="auction">
                  <TenderCard tender={a.tender} small />
                  <div className="bid-reveal">
                    {a.bids.map((b) => (
                      <div
                        key={b.playerId}
                        className={`bid-card ${b.playerId === a.winnerId ? 'winner' : ''}`}
                        style={{ borderColor: colorOf(b.playerId) }}
                      >
                        <span className="bid-owner" style={{ background: colorOf(b.playerId) }}>
                          {nameOf(b.playerId)}
                        </span>
                        <span className="bid-amount">{b.amount}</span>
                      </div>
                    ))}
                  </div>
                  {a.rebids.length > 0 && (
                    <div className="roll-row">
                      Rebids:{' '}
                      {a.rebids.map((pass, i) => (
                        <span key={i} className="rebid-pass">
                          {pass.map((b) => `${nameOf(b.playerId)} ${b.amount}`).join(' · ')}
                        </span>
                      ))}
                    </div>
                  )}
                  {a.workRoll && (
                    <div className="roll-row">
                      <WorkRollBadge roll={a.workRoll} estimate={a.tender.work} />
                    </div>
                  )}
                </div>
              ))}
              {game.lastAuctions.length === 0 && <p className="stage-note">Nobody bid this round.</p>}
            </div>
            {game.players
              .filter((p) => p.bankruptRound === null && !game.lastAuctions.some((a) => a.bids.some((b) => b.playerId === p.id)))
              .map((p) => (
                <p key={p.id} className="stage-note">
                  {p.name} passed.
                </p>
              ))}
            {aiNotes
              .filter((n) => n.reasoning)
              .map((n) => (
                <p key={n.playerId} className="ai-note" style={{ borderColor: colorOf(n.playerId) }}>
                  “{n.reasoning}”
                  <small>
                    {nameOf(n.playerId)} · {n.source === 'rules' ? 'built-in rules' : n.source}
                  </small>
                </p>
              ))}
          </div>
        );
      case 'allocation':
        return (
          <p className="stage-note">
            {game.lastAuctions.length > 0
              ? game.lastAuctions.map((a) => `${nameOf(a.winnerId!)} took ${a.tender.name}.`).join(' ')
              : game.market.length > 0 || game.deck.length > 0
                ? 'Nobody took a tender this round.'
                : 'No tenders left. Finish your cards.'}
          </p>
        );
      case 'roundSummary':
        return (
          <div className="wages">
            {game.players.map((p, i) => {
              if (p.bankruptRound !== null) return null;
              const paid = -(game.roundReport.find((x) => x.playerId === p.id)?.wagesPaid ?? 0);
              return (
                <div key={p.id} className="wage-chip" style={{ borderColor: PLAYER_COLORS[i] }}>
                  {p.name} paid wages <b className="neg">{paid}</b>
                </div>
              );
            })}
          </div>
        );
      case 'gameOver':
        return <p className="stage-note">Game over</p>;
    }
  }

  function renderControl() {
    switch (game.phase) {
      case 'tenderReveal':
        return (
          <>
            <p>
              {game.market.length > 1
                ? `${game.market.length} tenders are on the table. Pick at most one, name your price, and bid in secret.`
                : 'One tender is on the table. Name your price and bid in secret, or pass.'}
            </p>
            <button className="primary big" onClick={actions.beginBidding}>
              Start secret bidding
            </button>
          </>
        );
      case 'bidding':
        return <p>Secret bidding in progress…</p>;
      case 'bidReveal':
        return (
          <>
            {game.lastAuctions.length === 0 && <p>Nobody bid.</p>}
            {game.lastAuctions.map((a) => (
              <p key={a.tender.id}>
                <b style={{ color: colorOf(a.winnerId!) }}>{nameOf(a.winnerId!)}</b> wins {a.tender.name} at <b>{a.winningBid}</b>
                {a.bids.length === 1 ? ', unopposed' : ''}
                {a.tieBreak && ` (${TIE_NOTE[a.tieBreak]})`}.
              </p>
            ))}
            {game.market.length > 0 && (
              <p className="muted small">
                Unclaimed: {game.market.map((o) => o.tender.name).join(', ')}. {game.market.length > 1 ? 'They stay' : 'It stays'} on
                the table next round.
              </p>
            )}
            <button className="primary big" onClick={actions.proceedToAllocation}>
              Place workers
            </button>
          </>
        );
      case 'allocation':
        return (
          <>
            <p>Drag your cards forward along their rows. Each space costs one worker from your idle pool.</p>
            <button className="primary big" onClick={actions.resolveRound}>
              Do the work &amp; pay wages
            </button>
          </>
        );
      case 'roundSummary': {
        const waiting = pendingFlips(game).length;
        return (
          <>
            <p>{waiting > 0 ? `${waiting} card${waiting > 1 ? 's' : ''} reached the finish. Press Complete on them to get paid.` : 'Round over.'}</p>
            <button className="primary big" onClick={actions.nextRound} disabled={waiting > 0}>
              {isGameFinished(game) ? 'Final results' : `Start round ${game.round + 1}`}
            </button>
          </>
        );
      }
      case 'gameOver':
        return null;
    }
  }
}
