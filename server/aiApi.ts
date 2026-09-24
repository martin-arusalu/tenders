import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { AiView } from '../src/ai/types.ts';
import { createProvider, type ServerEnv } from './providers/index.ts';

/**
 * Serves the AI endpoints from the Vite dev/preview server, so API keys stay server-side.
 *   GET  /api/ai/status  → { provider, ready, detail }
 *   POST /api/ai/bid     { view: AiView } → BidDecision
 * Dev/preview only. On a static host (GitHub Pages) players enter their own key instead (src/ai/advisors.ts).
 */
export function aiApi(env: ServerEnv): Plugin {
  const provider = createProvider(env);
  const timeoutMs = Number(env.AI_TIMEOUT_MS ?? 25_000);

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && req.url === '/status') {
      return typeof provider === 'string'
        ? send(200, { provider: 'none', ready: false, detail: provider })
        : send(200, { provider: provider.name, ready: true, detail: provider.detail });
    }

    if (req.method === 'POST' && req.url === '/bid') {
      if (typeof provider === 'string') return send(503, { error: provider });
      try {
        const { view } = JSON.parse(await readBody(req)) as { view: AiView };
        const started = Date.now();
        const decision = await provider.decideBid(view, AbortSignal.timeout(timeoutMs));
        console.log(
          `[ai] R${view.round}: ${decision.bid === null ? 'pass' : `${view.market.find((t) => t.id === decision.tenderId)?.name ?? decision.tenderId} for ${decision.bid}`} (${provider.name}, ${Date.now() - started}ms)`,
        );
        return send(200, decision);
      } catch (err) {
        console.error('[ai] bid failed:', err);
        return send(502, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    send(404, { error: 'Not found' });
  }

  return {
    name: 'tenders-ai-api',
    configureServer(server) {
      server.middlewares.use('/api/ai', (req, res) => void handle(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ai', (req, res) => void handle(req, res));
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100_000) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
