import { AI, GAME } from '../config';
import {
  activeProjects,
  clearAllocation,
  completeProject,
  dueRoundIfWon,
  hireWorker,
  inGame,
  boardFull,
  clampBid,
  isReady,
  lastPayingRound,
  maxBid,
  minBid,
  rebidTender,
  releaseWorker,
  remainingWork,
  setAllocation,
} from '../game/engine';
import type { GameState, Player, Tender } from '../game/types';

/**
 * Deterministic AI: crew sizing, card placement and completion, plus a
 * fallback bid. The bid itself can be overridden by a BidAdvisor.
 */

interface Job {
  id?: string;
  remaining: number;
  dueRound: number;
  penalty: number;
  /** After this round unfinished, the job is lost (see lastPayingRound). */
  lastPaying: number;
  /** What losing it costs: the payment we'd no longer get. */
  payout: number;
}

function jobsOf(p: Player): Job[] {
  return activeProjects(p)
    .filter((pr) => !isReady(pr))
    .map((pr) => ({
      id: pr.id,
      remaining: remainingWork(pr),
      dueRound: pr.dueRound,
      penalty: pr.latePenalty,
      lastPaying: lastPayingRound(pr),
      payout: pr.payout,
    }));
}

/**
 * One round's crew split: earliest due first, skipping jobs that can't be saved any more
 * (not enough rounds left before they're lost even with the whole crew).
 */
function splitCrew(jobs: Job[], round: number, crew: number): Map<Job, number> {
  const out = new Map<Job, number>();
  const savable = (j: Job) => j.remaining <= crew * (j.lastPaying - round + 1);
  const order = [...jobs].sort(
    (a, b) => Number(savable(b)) - Number(savable(a)) || a.dueRound - b.dueRound || b.penalty - a.penalty,
  );
  let free = crew;
  for (const j of order) {
    const n = savable(j) ? Math.min(free, j.remaining) : 0;
    if (n > 0) out.set(j, n);
    free -= n;
  }
  return out;
}

/** Work the jobs with a fixed crew from this round on. Cost = late penalties + payments lost. */
function simulate(jobs: Job[], round: number, crew: number): { penalty: number; lastRound: number } {
  let left = jobs.map((j) => ({ ...j }));
  let penalty = 0;
  let r = round;
  while (left.length > 0 && r < round + 100) {
    for (const [j, n] of splitCrew(left, r, crew)) j.remaining -= n;
    left = left.filter((j) => {
      if (j.remaining === 0) penalty += Math.max(0, r - j.dueRound) * j.penalty;
      else if (r >= j.lastPaying) penalty += j.payout;
      else return true;
      return false;
    });
    r++;
  }
  return { penalty, lastRound: left.length === 0 ? r - 1 : Infinity };
}

export interface CrewPlan {
  hires: number;
  /** Freelancer wages + late penalties, excluding the base crew's wages (paid regardless). */
  cost: number;
  lastRound: number;
}

/** Cheapest number of freelancers for a set of jobs. */
export function planCrew(jobs: Job[], round: number, baseWorkers: number): CrewPlan {
  let best: CrewPlan | null = null;
  for (let h = 0; h <= GAME.maxFreelancers; h++) {
    const sim = simulate(jobs, round, baseWorkers + h);
    const rounds = Math.max(0, sim.lastRound - round + 1);
    const cost = sim.penalty + h * GAME.freelancerSalary * rounds;
    if (!best || cost < best.cost) best = { hires: h, cost, lastRound: sim.lastRound };
  }
  return best!;
}

export function estimateTender(game: GameState, playerId: string, tender: Tender) {
  const p = game.players.find((x) => x.id === playerId)!;
  const base = p.workers - p.hiredWorkers;
  const jobs = jobsOf(p);
  const without = planCrew(jobs, game.round, base);
  // The real payment is whatever we bid; price it at our usual rate for the lost-job check.
  const payout = Math.max(minBid(tender), (p.salaryPerWorker + AI.marginPerWork) * tender.work);
  const due = dueRoundIfWon(game.round, tender);
  const withIt = planCrew(
    [
      ...jobs,
      { remaining: tender.work, dueRound: due, penalty: tender.penalty, payout, lastPaying: due + Math.ceil(payout / tender.penalty) - 1 },
    ],
    game.round,
    base,
  );
  const costIfWin = withIt.cost - without.cost;
  const idle = jobs.length === 0;
  // Price the base crew's time too: it's paid anyway, but only contracts pay it back.
  const perWork = p.salaryPerWorker + (idle ? AI.idleMarginPerWork : AI.marginPerWork);
  return {
    costIfWin,
    /** Base wages for the work plus the extra cost: the least worth bidding. */
    fullCost: costIfWin + GAME.salaryPerWorker * tender.work,
    freelancersIfWin: withIt.hires,
    busyUntilRoundIfWin: withIt.lastRound,
    costPlusBid: clampBid(tender, Math.ceil(costIfWin + perWork * tender.work)),
  };
}

