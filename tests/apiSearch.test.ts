// The search function is loaded here the way Vercel's Node runtime loads it:
// as an ES module, by Node itself. The dev server answers the same path
// through a bundler, which hid a load failure once (JSON imported without
// `with { type: 'json' }` — every call died before it reached the handler).
import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../api/search.ts');
const ORIGIN = 'https://backpacking.po24lio.com';
const post = (headers: Record<string, string>, body: unknown) =>
  new Request(`${ORIGIN}/api/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const own = { origin: ORIGIN, host: 'backpacking.po24lio.com' };

test('the function loads under Node ESM and has every stop it can speak for', async () => {
  const m = await load();
  assert.equal(typeof m.POST, 'function');
  assert.ok(m.SUMMARIES.length > 100, `${m.SUMMARIES.length} summaries`);
});

test('without a key it says unavailable; from elsewhere it refuses', async () => {
  const m = await load();
  const saved = process.env.TYPESAFE_API_KEY;
  try {
    delete process.env.TYPESAFE_API_KEY;
    assert.equal((await m.POST(post(own, { q: '피라미드' }))).status, 503);
    process.env.TYPESAFE_API_KEY = 'not-a-key';
    assert.equal((await m.POST(post({ host: own.host }, { q: '피라미드' }))).status, 403);
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  }
});

test('a theme word is answered from the tags, with no call', async () => {
  const m = await load();
  const saved = process.env.TYPESAFE_API_KEY;
  try {
    process.env.TYPESAFE_API_KEY = 'not-a-key';
    const res = await m.POST(post({ ...own, 'x-forwarded-for': '10.9.9.9' }, { q: '눈' }));
    assert.equal(res.status, 200);
    const data = (await res.json()) as { theme?: string; stops: { id: number }[] };
    assert.equal(data.theme, 'snow');
    assert.ok(data.stops.length > 0);
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  }
});

test('a broad word for a theme is that theme; a thing in it is not', async () => {
  const m = await load();
  assert.equal(m.themeOf('배고플때'), 'food');
  assert.equal(m.themeOf('동물들'), 'animal');
  assert.equal(m.themeOf('Sunset'), 'golden-hour');
  assert.equal(m.themeOf('개'), null);
  assert.equal(m.themeOf('국수'), null);
});

test('a stop is described with the captions of its photos, and nothing from Apple', async () => {
  const m = await load();
  const cairo = m.SUMMARIES.find((s) => s.id === 53);
  assert.ok(cairo, 'Cairo (53) is summarised');
  // as trimmed for Jev: "Cairo airport on the day I arrived" → no articles, no "I"
  assert.match(cairo.text, /Captions: .*Cairo airport on day arrived/);
  assert.match(cairo.text, /Photos of: /);
  for (const s of m.SUMMARIES) assert.doesNotMatch(s.text, /appleCaption|scene labels?/i);
});

test('the stop captions file is what the captions say now', async () => {
  const { buildStopCaptions, buildStopSummary, OUT, SUMMARY_OUT } = await import(
    '../scripts/build-stop-captions.mjs'
  );
  const fs = await import('node:fs');
  assert.deepEqual(JSON.parse(fs.readFileSync(OUT, 'utf8')), buildStopCaptions());
  assert.deepEqual(JSON.parse(fs.readFileSync(SUMMARY_OUT, 'utf8')), buildStopSummary());
});

test('the copy for Jev is trimmed, the captions on screen are not', async () => {
  const { buildStopCaptions, buildStopSummary } = await import('../scripts/build-stop-captions.mjs');
  const full = buildStopCaptions();
  const trimmed = buildStopSummary(full);
  const count = (o: Record<string, unknown[]>) => Object.values(o).reduce((n, l) => n + l.length, 0);
  const kept = Object.values(trimmed as Record<string, { captions: string[] }>).reduce(
    (n, r) => n + r.captions.length,
    0
  );
  assert.ok(kept < count(full), `${kept} of ${count(full)} captions kept`);
  // Bangalore (21): five dog photos, each still said once somewhere for Jev
  const bangalore = (trimmed as Record<string, { story?: string; captions: string[] }>)['21'];
  assert.match([bangalore.story, ...bangalore.captions].join(' '), /\bdogs?\b/i);
  for (const r of Object.values(trimmed as Record<string, { captions: string[] }>))
    for (const c of r.captions) assert.doesNotMatch(c, /\b(the|an?)\b/i);
});

test('the answers are read: the gate, the line, the near themes', async () => {
  const m = await load();
  const ids = m.SUMMARIES.map((s) => String(s.id));
  const base = (gate: number, top: Record<string, number>, themes: Record<string, number> = {}) => {
    const a: Record<string, { noul?: number; score?: number }> = { _is_a_search: { noul: gate } };
    for (const id of ids) a[id] = { score: top[id] ?? 0.2 };
    for (const [t, score] of Object.entries(themes)) a[`_theme_${t}`] = { score };
    return a;
  };
  // the gate open: the stops over the line, best first, on a 0–1 scale
  let r = m.resultOf(base(0.8, { [ids[0]]: 2.4, [ids[1]]: 1.6, [ids[2]]: 1.4 }));
  assert.deepEqual(
    r.stops.map((s) => s.id),
    [Number(ids[0]), Number(ids[1])]
  );
  assert.ok(Math.abs(r.stops[0].score - 0.8) < 1e-9);
  assert.equal(r.themes, undefined);
  // a single word the gate doubts (0.23) but a stop matches squarely: through
  r = m.resultOf(base(0.23, { [ids[3]]: 2.06, [ids[4]]: 1.7 }));
  assert.equal(r.stops.length, 2);
  // the gate doubts and no stop reaches 1.8: nothing (국수: 0.21 / 1.66)
  r = m.resultOf(base(0.21, { [ids[3]]: 1.66 }));
  assert.equal(r.stops.length, 0);
  // chat: nothing (안녕하세요: 0.02 / 0.24)
  r = m.resultOf(base(0.02, {}));
  assert.equal(r.stops.length, 0);
  // the near themes: over 1.5 only, nearest first, three at most, rounded
  r = m.resultOf(
    base(0.2, {}, { animal: 2.876, street: 1.6, food: 1.49, night: 1.9, things: 1.55 })
  );
  assert.deepEqual(r.themes, [
    { id: 'animal', score: 2.88 },
    { id: 'night', score: 1.9 },
    { id: 'street', score: 1.6 },
  ]);
});

test("the book's request (B): the stops' photos by caption, yes or no, over the line", async () => {
  const m = await load();
  const { questions, pool } = m.photoQuestionsFor([53]);
  assert.ok(pool.length > 5, `${pool.length} photos of Cairo`);
  assert.ok(pool.every((id) => id.startsWith('cairo-')));
  const q = questions['p:' + pool[0]] as { type: string; instructions: { photo: string } };
  assert.equal(q.type, 'noul');
  assert.match(q.instructions.photo, /Cairo airport/);
  // read: over 0.5 only, in the pool's order
  const answers: Record<string, { noul: number }> = {};
  pool.forEach((id, i) => (answers['p:' + id] = { noul: i % 3 === 0 ? 0.9 : 0.1 }));
  assert.deepEqual(
    m.photosOf(answers, pool),
    pool.filter((_, i) => i % 3 === 0)
  );
  // more than twelve stops are not asked about
  assert.equal(
    m.photoQuestionsFor(Array.from({ length: 20 }, (_, i) => i + 1)).pool.length,
    m.photoQuestionsFor(Array.from({ length: 12 }, (_, i) => i + 1)).pool.length
  );
});

test('the body: words alone, or words with the stops to pick photos from', async () => {
  const m = await load();
  const body = (b: unknown) => post(own, b);
  assert.deepEqual(await m.askedOf(body({ q: '개' })), { q: '개', photosOf: null });
  assert.deepEqual(await m.askedOf(body({ q: '개', photos: true, stops: [53, 54] })), {
    q: '개',
    photosOf: [53, 54],
  });
  assert.equal(await m.askedOf(body({ q: '개', photos: true, stops: [] })), null);
  assert.equal(await m.askedOf(body({ q: '개', photos: true, stops: ['53'] })), null);
  assert.equal(
    await m.askedOf(
      body({ q: '개', photos: true, stops: Array.from({ length: 13 }, (_, i) => i) })
    ),
    null
  );
});

test('what Jev is told of the stops stays under its input limit', async () => {
  const m = await load();
  // measured 2026-10-03: 119,485 chars came to 48,082 input tokens (≈2.49 chars a token),
  // and TypeSafe took 50.1K but refused 67K. 123,000 chars ≈ 49.5K tokens.
  const chars = m.SUMMARIES.reduce((n, s) => n + s.text.length, 0);
  assert.ok(chars <= 123_000, `${chars} chars of summaries`);
});

test('asked by URL (the form the edge keeps): the words, and the stops to pick photos from', async () => {
  const m = await load();
  const get = (qs: string, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/search?v=abc&${qs}`, { method: 'GET', headers });
  assert.deepEqual(await m.askedOf(get('q=%EB%B0%A4%EA%B8%B0%EC%B0%A8')), {
    q: '밤기차',
    photosOf: null,
  });
  assert.deepEqual(await m.askedOf(get('q=Night%20%20Train')), {
    q: 'night train',
    photosOf: null,
  });
  assert.deepEqual(await m.askedOf(get('q=%EA%B0%9C&photos=1&stops=53,54')), {
    q: '개',
    photosOf: [53, 54],
  });
  assert.equal(await m.askedOf(get('q=%EA%B0%9C&photos=1&stops=53,x')), null);
  assert.equal(await m.askedOf(get('q=')), null);
});

