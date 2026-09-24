import { GAME, TENDERS } from '../config';
import type { Tender } from './types';

export const TENDER_DECK: Tender[] = TENDERS.map((d, i) => ({ ...d, id: `T${i + 1}` }));

// Config sanity checks: fail loudly at startup rather than mid-game.
const worstRoll = Math.max(...GAME.workRoll);
for (const t of TENDER_DECK) {
  if (t.work < GAME.minTenderWork) throw new Error(`Tender "${t.name}" has ${t.work} work, below minTenderWork ${GAME.minTenderWork}`);
  if (t.penalty < 1 || t.penalty > t.work) throw new Error(`Tender "${t.name}" penalty ${t.penalty} must be between 1 and its work (${t.work})`);
  if (t.work + Math.min(...GAME.workRoll) < 1) throw new Error(`Tender "${t.name}" could roll down to no work at all`);
  if (t.work + worstRoll > GAME.boardSpaces) {
    throw new Error(`Tender "${t.name}" can roll up to ${t.work + worstRoll} work but the board has ${GAME.boardSpaces} spaces`);
  }
}
if (GAME.workRoll.length !== 6) throw new Error('GAME.workRoll needs one entry per die face (6)');
if (TENDER_DECK.length < GAME.tendersPerGame) {
  console.warn(`Only ${TENDER_DECK.length} tenders defined; games will have that many instead of ${GAME.tendersPerGame}.`);
}
