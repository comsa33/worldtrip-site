import worldBorders from '../../data/worldBorders.json';

/**
 * One country, drawn flat in a 1000×1000 box — the shape the corner inset needs.
 *
 * The globe already carries these outlines at Natural Earth 10m (see
 * WorldBorders.tsx), so the inset is not a second drawing of the world: it is
 * the same vertices, projected to a square instead of a sphere.
 */

const BOX = 1000;
const PAD = 40;
/** below this, a ring is smaller than a pixel at any size the inset is drawn */
const SPECK = 3;
/** a vertex closer than this to the last one cannot be told from it */
const STEP = 1.2;

/**
 * How far an outlying piece of a country may sit from the rest and still be
 * drawn with it.
 *
 * A country is the ground the journey could cross. Peninsular Malaysia and
 * Borneo are 555km apart and the trip went between them; French Guiana is 7,000
 * km from France and belongs to another map. Between those two facts there is
 * one number, and it has to clear Malaysia and stop the Canaries (822km): at
 * 650km France loses Guiana, Spain the Canaries, Portugal the Azores and
 * Madeira, Ecuador the Galápagos, Japan the Ogasawara islands — and Indonesia,
 * 5,097km of it, stays whole, because its islands are a chain with no gap this
 * wide anywhere along it.
 */
const NEAR_KM = 650;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface CountryShape {
  /** the land as one SVG path, in a 0 0 1000 1000 box */
  d: string;
  /** a place on the globe, in that same box */
  project: (lat: number, lng: number) => [number, number];
  /** how far the country reaches from a point, in km, each way */
  reach: (lat: number, lng: number) => { w: number; h: number };
  /** how many box units a kilometre of ground is, at a latitude */
  scale: (lat: number) => { x: number; y: number };
}

const unit = (worldBorders as { countries: { unit: number } }).countries.unit;
const rings = (worldBorders as { countries: { rings: Record<string, number[][]> } }).countries
  .rings;

/** the delta-encoded line back to degrees — the format WorldBorders.tsx documents */
function decode(line: number[]): number[][] {
  let x = line[0];
  let y = line[1];
  const out: number[][] = [[x * unit, y * unit]];
  for (let i = 2; i < line.length; i += 2) {
    x += line[i];
    y += line[i + 1];
    out.push([x * unit, y * unit]);
  }
  return out;
}

const bounds = (pts: number[][]): Box => {
  let b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const p of pts) {
    if (p[0] < b.x0) b = { ...b, x0: p[0] };
    if (p[0] > b.x1) b = { ...b, x1: p[0] };
    if (p[1] < b.y0) b = { ...b, y0: p[1] };
    if (p[1] > b.y1) b = { ...b, y1: p[1] };
  }
  return b;
};

const merge = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  x1: Math.max(a.x1, b.x1),
  y0: Math.min(a.y0, b.y0),
  y1: Math.max(a.y1, b.y1),
});

/** the shortest distance between two boxes, in km */
function gapKm(a: Box, b: Box): number {
  const dLng = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dLat = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  const cos = Math.cos((((a.y0 + a.y1 + b.y0 + b.y1) / 4) * Math.PI) / 180);
  return Math.hypot(dLng * 111 * cos, dLat * 111);
}

/**
 * The rings that hang together: start from the largest and keep taking in
 * whatever comes within `NEAR_KM` of anything already taken, until nothing does.
 * Single linkage, so a chain of islands survives and a lone territory does not.
 */
function mainland(all: { pts: number[][]; box: Box }[]): { pts: number[][]; box: Box }[] {
  const pool = [...all].sort((a, b) => b.pts.length - a.pts.length);
  const keep = pool.splice(0, 1);
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (keep.some((k) => gapKm(k.box, pool[i].box) <= NEAR_KM)) {
        keep.push(...pool.splice(i, 1));
        grew = true;
      }
    }
  }
  return keep;
}

const cache = new Map<string, CountryShape | null>();

/** The shape for one ISO code, built once and kept — a country does not change. */
export function countryShape(code: string | null | undefined): CountryShape | null {
  if (!code) return null;
  const hit = cache.get(code);
  if (hit !== undefined) return hit;

  const raw = rings[code];
  if (!raw) {
    cache.set(code, null);
    return null;
  }

  const parts = mainland(
    raw.map((line) => {
      const pts = decode(line);
      return { pts, box: bounds(pts) };
    })
  );
  const box = parts.map((p) => p.box).reduce(merge);
  const cos = Math.cos((((box.y0 + box.y1) / 2) * Math.PI) / 180);
  const k = Math.min(
    (BOX - PAD * 2) / Math.max(1e-6, (box.x1 - box.x0) * cos),
    (BOX - PAD * 2) / Math.max(1e-6, box.y1 - box.y0)
  );
  const ox = (BOX - (box.x1 - box.x0) * cos * k) / 2;
  const oy = (BOX - (box.y1 - box.y0) * k) / 2;
  const project = (lat: number, lng: number): [number, number] => [
    ox + (lng - box.x0) * cos * k,
    oy + (box.y1 - lat) * k,
  ];

  // Every vertex the inset can actually show, and no more: at its widest the map
  // is 420px, so 1.2 box units is half a pixel there and nothing below it can be
  // drawn. Brazil goes from 11,000 points to a path the browser lays out once.
  const subs: string[] = [];
  for (const part of parts) {
    const px = part.pts.map((p) => project(p[1], p[0]));
    const w = Math.max(...px.map((p) => p[0])) - Math.min(...px.map((p) => p[0]));
    const h = Math.max(...px.map((p) => p[1])) - Math.min(...px.map((p) => p[1]));
    if (w < SPECK && h < SPECK) continue;
    const keep = [px[0]];
    for (let i = 1; i < px.length; i++) {
      const q = keep[keep.length - 1];
      if (Math.hypot(px[i][0] - q[0], px[i][1] - q[1]) >= STEP || i === px.length - 1) {
        keep.push(px[i]);
      }
    }
    if (keep.length < 4) continue;
    subs.push('M' + keep.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L') + 'Z');
  }

  const shape: CountryShape = {
    d: subs.join(''),
    project,
    reach: (lat, lng) => ({
      w: Math.max(lng - box.x0, box.x1 - lng) * 111 * Math.cos((lat * Math.PI) / 180),
      h: Math.max(lat - box.y0, box.y1 - lat) * 111,
    }),
    // east-west, a kilometre is more degrees the further from the equator, and
    // the box squeezes longitude by the country's middle — both belong here
    scale: (lat) => ({
      x: (cos * k) / (111 * Math.cos((lat * Math.PI) / 180)),
      y: k / 111,
    }),
  };
  cache.set(code, shape);
  return shape;
}

export const INSET_BOX = BOX;
