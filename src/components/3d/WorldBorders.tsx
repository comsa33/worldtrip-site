import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three-stdlib';
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

/**
 * The faint borders are cut into cells of this many degrees, one draw each. A
 * cell off the screen is skipped by a frustum test, and one round the
 * back of the globe by the horizon test below — on a phone the 165,000 segments
 * were processed in full every frame, the far side included, and that was most
 * of what the GPU did. A segment belongs to the one cell its midpoint is in, so
 * nothing is drawn twice and nothing is cut at a cell's edge.
 */
const CELL_DEG = 15;
/** The globe that hides the far side (DotGlobe's sphere). */
const OCCLUDER = 2;

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

/** A delta-encoded line as its vertices in whole units: [x0, y0, x1, y1, …]. */
function vertices(line: number[]): number[] {
  const out = [line[0], line[1]];
  let x = line[0];
  let y = line[1];
  for (let i = 2; i < line.length; i += 2) {
    x += line[i];
    y += line[i + 1];
    out.push(x, y);
  }
  return out;
}

/**
 * Douglas–Peucker: the vertices a line keeps when none of the dropped ones is
 * further than `tol` degrees from what is drawn instead (longitude shrunk by the
 * cosine of the latitude, so a degree is a degree everywhere). The two ends
 * always stay, so lines still meet.
 */
function simplify(v: number[], unit: number, tol: number): number[] {
  const n = v.length / 2;
  if (n < 3) return v;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const t2 = (tol / unit) * (tol / unit);
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const k = Math.cos(((v[a * 2 + 1] + v[b * 2 + 1]) / 2) * unit * (Math.PI / 180));
    const ax = v[a * 2] * k;
    const ay = v[a * 2 + 1];
    const dx = v[b * 2] * k - ax;
    const dy = v[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = v[i * 2] * k - ax;
      const py = v[i * 2 + 1] - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > worst) {
        worst = d2;
        at = i;
      }
    }
    if (worst > t2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(v[i * 2], v[i * 2 + 1]);
  return out;
}

/**
 * Detail by distance. Far away a degree of coast is a few pixels, and the 10m
 * outlines put many segments into each one — every one a quad with round caps,
 * multiplied by MSAA, all landing on the same pixel. So two coarser sets are
 * kept, and a set is used only where nothing it drops is further than
 * MAX_ERR_PX from the line as drawn: the same picture, fewer layers.
 */
