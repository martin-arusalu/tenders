export interface Tender {
  id: string;
  name: string;
  work: number;
  /** Rounds available to finish, counting the round it is won. */
  deadline: number;
  /** Charged every round the project is incomplete past its deadline. */
  penalty: number;
}

/** lost = ran so late that finishing would no longer pay anything: removed with no payout. */
export type ProjectStatus = 'active' | 'complete' | 'lost';

export interface WorkRoll {
  /** 1–6 */
  die: number;
  /** Work added to (or taken off) the card's estimate. */
  delta: number;
}

export interface Project {
  id: string;
  tender: Tender;
  /** Fixed workboard row for this project, assigned when won and freed on completion. */
  lane: number;
  /** Winning bid = payout received on completion. */
  payout: number;
  wonRound: number;
  /** Card work + the roll's adjustment: the work that actually has to be done. */
  requiredWork: number;
  completedWork: number;
  /** The d6 rolled when the tender was won. */
  workRoll: WorkRoll;
  /** wonRound + deadline − 1: the round it's won counts as the first. On time if completed in or before this round. */
  dueRound: number;
  latePenalty: number;
  status: ProjectStatus;
  /** Round the card reached the finish line. It then waits for the owner to press Complete. */
  finishedRound: number | null;
  /** Settled when the card is flipped on completion. */
  completedRound: number | null;
  roundsLate: number;
  penaltyCharged: number;
  /** payout − penaltyCharged; can be negative. */
  netPayout: number;
}

export interface PlayerStats {
  tendersWon: number;
  totalBidValue: number;
  lowestWinningBid: number | null;
  contractsCompleted: number;
  contractsCompletedLate: number;
  /** Ran so late they would no longer pay anything, and were taken away. */
  contractsLost: number;
  latePenaltiesPaid: number;
  payrollPaid: number;
  paymentsReceived: number;
}

export interface Player {
  id: string;
  name: string;
  money: number;
  /** Total crew available this round: starting workers + hired. */
  workers: number;
  /** Of `workers`, how many are freelancers (costlier, capped, can be let go). */
  hiredWorkers: number;
  salaryPerWorker: number;
  projects: Project[];
  stats: PlayerStats;
  /** Round this player went bankrupt, which ends the game. */
  bankruptRound: number | null;
}

/** A sealed bid on one of the tenders on offer. amount === null (and tenderId null) means Pass. */
export interface Bid {
  playerId: string;
  tenderId: string | null;
  amount: number | null;
}

/** A tender on the table this round. */
export interface OfferedTender {
  tender: Tender;
  /** Rounds it has been on offer, counting this one. Unclaimed tenders leave after GAME.marketStayRounds. */
  age: number;
}

export interface AuctionResult {
  round: number;
  tender: Tender;
  /** The sealed bids placed on this tender (players who bid on another tender or passed aren't listed). */
  bids: Bid[];
  winnerId: string | null;
  winningBid: number | null;
  /** Tie-break rebids after the sealed bids, if any: each pass only has the players still tied. */
  rebids: Bid[][];
  /** How a tie at the lowest bid was settled; null when there was no tie. */
  tieBreak: 'fewerProjects' | 'rebid' | 'random' | null;
  /** The winner's work roll; null when nobody bid. */
  workRoll: WorkRoll | null;
}

export type Phase =
  | 'tenderReveal'
  | 'bidding'
  | 'bidReveal'
  | 'allocation'
  | 'roundSummary'
  | 'gameOver';

export interface BiddingState {
  /** Player ids bidding in this pass: everyone for the sealed bids, only the tied players on a rebid. */
  order: string[];
  /** Index into order of whose turn it is. */
  index: number;
  /** handoff = "pass the device" screen, entry = bid form, done = all bids in. */
  stage: 'handoff' | 'entry' | 'done';
  bids: Bid[];
  /** 0 for the sealed bids, 1+ for tie-break rebids. */
  rebid: number;
  /** On a rebid: the tender being rebid. */
  rebidTenderId: string | null;
  /** On a rebid: the tied amount. New bids must be at or below it, and passing isn't allowed. */
  cap: number | null;
  /** On a rebid: earlier passes on the rebid tender, starting with its sealed bids. */
  earlier: Bid[][];
  /** Other tied tenders still waiting for their rebid. */
  pendingTies: { tenderId: string; playerIds: string[]; cap: number; earlier: Bid[][] }[];
}

/** projectId -> workers assigned this round */
export type Allocation = Record<string, number>;

export interface ReportLine {
  text: string;
  delta?: number;
}

export interface PlayerRoundReport {
  playerId: string;
  moneyBefore: number;
  moneyAfter: number;
  wagesPaid: number;
  lines: ReportLine[];
}

export type LogKind = 'info' | 'win' | 'complete' | 'late' | 'payroll' | 'debug';

export interface LogEntry {
  round: number;
  text: string;
  kind: LogKind;
}

export interface GameState {
  /** Initial RNG seed; also identifies the game. */
  seed: number;
  round: number;
  phase: Phase;
  players: Player[];
  /** Remaining undrawn tenders for this game, in draw order. */
  deck: Tender[];
  /** Tenders on the table this round (GAME.tendersPerRound, fewer at the end). Each player bids on at most one. */
  market: OfferedTender[];
  tendersDealt: number;
  tendersPerGame: number;
  bidding: BiddingState | null;
  /** Auctions resolved this round. */
  lastAuctions: AuctionResult[];
  /** Every resolved auction, oldest first. All bids are public once revealed. */
  auctions: AuctionResult[];
  allocations: Record<string, Allocation>;
  roundReport: PlayerRoundReport[];
  log: LogEntry[];
  rngState: number;
  nextProjectId: number;
}
