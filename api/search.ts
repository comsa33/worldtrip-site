/**
 * Finding a stop by what the visitor says — "night train", "눈 오는 거리".
 *
 * One request to TypeSafe's Jev scores every stop of the journey against the
 * words, and the stops come back ranked. Jev returns typed values, never
 * prose, so nothing is written here: the answer can only ever be an order of
 * stops that already exist. What is sent about a stop is what the site already
 * shows — its city, its dates, its published story (cityNotes en), the
 * captions of its photos (en, scripts/build-stop-captions.mjs) and how many of
 * its photos are of each theme (photoTags). No Apple caption, no label, no name.
 *
 * A Vercel Function (web signature, Node runtime). On dev and preview the
 * plugin in dev/searchDev.ts answers the same path with this handler.
 */
import journeyData from '../src/data/journey.json' with { type: 'json' };
import notesData from '../src/data/cityNotes.json' with { type: 'json' };
import tagsData from '../src/data/photoTags.json' with { type: 'json' };
import citiesData from '../src/data/cities.json' with { type: 'json' };
import captionsData from './stopCaptions.json' with { type: 'json' };

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

/* A ceiling per instance per day, whoever is asking — one for the stops, one
   for the photos (the book's own request, B), counted apart. */
const DAILY_CEILING = 100;
const DAILY_PHOTO_CEILING = 100;
let day = '';
let dayCount = 0;
let dayPhotoCount = 0;

function overDailyCeiling(photos = false): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
    dayPhotoCount = 0;
  }
  if (photos) {
    dayPhotoCount += 1;
    return dayPhotoCount > DAILY_PHOTO_CEILING;
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
const captions = captionsData as Record<string, { id: string; en: string }[]>;
const stops = journeyData.stops;

const THEME_EN: Record<string, string> = Object.fromEntries(
  tags.categories.map((c) => [c.id, c.en.toLowerCase()])
);
/* "me" is the one theme that is not a thing in the picture but who is in it. */
const describeTheme = (id: string, n: number) =>
  id === 'me' ? `the traveller in ${n}` : `${THEME_EN[id] ?? id} ${n}`;

export type StopSummary = { id: number; text: string };

/** One line a stop, built once: city, country, dates, story, captions, themes. */
export const SUMMARIES: StopSummary[] = stops.flatMap((s) => {
  const t = tags.stops[String(s.id)];
  const story = notes[String(s.id)]?.en?.story?.replace(/\s*\n\s*/g, ' ').trim();
  const caps = captions[String(s.id)];
  if (!t && !story && !caps) return [];
  const dates = s.endDate !== s.startDate ? `${s.startDate} to ${s.endDate}` : s.startDate;
  const parts = [
    `${cities.cities[s.city]?.en ?? s.city}, ${cities.countries[s.countryCode]?.en ?? s.countryCode} (${dates})`,
  ];
  if (story) parts.push(story);
  // what the photos say under themselves — the words a visitor would search by
  if (caps) parts.push(`Captions: ${caps.map((c) => c.en.replace(/[.。]$/, '')).join('; ')}.`);
  if (t) {
    const themes = Object.entries(t)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => describeTheme(id, n))
      .join(', ');
    parts.push(`Photos of: ${themes}.`);
  }
  return [{ id: s.id, text: parts.join(' — ') }];
});

/* Asked of the stop's photos, not of the stop as a whole: a stay of thirty
   photos with one of them showing it is an answer (하급코더 Q2, 2026-10-03 —
   the old wording put such stops under the line, recall 27%). */
const QUESTION =
  'Does any photo of the stop `stop` show what the query in the state is looking for — a place, a scene, an experience or a thing?';
const LEVELS = [
  'Unrelated to the query',
  'Loosely related',
  'Matches part of the query',
  'Directly matches the query',
];
// Asked in the same request, so it costs nothing extra: a line of chat or a
// string of letters would otherwise be ranked as if it named a place.
const GATE_KEY = '_is_a_search';
export const GATE_MIN = 0.5;
const GATE =
  'Is the query in the state looking for a place, a scene, an experience, a time, a kind of photo or who is in the photo, from a journey — something one could search travel photos for?';
/* A single word ("개", "맥주") reads to the gate as hardly a search (0.2–0.3)
   while some stop still matches it squarely; so a stop matching this well lets
   the words through on its own. "안녕하세요" tops out at 0.26 (2026-10-03). */
