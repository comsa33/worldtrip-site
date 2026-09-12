import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Line2 } from 'three-stdlib';
import worldBorders from '../../data/worldBorders.json';
import { GLOBE, type Theme } from '../../theme';
import { TUNE_ON, defaults, mix, useTuning } from './routeTuning';

const RADIUS = 2.003;
/**
 * How far the current country's outline sits above the rest, so the two do not
 * fight for the same depth. It has to be enough to win the depth test and no
 * more: at 0.002 the parallax was a visible gap at close zoom and the one
 * border read as two lines side by side.
 */
const LIFT = 0.0004;

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

/**
 * A line is its first point followed by the step to each next one, in whole
 * units of `unit` degrees: `[-48613, -27614, 3, -13, …]`. Written out as pairs
 * of decimals the 10m outlines were 390KB of gzip on top of a bundle that was
 * already too big; as small repeating steps they are less than the 50m ones they
 * replaced, carrying nine times the vertices. `run` walks one back.
 */
interface Encoded {
  unit: number;
}
interface BorderData {
  /** every boundary with no visited country on either side, at 50m */
  borders: Encoded & { lines: number[][] };
  /** the visited countries, at 10m, as closed rings */
  countries: Encoded & { rings: Record<string, number[][]> };
}

/** Walks a delta-encoded line, handing each segment over in whole units. */
function run(line: number[], onSegment: (ax: number, ay: number, bx: number, by: number) => void) {
  let x = line[0];
  let y = line[1];
  for (let i = 2; i < line.length; i += 2) {
    const nx = x + line[i];
    const ny = y + line[i + 1];
    onSegment(x, y, nx, ny);
    x = nx;
    y = ny;
  }
}

/**
 * Country outlines from src/data/worldBorders.json, built by scripts/build-geo.mjs:
 * the countries we never entered at Natural Earth 50m, the 31 we did at 10m,
 * because those are the only ones the camera ever gets close enough to catch out.
 * Every boundary is drawn faintly; the current country is drawn again at full ink
 * and heavier still, over exactly the same vertices, so the two cannot disagree.
 *
 * Both are drawn as fat lines rather than as raw `lineSegments`, because WebGL
 * ignores a line material's width — everything came out one device pixel however
 * thin the screen's pixels were, which is a hairline on a laptop and a thread on
 * anything retina. ~165,000 boundary segments is one instanced draw, which the GPU
 * does not notice; the cost is the geometry built once at mount.
 */
/** How far the borders step back while a city is speaking. */
const HUSH = 0.38;

export function WorldBorders({
  countryCode,
  theme,
  hush = false,
}: {
  countryCode?: string | null;
  theme: Theme;
  /** a note is up over the map: the lines under it go quieter */
  hush?: boolean;
}) {
  const data = worldBorders as BorderData;
  const INK = GLOBE[theme].ink;
  const tuned = useTuning();
  const w = TUNE_ON ? tuned : defaults(theme);
  const baseOpacity = theme === 'light' ? 0.55 : 0.42;

  /**
   * A fat line is a run of quads, one per segment, each with a round cap at both
   * ends — so a faint line laid over a coast whose vertices are closer together
   * than a pixel blends with itself, once per overlap, and comes out darker than
   * the same colour asked for. At 50m that cost a shade. At 10m the vertices are
   * nine times closer and Japan turned black beside a grey Russia: the base layer
   * had started saying "visited", which is the one thing only the current
   * country's outline may say.
   *
   * So the transparency is done in advance instead. The colour is what 42% ink
   * over the globe actually lands on, drawn at full alpha, and no overlap can add
   * to it — the line weighs the same at every zoom and on every coastline.
   */
  const [loud, quiet] = useMemo(() => {
    const over = GLOBE[theme].sphere;
    return [
      new THREE.Color(mix(INK, baseOpacity, over)),
      new THREE.Color(mix(INK, baseOpacity * HUSH, over)),
    ];
  }, [INK, baseOpacity, theme]);

  // the step back is eased, not switched — the world settles a shade further
  // away over a few frames, the same pace the note fades in
  const base = useRef<Line2>(null);
  const hushed = useRef(0);
  useFrame(() => {
    const m = base.current?.material;
    if (!m) return;
    hushed.current += ((hush ? 1 : 0) - hushed.current) * 0.12;
    m.color.copy(loud).lerp(quiet, hushed.current);
  });

  // pairs of points: every boundary segment, laid end to end for `segments`
  const borderPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    const seg = (ax: number, ay: number, bx: number, by: number, unit: number, radius: number) => {
      const a = latLngToVector3(ay * unit, ax * unit, radius);
      const b = latLngToVector3(by * unit, bx * unit, radius);
      pts.push([a.x, a.y, a.z], [b.x, b.y, b.z]);
    };
    const { unit: bu, lines } = data.borders;
    for (const line of lines) run(line, (ax, ay, bx, by) => seg(ax, ay, bx, by, bu, RADIUS));
    // The visited countries carry their own boundary at 10m — including the part
    // they share with a visited neighbour, which therefore arrives twice with the
    // same vertices. Inked twice through a transparent material it would come out
    // a stop brighter than every other border on the map, so a segment already
    // laid down is skipped. The whole units are exact, so they are what is
    // compared.
    const { unit: cu, rings } = data.countries;
    const seen = new Set<string>();
    for (const country of Object.values(rings)) {
      for (const ring of country) {
        run(ring, (ax, ay, bx, by) => {
          const key =
            ax < bx || (ax === bx && ay <= by)
              ? `${ax},${ay},${bx},${by}`
              : `${bx},${by},${ax},${ay}`;
          if (seen.has(key)) return;
          seen.add(key);
          seg(ax, ay, bx, by, cu, RADIUS);
        });
      }
    }
    return pts;
  }, [data.borders, data.countries]);

  // one draw for the whole country: Indonesia is 264 rings and Chile 163, and a
  // `<Line>` apiece was that many materials built on the frame you arrive
  const highlight = useMemo(() => {
    const { unit, rings } = data.countries;
    const country = countryCode ? rings[countryCode] : undefined;
    if (!country) return null;
    const pts: [number, number, number][] = [];
    for (const ring of country) {
      run(ring, (ax, ay, bx, by) => {
        const a = latLngToVector3(ay * unit, ax * unit, RADIUS + LIFT);
        const b = latLngToVector3(by * unit, bx * unit, RADIUS + LIFT);
        pts.push([a.x, a.y, a.z], [b.x, b.y, b.z]);
      });
    }
    return pts.length ? pts : null;
  }, [data.countries, countryCode]);

  return (
    <group>
      {/* Every border, legible on its own: the map has to read as a map before
          the current country reads as the current one. Hairlines lose a lot of
          ink on a light ground, so light mode gets more. */}
      <Line
        ref={base}
        points={borderPoints}
        segments
        color={loud}
        lineWidth={w.borderBase}
        transparent
        opacity={1}
        depthWrite={false}
      />
      {highlight && (
        <Line
          points={highlight}
          segments
          color={mix(INK, 0.9, GLOBE[theme].sphere)}
          lineWidth={w.borderActive}
          transparent
          opacity={1}
          depthWrite={false}
        />
      )}
    </group>
  );
}
