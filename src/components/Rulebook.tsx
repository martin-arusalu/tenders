import { useEffect } from 'react';
import { AI, GAME } from '../config';
import { tendersPerRound } from '../game/engine';

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

/** The rules, written from the live config so the numbers always match the game. */
export function Rulebook({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const g = GAME;
  const wages = g.startingWorkers * g.salaryPerWorker;
  const maxPlayers = AI.maxOpponents + 1;
  const perRound = tendersPerRound(2);
  const perRoundMax = tendersPerRound(maxPlayers);
  // "2 (3 with 3 players)": tenders on the table grow with the table.
  const perRoundText = perRoundMax === perRound ? `${perRound}` : `${perRound} (${perRoundMax} with ${maxPlayers} players)`;
  const rounds = Math.ceil(g.tendersPerGame / perRound);
  const roundsMax = Math.ceil(g.tendersPerGame / perRoundMax);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-box rulebook" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(e) => e.stopPropagation()}>
        <div className="rulebook-head">
          <h2 id="rules-title">How to play Tenders</h2>
          <button onClick={onClose} autoFocus>
            Close
          </button>
        </div>

        <section>
          <h3>The goal</h3>
          <p>
            You run a contracting firm. Win contracts by bidding for them, get the work done on time, and pay your crew.
            When the tenders run out and every contract is finished, <b>the player with the most money wins</b>. Go
            broke and you lose on the spot.
          </p>
        </section>

        <section>
          <h3>What you start with</h3>
          <ul>
            <li>
              <b>{g.startingMoney} money.</b>
            </li>
            <li>
              <b>A crew of {g.startingWorkers} workers</b>, paid {g.salaryPerWorker} each every round whether they work or
              not: {wages} per round.
            </li>
            <li>
              <b>A workboard</b> with room for {g.maxActiveProjects ?? 'any number of'} contracts at a time.
            </li>
          </ul>
          <p>
            The deck holds {g.tendersPerGame} tenders, and {perRoundText} go on the table each round, so the bidding
            lasts about {rounds === roundsMax ? rounds : `${roundsMax} to ${rounds}`} rounds. After that you keep playing until every contract is finished.
          </p>
        </section>

        <section>
          <h3>A round</h3>
          <ol>
            <li>
              <b>Tenders.</b> {perRoundText} tenders are on the table. Each shows the estimated work, how many rounds
              you have to finish it, and the penalty for every round it runs late.
            </li>
            <li>
              <b>Secret bids.</b> Everyone picks <b>at most one</b> tender and writes down a price, or passes.
            </li>
            <li>
              <b>Reveal.</b> On each tender, the <b>lowest bid wins</b>, and that bid is what the contract pays when you
              finish it. The winner rolls a die for the job's true size.
            </li>
            <li>
              <b>Place workers.</b> Drag your contracts forward along their rows: each space moved uses one worker this
              round.
            </li>
            <li>
              <b>Work &amp; wages.</b> The work is done and everyone pays wages. Finished contracts are completed for their
              pay.
            </li>
          </ol>
        </section>

        <section>
          <h3>Bidding</h3>
          <ul>
            <li>
              A bid must be between <b>{g.minBidPerWork} × work</b> (the minimum) and <b>{g.maxBidPerWork} × work</b> (the
              client's budget). Each card shows its range.
            </li>
            <li>
              If you're <b>alone on a tender</b>, you win it at whatever you bid. If others pick the <b>same one</b>, the
              cheapest bid gets it and the others get nothing this round. Reading which tender each opponent wants is the
              heart of the game.
            </li>
            <li>
              <b>Ties:</b> the tied player with fewer contracts on their board wins. If that's equal too, the tied
              players bid again, secretly, at or below the tied price, until one goes lower. If nobody can go lower (tied
              at the minimum, or after {g.maxRebids} rebids), a coin flip decides.
            </li>
            <li>
              A tender nobody bids on stays on the table for {g.marketStayRounds - 1} more round
              {g.marketStayRounds - 1 === 1 ? '' : 's'}, then the client goes elsewhere. After the auctions, the next
              round's tenders are shown face up.
            </li>
            {g.maxActiveProjects !== null && (
              <li>
                With a <b>full board</b> ({g.maxActiveProjects} contracts) you can't bid. Your opponents can see that, and
                may charge the full budget.
              </li>
            )}
          </ul>
        </section>

        <section>
          <h3>The die roll</h3>
          <p>Estimates are never exact. When you win a tender, roll a die and adjust its work:</p>
          <table className="rule-table">
            <tbody>
              <tr>
                {g.workRoll.map((_, i) => (
                  <th key={i}>{i + 1}</th>
                ))}
              </tr>
              <tr>
                {g.workRoll.map((d, i) => (
                  <td key={i} className={d > 0 ? 'neg' : d < 0 ? 'pos' : ''}>
                    {signed(d)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3>Workers</h3>
          <ul>
            <li>One worker does one space of work per round. Workers left unassigned still get paid.</li>
            <li>
              Take on up to <b>{g.maxFreelancers} freelancers</b> at {g.freelancerSalary} per round each when you're
              busy, and let them go again when you're not.
            </li>
          </ul>
        </section>

        <section>
          <h3>Deadlines and late contracts</h3>
          <ul>
            <li>
              A tender with <b>N rounds to finish</b> is due by the end of round N, counting the round you win it: N = 1
              means this round, N = 2 the end of next round.
            </li>
            <li>
              Finished late, it pays your bid <b>minus the penalty for every round late</b>.
            </li>
            <li>
              Once the penalties would eat the whole payment, <b>the client takes the job away</b>: you get nothing for
              it, but it costs you nothing more. Late cards show the round after which they're lost.
            </li>
          </ul>
        </section>

        <section>
          <h3>Getting paid, and going broke</h3>
          <ul>
            <li>
              A contract that reaches the finish line waits for you to press <b>Complete</b>. You're paid then.
            </li>
            {g.bankruptBelow !== null && (
              <li>
                If your money is <b>below {g.bankruptBelow}</b> at the end of a round, you're <b>bankrupt</b>: you lose and
                the game ends. Pay only comes when a job is finished, so watch your cash while you take on work.
              </li>
            )}
            {g.closeShopWhenDone && (
              <li>
                Once there are no tenders left and your board is empty, you close shop and stop paying wages while the
                others finish up.
              </li>
            )}
          </ul>
        </section>

        <section>
          <h3>Tips</h3>
          <ul>
            <li>Look at your opponents' boards before bidding. A busy opponent can't take a big or urgent job.</li>
            <li>A tender nobody else wants can go for close to the full budget. One that others want too is a price war.</li>
            <li>Idle workers cost money, but so do late penalties and freelancers. Don't take more than your crew can finish.</li>
          </ul>
        </section>

        <button className="primary big" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