/** The tender a player would most like: best margin per unit of work at the client's budget. */
export function bestFit(game: GameState, playerId: string, tenders: Tender[]): Tender | null {
  let best: Tender | null = null;
  let score = 0;
  for (const t of tenders) {
    const margin = (maxBid(t) - estimateTender(game, playerId, t).fullCost) / t.work;
    if (margin > score) [best, score] = [t, margin];
  }
  return best;
}

/**
 * Cash check: the freelancers a job would need, paid until the next contract pays out, must not
 * take us below zero. Base wages are paid either way, so a job needing no extra hands is always
 * affordable (and when cash is short, work is the only way out).
 */
export function affordable(game: GameState, playerId: string, t: Tender): boolean {
  const p = game.players.find((x) => x.id === playerId)!;
  const est = estimateTender(game, playerId, t);
  if (est.freelancersIfWin <= p.hiredWorkers) return true;
  const dues = [...activeProjects(p).map((pr) => pr.dueRound), dueRoundIfWon(game.round, t)];
  const rounds = Math.max(1, Math.min(...dues) - game.round + 1);
  const base = (p.workers - p.hiredWorkers) * p.salaryPerWorker;
  return p.money - (base + est.freelancersIfWin * GAME.freelancerSalary) * rounds >= 0;
}

export interface BidChoice {
  tenderId: string;
  amount: number;
  /** Short note on why, for the AI's reasoning line. */
  why: string;
}

/**
 * The rules bot (the AI's fallback, and its suggestion to the LLM): reads the table.
 *
 * The client's full budget only wins when nobody else bids on that tender (or everyone else bids
 * the full budget too, a tie). So for each tender it estimates how likely each rival is to go for
 * it and at what price, and picks the price with the best expected profit: win chance × margin.
 * A rival we expect to want the tender bids somewhere between its cost and the budget; one we
 * don't expect still might (AI.rivalSurpriseChance).
 *
 * Then it mixes: the tender is drawn in proportion to expected profit, and the price from the
 * near-best ones. Two bots with the same view would otherwise make the same choice every round
 * and always collide, and a human could learn to predict it.
 */
