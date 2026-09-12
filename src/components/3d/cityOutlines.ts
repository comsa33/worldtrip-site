import { useMemo } from 'react';
import * as THREE from 'three';
import cityBounds from '../../data/cityBounds.json';
import { PLACE_GLYPH } from './placeGlyphs';

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
  /** every ring, as segment pairs, for one Line in `segments` mode */
  pairs: [number, number, number][];
  center: THREE.Vector3;
  /** how far the outline reaches from the city's point, in world units */
  reach: number;
};

/** Which cities have an outline, and how far each reaches — for the rings' handoff. */
export function useOutlines(
  cities: Record<string, { lat: number; lng: number }>
): Map<string, Outline> {
  return useMemo(() => {
    const out = new Map<string, Outline>();
    for (const [city, b] of Object.entries(data)) {
      const c = cities[city];
      // a lake, a pass, a border post: a shape says the wrong thing there
      if (!c || PLACE_GLYPH[city]) continue;
      const center = toSphere(c.lat, c.lng, RADIUS + LIFT);
      const pairs: [number, number, number][] = [];
      let reach = 0;
      for (const ring of b.rings) {
        const pts = ring.map(([lng, lat]) => toSphere(lat, lng, RADIUS + LIFT));
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const z = pts[(i + 1) % pts.length];
          pairs.push([a.x, a.y, a.z], [z.x, z.y, z.z]);
          reach = Math.max(reach, a.distanceTo(center));
        }
      }
      out.set(city, { city, pairs, center, reach });
    }
    return out;
  }, [cities]);
}

/** 0 = all ring, 1 = all outline, for an outline this wide on screen. */
export function handoff(px: number): number {
  const t = Math.max(0, Math.min(1, (px - HANDOFF_FROM) / (HANDOFF_TO - HANDOFF_FROM)));
  return t * t * (3 - 2 * t);
}
