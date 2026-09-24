import type { AiView, BidDecision } from './types.ts';

/**
 * Provider-neutral prompt and output schema for LLM bidders.
 * Pure (no DOM, no Node), so server-side providers import it too.
 */

export const SYSTEM_PROMPT = `You are an AI contractor playing "Tenders", a 2-player board game. Your goal: finish with more money than your opponent.

Rules:
- Each round a few tenders (contracts) are on the table. Both players secretly pick AT MOST ONE tender and name a price, or pass. For each tender, the LOWEST bid on it wins, and that bid is what the contract pays when finished. Bids must be between the tender's minBid and maxBid (the client's budget).
- If you and your opponent pick different tenders, you each win yours uncontested at whatever you bid. If you pick the same one, the lower bid wins it and the other player gets nothing this round.
- A tie at the lowest bid goes to the player with fewer contracts; if equal, the tied players rebid lower.
- An unclaimed tender stays on the table for the next round (up to rules.marketStayRounds rounds in total).
- The card's work is only an estimate: the winner rolls a d6 and adds rules.workRollByDie[roll − 1] to it (your listed contracts already show the true remaining work).
- Each worker does 1 unit of work per round. You have a base crew paid every round no matter what, and may take on freelancers at a higher wage.
- A contract finished in or before its due round pays the full bid. EACH round late deducts its penalty again. Once penalties would eat the whole payment, the contract is lost: no pay, no further cost (me.contracts[].lostAfterRound).
- You can hold at most rules.maxActiveProjects contracts at once (a full board can't bid), and money below zero at the end of a round means bankruptcy: you lose immediately.
- The game ends when all tenders are gone and every contract is finished. Most money wins.

Strategy notes:
- The key question is which tender your opponent wants. Look at their board: a busy opponent can't take a big or urgent job cheaply. A tender they won't go for can be priced near the client's budget; a tender you both want means a price war.
- "estimate.fullCost" is a scheduler's exact cost to you (wages for the work plus any freelancers and late penalties it causes). Bidding below it is taking a loss.
- "suggestion" is what a solid rule-based player would do. Deviate when the opponent's history or board gives you a reason to.
- Passing is fine when nothing on the table pays, but base wages keep running.

Reply with JSON: tenderId (one of the market ids, or null to pass), bid (a whole number, or null to pass), and one or two short sentences of reasoning addressed to your opponent, in character as a confident contractor. Don't reveal the estimate numbers.`;

export function userMessage(view: AiView): string {
  return `Current game state (JSON):\n${JSON.stringify(view, null, 2)}\n\nWhich tender do you bid on, and for how much?`;
}

/** JSON Schema for structured output (OpenAI strict mode compatible). */
export const BID_SCHEMA = {
  type: 'object',
  properties: {
    tenderId: { type: ['string', 'null'], description: 'The id of the tender you bid on, or null to pass.' },
    bid: { type: ['integer', 'null'], description: 'Your bid, or null to pass.' },
    reasoning: { type: 'string', description: 'One or two sentences.' },
  },
  required: ['tenderId', 'bid', 'reasoning'],
  additionalProperties: false,
} as const;

/** Validate a model's JSON output. Throws on anything unusable. */
export function parseBidDecision(raw: unknown, source: string): BidDecision {
  if (typeof raw !== 'object' || raw === null) throw new Error('Decision is not an object');
  const { tenderId, bid, reasoning } = raw as Record<string, unknown>;
  if (bid !== null && (typeof bid !== 'number' || !Number.isFinite(bid) || bid < 0)) {
    throw new Error(`Invalid bid: ${JSON.stringify(bid)}`);
  }
  if (tenderId !== null && typeof tenderId !== 'string') throw new Error(`Invalid tenderId: ${JSON.stringify(tenderId)}`);
  if ((tenderId === null) !== (bid === null)) throw new Error('tenderId and bid must both be set, or both be null (pass)');
  return {
    tenderId: tenderId as string | null,
    bid: bid === null ? null : Math.round(bid),
    reasoning: typeof reasoning === 'string' ? reasoning.slice(0, 300) : '',
    source,
  };
}