export const GATE_BY_SCORE = 1.8;

/* A score is where the stop falls among the levels, 0 to 3. Measured
   (2026-10-02, five queries): the stops that were the answer sat at 1.66 and
   up, the loosely related ones at 1.4 and under, so the line is 1.5. A query
   that is not a search ("ㅁㄴㅇㄹ") gated at 0.13, a penguin at 0.44. */
export const SCORE_MAX = LEVELS.length - 1;
export const SCORE_MIN = 1.5;
/** How many stops come back at most. */
export const TOP = 12;

/* And the fourteen themes, scored against the words in the same request: when
   no stop answers, the page can offer the nearest theme instead — only one
   that is near (2026-10-03: "개" → animal 2.89, "사고" → transit 1.49). */
const THEME_KEY = '_theme_';
const THEME_Q =
  'How close is what the query in the state is looking for to the photo theme `theme`?';
export const THEME_MIN = 1.5;
export const THEMES_TOP = 3;
const nameTheme = (c: { id: string; ko: string; en: string }) =>
  c.id === 'me' ? 'Me — photos with the traveller in them' : `${c.en} (${c.ko})`;

// ---- the words a theme already answers -----------------------------------------

/* Some words are a theme by another name, and a theme is answered from the
   tags with no call at all: the stops that have it, most photos first.
   "Me" is asked for in many ways and Jev cannot tell those stops apart (the
   traveller is in a few photos nearly everywhere — 2026-10-02, "내가 찍힌 사진"
   scored flat 2.1–2.2 and gated 0.30), so the words go straight to the tag. */
const ME_WORDS =
  /(^|\s)(나|내|me|myself|selfies?)(\s|$)|내가|나를|나만|내 ?(사진|얼굴|모습)|나 ?(나온|찍힌|있는)|셀카|셀피|photos? of me|my (photos?|face)|with me/i;

