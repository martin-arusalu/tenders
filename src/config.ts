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
  /**
   * Added to tendersPerRound for each player beyond 2 (so 3 players see 3 tenders).
   * BALANCE (3 rules bots, 100 games): at 0 there are 0.06 bankruptcies per game and final money
   * averages 176; at 1 there are none and it averages 258, but more tenders go unclaimed.
   */
  extraTendersPerPlayer: 0,
  /** Rounds an unclaimed tender stays on the table before the client goes elsewhere. */
  marketStayRounds: 2,
  /** 10 rounds of base wages. */
  startingMoney: 100,

  /**
   * Permanent crew each player starts with. Paid every round, working or not.
   * 5 × 2 = 10 per round, a round number that's easy to pay with physical money.
   * BALANCE: with 2 tenders a round each player can win about one job per round, so the deck's
   * average work should be about 1.25 × this (now 6.3 vs 5). Much more and bidding high wins
   * (capacity is scarce); less and bidding the minimum wins. Bigger crews make late contracts rare
   * (the whole crew can rescue one job), so penalties stop mattering. Check with `npm run sim`.
   */
  startingWorkers: 5,
  salaryPerWorker: 2,

  /** Extra workers a player can take on or let go at any time. */
  maxFreelancers: 4,
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

  /** Columns on the workboard. Every tender's work, after the worst roll, must fit (biggest now 12 + 2). */
  boardSpaces: 15,

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
 * (about 1.5 of 5 on average). Shorter deadlines → more late contracts (now ~10–15%).
 */
