import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import minimap from '../../data/minimap.json';

interface MinimapData {
  w: number;
  h: number;
  scale: number;
  translate: [number, number];
  land: string; // pre-projected land silhouette (SVG path)
  legs: string[]; // pre-projected route, one path per leg (stop i -> stop i+1)
}

type Aim = { x: number; y: number; stop: number };

interface MinimapStop {
  id: number;
  city: string;
  startDate?: string;
}

interface MinimapCity {
  lat: number;
  lng: number;
}

// Natural Earth I, the same projection scripts/build-geo.mjs used for the land + legs
function naturalEarth1(lambda: number, phi: number): [number, number] {
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return [
    lambda *
      (0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))),
    phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))),
  ];
}

const data = minimap as MinimapData;
const RAD = Math.PI / 180;

/**
 * The map itself: land and 154 legs, which only change when the journey moves
 * one stop on. Kept out of the aiming so a pointer crossing the open map does
 * not ask React to look at every leg again sixty times a second — that is what
 * made following the route stutter.
 */
const World = memo(function World({ currentStopIdx }: { currentStopIdx: number }) {
  return (
    <>
      <path d={data.land} className="minimap__land" />
      {data.legs.map((d, i) => (
        <path
          key={i}
          d={d}
          className={`minimap__leg${i + 1 <= currentStopIdx ? ' is-past' : ''}`}
        />
      ))}
    </>
  );
});

function project(lat: number, lng: number): [number, number] {
  const [x, y] = naturalEarth1(lng * RAD, lat * RAD);
  return [data.translate[0] + data.scale * x, data.translate[1] - data.scale * y];
}

/** A mouse crossing the corner on its way elsewhere should not open it. */
const OPEN_DELAY_MS = 140;
/** How finely the route is sampled for aiming, in viewBox units. */
const SAMPLE = 3;
/** How long the hand has to be still before the name of the place comes up. */
const LABEL_REST_MS = 180;

/**
 * The whole 330-day line at a glance: the route in the globe's own two tenses —
 * orange behind, warm and dull ahead — and the current position as the one
 * filled mark. Click anywhere to jump to the nearest stop.
 *
 * At its resting size it is too small to aim at, so it opens first and is aimed
 * at second. A mouse opens it by resting on it; a finger, which cannot hover,
 * opens it with a tap. Closed, a click only opens — never jumps. Aiming at a
 * 240px world would be guessing, and a guess that throws the reader three
 * months down the journey is worse than nothing happening.
 *
 * The hit test is taken against the map's own box, so the bigger it is the
 * finer the aim, and the route stays a hairline at any size.
 *
 * Open, the pointer is put away and the aim is drawn on the route instead: a
 * ring on the stop the click would actually land on, named and dated. A world
 * at this size has no pixel that means anything on its own, so an arrow resting
 * on one says nothing — the ring says where you would come out. A finger gets
 * the same thing by pressing and sliding, and leaves by lifting, which is the
 * one gesture a touch screen has that a hover would be.
 */
