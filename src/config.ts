/**
 * Every tweakable number and choice in the game, in one place.
 * (The OpenAI key is entered by the player on the setup screen and kept in their browser.
 * For local dev it can also live in .env.local, read only by the dev server.)
 */

// ---------- economy ----------

export const GAME = {
  /** Tenders dealt per game. Drawn from TENDERS below, so keep TENDERS at least this long. */
  tendersPerGame: 50,

  /**
   * Tenders on the table each round. Each player bids on at most one of them, so players can
   * avoid each other (and charge more) or fight over the same job.
   */
  tendersPerRound: 2,
  /** Rounds an unclaimed tender stays on the table before the client goes elsewhere. */
  marketStayRounds: 2,
  startingMoney: 150,

  /**
   * Permanent crew each player starts with. Paid every round, working or not.
   * BALANCE: with 2 tenders a round each player can win about one job per round, so the deck's
   * average work should be about 1.25 × this (now 8.7 vs 7). Much more and bidding high wins
   * (capacity is scarce); less and bidding the minimum wins. Bigger crews make late contracts rare
   * (the whole crew can rescue one job), so penalties stop mattering. Check with `npm run sim`.
   */
  startingWorkers: 7,
  salaryPerWorker: 2,

  /** Extra workers a player can take on or let go at any time. */
  maxFreelancers: 5,
  freelancerSalary: 3,

  /**
   * Reserve price: a bid must be at least work × this. Stops a player from winning
   * everything at a loss just to starve the other one.
   * BALANCE: two good players undercut each other down to this, so it's effectively the going
   * rate: at the base salary (2) nobody profits; 2.5 leaves a thin margin.
   */
  minBidPerWork: 2.5,

  /**
   * The client's budget: a bid can be at most work × this. Without it, a player whose opponent
   * can't bid (full board) could name any price. With it, a busy opponent is when you charge more.
   */
  maxBidPerWork: 5,

  /**
   * Once the last tender is out, a player with no contracts left closes shop and stops paying wages,
   * instead of paying until the other player finishes. Keeps a hoarder from bleeding the other player dry.
   */
  closeShopWhenDone: true,

  /**
   * Bankrupt: at the end of a round (after wages and completed contracts), a player below this
   * loses and the game ends. null turns it off.
   */
  bankruptBelow: 0 as number | null,

  /**
   * Ties at the lowest bid go to the player with fewer projects. If that's equal too, the tied
   * players rebid (at or below the tied amount) until one goes lower. After this many rebids,
   * or when tied at the minimum bid, a coin flip decides.
   */
  maxRebids: 5,

  /**
   * Most contracts a player can hold at once (one per workboard lane). A player with a full
   * board can't bid. Stops one player from hoarding every tender to starve the other. null = no cap.
   */
  maxActiveProjects: 4 as number | null,

  /** Columns on the workboard. Every tender's work, after the worst roll, must fit (biggest now 17 + 2). */
  boardSpaces: 20,

  /**
   * Estimates are never exact: the winner rolls a d6 and this is added to the card's work.
   * Index 0 is a roll of 1. Keep it summing to 0 so the card is right on average.
   */
  workRoll: [2, 1, 0, 0, -1, -2],
  /** Smallest work printed on a tender card, so even the best roll leaves work to do. */
  minTenderWork: 3,
};

// ---------- tender deck ----------

export interface TenderDef {
  name: string;
  /** Worker-rounds of work. One worker does 1 per round. */
  work: number;
  /** Rounds to finish, counting the round it's won: 1 = by the end of this round, 2 = by the end of next round. */
  deadline: number;
  /**
   * Taken off the payout for EACH round it finishes late. Rule of thumb: work × 2/5; must be 1..work.
   * Once the penalties would eat the whole payment, the job is lost (no pay, no further cost).
   */
  penalty: number;
}

/**
 * Shuffled at the start of each game; the first GAME.tendersPerGame are used.
 * Rule of thumb: work ÷ deadline is how many workers it needs per round to finish on time
 * (about 2 of 7 on average). Shorter deadlines → more late contracts (now ~15–20%).
 */