export function normalize(q: string): string {
  return q.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/* Broad words that mean a theme — the theme by another name, not a thing in
   it. "배고플때" is food; "개" and "국수" are not, they go to Jev (and to the
   themes it scores, which the page may offer). Matched whole, lower-cased. */
const SYNONYMS: Record<string, string[]> = {
  food: [
    '배고플때',
    '배고플 때',
    '배고파',
    '배고픔',
    '먹을 거',
    '먹을거',
    '먹거리',
    '먹을것',
    '먹을 것',
    '먹은 것',
    '먹은것',
    '먹은',
    '먹는',
    '음식',
    '식사',
    '맛집',
    '밥',
    'eat',
    'eating',
    'meal',
    'meals',
    'hungry',
    'foods',
    'dishes',
    'cuisine',
  ],
  animal: ['동물들', '짐승', '짐승들', '생물', 'animals', 'wildlife', 'creatures'],
  people: ['사람들', '인물', '현지인', '현지인들', 'persons', 'locals', 'faces', 'portraits'],
  mountain: ['산맥', '산들', '고산', 'mountains', 'hills', 'peaks'],
  desert: ['사막들', 'deserts', 'dunes'],
  snow: ['설경', '눈 내린', '눈내린', '눈 오는', '눈오는', 'snowy', 'snowfall', 'snow-covered'],
  street: ['길거리', '거리들', '골목', '골목길', 'streets', 'alleys', 'alley', 'roads'],
  architecture: ['건물', '건물들', '건축물', 'buildings', 'building', 'structures'],
  transit: [
    '교통',
    '교통수단',
    '탈것',
    '이동수단',
    '이동 수단',
    '타고',
    '이동하기',
    'transport',
    'transportation',
    'vehicles',
    'in transit',
    'on the move',
    'getting around',
  ],
  'golden-hour': [
    '노을',
    '석양',
    '일몰',
    '일출',
    '해넘이',
    '해돋이',
    '황금빛',
    '빛',
    'sunset',
    'sunsets',
    'sunrise',
    'golden hour',
    'dusk',
    'dawn',
    'sunlight',
    'light',
  ],
  night: [
    '야경',
    '밤에',
    '밤의',
    '저녁',
    '야간',
    'nights',
    'nighttime',
    'night time',
    'evening',
    'after dark',
  ],
  water: [
    '물',
    '바닷가',
    '물가에서',
    '해변',
    '해안',
    'waters',
    'waterfront',
    'seaside',
    'shore',
    'coast',
  ],
  things: ['물건들', '소지품', '짐', '장비', 'objects', 'stuff', 'belongings', 'gear', 'items'],
};
const BY_SYNONYM = new Map<string, string>();
for (const [id, words] of Object.entries(SYNONYMS)) for (const w of words) BY_SYNONYM.set(w, id);

/** The theme id these words are, or null. */
export function themeOf(q: string): string | null {
  const w = normalize(q).toLowerCase();
  if (!w) return null;
  if (ME_WORDS.test(w)) return 'me';
  for (const c of tags.categories) {
    if (w === c.ko || w === c.en.toLowerCase()) return c.id;
  }
  return BY_SYNONYM.get(w) ?? null;
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
/** A theme and how near the words came to it, on Jev's own 0–3 scale. */
export type NearTheme = { id: string; score: number };
export type SearchResult = {
  /** when the words were a theme, that theme (the page may light it instead) */
  theme?: string;
  /** best first; empty when nothing matched or the words were not a search */
  stops: Ranked[];
  /** the themes nearest the words (≥ THEME_MIN, at most THEMES_TOP), nearest first — for when no stop answers */
  themes?: NearTheme[];
};

type Answer = { type?: string; score?: number; confidence?: number; noul?: number };

/** What Jev is asked about the words: every stop, the gate, the fourteen themes. */
export function questionsFor(): Record<string, unknown> {
  const questions: Record<string, unknown> = {};
  for (const s of SUMMARIES) {
    questions[String(s.id)] = {
      type: 'score',
      instructions: { stop: s.text, question: QUESTION },
      criteria: LEVELS,
    };
  }
  questions[GATE_KEY] = { type: 'noul', instructions: GATE };
  for (const c of tags.categories) {
    questions[THEME_KEY + c.id] = {
      type: 'score',
      instructions: { theme: nameTheme(c), question: THEME_Q },
      criteria: LEVELS,
    };
  }
  return questions;
}

// ---- the photos themselves (B): of the stops that answered, which show it -------

/* The book asks this once, when it opens over a lit answer: every photo of
   those stops, by its caption, yes or no (noul). Measured by 하급코더
   (2026-10-03): precision 89%, recall 92% at 0.5; about 1–9K tokens in,
   0.2–0.3s. */
const PHOTO_KEY = 'p:';
const PHOTO_Q =
  'Does the photo described by `photo` show what the query in the state is looking for?';
export const PHOTO_MIN = 0.5;
/** At most this many stops' photos are asked about in one request. */
export const PHOTO_STOPS_MOST = 12;

/** The photos of these stops, with their captions, as the questions. */
export function photoQuestionsFor(stopIds: number[]): {
  questions: Record<string, unknown>;
  pool: string[];
} {
  const questions: Record<string, unknown> = {};
  const pool: string[] = [];
  for (const id of stopIds.slice(0, PHOTO_STOPS_MOST)) {
    for (const c of captions[String(id)] ?? []) {
      questions[PHOTO_KEY + c.id] = {
        type: 'noul',
        instructions: { photo: c.en, question: PHOTO_Q },
      };
      pool.push(c.id);
    }
  }
  return { questions, pool };
}

/** The photos that showed it: noul over the line, in the pool's order. Pure. */
export function photosOf(answers: Record<string, Answer>, pool: string[]): string[] {
  return pool.filter((id) => (answers[PHOTO_KEY + id]?.noul ?? 0) >= PHOTO_MIN);
}

export type PhotoResult = { photos: string[] };

/** What Jev's answers come to: the stops that matched (if the words were a
 *  search at all) and the themes that came near. Pure, so it can be tested. */
export function resultOf(answers: Record<string, Answer>): SearchResult {
  const scored = SUMMARIES.map((s) => ({ id: s.id, score: answers[String(s.id)]?.score ?? 0 }));
  const best = scored.reduce((m, r) => Math.max(m, r.score), 0);
  const isSearch = (answers[GATE_KEY]?.noul ?? 1) >= GATE_MIN || best >= GATE_BY_SCORE;
  const result: SearchResult = { stops: [] };
  if (isSearch) {
    result.stops = scored
      .filter((r) => r.score >= SCORE_MIN)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP)
      .map((r) => ({ id: r.id, score: r.score / SCORE_MAX }));
  }
  const themes = tags.categories
    .map((c) => ({ id: c.id, score: answers[THEME_KEY + c.id]?.score ?? 0 }))
    .filter((t) => t.score >= THEME_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, THEMES_TOP)
    .map((t) => ({ id: t.id, score: Math.round(t.score * 100) / 100 }));
  if (themes.length) result.themes = themes;
  return result;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (error: SearchError, status: number) => json({ error }, status);

export type Asked = { q: string; photosOf: number[] | null };

/** Reads the body: the words, and — the book's request — the stops whose photos to pick. */
export async function askedOf(request: Request): Promise<Asked | null | 'too_long'> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return 'too_long';
  try {
    const body = (await request.json()) as { q?: unknown; photos?: unknown; stops?: unknown };
    const q = typeof body?.q === 'string' ? normalize(body.q) : '';
    if (q.length > MAX_QUERY_CHARS) return 'too_long';
    if (!q) return null;
    if (body.photos === true) {
      if (!Array.isArray(body.stops) || !body.stops.length || body.stops.length > PHOTO_STOPS_MOST)
        return null;
      const ids = body.stops.map((x) => (typeof x === 'number' && Number.isInteger(x) ? x : NaN));
      if (ids.some((x) => Number.isNaN(x))) return null;
      return { q, photosOf: ids };
    }
    return { q, photosOf: null };
  } catch {
    return null;
  }
}

/** Reads the body and takes the query out of it, or null. */
export async function queryOf(request: Request): Promise<string | null | 'too_long'> {
  const asked = await askedOf(request);
  return asked === 'too_long' ? asked : (asked?.q ?? null);
}

/* The same words over the same stops are answered from memory (an hour). */
const photoCache = new Map<string, { at: number; result: PhotoResult }>();

async function pickPhotos(key: string, q: string, stopIds: number[]): Promise<Response> {
  const sorted = [...new Set(stopIds)].sort((a, b) => a - b);
  const hash = await hashOf(`${q.toLowerCase()}|${sorted.join(',')}`);
  const cached = photoCache.get(hash);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return json(cached.result);
  if (overDailyCeiling(true)) return fail('unavailable', 503);
  const { questions, pool } = photoQuestionsFor(sorted);
  if (!pool.length) return json({ photos: [] } satisfies PhotoResult);
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
    console.log(
      `[search] jev photos ${pool.length} of ${sorted.length} stops, ${data.usage?.input_tokens ?? '?'} in, ${data.usage?.output_tokens ?? '?'} out`
    );
  } catch {
    return fail('upstream', 502);
  }
  const result: PhotoResult = { photos: photosOf(answers, pool) };
  if (photoCache.size > 500) photoCache.clear();
  photoCache.set(hash, { at: Date.now(), result });
  return json(result);
}

