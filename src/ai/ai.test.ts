import { describe, expect, it } from 'vitest';
import { AI, GAME } from '../config';
import * as E from '../game/engine';
import type { GameState, Tender } from '../game/types';
import { chooseBid, estimateTender, planCrew } from './planner';
import { parseBidDecision } from './prompt';
import { STRATEGIES, playHeadless } from './selfPlay';
import { buildView } from './view';

/** A planner job; lost once penalties would eat the payout. */
const job = (remaining: number, dueRound: number, penalty: number, payout = 1000) => ({
  remaining,
  dueRound,
  penalty,
  payout,
  lastPaying: dueRound + Math.ceil(payout / penalty) - 1,
});

describe('planCrew', () => {
  it('hires nobody when the base crew finishes on time', () => {
    expect(planCrew([job(5, 2, 10)], 1, 5)).toMatchObject({ hires: 0, cost: 0, lastRound: 1 });
  });

  it('takes on freelancers when late penalties cost more than their wages', () => {
    // Work due this round that the base crew can't finish: one round late costs 100.
    const max = GAME.maxFreelancers;
    const plan = planCrew([job(5 + max, 1, 100)], 1, 5);
    expect(plan.hires).toBe(max);
    expect(plan.cost).toBe(max * GAME.freelancerSalary);
  });

  it('accepts lateness when hiring costs more', () => {
    expect(planCrew([job(10, 1, 1)], 1, 5).hires).toBe(0);
  });

  it('counts a job it cannot save as losing its payment, and spends no crew on it', () => {
    // 50 work, lost after round 2: hopeless even with every freelancer. The other job still gets done.
    const plan = planCrew([job(50, 1, 10, 20), job(5, 3, 1)], 1, 5);
    expect(plan.hires).toBe(0);
    expect(plan.cost).toBe(20);
    expect(plan.lastRound).toBe(2); // lost at the end of round 2; the small job was finished in round 1
  });
});

describe('estimateTender', () => {
  it('prices an easy job at base wages plus the idle margin, never below the reserve', () => {
    const g = E.createGame(['A', 'B'], 1);
    const tender = { id: 'x', name: 'x', work: 5, deadline: 2, penalty: 5 };
    const est = estimateTender(g, 'P2', tender);
    expect(est.costIfWin).toBe(0);
    expect(est.fullCost).toBe(5 * GAME.salaryPerWorker);
    expect(est.costPlusBid).toBe(E.clampBid(tender, Math.ceil(5 * (GAME.salaryPerWorker + AI.idleMarginPerWork))));
  });
});

/** Seeded random numbers, so tests of the rules bot's mixing are repeatable. */
function mulberry(seed: number) {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everyone's sealed bid on the first tender on the table (null = pass). */
function bidFirst(g: GameState, amounts: ((t: Tender) => number | null)[]): GameState {
  const t = g.market[0].tender;
  g = E.beginBidding(g);
  for (const a of amounts) {
    const amount = a(t);
    g = E.submitBid(E.showBidEntry(g), amount === null ? null : { tenderId: t.id, amount });
  }
  return E.revealBids(g);
}

describe('rules bot (chooseBid)', () => {
  it("charges the client's full budget when the opponent's board is full", () => {
    const cap = GAME.maxActiveProjects;
    if (cap === null) return;
    let g = E.createGame(['Human', 'Bot'], 3);
    for (let i = 0; i < cap; i++) g = E.nextRound(E.resolveRound(E.proceedToAllocation(bidFirst(g, [E.minBid, () => null]))));
    expect(E.boardFull(g.players[0])).toBe(true);
    const choice = chooseBid(g, 'P2')!;
    const t = E.offeredTender(g, choice.tenderId)!;
    expect(choice.amount).toBe(E.maxBid(t));
  });

  it("stays below the client's budget when a rival can bid too", () => {
    const g = E.createGame(['A', 'B', 'C'], 5);
    for (let i = 0; i < 20; i++) {
      const choice = chooseBid(g, 'P2', mulberry(i));
      if (choice) expect(choice.amount).toBeLessThan(E.maxBid(E.offeredTender(g, choice.tenderId)!));
    }
  });

  it('varies its bid, so two bots with the same view rarely match', () => {
    const g = E.createGame(['A', 'B', 'C'], 5);
    const picks = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(chooseBid(g, 'P2', mulberry(i)))));
    expect(picks.size).toBeGreaterThan(3);
  });

  it('bids on a tender that is on the table, within its range', () => {
    for (const seed of [1, 2, 3]) {
      const g = E.createGame(['A', 'B'], seed);
      const choice = chooseBid(g, 'P2');
      if (!choice) continue;
      const t = E.offeredTender(g, choice.tenderId)!;
      expect(t).not.toBeNull();
      expect(choice.amount).toBeGreaterThanOrEqual(E.minBid(t));
      expect(choice.amount).toBeLessThanOrEqual(E.maxBid(t));
    }
  });
});