export const TENDERS: TenderDef[] = [
  { name: "Permit Paperwork", work: 3, deadline: 3, penalty: 1 },
  { name: "Fence Repair", work: 3, deadline: 3, penalty: 1 },
  { name: "Traffic Study", work: 3, deadline: 2, penalty: 1 },
  { name: "Emergency Repairs", work: 4, deadline: 2, penalty: 2 },
  { name: "Government Report", work: 4, deadline: 3, penalty: 2 },
  { name: "Airport Signage", work: 5, deadline: 3, penalty: 2 },
  { name: "Website Redesign", work: 5, deadline: 4, penalty: 2 },
  { name: "Park Landscaping", work: 5, deadline: 5, penalty: 2 },
  { name: "Sewer Camera Survey", work: 5, deadline: 3, penalty: 2 },
  { name: "Security Audit", work: 5, deadline: 2, penalty: 2 },
  { name: "Wind Turbine Service", work: 5, deadline: 2, penalty: 2 },
  { name: "School Roof Repair", work: 6, deadline: 3, penalty: 2 },
  { name: "Census Data Cleanup", work: 6, deadline: 4, penalty: 2 },
  { name: "Town Hall Accessibility", work: 7, deadline: 4, penalty: 3 },
  { name: "Bridge Inspection", work: 7, deadline: 4, penalty: 3 },
  { name: "Payroll System Rollout", work: 7, deadline: 4, penalty: 3 },
  { name: "Metro Station Tiling", work: 7, deadline: 3, penalty: 3 },
  { name: "Street Lighting LEDs", work: 8, deadline: 5, penalty: 3 },
  { name: "Data Migration", work: 8, deadline: 4, penalty: 3 },
  { name: "Fire Station Retrofit", work: 8, deadline: 4, penalty: 3 },
  { name: "Archive Digitisation", work: 9, deadline: 5, penalty: 4 },
  { name: "Museum Climate Control", work: 9, deadline: 4, penalty: 4 },
  { name: "Railway Survey", work: 10, deadline: 5, penalty: 4 },
  { name: "Library Extension", work: 10, deadline: 5, penalty: 4 },
  { name: "Court Records System", work: 10, deadline: 5, penalty: 4 },
  { name: "Emergency Shelter Build", work: 10, deadline: 3, penalty: 4 },
  { name: "Warehouse Upgrade", work: 11, deadline: 5, penalty: 4 },
  { name: "Tunnel Ventilation", work: 11, deadline: 5, penalty: 4 },
  { name: "Cycle Path Network", work: 12, deadline: 6, penalty: 5 },
  { name: "Office Renovation", work: 12, deadline: 6, penalty: 5 },
  { name: "Water Main Replacement", work: 12, deadline: 4, penalty: 5 },
  { name: "Solar Farm Wiring", work: 12, deadline: 4, penalty: 5 },
  { name: "Hospital IT Upgrade", work: 14, deadline: 6, penalty: 6 },
  { name: "Ferry Terminal Repairs", work: 14, deadline: 5, penalty: 6 },
  { name: "Flood Barrier Installation", work: 15, deadline: 5, penalty: 6 },
  { name: "Road Resurfacing", work: 16, deadline: 7, penalty: 6 },
  { name: "Harbour Dredging", work: 17, deadline: 7, penalty: 7 },
  { name: "Stadium Refurbishment", work: 17, deadline: 7, penalty: 7 },
  { name: "Bus Shelter Install", work: 3, deadline: 2, penalty: 1 },
  { name: "Bike Lane Painting", work: 3, deadline: 1, penalty: 1 },
  { name: "Storm Drain Clearing", work: 4, deadline: 1, penalty: 2 },
  { name: "Playground Build", work: 5, deadline: 3, penalty: 2 },
  { name: "Ice Rink Refrigeration", work: 5, deadline: 2, penalty: 2 },
  { name: "Sidewalk Repairs", work: 6, deadline: 4, penalty: 2 },
  { name: "Harbour Crane Service", work: 6, deadline: 2, penalty: 2 },
  { name: "Dam Inspection", work: 7, deadline: 3, penalty: 3 },
  { name: "Clinic Refit", work: 7, deadline: 4, penalty: 3 },
  { name: "Courthouse Heating", work: 7, deadline: 3, penalty: 3 },
  { name: "Pipeline Survey", work: 8, deadline: 5, penalty: 3 },
  { name: "Pier Maintenance", work: 8, deadline: 4, penalty: 3 },
  { name: "Car Park Resurfacing", work: 8, deadline: 2, penalty: 3 },
  { name: "Noise Barrier Wall", work: 9, deadline: 5, penalty: 4 },
  { name: "Rail Signal Upgrade", work: 10, deadline: 4, penalty: 4 },
  { name: "Airport Runway Patch", work: 10, deadline: 3, penalty: 4 },
  { name: "Recycling Centre Fit-out", work: 11, deadline: 6, penalty: 4 },
  { name: "Theatre Restoration", work: 12, deadline: 7, penalty: 5 },
  { name: "Market Hall Roof", work: 12, deadline: 5, penalty: 5 },
  { name: "Border Checkpoint IT", work: 14, deadline: 5, penalty: 6 },
  { name: "Canal Lock Repair", work: 15, deadline: 7, penalty: 6 },
  { name: "Cable Car Overhaul", work: 16, deadline: 8, penalty: 6 },
];

// ---------- AI opponent ----------

export const AI = {
  /** Seat the AI plays (0 = bottom, 1 = across the table). */
  seat: 1,
  /**
   * The rules bot (the AI's fallback when the LLM doesn't answer) reads the table: a tender its
   * opponent doesn't want goes at the client's budget, a contested one just under the rival's cost.
   * Cost-plus price per unit of work (used to estimate a job's value) = base salary + this margin.
   */
  marginPerWork: 1,
  /**
   * Margin when the crew would otherwise sit idle. 0 = bid the reserve price, so a hoarder bidding
   * the floor only wins ties instead of starving the bot.
   */
  idleMarginPerWork: 0,
  /** Browser gives up on the LLM after this and falls back to the rules bid. */
  requestTimeoutMs: 30_000,
  /** Model used with the player's own key (entered on the setup screen). The dev server uses OPENAI_MODEL if set. */
  openAiModel: 'gpt-5-mini',
};

// ---------- table / UI ----------

export const TABLE = {
  /** Index 0 is you (bottom of the table), index 1 the opponent across from you. */
  playerColors: ["#5b8cff", "#ff5a6e"],
  /** Empty workboard rows always drawn. More appear if a player runs more projects at once. */
  fixedLanes: 4,
  /** Debug menu money buttons. */
  debugMoneySteps: [-10, -1, 1, 10],
  namePool: [
    "Atlas Ltd",
    "Northstar",
    "Apex Works",
    "BudgetCorp",
    "Ironclad Group",
    "Bluepeak",
    "Keystone & Co",
    "Meridian Build",
    "Granite Partners",
    "Vantage Civil",
    "Lowball Inc",
    "Summit Systems",
  ],
};
