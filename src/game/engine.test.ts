import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAME } from '../config';
import {
  activeProjects,
  autoAllocate,
  beginBidding,
  completeProject,
  bidRange,
  createGame,
  debugAdjustMoney,
  dueRoundIfWon,
  hireWorker,
  isGameFinished,
  isLate,
  lastPayingRound,
  maxBid,
  minBid,
  nextRound,
  payroll,
  pendingFlips,
  proceedToAllocation,
  rankings,
  releaseWorker,
  resolveRound,
  revealBids,
  setAllocation,
  showBidEntry,
  submitBid,
} from './engine';
import type { GameState, Tender } from './types';

/** Run fn with some config values changed, then put them back. */
function withConfig(overrides: Partial<typeof GAME>, fn: () => void) {
  const saved = { ...GAME };
  Object.assign(GAME, overrides);
  try {
    fn();
  } finally {
    Object.assign(GAME, saved);
  }
}

// Most tests here are about one auction at a time, so they run with one tender per round and no
// carry-over. The two-tender market has its own tests at the bottom.
const savedConfig = { ...GAME };
beforeAll(() => Object.assign(GAME, { tendersPerRound: 1, extraTendersPerPlayer: 0, marketStayRounds: 1 }));
afterAll(() => Object.assign(GAME, savedConfig));

const START = GAME.startingMoney;
const CREW = GAME.startingWorkers;
const WAGES = CREW * GAME.salaryPerWorker;

/**
 * Bids are given on a 0–30 scale across the tender's allowed range (0 = minimum bid, 30 = the
 * client's budget), so tests survive config tweaks while keeping the order of the bids.
 */
function priceAt(t: Tender, premium: number): number {
  expect(premium).toBeLessThanOrEqual(30);
  return minBid(t) + Math.round((premium / 30) * (maxBid(t) - minBid(t)));
}

/** The first tender on the table. */
const tenderOf = (s: GameState) => s.market[0].tender;
/** The last auction settled this round. */
const lastAuction = (s: GameState) => s.lastAuctions[s.lastAuctions.length - 1];

/** Everyone bids on the first tender on the table (null = pass). */
function bidAll(s: GameState, premiums: (number | null)[]): GameState {
  const t = tenderOf(s);
  s = beginBidding(s);
  for (const a of premiums) {
    expect(s.bidding!.stage).toBe('handoff');
    s = showBidEntry(s);
    s = submitBid(s, a === null ? null : { tenderId: t.id, amount: priceAt(t, a) });
  }
  expect(s.bidding!.stage).toBe('done');
  return revealBids(s);
}

function flipAll(s: GameState): GameState {
  for (const pl of s.players) for (const pr of activeProjects(pl)) s = completeProject(s, pl.id, pr.id);
  return s;
}

