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
