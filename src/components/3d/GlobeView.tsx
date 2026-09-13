/** The door and the names for looking around the globe — see useGlobeView.ts. */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GlobeLabel } from './useGlobeView';

// ---- the door ------------------------------------------------------------------

/**
 * The header's switches show where they would take you — EN while reading
 * Korean, the filled mark while the page is dark. This one does the same: the
 * globe while on the journey, and the journey (the dot trailing its ribbon)
 * while looking at the globe.
 */
export function GlobeViewToggle({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`globe-toggle${on ? ' is-on' : ''}`}
      onClick={onToggle}
      aria-label={label}
      aria-pressed={on}
      title={label}
    >
      {on ? (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M1.5 8.6 L9.5 7.4 L9.5 8.6 Z" fill="currentColor" />
          <path d="M1.5 8 L9.5 8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
          <circle cx="11.6" cy="8" r="2.6" fill="currentColor" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.25" />
          <ellipse
            className="globe-toggle__meridian"
            cx="8"
            cy="8"
            rx="2.6"
            ry="6"
            stroke="currentColor"
            strokeWidth="1.25"
          />
        </svg>
      )}
    </button>
  );
}

// ---- names -----------------------------------------------------------------------

/** Pulled in past this share of the whole-globe distance, names start to claim room. */
const NAMES_FROM = 0.72;
/** Room between two names, px. */
const GAP = 6;
/** Names turned this far towards the limb are left unsaid. */
const FACING = 0.25;

/**
 * Puts the names where they belong each frame and says only those with room.
 * The DOM is the labels layer's (rendered outside the canvas); this only moves
 * it. A name already said keeps its room before any other claims it — without
 * that, turning the globe a pixel swaps two neighbours back and forth.
 */
export function GlobeLabelDriver({
  labels,
  layer,
  fit,
  header,
}: {
  labels: GlobeLabel[];
  layer: React.RefObject<HTMLDivElement | null>;
  fit: number;
  /** the header's height — nothing is said underneath it */
  header: number;
}) {
  const { camera, size, gl } = useThree();
  const shown = useRef<boolean[]>([]);
  const dims = useRef<{ w: number; h: number }[]>([]);
  const v = useRef(new THREE.Vector3());
  const n = useRef(new THREE.Vector3());

  useEffect(() => {
    shown.current = labels.map(() => false);
    dims.current = [];
    for (const el of Array.from(layer.current?.children ?? [])) el.classList.remove('is-on');
  }, [labels, layer]);

  useFrame(() => {
    const root = layer.current;
    if (!root) return;
    const els = root.children as HTMLCollectionOf<HTMLElement>;
    if (els.length !== labels.length) return;
    if (dims.current.length !== labels.length) {
      dims.current = labels.map((_, i) => {
        const inner = els[i].firstElementChild as HTMLElement | null;
        return { w: inner?.offsetWidth ?? 0, h: inner?.offsetHeight ?? 0 };
      });
    }

    const rect = gl.domElement.getBoundingClientRect();
    const camDir = camera.position.clone().normalize();
    const near = camera.position.length() < fit * NAMES_FROM;
    const taken: { l: number; t: number; r: number; b: number }[] = [];
    const next = labels.map(() => false);

    const claim = (i: number) => {
      const lb = labels[i];
      if (n.current.copy(lb.position).normalize().dot(camDir) < FACING) return;
      v.current.copy(lb.position).project(camera);
      const x = rect.left + ((v.current.x + 1) / 2) * size.width;
      const y = rect.top + ((1 - v.current.y) / 2) * size.height;
      els[i].style.setProperty('transform', `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`);
      const { w, h } = dims.current[i];
      // the name sits above its city (.city-label lifts it 17px)
      const box = { l: x - w / 2 - GAP, r: x + w / 2 + GAP, t: y - 17 - h - GAP, b: y - 17 + GAP };
      if (box.t < header || box.l < 0 || box.r > size.width || box.b > size.height) return;
      for (const o of taken) {
        if (box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t) return;
      }
      taken.push(box);
      next[i] = true;
    };

    if (near) {
      // labels arrive sorted by rank; those already said go first
      for (let i = 0; i < labels.length; i++) if (shown.current[i]) claim(i);
      for (let i = 0; i < labels.length; i++) if (!shown.current[i]) claim(i);
    }

    for (let i = 0; i < labels.length; i++) {
      if (next[i] !== shown.current[i]) els[i].classList.toggle('is-on', next[i]);
    }
    shown.current = next;
  });

  return null;
}