export function Minimap({
  stops,
  cities,
  currentStopIdx,
  lat,
  lng,
  open,
  onOpenChange,
  onSelect,
}: {
  stops: MinimapStop[];
  cities: Record<string, MinimapCity>;
  currentStopIdx: number;
  lat: number;
  lng: number;
  /**
   * Open is not this map's own any more: only one map is open at a time, so the
   * page holds which. Two open maps means two rings saying where the hand is,
   * and the cursor is put away while either of them is being aimed.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (index: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const stopPoints = useMemo(
    () =>
      stops.map((s) => {
        const c = cities[s.city];
        return c ? project(c.lat, c.lng) : ([0, 0] as [number, number]);
      }),
    [stops, cities]
  );
  const [cx, cy] = project(lat, lng);

  /**
   * The route as points on itself, sampled once.
   *
   * Aiming at the nearest stop meant matching both axes at a city, which is
   * aiming at a dot. Aiming at the nearest point of the LINE means the mark
   * slides along the route as the hand moves across it, and a hand that only
   * moves sideways still travels the whole journey. The stop it would land on
   * is the nearer end of whichever leg the point fell on.
   */
  const { rail, mark } = useMemo(() => {
    const out: { x: number; y: number; leg: number }[] = [];
    // where along the rail each stop stands, so the aim can start from one
    const mark: number[] = [];
    const svg =
      typeof document === 'undefined'
        ? null
        : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = svg && document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (svg && path) svg.appendChild(path);
    data.legs.forEach((d, leg) => {
      if (!path) return;
      path.setAttribute('d', d);
      const total = path.getTotalLength();
      const steps = Math.max(1, Math.ceil(total / SAMPLE));
      mark[leg] = out.length;
      for (let i = 0; i <= steps; i++) {
        const pt = path.getPointAtLength((total * i) / steps);
        out.push({ x: pt.x, y: pt.y, leg });
      }
      mark[leg + 1] = out.length - 1;
    });
    return { rail: out, mark };
  }, []);

  /** where the reader already is, as a share of the map's width */
  const anchorAcross = useMemo(() => {
    if (rail.length < 2) return 0.5;
    const at = mark[currentStopIdx] ?? rail.length - 1;
    return 1 - at / (rail.length - 1);
  }, [rail.length, mark, currentStopIdx]);

  const setOpen = onOpenChange;
  const openTimer = useRef(0);
  const moveRaf = useRef(0);
  /** where the hand was when it took hold, and where the reader was then */
  const grip = useRef<{ x: number; across: number } | null>(null);
  const byTouch = useRef(false);

  /**
   * The aim is not React's.
   *
   * A pointer crossing the map moves every frame, and a state change every
   * frame means a render every frame — on a page already giving the globe all
   * sixty of them. So the mark is moved by hand: three attributes written
   * straight onto the nodes, and the name only when the name changes. React
   * hears about none of it, and the ring rides the line without catching.
   */
  const aimRef = useRef<Aim | null>(null);
  const gRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const labelRef = useRef<SVGTextElement>(null);
  const shownStop = useRef(-1);
  const labelTimer = useRef(0);

  const paintAim = useCallback(
    (a: Aim | null) => {
      aimRef.current = a;
      const g = gRef.current;
      const label = labelRef.current;
      if (!g) return;
      window.clearTimeout(labelTimer.current);
      if (!a) {
        g.style.display = 'none';
        if (label) label.style.opacity = '0';
        shownStop.current = -1;
        return;
      }
      g.style.display = '';
      ringRef.current?.setAttribute('cx', String(a.x));
      ringRef.current?.setAttribute('cy', String(a.y));
      if (!label) return;

      /*
       * The ring keeps up with the hand; the name does not try to. A hundred and
       * fifty names flickering past under a moving mark is noise, and nobody is
       * reading them on the way — they are reading the one they stopped at. So
       * the name goes out while the hand moves and comes back, softly, once it
       * has been still for a moment.
       */
      label.style.opacity = '0';
      labelTimer.current = window.setTimeout(() => {
        // placed only now: moving a text node every frame costs a layout, and
        // nobody is reading it on the way
        const flip = a.x > data.w * 0.72;
        label.setAttribute('x', String(a.x + (flip ? -15 : 15)));
        label.setAttribute('y', String(a.y + 6));
        label.setAttribute('text-anchor', flip ? 'end' : 'start');
        if (shownStop.current !== a.stop) {
          shownStop.current = a.stop;
          const st = stops[a.stop];
          const when = st?.startDate ? `  ${st.startDate.slice(0, 7).replace('-', '.')}` : '';
          label.textContent = (st?.city ?? '') + when;
        }
        label.style.opacity = '1';
      }, LABEL_REST_MS);
    },
    [stops]
  );

  // an opened map closes again on the next press elsewhere, like any other sheet
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!svgRef.current?.contains(e.target as Node)) {
        setOpen(false);
        grip.current = null;
        paintAim(null);
      }
    };
    document.addEventListener('pointerdown', away, { passive: true });
    return () => document.removeEventListener('pointerdown', away);
  }, [open, setOpen, paintAim]);

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(labelTimer.current);
      if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
    },
    []
  );

  /**
   * The globe behind this listens for touches on the whole page and reads them
   * as its own swipe — a finger aiming at the map was also, to the globe, a
   * finger throwing the journey somewhere. Its listeners are native and sit on
   * an ancestor, so a synthetic handler cannot stop them; this one can, and the
   * touch that starts on the map stays the map's.
   */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const keep = (e: Event) => e.stopPropagation();
    const kinds = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
    kinds.forEach((k) => el.addEventListener(k, keep, { passive: true }));
    return () => kinds.forEach((k) => el.removeEventListener(k, keep));
  }, []);

  // a mouse resting on it opens it; a finger has no resting, so its tap does
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    byTouch.current = e.pointerType === 'touch';
    // a new hold starts where it starts, wherever the last one ended
    grip.current = null;
    // A finger that slides is a drag, and a drag the element has not claimed is
    // the browser's to cancel — which it did, quietly, so the aim was drawn all
    // the way and then went nowhere on the lift. Claiming it keeps the moves and
    // the lift coming here.
    if (e.pointerType === 'touch') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer already gone */
      }
    }
  };
  const onEnter = (e: React.PointerEvent<SVGSVGElement>) => {
    byTouch.current = e.pointerType === 'touch';
    if (e.pointerType === 'touch') return;
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };
  // a lifted finger fires pointerleave too, and that is not a mouse going away —
  // taken as one it shut the map in the same breath as the tap that opened it
  const onLeave = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') return;
    window.clearTimeout(openTimer.current);
    setOpen(false);
    grip.current = null;
    paintAim(null);
  };

  /**
   * Where on the route the hand is, read straight off its sideways position.
   *
   * Nearest-point could not do it. A hand sweeping at one height only ever found
   * the legs that happened to lie near that height, so most of the journey was
   * unreachable — it skipped. Reading the hand's distance along the route
   * instead passes through every leg in order, however the line wanders, and
   * where two legs cross there is nothing to choose between: there is one place
   * that far along.
   *
   * The reading runs right to left because the journey does. It leaves Korea
   * westward and spends most of a year going that way, so «further right» has to
   * mean «further back along the line» for the mark to travel the same direction
   * as the hand pushing it.
   *
   * No search: the samples are evenly spaced, so this is an index and a
   * fraction, and the mark slides between two of them rather than stepping.
   *
   * And it is counted FROM where the reader already stands. Read from the left
   * edge instead, the ring jumped three months away the instant a hand landed
   * on the map, which is not what a hand put down on a place is asking for —
   * a gesture carries on from where it was put down. The width still spans the
   * whole journey, so the hand moves at the rate it always did; it simply starts
   * counting from here.
   */
  const aimAt = (clientX: number): Aim | null => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || rail.length < 2) return null;
    const hold = grip.current ?? { x: clientX, across: anchorAcross };
    const hx = clientX - r.left;
    const at = hold.x - r.left;
    const a0 = hold.across;
    const across = a0 + (hx - at) / r.width;
    const u = 1 - Math.max(0, Math.min(1, across));
    const f = u * (rail.length - 1);
    const i = Math.min(rail.length - 2, Math.floor(f));
    const t = f - i;
    const a = rail[i];
    const b = rail[i + 1];
    const joined = a.leg === b.leg;
    const x = joined ? a.x + (b.x - a.x) * t : a.x;
    const y = joined ? a.y + (b.y - a.y) * t : a.y;
    const ends = stopPoints[a.leg];
    const next = stopPoints[a.leg + 1] ?? ends;
    const da = (ends[0] - x) ** 2 + (ends[1] - y) ** 2;
    const db = (next[0] - x) ** 2 + (next[1] - y) ** 2;
    return { x, y, stop: da <= db ? a.leg : a.leg + 1 };
  };

  // a pointer can fire faster than the screen draws; one aim per frame is plenty
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!open) return;
    const { clientX } = e;
    if (!grip.current) grip.current = { x: clientX, across: anchorAcross };
    if (moveRaf.current) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0;
      paintAim(aimAt(clientX));
    });
  };

  const commit = (a: Aim | null) => {
    // a finger is done with it; a mouse is still resting on it and may pick again
    if (byTouch.current) setOpen(false);
    grip.current = null;
    paintAim(null);
    if (a) onSelect(a.stop);
  };

  /**
   * A finger that slid before lifting produced no click — the browser calls a
   * moved touch a drag, not a tap — so the aim was drawn and then thrown away.
   * Touch commits on the lift itself; the mouse keeps the click.
   */
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'touch') return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (!open) {
      setOpen(true);
      return;
    }
    commit(aimRef.current ?? aimAt(e.clientX));
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (byTouch.current) return;
    // shut, it is a picture of the journey and nothing more
    if (!open) {
      window.clearTimeout(openTimer.current);
      setOpen(true);
      return;
    }
    commit(aimRef.current ?? aimAt(e.clientX));
  };
  return (
    <svg
      ref={svgRef}
      className={`minimap${open ? ' is-open' : ''}`}
      viewBox={`0 0 ${data.w} ${data.h}`}
      onClick={onClick}
      onPointerDown={onDown}
      onPointerEnter={onEnter}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => paintAim(null)}
      onPointerLeave={onLeave}
      role="img"
      aria-label="Route overview"
    >
      <World currentStopIdx={currentStopIdx} />
      <circle cx={cx} cy={cy} r={17} className="minimap__ring" />
      <circle cx={cx} cy={cy} r={11} className="minimap__head" />
      <g className="minimap__aim" ref={gRef} style={{ display: 'none' }}>
        <circle ref={ringRef} r={9} />
        <text ref={labelRef} style={{ opacity: 0 }} />
      </g>
    </svg>
  );
}
