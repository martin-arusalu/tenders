/**
 * Contract between the game and whatever makes the AI's bidding decisions.
 * These types are shared by the browser and the server-side providers, so keep them plain JSON.
 */

/** Everything the AI player may know when bidding: exactly what a human in its seat could see. */
export interface AiView {
  round: number;
  /** Tenders still in the deck after the ones on the table. */
  tendersLeftInDeck: number;
  rules: {
    baseSalary: number;
    freelancerSalary: number;
    maxFreelancers: number;
    /** Most contracts a player can hold; a full board can't bid. */
    maxActiveProjects: number | null;
    /** An unclaimed tender stays on the table this many rounds in total. */
    marketStayRounds: number;
    /** After winning, a d6 is rolled; entry i is added to the card's work on a roll of i+1. */
    workRollByDie: number[];
  };
  /** The tenders on the table. You may bid on at most one of them. */
  market: {
    id: string;
    name: string;
    work: number;
    penaltyPerRoundLate: number;
    /** Reserve price: lower bids are not allowed. */
    minBid: number;
    /** The client's budget: higher bids are not allowed. */
    maxBid: number;
    /** If won now, finishing in or before this round is on time. */
    dueRoundIfWon: number;
    /** Rounds it has been on the table, counting this one. */
    roundsOnOffer: number;
    /** The built-in planner's numbers for us, so a language model need not do scheduling arithmetic. */
    estimate: {
      /** Base wages for the work + extra freelancers and late penalties it would cause: the least worth bidding. */
      fullCost: number;
      /** Freelancers the planner would run with if we win it. */
      freelancersIfWin: number;
      /** Rounds until our whole board is done if we win it. */
      busyUntilRoundIfWin: number;
    };
  }[];
  me: {
    name: string;
    money: number;
    workers: number;
    freelancers: number;
    contracts: {
      name: string;
      payout: number;
      remainingWork: number;
      dueRound: number;
      penaltyPerRoundLate: number;
      /** Unfinished at the end of this round, the contract is lost. */
      lostAfterRound: number;
    }[];
  };
  /** Everyone else at the table. */
  opponents: {
    name: string;
    money: number;
    workers: number;
    freelancers: number;
    /** A full board can't bid: that opponent sits this round out. */
    boardFull: boolean;
    /** Contracts they won that are still on their board. Progress is hidden. */
    contracts: { name: string; work: number; payout: number; dueRound: number }[];
  }[];
  /** Past auctions with the bids revealed. Players who bid on another tender or passed aren't listed. */
  history: {
    round: number;
    tender: string;
    work: number;
    /** null = bid on another tender or passed. */
    myBid: number | null;
    opponentBids: { name: string; bid: number }[];
    /** 'me', or the winning opponent's name. */
    winner: string;
  }[];
  /** What the rule-based bot would do: its tender and bid, or null to pass. */
  suggestion: { tenderId: string; bid: number; why: string } | null;
}

export interface BidDecision {
  /** Which tender to bid on (an id from the market), or null to pass. */
  tenderId: string | null;
  /** Whole number within the tender's range, or null to pass. */
  bid: number | null;
  /** One or two sentences, shown to the human at the bid reveal. */
  reasoning: string;
  /** Who decided: 'rules', 'openai', … */
  source: string;
}

/** Client side: anything that can choose and price a tender for the AI seat. */
export interface BidAdvisor {
  decideBid(view: AiView, signal?: AbortSignal): Promise<BidDecision>;
}