describe('buildView', () => {
  it('never exposes the bid already entered this round', () => {
    let g = E.beginBidding(E.createGame(['Human', 'Bot'], 7));
    const t = g.market[0].tender;
    const secret = E.maxBid(t) - 1; // an unusual amount, not the min or max
    g = E.submitBid(E.showBidEntry(g), { tenderId: t.id, amount: secret });
    const view = buildView(g, 'P2');
    expect(JSON.stringify(view)).not.toContain(`:${secret},`);
    expect(JSON.stringify(view)).not.toContain(`:${secret}}`);
    expect(view.me.name).toBe('Bot');
    expect(view.opponents.map((o) => o.name)).toEqual(['Human']);
    expect(view.market.map((m) => m.id)).toEqual(g.market.map((o) => o.tender.id));
  });

  it('includes revealed bids from past rounds from the AI’s perspective', () => {
    let g = E.createGame(['Human', 'Bot'], 7);
    const bid = E.minBid(g.market[0].tender) + 9;
    g = bidFirst(g, [() => bid, () => null]);
    g = E.nextRound(E.resolveRound(E.proceedToAllocation(g)));
    const view = buildView(g, 'P2');
    expect(view.history).toEqual([expect.objectContaining({ myBid: null, opponentBids: [{ name: 'Human', bid }], winner: 'Human' })]);
    expect(view.opponents[0].contracts).toHaveLength(1);
  });
});

describe('three players', () => {
  it('deals one tender per player', () => {
    const g = E.createGame(['You', 'AI 1', 'AI 2'], 1);
    expect(g.market).toHaveLength(E.tendersPerRound(3));
    expect(E.tendersPerRound(3)).toBe(GAME.tendersPerRound + GAME.extraTendersPerPlayer);
  });

  it('shows each AI both opponents, and names who won', () => {
    let g = E.createGame(['You', 'AI 1', 'AI 2'], 7);
    const bid = E.minBid(g.market[0].tender) + 9;
    g = bidFirst(g, [() => bid, () => bid + 1, () => null]);
    g = E.nextRound(E.resolveRound(E.proceedToAllocation(g)));
    const view = buildView(g, 'P3');
    expect(view.opponents.map((o) => o.name)).toEqual(['You', 'AI 1']);
    expect(view.history).toEqual([
      expect.objectContaining({ myBid: null, opponentBids: [{ name: 'You', bid }, { name: 'AI 1', bid: bid + 1 }], winner: 'You' }),
    ]);
  });

  it('plays complete games with three rules bots', () => {
    for (const seed of [1, 2, 3]) {
      const g = playHeadless(seed, [STRATEGIES.rules, STRATEGIES.rules, STRATEGIES.rules]).final;
      expect(g.phase).toBe('gameOver');
      expect(g.players).toHaveLength(3);
    }
  });
});

describe('parseBidDecision', () => {
  it('accepts a bid on a tender, or a pass', () => {
    expect(parseBidDecision({ tenderId: 'T1', bid: 7.4, reasoning: 'ok' }, 'x')).toEqual({
      tenderId: 'T1',
      bid: 7,
      reasoning: 'ok',
      source: 'x',
    });
    expect(parseBidDecision({ tenderId: null, bid: null, reasoning: '' }, 'x').bid).toBeNull();
  });

  it('rejects garbage', () => {
    expect(() => parseBidDecision({ tenderId: 'T1', bid: -3 }, 'x')).toThrow();
    expect(() => parseBidDecision({ tenderId: 'T1', bid: 'ten' }, 'x')).toThrow();
    expect(() => parseBidDecision({ tenderId: null, bid: 12 }, 'x')).toThrow(); // a bid needs a tender
    expect(() => parseBidDecision(null, 'x')).toThrow();
  });
});

describe('rules bot', () => {
  it('plays complete games without stalling', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = playHeadless(seed, [STRATEGIES.rules, STRATEGIES.rules]).final;
      expect(g.phase).toBe('gameOver');
      expect(g.tendersDealt).toBe(GAME.tendersPerGame);
      expect(g.players.every((p) => p.bankruptRound === null)).toBe(true);
      expect(g.players.every((p) => p.hiredWorkers <= GAME.maxFreelancers)).toBe(true);
    }
  });
});
