import { GAME } from '../config';
import { activeProjects, boardFull, dueRoundIfWon, lastPayingRound, maxBid, minBid, remainingWork } from '../game/engine';
import type { GameState } from '../game/types';
import { chooseBid, estimateTender } from './planner';
import type { AiView } from './types';

/**
 * The AI's view of the game while bidding. Built only from public information:
 * never read game.bidding here, it holds the human's secret bid.
 */
export function buildView(game: GameState, playerId: string): AiView {
  if (game.market.length === 0) throw new Error('No tenders to bid on');
  const me = game.players.find((p) => p.id === playerId)!;
  const opp = game.players.find((p) => p.id !== playerId)!;
  const suggestion = chooseBid(game, playerId);

  return {
    round: game.round,
    tendersLeftInDeck: game.deck.length,
    rules: {
      baseSalary: me.salaryPerWorker,
      freelancerSalary: GAME.freelancerSalary,
      maxFreelancers: GAME.maxFreelancers,
      maxActiveProjects: GAME.maxActiveProjects,
      marketStayRounds: GAME.marketStayRounds,
      workRollByDie: GAME.workRoll,
    },
    market: game.market.map(({ tender: t, age }) => {
      const est = estimateTender(game, playerId, t);
      return {
        id: t.id,
        name: t.name,
        work: t.work,
        penaltyPerRoundLate: t.penalty,
        minBid: minBid(t),
        maxBid: maxBid(t),
        dueRoundIfWon: dueRoundIfWon(game.round, t),
        roundsOnOffer: age,
        estimate: {
          fullCost: est.fullCost,
          freelancersIfWin: est.freelancersIfWin,
          busyUntilRoundIfWin: est.busyUntilRoundIfWin,
        },
      };
    }),
    me: {
      name: me.name,
      money: me.money,
      workers: me.workers,
      freelancers: me.hiredWorkers,
      contracts: activeProjects(me).map((pr) => ({
        name: pr.tender.name,
        payout: pr.payout,
        remainingWork: remainingWork(pr),
        dueRound: pr.dueRound,
        penaltyPerRoundLate: pr.latePenalty,
        lostAfterRound: lastPayingRound(pr),
      })),
    },
    opponent: {
      name: opp.name,
      money: opp.money,
      workers: opp.workers,
      freelancers: opp.hiredWorkers,
      boardFull: boardFull(opp),
      contracts: activeProjects(opp).map((pr) => ({
        name: pr.tender.name,
        work: pr.requiredWork,
        payout: pr.payout,
        dueRound: pr.dueRound,
      })),
    },
    history: game.auctions.map((a) => ({
      round: a.round,
      tender: a.tender.name,
      work: a.tender.work,
      myBid: a.bids.find((b) => b.playerId === me.id)?.amount ?? null,
      opponentBid: a.bids.find((b) => b.playerId === opp.id)?.amount ?? null,
      winner: a.winnerId === me.id ? 'me' : 'opponent',
    })),
    suggestion: suggestion && { tenderId: suggestion.tenderId, bid: suggestion.amount, why: suggestion.why },
  };
}
