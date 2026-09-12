import { useEffect, useState, type RefObject } from 'react';

/**
 * The first step, the hooks: when the reader has moved on their own, and the
 * dot leaning up the first leg until they do. See FirstStep.tsx for the DOM.
 */

const MOVED_KEY = 'first-move';

const readMoved = () => {
  try {
    return localStorage.getItem(MOVED_KEY) === '1';
  } catch {
    return false;
  }
};

/** True once the reader has moved the journey themselves — this visit or any before. */
export function useFirstMove(): boolean {
  const [moved, setMoved] = useState(readMoved);
  useEffect(() => {
    if (moved) return;
    const done = () => {
      setMoved(true);
      try {
        localStorage.setItem(MOVED_KEY, '1');
      } catch {
        /* private mode */
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', ' ', 'PageDown', 'PageUp'].includes(e.key)) done();
    };
    window.addEventListener('wheel', done, { passive: true, once: true });
    window.addEventListener('touchstart', done, { passive: true, once: true });
    window.addEventListener('pointerdown', done, { passive: true, once: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', done);
      window.removeEventListener('touchstart', done);
      window.removeEventListener('pointerdown', done);
      window.removeEventListener('keydown', onKey);
    };
  }, [moved]);
  return moved;
}

/** How far along the next leg the dot leans, as a share of the leg. */
const LEAN = 0.32;
/** The pause after the opening's full stop before the dot leans. */
const LEAN_AFTER_MS = 1200;
/** Out, then back — the same shape as a move that changes its mind. */
const OUT_MS = 500;
const BACK_MS = 700;
/** If nothing has happened since, once more; then never. */
const AGAIN_MS = 6000;

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
    const play = (then?: () => void) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = now - t0;
        if (t < OUT_MS) lean.current = LEAN * easeOut(t / OUT_MS);
        else if (t < OUT_MS + BACK_MS)
          lean.current = LEAN * (1 - easeInOut((t - OUT_MS) / BACK_MS));
        else {
          lean.current = 0;
          then?.();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    timer = window.setTimeout(() => {
      play(() => {
        timer = window.setTimeout(() => play(), AGAIN_MS);
      });
    }, LEAN_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      lean.current = 0;
    };
  }, [enabled, lean]);
}
