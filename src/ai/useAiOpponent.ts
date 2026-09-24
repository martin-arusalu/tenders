import { useEffect, useRef, useState } from 'react';
import * as E from '../game/engine';
import type { GameState } from '../game/types';
import { completeReady, playAllocation, rebidAmount } from './planner';
import type { BidAdvisor, BidDecision } from './types';
import { buildView } from './view';

/**
 * Plays one seat automatically. The bid comes from the advisor (fetched as soon as
 * bidding opens, in parallel with the human's entry); everything else is the planner.
 */
export function useAiOpponent(
  game: GameState | null,
  act: (fn: (g: GameState) => GameState) => void,
  aiId: string | null,
  advisor: BidAdvisor,
) {
  /** Latest decision, keyed by game + round + deal, so the bid reveal can show the reasoning. */
  const [decision, setDecision] = useState<{ key: string; decision: BidDecision } | null>(null);
  const requested = useRef<string | null>(null);

  const phase = game?.phase;
  const bidding = game?.bidding;
  const roundKey = game ? `${game.seed}|${game.round}` : '';
  // A debug redeal deals new tenders in the same round, so the deal count is part of the key.
  const tenderKey = `${roundKey}|${game?.tendersDealt}`;

  // Choose and price a tender as soon as bidding opens.
  useEffect(() => {
    if (!game || !aiId || phase !== 'bidding' || game.bidding?.rebidTenderId) return;
    if (E.boardFull(game.players.find((p) => p.id === aiId)!)) return; // can't bid: no need to ask
    const key = tenderKey;
    if (requested.current === key) return;
    requested.current = key;
    advisor.decideBid(buildView(game, aiId)).then((d) => {
      if (requested.current === key) setDecision({ key, decision: d });
    });
  }, [game, aiId, phase, tenderKey, advisor]);

  // Handoffs: the human goes straight to the form; the AI submits once its decision is in.
  // Tie-break rebids are priced by the planner, not the advisor.
  const bidderId = bidding && bidding.index < bidding.order.length ? bidding.order[bidding.index] : null;
  const rebid = bidding?.rebid ?? 0;
  useEffect(() => {
    if (!aiId || phase !== 'bidding' || bidding?.stage !== 'handoff') return;
    const aiTurn = (g: GameState) => g.bidding?.stage === 'handoff' && E.currentBidder(g)?.id === aiId;
    if (bidderId !== aiId) {
      act(E.showBidEntry);
    } else if (E.boardFull(E.currentBidder(game!)!)) {
      act((g) => (aiTurn(g) ? E.submitBid(E.showBidEntry(g), null) : g));
    } else if (rebid > 0) {
      act((g) => (aiTurn(g) ? E.submitBid(E.showBidEntry(g), { tenderId: g.bidding!.rebidTenderId!, amount: rebidAmount(g, aiId) }) : g));
    } else if (decision?.key === tenderKey) {
      const { tenderId, bid } = decision.decision;
      act((g) => {
        if (!aiTurn(g)) return g;
        // Models don't always respect the rules: an unknown tender is a pass, a price out of range is clamped.
        const t = tenderId ? E.offeredTender(g, tenderId) : null;
        return E.submitBid(E.showBidEntry(g), t && bid !== null ? { tenderId: t.id, amount: E.clampBid(t, bid) } : null);
      });
    }
  }, [aiId, phase, bidding?.stage, bidderId, rebid, decision, tenderKey, act]);

  // Placement: size the crew and move the cards. Idempotent, so safe to re-run.
  useEffect(() => {
    if (aiId && phase === 'allocation') act((g) => playAllocation(g, aiId));
  }, [aiId, phase, roundKey, act]);

  // Collect finished contracts.
  useEffect(() => {
    if (aiId && phase === 'roundSummary') act((g) => completeReady(g, aiId));
  }, [aiId, phase, roundKey, act]);

  const thinking = !!aiId && phase === 'bidding' && rebid === 0 && decision?.key !== tenderKey;
  const revealed = phase === 'bidReveal' || phase === 'allocation' || phase === 'roundSummary';
  const lastDecision = revealed && decision?.key === tenderKey ? decision.decision : null;
  return { thinking, lastDecision };
}
