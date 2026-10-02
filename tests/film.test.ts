import test from 'node:test';
import assert from 'node:assert/strict';
import { Film, landing, rubber, speedOf, springOf } from '../src/components/gallery/film.ts';

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
