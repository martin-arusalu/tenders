import type { AiView, BidDecision } from './types.ts';

/**
 * Provider-neutral prompt and output schema for LLM bidders.
 * Pure (no DOM, no Node), so server-side providers import it too.
 */

export const SYSTEM_PROMPT = `You are an AI contractor playing "Tenders", a board game for 2 or 3 players. Your goal: finish with more money than every opponent.

Rules:
- Each round a few tenders (contracts) are on the table. Every player secretly picks AT MOST ONE tender and names a price, or passes. For each tender, the LOWEST bid on it wins, and that bid is what the contract pays when finished. Bids must be between the tender's minBid and maxBid (the client's budget).
- A player alone on a tender wins it uncontested at whatever they bid. Players on the same tender compete: the lowest bid wins it and the others get nothing this round.
- A tie at the lowest bid goes to the player with fewer contracts; if equal, the tied players rebid lower.
- An unclaimed tender stays on the table for the next round (up to rules.marketStayRounds rounds in total).
- The card's work is only an estimate: the winner rolls a d6 and adds rules.workRollByDie[roll − 1] to it (your listed contracts already show the true remaining work).
- Each worker does 1 unit of work per round. You have a base crew paid every round no matter what, and may take on freelancers at a higher wage.
- A contract finished in or before its due round pays the full bid. EACH round late deducts its penalty again. Once penalties would eat the whole payment, the contract is lost: no pay, no further cost (me.contracts[].lostAfterRound).
- You can hold at most rules.maxActiveProjects contracts at once (a full board can't bid), and money below zero at the end of a round means bankruptcy: you lose immediately.
- The game ends when all tenders are gone and every contract is finished. Most money wins.

Strategy notes:
- The key question is which tender each opponent wants. Look at their boards: a busy opponent can't take a big or urgent job cheaply. A tender no opponent will go for can be priced near the client's budget; a tender others want too means a price war.
- Bidding the client's budget (maxBid) ONLY wins if nobody else bids on that tender, or if everyone else on it also bids maxBid (a tie). If there's any real chance an opponent goes for the same tender, maxBid will lose it: price below what they're likely to bid. Only bid maxBid without worry when no opponent can bid (all boards full).
- Be unpredictable. Opponents study your past bids, and if you always take the obvious tender at the obvious price they'll undercut you or dodge you. Mix it up: sometimes take your second-best tender, and vary your price instead of repeating a pattern. The user message gives you a random number from 1 to 100 for this round: use it to make those choices (for example, a low number means take the less obvious option).
- "estimate.fullCost" is a scheduler's exact cost to you (wages for the work plus any freelancers and late penalties it causes). Bidding below it is taking a loss.
- "suggestion" is what a solid rule-based player would do (it already weighs who might bid, with some randomness). Deviate when the opponents' history or boards give you a reason to.
- Passing is fine when nothing on the table pays, but base wages keep running.

Reply with JSON: tenderId (one of the market ids, or null to pass), bid (a whole number, or null to pass), and one or two short sentences of reasoning addressed to your opponents, in character as a confident contractor. Don't reveal the estimate numbers.`;

/** roll: a fresh random number from 1 to 100, so the model has something to base its mixing on. */
export function userMessage(view: AiView, roll = 1 + Math.floor(Math.random() * 100)): string {
  return `Current game state (JSON):\n${JSON.stringify(view, null, 2)}\n\nYour random number this round: ${roll}.\n\nWhich tender do you bid on, and for how much?`;
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
