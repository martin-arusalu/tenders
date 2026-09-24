import { openAiBid } from '../../src/ai/openai.ts';
import type { BidProvider } from './types.ts';

export function openAiProvider({ apiKey, model }: { apiKey: string; model: string }): BidProvider {
  return {
    name: 'openai',
    detail: `OpenAI ${model}`,
    decideBid: (view, signal) => openAiBid(view, { apiKey, model }, signal),
  };
}