test('a same-site GET is let in; an answer carries a week of edge cache, a fault none', async () => {
  const m = await load();
  const saved = process.env.TYPESAFE_API_KEY;
  try {
    process.env.TYPESAFE_API_KEY = 'not-a-key';
    const get = (headers: Record<string, string>, q = '%EB%88%88') =>
      m.GET(
        new Request(`${ORIGIN}/api/search?v=abc&q=${q}`, {
          method: 'GET',
          headers: { host: 'backpacking.po24lio.com', 'x-forwarded-for': '10.8.8.8', ...headers },
        })
      );
    // the browser says same-origin on a GET from the page itself
    const ok = await get({ 'sec-fetch-site': 'same-origin' });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('cache-control') ?? '', /s-maxage=604800/);
    // from another site, by Sec-Fetch-Site or by Origin: refused, not kept
    const cross = await get({ 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.status, 403);
    assert.equal(cross.headers.get('cache-control'), 'no-store');
    assert.equal((await get({ origin: 'https://elsewhere.example' })).status, 403);
    // an older browser: the referer stands in
    assert.equal((await get({ referer: `${ORIGIN}/` })).status, 200);
    // a baked example answers from the page's own data, cacheable, with no call
    const baked = await get({ 'sec-fetch-site': 'same-origin' }, '%EB%B0%A4%EA%B8%B0%EC%B0%A8');
    assert.equal(baked.status, 200);
    const data = (await baked.json()) as { stops: unknown[] };
    assert.ok(data.stops.length > 0);
    assert.match(baked.headers.get('cache-control') ?? '', /s-maxage/);
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  }
});

test('the baked examples are of this data, all ten of them', async () => {
  const m = await load();
  const { dataVersion } = await import('../scripts/dataVersion.ts');
  const { EXAMPLES } = await import('../src/lib/askExamples.ts');
  assert.equal(
    m.BAKED.version,
    dataVersion(),
    'searchExamples.json is stale: node scripts/bake-examples.mjs'
  );
  for (const w of [...EXAMPLES.ko, ...EXAMPLES.en]) {
    const r = m.BAKED.results[m.normalize(w)];
    assert.ok(r, `${w} is baked`);
    assert.ok(r.stops.length > 0, `${w} answers at least one stop`);
  }
});
