/**
 * The cities a chosen theme lights (B1, B2): an ink ring each, sized by how
 * many of its photos are of the theme — the map's proportional symbol, radius
 * ∝ √n so the area is the count. Never filled and never the accent: the one
 * filled mark on the globe is the dot that says where the journey is.
 *
 * A city passed through twice is one ring with the two stays added up; when
 * both stays have the theme, a thin ring goes round it once more (the ×2 of
 * the label, said as a mark).
 *
 * Looking around (B2) the globe stands far back and a hundred rings would
 * knot together over Europe. There, rings that touch on the screen are one
 * ring — the size of their photos added up, standing at their centre of
 * weight, with the same thin ring round it: more than one, said as a mark.
 * Which rings touch is a matter of how far the camera stands, not of which
 * way the globe is turned, so it is decided again only when that distance has
 * changed by a step. Coming together, the rings travel to the centre and take
 * its size on the way; pulled apart, they leave from it. Each ring eases from
 * wherever it is, so a zoom that turns round halfway is picked up from there.
 *
 * Looking around, the marks are smaller, and grow more slowly than the map
 * does as the hand pulls in — a mark that kept pace with the map would touch
 * its neighbours at every distance, and nothing would ever come apart. Back
 * on the journey they ease to the journey's own size.
 *
 * One draw call: every ring is a point, drawn in screen pixels by its own
 * shader; behind the globe's limb it is not drawn at all. The buffers are
 * written while rings are on the move and not otherwise.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ringPress } from './useGlobeView';

export interface ThemeRing {
  city: string;
  position: THREE.Vector3;
  /** photos of the theme, all stays added */
  n: number;
  /** more than one stay had the theme */
  twice: boolean;
}

/** radius in px = k·√n + min, and the ring's own line */
type RingScale = { k: number; min: number; stroke: number };
/** The marks at the journey's closeness (B1), and with the whole globe in view (B2). */
const SCALES: Record<'desk' | 'phone', { near: RingScale; far: RingScale }> = {
  desk: { near: { k: 4.2, min: 6, stroke: 1.5 }, far: { k: 1.6, min: 2.6, stroke: 1.3 } },
  phone: { near: { k: 3.4, min: 5, stroke: 1.5 }, far: { k: 0.95, min: 1.6, stroke: 1.1 } },
};

const GLOBE_R = 2;
/** Looking around, the marks grow by this power of how much the map has grown. */
const GROW = 0.35;
/** How long the marks take between the journey's size and the look around's, s. */
const MODE_TAU = 0.2;
/** Room left between two rings before they are one, px. */
const TOUCH_GAP = 1;
/** The screen has to grow or shrink by this share before the rings are sorted again. */
const SORT_STEP = 0.07;
/** How long a ring takes over most of its way to a new place and size, s. */
const TAU = 0.13;
/** A ring that has joined another fades over its last pixels in. */
const JOIN_PX = 3;
/** A finger is not a pointer: this far from a ring still counts as on it, px. */
const TAP_REACH = 16;

const vertex = /* glsl */ `
  attribute float aS;
  attribute float aOuter;
  attribute float aAlpha;
  uniform float uDpr;
  uniform float uK;
  uniform float uMin;
  varying float vR;
  varying float vOuter;
  varying float vAlpha;
  varying float vSize;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // the far side of the globe is not drawn, and the limb is fainter
    float facing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
    float r = uK * aS + uMin;
    // room for the band (to r+3) and the outer ring (to r+3.6), and a pixel to smooth them
    vSize = (r + 4.0) * 2.0;
    vR = r;
    vOuter = aOuter;
    vAlpha = aAlpha * smoothstep(0.04, 0.1, facing) * (0.4 + 0.6 * smoothstep(0.12, 0.3, facing));
    gl_PointSize = facing > 0.04 && aAlpha > 0.003 ? vSize * uDpr : 0.0;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uGround;
  uniform float uFar;
  uniform float uStroke;
  varying float vR;
  varying float vOuter;
  varying float vAlpha;
  varying float vSize;
  // a stroke of width w (px) at radius r, antialiased by a pixel
  float stroke(float d, float r, float w) {
    return clamp(w * 0.5 + 0.5 - abs(d - r), 0.0, 1.0);
  }
  void main() {
    float d = length(gl_PointCoord - 0.5) * vSize;
    // a band of the ground under the ring, so it lifts off the route and the dots
    float halo = stroke(d, vR + mix(1.0, 1.5, uFar), mix(4.0, 2.4, uFar)) * 0.85;
    float ink = stroke(d, vR, uStroke);
    ink = max(ink, vOuter * stroke(d, vR + mix(3.2, 2.6, uFar), mix(0.8, 0.6, uFar)));
    float a = max(halo, ink);
    if (a * vAlpha < 0.01) discard;
    vec3 col = mix(uGround, uInk, ink / max(a, 0.0001));
    gl_FragColor = vec4(col, a * vAlpha);
  }
`;

