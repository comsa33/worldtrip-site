/**
 * Finding a stop by what the visitor says — "night train", "눈 오는 거리".
 *
 * One request to TypeSafe's Jev scores every stop of the journey against the
 * words, and the stops come back ranked. Jev returns typed values, never
 * prose, so nothing is written here: the answer can only ever be an order of
 * stops that already exist. What is sent about a stop is what the site already
 * shows — its city, its dates, its published story (cityNotes en) and how many
 * of its photos are of each theme (photoTags). No Apple caption, no label.
 *
 * A Vercel Function (web signature, Node runtime). On dev and preview the
 * plugin in dev/searchDev.ts answers the same path with this handler.
 */
import journeyData from '../src/data/journey.json';
import notesData from '../src/data/cityNotes.json';
import tagsData from '../src/data/photoTags.json';
import citiesData from '../src/data/cities.json';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const TIMEOUT_MS = 8000;

/** A query longer than this was not typed into the header. */
export const MAX_QUERY_CHARS = 80;
const MAX_BODY_BYTES = 2000;

/* Best effort: on serverless each instance keeps its own window, so this caps
   one client hammering one instance, not the total. The firewall rule and the
   spend cap on the TypeSafe console bound the bill. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

/* A ceiling per instance per day, whoever is asking. */
const DAILY_CEILING = 300;
let day = '';
let dayCount = 0;

function overDailyCeiling(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
  }
  dayCount += 1;
  return dayCount > DAILY_CEILING;
}

/* The same words asked twice (a reload, a second visitor) are answered from
   memory, keyed by a hash so the words themselves are not kept. */
const CACHE_TTL_MS = 60 * 60_000;
const cache = new Map<string, { at: number; result: SearchResult }>();

async function hashOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* A key that is revoked or out of credit fails the same way on every call, so
   once TypeSafe says so, stop asking for a while. 402/403 are treated like
   401 (the out-of-credit status is not documented). */
const PAUSE_MS = 10 * 60_000;
let pausedUntil = 0;

/* Only the page itself calls this. Browsers send Origin on every POST; a
   mismatch is another site or a script borrowing the endpoint. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ---- what Jev is told about each stop ----------------------------------------

type Tags = {
  categories: { id: string; ko: string; en: string }[];
  stops: Record<string, Record<string, number>>;
};
type Notes = Record<string, { en?: { title?: string; story?: string } }>;
type Cities = {
  cities: Record<string, { en: string }>;
  countries: Record<string, { en: string }>;
};

const tags = tagsData as Tags;
const notes = notesData as Notes;
const cities = citiesData as Cities;
const stops = journeyData.stops;

const THEME_EN: Record<string, string> = Object.fromEntries(
  tags.categories.map((c) => [c.id, c.en.toLowerCase()])
);
/* "me" is the one theme that is not a thing in the picture but who is in it. */
const describeTheme = (id: string, n: number) =>
  id === 'me' ? `the traveller himself in ${n}` : `${THEME_EN[id] ?? id} ${n}`;

export type StopSummary = { id: number; text: string };

/** One line a stop, built once: city, country, dates, story, themes. */
export const SUMMARIES: StopSummary[] = stops.flatMap((s) => {
  const t = tags.stops[String(s.id)];
  const story = notes[String(s.id)]?.en?.story?.replace(/\s*\n\s*/g, ' ').trim();
  if (!t && !story) return [];
  const dates = s.endDate !== s.startDate ? `${s.startDate} to ${s.endDate}` : s.startDate;
  const parts = [
    `${cities.cities[s.city]?.en ?? s.city}, ${cities.countries[s.countryCode]?.en ?? s.countryCode} (${dates})`,
  ];
  if (story) parts.push(story);
  if (t) {
    const themes = Object.entries(t)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => describeTheme(id, n))
      .join(', ');
    parts.push(`Photos of: ${themes}.`);
  }
  return [{ id: s.id, text: parts.join(' — ') }];
});

const QUESTION =
  'How well does the stop `stop` match what the query in the state is looking for — the place, the scene, the experience or the kind of photo?';
const LEVELS = [
  'Unrelated to the query',
  'Loosely related',
  'Matches part of the query',
  'Directly matches the query',
];
// Asked in the same request, so it costs nothing extra: a line of chat or a
// string of letters would otherwise be ranked as if it named a place.
const GATE_KEY = '_is_a_search';
const GATE_MIN = 0.5;
const GATE =
  'Is the query in the state looking for a place, a scene, an experience, a time or a kind of photo from a journey — something one could search travel photos for?';

/* A score is where the stop falls among the levels, 0 to 3. Measured
   (2026-10-02, five queries): the stops that were the answer sat at 1.66 and
   up, the loosely related ones at 1.4 and under, so the line is 1.5. A query
   that is not a search ("ㅁㄴㅇㄹ") gated at 0.13, a penguin at 0.44. */