describe('full 3-player scenario', () => {
  it('plays from setup through final scoring', () => {
    // P2 deliberately hoards every tender below; this test is about the full flow, not the anti-hoarding rules.
    withConfig({ bankruptBelow: null, maxActiveProjects: null }, playFullGame);
  });

  function playFullGame() {
    // 1. Start a 3-player game. 2. Reveal a tender.
    let s = createGame(['Atlas', 'Northstar', 'Apex'], 42);
    expect(s.phase).toBe('tenderReveal');
    expect(s.market).toHaveLength(1);
    expect(s.deck.length).toBe(GAME.tendersPerGame - 1);
    const firstTender = tenderOf(s);
    const price = priceAt(firstTender, 17); // P2's bid below

    // 3-4. Secret bids; lowest wins.
    s = bidAll(s, [22, 17, 28]);
    expect(s.phase).toBe('bidReveal');
    expect(lastAuction(s).winnerId).toBe('P2');
    expect(lastAuction(s).winningBid).toBe(price);

    // 5. Winner receives the active project.
    const nb = s.players[1];
    expect(activeProjects(nb)).toHaveLength(1);
    const proj = activeProjects(nb)[0];
    expect(proj.payout).toBe(price);
    expect(proj.tender.id).toBe(firstTender.id);

    // 6. Winner assigns workers (deliberately only 1, to force lateness).
    s = proceedToAllocation(s);
    s = setAllocation(s, 'P2', proj.id, 1);
    s = setAllocation(s, 'P2', proj.id, 99); // clamped
    expect(s.allocations.P2[proj.id]).toBe(Math.min(CREW, proj.requiredWork));
    s = setAllocation(s, 'P2', proj.id, 1);

    // 7, 11. Work progresses (card moves 1 step), payroll paid by everyone.
    s = resolveRound(s);
    let p = s.players[1].projects[0];
    expect(p.completedWork).toBe(1);
    expect(p.dueRound).toBe(dueRoundIfWon(1, firstTender));
    expect(p.dueRound).toBe(firstTender.deadline); // won in round 1: deadline N means due in round N
    for (const pl of s.players) expect(pl.money).toBe(START - WAGES);

    // 8-9. Stall the card until the due round has passed. Nothing is charged until it's completed.
    let rounds = 1;
    const playRound = (workers: number) => {
      s = nextRound(s);
      if (s.phase === 'tenderReveal') {
        s = bidAll(s, [null, null, null]);
        s = proceedToAllocation(s);
      }
      s = setAllocation(s, 'P2', proj.id, workers);
      s = flipAll(resolveRound(s));
      rounds++;
    };
    for (let guard = 0; s.round < p.dueRound + 2; guard++) {
      expect(guard).toBeLessThan(50);
      playRound(0);
    }
    expect(isLate({ ...s, round: s.round + 1 }, s.players[1].projects[0])).toBe(true);
    expect(s.players[1].money).toBe(START - WAGES * rounds);

    // 10. Finish it: flip the card, offer minus rounds-late × penalty.
    let guard = 50;
    while (s.players[1].projects[0].status === 'active' && guard--) playRound(CREW);
    p = s.players[1].projects[0];
    expect(p.status).toBe('complete');
    expect(p.roundsLate).toBe(p.completedRound! - p.dueRound);
    expect(p.roundsLate).toBeGreaterThan(0);
    expect(p.netPayout).toBe(price - p.roundsLate * firstTender.penalty);
    expect(s.players[1].money).toBe(START - WAGES * rounds + p.netPayout);
    expect(s.players[1].stats.contractsCompletedLate).toBe(1);

    // 12-13. Tenders keep coming; after tendersPerGame auctioned, no more.
    let safety = 5000;
    while (s.phase !== 'gameOver' && safety-- > 0) {
      if (s.phase === 'roundSummary') s = nextRound(flipAll(s));
      else if (s.phase === 'tenderReveal') {
        s = bidAll(s, [20, 15, 25]); // P2 always wins (overloads)
        s = proceedToAllocation(s);
      } else if (s.phase === 'allocation') {
        if (s.tendersDealt >= GAME.tendersPerGame) expect(s.market).toHaveLength(0);
        for (const pl of s.players) s = autoAllocate(s, pl.id);
        s = resolveRound(s);
      }
    }
    // 14. All projects completed.
    expect(s.phase).toBe('gameOver');
    expect(s.tendersDealt).toBe(GAME.tendersPerGame);
    expect(isGameFinished(s)).toBe(true);
    expect(s.players.every((pl) => activeProjects(pl).length === 0)).toBe(true);

    // Cleanup rounds happened (P2 hoarded work). P1, with nothing left, closed shop once the deck ran out.
    expect(s.round).toBeGreaterThan(GAME.tendersPerGame);
    expect(s.players[0].stats.payrollPaid).toBe(WAGES * (GAME.tendersPerGame - 1));
    expect(s.players[1].stats.payrollPaid).toBeGreaterThan(WAGES * GAME.tendersPerGame);

    // 15. Winner by money.
    const r = rankings(s);
    expect(r[0].money).toBeGreaterThanOrEqual(r[1].money);
    // Money bookkeeping is consistent.
    for (const pl of s.players) {
      const st = pl.stats;
      expect(pl.money).toBe(START + st.paymentsReceived - st.payrollPaid - st.latePenaltiesPaid);
    }
  }

  it('rolls a die on winning to set the true amount of work', () => {
    const dice = new Set<number>();
    for (let seed = 1; seed < 80; seed++) {
      const s = bidAll(createGame(['A', 'B'], seed), [5, null]);
      const pr = activeProjects(s.players[0])[0];
      const roll = lastAuction(s).workRoll!;
      expect(roll).toEqual(pr.workRoll);
      expect(roll.delta).toBe(GAME.workRoll[roll.die - 1]);
      expect(pr.requiredWork).toBe(pr.tender.work + roll.delta);
      dice.add(roll.die);
    }
    expect(dice).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(bidAll(createGame(['A', 'B'], 1), [null, null]).lastAuctions).toHaveLength(0); // nobody bid: no auction, no roll
  });

  describe('ties at the lowest bid', () => {
    /** Submit one full pass of bids (absolute amounts) and reveal it. */
    const pass = (s: GameState, amounts: (number | null)[]) => {
      for (const a of amounts) s = submitBid(showBidEntry(s), a === null ? null : { tenderId: s.bidding!.rebidTenderId!, amount: a });
      return revealBids(s);
    };

    it('go to the tied player with fewer projects', () => {
      let s = proceedToAllocation(bidAll(createGame(['A', 'B', 'C'], 5), [5, null, null])); // A has a project
      s = nextRound(resolveRound(s));
      s = bidAll(s, [10, 10, 15]);
      expect(s.phase).toBe('bidReveal');
      expect(lastAuction(s)).toMatchObject({ winnerId: 'P2', tieBreak: 'fewerProjects' });
    });

    it('with equal projects, send only the tied players to a capped rebid until one goes lower', () => {
      // Both bid the client's full budget, so there's room to go lower on the rebids.
      let s = bidAll(createGame(['A', 'B', 'C'], 5), [30, 30, null]);
      const tie = maxBid(tenderOf(s));
      expect(s.phase).toBe('bidding');
      expect(s.bidding).toMatchObject({ order: ['P1', 'P2'], rebid: 1, cap: tie, stage: 'handoff' });

      s = showBidEntry(s);
      expect(() => submitBid(s, null)).toThrow(); // no passing on a rebid
      expect(() => submitBid(s, { tenderId: tenderOf(s).id, amount: tie + 1 })).toThrow(); // can't raise
      s = pass(s, [tie - 1, tie - 1]); // tied again
      expect(s.bidding).toMatchObject({ rebid: 2, cap: tie - 1 });
      s = pass(s, [tie - 3, tie - 2]);
      expect(s.phase).toBe('bidReveal');
      expect(lastAuction(s)).toMatchObject({ winnerId: 'P1', winningBid: tie - 3, tieBreak: 'rebid' });
      expect(lastAuction(s).rebids).toHaveLength(2);
      expect(lastAuction(s).bids).toHaveLength(2); // C passed
      expect(activeProjects(s.players[0])[0].payout).toBe(tie - 3);
    });

    it('flip a coin when tied at the minimum bid, where nobody can go lower', () => {
      const winners = new Set<string>();
      for (let seed = 1; seed < 30; seed++) {
        const s = bidAll(createGame(['A', 'B'], seed), [0, 0]);
        expect(lastAuction(s).tieBreak).toBe('random');
        winners.add(lastAuction(s).winnerId!);
      }
      expect(winners).toEqual(new Set(['P1', 'P2']));
    });

    it('flip a coin after GAME.maxRebids rebids', () => {
      let s = bidAll(createGame(['A', 'B'], 9), [20, 20]);
      for (let i = 0; i < GAME.maxRebids; i++) s = pass(s, [s.bidding!.cap!, s.bidding!.cap!]);
      expect(s.phase).toBe('bidReveal');
      expect(lastAuction(s).tieBreak).toBe('random');
    });
  });

  it('takes a job away, with no payment, once penalties would eat all of it', () =>
    withConfig({ bankruptBelow: null }, () => {
    let s = proceedToAllocation(bidAll(createGame(['A', 'B'], 8), [3, null]));
    const pr = activeProjects(s.players[0])[0];
    const last = lastPayingRound(pr);
    expect((last - pr.dueRound + 1) * pr.latePenalty).toBeGreaterThanOrEqual(pr.payout); // one more round would pay nothing
    expect((last - pr.dueRound) * pr.latePenalty).toBeLessThan(pr.payout); // finishing in `last` still pays
    // Never work on it.
    for (let guard = 0; s.players[0].projects[0].status === 'active'; guard++) {
      expect(guard).toBeLessThan(50);
      expect(s.phase).not.toBe('gameOver');
      s = resolveRound(s);
      if (s.players[0].projects[0].status === 'active') expect(s.round).toBeLessThan(last);
      s = nextRound(s);
      if (s.phase === 'tenderReveal') s = proceedToAllocation(bidAll(s, [null, null]));
    }
    const lost = s.players[0].projects[0];
    expect(lost.status).toBe('lost');
    expect(lost.completedRound).toBe(last);
    expect(s.players[0].stats.contractsLost).toBe(1);
    expect(s.players[0].stats.paymentsReceived).toBe(0);
    expect(s.players[0].money).toBe(s.players[1].money); // only wages, like the player who never bid
  }));

  it("won't let a player with a full board bid", () => {
    const cap = GAME.maxActiveProjects;
    if (cap === null) return;
    let s = createGame(['A', 'B'], 21);
    for (let i = 0; i < cap; i++) {
      s = proceedToAllocation(bidAll(s, [5, null]));
      s = nextRound(resolveRound(s));
    }
    expect(activeProjects(s.players[0]).length).toBe(cap);
    s = showBidEntry(beginBidding(s));
    expect(bidRange(s, tenderOf(s)).canBid).toBe(false);
    expect(() => submitBid(s, { tenderId: tenderOf(s).id, amount: maxBid(tenderOf(s)) })).toThrow();
    s = submitBid(s, null); // passing is still fine
    s = submitBid(showBidEntry(s), { tenderId: tenderOf(s).id, amount: maxBid(tenderOf(s)) }); // the other player's board isn't full
    expect(s.bidding!.stage).toBe('done');
  });

  it('ends the game when a player goes bankrupt, ranking them last', () => {
    let s = proceedToAllocation(bidAll(createGame(['A', 'B'], 4), [null, null]));
    s = resolveRound(s);
    s = debugAdjustMoney(s, 'P1', -s.players[0].money + (GAME.bankruptBelow ?? 0) - 1);
    s = debugAdjustMoney(s, 'P2', -s.players[1].money - 500); // poorer, but checked the same way
    s = nextRound(s);
    expect(s.phase).toBe('gameOver');
    expect(s.players.every((p) => p.bankruptRound === 1)).toBe(true);

    let t = proceedToAllocation(bidAll(createGame(['A', 'B'], 4), [null, null]));
    t = debugAdjustMoney(resolveRound(t), 'P2', -1000);
    t = nextRound(t);
    expect(t.phase).toBe('gameOver');
    expect(rankings(t).map((p) => p.id)).toEqual(['P1', 'P2']);
    expect(t.players[0].bankruptRound).toBeNull();
  });

  it('never lets allocations exceed the worker count', () => {
    let s = createGame(['A', 'B'], 7);
    s = bidAll(s, [10, null]);
    s = proceedToAllocation(s);
    s = nextRound(resolveRound(s));
    s = bidAll(s, [12, null]);
    s = proceedToAllocation(s);
    const [a, b] = activeProjects(s.players[0]);
    s = setAllocation(s, 'P1', a.id, CREW);
    s = setAllocation(s, 'P1', b.id, CREW);
    const total = Object.values(s.allocations.P1).reduce((x, y) => x + y, 0);
    expect(total).toBeLessThanOrEqual(CREW);
  });

  it('waits for the owner to press Complete, charging lateness from the finishing round', () => {
    let s = createGame(['A', 'B'], 3);
    const t = tenderOf(s);
    s = proceedToAllocation(bidAll(s, [20, null]));
    const pr = activeProjects(s.players[0])[0];
    s = setAllocation(s, 'P1', pr.id, CREW);
    for (let guard = 0; pendingFlips(s).length === 0; guard++) {
      expect(guard).toBeLessThan(50);
      expect(s.phase).not.toBe('gameOver');
      s = resolveRound(s);
      if (pendingFlips(s).length > 0) break;
      s = nextRound(s);
      if (s.phase === 'tenderReveal') s = proceedToAllocation(bidAll(s, [null, null]));
      s = setAllocation(s, 'P1', pr.id, CREW);
    }
    const finished = s.round;
    const before = s.players[0].money;
    expect(nextRound(s).round).toBe(s.round); // blocked until flipped
    s = completeProject(s, 'P1', pr.id);
    const done = s.players[0].projects[0];
    expect(done.status).toBe('complete');
    expect(done.roundsLate).toBe(Math.max(0, finished - dueRoundIfWon(1, t)));
    expect(s.players[0].money).toBe(before + done.netPayout);
    expect(nextRound(s).round).toBe(finished + 1);
  });

  it('takes on and lets go freelancers at the higher wage', () => {
    let s = createGame(['A', 'B'], 11);
    const max = GAME.maxFreelancers;
    expect(payroll(s.players[0])).toBe(WAGES);
    s = hireWorker(s, 'P1');
    expect(s.players[0].workers).toBe(CREW + 1);
    expect(s.players[0].hiredWorkers).toBe(1);
    expect(payroll(s.players[0])).toBe(WAGES + GAME.freelancerSalary);
    for (let i = 0; i < max + 5; i++) s = hireWorker(s, 'P1'); // capped
    expect(s.players[0].hiredWorkers).toBe(max);
    expect(s.players[0].workers).toBe(CREW + max);
    s = releaseWorker(s, 'P1');
    expect(s.players[0].hiredWorkers).toBe(max - 1);
    expect(s.players[0].workers).toBe(CREW + max - 1);
  });

  it("won't release a hired worker who is currently assigned to a card", () =>
    // A 2-worker crew and no die adjustment, so the smallest job (3 work) can take all 3 workers.
    withConfig({ startingWorkers: 2, workRoll: [0, 0, 0, 0, 0, 0] }, () => {
      let s = createGame(['A', 'B'], 12);
      s = hireWorker(s, 'P1');
      s = proceedToAllocation(bidAll(s, [10, null]));
      const pr = activeProjects(s.players[0])[0];
      s = setAllocation(s, 'P1', pr.id, 3); // every worker committed
      expect(s.allocations.P1[pr.id]).toBe(3);
      expect(releaseWorker(s, 'P1').players[0].hiredWorkers).toBe(1); // blocked
      s = setAllocation(s, 'P1', pr.id, 2); // free 1 idle worker
      expect(releaseWorker(s, 'P1').players[0].hiredWorkers).toBe(0);
    }));

  it('reuses a freed workboard lane for the next tender won', () => {
    let s = createGame(['A', 'B'], 13);
    s = proceedToAllocation(bidAll(s, [10, null]));
    const first = activeProjects(s.players[0])[0];
    expect(first.lane).toBe(0);
    // Work the first card to completion; every other tender goes unsold.
    for (let guard = 0; ; guard++) {
      expect(guard).toBeLessThan(50);
      expect(s.phase).not.toBe('gameOver');
      s = setAllocation(s, 'P1', first.id, s.players[0].workers);
      s = flipAll(resolveRound(s));
      s = nextRound(s);
      if (s.players[0].projects[0].status === 'complete') break;
      if (s.phase === 'tenderReveal') s = proceedToAllocation(bidAll(s, [null, null]));
    }
    if (s.phase === 'tenderReveal') s = proceedToAllocation(bidAll(s, [10, null]));
    const second = activeProjects(s.players[0])[0];
    expect(second.lane).toBe(0); // first lane freed by completion, reused
  });
});

