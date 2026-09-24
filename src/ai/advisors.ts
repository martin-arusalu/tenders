import { AI } from '../config';
import { openAiBid } from './openai';
import { parseBidDecision } from './prompt';
import type { AiView, BidAdvisor, BidDecision } from './types';

/** Follows the planner's suggestion. Works offline, used as the fallback. */
export const rulesAdvisor: BidAdvisor = {
  async decideBid(view) {
    const s = view.suggestion;
    if (!s) return { tenderId: null, bid: null, reasoning: 'Nothing on the table pays for us this round.', source: 'rules' };
    const name = view.market.find((t) => t.id === s.tenderId)?.name ?? 'it';
    return {
      tenderId: s.tenderId,
      bid: s.bid,
      reasoning: s.why === 'nobody else wants it' ? `${name} suits us. Full price.` : `We want ${name} too. Let's see who's sharper.`,
      source: 'rules',
    };
  },
};

export interface AiStatus {
  /** Provider name, e.g. 'openai'. */
  provider: string;
  ready: boolean;
  detail: string;
}

/** The dev server's backend (see server/), which uses the key in .env.local. Not there on a static host. */
export async function fetchAiStatus(): Promise<AiStatus> {
  try {
    const res = await fetch('/api/ai/status');
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as AiStatus;
  } catch {
    return { provider: 'none', ready: false, detail: 'AI server not reachable' };
  }
}

/** On any failure or timeout, falls back to the rules so the game never stalls. */
function withFallback(
  decide: (view: AiView, signal: AbortSignal) => Promise<BidDecision>,
  timeoutMs: number,
  fallback: BidAdvisor,
): BidAdvisor {
  return {
    async decideBid(view, signal) {
      try {
        const timeout = AbortSignal.timeout(timeoutMs);
        return await decide(view, signal ? AbortSignal.any([signal, timeout]) : timeout);
      } catch (err) {
        console.warn('AI bid failed, using rules:', err);
        return fallback.decideBid(view, signal);
      }
    },
  };
}

/** Asks the dev server, which calls the LLM with its own key. */
export function remoteAdvisor(timeoutMs = AI.requestTimeoutMs, fallback: BidAdvisor = rulesAdvisor): BidAdvisor {
  return withFallback(
    async (view, signal) => {
      const res = await fetch('/api/ai/bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view }),
        signal,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return parseBidDecision(body, String(body.source ?? 'remote'));
    },
    timeoutMs,
    fallback,
  );
}

/** Calls OpenAI straight from the browser with the player's own key. No server needed. */
export function openAiAdvisor(apiKey: string, timeoutMs = AI.requestTimeoutMs, fallback: BidAdvisor = rulesAdvisor): BidAdvisor {
  return withFallback((view, signal) => openAiBid(view, { apiKey }, signal), timeoutMs, fallback);
}

// ---------- the player's key ----------

const KEY_STORAGE = 'tenders.openaiKey';

/** The saved key, or '' if none (or storage is blocked, e.g. a private window). */
export function loadApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

/** Saves the key in this browser only. An empty key removes it. */
export function saveApiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage blocked: the key still works until the page is closed.
  }
}
