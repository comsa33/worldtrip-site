import { useMemo } from 'react';
import * as THREE from 'three';
import cityBounds from '../../data/cityBounds.json';
import { OUTLINE_SKIP, PLACE_GLYPH } from './placeGlyphs';

/**
 * The cities' outlines as geometry on the globe, and the rule for when a ring
 * hands over to one. The drawing is in CityBounds.tsx.
 */

const RADIUS = 2.003;
const LIFT = 0.0006;
/** the outline's on-screen diameter where the handoff begins and ends, px */
const HANDOFF_FROM = 10;
const HANDOFF_TO = 24;

type Bounds = Record<
  string,
  { name: string; type: string; km: number; rings: [number, number][][] }
>;
const data = cityBounds as unknown as Bounds;

function toSphere(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

export type Outline = {
  city: string;
  /** the ground the city covers, as triangles — one mesh per city */
  fill: Float32Array;
  center: THREE.Vector3;
  /** how far the outline reaches from the city's point, in world units */
  reach: number;
};

/**
 * A ring cut into triangles.
 *
 * The cutting is done in degrees, before the points are put on the globe: a
 * city is at most 126km across and over that much ground the sphere is flat
 * enough that a triangulation made on the map holds when the corners are lifted
 * onto it. Doing it in three dimensions would be the same answer and a great
 * deal more arithmetic.
 */
function triangles(ring: [number, number][], radius: number): number[] {
  const flat = ring.map(([lng, lat]) => new THREE.Vector2(lng, lat));
  const out: number[] = [];
  for (const face of THREE.ShapeUtils.triangulateShape(flat, [])) {
    for (const i of face) {
      const v = toSphere(ring[i][1], ring[i][0], radius);
      out.push(v.x, v.y, v.z);
    }
  }
  return out;
}

/** Which cities have an outline, and how far each reaches — for the rings' handoff. */
export function useOutlines(
  cities: Record<string, { lat: number; lng: number }>
): Map<string, Outline> {
  return useMemo(() => {
    const out = new Map<string, Outline>();
    for (const [city, b] of Object.entries(data)) {
      const c = cities[city];
      // a lake, a pass, a border post: a shape says the wrong thing there
      if (!c || PLACE_GLYPH[city] || OUTLINE_SKIP.has(city)) continue;
      const center = toSphere(c.lat, c.lng, RADIUS + LIFT);
      const fill: number[] = [];
      let reach = 0;
      for (const ring of b.rings) {
        if (ring.length < 3) continue;
        fill.push(...triangles(ring, RADIUS + LIFT));
        for (const [lng, lat] of ring) {
          reach = Math.max(reach, toSphere(lat, lng, RADIUS + LIFT).distanceTo(center));
        }
      }
      if (!fill.length) continue;
      out.set(city, { city, fill: new Float32Array(fill), center, reach });
    }
    return out;
  }, [cities]);
}

/** 0 = all ring, 1 = all outline, for an outline this wide on screen. */
export function handoff(px: number): number {
  const t = Math.max(0, Math.min(1, (px - HANDOFF_FROM) / (HANDOFF_TO - HANDOFF_FROM)));
  return t * t * (3 - 2 * t);
}
