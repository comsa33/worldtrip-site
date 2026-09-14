import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const LEARNED_KEY = 'mapDragLearned';
/** a mouse that opened the map and then held still for this long has not found the aim */
const STILL_MS = 700;

const readLearned = () => {
  try {
    return localStorage.getItem(LEARNED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * When to show the map's drag mark, and at what size.
 *
 * The journey's two maps are aimed by taking hold and moving sideways, which
 * nothing on a phone says: a tap opens the map and then it just sits there. So
 * the open map shows the gesture itself, once, at its bottom edge — until the
 * hand does it. A finger sees it as soon as its tap has opened the map; a mouse,
 * whose ring already follows it, only if it opened the map and then rested.
 * The first stop actually reached this way is the lesson learned, and the mark
 * is not shown again in this browser.
 */
export function useMapDragHint(open: boolean, svg: RefObject<SVGSVGElement | null>, viewW: number) {
  const [kind, setKind] = useState<'touch' | 'mouse'>('mouse');
  const [moved, setMoved] = useState(false);
  const [still, setStill] = useState(false);
  const [learned, setLearned] = useState(readLearned);
  /** viewBox units per screen pixel, so the mark keeps its size while the map opens */
  const [k, setK] = useState(1);
  const timer = useRef(0);

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
    };
  }, [open, svg, viewW, kind]);

  const pointer = useCallback((type: string) => setKind(type === 'touch' ? 'touch' : 'mouse'), []);
  const aimed = useCallback(() => {
    window.clearTimeout(timer.current);
    setMoved(true);
  }, []);
  const reached = useCallback(() => {
    setLearned(true);
    try {
      localStorage.setItem(LEARNED_KEY, '1');
    } catch {
      /* private mode: this visit only */
    }
  }, []);

  const visible = open && !learned && !moved && (kind === 'touch' || still);
  return { visible, touch: kind === 'touch', k, pointer, aimed, reached };
}
