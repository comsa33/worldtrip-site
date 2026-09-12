import { useEffect, useState } from 'react';

/**
 * How long the dot has to sit still before the city says anything.
 *
 * Scrubbing the journey crosses a dozen cities in a second, and a block that
 * appeared at each of them would strobe. So the text waits for the reader to
 * actually stop: every change of place or progress restarts the clock, and
 * only a stop still under the dot when it runs out gets to speak.
 */
const DWELL_MS = 1100;

export function useSettledStop(stopIdx: number, progress: number): number | null {
  // a thousandth of the route is finer than any scroll is steady, and coarse
  // enough that a pixel of jitter does not read as movement
  const tick = Math.round(progress * 1000);
  const now = `${stopIdx}:${tick}`;
  const [settled, setSettled] = useState<number | null>(null);
  const [mark, setMark] = useState(now);
  if (mark !== now) {
    // still moving: the block goes, and the clock starts over
    setMark(now);
    if (settled !== null) setSettled(null);
  }
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(stopIdx), DWELL_MS);
    return () => window.clearTimeout(t);
  }, [stopIdx, tick]);
  return settled;
}
