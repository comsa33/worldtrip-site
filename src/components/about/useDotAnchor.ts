import { useEffect, useState, type RefObject } from 'react';

/** The note's footprint beside the dot, in screen pixels, for choosing a side. */
export const NOTE_W = 380;
export const NOTE_H = 120;
export const NOTE_GAP = 30;

/** Frames the dot has to hold still before the note stops following it. */
const STILL_FRAMES = 8;
/** What the block must clear: the header, and the scrubber with its gutter. */
const TOP_LIMIT = 56 + 16;
const BOTTOM_INSET = 152;

export type Side = 'below' | 'above';

/**
 * Pins a block to the travelling dot, on screens wide enough to have a globe
 * beside the text.
 *
 * The seat the dot rides on the globe (`.journey-seat`) is moved every frame;
 * this reads where it is and hands the block the same place through
 * `--note-x` / `--note-y`. It keeps reading while the camera is still gliding
 * in, so the words come to rest where the dot does rather than where it was,
 * and lets go once the dot has held still — from then on the block is simply
 * there. `side` is where the caller would like the words; if the block would
 * not fit there between the header and the scrubber it takes the other side.
 * Phones keep their fixed block: nothing is set and the CSS falls through.
 */
export function useDotAnchor(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  side: Side = 'below'
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    if (window.matchMedia('(max-width: 768px)').matches) return;
    const seat = document.querySelector<HTMLElement>('.journey-seat');
    if (!seat) return;

    let raf = 0;
    let still = 0;
    let lx = NaN;
    let ly = NaN;
    const tick = () => {
      // the seat is only somewhere once the globe has placed it
      if (!seat.style.transform) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const r = seat.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      el.style.setProperty('--note-x', `${Math.round(x)}px`);
      el.style.setProperty('--note-y', `${Math.round(y)}px`);

      const h = el.offsetHeight;
      const fitsBelow = y + NOTE_GAP + h <= window.innerHeight - BOTTOM_INSET;
      const fitsAbove = y - NOTE_GAP - h >= TOP_LIMIT;
      let s: Side = side;
      if (s === 'below' && !fitsBelow && fitsAbove) s = 'above';
      if (s === 'above' && !fitsAbove && fitsBelow) s = 'below';
      el.dataset.side = s;
      el.classList.add('is-anchored');

      still = Math.abs(x - lx) < 0.5 && Math.abs(y - ly) < 0.5 ? still + 1 : 0;
      lx = x;
      ly = y;
      if (still < STILL_FRAMES) raf = requestAnimationFrame(tick);
    };
    // the window changing size moves the globe, and the dot with it: pick the
    // block up and follow again until the dot has come to rest
    const follow = () => {
      cancelAnimationFrame(raf);
      still = 0;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener('resize', follow);
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', follow);
    };
  }, [ref, active, side]);
}

/**
 * Keeps a block in the document a moment after it has been asked to go, so it
 * can fade rather than vanish. Returns whether to render, and whether the
 * block is on its way out.
 */
export function useLinger(active: boolean, ms: number): { mounted: boolean; leaving: boolean } {
  // `active` becoming true renders at once; only the way out is delayed
  const [gone, setGone] = useState(!active);
  useEffect(() => {
    if (active) return;
    const t = window.setTimeout(() => setGone(true), ms);
    return () => window.clearTimeout(t);
  }, [active, ms]);
  const mounted = active || !gone;
  // an arrival resets the clock for the next departure, outside the effect
  if (active && gone) setGone(false);
  return { mounted, leaving: !active && mounted };
}
