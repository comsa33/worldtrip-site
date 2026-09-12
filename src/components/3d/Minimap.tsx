import { useEffect, useMemo, useRef, useState } from 'react';
import minimap from '../../data/minimap.json';

interface MinimapData {
  w: number;
  h: number;
  scale: number;
  translate: [number, number];
  land: string; // pre-projected land silhouette (SVG path)
  legs: string[]; // pre-projected route, one path per leg (stop i -> stop i+1)
}

interface MinimapStop {
  id: number;
  city: string;
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

function project(lat: number, lng: number): [number, number] {
  const [x, y] = naturalEarth1(lng * RAD, lat * RAD);
  return [data.translate[0] + data.scale * x, data.translate[1] - data.scale * y];
}

/** A mouse crossing the corner on its way elsewhere should not open it. */
const OPEN_DELAY_MS = 140;

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

  const [open, setOpen] = useState(false);
  const openTimer = useRef(0);
  const byTouch = useRef(false);

  // an opened map closes again on the next press elsewhere, like any other sheet
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!svgRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, { passive: true });
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  useEffect(() => () => window.clearTimeout(openTimer.current), []);

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
  const onLeave = () => {
    window.clearTimeout(openTimer.current);
    setOpen(false);
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // shut, it is a picture of the journey and nothing more
    if (!open) {
      window.clearTimeout(openTimer.current);
      setOpen(true);
      return;
    }
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = ((e.clientX - r.left) / r.width) * data.w;
    const y = ((e.clientY - r.top) / r.height) * data.h;
    let best = 0;
    let bestD = Infinity;
    stopPoints.forEach(([px, py], i) => {
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    // a finger is done with it; a mouse is still resting on it and may pick again
    if (byTouch.current) setOpen(false);
    onSelect(best);
  };

  return (
    <svg
      ref={svgRef}
      className={`minimap${open ? ' is-open' : ''}`}
      viewBox={`0 0 ${data.w} ${data.h}`}
      onClick={onClick}
      onPointerDown={onDown}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      role="img"
      aria-label="Route overview"
    >
      <path d={data.land} className="minimap__land" />
      {data.legs.map((d, i) => (
        <path
          key={i}
          d={d}
          className={`minimap__leg${i + 1 <= currentStopIdx ? ' is-past' : ''}`}
        />
      ))}
      <circle cx={cx} cy={cy} r={17} className="minimap__ring" />
      <circle cx={cx} cy={cy} r={11} className="minimap__head" />
    </svg>
  );
}
