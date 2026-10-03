/**
 * The clock the search's scan keeps — the orange spark running the route on
 * the globe while the words are out, and the ring beside the words that ends
 * the same way at the same moment.
 *
 * One rule tells the three endings apart: the spark that drew to the very end
 * of the route "looked and found nothing"; one that stopped on the way "could
 * not look"; one that never set off "could not ask". Both the spark (RouteScan)
 * and the field's status ring (AskDot) read their timings from here, so they
 * end together.
 */

/** One run of the spark along the whole route. */
export const SCAN_MS = 2600;
/** However fast the answer, the spark draws at least this long — "it looked" has to be seen. */
export const SCAN_MIN_MS = 700;
/** Nothing found: from where it is, the spark draws on to the end within this. */
export const FINISH_MAX_MS = 600;
/** Then holds, before stepping back to a faint line. */
export const REST_HOLD_MS = 200;
export const REST_FADE_MS = 400;
export const REST_OPACITY = 0.18;
/** A fault: the spark stops where it is, and after a beat fades out. */
export const FAULT_HOLD_MS = 300;
export const FAULT_FADE_MS = 300;

/** Where along the route (0–1) the spark is at `t`, having set off at `since`. */
export function scanPhase(since: number, t: number): number {
  return ((Math.max(0, t - since) % SCAN_MS) / SCAN_MS + 1) % 1;
}

/**
 * The answer came at `at`: when the spark stops running (`hold`) and, for
 * nothing found, when it has reached the end (`end`). `hold` is never before
 * the minimum run.
 */
export function scanEnding(since: number, at: number): { hold: number; end: number } {
  const hold = Math.max(at, since + SCAN_MIN_MS);
  const remaining = 1 - scanPhase(since, hold);
  return { hold, end: hold + remaining * FINISH_MAX_MS };
}