type Group = { dir: THREE.Vector3; n: number; members: number[] };

/**
 * Rings that touch are one ring. `scale` is how many pixels a radian of the
 * globe is at the middle of the screen; the globe's turn does not come into
 * it. The largest first, so a capital takes its suburbs and not the reverse —
 * and the first of a group's members is always its largest.
 */
function sortRings(
  rings: ThemeRing[],
  dirs: THREE.Vector3[],
  only: number[] | null,
  scale: number,
  k: number,
  min: number
): Group[] {
  const r = (n: number) => k * Math.sqrt(n) + min;
  const idx = (only ?? rings.map((_, i) => i)).slice().sort((a, b) => rings[b].n - rings[a].n);
  let groups: Group[] = idx.map((i) => ({ dir: dirs[i].clone(), n: rings[i].n, members: [i] }));
  for (let pass = 0; pass < 4; pass++) {
    const out: Group[] = [];
    for (const q of groups) {
      const hit = out.find((o) => o.dir.distanceTo(q.dir) * scale < r(o.n) + r(q.n) + TOUCH_GAP);
      if (!hit) {
        out.push(q);
        continue;
      }
      // the centre of weight, on the globe
      hit.dir.multiplyScalar(hit.n).addScaledVector(q.dir, q.n).normalize();
      hit.n += q.n;
      hit.members.push(...q.members);
    }
    if (out.length === groups.length) break;
    groups = out;
  }
  return groups;
}

