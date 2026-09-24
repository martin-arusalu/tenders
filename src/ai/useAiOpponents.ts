import { useEffect, useRef, useState } from 'react';
import * as E from '../game/engine';
import type { GameState } from '../game/types';
import { completeReady, playAllocation, rebidAmount } from './planner';
import type { BidAdvisor, BidDecision } from './types';
import { buildView } from './view';

/**
 * Plays the AI seats automatically. Each AI's bid comes from the advisor (all fetched as soon as
 * bidding opens, in parallel with the human's entry); everything else is the planner.
 * One hook drives every AI seat, since whose turn it is to bid is shared between them.
 */
export function useAiOpponents(
  game: GameState | null,
  act: (fn: (g: GameState) => GameState) => void,
  /** Keep this array stable between renders (useMemo): it's an effect dependency. */
  aiIds: string[],
  advisor: BidAdvisor,
) {
  /** Latest decision per AI, keyed by game + round + deal, so the bid reveal can show the reasoning. */
  const [decisions, setDecisions] = useState<Record<string, { key: string; decision: BidDecision }>>({});
  const requested = useRef<Record<string, string>>({});

  const phase = game?.phase;
  const bidding = game?.bidding;
  const roundKey = game ? `${game.seed}|${game.round}` : '';
  // A debug redeal deals new tenders in the same round, so the deal count is part of the key.
  const tenderKey = `${roundKey}|${game?.tendersDealt}`;
  const isAi = (id: string | null | undefined) => !!id && aiIds.includes(id);

  // Choose and price a tender as soon as bidding opens.
  useEffect(() => {
    if (!game || phase !== 'bidding' || game.bidding?.rebidTenderId) return;
    for (const id of aiIds) {
      if (E.boardFull(game.players.find((p) => p.id === id)!)) continue; // can't bid: no need to ask
      const key = tenderKey;
      if (requested.current[id] === key) continue;
      requested.current[id] = key;
      advisor.decideBid(buildView(game, id)).then((d) => {
        if (requested.current[id] === key) setDecisions((all) => ({ ...all, [id]: { key, decision: d } }));
      });
    }
  }, [game, aiIds, phase, tenderKey, advisor]);

  // Handoffs: the human goes straight to the form; an AI submits once its decision is in.
  // Tie-break rebids are priced by the planner, not the advisor.
  const bidderId = bidding && bidding.index < bidding.order.length ? bidding.order[bidding.index] : null;
  const rebid = bidding?.rebid ?? 0;
  const bidderDecision = bidderId ? decisions[bidderId] : undefined;
  useEffect(() => {
    if (aiIds.length === 0 || phase !== 'bidding' || bidding?.stage !== 'handoff' || !bidderId) return;
    const aiTurn = (g: GameState) => g.bidding?.stage === 'handoff' && E.currentBidder(g)?.id === bidderId;
    if (!isAi(bidderId)) {
      act(E.showBidEntry);
    } else if (E.boardFull(E.currentBidder(game!)!)) {
      act((g) => (aiTurn(g) ? E.submitBid(E.showBidEntry(g), null) : g));
    } else if (rebid > 0) {
      act((g) => (aiTurn(g) ? E.submitBid(E.showBidEntry(g), { tenderId: g.bidding!.rebidTenderId!, amount: rebidAmount(g, bidderId) }) : g));
    } else if (bidderDecision?.key === tenderKey) {
      const { tenderId, bid } = bidderDecision.decision;
      act((g) => {
        if (!aiTurn(g)) return g;
        // Models don't always respect the rules: an unknown tender is a pass, a price out of range is clamped.
        const t = tenderId ? E.offeredTender(g, tenderId) : null;
        return E.submitBid(E.showBidEntry(g), t && bid !== null ? { tenderId: t.id, amount: E.clampBid(t, bid) } : null);
      });
    }
  }, [aiIds, phase, bidding?.stage, bidderId, rebid, bidderDecision, tenderKey, act]);

  // A tie-break rebid between AIs only leaves the human nothing to do, so reveal it straight away.
  const aiOnlyRebidDone = rebid > 0 && bidding?.stage === 'done' && bidding.order.every(isAi);
  useEffect(() => {
    if (aiOnlyRebidDone) act((g) => (g.bidding?.stage === 'done' && g.bidding.rebid > 0 ? E.revealBids(g) : g));
  }, [aiOnlyRebidDone, act]);

  // Placement: size the crew and move the cards. Idempotent, so safe to re-run.
  useEffect(() => {
    if (phase === 'allocation') for (const id of aiIds) act((g) => playAllocation(g, id));
  }, [aiIds, phase, roundKey, act]);

  // Collect finished contracts.
  useEffect(() => {
    if (phase === 'roundSummary') for (const id of aiIds) act((g) => completeReady(g, id));
  }, [aiIds, phase, roundKey, act]);

  const current = (id: string) => (decisions[id]?.key === tenderKey ? decisions[id].decision : null);
  /** AIs still waiting on their advisor this round. */
  const thinking = new Set(
    phase === 'bidding' && rebid === 0 && game
      ? aiIds.filter((id) => !current(id) && !E.boardFull(game.players.find((p) => p.id === id)!))
      : [],
  );
  const revealed = phase === 'bidReveal' || phase === 'allocation' || phase === 'roundSummary';
  const lastDecisions = revealed
    ? aiIds.flatMap((id) => {
        const d = current(id);
        return d ? [{ playerId: id, ...d }] : [];
      })
    : [];
  return { thinking, lastDecisions };
}
