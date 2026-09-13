/**
 * How long a jump from stop to stop takes — keys, a swipe, the rail, a click
 * on the scrubber, autoplay. The hand's own wheel is paced by the hand.
 *
 * The length grows with the distance, gently: some fixed time to be a move at
 * all, a little more for every pixel of page it crosses, and more for every
 * kilometre the leg really covers, so a hop between countries is given room
 * to be seen. A far jump is capped so it is not a wait. The critically damped
 * spring behind the page adds its own half second or so of settling on top.
 *
 * 2026-09-13: ×1.3 on the first numbers (360 + px/8 + km/5, ≤2400). A leg
 * overland is now ~0.63s at the median, a flight ~0.95s, the longest 3.1s.
 * Tune it on the bench (`?tune=1`), not by reading these.
 */
export type PaceParams = {
  /** ms every jump takes, however short */
  base: number;
  /** px of page per extra ms */
  perPx: number;
  /** km of leg per extra ms */
  perKm: number;
  /** the longest a jump may take, in ms */
  max: number;
};

export const PACE_DEFAULTS: PaceParams = { base: 470, perPx: 6.2, perKm: 3.85, max: 3100 };

export function jumpMs(px: number, km: number, p: PaceParams = PACE_DEFAULTS): number {
  return Math.min(p.max, p.base + px / p.perPx + km / p.perKm);
}

/**
 * Autoplay's beat, from one stop to the leaving of it: the jump and a stay.
 * Slowed with the jumps (×1.3 on 1200 / 2000), or the dot would set off again
 * the moment it had landed.
 */
export const AUTOPLAY_BEAT_MS = { land: 1560, flight: 2600 };