const LEVELS_DEG = [0, 0.03, 0.08];
const MAX_ERR_PX = 0.25;

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

  // every boundary segment, sorted into cells by its midpoint
  const cells = useMemo(() => {
    const cellOf = (lat: number, lng: number) =>
      `${Math.floor((lat + 90) / CELL_DEG)}:${Math.floor((lng + 180) / CELL_DEG)}`;
    /** every boundary segment of one level of detail, sorted into cells by its midpoint */
    const build = (tol: number) => {
      const byCell = new Map<string, number[]>();
      const lineSegs = (v: number[], unit: number, seen?: Set<string>) => {
        for (let i = 2; i < v.length; i += 2) {
          const ax = v[i - 2];
          const ay = v[i - 1];
          const bx = v[i];
          const by = v[i + 1];
          // The visited countries carry their own boundary at 10m — including the
          // part they share with a visited neighbour, which therefore arrives
          // twice with the same vertices. Inked twice through a transparent
          // material it would come out a stop brighter than every other border
          // on the map, so a segment already laid down is skipped. The whole
          // units are exact, so they are what is compared.
          if (seen) {
            const key =
              ax < bx || (ax === bx && ay <= by)
                ? `${ax},${ay},${bx},${by}`
                : `${bx},${by},${ax},${ay}`;
            if (seen.has(key)) continue;
            seen.add(key);
          }
          const pa = latLngToVector3(ay * unit, ax * unit, RADIUS);
          const pb = latLngToVector3(by * unit, bx * unit, RADIUS);
          const key = cellOf(((ay + by) / 2) * unit, ((ax + bx) / 2) * unit);
          let list = byCell.get(key);
          if (!list) byCell.set(key, (list = []));
          list.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
        }
      };
      const { unit: bu, lines } = data.borders;
      for (const line of lines) {
        const v = vertices(line);
        lineSegs(tol ? simplify(v, bu, tol) : v, bu);
      }
      const { unit: cu, rings } = data.countries;
      const seen = new Set<string>();
      for (const country of Object.values(rings)) {
        for (const ring of country) {
          const v = vertices(ring);
          lineSegs(tol ? simplify(v, cu, tol) : v, cu, seen);
        }
      }
      return byCell;
    };
    const levels = LEVELS_DEG.map(build);

    // one material for every cell — drawn exactly as the single <Line> it
    // replaces was: same width, colour and blending (set below)
    const material = new LineMaterial();
    /* Transparent things are drawn far to near, by the centre of their
       geometry's bounding sphere — and the order is part of the look: the old
       single line went after the land dots and before the current country's
       outline and every mark. So every cell keeps the sphere of the whole for
       sorting, which puts it exactly where the whole was. That also blinds
       three's own frustum test, so each cell's real sphere is tested here, in
       the frame loop, instead. */
    const all = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const flat of levels[0].values())
      for (let i = 0; i < flat.length; i += 3)
        all.expandByPoint(p.set(flat[i], flat[i + 1], flat[i + 2]));
    const whole = new THREE.Sphere();
    all.getCenter(whole.center);
    let r2 = 0;
    for (const flat of levels[0].values())
      for (let i = 0; i < flat.length; i += 3)
        r2 = Math.max(r2, whole.center.distanceToSquared(p.set(flat[i], flat[i + 1], flat[i + 2])));
    whole.radius = Math.sqrt(r2);
    const list = levels.flatMap((byCell, level) =>
      [...byCell.values()].map((flat) => {
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(flat);
        geometry.computeBoundingSphere();
        const own = (geometry.boundingSphere ?? new THREE.Sphere()).clone();
        geometry.boundingSphere = whole;
        const mesh = new LineSegments2(geometry, material);
        mesh.frustumCulled = false;
        mesh.visible = false;
        const show = (on: boolean) => {
          mesh.visible = on;
        };
        return { mesh, show, sphere: own, level };
      })
    );
    return { material, list };
  }, [data.borders, data.countries]);
  const cellsRef = useRef(cells);
  useEffect(() => {
    cellsRef.current = cells;
    return () => {
      for (const c of cells.list) c.mesh.geometry.dispose();
      cells.material.dispose();
    };
  }, [cells]);

  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const m = cellsRef.current.material;
    m.linewidth = w.borderBase;
    m.transparent = true;
    m.opacity = 1;
    m.depthWrite = false;
    m.resolution.set(size.width, size.height);
  }, [cells, w.borderBase, size.width, size.height]);

  // the step back is eased, not switched — the world settles a shade further
  // away over a few frames, the same pace the note fades in
  const hushed = useRef(0);
  const frustum = useMemo(() => ({ f: new THREE.Frustum(), m: new THREE.Matrix4() }), []);
  useFrame(({ camera }) => {
    const { material, list } = cellsRef.current;
    // drawn on demand: the ease asks for the next frame until it is there
    const left = (hush ? 1 : 0) - hushed.current;
    if (Math.abs(left) > 1e-3) {
      hushed.current += left * 0.12;
      invalidate();
    } else hushed.current = hush ? 1 : 0;
    material.color.copy(loud).lerp(quiet, hushed.current);
    // round the back of the globe: a cell is drawn while any of its bounding
    // sphere can be in front of the horizon — p·c > R² for some p in it, so
    // centre·c + radius·|c| > R². Generous on purpose: a cell at the limb comes
    // in before its first segment does, never after.
    const cam = camera.position;
    const len = cam.length();
    frustum.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.f.setFromProjectionMatrix(frustum.m);
    // how many CSS pixels a degree is where the globe is nearest the camera —
    // the largest it is anywhere on the screen, so the level is safe everywhere
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
    const pxPerDeg =
      ((OCCLUDER * Math.PI) / 180) *
      (size.height / 2 / Math.tan((fov * Math.PI) / 360) / Math.max(1e-3, len - OCCLUDER));
    let level = 0;
    for (let i = LEVELS_DEG.length - 1; i > 0; i--) {
      if (LEVELS_DEG[i] * pxPerDeg <= MAX_ERR_PX) {
        level = i;
        break;
      }
    }
    for (const c of list)
      c.show(
        c.level === level &&
          c.sphere.center.dot(cam) + c.sphere.radius * len > OCCLUDER * OCCLUDER &&
          frustum.f.intersectsSphere(c.sphere)
      );
  });

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
      {cells.list.map((c, i) => (
        <primitive key={i} object={c.mesh} />
      ))}
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
