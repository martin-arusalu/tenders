/**
 * Balance check for src/config.ts: headless games between bidding strategies.
 *
 *   npm run sim                          the rules bot (the AI's fallback) against every strategy
 *   npm run sim -- --all                 every strategy against every other (round robin)
 *   npm run sim -- hoarder budget        only these opponents
 *   npm run sim -- --games 200           more games per matchup (default 60), steadier numbers
 *   npm run sim -- --set startingWorkers=8 --set maxBidPerWork=4.5
 *                                        try config changes without editing the file
 *   npm run sim -- --work 0.8            scale every tender's work (deadline and penalty follow)
 *   npm run sim -- --deadline 0.8        scale every tender's deadline (shorter = more late contracts)
 */
import { GAME } from '../src/config.ts';
import { STRATEGIES, playHeadless } from '../src/ai/selfPlay.ts';
import { TENDER_DECK } from '../src/game/tenders.ts';
import type { GameState } from '../src/game/types.ts';

// ---------- options ----------

const args = process.argv.slice(2);
const valueOf = (flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const games = Number(valueOf('--games')[0] ?? 60);
const all = args.includes('--all');
const named = args.filter((a, i) => !a.startsWith('--') && !['--games', '--set', '--work', '--deadline'].includes(args[i - 1]));
for (const kv of valueOf('--set')) {
  const [k, v] = kv.split('=');
  if (!(k in GAME)) throw new Error(`Unknown config key ${k}`);
  (GAME as Record<string, unknown>)[k] = v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : Number(v);
}
const work = Number(valueOf('--work')[0] ?? 1);
if (work !== 1) {
  for (const t of TENDER_DECK) {
    const need = t.work / t.deadline;
    t.work = Math.max(GAME.minTenderWork, Math.min(GAME.boardSpaces - Math.max(...GAME.workRoll), Math.round(t.work * work)));
    t.deadline = Math.max(1, Math.round(t.work / need));
    t.penalty = Math.max(1, Math.min(t.work, Math.round(t.work * 0.4)));
  }
}
const deadline = Number(valueOf('--deadline')[0] ?? 1);
if (deadline !== 1) for (const t of TENDER_DECK) t.deadline = Math.max(1, Math.round(t.deadline * deadline));
const unknown = named.filter((n) => !STRATEGIES[n]);
if (unknown.length || !Number.isInteger(games) || games < 2) {
  console.error(`Usage: npm run sim -- [${Object.keys(STRATEGIES).join('|')} ...] [--all] [--games N] [--set key=value] [--work x] [--deadline x]`);
  process.exit(1);
}

// ---------- play ----------

interface Tally {
  wins: number;
  money: number[];
  bankrupt: number;
}
const pooled = { price: [] as number[], auctions: 0, contested: 0, coinFlips: 0, late: 0, done: 0, lost: 0, bankrupt: 0, rounds: 0, money: 0, games: 0, dealt: 0 };
/** Strategies a thoughtful player might use: the pooled numbers describe games between these. */
const SENSIBLE = new Set(['rules', 'mixed', 'adaptive', 'costplus', 'budget', 'sniper']);

function record(g: GameState) {
  pooled.games++;
  pooled.rounds += g.round;
  pooled.dealt += g.tendersDealt;
  for (const a of g.auctions) {
    pooled.auctions++;
    pooled.price.push(a.winningBid! / a.tender.work);
    if (a.bids.length > 1) pooled.contested++;
    if (a.tieBreak === 'random') pooled.coinFlips++;
  }
  for (const p of g.players) {
    pooled.late += p.stats.contractsCompletedLate;
    pooled.done += p.stats.contractsCompleted;
    pooled.lost += p.stats.contractsLost;
    pooled.money += p.money;
    if (p.bankruptRound !== null) pooled.bankrupt++;
  }
}

/** Both seats, alternating who sits first, so seat order and tie luck even out. */
function match(a: string, b: string): [Tally, Tally] {
  const t: [Tally, Tally] = [
    { wins: 0, money: [], bankrupt: 0 },
    { wins: 0, money: [], bankrupt: 0 },
  ];
  for (let i = 0; i < games; i++) {
    const swap = i % 2 === 1;
    const { final: g } = playHeadless(Math.floor(i / 2) + 1, swap ? [STRATEGIES[b], STRATEGIES[a]] : [STRATEGIES[a], STRATEGIES[b]]);
    const [pa, pb] = swap ? [g.players[1], g.players[0]] : g.players;
    const aOut = pa.bankruptRound !== null;
    const bOut = pb.bankruptRound !== null;
    if (aOut !== bOut) t[bOut ? 0 : 1].wins++;
    else if (pa.money !== pb.money) t[pa.money > pb.money ? 0 : 1].wins++;
    else (t[0].wins += 0.5), (t[1].wins += 0.5);
    t[0].money.push(pa.money);
    t[1].money.push(pb.money);
    if (aOut) t[0].bankrupt++;
    if (bOut) t[1].bankrupt++;
    if (SENSIBLE.has(a) && SENSIBLE.has(b)) record(g);
  }
  return t;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;

console.log(
  `Config: ${GAME.tendersPerGame} tenders, ${GAME.tendersPerRound} per round, start ${GAME.startingMoney}, crew ${GAME.startingWorkers}×${GAME.salaryPerWorker}, ` +
    `freelancers ≤${GAME.maxFreelancers}×${GAME.freelancerSalary}, bids ${GAME.minBidPerWork}–${GAME.maxBidPerWork}/work, ` +
    `max ${GAME.maxActiveProjects ?? '∞'} projects, avg work ${avg(TENDER_DECK.map((t) => t.work)).toFixed(1)}. ${games} games per matchup.\n`,
);

if (all) {
  const names = named.length ? named : Object.keys(STRATEGIES);
  const score: Record<string, { win: number[]; money: number[]; bankrupt: number[] }> = Object.fromEntries(
    names.map((n) => [n, { win: [], money: [], bankrupt: [] }]),
  );
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const [a, b] = match(names[i], names[j]);
      for (const [n, t] of [[names[i], a], [names[j], b]] as const) {
        score[n].win.push(t.wins / games);
        score[n].money.push(avg(t.money));
        score[n].bankrupt.push(t.bankrupt / games);
      }
    }
  console.table(
    names
      .map((n) => ({
        strategy: n,
        'win share': avg(score[n].win),
        'worst matchup': Math.min(...score[n].win),
        'avg money': Math.round(avg(score[n].money)),
        bankrupt: avg(score[n].bankrupt),
      }))
      .sort((a, b) => b['win share'] - a['win share'])
      .map((r) => ({ ...r, 'win share': pct(r['win share']), 'worst matchup': pct(r['worst matchup']), bankrupt: pct(r.bankrupt) })),
  );
} else {
  const opponents = named.length ? named : Object.keys(STRATEGIES);
  console.table(
    opponents.map((opp) => {
      const [r, o] = match('rules', opp);
      return {
        opponent: opp,
        'rules wins': pct(r.wins / games),
        'rules money': Math.round(avg(r.money)),
        'opponent money': Math.round(avg(o.money)),
        'rules bankrupt': pct(r.bankrupt / games),
        'opponent bankrupt': pct(o.bankrupt / games),
      };
    }),
  );
}

if (pooled.games) {
  const settled = pooled.done + pooled.lost;
  console.log(
    `Between sensible strategies (${[...SENSIBLE].join(', ')}):\n` +
      `  price ${avg(pooled.price).toFixed(2)}/work, ${pct(pooled.contested / pooled.auctions)} of tenders contested, ` +
      `${(pooled.coinFlips / pooled.games).toFixed(1)} coin flips/game, ${pct(1 - pooled.auctions / pooled.dealt)} of tenders unclaimed\n` +
      `  ${pct(pooled.late / settled)} of contracts late, ${pct(pooled.lost / settled)} lost, ${(pooled.bankrupt / pooled.games).toFixed(2)} bankruptcies/game, ` +
      `${(pooled.rounds / pooled.games).toFixed(1)} rounds, final money ${Math.round(pooled.money / pooled.games / 2)}`,
  );
}
console.log('\nStrategies:');
for (const [k, s] of Object.entries(STRATEGIES)) console.log(`  ${k.padEnd(9)} ${s.label}`);
