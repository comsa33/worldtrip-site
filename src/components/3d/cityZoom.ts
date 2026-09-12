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

export const ZOOM_DEFAULTS: ZoomParams = { zMax: 2.2, zMin: 0.8, slope: 0.6, near: 30, hold: 0.25 };

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
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    const before = legsKm[i - 1] ?? Infinity;
    const after = legsKm[i] ?? Infinity;
    raw.push(zoomForKm(Math.min(before, after), p));
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

/** whether a leg makes the camera step back on the way */
export const stepsBack = (restFrom: number, travel: number, restTo: number) =>
  travel < Math.min(restFrom, restTo) - 0.15;

/**
 * The zoom at a point along a leg. A leg that fits the screen runs from the
 * zoom it left at to the one it arrives at across the middle, and for most
 * legs those are the same number and nothing moves. A leg the camera has to
 * step back for is done in three acts, never at once: the camera pulls out
 * over the first part with its eye still on the city left, the move happens
 * at that height, and only then does it come back in on the city ahead.
 */
export function zoomAlong(restFrom: number, travel: number, restTo: number, t: number): number {
  if (stepsBack(restFrom, travel, restTo)) {
    if (t < 0.5) return restFrom + (travel - restFrom) * smoothstep((t - 0.04) / 0.26);
    return travel + (restTo - travel) * smoothstep((t - 0.7) / 0.26);
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
  const k = smoothstep((t - 0.3) / 0.4);
  // slerp between the two unit directions
  const dot = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z));
  const ang = Math.acos(dot);
  if (ang < 1e-4) return [to.x, to.y, to.z];
  const sa = Math.sin(ang);
  const wa = Math.sin((1 - k) * ang) / sa;
  const wb = Math.sin(k * ang) / sa;
  return [from.x * wa + to.x * wb, from.y * wa + to.y * wb, from.z * wa + to.z * wb];
}
