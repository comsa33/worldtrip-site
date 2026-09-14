import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const LEARNED_KEY = 'mapDragLearned';
/** a mouse that opened the map and then held still for this long has not found the aim */
const STILL_MS = 700;
/** how long after the hand stops the slider eases back to rest */
const REST_MS = 450;
/** the track's length in pixels, end to end */
export const TRACK_PX = 48;

const readLearned = () => {
  try {
    return localStorage.getItem(LEARNED_KEY) === '1';
  } catch {
    return false;
  }
};

export type HintMode = 'off' | 'demo' | 'rest';

/**
 * The slider at the bottom of the journey's two maps.
 *
 * The maps are aimed by taking hold and moving sideways, which nothing on a
 * phone says: a tap opens the map and then it just sits there. So the open map
 * carries a small slider — its aim ring on a short track. The first time it
 * shows the gesture (pressed, slid one way and back) until the hand does it; a
 * mouse, whose ring already follows it, sees that only if it opened the map and
 * rested. After that the slider stays, faint, and is true rather than
 * decorative: at rest its ring stands where the reader is in the whole
 * journey, and while the hand moves it comes up to full ink and slides with the
 * hand, saying how far along the aim has gone. The first stop reached this way
 * is remembered, and the demonstration is not given again in this browser.
 *
 * `at` is where the reader stands, as the map's own `across` (0–1).
 */
export function useMapDragHint(
  open: boolean,
  svg: RefObject<SVGSVGElement | null>,
  viewW: number,
  at: number
) {
  const [kind, setKind] = useState<'touch' | 'mouse'>('mouse');
  const [moved, setMoved] = useState(false);
  const [still, setStill] = useState(false);
  const [learned, setLearned] = useState(readLearned);
  /** viewBox units per screen pixel, so the slider keeps its size while the map opens */
  const [k, setK] = useState(1);
  const timer = useRef(0);
  const restTimer = useRef(0);
  const rootRef = useRef<SVGGElement>(null);
  const handRef = useRef<SVGGElement>(null);
  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  }, [at]);

  const [openWas, setOpenWas] = useState(open);
  if (open !== openWas) {
    // a new open starts a new look (state reset during render, per React guidance)
    setOpenWas(open);
    setMoved(false);
    setStill(false);
  }

  useEffect(() => {
    const el = svg.current;
    if (!open || !el) return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      if (w) setK(viewW / w);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (kind === 'mouse') timer.current = window.setTimeout(() => setStill(true), STILL_MS);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer.current);
      window.clearTimeout(restTimer.current);
    };
  }, [open, svg, viewW, kind]);

  const pointer = useCallback((type: string) => setKind(type === 'touch' ? 'touch' : 'mouse'), []);

  /**
   * The hand is aiming, `across` of the way. Written straight onto the nodes —
   * a pointer moves every frame and the map it sits in must not re-render for it.
   */
  const aimed = useCallback((across: number) => {
    window.clearTimeout(timer.current);
    setMoved((m) => m || true);
    const root = rootRef.current;
    const hand = handRef.current;
    if (!root || !hand) return;
    root.classList.add('is-active');
    hand.style.transform = `translateX(${((clamp(across) - 0.5) * TRACK_PX).toFixed(1)}px)`;
    window.clearTimeout(restTimer.current);
    restTimer.current = window.setTimeout(() => {
      root.classList.remove('is-active');
      hand.style.transform = `translateX(${((clamp(atRef.current) - 0.5) * TRACK_PX).toFixed(1)}px)`;
    }, REST_MS);
  }, []);

  const reached = useCallback(() => {
    setLearned(true);
    try {
      localStorage.setItem(LEARNED_KEY, '1');
    } catch {
      /* private mode: this visit only */
    }
  }, []);

  const mode: HintMode = !open
    ? 'off'
    : !learned && !moved && (kind === 'touch' || still)
      ? 'demo'
      : 'rest';
  return { mode, touch: kind === 'touch', k, rootRef, handRef, pointer, aimed, reached };
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
