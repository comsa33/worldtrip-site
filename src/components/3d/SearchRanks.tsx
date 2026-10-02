/**
 * The ranks beside the rings a search lit (C3): a small mono number at each
 * ring's right, "1·4" where the same city answered twice. Placed from inside
 * the canvas every frame it draws, on a DOM layer outside it — the way the
 * names are placed while looking around — and only in the journey's own
 * view, where the rings have their near size.
 */
import { useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThemeRing } from './ThemeRings';
import { RING_NEAR } from './themeRingScale';

export type SearchRing = ThemeRing & { ranks: number[] };

/** a ring round the back of the world has no number */
const FACING = 0.25;
/** from the ring's edge to the number */
const GAP = 4;

export function SearchRanks({
  rings,
  layer,
  phone,
}: {
  rings: SearchRing[];
  layer: RefObject<HTMLDivElement | null>;
  phone: boolean;
}) {
  const { camera, size, gl } = useThree();
  const v = useRef(new THREE.Vector3());
  const n = useRef(new THREE.Vector3());

  useFrame(() => {
    const root = layer.current;
    if (!root) return;
    const els = root.children as HTMLCollectionOf<HTMLElement>;
    if (els.length !== rings.length) return;
    const rect = gl.domElement.getBoundingClientRect();
    const camDir = camera.position.clone().normalize();
    const { k, min } = RING_NEAR[phone ? 'phone' : 'desk'];
    rings.forEach((r, i) => {
      const facing = n.current.copy(r.position).normalize().dot(camDir) > FACING;
      els[i].classList.toggle('is-on', facing);
      if (!facing) return;
      v.current.copy(r.position).project(camera);
      const x = rect.left + ((v.current.x + 1) / 2) * size.width;
      const y = rect.top + ((1 - v.current.y) / 2) * size.height;
      const radius = k * Math.sqrt(r.n) + min + (r.twice ? 2 : 0);
      els[i].style.transform = `translate(${(x + radius + GAP).toFixed(1)}px, ${y.toFixed(1)}px)`;
    });
  });

  return null;
}