export const TENDERS: TenderDef[] = [
  { name: "Permit Paperwork", work: 3, deadline: 4, penalty: 1 },
  { name: "Fence Repair", work: 3, deadline: 4, penalty: 1 },
  { name: "Traffic Study", work: 3, deadline: 3, penalty: 1 },
  { name: "Emergency Repairs", work: 3, deadline: 3, penalty: 1 },
  { name: "Government Report", work: 3, deadline: 3, penalty: 1 },
  { name: "Airport Signage", work: 4, deadline: 3, penalty: 2 },
  { name: "Website Redesign", work: 4, deadline: 4, penalty: 2 },
  { name: "Park Landscaping", work: 4, deadline: 6, penalty: 2 },
  { name: "Sewer Camera Survey", work: 4, deadline: 3, penalty: 2 },
  { name: "Security Audit", work: 4, deadline: 3, penalty: 2 },
  { name: "Wind Turbine Service", work: 4, deadline: 3, penalty: 2 },
  { name: "School Roof Repair", work: 4, deadline: 3, penalty: 2 },
  { name: "Census Data Cleanup", work: 4, deadline: 4, penalty: 2 },
  { name: "Town Hall Accessibility", work: 5, deadline: 4, penalty: 2 },
  { name: "Bridge Inspection", work: 5, deadline: 4, penalty: 2 },
  { name: "Payroll System Rollout", work: 5, deadline: 4, penalty: 2 },
  { name: "Metro Station Tiling", work: 5, deadline: 3, penalty: 2 },
  { name: "Street Lighting LEDs", work: 6, deadline: 6, penalty: 2 },
  { name: "Data Migration", work: 6, deadline: 4, penalty: 2 },
  { name: "Fire Station Retrofit", work: 6, deadline: 4, penalty: 2 },
  { name: "Archive Digitisation", work: 6, deadline: 4, penalty: 2 },
  { name: "Museum Climate Control", work: 6, deadline: 4, penalty: 2 },
  { name: "Railway Survey", work: 7, deadline: 6, penalty: 3 },
  { name: "Library Extension", work: 7, deadline: 6, penalty: 3 },
  { name: "Court Records System", work: 7, deadline: 6, penalty: 3 },
  { name: "Emergency Shelter Build", work: 7, deadline: 3, penalty: 3 },
  { name: "Warehouse Upgrade", work: 8, deadline: 6, penalty: 3 },
  { name: "Tunnel Ventilation", work: 8, deadline: 6, penalty: 3 },
  { name: "Cycle Path Network", work: 9, deadline: 7, penalty: 4 },
  { name: "Office Renovation", work: 9, deadline: 7, penalty: 4 },
  { name: "Water Main Replacement", work: 9, deadline: 4, penalty: 4 },
  { name: "Solar Farm Wiring", work: 9, deadline: 4, penalty: 4 },
  { name: "Hospital IT Upgrade", work: 10, deadline: 6, penalty: 4 },
  { name: "Ferry Terminal Repairs", work: 10, deadline: 6, penalty: 4 },
  { name: "Flood Barrier Installation", work: 11, deadline: 6, penalty: 4 },
  { name: "Road Resurfacing", work: 11, deadline: 7, penalty: 4 },
  { name: "Harbour Dredging", work: 12, deadline: 7, penalty: 5 },
  { name: "Stadium Refurbishment", work: 12, deadline: 7, penalty: 5 },
  { name: "Bus Shelter Install", work: 3, deadline: 3, penalty: 1 },
  { name: "Bike Lane Painting", work: 3, deadline: 1, penalty: 1 },
  { name: "Storm Drain Clearing", work: 3, deadline: 1, penalty: 1 },
  { name: "Playground Build", work: 4, deadline: 3, penalty: 2 },
  { name: "Ice Rink Refrigeration", work: 4, deadline: 3, penalty: 2 },
  { name: "Sidewalk Repairs", work: 4, deadline: 4, penalty: 2 },
  { name: "Harbour Crane Service", work: 4, deadline: 1, penalty: 2 },
  { name: "Dam Inspection", work: 5, deadline: 3, penalty: 2 },
  { name: "Clinic Refit", work: 5, deadline: 4, penalty: 2 },
  { name: "Courthouse Heating", work: 5, deadline: 3, penalty: 2 },
  { name: "Pipeline Survey", work: 6, deadline: 6, penalty: 2 },
  { name: "Pier Maintenance", work: 6, deadline: 4, penalty: 2 },
  { name: "Car Park Resurfacing", work: 6, deadline: 3, penalty: 2 },
  { name: "Noise Barrier Wall", work: 6, deadline: 4, penalty: 2 },
  { name: "Rail Signal Upgrade", work: 7, deadline: 4, penalty: 3 },
  { name: "Airport Runway Patch", work: 7, deadline: 3, penalty: 3 },
  { name: "Recycling Centre Fit-out", work: 8, deadline: 6, penalty: 3 },
  { name: "Theatre Restoration", work: 9, deadline: 7, penalty: 4 },
  { name: "Market Hall Roof", work: 9, deadline: 6, penalty: 4 },
  { name: "Border Checkpoint IT", work: 10, deadline: 6, penalty: 4 },
  { name: "Canal Lock Repair", work: 11, deadline: 7, penalty: 4 },
  { name: "Cable Car Overhaul", work: 11, deadline: 8, penalty: 4 },
];

// ---------- AI opponent ----------

export const AI = {
  /** Most AI opponents in a game. You sit at seat 0 (bottom); the AIs take the seats across the table. */
  maxOpponents: 2,
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
  /**
   * How often the rules bot assumes a rival bids on a tender it doesn't look like it wants.
   * Higher = more careful: fewer bids at the client's full budget.
   */
  rivalSurpriseChance: 0.3,
  /**
   * The rules bot picks its price at random among those with at least this share of the best
   * expected profit. 1 = always the single best price (predictable); lower = more variety.
   */
  priceSpread: 0.85,
  /** Browser gives up on the LLM after this and falls back to the rules bid. */
  requestTimeoutMs: 30_000,
  /** Model used with the player's own key (entered on the setup screen). The dev server uses OPENAI_MODEL if set. */
  openAiModel: "gpt-5-mini",
};

// ---------- table / UI ----------

export const TABLE = {
  /** Index 0 is you (bottom of the table), then the opponents across from you. */
  playerColors: ["#5b8cff", "#ff5a6e", "#2ec4b6"],
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
