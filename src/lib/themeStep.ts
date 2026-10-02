/**
 * Where ← → go while a theme is on. Kept free of data and React so the rule
 * can be tested on its own (tests/themeStep.test.ts).
 */

/**
 * The next lit index from `from` in direction `dir`, or -1 if there is none
 * that way. `from` itself is never returned: standing on a lit photo, → goes
 * to the next one.
 */
export function nextLit(count: number, from: number, dir: 1 | -1, lit: (i: number) => boolean) {
  for (let i = from + dir; i >= 0 && i < count; i += dir) if (lit(i)) return i;
  return -1;
}

/**
 * One step of ← →. With nothing lit in the whole list the step is the plain
 * one; with something lit it is the next lit index, and at the last one it
 * stays where it is rather than falling back to a neighbour that is not lit.
 */
export function stepIndex(
  count: number,
  from: number,
  dir: 1 | -1,
  lit: ((i: number) => boolean) | null
): number {
  const plain = Math.max(0, Math.min(count - 1, from + dir));
  if (!lit) return plain;
  const j = nextLit(count, from, dir, lit);
  if (j >= 0) return j;
  for (let i = 0; i < count; i++) if (lit(i)) return from;
  return plain;
}

/** Photos per journey day for one theme, index 1..days (index 0 and days+1 stay 0). */
export function litPerDay(
  dates: (string | undefined)[],
  lit: (i: number) => boolean,
  dayOf: (iso: string) => number,
  days: number
): number[] {
  const out = new Array<number>(days + 2).fill(0);
  dates.forEach((d, i) => {
    if (!d || !lit(i)) return;
    const day = dayOf(d);
    if (day >= 1 && day <= days) out[day]++;
  });
  return out;
}
