/**
 * A search's answer while looking around (K3): what the globe says of it,
 * placed from inside the canvas every frame onto a DOM layer outside it.
 *
 * - A stop on the near side: its rank and name as a map label over its ring
 *   (「1 카이로」), the ring itself drawn by ThemeRings. The one previewed has
 *   its label put away: the callout says it instead.
 * - A stop round the back: no turning the globe for it — a short arc on the
 *   limb in its direction, its rank beside it. Several in one direction share
 *   the arc and their ranks are said together (「4 · 5」). Turned to the front,
 *   the arc gives way to the ring in its place (160ms).
 * - The preview (the callout) hangs on the picked ring: under it, or beside
 *   it when there is no room under, kept inside the safe area, with a
 *   hairline to the ring.
 *
 * The globe's centre and limb on the screen are also written to the document
 * (--globe-cx, --globe-cy, --globe-r) for the door that hangs on the limb
 * when the dot is round the back (AskDoor).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SearchRing } from './SearchRanks';

const GLOBE_R = 2;
/** a stop turned this far towards the limb is said on the limb instead */
const FACING = 0.25;
/** half the arc, in radians round the globe's centre on the screen */
const ARC_HALF = 0.09;
/** arcs this close in direction are one arc */
const ARC_JOIN = ARC_HALF * 2;
/** the arc sits this far outside the limb; the rank this far */
const ARC_OUT = 2;
const RANK_OUT = 10;
/** the callout: under the ring by this, or beside it by this */
const CALL_BELOW = 26;
const CALL_BESIDE = 24;
const EDGE = 16;
/** room between two labels, px */
const GAP = 6;

export type RingSpot = { x: number; y: number; r: number };

/** The globe's centre on the screen and its limb's radius, seen from where the camera stands. */
function limbOf(camera: THREE.Camera, w: number, h: number, rect: DOMRect, v: THREE.Vector3) {
  const camDir = camera.position.clone().normalize();
  const dist = camera.position.length();
  v.set(0, 0, 0).project(camera);
  const cx = rect.left + ((v.x + 1) / 2) * w;
  const cy = rect.top + ((1 - v.y) / 2) * h;
  // the limb: where a sight line grazes the sphere, seen from this far
  const sinA = Math.min(1, GLOBE_R / dist);
  const cosA = Math.sqrt(1 - sinA * sinA);
  const side = new THREE.Vector3(0, 1, 0).cross(camDir).normalize();
  if (!side.lengthSq()) side.set(1, 0, 0);
  v.copy(side)
    .multiplyScalar(cosA)
    .addScaledVector(camDir, sinA)
    .multiplyScalar(GLOBE_R)
    .project(camera);
  const rim = Math.hypot(rect.left + ((v.x + 1) / 2) * w - cx, rect.top + ((1 - v.y) / 2) * h - cy);
  return { cx, cy, rim, camDir };
}

/**
 * While looking around, the globe's centre and limb on the screen are written
 * to the document (--globe-cx, --globe-cy, --globe-r) every frame drawn, for
 * the door that hangs on the limb when the dot is round the back (AskDoor).
 */
export function GlobeLimb() {
  const { camera, size, gl } = useThree();
  const v = useRef(new THREE.Vector3());
  useFrame(() => {
    const { cx, cy, rim } = limbOf(
      camera,
      size.width,
      size.height,
      gl.domElement.getBoundingClientRect(),
      v.current
    );
    const doc = document.documentElement.style;
    doc.setProperty('--globe-cx', `${cx.toFixed(1)}px`);
    doc.setProperty('--globe-cy', `${cy.toFixed(1)}px`);
    doc.setProperty('--globe-r', `${rim.toFixed(1)}px`);
  });
  useEffect(
    () => () => {
      const doc = document.documentElement.style;
      doc.removeProperty('--globe-cx');
      doc.removeProperty('--globe-cy');
      doc.removeProperty('--globe-r');
    },
    []
  );
  return null;
}

