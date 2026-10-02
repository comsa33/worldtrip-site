import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Film,
  landing,
  rebase,
  rubber,
  speedOf,
  springOf,
} from '../src/components/gallery/film.ts';

test('the spring of response 0.34s and damping 0.9 is k 341, c 33', () => {
  const { k, c } = springOf(0.34, 0.9);
  assert.ok(Math.abs(k - 341) < 1, `k ${k}`);
  assert.ok(Math.abs(c - 33.3) < 0.2, `c ${c}`);
});

test('let go short of halfway, the band comes back; thrown, it goes on', () => {
  const lane = { centres: [-390, 0, 390], here: 1 };
  assert.equal(landing(-120, 0, lane, 0.15), 1);
  assert.equal(landing(-120, -1200, lane, 0.15), 2);
  assert.equal(landing(-200, 0, lane, 0.15), 2);
  assert.equal(landing(200, 0, lane, 0.15), 0);
});

test('the spring settles on its target without overshooting much', () => {
  const f = new Film(0.34, 0.9);
  f.x = -150;
  f.release(-390, -1200);
  let t = 0;
  let minX = 0;
  while (!f.tick(1 / 60) && t < 3) {
    t += 1 / 60;
    minX = Math.min(minX, f.x);
  }
  assert.equal(f.x, -390);
  assert.ok(t < 0.7, `took ${t}s`);
  assert.ok(minX > -390 - 12, `overshot to ${minX}`);
});

test('the rubber band follows less and less', () => {
  const w = 390;
  assert.ok(rubber(50, w, 0.55) < 50);
  assert.ok(rubber(400, w, 0.55) < rubber(800, w, 0.55));
  assert.ok(rubber(5000, w, 0.55) < w);
  assert.ok(rubber(-100, w, 0.55) < 0);
});

test('the speed is of the last 80ms, not the whole drag', () => {
  const pts = [
    { x: 0, t: 0 },
    { x: 10, t: 300 },
    { x: 12, t: 600 },
    { x: 60, t: 640 },
    { x: 120, t: 680 },
  ];
  assert.ok(speedOf(pts) > 1000);
});

test('a thrown band reaches the next photo in a roll of four (2 → 3, the same cards)', () => {
  // Gwangju has four photos: standing on the second or the third, the cards
  // on the band are the same four. The band must still be moved over.
  const ids = ['a', 'b', 'c', 'd'];
  const before = { ids, here: 'b', centres: [-390, 0, 390, 780] };
  const after = { ids, here: 'c', centres: [-780, -390, 0, 390] };
  const f = new Film(0.34, 0.9);
  f.x = -149; // where the finger let go
  const lane = { centres: before.centres, here: 1 };
  assert.equal(landing(f.x, -1270, lane, 0.15), 2);
  f.release(0, -1270);
  const shift = rebase(before, after);
  assert.equal(shift, 390);
  f.x += shift as number;
  let t = 0;
  while (!f.tick(1 / 60) && t < 1) t += 1 / 60;
  assert.equal(f.x, 0, `the band stopped at ${f.x}`);
  assert.ok(t < 1, 'within a second');
});

test('rebase: nothing changed is same, a photo from elsewhere is null', () => {
  const band = { ids: ['a', 'b', 'c'], here: 'b', centres: [-390, 0, 390] };
  assert.equal(rebase(band, { ...band }), 'same');
  assert.equal(rebase(band, { ids: ['x', 'y', 'z'], here: 'y', centres: [-390, 0, 390] }), null);
  // the theme changed the cards but not the photo: the band stays
  assert.equal(rebase(band, { ids: ['b', 'q'], here: 'b', centres: [0, 390] }), 0);
});

test('a spring is not settled while it is away from its target', () => {
  const f = new Film(0.34, 0.9);
  f.x = -149;
  f.release(0, 0);
  assert.equal(f.settled, false);
  assert.equal(f.tick(1 / 60), false);
});
