import test from 'node:test';
import assert from 'node:assert/strict';
import { wordsToTry } from '../src/lib/askWords.ts';

const EX = ['밤기차', '피라미드', '폭포 앞에서', '눈 덮인 마을', '시장의 아침'];

test('the words to try: in order, less the words asked, filled from the start when short', () => {
  assert.deepEqual(wordsToTry(EX, '펭귄', 3, []), ['밤기차', '피라미드', '폭포 앞에서']);
  // the words just asked are left out, so are the ones asked before
  assert.deepEqual(wordsToTry(EX, '밤기차', 2, ['피라미드']), ['폭포 앞에서', '눈 덮인 마을']);
  // all five tried: the list starts over (never the words just asked)
  assert.deepEqual(wordsToTry(EX, '시장의 아침', 3, EX), ['밤기차', '피라미드', '폭포 앞에서']);
  // the same situation, the same words
  assert.deepEqual(wordsToTry(EX, 'x', 2, ['밤기차']), wordsToTry(EX, 'x', 2, ['밤기차']));
});
