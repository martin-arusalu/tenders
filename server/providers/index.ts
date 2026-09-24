import { AI } from '../../src/config.ts';
import { openAiProvider } from './openai.ts';
import type { BidProvider, ServerEnv } from './types.ts';

export type { BidProvider, ServerEnv } from './types.ts';

/** Picks the backend from AI_PROVIDER (default: openai). Returns an error string if it can't be set up. */
export function createProvider(env: ServerEnv): BidProvider | string {
  const which = env.AI_PROVIDER ?? 'openai';
  switch (which) {
    case 'openai':
      if (!env.OPENAI_API_KEY) return 'OPENAI_API_KEY is not set in .env.local';
      return openAiProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL ?? AI.openAiModel });
    // case 'jev':
    //   return jevProvider({ ... });
    default:
      return `Unknown AI_PROVIDER "${which}"`;
  }
}
