import * as E from '../game/engine';
import type { GameState, Tender } from '../game/types';
import { affordable, bestFit, chooseBid, completeReady, estimateTender, playAllocation, rebidAmount } from './planner';

/** A sealed bid for headless games: one tender on the table and a price, or null to pass. */
export type BidStrategy = (game: GameState, playerId: string, rng: () => number) => { tenderId: string; amount: number } | null;

export interface Strategy {
  label: string;
  bid: BidStrategy;
  /** Never works its contracts (lets them be lost). Everyone else uses the planner. */
  lazy?: boolean;
}

/** Tenders on the table this player could take on without running out of cash. */
const openTenders = (g: GameState, id: string) => g.market.map((o) => o.tender).filter((t) => affordable(g, id, t));
const cost = (g: GameState, id: string, t: Tender) => estimateTender(g, id, t).fullCost;

/** Bid on our best-fit tender at a price from `price`. */
const onBestFit =
  (price: (g: GameState, id: string, t: Tender) => number): BidStrategy =>
  (g, id) => {
    const t = bestFit(g, id, openTenders(g, id));
    return t && { tenderId: t.id, amount: price(g, id, t) };
  };

/** Opponents' average price per unit of work over their recent bids. */
function marketRate(g: GameState, id: string): number | null {
  const seen = g.auctions
    .slice(-8)
    .flatMap((a) => a.bids.filter((b) => b.playerId !== id && b.amount !== null).map((b) => b.amount! / a.tender.work));
  return seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : null;
}

export const STRATEGIES: Record<string, Strategy> = {
  rules: {
    label: 'Rules bot, the AI fallback: predicts your pick, charges the budget on the other tender, undercuts on a shared one',
    bid: (g, id) => chooseBid(g, id),
  },
  mixed: {
    label: "Rules bot, but 30% of the time takes the tender it didn't pick, at budget (unpredictable)",
    bid: (g, id, rng) => {
      const pick = chooseBid(g, id);
      const other = g.market.find((o) => o.tender.id !== pick?.tenderId)?.tender;
      if (pick && other && rng() < 0.3 && affordable(g, id, other) && cost(g, id, other) <= E.maxBid(other)) {
        return { tenderId: other.id, amount: E.maxBid(other) };
      }
      return pick;
    },
  },
  adaptive: {
    label: "Best fit, undercuts the opponent's recent price per work (the old AI)",
    bid: onBestFit((g, id, t) => {
      const rate = marketRate(g, id);
      return Math.max(cost(g, id, t), rate === null ? cost(g, id, t) + t.work : rate * t.work - 1);
    }),
  },
  costplus: {
    label: 'Best fit, own cost + 1 per work, ignores the opponent',
    bid: onBestFit((g, id, t) => cost(g, id, t) + t.work),
  },
  budget: {
    label: "Best fit, always the client's full budget",
    bid: onBestFit((_, __, t) => E.maxBid(t)),
  },
  sniper: {
    label: "Bids on the opponent's likely pick, just under the budget",
    bid: (g, id, rng) => {
      const opp = g.players.find((p) => p.id !== id)!;
      const t = bestFit(g, opp.id, g.market.map((o) => o.tender));
      if (t && affordable(g, id, t) && cost(g, id, t) <= E.maxBid(t) - 1) return { tenderId: t.id, amount: E.maxBid(t) - 1 };
      return STRATEGIES.budget.bid(g, id, rng);
    },
  },
  hoarder: {
    label: 'Best fit, always the minimum bid',
    bid: onBestFit((_, __, t) => E.minBid(t)),
  },
  random: {
    label: 'A random tender at the full budget (pure guessing)',
    bid: (g, id, rng) => {
      const ok = openTenders(g, id).filter((t) => cost(g, id, t) <= E.maxBid(t));
      const t = ok[Math.floor(rng() * ok.length)];
      return t ? { tenderId: t.id, amount: E.maxBid(t) } : null;
    },
  },
  squatter: {
    label: 'Wins at the minimum, never works (lets jobs be lost to block the opponent)',
    bid: (g) => (g.market[0] ? { tenderId: g.market[0].tender.id, amount: E.minBid(g.market[0].tender) } : null),
    lazy: true,
  },
  pass: { label: 'Never bids', bid: () => null },
};

export interface GameStats {
  final: GameState;
  /** Lowest money each player hit at the end of any round. */
  lowestMoney: number[];
}

function mulberry(seed: number) {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A whole game with no UI, through the same engine actions the app uses.
 * Crew, card placement, completion and tie-break rebids come from the planner; only the
 * sealed bids differ per seat.
 */
export function playHeadless(seed: number, seats: (BidStrategy | Strategy)[], maxRounds = 500): GameStats {
  const strategies = seats.map((x) => (typeof x === 'function' ? { label: '', bid: x } : x));
  const rng = mulberry(seed * 7919);
  let g = E.createGame(
    strategies.map((_, i) => `Seat ${i + 1}`),
    seed,
  );
  const lowestMoney = g.players.map((p) => p.money);
  while (g.phase !== 'gameOver' && g.round <= maxRounds) {
    if (g.phase === 'tenderReveal') {
      const bids = g.players.map((p, i) => {
        if (E.boardFull(p)) return null;
        const b = strategies[i].bid(g, p.id, rng);
        const t = b && E.offeredTender(g, b.tenderId);
        return t ? { tenderId: t.id, amount: E.clampBid(t, b!.amount) } : null;
      });
      g = E.beginBidding(g);
      for (const b of bids) g = E.submitBid(E.showBidEntry(g), b);
      g = E.revealBids(g);
      while (g.phase === 'bidding') {
        while (g.bidding!.stage !== 'done') {
          const id = E.currentBidder(g)!.id;
          g = E.submitBid(E.showBidEntry(g), { tenderId: g.bidding!.rebidTenderId!, amount: rebidAmount(g, id) });
        }
        g = E.revealBids(g);
      }
      g = E.proceedToAllocation(g);
    }
    g.players.forEach((p, i) => {
      if (!strategies[i].lazy) g = playAllocation(g, p.id);
    });
    g = E.resolveRound(g);
    g.players.forEach((p, i) => (lowestMoney[i] = Math.min(lowestMoney[i], p.money)));
    for (const p of g.players) g = completeReady(g, p.id);
    g = E.nextRound(g);
  }
  return { final: g, lowestMoney };
}
