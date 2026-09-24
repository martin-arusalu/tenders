import { TABLE } from '../config';
import { maxBid, minBid } from '../game/engine';
import type { Tender, WorkRoll } from '../game/types';

/** Index 0 is you (bottom of the table), index 1 the opponent across from you. */
export const PLAYER_COLORS = TABLE.playerColors;

export function Meeple({ color, size = 18, ghost }: { color: string; size?: number; ghost?: boolean }) {
  return (
    <svg className="meeple" width={size} height={size * 1.1} viewBox="0 0 20 22" aria-hidden>
      <g fill={ghost ? 'none' : color} stroke={ghost ? color : 'none'} strokeWidth={ghost ? 1.5 : 0}>
        <circle cx="10" cy="5" r="4" />
        <path d="M3 21 L6.5 13 L1 11.5 Q1 8 5 8 L15 8 Q19 8 19 11.5 L13.5 13 L17 21 Z" />
      </g>
    </svg>
  );
}

export function Coin({ amount, big }: { amount: number; big?: boolean }) {
  return <span className={`coin ${amount < 0 ? 'neg' : ''} ${big ? 'big' : ''}`}>{amount}</span>;
}

/** Face-up tender card, as drawn from the deck. Clickable when onSelect is given (choosing which tender to bid on). */
export function TenderCard({
  tender: t,
  small,
  note,
  selected,
  onSelect,
}: {
  tender: Tender;
  small?: boolean;
  /** A short ribbon, e.g. "Second round on offer". */
  note?: string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <div className="tc-band">Tender{note && <span className="tc-note">{note}</span>}</div>
      <div className="tc-name">{t.name}</div>
      <div className="tc-stats">
        <div>
          <span className="tc-value">{t.work}</span>
          <span className="tc-label">est. work</span>
        </div>
        <div>
          <span className="tc-value">{t.deadline}</span>
          <span className="tc-label">round{t.deadline > 1 ? 's' : ''} to finish</span>
        </div>
        <div>
          <span className="tc-value">−{t.penalty}</span>
          <span className="tc-label">each round late</span>
        </div>
      </div>
      <div className="tc-range">
        Bids {minBid(t)}–{maxBid(t)}
      </div>
    </>
  );
  const cls = `tender-card ${small ? 'small' : ''} ${selected ? 'selected' : ''}`;
  return onSelect ? (
    <button type="button" className={`${cls} selectable`} aria-pressed={selected} onClick={onSelect}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** One-line tender, for the "next round" preview. */
export function TenderMini({ tender: t, note }: { tender: Tender; note?: string }) {
  return (
    <div className="tender-mini" title={`${t.name}: ${t.work} work, ${t.deadline} rounds, −${t.penalty} per late round`}>
      <b>{t.name}</b>
      <span>
        {t.work} work · {t.deadline} rd{t.deadline > 1 ? 's' : ''} · −{t.penalty}/rd
      </span>
      {note && <em>{note}</em>}
    </div>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
const DIE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/** The roll made on winning a tender: how far off the estimate was. */
export function WorkRollBadge({ roll, estimate }: { roll: WorkRoll; estimate: number }) {
  return (
    <div className={`work-roll ${roll.delta > 0 ? 'bad' : roll.delta < 0 ? 'good' : ''}`}>
      <span className="die" aria-label={`rolled ${roll.die}`}>
        {DIE_FACES[roll.die - 1]}
      </span>
      <span>
        {roll.delta === 0 ? 'Estimate was right' : `${signed(roll.delta)} work`}: <b>{estimate + roll.delta}</b> to do
      </span>
    </div>
  );
}

export function DeckPile({ count, dealt, total }: { count: number; dealt: number; total: number }) {
  return (
    <div className="deck">
      <div className="deck-pile" title={`${count} tenders left`}>
        {count > 0 ? (
          Array.from({ length: Math.min(count, 4) }, (_, i) => (
            <div key={i} className="card-back" style={{ top: -i * 3, left: i * 2 }} />
          ))
        ) : (
          <div className="deck-empty">Empty</div>
        )}
      </div>
      <div className="deck-label">
        Tender {dealt} of {total}
      </div>
    </div>
  );
}