const SCORE_MAX = LEVELS.length - 1;
const SCORE_MIN = 1.5;
/** How many stops come back at most. */
export const TOP = 12;

// ---- the words a theme already answers -----------------------------------------

/* Some words are a theme by another name, and a theme is answered from the
   tags with no call at all: the stops that have it, most photos first. */
const ME_WORDS = new Set([
  '나',
  '내 사진',
  '내사진',
  '내가 나온',
  '내가 나온 사진',
  '셀카',
  '셀피',
  'me',
  'myself',
  'selfie',
  'selfies',
  'my photos',
  'photos of me',
]);

export function normalize(q: string): string {
  return q.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** The theme id these words are, or null. */
export function themeOf(q: string): string | null {
  const w = normalize(q).toLowerCase();
  if (!w) return null;
  if (ME_WORDS.has(w)) return 'me';
  for (const c of tags.categories) {
    if (w === c.ko || w === c.en.toLowerCase()) return c.id;
  }
  return null;
}

/** A stop and how well it answered, 0 to 1. */
export type Ranked = { id: number; score: number };

/** A theme's stops, most photos first, scores relative to the fullest. */
export function rankByTheme(theme: string): Ranked[] {
  const out: Ranked[] = [];
  for (const s of stops) {
    const n = tags.stops[String(s.id)]?.[theme];
    if (n) out.push({ id: s.id, score: n });
  }
  const max = out.reduce((m, r) => Math.max(m, r.score), 0) || 1;
  return out.sort((a, b) => b.score - a.score).map((r) => ({ id: r.id, score: r.score / max }));
}

// ---- the handler ------------------------------------------------------------------

export type SearchError = 'invalid' | 'too_long' | 'rate_limited' | 'unavailable' | 'upstream';
export type SearchResult = {
  /** when the words were a theme, that theme (the page may light it instead) */
  theme?: string;
  /** best first; empty when nothing matched or the words were not a search */
  stops: Ranked[];
};

type Answer = { type?: string; score?: number; confidence?: number; noul?: number };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (error: SearchError, status: number) => json({ error }, status);

/** Reads the body and takes the query out of it, or null. */
export async function queryOf(request: Request): Promise<string | null | 'too_long'> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return 'too_long';
  try {
    const body = (await request.json()) as { q?: unknown };
    const q = typeof body?.q === 'string' ? normalize(body.q) : '';
    if (q.length > MAX_QUERY_CHARS) return 'too_long';
    return q || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key || Date.now() < pausedUntil) return fail('unavailable', 503);
  if (!sameOrigin(request)) return fail('invalid', 403);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (limited(ip)) return fail('rate_limited', 429);

  const q = await queryOf(request);
  if (q === 'too_long') return fail('too_long', 413);
  if (!q) return fail('invalid', 400);

  const theme = themeOf(q);
  if (theme) return json({ theme, stops: rankByTheme(theme) } satisfies SearchResult);

  const hash = await hashOf(q.toLowerCase());
  const cached = cache.get(hash);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return json(cached.result);

  if (overDailyCeiling()) return fail('unavailable', 503);

  /* One request, one read of the words: every stop is scored against them
     and the words themselves are checked. Jev ingests the state once, so the
     questions cost little beyond their own text. */
  const questions: Record<string, unknown> = {};
  for (const s of SUMMARIES) {
    questions[String(s.id)] = {
      type: 'score',
      instructions: { stop: s.text, question: QUESTION },
      criteria: LEVELS,
    };
  }
  questions[GATE_KEY] = { type: 'noul', instructions: GATE };

  let answers: Record<string, Answer>;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state: { query: q }, questions }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) return fail('rate_limited', 429);
    if ([401, 402, 403].includes(res.status)) {
      pausedUntil = Date.now() + PAUSE_MS;
      console.error(`[search] TypeSafe refused the key (${res.status}); pausing for 10 min`);
      return fail('unavailable', 503);
    }
    if (!res.ok) return fail('upstream', 502);
    const data = (await res.json()) as {
      answers?: Record<string, Answer>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    answers = data.answers ?? {};
    console.log(`[search] jev ${q.length} chars, ${data.usage?.input_tokens ?? '?'} in`);
  } catch {
    return fail('upstream', 502);
  }

  const result: SearchResult = { stops: [] };
  if ((answers[GATE_KEY]?.noul ?? 1) >= GATE_MIN) {
    result.stops = SUMMARIES.map((s) => ({ id: s.id, score: answers[String(s.id)]?.score ?? 0 }))
      .filter((r) => r.score >= SCORE_MIN)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP)
      .map((r) => ({ id: r.id, score: r.score / SCORE_MAX }));
  }

  if (cache.size > 500) cache.clear();
  cache.set(hash, { at: Date.now(), result });
  return json(result);
}