export function SearchGlobe({
  rings,
  layer,
  spot,
  preview,
  header,
}: {
  rings: SearchRing[];
  /** the DOM layer: for each ring a label, an arc path and a rank; then the callout */
  layer: RefObject<HTMLDivElement | null>;
  /** where a city's ring is drawn (ThemeRings) */
  spot: (city: string) => RingSpot | null;
  /** the city previewed, whose callout hangs on its ring; null for none */
  preview: string | null;
  /** nothing is said under the header */
  header: number;
}) {
  const { camera, size, gl } = useThree();
  const v = useRef(new THREE.Vector3());
  const n = useRef(new THREE.Vector3());

  useFrame(() => {
    const root = layer.current;
    if (!root) return;
    const rect = gl.domElement.getBoundingClientRect();
    const { cx, cy, rim, camDir } = limbOf(camera, size.width, size.height, rect, v.current);

    const labels = root.querySelectorAll<HTMLElement>('.search-globe__label');
    const arcs = root.querySelectorAll<SVGPathElement>('.search-globe__arc');
    const ranks = root.querySelectorAll<HTMLElement>('.search-globe__rank');
    if (labels.length !== rings.length || arcs.length !== rings.length) return;

    /* The callout, placed first, so the labels can keep out of its way */
    const call = root.querySelector<HTMLElement>('.search-callout');
    const taken: { l: number; t: number; r: number; b: number }[] = [];
    let callSpot: RingSpot | null = null;
    if (call) {
      const ring = preview !== null ? rings.find((r) => r.city === preview) : undefined;
      callSpot = ring ? spot(ring.city) : null;
      if (callSpot) {
        const s = callSpot;
        const w = call.offsetWidth;
        const h = call.offsetHeight;
        let x: number;
        let y: number;
        let side: 'below' | 'beside';
        if (s.y + s.r + CALL_BELOW + h < size.height - EDGE) {
          side = 'below';
          x = Math.max(EDGE, Math.min(size.width - EDGE - w, s.x - w / 2));
          y = s.y + s.r + CALL_BELOW;
        } else {
          side = 'beside';
          x =
            s.x + s.r + CALL_BESIDE + w > size.width - EDGE
              ? s.x - s.r - CALL_BESIDE - w
              : s.x + s.r + CALL_BESIDE;
          y = Math.max(header + EDGE, Math.min(size.height - EDGE - h, s.y - h / 2));
        }
        call.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        call.dataset.side = side;
        call.style.setProperty('--lead-x', `${(s.x - x).toFixed(1)}px`);
        call.style.setProperty('--lead-y', `${(s.y - y).toFixed(1)}px`);
        call.style.setProperty('--lead-r', `${s.r.toFixed(1)}px`);
        call.classList.add('is-on');
        taken.push({ l: x - GAP, t: y - GAP, r: x + w + GAP, b: y + h + GAP });
      } else call.classList.remove('is-on');
    }

    /* The labels, the better rank first: one that would lie over another, or
       over the callout, is left unsaid (the map's rule for colliding names) */
    const order = rings.map((_, i) => i).sort((p, q) => rings[p].ranks[0] - rings[q].ranks[0]);
    const back: { i: number; a: number }[] = [];
    const facings = rings.map((r) => n.current.copy(r.position).normalize().dot(camDir));
    for (const i of order) {
      const r = rings[i];
      const facing = facings[i];
      const s = facing >= FACING ? spot(r.city) : null;
      const el = labels[i];
      if (s) {
        const x = s.x;
        const y = s.y - s.r - 4;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        const inner = el.firstElementChild as HTMLElement | null;
        const w = inner?.offsetWidth ?? 0;
        const h = inner?.offsetHeight ?? 0;
        const box = { l: x - w / 2 - GAP, t: y - h - GAP, r: x + w / 2 + GAP, b: y + GAP };
        // the label of the one previewed is put away: the callout says it
        let said = y > header && r.city !== preview;
        if (said)
          for (const o of taken)
            if (box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t) said = false;
        if (said) taken.push(box);
        el.classList.toggle('is-on', said);
      } else el.classList.remove('is-on');
      if (facing < FACING * 0.6) {
        v.current.copy(r.position).project(camera);
        const x = rect.left + ((v.current.x + 1) / 2) * size.width - cx;
        const y = rect.top + ((1 - v.current.y) / 2) * size.height - cy;
        // a point behind the globe projects on the far side of the centre
        back.push({ i, a: Math.atan2(-y, -x) });
      }
    }
    // arcs that share a direction are one, their ranks said together
    back.sort((p, q) => p.a - q.a);
    const used = new Set<number>();
    const groups: { a: number; members: number[] }[] = [];
    for (const b of back) {
      const g = groups.find((x) => Math.abs(x.a - b.a) < ARC_JOIN);
      if (g) {
        g.a = (g.a * g.members.length + b.a) / (g.members.length + 1);
        g.members.push(b.i);
      } else groups.push({ a: b.a, members: [b.i] });
    }
    rings.forEach((_, i) => {
      arcs[i].classList.remove('is-on');
      ranks[i].classList.remove('is-on');
    });
    for (const g of groups) {
      const lead = g.members[0];
      used.add(lead);
      const r = rim + ARC_OUT;
      const a0 = g.a - ARC_HALF;
      const a1 = g.a + ARC_HALF;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const arc = arcs[lead];
      arc.setAttribute(
        'd',
        `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
      );
      arc.classList.add('is-on');
      arc.classList.toggle(
        'is-picked',
        g.members.some((i) => rings[i].city === preview)
      );
      const rk = ranks[lead];
      rk.textContent = g.members
        .flatMap((i) => rings[i].ranks)
        .sort((p, q) => p - q)
        .join(' · ');
      const rr = rim + RANK_OUT;
      rk.style.transform = `translate(${(cx + rr * Math.cos(g.a)).toFixed(1)}px, ${(cy + rr * Math.sin(g.a)).toFixed(1)}px)`;
      rk.classList.add('is-on');
    }
  });

  return null;
}
