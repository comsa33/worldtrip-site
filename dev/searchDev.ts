/**
 * /api/search on dev and preview, where there is no Vercel to run api/.
 *
 * The same handler answers, with the key from .env.local (never in the
 * bundle: the page only ever fetches the path). Without a key, or with
 * SEARCH_FAKE=1, a stand-in ranks from the tags alone so the page can be
 * worked on without a call — a theme word lights that theme, a city name
 * finds its stays, anything else finds the night trains of India (the
 * board's example) so there is always something to fly to.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import { POST, queryOf, rankByTheme, themeOf, type SearchResult } from '../api/search';
import journeyData from '../src/data/journey.json' with { type: 'json' };
import tagsData from '../src/data/photoTags.json' with { type: 'json' };
import citiesData from '../src/data/cities.json' with { type: 'json' };

const stops = journeyData.stops;
const tagStops = (tagsData as { stops: Record<string, Record<string, number>> }).stops;
const cityNames = (citiesData as { cities: Record<string, { en: string }> }).cities;

function fake(q: string): SearchResult {
  const theme = themeOf(q);
  if (theme) return { theme, stops: rankByTheme(theme) };
  const w = q.toLowerCase();
  const byCity = stops
    .filter((s) => w.includes(s.city) || w.includes(cityNames[s.city]?.en.toLowerCase() ?? '\0'))
    .map((s) => ({ id: s.id, score: 0.9 }));
  if (byCity.length) return { stops: byCity };
  if (/^[a-z\s]*$/.test(w) && w.length < 3) return { stops: [] };
  // the no-answer screen, with and without near themes, and the faults — for working on them
  if (w.includes('없음'))
    return {
      stops: [],
      themes: [
        { id: 'animal', score: 2.4 },
        { id: 'street', score: 1.6 },
      ],
    };
  if (w.includes('없다')) return { stops: [] };
  const nightTrains = stops
    .filter((s) => s.countryCode === 'IN')
    .map((s) => {
      const t = tagStops[String(s.id)] ?? {};
      return { id: s.id, score: (t.night ?? 0) * (t.transit ?? 0) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const max = nightTrains[0]?.score || 1;
  return { stops: nightTrains.map((r) => ({ id: r.id, score: r.score / max })) };
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }
  const url = `http://${req.headers.host ?? 'localhost'}${(req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/'}`;
  return new Request(url, {
    method: req.method,
    headers,
    body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
  });
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function attach(server: ViteDevServer | PreviewServer) {
  const env = loadEnv(server.config.mode, server.config.root, '');
  const real = Boolean(env.TYPESAFE_API_KEY) && !process.env.SEARCH_FAKE;
  if (real) process.env.TYPESAFE_API_KEY = env.TYPESAFE_API_KEY;
  server.config.logger.info(
    `[search] /api/search ${real ? 'calls Jev' : 'is a stand-in (no key)'}`
  );
  server.middlewares.use('/api/search', (req, res, next) => {
    if (req.method !== 'POST') return next();
    void (async () => {
      const request = await toRequest(req);
      if (real) return send(res, await POST(request));
      const q = await queryOf(request);
      if (q === 'too_long') return send(res, Response.json({ error: 'too_long' }, { status: 413 }));
      if (!q) return send(res, Response.json({ error: 'invalid' }, { status: 400 }));
      await new Promise((r) => setTimeout(r, 400)); // a little of Jev's own time
      if (q.includes('오류'))
        return send(res, new Response('{"error":"upstream"}', { status: 502 }));
      if (q.includes('429'))
        return send(res, new Response('{"error":"rate_limited"}', { status: 429 }));
      if (q.includes('느림')) await new Promise((r) => setTimeout(r, 9000));
      return send(res, Response.json(fake(q)));
    })().catch(next);
  });
}

export function searchDev(): Plugin {
  return {
    name: 'worldtrip:search-dev',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
