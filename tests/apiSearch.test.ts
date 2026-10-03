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
  assert.match(cairo.text, /Captions: .*Cairo airport on the day I arrived/);
  assert.match(cairo.text, /Photos of: /);
  for (const s of m.SUMMARIES) assert.doesNotMatch(s.text, /appleCaption|scene labels?/i);
});

test('the stop captions file is what the captions say now', async () => {
  const { buildStopCaptions, OUT } = await import('../scripts/build-stop-captions.mjs');
  const fs = await import('node:fs');
  assert.deepEqual(JSON.parse(fs.readFileSync(OUT, 'utf8')), buildStopCaptions());
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
