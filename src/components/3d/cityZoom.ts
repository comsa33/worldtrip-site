/**
 * How close the camera stands, worked out from the journey itself.
 *
 * A hand-written table once gave every city a zoom. It had 127 entries and
 * almost no relation to the map: a place with a neighbour 13km away and one
 * with the nearest stop 600km off got much the same number, and between them
 * the values wobbled by a third of the screen at nearly every stop — that
 * wobble was the seasickness. Here the zoom comes from distance: a leg of
 * 30km or less is looked at as closely as the camera goes, and every tenfold
 * of distance steps it back by `slope`. A stop rests at the zoom of the
 * shorter of its two legs, so a cluster is looked at closely; on the way the
 * zoom is the leg's own, so a long hop breathes out and back in.
 *
 * Then two things keep it still. The rest values are smoothed along the route
 * (¼ · ½ · ¼ with the neighbours), and a stop only takes a new value when it
 * differs from the last by more than `hold` — otherwise it keeps the one
 * before, so a run of similar legs is one zoom, not a flicker of near ones.
 */
export type ZoomParams = {
  /** the closest the camera comes, at legs of `near` km or shorter */
  zMax: number;
  /** the furthest it steps back, on the longest hops */
  zMin: number;
  /** how much a tenfold of distance pulls the camera back */
  slope: number;
  /** the leg length (km) at which the camera is all the way in */
  near: number;
  /** a change smaller than this is not worth moving the camera for */
  hold: number;
};

export const ZOOM_DEFAULTS: ZoomParams = { zMax: 2.3, zMin: 0.8, slope: 0.6, near: 30, hold: 0.25 };

/** The zoom a leg of `km` is looked at with. */
export function zoomForKm(km: number, p: ZoomParams): number {
  const z = p.zMax - p.slope * Math.log10(Math.max(km, p.near) / p.near);
  return Math.max(p.zMin, Math.min(p.zMax, z));
}

/**
 * The zoom each stop rests at, from the legs on either side of it. `legsKm[i]`
 * is the leg from stop i to stop i+1.
 */
export function restZooms(legsKm: number[], p: ZoomParams): number[] {
  const n = legsKm.length + 1;
  // a stop is looked at as closely as its shorter leg allows — the whole leg
  // in view, and no further back than that
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    const before = legsKm[i - 1] ?? Infinity;
    const after = legsKm[i] ?? Infinity;
    raw.push(fitZoom(Math.min(before, after), p));
  }
  const smooth = raw.map((z, i) => 0.25 * (raw[i - 1] ?? z) + 0.5 * z + 0.25 * (raw[i + 1] ?? z));
  const held: number[] = [];
  let cur = smooth[0] ?? p.zMax;
  for (const z of smooth) {
    if (Math.abs(z - cur) >= p.hold) cur = z;
    held.push(cur);
  }
  return held;
}

/**
 * How far the camera stands, and how much of the globe that shows. The
 * camera sits at 5.5 − 1.5·zoom from the centre of a sphere of radius 2
 * (6,371 km) with a 45° lens, so the height of the view at the surface is
 * about 0.828·(d − 2) units.
 */
const KM_PER_UNIT = 6371 / 2;
const VIEW = 2 * Math.tan((45 / 2) * (Math.PI / 180));
/** how much of the view a leg may take before the camera has to step back */
const FIT = 0.8;

/**
 * The closest zoom at which a leg of `km` still fits on screen. On the way
 * the camera is never closer than this — and never further than it rests at
 * either end, so a leg that already fits is travelled without the camera
 * moving at all. That was the seasickness: every leg drew the camera out and
 * back, whether or not there was anything to show by it.
 */
export function fitZoom(km: number, p: ZoomParams): number {
  const need = km / (FIT * VIEW * KM_PER_UNIT); // (d − 2) that shows the leg
  const z = (5.5 - 2 - need) / 1.5;
  return Math.max(p.zMin, Math.min(p.zMax, z));
}

/**
 * How much ground the screen shows at a zoom, in km. The height comes from the
 * same figures `fitZoom` works back from; the width is the window's shape.
 *
 * It is a smaller number than it sounds. The camera rests at `zMax` almost
 * everywhere — a stay is fitted to its own stops and inside a country those sit
 * close together — and at 2.25 that is 528 × 330km on a 1440 × 900 screen,
 * 152 × 330km on a phone. Every country the journey entered is bigger than
 * that except Belgium, which is what the corner inset exists for.
 */
export function viewKm(zoom: number, aspect: number): { w: number; h: number } {
  const h = (5.5 - 1.5 * zoom - 2) * VIEW * KM_PER_UNIT;
  return { w: h * aspect, h };
}