/** What is drawn (the attributes), and where each ring is headed. */
function build(rings: ThemeRing[]) {
  const count = rings.length;
  const pos = new Float32Array(count * 3);
  const s = new Float32Array(count);
  const outer = new Float32Array(count);
  const alpha = new Float32Array(count).fill(1);
  const dirs = rings.map((ring) => ring.position.clone().normalize());
  rings.forEach((ring, i) => {
    pos.set([ring.position.x, ring.position.y, ring.position.z], i * 3);
    s[i] = Math.sqrt(ring.n);
    outer[i] = ring.twice ? 1 : 0;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  geometry.setAttribute('aOuter', new THREE.BufferAttribute(outer, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  return {
    geometry,
    pos,
    s,
    outer,
    alpha,
    dirs,
    /** how far off the globe's centre the rings sit */
    lift: count ? rings[0].position.length() : GLOBE_R,
    // every ring begins as itself
    toDir: dirs.map((d) => d.clone()),
    toS: Float32Array.from(s),
    toOuter: Float32Array.from(outer),
    leads: new Uint8Array(count).fill(1),
    groups: [] as Group[],
    /** the map's scale against the marks' when the rings were last sorted; 0 = to be sorted */
    sortedAt: 0,
    /** 0 on the journey, 1 looking around, eased; -1 = not yet either */
    look: -1,
    moving: false,
    /** a theme just chosen is sorted where it stands: nothing travels the first time */
    snap: true,
    /** the first frame of a move takes a frame's step, however long the globe had stood still */
    fresh: true,
  };
}

export function ThemeRings({
  rings,
  ink,
  ground,
  phone,
  small,
  fit,
  nearest,
  gather,
  onAim,
}: {
  rings: ThemeRing[];
  ink: string;
  /** the globe's own colour, for the band under each ring */
  ground: string;
  /** a phone's width (the journey's marks), and a phone's shorter side (the look around's) */
  phone: boolean;
  small: boolean;
  /** how far the camera stands for the whole globe, and the nearest a hand may pull */
  fit: number;
  nearest: number;
  /** looking around: rings that touch are one */
  gather: boolean;
  /** a ring of several was pressed: come this close, over there, and it comes apart */
  onAim?: (dir: THREE.Vector3, distance: number) => void;
}) {
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const events = useThree((s) => s.events);

  const points = useRef<THREE.Points>(null);
  const live = useRef<ReturnType<typeof build> | null>(null);
  const made = useMemo(() => build(rings), [rings]);
  const geometry = made.geometry;
  useEffect(() => {
    live.current = made;
    return () => made.geometry.dispose();
  }, [made]);

  const near = SCALES[phone ? 'phone' : 'desk'].near;
  // the whole globe is as large as the screen's shorter side: a phone on its side is still a phone
  const far = SCALES[small ? 'phone' : 'desk'].far;
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // made again only when the theme's colours or the screen's density change;
        // the scale is fed every frame
        uniforms: {
          uInk: { value: new THREE.Color(ink) },
          uGround: { value: new THREE.Color(ground) },
          uDpr: { value: dpr },
          uK: { value: 0 },
          uMin: { value: 0 },
          uStroke: { value: 1.5 },
          uFar: { value: 0 },
        },
      }),
    [ink, ground, dpr]
  );
  useEffect(() => () => material.dispose(), [material]);

  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  /**
   * The marks' scale and the map's, with the camera this far out. `look` is
   * how far the marks are from the journey's (0) to the look around's (1).
   */
  const at = (distance: number, look: number) => {
    const fov = ((camera as THREE.PerspectiveCamera).fov ?? 45) * (Math.PI / 180);
    // pixels to a radian of the globe, where it faces the camera
    const scaleAt = (d: number) =>
      (GLOBE_R * (height / 2 / Math.tan(fov / 2))) / Math.max(0.05, d - GLOBE_R);
    const scale = scaleAt(distance);
    // looking around: the whole globe's size, grown a little with the map, never past the journey's
    const grown = Math.pow(Math.max(1, scale / scaleAt(fit)), GROW);
    const k = Math.min(near.k, far.k * grown);
    const min = Math.min(near.min, far.min * grown);
    // how far from the journey's look the line and its band are
    const t = look * Math.max(0, Math.min(1, (near.k - k) / Math.max(1e-3, near.k - far.k)));
    return {
      t,
      k: near.k + (k - near.k) * look,
      min: near.min + (min - near.min) * look,
      stroke: near.stroke + (far.stroke - near.stroke) * t,
      scale,
    };
  };
  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  });

  // looking around or not, another screen: a new sorting
  useEffect(() => {
    if (live.current) live.current.sortedAt = 0;
    invalidate();
  }, [gather, phone, small, fit, height, made, invalidate]);

  useFrame((_, delta) => {
    const st = live.current;
    const count = rings.length;
    if (!st || !count) return;
    const u = (points.current?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    if (!u) return;
    // between the journey's marks and the look around's: eased, from wherever it is
    const want = gather ? 1 : 0;
    if (st.look < 0 || reduced) st.look = want;
    else if (Math.abs(want - st.look) > 0.01) {
      st.look += (want - st.look) * (1 - Math.exp(-Math.min(delta, 1 / 20) / MODE_TAU));
      invalidate();
    } else st.look = want;
    const now = at(camera.position.length(), st.look);
    u.uK.value = now.k;
    u.uMin.value = now.min;
    u.uStroke.value = now.stroke;
    u.uFar.value = now.t;

    // which rings are one: again only when the screen's scale has moved a step
    // (the map against a middling mark — the marks change size too)
    const ratio = now.scale / (now.k * 3 + now.min);
    if (!st.sortedAt || (gather && Math.abs(Math.log(ratio / st.sortedAt)) > SORT_STEP)) {
      st.groups = gather
        ? sortRings(rings, st.dirs, null, now.scale, now.k, now.min)
        : rings.map((ring, i) => ({ dir: st.dirs[i], n: ring.n, members: [i] }));
      for (const g of st.groups) {
        const several = g.members.length > 1;
        // the largest of them is the one that stays; the rest go into it
        const lead = g.members[0];
        for (const i of g.members) {
          st.toDir[i].copy(g.dir);
          st.toS[i] = Math.sqrt(g.n);
          st.toOuter[i] = several || rings[i].twice ? 1 : 0;
          st.leads[i] = i === lead ? 1 : 0;
        }
      }
      st.sortedAt = ratio;
      st.moving = true;
      st.fresh = true;
    }
    if (!st.moving) return;

    const dt = st.fresh ? Math.min(delta, 1 / 60) : Math.min(delta, 1 / 20);
    st.fresh = false;
    const e = reduced || st.snap ? 1 : 1 - Math.exp(-dt / TAU);
    st.snap = false;
    const v = new THREE.Vector3();
    let moving = false;
    for (let i = 0; i < count; i++) {
      v.fromArray(st.pos, i * 3).normalize();
      const to = st.toDir[i];
      let left = v.distanceTo(to) * now.scale;
      if (left > 0.05) {
        v.lerp(to, e).normalize();
        left = v.distanceTo(to) * now.scale;
        moving = true;
      } else v.copy(to);
      v.multiplyScalar(st.lift).toArray(st.pos, i * 3);
      const ds = st.toS[i] - st.s[i];
      if (Math.abs(ds) * now.k > 0.05) {
        st.s[i] += ds * e;
        moving = true;
      } else st.s[i] = st.toS[i];
      const dOuter = st.toOuter[i] - st.outer[i];
      if (Math.abs(dOuter) > 0.02) {
        st.outer[i] += dOuter * e;
        moving = true;
      } else st.outer[i] = st.toOuter[i];
      // a ring that goes into another is there until it has arrived
      st.alpha[i] = st.leads[i] ? 1 : Math.min(1, left / JOIN_PX);
    }
    const a = st.geometry.attributes;
    a.position.needsUpdate = true;
    a.aS.needsUpdate = true;
    a.aOuter.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    st.moving = moving;
    // drawn on demand: there is a next frame while a ring is on its way
    if (moving) invalidate();
  });

  // A ring of several, pressed: the camera comes close enough for it to come apart.
  const aim = useRef(onAim);
  useEffect(() => {
    aim.current = onAim;
  });
  useEffect(() => {
    if (!gather) return;
    const el = (events.connected as HTMLElement | undefined) ?? gl.domElement;
    let down = { x: 0, y: 0, t: 0 };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const st = live.current;
      if (!st) return;
      // a drag is a turn, and a long press is not a press
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
      if (performance.now() - down.t > 600) return;
      const rect = gl.domElement.getBoundingClientRect();
      const distance = camera.position.length();
      const now = atRef.current(distance, 1);
      const eye = camera.position.clone().normalize();
      const v = new THREE.Vector3();
      let best: Group | null = null;
      let bestD = Infinity;
      for (const g of st.groups) {
        if (g.members.length < 2 || g.dir.dot(eye) < 0.15) continue;
        v.copy(g.dir).multiplyScalar(st.lift).project(camera);
        const x = rect.left + ((v.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - v.y) / 2) * rect.height;
        const d = Math.hypot(e.clientX - x, e.clientY - y);
        const reach = Math.max(TAP_REACH, now.k * Math.sqrt(g.n) + now.min + 6);
        if (d <= reach && d < bestD) {
          best = g;
          bestD = d;
        }
      }
      if (!best) return;
      ringPress.at = performance.now();
      // closer by a tenth at a time until these are no longer one ring, and one step past it
      let to = distance;
      for (let step = 0; step < 60 && to > nearest; step++) {
        to = GLOBE_R + (to - GLOBE_R) / 1.1;
        const then = atRef.current(to, 1);
        if (sortRings(rings, st.dirs, best.members, then.scale, then.k, then.min).length > 1) {
          to = GLOBE_R + (to - GLOBE_R) / 1.1;
          break;
        }
      }
      aim.current?.(best.dir.clone(), Math.max(nearest, to));
    };
    // on the way down, so this is heard before the double tap makes up its mind
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointerup', onUp, true);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointerup', onUp, true);
    };
  }, [gather, rings, camera, gl, events, nearest]);

  if (!rings.length) return null;
  // above the route and the city rings, under the dot's own overlay (DOM)
  return (
    <points
      ref={points}
      geometry={geometry}
      material={material}
      renderOrder={5}
      frustumCulled={false}
    />
  );
}
