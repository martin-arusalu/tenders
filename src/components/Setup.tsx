import { useState } from 'react';
import type { AiStatus } from '../ai/advisors';
import { checkOpenAiKey } from '../ai/openai';
import { AI, GAME, TABLE } from '../config';
import { tendersPerRound } from '../game/engine';

function randomNames(count: number): string[] {
  return [...TABLE.namePool].sort(() => Math.random() - 0.5).slice(0, count);
}

/** The player's own OpenAI key. It stays in this browser and is only sent to OpenAI. */
function ApiKeyField({
  apiKey,
  onChange,
  serverStatus,
}: {
  apiKey: string;
  onChange: (key: string) => void;
  serverStatus: AiStatus | null;
}) {
  const [draft, setDraft] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setChecking(true);
    setError('');
    const result = await checkOpenAiKey(key);
    setChecking(false);
    if (result === 'invalid') return setError('OpenAI rejected this key. Check it and try again.');
    if (result === 'unreachable') setError("Couldn't reach OpenAI to check the key. Saved it anyway.");
    onChange(key);
    setDraft('');
  };

  if (apiKey) {
    return (
      <div className="api-key">
        <p className="small">
          AI bids are priced by OpenAI {AI.openAiModel} with your key ({apiKey.slice(0, 3)}…{apiKey.slice(-4)}).
        </p>
        {error && <p className="small warn">{error}</p>}
        <button
          onClick={() => {
            setError('');
            onChange('');
          }}
        >
          Remove key
        </button>
      </div>
    );
  }

  return (
    <div className="api-key">
      <label>
        <span className="small muted">OpenAI API key (optional)</span>
        <div className="row gap">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
          <button disabled={!draft.trim() || checking} onClick={() => void save()}>
            {checking ? 'Checking…' : 'Save'}
          </button>
        </div>
      </label>
      {error && <p className="small warn">{error}</p>}
      <p className="small muted">
        {serverStatus?.ready
          ? `Without a key, AI bids are priced by ${serverStatus.detail} on the dev server.`
          : 'Without a key, the AI bids with built-in rules.'}{' '}
        Your key is saved in this browser only and sent only to OpenAI. Each AI bid is one request, billed to your
        OpenAI account.{' '}
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
          Get a key
        </a>
      </p>
    </div>
  );
}

/** Opponent choices: AI count, 0 = two humans sharing the device. */
const MODES: { ais: number; label: string }[] = [
  ...Array.from({ length: AI.maxOpponents }, (_, i) => AI.maxOpponents - i).map((n) => ({ ais: n, label: `vs ${n} AI${n > 1 ? 's' : ''}` })),
  { ais: 0, label: '2 players, one device' },
];

export function Setup({
  initialNames,
  initialAiCount,
  apiKey,
  onApiKeyChange,
  serverStatus,
  onStart,
  onShowRules,
}: {
  initialNames?: string[];
  initialAiCount: number;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  serverStatus: AiStatus | null;
  onStart: (names: string[], aiCount: number) => void;
  onShowRules: () => void;
}) {
  // Enough names for the biggest table; only the first `seats` are used.
  const [names, setNames] = useState<string[]>(() => {
    const pool = TABLE.namePool;
    return [...(initialNames ?? []), ...pool.filter((n) => !initialNames?.includes(n))].slice(0, AI.maxOpponents + 1);
  });
  const [aiCount, setAiCount] = useState(initialAiCount);
  const seats = aiCount > 0 ? aiCount + 1 : 2;
  const trimmed = names.slice(0, seats).map((n, i) => n.trim() || `Player ${i + 1}`);
  const duplicate = new Set(trimmed).size < trimmed.length;
  const labels = ['You (bottom of the table)', ...trimmed.slice(1).map((_, i) =>
    aiCount > 0 ? `AI opponent${aiCount > 1 ? ` ${i + 1}` : ''}` : 'Opponent (across from you)',
  )];

  return (
    <div className="setup panel">
      <h1>Tenders</h1>
      <p className="muted">
        A game for {seats} players about running a contracting firm. Each round {tendersPerRound(seats)} tenders go on
        the table: pick one, bid in secret (lowest bid wins), then get the work done with your crew of{' '}
        {GAME.startingWorkers} before the deadline. Wages cost {GAME.startingWorkers * GAME.salaryPerWorker} every
        round. Start with {GAME.startingMoney}; most money at the end wins.
      </p>

      <div className="seg" role="radiogroup" aria-label="Opponents">
        {MODES.map((m) => (
          <button key={m.ais} role="radio" aria-checked={aiCount === m.ais} className={aiCount === m.ais ? 'on' : ''} onClick={() => setAiCount(m.ais)}>
            {m.label}
          </button>
        ))}
      </div>
      {aiCount > 0 && <ApiKeyField apiKey={apiKey} onChange={onApiKeyChange} serverStatus={serverStatus} />}

      <div className="stack">
        {labels.map((label, i) => (
          <label key={i}>
            <span className="small muted">{label}</span>
            <input
              value={names[i]}
              placeholder={`Player ${i + 1}`}
              onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
            />
          </label>
        ))}
      </div>
      <div className="row gap" style={{ marginTop: 12 }}>
        <button onClick={() => setNames(randomNames(names.length))}>Random names</button>
        <button onClick={onShowRules}>How to play</button>
        <button className="primary big" disabled={duplicate} onClick={() => onStart(trimmed, aiCount)}>
          Start game
        </button>
      </div>
      {duplicate && <p className="warn">Names must be different.</p>}
    </div>
  );
}
