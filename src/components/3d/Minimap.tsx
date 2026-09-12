import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
const SAMPLE = 4;

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
  onSelect,
}: {
  stops: MinimapStop[];
  cities: Record<string, MinimapCity>;
  currentStopIdx: number;
  lat: number;
  lng: number;
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
  const rail = useMemo(() => {
    const out: { x: number; y: number; leg: number }[] = [];
    if (typeof document === 'undefined') return out;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(path);
    data.legs.forEach((d, leg) => {
      path.setAttribute('d', d);
      const total = path.getTotalLength();
      const steps = Math.max(1, Math.ceil(total / SAMPLE));
      for (let i = 0; i <= steps; i++) {
        const pt = path.getPointAtLength((total * i) / steps);
        out.push({ x: pt.x, y: pt.y, leg });
      }
    });
    return out;
  }, []);

  const [open, setOpen] = useState(false);
  const [aim, setAim] = useState<Aim | null>(null);
  const openTimer = useRef(0);
  const moveRaf = useRef(0);
  const byTouch = useRef(false);

  // an opened map closes again on the next press elsewhere, like any other sheet
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!svgRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setAim(null);
      }
    };
    document.addEventListener('pointerdown', away, { passive: true });
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
    },
    []
  );

  // a mouse resting on it opens it; a finger has no resting, so its tap does
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    byTouch.current = e.pointerType === 'touch';
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
    setAim(null);
  };

  /** the point of the route under the pointer, and the stop it would land on */
  const aimAt = (clientX: number, clientY: number): Aim | null => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || rail.length === 0) return null;
    const x = ((clientX - r.left) / r.width) * data.w;
    const y = ((clientY - r.top) / r.height) * data.h;
    let best = rail[0];
    let bestD = Infinity;
    for (let i = 0; i < rail.length; i++) {
      const d = (rail[i].x - x) ** 2 + (rail[i].y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = rail[i];
      }
    }
    // the nearer end of the leg the point fell on
    const a = stopPoints[best.leg];
    const b = stopPoints[best.leg + 1] ?? a;
    const da = (a[0] - best.x) ** 2 + (a[1] - best.y) ** 2;
    const db = (b[0] - best.x) ** 2 + (b[1] - best.y) ** 2;
    return { x: best.x, y: best.y, stop: da <= db ? best.leg : best.leg + 1 };
  };

  // a pointer can fire faster than the screen draws; one aim per frame is plenty
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!open) return;
    const { clientX, clientY } = e;
    if (moveRaf.current) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0;
      setAim(aimAt(clientX, clientY));
    });
  };

  const commit = (a: Aim | null) => {
    // a finger is done with it; a mouse is still resting on it and may pick again
    if (byTouch.current) setOpen(false);
    setAim(null);
    if (a) onSelect(a.stop);
  };

  /**
   * A finger that slid before lifting produced no click — the browser calls a
   * moved touch a drag, not a tap — so the aim was drawn and then thrown away.
   * Touch commits on the lift itself; the mouse keeps the click.
   */
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'touch') return;
    if (!open) {
      setOpen(true);
      return;
    }
    commit(aim ?? aimAt(e.clientX, e.clientY));
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (byTouch.current) return;
    // shut, it is a picture of the journey and nothing more
    if (!open) {
      window.clearTimeout(openTimer.current);
      setOpen(true);
      return;
    }
    commit(aimAt(e.clientX, e.clientY));
  };
  // the aim, with the name it would land on already resolved
  const aimed = useMemo(() => {
    if (!aim) return null;
    const stop = stops[aim.stop];
    if (!stop) return null;
    const when = stop.startDate ? `  ${stop.startDate.slice(0, 7).replace('-', '.')}` : '';
    return { x: aim.x, y: aim.y, label: stop.city + when };
  }, [aim, stops]);

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
      onPointerCancel={() => setAim(null)}
      onPointerLeave={onLeave}
      role="img"
      aria-label="Route overview"
    >
      <World currentStopIdx={currentStopIdx} />
      <circle cx={cx} cy={cy} r={17} className="minimap__ring" />
      <circle cx={cx} cy={cy} r={11} className="minimap__head" />
      {open && aimed && (
        <g className="minimap__aim">
          <circle cx={aimed.x} cy={aimed.y} r={9} />
          <text
            x={aimed.x + (aimed.x > data.w * 0.72 ? -15 : 15)}
            y={aimed.y + 6}
            textAnchor={aimed.x > data.w * 0.72 ? 'end' : 'start'}
          >
            {aimed.label}
          </text>
        </g>
      )}
    </svg>
  );
}
