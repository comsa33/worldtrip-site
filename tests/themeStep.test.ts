import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLit, stepIndex, litPerDay } from '../src/lib/themeStep.ts';

const litAt =
  (...on: number[]) =>
  (i: number) =>
    on.includes(i);

test('nextLit skips to the next lit index, never the one it stands on', () => {
  assert.equal(nextLit(10, 2, 1, litAt(2, 5, 8)), 5);
  assert.equal(nextLit(10, 5, -1, litAt(2, 5, 8)), 2);
  assert.equal(nextLit(10, 8, 1, litAt(2, 5, 8)), -1);
  assert.equal(nextLit(10, 2, -1, litAt(2, 5, 8)), -1);
});

test('with no theme, ← → are the plain step, clamped at the ends', () => {
  assert.equal(stepIndex(10, 3, 1, null), 4);
  assert.equal(stepIndex(10, 0, -1, null), 0);
  assert.equal(stepIndex(10, 9, 1, null), 9);
});

test('with something lit, ← → go to the next lit photo', () => {
  assert.equal(stepIndex(10, 0, 1, litAt(4, 7)), 4);
  assert.equal(stepIndex(10, 4, 1, litAt(4, 7)), 7);
  assert.equal(stepIndex(10, 9, -1, litAt(4, 7)), 7);
  // from an unlit photo between two lit ones
  assert.equal(stepIndex(10, 5, -1, litAt(4, 7)), 4);
});

test('past the last lit photo it stays put instead of stepping onto an unlit one', () => {
  assert.equal(stepIndex(10, 7, 1, litAt(4, 7)), 7);
  assert.equal(stepIndex(10, 8, 1, litAt(4, 7)), 8);
  assert.equal(stepIndex(10, 4, -1, litAt(4, 7)), 4);
});

test('a theme with nothing lit in this list is the same as no theme', () => {
  assert.equal(stepIndex(10, 3, 1, litAt()), 4);
  assert.equal(stepIndex(10, 3, -1, litAt()), 2);
});

test('litPerDay counts only lit photos, by journey day, inside the journey', () => {
  const dates = [
    '2016-08-13T10:00',
    '2016-08-13T11:00',
    '2016-08-14T09:00',
    undefined,
    '2016-08-12T23:00',
  ];
  const D0 = Date.parse('2016-08-13');
  const dayOf = (iso: string) => Math.floor((Date.parse(iso.slice(0, 10)) - D0) / 86400000) + 1;
  const out = litPerDay(dates, litAt(0, 2, 3, 4), dayOf, 3);
  assert.deepEqual(out, [0, 1, 1, 0, 0]);
});
