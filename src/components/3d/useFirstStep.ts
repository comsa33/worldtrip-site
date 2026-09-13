import { useEffect, useState, type RefObject } from 'react';

/**
 * The first step, the hooks: when the reader has moved on their own, and the
 * dot leaning up the first leg until they do. See FirstStep.tsx for the DOM.
 */

const MOVED_KEY = 'first-move';

// Remembered for this tab only. A reader who comes back tomorrow has forgotten
// how the page moves as surely as a new one, and the hint costs nothing before
// the first input — it only ever plays in the pause before the reader acts.
export const readMoved = () => {
  try {
    return sessionStorage.getItem(MOVED_KEY) === '1';
  } catch {
    return false;
  }
};

/** True once the reader has moved the journey themselves, in this tab. */
export function useFirstMove(): boolean {
  const [moved, setMoved] = useState(readMoved);
  useEffect(() => {
    if (moved) return;
    const done = () => {
      setMoved(true);
      try {
        sessionStorage.setItem(MOVED_KEY, '1');
      } catch {
        /* private mode */
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', ' ', 'PageDown', 'PageUp'].includes(e.key)) done();
    };
    // A click is not a move: a reader giving the page focus, or pressing on
    // the map, has not yet learned how it travels. Nor is a tap — a finger set
    // down and lifted has not swiped. Wheel, a dragging finger and the keys
    // are the moves the hint teaches, so those are what end it.
    window.addEventListener('wheel', done, { passive: true, once: true });
    window.addEventListener('touchmove', done, { passive: true, once: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', done);
      window.removeEventListener('touchmove', done);
      window.removeEventListener('keydown', onKey);
    };
  }, [moved]);
  return moved;
}

/** How far along the next leg the dot leans, as a share of the leg. */
export const LEAN = 0.32;
/** Out, then back — the same shape as a move that changes its mind. */
const OUT_MS = 500;
const BACK_MS = 700;
/**
 * The pause before each lean: a beat after the opening's full stop, then
 * further and further apart, then never. The words beside the dot stay until
 * the reader swipes; only the movement gives up. A mark that keeps nudging at
 * a steady beat is asking for attention, and it would pull the eye off the
 * opening the reader may still be reading.
 */
const LEAN_GAPS_MS = [1200, 6000, 12000, 24000];

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * The dot leans up the leg ahead and settles back. HeadTracker reads `lean`
 * every frame and moves the head of the route by that share of the first leg,
 * so what the reader sees is the mark drawn out along the route exactly the
 * way it is when the journey moves — a ribbon, then a dot again — pointing
 * where the first scroll will take it.
 */
export function useLean(enabled: boolean, lean: RefObject<number>) {
  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let timer = 0;
    const play = (then: () => void) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = now - t0;
        if (t < OUT_MS) lean.current = LEAN * easeOut(t / OUT_MS);
        else if (t < OUT_MS + BACK_MS)
          lean.current = LEAN * (1 - easeInOut((t - OUT_MS) / BACK_MS));
        else {
          lean.current = 0;
          then();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const cleanups: (() => void)[] = [];
    // a lean in a tab nobody is looking at is one the reader never saw:
    // hold it until the page is back in view
    const whenSeen = (go: () => void) => {
      if (!document.hidden) return go();
      const onShow = () => {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', onShow);
        go();
      };
      document.addEventListener('visibilitychange', onShow);
      cleanups.push(() => document.removeEventListener('visibilitychange', onShow));
    };
    const next = (i: number) => {
      if (i >= LEAN_GAPS_MS.length) return;
      timer = window.setTimeout(() => whenSeen(() => play(() => next(i + 1))), LEAN_GAPS_MS[i]);
    };
    next(0);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      cleanups.forEach((c) => c());
      lean.current = 0;
    };
  }, [enabled, lean]);
}