describe('two tenders on the table', () => {
  const market = { tendersPerRound: 2, marketStayRounds: 2 };
  /** Each player's sealed bid: [tender index, premium on the 0–30 scale] or null to pass. */
  const sealed = (s: GameState, bids: ([number, number] | null)[]) => {
    const offer = s.market.map((o) => o.tender);
    s = beginBidding(s);
    for (const b of bids) s = submitBid(showBidEntry(s), b && { tenderId: offer[b[0]].id, amount: priceAt(offer[b[0]], b[1]) });
    return revealBids(s);
  };

  it('deals two tenders, and players on different tenders both win theirs at their own price', () =>
    withConfig(market, () => {
      let s = createGame(['A', 'B'], 31);
      expect(s.market).toHaveLength(2);
      expect(s.tendersDealt).toBe(2);
      const [t0, t1] = s.market.map((o) => o.tender);
      s = sealed(s, [[0, 30], [1, 25]]);
      expect(s.phase).toBe('bidReveal');
      expect(s.lastAuctions.map((a) => [a.tender.id, a.winnerId, a.winningBid])).toEqual([
        [t0.id, 'P1', maxBid(t0)],
        [t1.id, 'P2', priceAt(t1, 25)],
      ]);
      expect(s.lastAuctions.every((a) => a.bids.length === 1)).toBe(true);
      expect(s.market).toHaveLength(0);
    }));

  it('on the same tender the cheaper bid wins; the other tender stays on offer, then leaves', () =>
    withConfig(market, () => {
      let s = createGame(['A', 'B'], 32);
      const [, t1] = s.market.map((o) => o.tender);
      s = sealed(s, [[0, 10], [0, 5]]);
      expect(s.lastAuctions).toHaveLength(1);
      expect(lastAuction(s)).toMatchObject({ winnerId: 'P2', winningBid: priceAt(lastAuction(s).tender, 5) });
      expect(s.market.map((o) => [o.tender.id, o.age])).toEqual([[t1.id, 1]]);

      // Next round: the leftover is back (second round on offer) next to one new card.
      s = nextRound(resolveRound(proceedToAllocation(s)));
      expect(s.market.map((o) => [o.tender.id, o.age])).toEqual([
        [t1.id, 2],
        [expect.any(String), 1],
      ]);
      expect(s.tendersDealt).toBe(3);
      // Nobody wants it again: after its second round the client goes elsewhere.
      s = sealed(s, [null, null]);
      expect(s.market.map((o) => o.tender.id)).not.toContain(t1.id);
      expect(s.market).toHaveLength(1);
    }));

  it('only takes bids on tenders on offer, and rebids only on the tied tender', () =>
    withConfig(market, () => {
      let s = showBidEntry(beginBidding(createGame(['A', 'B'], 33)));
      expect(() => submitBid(s, { tenderId: 'nope', amount: 10 })).toThrow();
      s = createGame(['A', 'B'], 33);
      const [t0, t1] = s.market.map((o) => o.tender);
      s = sealed(s, [[0, 30], [0, 30]]);
      expect(s.phase).toBe('bidding');
      expect(s.bidding).toMatchObject({ rebidTenderId: t0.id, cap: maxBid(t0) });
      s = showBidEntry(s);
      expect(bidRange(s, t1).canBid).toBe(false);
      expect(() => submitBid(s, { tenderId: t1.id, amount: minBid(t1) })).toThrow();
    }));

  it("doesn't end the game while tenders are still on the table", () =>
    withConfig(market, () => {
      const s = createGame(['A', 'B'], 34);
      const bare = { ...s, deck: [], players: s.players.map((p) => ({ ...p, projects: [] })) };
      expect(isGameFinished(bare)).toBe(false);
      expect(isGameFinished({ ...bare, market: [] })).toBe(true);
    }));
});
