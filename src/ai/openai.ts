import { AI } from '../config.ts';
import { BID_SCHEMA, SYSTEM_PROMPT, parseBidDecision, userMessage } from './prompt.ts';
import type { AiView, BidDecision } from './types.ts';

/**
 * Talks to OpenAI with plain fetch, so it runs both in the browser (the player's own key)
 * and in the dev server (the key from .env.local).
 */

export async function openAiBid(
  view: AiView,
  { apiKey, model = AI.openAiModel }: { apiKey: string; model?: string },
  signal?: AbortSignal,
): Promise<BidDecision> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage(view) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'bid_decision', strict: true, schema: BID_SCHEMA },
      },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('OpenAI returned no content');
  return parseBidDecision(JSON.parse(content), 'openai');
}

/** Checks a key without spending anything: listing models is free. */
export async function checkOpenAiKey(apiKey: string): Promise<'ok' | 'invalid' | 'unreachable'> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'ok';
    return res.status === 401 || res.status === 403 ? 'invalid' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
