import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INSET_BOX, countryShape } from './countryShape';
import { viewKm } from './cityZoom';

type Aim = { x: number; y: number; stop: number };

interface InsetStop {
  id: number;
  city: string;
  country: string;
  startDate?: string;
}

interface InsetCity {
  lat: number;
  lng: number;
}

/** A mouse crossing the corner on its way elsewhere should not open it. */
const OPEN_DELAY_MS = 140;
/** How finely the route is sampled for aiming, in viewBox units. */
const SAMPLE = 6;
/** How long the hand has to be still before the name of the place comes up. */
const LABEL_REST_MS = 180;
/**
 * Once it is up it stays up until the country fits with room to spare. Without
 * the margin a stop that lands exactly on the line would flicker it in and out
 * as the camera settled.
 */
const HYSTERESIS = 1.05;

/**
 * Where in this country am I?
 *
 * The globe answers it only when the whole country is on screen, and it almost
 * never is: the camera rests at its closest nearly everywhere, which shows about
 * 528 × 330km, and every country the journey entered is bigger than that except
 * Belgium. So a corner of Brazil looks like a corner of anywhere, and the world
 * minimap cannot help — down there Brazil is a thumbnail.
 *
 * So: the current country in the opposite corner from the world, at 10m, with
 * the journey's own two tenses on it, the frame of what the globe is showing,
 * and a filled mark for now. It says nothing new — every material in it is
 * already on the screen somewhere else.
 *
 * It is the world minimap's grammar throughout, because a second map that
 * behaved differently would be a third thing to learn. Too small to aim at, so
 * it opens under the hand and is aimed at second; the aim is a ring on the route
 * rather than a pointer, and the cursor goes away while it is up.
 *
 * Including the one rule that looks like an exception. The world map reads right
 * to left because the journey leaves Korea westward: the rule there is not «right
 * is forwards», it is «the ring goes where the hand goes», and the direction
 * falls out of which way the line runs. A country's line runs its own way, so the
 * same rule gives a different sign — worked out per country below, not written
 * down. Reading every country left to right instead made the ring walk away from
 * the hand in Brazil, which is the one thing a cursor may never do.
 */
