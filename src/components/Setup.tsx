import { useState } from 'react';
import type { AiStatus } from '../ai/advisors';
import { checkOpenAiKey } from '../ai/openai';
import { AI, GAME, TABLE } from '../config';

function randomNames(): string[] {
  return [...TABLE.namePool].sort(() => Math.random() - 0.5).slice(0, 2);
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

export function Setup({
  initialNames,
  initialVsAi,
  apiKey,
  onApiKeyChange,
  serverStatus,
  onStart,
  onShowRules,
}: {
  initialNames?: string[];
  initialVsAi: boolean;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  serverStatus: AiStatus | null;
  onStart: (names: string[], vsAi: boolean) => void;
  onShowRules: () => void;
}) {
  const [names, setNames] = useState<string[]>(() => initialNames ?? TABLE.namePool.slice(0, 2));
  const [vsAi, setVsAi] = useState(initialVsAi);
  const trimmed = names.map((n, i) => n.trim() || `Player ${i + 1}`);
  const duplicate = trimmed[0] === trimmed[1];

  return (
    <div className="setup panel">
      <h1>Tenders</h1>
      <p className="muted">
        A 2-player game about running a contracting firm. Each round {GAME.tendersPerRound} tenders go on the table:
        pick one, bid in secret (lowest bid wins), then get the work done with your crew of {GAME.startingWorkers}{' '}
        before the deadline. Wages cost {GAME.startingWorkers * GAME.salaryPerWorker} every round. Start with{' '}
        {GAME.startingMoney}; most money at the end wins.
      </p>

      <div className="seg" role="radiogroup" aria-label="Opponent">
        <button role="radio" aria-checked={vsAi} className={vsAi ? 'on' : ''} onClick={() => setVsAi(true)}>
          vs AI
        </button>
        <button role="radio" aria-checked={!vsAi} className={!vsAi ? 'on' : ''} onClick={() => setVsAi(false)}>
          2 players, one device
        </button>
      </div>
      {vsAi && <ApiKeyField apiKey={apiKey} onChange={onApiKeyChange} serverStatus={serverStatus} />}

      <div className="stack">
        {['You (bottom of the table)', vsAi ? 'AI opponent' : 'Opponent (across from you)'].map((label, i) => (
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
        <button onClick={() => setNames(randomNames())}>Random names</button>
        <button onClick={onShowRules}>How to play</button>
        <button className="primary big" disabled={duplicate} onClick={() => onStart(trimmed, vsAi)}>
          Start game
        </button>
      </div>
      {duplicate && <p className="warn">Names must be different.</p>}
    </div>
  );
}