/** a country whose visited ground spans more than this is looked at in parts */
const BIG_COUNTRY_KM = 1000;

/**
 * The zoom each stop rests at, by the run of stops in one country. A stay in
 * a country is one view — the zoom that fits everywhere the journey went
 * there — so nothing moves between its cities. A country too big for one
 * view (India, Chile) is looked at in parts, by the cluster rule above. The
 * sequence keeps a value until the next differs by more than `hold`.
 */
export function restZoomsByCountry(
  stops: { lat: number; lng: number; country: string }[],
  legsKm: number[],
  p: ZoomParams
): number[] {
  const clustered = restZooms(legsKm, p);
  const out: number[] = new Array(stops.length).fill(p.zMax);
  let i = 0;
  while (i < stops.length) {
    let j = i;
    while (j + 1 < stops.length && stops[j + 1].country === stops[i].country) j++;
    const run = stops.slice(i, j + 1);
    const lats = run.map((s) => s.lat);
    const lngs = run.map((s) => s.lng);
    const midLat = ((Math.max(...lats) + Math.min(...lats)) / 2) * (Math.PI / 180);
    const spanKm = Math.hypot(
      (Math.max(...lngs) - Math.min(...lngs)) * 111 * Math.cos(midLat),
      (Math.max(...lats) - Math.min(...lats)) * 111
    );
    for (let k = i; k <= j; k++)
      out[k] = spanKm > BIG_COUNTRY_KM ? clustered[k] : fitZoom(spanKm, p);
    i = j + 1;
  }
  const held: number[] = [];
  let cur = out[0] ?? p.zMax;
  for (const z of out) {
    if (Math.abs(z - cur) >= p.hold) cur = z;
    held.push(cur);
  }
  return held;
}

const smoothstep = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** the least a staged leg pulls out, so the move reads as a move */
const STAGE_OUT = 0.35;
/** a border crossed on foot or by a short bus is not a journey between countries */
const BORDER_STAGE_KM = 150;

/**
 * How a leg is travelled. A leg that crosses a border, or one the camera
 * would have to step back for anyway, is staged — out, across, in — and
 * pulls out by at least `STAGE_OUT` so the hop can be seen as a hop. Any
 * other leg is a plain move at the height it rests at.
 */
export function legProfile(
  restFrom: number,
  restTo: number,
  legKm: number,
  crosses: boolean,
  p: ZoomParams
): { travel: number; staged: boolean } {
  const near = Math.min(restFrom, restTo);
  const fit = Math.min(near, fitZoom(legKm, p));
  if ((crosses && legKm >= BORDER_STAGE_KM) || fit < near - 0.15) {
    return { travel: Math.max(p.zMin, Math.min(fit, near - STAGE_OUT)), staged: true };
  }
  return { travel: near, staged: false };
}

/**
 * The zoom at a point along a leg. A plain leg runs from the zoom it left at
 * to the one it arrives at across the middle — for most legs the same number,
 * and nothing moves. A staged leg is three acts, never at once: the camera
 * pulls out quickly over the first part with its eye still on the city left,
 * the move happens at that height, and then it comes back in on the city
 * ahead — slowly, over the last third and a bit, which is what keeps the
 * arrival from swimming.
 */
export function zoomAlong(
  restFrom: number,
  travel: number,
  restTo: number,
  t: number,
  staged: boolean
): number {
  if (staged) {
    if (t < 0.45) return restFrom + (travel - restFrom) * smoothstep((t - 0.03) / 0.22);
    return travel + (restTo - travel) * smoothstep((t - 0.58) / 0.4);
  }
  return restFrom + (restTo - restFrom) * smoothstep((t - 0.3) / 0.4);
}

/**
 * Where the camera looks along a leg: at the dot, unless the leg is one the
 * camera steps back for — then it stays on the city left while it pulls out,
 * turns to the city ahead across the middle, and is already there when it
 * comes back in. `t` is the share of the leg; the result is a unit direction.
 */
export function lookAlong(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  t: number
): [number, number, number] {
  const k = smoothstep((t - 0.25) / 0.36);
  // slerp between the two unit directions
  const dot = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z));
  const ang = Math.acos(dot);
  if (ang < 1e-4) return [to.x, to.y, to.z];
  const sa = Math.sin(ang);
  const wa = Math.sin((1 - k) * ang) / sa;
  const wb = Math.sin(k * ang) / sa;
  return [from.x * wa + to.x * wb, from.y * wa + to.y * wb, from.z * wa + to.z * wb];
}