export function chooseBid(game: GameState, playerId: string, rng: () => number = Math.random): BidChoice | null {
  const me = game.players.find((x) => x.id === playerId)!;
  if (boardFull(me)) return null;
  const onOffer = game.market.map((o) => o.tender);
  const rivals = game.players
    .filter((x) => x.id !== playerId && inGame(x) && !boardFull(x))
    .map((x) => ({ id: x.id, wants: bestFit(game, x.id, onOffer)?.id }));
  /** Each rival's recent price per work: we expect about that again, give or take half a unit. */
  const rates = new Map(rivals.map((r) => [r.id, recentRate(game, [r.id])]));

  const options: (BidChoice & { ev: number; prices: { amount: number; ev: number }[] })[] = [];
  for (const t of onOffer) {
    if (!affordable(game, playerId, t)) continue;
    const mine = estimateTender(game, playerId, t).fullCost;
    if (mine > maxBid(t)) continue;
    if (rivals.length === 0) {
      // Nobody else can bid this round: the full budget is a sure win.
      const ev = maxBid(t) - mine;
      if (ev > 0) options.push({ tenderId: t.id, amount: maxBid(t), why: 'nobody else can bid', ev, prices: [{ amount: maxBid(t), ev }] });
      continue;
    }
    // Each rival: the chance it bids on t, and the price range it's likely to bid in. Before it has
    // bid at all, anything from its cost to the budget; after, around its own recent price.
    const threats = rivals.map((r) => {
      const cost = estimateTender(game, r.id, t).fullCost;
      const rate = rates.get(r.id);
      const lo = clampBid(t, rate == null ? cost : Math.min(cost, Math.floor((rate - 0.5) * t.work)));
      const hi = Math.max(lo, rate == null ? maxBid(t) : clampBid(t, Math.ceil((rate + 0.5) * t.work)));
      const p = r.wants === t.id ? 1 - AI.rivalSurpriseChance : AI.rivalSurpriseChance / Math.max(1, onOffer.length - 1);
      return { p, lo, hi };
    });
    const prices: { amount: number; ev: number }[] = [];
    // Never the full budget while a rival can bid: it only wins if nobody else bids on this tender,
    // and one below it wins every such case too, plus any where a rival also bids the budget.
    for (let amount = Math.max(minBid(t), mine); amount < maxBid(t); amount++) {
      // A rival's price is spread evenly over its range; a tie counts as half a win.
      const pWin = threats.reduce((acc, { p, lo, hi }) => {
        const span = hi - lo + 1;
        const below = Math.min(span, Math.max(0, amount - lo)) / span;
        const equal = amount >= lo && amount <= hi ? 1 / span : 0;
        return acc * (1 - p * (below + equal / 2));
      }, 1);
      prices.push({ amount, ev: pWin * (amount - mine) });
    }
    const top = prices.reduce((a, b) => (b.ev > a.ev ? b : a), prices[0]);
    if (top && top.ev > 0) {
      const contested = threats.some((x) => x.p >= 0.5);
      options.push({ tenderId: t.id, amount: top.amount, why: contested ? 'contested, priced to undercut' : 'probably ours, but others might bid', ev: top.ev, prices });
    }
  }
  if (options.length === 0) return null;

  // Mix: a tender in proportion to expected profit, then any price close to its best.
  const pick = weighted(options, (o) => o.ev, rng);
  const good = pick.prices.filter((x) => x.ev >= pick.ev * AI.priceSpread);
  const amount = weighted(good, (x) => x.ev, rng).amount;
  return { tenderId: pick.tenderId, amount, why: pick.why };
}

/** Draw one item with probability proportional to weight. */
function weighted<T>(items: T[], weight: (x: T) => number, rng: () => number): T {
  const total = items.reduce((s, x) => s + Math.max(0, weight(x)), 0);
  let r = rng() * total;
  for (const x of items) {
    r -= Math.max(0, weight(x));
    if (r < 0) return x;
  }
  return items[items.length - 1];
}

/** Average price per unit of work these players bid over their last few auctions, or null if none yet. */
function recentRate(game: GameState, playerIds: string[]): number | null {
  const seen = game.auctions
    .slice(-8)
    .flatMap((a) => a.bids.filter((b) => playerIds.includes(b.playerId) && b.amount !== null).map((b) => b.amount! / a.tender.work));
  return seen.length ? seen.reduce((x, y) => x + y, 0) / seen.length : null;
}

/** Tie-break rebid: one below the tied amount if that still covers our cost, otherwise hold. */
export function rebidAmount(game: GameState, playerId: string): number {
  const t = rebidTender(game)!;
  const cap = game.bidding!.cap!;
  const cost = estimateTender(game, playerId, t).fullCost;
  return Math.max(minBid(t), cap - 1 >= cost ? cap - 1 : cap);
}

/** Start of the placement phase: size the crew for the current board, then place every card. */
export function playAllocation(game: GameState, playerId: string): GameState {
  const p = game.players.find((x) => x.id === playerId)!;
  const target = planCrew(jobsOf(p), game.round, p.workers - p.hiredWorkers).hires;
  let s = clearAllocation(game, playerId);
  for (let i = p.hiredWorkers; i < target; i++) s = hireWorker(s, playerId);
  for (let i = p.hiredWorkers; i > target; i--) s = releaseWorker(s, playerId);
  const crew = s.players.find((x) => x.id === playerId)!.workers;
  for (const [j, n] of splitCrew(jobsOf(p), game.round, crew)) s = setAllocation(s, playerId, j.id!, n);
  return s;
}

/** Flip every card that reached the finish line. */
export function completeReady(game: GameState, playerId: string): GameState {
  const p = game.players.find((x) => x.id === playerId)!;
  return activeProjects(p)
    .filter(isReady)
    .reduce((s, pr) => completeProject(s, playerId, pr.id), game);
}