export async function POST(request: Request): Promise<Response> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key || Date.now() < pausedUntil) return fail('unavailable', 503);
  if (!sameOrigin(request)) return fail('invalid', 403);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (limited(ip)) return fail('rate_limited', 429);

  const asked = await askedOf(request);
  if (asked === 'too_long') return fail('too_long', 413);
  if (!asked) return fail('invalid', 400);
  const { q } = asked;

  // the book's request: of these stops, which photos show it
  if (asked.photosOf) return pickPhotos(key, q, asked.photosOf);

  const theme = themeOf(q);
  if (theme) return json({ theme, stops: rankByTheme(theme) } satisfies SearchResult);

  const hash = await hashOf(q.toLowerCase());
  const cached = cache.get(hash);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return json(cached.result);

  if (overDailyCeiling()) return fail('unavailable', 503);

  /* One request, one read of the words: every stop is scored against them,
     the words themselves are checked, and the themes are scored. Jev ingests
     the state once, so the questions cost little beyond their own text. */
  const questions = questionsFor();

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
    // SEARCH_DEBUG=1 (dev): the gate and the top of the scores, to set the line by
    if (process.env.SEARCH_DEBUG) {
      const top = SUMMARIES.map((s) => ({ id: s.id, score: answers[String(s.id)]?.score ?? 0 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((r) => `${stops.find((s) => s.id === r.id)?.city}#${r.id} ${r.score.toFixed(2)}`);
      console.log(`[search] gate ${answers[GATE_KEY]?.noul?.toFixed(2)} · ${top.join(' · ')}`);
    }
  } catch {
    return fail('upstream', 502);
  }

  const result = resultOf(answers);

  if (cache.size > 500) cache.clear();
  cache.set(hash, { at: Date.now(), result });
  return json(result);
}
