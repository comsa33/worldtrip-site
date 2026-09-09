import { useMemo, useRef } from 'react';
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

/**
 * The whole 314-day line at a glance: a flat monochrome world with the route,
 * past legs in ink, the rest faint, and the current position as the one accent.
 * Click anywhere to jump to the nearest stop.
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

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
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
    onSelect(best);
  };

  return (
    <svg
      ref={svgRef}
      className="minimap"
      viewBox={`0 0 ${data.w} ${data.h}`}
      onClick={onClick}
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
      <circle cx={cx} cy={cy} r={22} className="minimap__ring" />
      <circle cx={cx} cy={cy} r={11} className="minimap__head" />
    </svg>
  );
}
