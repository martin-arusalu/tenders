import { AI, GAME } from '../config';
import {
  activeProjects,
  clearAllocation,
  completeProject,
  dueRoundIfWon,
  hireWorker,
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
 * It predicts which tender each opponent wants most. A tender nobody else is after goes at the
 * client's full budget; a contested one just under what the rival has recently been charging
 * (or their cost), never below our own cost. It picks the best expected margin per unit of work.
 */
export function chooseBid(game: GameState, playerId: string): BidChoice | null {
  const me = game.players.find((x) => x.id === playerId)!;
  if (boardFull(me)) return null;
  const onOffer = game.market.map((o) => o.tender);
  const rivals = game.players
    .filter((x) => x.id !== playerId && !boardFull(x))
    .map((x) => ({ id: x.id, wants: bestFit(game, x.id, onOffer)?.id }));
  let best: (BidChoice & { ev: number }) | null = null;
  for (const t of onOffer) {
    if (!affordable(game, playerId, t)) continue;
    const mine = estimateTender(game, playerId, t).fullCost;
    if (mine > maxBid(t)) continue;
    const contest = rivals.filter((r) => r.wants === t.id);
    let option: BidChoice & { ev: number };
    if (contest.length === 0) {
      option = { tenderId: t.id, amount: maxBid(t), why: 'nobody else wants it', ev: (maxBid(t) - mine) / t.work };
    } else {
      // Undercut what the rival has actually been charging; if they haven't bid yet, their cost.
      // Either way never below our own cost, and never at the full budget (they might bid it too).
      const theirCost = Math.min(...contest.map((r) => estimateTender(game, r.id, t).fullCost));
      const rate = recentRate(game, contest.map((r) => r.id));
      const target = rate === null ? theirCost - 1 : Math.max(theirCost, rate * t.work) - 1;
      const amount = clampBid(t, Math.max(mine, Math.min(target, maxBid(t) - 1)));
      const pWin = amount < theirCost ? 0.9 : 0.5;
      option = { tenderId: t.id, amount, why: 'contested, priced to undercut', ev: (pWin * (amount - mine)) / t.work };
    }
    if (option.ev > 0 && (!best || option.ev > best.ev)) best = option;
  }
  return best && { tenderId: best.tenderId, amount: best.amount, why: best.why };
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
