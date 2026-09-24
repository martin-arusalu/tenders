import { GAME } from '../config';
import { TENDER_DECK } from './tenders';
import type {
  Allocation,
  AuctionResult,
  Bid,
  BiddingState,
  GameState,
  LogKind,
  Player,
  PlayerRoundReport,
  Project,
  Tender,
  WorkRoll,
} from './types';

/** Workboard columns run 0..MAX_WORK. */
export const MAX_WORK = GAME.boardSpaces;

/** A card with deadline N won in round R must be finished by the end of round R + N − 1. */
export function dueRoundIfWon(round: number, t: Tender): number {
  return round + t.deadline - 1;
}

/** Reserve price for a tender. */
export function minBid(t: Tender): number {
  return Math.ceil(t.work * GAME.minBidPerWork);
}

/** The client's budget for a tender: the highest bid allowed. */
export function maxBid(t: Tender): number {
  return Math.max(minBid(t), Math.floor(t.work * GAME.maxBidPerWork));
}

/** Pull a bid into the allowed range for this tender. */
export function clampBid(t: Tender, amount: number): number {
  return Math.min(maxBid(t), Math.max(minBid(t), Math.round(amount)));
}

// ---------- helpers ----------

/** Every exported action is pure: clone, mutate the copy, return it. */
function produce(state: GameState, fn: (s: GameState) => void): GameState {
  const s = structuredClone(state);
  fn(s);
  return s;
}