export function CountryInset({
  countryCode,
  stops,
  cities,
  currentStopIdx,
  restZoom,
  open,
  onOpenChange,
  onSelect,
}: {
  countryCode: string | null;
  stops: InsetStop[];
  cities: Record<string, InsetCity>;
  currentStopIdx: number;
  /** the zoom the camera rests at on this stop — see cityZoom.ts */
  restZoom: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (index: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const shape = useMemo(() => countryShape(countryCode), [countryCode]);

  /** every stop in this country, in the order the journey took them */
  const mine = useMemo(() => {
    if (!countryCode) return [];
    const out: { idx: number; x: number; y: number }[] = [];
    stops.forEach((s, idx) => {
      if (s.country !== countryCode) return;
      const c = cities[s.city];
      if (!c || !shape) return;
      const [x, y] = shape.project(c.lat, c.lng);
      out.push({ idx, x, y });
    });
    return out;
  }, [stops, cities, countryCode, shape]);

  /**
   * The legs drawn are the ones actually walked here: two stops in this country
   * that follow each other in the journey. Korea's first day and its last are
   * both Korean, but the line between them went round the world, and a straight
   * one across the peninsula would be a lie.
   */
  const legs = useMemo(() => {
    const out: { from: (typeof mine)[number]; to: (typeof mine)[number]; leg: number }[] = [];
    for (let i = 1; i < mine.length; i++) {
      if (mine[i - 1].idx !== mine[i].idx - 1) continue;
      out.push({ from: mine[i - 1], to: mine[i], leg: mine[i].idx - 1 });
    }
    return out;
  }, [mine]);

  /**
   * The route as points on itself, for aiming — over every stop in the country,
   * including the pair Spain's two stays leave unconnected. The ring has to be
   * able to reach a place the reader can see; a rail built only from drawn legs
   * would strand Madrid.
   */
  const rail = useMemo(() => {
    const out: { x: number; y: number; a: number; b: number }[] = [];
    if (mine.length === 1) return [{ x: mine[0].x, y: mine[0].y, a: 0, b: 0 }];
    for (let i = 0; i < mine.length - 1; i++) {
      const a = mine[i];
      const b = mine[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE));
      for (let s = 0; s <= steps; s++) {
        out.push({
          x: a.x + ((b.x - a.x) * s) / steps,
          y: a.y + ((b.y - a.y) * s) / steps,
          a: i,
          b: i + 1,
        });
      }
    }
    return out;
  }, [mine]);

  const here = mine.find((m) => m.idx === currentStopIdx) ?? mine[mine.length - 1];

  /**
   * Which way the hand pushes the ring forwards.
   *
   * The ring follows the hand — that is the whole rule, and it is the world
   * map's too. All that changes is which end of the line is on the left, and a
   * country answers that for itself: this is the slope of the stops' sideways
   * position against their order, so a route that drifts east reads left to
   * right and one that drifts west reads right to left. A route that comes back
   * where it started (Vietnam is Ho Chi Minh, Da Nang, Ho Chi Minh) has no
   * answer, and neither sign is wrong for it.
   */
  const forwardIsRight = useMemo(() => {
    if (mine.length < 2) return true;
    const mid = (mine.length - 1) / 2;
    const mx = mine.reduce((sum, m) => sum + m.x, 0) / mine.length;
    return mine.reduce((cov, m, i) => cov + (i - mid) * (m.x - mx), 0) >= 0;
  }, [mine]);

  /* ── whether it is wanted at all ────────────────────────────────────────── */
  const [aspect, setAspect] = useState(16 / 10);
  useEffect(() => {
    const read = () => setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  /**
   * How many screens of ground the country needs, from where the reader stands.
   * Read off the zoom the camera RESTS at rather than where it is this frame: a
   * leg that pulls the camera out to see the hop would otherwise say the country
   * fits, and the inset would blink away every time the journey moved.
   */
  const need = useMemo(() => {
    const c = shape && cities[stops[currentStopIdx]?.city];
    if (!shape || !c) return null;
    const reach = shape.reach(c.lat, c.lng);
    const view = viewKm(restZoom, aspect);
    return Math.max((reach.w * 2) / view.w, (reach.h * 2) / view.h);
  }, [shape, cities, stops, currentStopIdx, restZoom, aspect]);

  /**
   * What the globe is showing, drawn on the country — the locator frame an atlas
   * puts on its inset, and the thing the inset is answering: this much of it.
   *
   * Sized off the zoom the camera RESTS at, not where it is this frame. A live
   * frame would be more literally true and would mean a render every frame, and
   * a rectangle breathing in and out through every leg — the camera pulls back
   * to a tenth of this height to cross a border. At rest, which is where the
   * reader is actually looking, the two are the same number.
   *
   * On a 1440 × 900 screen over Brazil this is 528 × 330km, which comes out
   * 24 × 14px at the inset's resting size. It was left out of the first drawing
   * on a miscalculation that made it 4px.
   */
  const frame = useMemo(() => {
    const c = shape && cities[stops[currentStopIdx]?.city];
    if (!shape || !c || !here) return null;
    const view = viewKm(restZoom, aspect);
    const per = shape.scale(c.lat);
    const w = view.w * per.x;
    const h = view.h * per.y;
    return { x: here.x - w / 2, y: here.y - h / 2, w, h };
  }, [shape, cities, stops, currentStopIdx, restZoom, aspect, here]);

  /**
   * The margin only applies to going away: a country that does not fit brings
   * the map up at once, and one that comes to fit has to fit with room to spare
   * before it goes. So the answer is measured against the last answer, which
   * makes it state rather than arithmetic — adjusted here, in render, because an
   * effect would show one wrong frame first.
   */
  const [up, setUp] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  if (need !== measured) {
    setMeasured(need);
    setUp(need === null ? false : up ? need > 1 / HYSTERESIS : need > 1);
  }

  /* ── the aim, painted by hand — see Minimap.tsx for why it is not React's ── */
  const aimRef = useRef<Aim | null>(null);
  const gRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const labelRef = useRef<SVGTextElement>(null);
  const shownStop = useRef(-1);
  const labelTimer = useRef(0);
  const openTimer = useRef(0);
  const moveRaf = useRef(0);
  const byTouch = useRef(false);

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
      label.style.opacity = '0';
      labelTimer.current = window.setTimeout(() => {
        const flip = a.x > INSET_BOX * 0.62;
        label.setAttribute('x', String(a.x + (flip ? -26 : 26)));
        label.setAttribute('y', String(a.y + 10));
        label.setAttribute('text-anchor', flip ? 'end' : 'start');
        if (shownStop.current !== a.stop) {
          shownStop.current = a.stop;
          const st = stops[a.stop];
          const when = st?.startDate ? `  ${st.startDate.slice(5).replace('-', '.')}` : '';
          label.textContent = (st?.city ?? '') + when;
        }
        label.style.opacity = '1';
      }, LABEL_REST_MS);
    },
    [stops]
  );

  // the map closes itself when it stops being wanted, so it cannot be left open
  // over a country it is no longer drawing
  useEffect(() => {
    if (!up && open) {
      onOpenChange(false);
      paintAim(null);
    }
  }, [up, open, onOpenChange, paintAim]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!svgRef.current?.contains(e.target as Node)) {
        onOpenChange(false);
        paintAim(null);
      }
    };
    document.addEventListener('pointerdown', away, { passive: true });
    return () => document.removeEventListener('pointerdown', away);
  }, [open, onOpenChange, paintAim]);

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(labelTimer.current);
      if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
    },
    []
  );

  // the globe reads page-wide touches as its own swipe; one that starts here is
  // this map's (Minimap.tsx has the same guard, and the same reason)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const keep = (e: Event) => e.stopPropagation();
    const kinds = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
    kinds.forEach((k) => el.addEventListener(k, keep, { passive: true }));
    return () => kinds.forEach((k) => el.removeEventListener(k, keep));
  }, []);

  const aimAt = (clientX: number): Aim | null => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || rail.length === 0) return null;
    const across = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const u = forwardIsRight ? across : 1 - across;
    if (rail.length === 1) return { x: rail[0].x, y: rail[0].y, stop: mine[0].idx };
    const f = u * (rail.length - 1);
    const i = Math.min(rail.length - 2, Math.floor(f));
    const t = f - i;
    const p = rail[i];
    const q = rail[i + 1];
    const joined = p.a === q.a;
    const x = joined ? p.x + (q.x - p.x) * t : p.x;
    const y = joined ? p.y + (q.y - p.y) * t : p.y;
    const a = mine[p.a];
    const b = mine[p.b];
    const da = (a.x - x) ** 2 + (a.y - y) ** 2;
    const db = (b.x - x) ** 2 + (b.y - y) ** 2;
    return { x, y, stop: da <= db ? a.idx : b.idx };
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!open) return;
    const { clientX } = e;
    if (moveRaf.current) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0;
      paintAim(aimAt(clientX));
    });
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    byTouch.current = e.pointerType === 'touch';
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
    openTimer.current = window.setTimeout(() => onOpenChange(true), OPEN_DELAY_MS);
  };
  const onLeave = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') return;
    window.clearTimeout(openTimer.current);
    onOpenChange(false);
    paintAim(null);
  };

  const commit = (a: Aim | null) => {
    if (byTouch.current) onOpenChange(false);
    paintAim(null);
    if (a) onSelect(a.stop);
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'touch') return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (!open) {
      onOpenChange(true);
      return;
    }
    commit(aimRef.current ?? aimAt(e.clientX));
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (byTouch.current) return;
    if (!open) {
      window.clearTimeout(openTimer.current);
      onOpenChange(true);
      return;
    }
    commit(aimRef.current ?? aimAt(e.clientX));
  };

  if (!shape || !here) return null;

  return (
    <svg
      // a new country is a new drawing, not the old one bending into it: the
      // remount is what lets the outline come in by being drawn
      key={countryCode}
      ref={svgRef}
      className={`country-inset${open ? ' is-open' : ''}${up ? '' : ' is-away'}`}
      viewBox={`0 0 ${INSET_BOX} ${INSET_BOX}`}
      onClick={onClick}
      onPointerDown={onDown}
      onPointerEnter={onEnter}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => paintAim(null)}
      onPointerLeave={onLeave}
      role="img"
      aria-label={`${countryCode} overview`}
    >
      <path className="country-inset__land" d={shape.d} />
      {/* the same outline, traced once as it arrives, then gone */}
      <path className="country-inset__trace" d={shape.d} pathLength={1} />
      {frame && (
        <rect
          className="country-inset__view"
          x={frame.x.toFixed(1)}
          y={frame.y.toFixed(1)}
          width={frame.w.toFixed(1)}
          height={frame.h.toFixed(1)}
        />
      )}
      {legs.map((l) => (
        <path
          key={l.leg}
          className={`country-inset__leg${l.leg + 1 <= currentStopIdx ? ' is-past' : ''}`}
          d={`M${l.from.x.toFixed(1)},${l.from.y.toFixed(1)}L${l.to.x.toFixed(1)},${l.to.y.toFixed(1)}`}
        />
      ))}
      {/* a hole in the land, so the one filled mark is findable wherever it sits */}
      <circle cx={here.x} cy={here.y} r={26} className="country-inset__ring" />
      <circle cx={here.x} cy={here.y} r={17} className="country-inset__head" />
      <g className="country-inset__aim" ref={gRef} style={{ display: 'none' }}>
        <circle ref={ringRef} r={16} />
        <text ref={labelRef} style={{ opacity: 0 }} />
      </g>
    </svg>
  );
}
