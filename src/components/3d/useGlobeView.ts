/**
 * Looking around the globe — the header and the globe, and nothing else.
 *
 * Nothing moves the journey while it is open: the page scroll is held where the
 * reader left it, so the route, the dot and every city keep the tense they had.
 * The hand turns the world and pulls it close; pulled close enough, the cities
 * already walked say their names wherever a name has room.
 *
 * Canvas: design/globe-view/ (artifact 72ca9eab-2d87-435c-b79b-cd90f2ead471).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';

export type GlobeMode = 'off' | 'on' | 'leaving';

const HASH = '#globe';

/**
 * A phone on its side. Three hundred and ninety pixels of height leave no room
 * for the rail, the maps and the scrubber, and a globe is the one thing that
 * gets better for a wide screen — so turning the phone is a way in, and
 * turning it back is the way out. A tablet or a desktop window keeps its HUD.
 */
const SIDEWAYS =
  '(hover: none) and (pointer: coarse) and (orientation: landscape) and (max-height: 500px)';
const sideways = () => typeof window !== 'undefined' && window.matchMedia(SIDEWAYS).matches;

/**
 * The mode, and the address that goes with it. `#globe` opens straight into it
 * and the browser's back is a way out, so entering pushes an entry and leaving
 * pops the one it pushed. `leaving` lasts while the camera comes home — the
 * scroll is free again but the HUD waits for the camera (`settled`).
 */
export function useGlobeView({ held = false }: { held?: boolean } = {}) {
  const [mode, setMode] = useState<GlobeMode>(() =>
    typeof window !== 'undefined' && window.location.hash === HASH ? 'on' : 'off'
  );

  /*
   * Held open by the phone lying on its side — not an entry in the history.
   * What the reader is looking at keeps the screen: with the photo book open
   * (`held`) the phone turning gives the photos a wider screen instead, and
   * the globe takes over only once the book is closed.
   */
  const [sideway, setSideway] = useState(sideways);
  const forced = sideway && !held;
  const forcedRef = useRef(forced);
  useEffect(() => {
    forcedRef.current = forced;
  }, [forced]);
  useEffect(() => {
    const mq = window.matchMedia(SIDEWAYS);
    const onChange = () => {
      // stood back up: a globe the reader did not open themselves goes home —
      // if it was showing at all
      if (!mq.matches && forcedRef.current) setMode((m) => (m === 'off' ? 'leaving' : m));
      setSideway(mq.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const want = window.location.hash === HASH;
      setMode((m) => (want ? 'on' : m === 'on' ? 'leaving' : m));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const enter = useCallback(() => {
    if (window.location.hash !== HASH) {
      history.pushState(
        { globe: true },
        '',
        `${window.location.pathname}${window.location.search}${HASH}`
      );
    }
    setMode('on');
  }, []);

  const exit = useCallback(() => {
    if (window.location.hash === HASH) {
      if ((history.state as { globe?: boolean } | null)?.globe) {
        // pop the entry we pushed, but don't wait for its popstate to leave —
        // on a phone that arrived a second after the tap
        history.back();
        setMode((m) => (m === 'on' ? 'leaving' : m));
        return;
      }
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setMode((m) => (m === 'on' ? 'leaving' : m));
  }, []);

  const settled = useCallback(() => setMode((m) => (m === 'leaving' ? 'off' : m)), []);

  const shown: GlobeMode = forced ? 'on' : mode;
  return useMemo(
    () => ({ mode: shown, forced, enter, exit, settled }),
    [shown, forced, enter, exit, settled]
  );
}

/**
 * While the mode is on, the page stays where it is. The attribute on <html> is
 * what the stylesheet reads to put the HUD away — the overlays are not all
 * children of one element.
 */
export function useGlobeViewDocument(mode: GlobeMode) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (mode === 'off') root.removeAttribute('data-globe-view');
    else root.setAttribute('data-globe-view', mode);
    if (mode !== 'on') return;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = overflow;
    };
  }, [mode]);
  useEffect(() => () => document.documentElement.removeAttribute('data-globe-view'), []);
}

// ---- distances -----------------------------------------------------------------

const GLOBE_R = 2;
/** the globe's diameter against the shorter side of the screen, all of it in view */
const FIT = 0.8;
/** pulled all the way in, the shorter side of the screen spans this much of the world (≈1,600 km) */
const NEAREST_SPAN = 0.5;

/** How far the camera stands for the whole globe to fill FIT of the shorter side. */
export function fitDistance(aspect: number, fovDeg = 45) {
  const k = FIT * Math.tan((fovDeg * Math.PI) / 360) * Math.min(1, aspect);
  return (GLOBE_R * Math.sqrt(1 + k * k)) / k;
}

/** The nearest the hand may pull: about a country across the shorter side. */
export function nearestDistance(aspect: number, fovDeg = 45) {
  const t = Math.tan((fovDeg * Math.PI) / 360) * Math.min(1, aspect);
  return GLOBE_R + NEAREST_SPAN / 2 / t;
}

// ---- back to the whole globe: double click, double tap ----------------------------

/** Two taps within this long and this close are one gesture. */
const TAP_MS = 300;
const TAP_PX = 24;

export function useDoubleTap(active: boolean, onDouble: () => void) {
  const { gl, events } = useThree();
  const cb = useRef(onDouble);
  useEffect(() => {
    cb.current = onDouble;
  });
  useEffect(() => {
    if (!active) return;
    const el = (events.connected as HTMLElement | undefined) ?? gl.domElement;
    let last = { t: 0, x: 0, y: 0 };
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      // a drag is a turn, not a tap
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
      const now = performance.now();
      if (now - last.t < TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < TAP_PX) {
        last = { t: 0, x: 0, y: 0 };
        cb.current();
        return;
      }
      last = { t: now, x: e.clientX, y: e.clientY };
    };
    const onDbl = () => cb.current();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('dblclick', onDbl);
    };
  }, [active, gl, events]);
}

// ---- names -----------------------------------------------------------------------

export type GlobeLabel = {
  city: string;
  name: string;
  position: THREE.Vector3;
  /** the order names claim room in — the city the dot is on first, then the longest stays */
  rank: number;
  current: boolean;
};