/** mulberry32 seeded RNG kept in state so actions stay deterministic. */
function rand(s: GameState): number {
  let t = (s.rngState = (s.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function log(s: GameState, text: string, kind: LogKind = 'info') {
  s.log.push({ round: s.round, text, kind });
}

function playerById(s: GameState, id: string): Player {
  const p = s.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`Unknown player ${id}`);
  return p;
}

export function activeProjects(p: Player): Project[] {
  return p.projects.filter((pr) => pr.status === 'active');
}

/** Reached the finish line but not yet flipped by its owner. */
export function isReady(pr: Project): boolean {
  return pr.status === 'active' && pr.finishedRound !== null;
}

export function pendingFlips(s: GameState): Project[] {
  return s.players.flatMap((p) => activeProjects(p).filter(isReady));
}

export function remainingWork(pr: Project): number {
  return Math.max(0, pr.requiredWork - pr.completedWork);
}

export function workBacklog(p: Player): number {
  return activeProjects(p).reduce((sum, pr) => sum + remainingWork(pr), 0);
}

/**
 * Last round the contract can be finished and still pay something (payout − rounds late × penalty > 0).
 * Unfinished at the end of this round, it's lost.
 */
export function lastPayingRound(pr: Project): number {
  return pr.dueRound + Math.ceil(pr.payout / pr.latePenalty) - 1;
}

export function isLate(s: GameState, pr: Project): boolean {
  return pr.status === 'active' && s.round > pr.dueRound;
}

/** What the card pays if finished this round (or what it will pay, once it has finished). */
export function projectedPayout(s: GameState, pr: Project): { roundsLate: number; penalty: number; net: number } {
  const roundsLate = Math.max(0, (pr.finishedRound ?? s.round) - pr.dueRound);
  const penalty = roundsLate * pr.latePenalty;
  return { roundsLate, penalty, net: pr.payout - penalty };
}

export function payroll(p: Player): number {
  const base = p.workers - p.hiredWorkers;
  return base * p.salaryPerWorker + p.hiredWorkers * GAME.freelancerSalary;
}

/** No more tenders to come: the deck and the table are both empty. */
export function noTendersLeft(s: GameState): boolean {
  return s.deck.length === 0 && s.market.length === 0;
}

/** Wages actually charged this round: none once a player has closed shop (see GAME.closeShopWhenDone). */
export function wagesDue(s: GameState, p: Player): number {
  const closed = GAME.closeShopWhenDone && noTendersLeft(s) && activeProjects(p).length === 0;
  return closed ? 0 : payroll(p);
}

export function assignedWorkers(s: GameState, playerId: string): number {
  return Object.values(s.allocations[playerId] ?? {}).reduce((a, b) => a + b, 0);
}

export function isGameFinished(s: GameState): boolean {
  return noTendersLeft(s) && s.players.every((p) => activeProjects(p).length === 0);
}

/** Solvent players first, then by money. */
export function rankings(s: GameState): Player[] {
  return [...s.players].sort((a, b) => Number(a.bankruptRound !== null) - Number(b.bankruptRound !== null) || b.money - a.money);
}

// ---------- setup ----------

export function createGame(names: string[], seed = Math.floor(Math.random() * 2 ** 31)): GameState {
  const s: GameState = {
    seed,
    round: 1,
    phase: 'tenderReveal',
    players: names.map((name, i) => ({
      id: `P${i + 1}`,
      name,
      money: GAME.startingMoney,
      workers: GAME.startingWorkers,
      hiredWorkers: 0,
      salaryPerWorker: GAME.salaryPerWorker,
      projects: [],
      bankruptRound: null,
      stats: {
        tendersWon: 0,
        totalBidValue: 0,
        lowestWinningBid: null,
        contractsCompleted: 0,
        contractsCompletedLate: 0,
        contractsLost: 0,
        latePenaltiesPaid: 0,
        payrollPaid: 0,
        paymentsReceived: 0,
      },
    })),
    deck: [],
    market: [],
    tendersDealt: 0,
    tendersPerGame: GAME.tendersPerGame,
    bidding: null,
    lastAuctions: [],
    auctions: [],
    allocations: {},
    roundReport: [],
    log: [],
    rngState: seed,
    nextProjectId: 1,
  };

  const deck = [...TENDER_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  s.deck = deck.slice(0, GAME.tendersPerGame);
  log(s, `New game with ${names.join(', ')}. ${s.deck.length} tenders in play.`);
  startRoundMut(s);
  return s;
}

function startRoundMut(s: GameState) {
  s.bidding = null;
  s.lastAuctions = [];
  s.roundReport = [];

  // Every round starts with all cards where they are: players drag them forward themselves.
  s.allocations = Object.fromEntries(s.players.map((p) => [p.id, {}]));

  // Unclaimed tenders from last round stay; deal new ones into the empty slots.
  for (const o of s.market) o.age++;
  while (s.market.length < GAME.tendersPerRound && s.deck.length > 0) {
    const t = s.deck.shift()!;
    s.market.push({ tender: t, age: 1 });
    s.tendersDealt++;
    log(s, `Tender revealed: ${t.name} (work ${t.work}, deadline ${t.deadline}, penalty ${t.penalty}).`);
  }
  if (s.market.length > 0) {
    s.phase = 'tenderReveal';
  } else {
    s.phase = 'allocation';
    log(s, 'No tenders left — cleanup round.');
  }
}

export function offeredTender(s: GameState, tenderId: string): Tender | null {
  return s.market.find((o) => o.tender.id === tenderId)?.tender ?? null;
}

// ---------- bidding ----------

export const beginBidding = (state: GameState) =>
  produce(state, (s) => {
    if (s.phase !== 'tenderReveal' || s.market.length === 0) return;
    s.phase = 'bidding';
    s.bidding = {
      order: s.players.map((p) => p.id),
      index: 0,
      stage: 'handoff',
      bids: [],
      rebid: 0,
      rebidTenderId: null,
      cap: null,
      earlier: [],
      pendingTies: [],
    };
  });

/** Whose turn it is to bid, or null once everyone in this pass has. */
export function currentBidder(s: GameState): Player | null {
  const b = s.bidding;
  return b && b.index < b.order.length ? playerById(s, b.order[b.index]) : null;
}

export const showBidEntry = (state: GameState) =>
  produce(state, (s) => {
    if (s.bidding?.stage === 'handoff') s.bidding.stage = 'entry';
  });

/** A player whose board is full (GAME.maxActiveProjects) can't take on another contract. */
export function boardFull(p: Player): boolean {
  return GAME.maxActiveProjects !== null && activeProjects(p).length >= GAME.maxActiveProjects;
}

/** On a rebid, the tender being rebid. */
export function rebidTender(s: GameState): Tender | null {
  const id = s.bidding?.rebidTenderId;
  return id ? offeredTender(s, id) : null;
}

/**
 * Allowed bids for the current bidder on a tender: [min, max], or canBid false (full board).
 * On a rebid only the rebid tender can be bid on, capped at the tied amount, and passing isn't allowed.
 */
export function bidRange(s: GameState, t: Tender): { min: number; max: number; canPass: boolean; canBid: boolean } {
  const bidder = currentBidder(s);
  const rebid = rebidTender(s);
  return {
    min: minBid(t),
    max: Math.min(rebid ? s.bidding!.cap! : Infinity, maxBid(t)),
    canPass: !rebid,
    canBid: (!bidder || !boardFull(bidder)) && (!rebid || rebid.id === t.id),
  };
}

/** Submit the current bidder's sealed bid: one tender and a price, or null to pass. */
export const submitBid = (state: GameState, bid: { tenderId: string; amount: number } | null) =>
  produce(state, (s) => {
    const b = s.bidding;
    if (s.phase !== 'bidding' || !b || b.stage !== 'entry') return;
    if (bid === null) {
      if (b.rebidTenderId) throw new Error('Passing is not allowed on a rebid');
    } else {
      const t = offeredTender(s, bid.tenderId);
      if (!t) throw new Error(`Tender ${bid.tenderId} is not on offer`);
      const { min, max, canBid } = bidRange(s, t);
      if (!canBid) {
        throw new Error(b.rebidTenderId ? 'On a rebid you can only bid on the tied tender' : `Board full: at most ${GAME.maxActiveProjects} projects at once`);
      }
      if (!Number.isInteger(bid.amount) || bid.amount < min || bid.amount > max) {
        throw new Error(`Bid must be a whole number from ${min} to ${max}`);
      }
    }
    b.bids.push({ playerId: b.order[b.index], tenderId: bid?.tenderId ?? null, amount: bid?.amount ?? null });
    b.index++;
    b.stage = b.index >= b.order.length ? 'done' : 'handoff';
  });

/**
 * Reveal this pass. Each tender with bids is settled on its own. If a tie needs a rebid, the
 * tied players rebid that tender (phase stays bidding); once every tender is settled → bidReveal.
 */
export const revealBids = (state: GameState) =>
  produce(state, (s) => {
    const b = s.bidding;
    if (s.phase !== 'bidding' || b?.stage !== 'done') return;
    const ties: BiddingState['pendingTies'] = [...b.pendingTies];
    if (b.rebidTenderId === null) {
      for (const { tender } of [...s.market]) {
        const on = b.bids.filter((x) => x.tenderId === tender.id);
        if (on.length === 0) continue;
        const tie = settleMut(s, tender, [on], 0);
        if (tie) ties.push({ tenderId: tender.id, ...tie, earlier: [on] });
      }
    } else {
      const passes = [...b.earlier, b.bids];
      const tie = settleMut(s, offeredTender(s, b.rebidTenderId)!, passes, b.rebid);
      if (tie) ties.unshift({ tenderId: b.rebidTenderId, ...tie, earlier: passes });
    }
    const next = ties.shift();
    if (next) {
      const again = next.tenderId === b.rebidTenderId;
      s.bidding = {
        order: next.playerIds,
        index: 0,
        stage: 'handoff',
        bids: [],
        rebid: again ? b.rebid + 1 : 1,
        rebidTenderId: next.tenderId,
        cap: next.cap,
        earlier: next.earlier,
        pendingTies: ties,
      };
      return;
    }
    closeMarketMut(s);
    s.phase = 'bidReveal';
  });

/**
 * Settle one tender given its passes so far (sealed bids first, then rebids). Lowest bid wins.
 * A tie goes to the tied player with the fewest active projects; if still tied they rebid (at or
 * below the tied amount). A tie that can't go lower (at the minimum bid, or after
 * GAME.maxRebids rebids) is decided at random. Returns the tie when a rebid is needed.
 */
function settleMut(s: GameState, tender: Tender, passes: Bid[][], rebid: number): { playerIds: string[]; cap: number } | null {
  const last = passes[passes.length - 1];
  const valid = last.filter((x) => x.amount !== null) as { playerId: string; amount: number }[];
  const low = Math.min(...valid.map((x) => x.amount));
  let tied = valid.filter((x) => x.amount === low).map((x) => x.playerId);
  if (tied.length === 1) {
    finishAuctionMut(s, tender, passes, tied[0], low, rebid > 0 ? 'rebid' : null);
    return null;
  }
  const names = (ids: string[]) => ids.map((id) => playerById(s, id).name).join(' & ');
  const projects = (id: string) => activeProjects(playerById(s, id)).length;
  const fewest = Math.min(...tied.map(projects));
  const lighter = tied.filter((id) => projects(id) === fewest);
  if (lighter.length === 1) {
    log(s, `Tie at ${low} on ${tender.name} between ${names(tied)}: ${playerById(s, lighter[0]).name} has fewer projects and wins it.`);
    finishAuctionMut(s, tender, passes, lighter[0], low, 'fewerProjects');
    return null;
  }
  tied = lighter;
  if (low > minBid(tender) && rebid < GAME.maxRebids) {
    log(s, `Tie at ${low} on ${tender.name} between ${names(tied)}, with ${fewest} project${fewest === 1 ? '' : 's'} each: rebid at ${low} or lower.`);
    return { playerIds: tied, cap: low };
  }
  const winner = tied[Math.floor(rand(s) * tied.length)];
  log(s, `Tie at ${low} on ${tender.name} between ${names(tied)} that can't be broken by bidding lower: ${playerById(s, winner).name} wins the coin flip.`);
  finishAuctionMut(s, tender, passes, winner, low, 'random');
  return null;
}

function finishAuctionMut(
  s: GameState,
  tender: Tender,
  passes: Bid[][],
  winnerId: string,
  winningBid: number,
  tieBreak: AuctionResult['tieBreak'],
) {
  const w = playerById(s, winnerId);
  log(s, `${w.name} won ${tender.name} for ${winningBid}.`, 'win');
  const workRoll = awardTenderMut(s, winnerId, tender, winningBid);
  const pr = w.projects[w.projects.length - 1];
  log(
    s,
    `${w.name} rolled ${workRoll.die}: ${workRoll.delta === 0 ? 'estimate was right' : `${workRoll.delta > 0 ? '+' : '−'}${Math.abs(workRoll.delta)} work`} (${tender.work} → ${pr.requiredWork}).`,
    'info',
  );
  s.market = s.market.filter((o) => o.tender.id !== tender.id);
  const result: AuctionResult = { round: s.round, tender, bids: passes[0], rebids: passes.slice(1), winnerId, winningBid, tieBreak, workRoll };
  s.lastAuctions.push(result);
  s.auctions.push(result);
}

/** After the auctions: unclaimed tenders stay on offer until they've been out GAME.marketStayRounds rounds. */
function closeMarketMut(s: GameState) {
  s.bidding = null;
  s.market = s.market.filter((o) => {
    if (o.age < GAME.marketStayRounds) {
      log(s, `Nobody took ${o.tender.name}. It stays on offer next round.`);
      return true;
    }
    log(s, `Nobody took ${o.tender.name}. The client goes elsewhere.`);
    return false;
  });
}

/** Lowest workboard row not already used by one of this player's active projects. */
function freeLane(p: Player): number {
  const used = new Set(activeProjects(p).map((pr) => pr.lane));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

/** Award the contract and roll for its true size. */
function awardTenderMut(s: GameState, playerId: string, tender: Tender, bid: number): WorkRoll {
  const p = playerById(s, playerId);
  const die = 1 + Math.floor(rand(s) * 6);
  const workRoll = { die, delta: GAME.workRoll[die - 1] };
  p.projects.push({
    id: `J${s.nextProjectId++}`,
    lane: freeLane(p),
    tender,
    payout: bid,
    wonRound: s.round,
    requiredWork: Math.max(1, tender.work + workRoll.delta),
    completedWork: 0,
    workRoll,
    dueRound: dueRoundIfWon(s.round, tender),
    latePenalty: tender.penalty,
    status: 'active',
    finishedRound: null,
    completedRound: null,
    roundsLate: 0,
    penaltyCharged: 0,
    netPayout: 0,
  });
  p.stats.tendersWon++;
  p.stats.totalBidValue += bid;
  p.stats.lowestWinningBid =
    p.stats.lowestWinningBid === null ? bid : Math.min(p.stats.lowestWinningBid, bid);
  return workRoll;
}

export const proceedToAllocation = (state: GameState) =>
  produce(state, (s) => {
    if (s.phase === 'bidReveal') s.phase = 'allocation';
  });

// ---------- worker allocation ----------

export const setAllocation = (state: GameState, playerId: string, projectId: string, count: number) =>
  produce(state, (s) => {
    const p = playerById(s, playerId);
    const pr = activeProjects(p).find((x) => x.id === projectId);
    if (!pr) return;
    const alloc = (s.allocations[playerId] ??= {});
    const others = assignedWorkers(s, playerId) - (alloc[projectId] ?? 0);
    const n = Math.max(0, Math.min(count, p.workers - others, remainingWork(pr)));
    alloc[projectId] = n;
  });

/** Greedy: late / most urgent projects first. */
function autoAllocateMut(s: GameState, playerId: string) {
  const p = playerById(s, playerId);
  const alloc: Allocation = {};
  let free = p.workers;
  const order = [...activeProjects(p)].sort(
    (a, b) => a.dueRound - b.dueRound || b.latePenalty - a.latePenalty,
  );
  for (const pr of order) {
    const n = Math.min(free, remainingWork(pr));
    if (n > 0) alloc[pr.id] = n;
    free -= n;
  }
  s.allocations[playerId] = alloc;
}

/** Take on one freelancer (paid GAME.freelancerSalary per round), up to GAME.maxFreelancers. */
export const hireWorker = (state: GameState, playerId: string) =>
  produce(state, (s) => {
    if (s.phase === 'gameOver') return;
    const p = playerById(s, playerId);
    if (p.hiredWorkers >= GAME.maxFreelancers) return;
    p.hiredWorkers++;
    p.workers++;
    log(s, `${p.name} took on a freelancer (${p.hiredWorkers}/${GAME.maxFreelancers}).`);
  });

/** Let a freelancer go. Can't drop below what's currently assigned to cards. */
export const releaseWorker = (state: GameState, playerId: string) =>
  produce(state, (s) => {
    if (s.phase === 'gameOver') return;
    const p = playerById(s, playerId);
    if (p.hiredWorkers <= 0) return;
    if (assignedWorkers(s, playerId) >= p.workers) return;
    p.hiredWorkers--;
    p.workers--;
    log(s, `${p.name} let a freelancer go (${p.hiredWorkers}/${GAME.maxFreelancers}).`);
  });

export const autoAllocate = (state: GameState, playerId: string) =>
  produce(state, (s) => autoAllocateMut(s, playerId));

export const clearAllocation = (state: GameState, playerId: string) =>
  produce(state, (s) => {
    s.allocations[playerId] = {};
  });

// ---------- round resolution ----------

export const resolveRound = (state: GameState) =>
  produce(state, (s) => {
    if (s.phase !== 'allocation') return;
    resolveRoundMut(s);
  });

function resolveRoundMut(s: GameState) {
  const reports: PlayerRoundReport[] = [];

  for (const p of s.players) {
    const report: PlayerRoundReport = { playerId: p.id, moneyBefore: p.money, moneyAfter: 0, wagesPaid: 0, lines: [] };
    const alloc = s.allocations[p.id] ?? {};
    const idle = p.workers - Object.values(alloc).reduce((a, b) => a + b, 0);
    const cost = wagesDue(s, p); // decided before this round's work finishes anything

    for (const pr of activeProjects(p)) {
      // 4. Perform work
      const w = Math.min(alloc[pr.id] ?? 0, p.workers);
      if (w > 0) {
        pr.completedWork += w;
        report.lines.push({
          text: `${pr.tender.name}: +${w} work → ${Math.min(pr.completedWork, pr.requiredWork)} / ${pr.requiredWork}`,
        });
      }

      // 5. Card reaches the finish line. The owner flips it with completeProject.
      if (pr.finishedRound === null && pr.completedWork >= pr.requiredWork) {
        pr.finishedRound = s.round;
        delete alloc[pr.id]; // crew returns to the pool
        report.lines.push({ text: `${pr.tender.name} reached the finish — ready to complete` });
        log(s, `${p.name}'s ${pr.tender.name} reached the finish line.`, 'complete');
      } else if (pr.finishedRound === null && s.round >= lastPayingRound(pr)) {
        // 5b. So late that finishing next round would pay nothing: the client takes the job away.
        pr.status = 'lost';
        pr.completedRound = s.round;
        pr.roundsLate = s.round - pr.dueRound;
        delete alloc[pr.id];
        p.stats.contractsLost++;
        report.lines.push({ text: `${pr.tender.name} lost: late penalties would eat the whole payment` });
        log(s, `${p.name} lost ${pr.tender.name}: ${pr.roundsLate} round(s) late, penalties would exceed the ${pr.payout} payment.`, 'late');
      }
    }

    // 7. Payroll
    p.money -= cost;
    p.stats.payrollPaid += cost;
    report.wagesPaid = cost;
    const hires = p.hiredWorkers > 0 ? ` + ${p.hiredWorkers} freelancers × ${GAME.freelancerSalary}` : '';
    report.lines.push(
      cost > 0
        ? { text: `Wages: ${p.workers - p.hiredWorkers} × ${p.salaryPerWorker}${hires}`, delta: -cost }
        : { text: 'No contracts left: shop closed, no wages' },
    );

    if (idle > 0) report.lines.push({ text: `${idle} worker${idle > 1 ? 's' : ''} idle this round` });

    report.moneyAfter = p.money;
    reports.push(report);
  }

  const paid = reports.map((r) => r.wagesPaid);
  if (new Set(paid).size === 1) log(s, `All players paid ${paid[0]} payroll.`, 'payroll');
  else s.players.forEach((p, i) => log(s, `${p.name} paid ${paid[i]} payroll.`, 'payroll'));

  s.roundReport = reports;
  s.phase = 'roundSummary';
}

// 6. Flip a finished card: offer minus rounds late × penalty.
export const completeProject = (state: GameState, playerId: string, projectId: string) =>
  produce(state, (s) => completeProjectMut(s, playerId, projectId));

function completeProjectMut(s: GameState, playerId: string, projectId: string) {
  const p = playerById(s, playerId);
  const pr = activeProjects(p).find((x) => x.id === projectId);
  if (!pr || !isReady(pr)) return;
  pr.status = 'complete';
  pr.completedRound = pr.finishedRound;
  pr.roundsLate = Math.max(0, pr.finishedRound! - pr.dueRound);
  pr.penaltyCharged = pr.roundsLate * pr.latePenalty;
  pr.netPayout = pr.payout - pr.penaltyCharged;
  p.money += pr.netPayout;
  p.stats.paymentsReceived += pr.payout;
  p.stats.contractsCompleted++;
  p.stats.latePenaltiesPaid += pr.penaltyCharged;
  delete s.allocations[playerId]?.[projectId];
  if (pr.roundsLate > 0) {
    p.stats.contractsCompletedLate++;
    log(
      s,
      `${p.name} completed ${pr.tender.name} ${pr.roundsLate} round(s) late: ${pr.payout} − ${pr.penaltyCharged} = ${pr.netPayout}.`,
      'late',
    );
  } else {
    log(s, `${p.name} completed ${pr.tender.name} on time and received ${pr.payout}.`, 'complete');
  }
}

// 8. Start next round (or end the game). Finished cards must be flipped first.
export const nextRound = (state: GameState) =>
  produce(state, (s) => {
    if (s.phase !== 'roundSummary' || pendingFlips(s).length > 0) return;
    nextRoundMut(s);
  });

function nextRoundMut(s: GameState) {
  if (GAME.bankruptBelow !== null) {
    const broke = s.players.filter((p) => p.money < GAME.bankruptBelow!);
    if (broke.length > 0) {
      for (const p of broke) {
        p.bankruptRound = s.round;
        log(s, `${p.name} is bankrupt with ${p.money}.`, 'late');
      }
      s.phase = 'gameOver';
      const winner = rankings(s)[0];
      log(s, broke.length === s.players.length ? 'Everyone went bankrupt. Nobody wins.' : `Game over. ${winner.name} wins with ${winner.money}.`);
      return;
    }
  }
  if (isGameFinished(s)) {
    s.phase = 'gameOver';
    const winner = rankings(s)[0];
    log(s, `Game over. ${winner.name} wins with ${winner.money}.`);
    return;
  }
  s.round++;
  startRoundMut(s);
}

// ---------- debug / playtest ----------

/** Throw away the tenders on the table and deal fresh ones. */
export const debugRedealMarket = (state: GameState) =>
  produce(state, (s) => {
    if (s.market.length === 0 || (s.phase !== 'tenderReveal' && s.phase !== 'bidding')) return;
    log(s, `[debug] Discarded ${s.market.map((o) => o.tender.name).join(', ')}.`, 'debug');
    s.market = [];
    s.bidding = null;
    const round = s.round;
    startRoundMut(s);
    s.round = round;
  });

export const debugAdjustMoney = (state: GameState, playerId: string, delta: number) =>
  produce(state, (s) => {
    const p = playerById(s, playerId);
    p.money += delta;
    log(s, `[debug] ${p.name} money ${delta >= 0 ? '+' : ''}${delta}.`, 'debug');
  });

/**
 * Finish the current round with no further input: the tenders on offer get no
 * bids, players with nothing assigned are auto-allocated, then the round
 * resolves. From the summary screen it plays the whole next round.
 */
export const debugAdvanceRound = (state: GameState) =>
  produce(state, (s) => {
    if (s.phase === 'gameOver') return;
    if (s.phase === 'roundSummary') {
      for (const pr of pendingFlips(s)) {
        const owner = s.players.find((p) => p.projects.includes(pr))!;
        completeProjectMut(s, owner.id, pr.id);
      }
      nextRoundMut(s);
      if ((s.phase as GameState['phase']) === 'gameOver') return;
    }
    log(s, '[debug] Advancing round automatically.', 'debug');
    if (s.phase === 'tenderReveal' || s.phase === 'bidding') closeMarketMut(s); // everyone passes
    for (const p of s.players) {
      if (assignedWorkers(s, p.id) === 0) autoAllocateMut(s, p.id);
    }
    s.phase = 'allocation';
    resolveRoundMut(s);
  });
