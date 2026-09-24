import type { AiView, BidDecision } from '../../src/ai/types.ts';

/**
 * A backend that prices a tender for the AI seat. To add one (e.g. JEV):
 * implement this in server/providers/<name>.ts and register it in ./index.ts.
 */
export interface BidProvider {
  /** Short id shown in the UI and returned as BidDecision.source. */
  readonly name: string;
  /** Human-readable setup state, e.g. the model in use. */
  readonly detail: string;
  decideBid(view: AiView, signal: AbortSignal): Promise<BidDecision>;
}

/** Server-only environment (never VITE_-prefixed, so it is not bundled into the browser). */
export type ServerEnv = Record<string, string | undefined>;
