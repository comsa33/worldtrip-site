/**
 * One strip of film (G1): the photos before, this one and the ones after lie
 * on a single band that the hand moves 1:1, and when let go a spring carries
 * it the rest of the way with the hand's own speed. Kept free of the DOM and
 * of React so the numbers can be tested on their own (tests/film.test.ts).
 *
 * Positions are in px, with the current photo's place at 0: a band at -step
 * has the next photo centred.
 */

export type FilmParams = {
  /** the spring, as a response time (s) and a damping ratio — iOS's own words */
  response: number;
  damping: number;
  /** how far ahead the hand's speed is projected to decide where it lands (s) */
  project: number;
  /** past the first or last photo the band follows the hand this much (0–1) */
  band: number;
  /** between one photo and the next: a phone, as a page; a desk, edge to edge */
  gapPhone: number;
  gapDesk: number;
};

export const FILM_DEFAULTS: FilmParams = {
  response: 0.34,
  damping: 0.9,
  project: 0.15,
  band: 0.55,
  gapPhone: 32,
  gapDesk: 48,
};

/** k and c of a unit-mass spring with this response and damping. */
export function springOf(response: number, damping: number) {
  const w = (2 * Math.PI) / Math.max(0.05, response);
  return { k: w * w, c: 2 * damping * w };
}

/**
 * Where the band may rest, 0 for this photo and ±step for its neighbours —
 * the step differs by the pair's widths on a desk, so it is given as the
 * centres of the cards, in order, with this photo's at 0.
 */
export type Lane = { centres: number[]; here: number };

/**
 * The band, dragged beyond the first or last photo: it follows the hand less
 * and less. x′ = (1 − 1/(x·band/W + 1))·W, for W the width it is dragged over.
 */
export function rubber(x: number, width: number, band: number): number {
  const w = Math.max(1, width);
  const a = Math.abs(x);
  return Math.sign(x) * (1 - 1 / ((a * band) / w + 1)) * w;
}

/**
 * Which card the hand meant, from where the band is and how fast it was going
 * (px/s): the projected place is held against the nearest card centre, and a
 * throw takes it on past the midpoint even from short of it. Never further
 * than one card from `here` unless the band is already past the next one.
 */
export function landing(x: number, v: number, lane: Lane, project: number): number {
  const p = x + v * project;
  // the band at x shows the card whose centre is nearest to -x
  let best = lane.here;
  let bestD = Infinity;
  lane.centres.forEach((c, i) => {
    const d = Math.abs(-p - c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * The band in motion. `x` is read every frame; `tick(dt)` advances it towards
 * `target` with the spring; `grab()` stops it where it is so a hand can take
 * over from exactly there.
 */
export class Film {
  x = 0;
  v = 0;
  target = 0;
  private k: number;
  private c: number;

  constructor(response: number, damping: number) {
    const s = springOf(response, damping);
    this.k = s.k;
    this.c = s.c;
  }

  retune(response: number, damping: number) {
    const s = springOf(response, damping);
    this.k = s.k;
    this.c = s.c;
  }

  /** the hand has the band: no spring, no speed of its own */
  grab() {
    this.v = 0;
  }

  /** let go towards `target` with the hand's last speed (px/s) */
  release(target: number, v: number) {
    this.target = target;
    this.v = v;
  }

  /** at rest, within a hair */
  get settled(): boolean {
    return Math.abs(this.x - this.target) < 0.4 && Math.abs(this.v) < 12;
  }

  /**
   * One frame of `dt` seconds, in small steps so a long frame (a tab coming
   * back) cannot throw the spring. Returns whether it has settled.
   */
  tick(dt: number): boolean {
    let left = Math.min(dt, 0.064);
    while (left > 0) {
      const h = Math.min(left, 1 / 240);
      const d = this.x - this.target;
      const a = -this.k * d - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
      left -= h;
    }
    if (this.settled) {
      this.x = this.target;
      this.v = 0;
      return true;
    }
    return false;
  }
}

/** What lies on the band: the cards' photos in order, which one is at 0, and their centres. */
export type Band = {
  ids: (string | undefined)[];
  here: string | undefined;
  centres: number[] | null;
};

/**
 * The photo changed: how far the band has to be moved so that nothing on
 * screen moves. The card now at 0 was at some centre c on the band before,
 * so the band's x grows by c — the spring then takes it in, keeping its
 * speed. 'same' when nothing changed; null when the photo was not on the
 * band before (it came from elsewhere and is simply there).
 *
 * Which card is here is part of what the band is: a roll of four photos has
 * the same cards at its second photo and at its third, and comparing the
 * cards alone called that "same" and left the band where the hand let go.
 */
export function rebase(prev: Band, next: Band): number | 'same' | null {
  if (
    prev.here === next.here &&
    prev.ids.length === next.ids.length &&
    prev.ids.every((id, n) => id === next.ids[n])
  )
    return 'same';
  const n = next.here === undefined ? -1 : prev.ids.indexOf(next.here);
  if (n < 0 || !prev.centres) return null;
  return prev.centres[n];
}

/** the hand's speed from its last few points (px/s), over at most `window` ms */
export function speedOf(points: { x: number; t: number }[], window = 80): number {
  if (points.length < 2) return 0;
  const last = points[points.length - 1];
  let first = points[0];
  for (let i = points.length - 2; i >= 0; i--) {
    first = points[i];
    if (last.t - points[i].t >= window) break;
  }
  const dt = last.t - first.t;
  return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0;
}
