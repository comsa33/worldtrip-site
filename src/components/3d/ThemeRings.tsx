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
import { RING_FAR, type RingFar } from './themeRingScale';

export interface ThemeRing {
  city: string;
  position: THREE.Vector3;
  /** photos of the theme, all stays added */
  n: number;
  /** more than one stay had the theme */
  twice: boolean;
  /** the first stay that has the theme — where its photo book opens */
  stopId: number;
}

/** radius in px = k·√n + min, and the ring's own line */
type RingScale = { k: number; min: number; stroke: number };
/** The marks at the journey's closeness (B1). With the whole globe in view: themeRingScale.ts. */
const NEAR: Record<'desk' | 'phone', RingScale> = {
  desk: { k: 4.2, min: 6, stroke: 1.5 },
  phone: { k: 3.4, min: 5, stroke: 1.5 },
};

const GLOBE_R = 2;
/**
 * Looking around, how close a press on a lone ring brings the camera — about
 * where the journey itself stands over a city. From here in, a press opens
 * the ring's book.
 */
const COME_TO = 4.5;
/** Looking around, the marks start drawing down to pins at this share of the nearest scale. */
const PIN_FROM = 0.7;
/** How long the marks take between the journey's size and the look around's, s. */
const MODE_TAU = 0.2;
/** The screen has to grow or shrink by this share before the rings are sorted again. */
const SORT_STEP = 0.07;
/** How long a ring takes over most of its way to a new place and size, s. */
const TAU = 0.13;
/** A ring that has joined another fades over its last pixels in. */
const JOIN_PX = 3;
/** A finger is not a pointer: this far from a ring's centre still counts as on it, px (44 across). */
const TAP_REACH = 22;
/** A ring under a press draws in by this much. */
const SQUEEZE = 0.86;

const vertex = /* glsl */ `
  attribute float aS;
  attribute float aOuter;
  attribute float aAlpha;
  attribute float aSq;
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
    float r = (uK * aS + uMin) * aSq;
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
  min: number,
  /** room left between two rings before they are one (px), already scaled by how much they gather */
  gap: number,
  /** 1: rings that touch are one; towards 0 they have to overlap more and more, and at 0 none are */
  gather = 1
): Group[] {
  const r = (n: number) => k * Math.sqrt(n) + min;
  const idx = (only ?? rings.map((_, i) => i)).slice().sort((a, b) => rings[b].n - rings[a].n);
  let groups: Group[] = idx.map((i) => ({ dir: dirs[i].clone(), n: rings[i].n, members: [i] }));
  for (let pass = 0; pass < 4; pass++) {
    const out: Group[] = [];
    for (const q of groups) {
      const hit = out.find(
        (o) => o.dir.distanceTo(q.dir) * scale < (r(o.n) + r(q.n) + gap) * gather
      );
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
  const sq = new Float32Array(count).fill(1);
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
  geometry.setAttribute('aSq', new THREE.BufferAttribute(sq, 1));
  return {
    geometry,
    pos,
    s,
    outer,
    alpha,
    sq,
    /** the ring under a press, or -1: it tightens while it is held */
    pressed: -1,
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
  onOpen,
  onPress,
  spot: spotRef,
  scale: sizes = RING_FAR,
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
  /** a ring on its own was pressed: its photo book, at this stay */
  onOpen?: (city: string, stopId: number) => void;
  /** a ring on its own has just come under a press — the book may be about to open */
  onPress?: (city: string, stopId: number) => void;
  /** filled in here: where a city's ring is on the screen (null if it is not) */
  spot?: React.MutableRefObject<
    ((city: string) => { x: number; y: number; r: number } | null) | null
  >;
  /** the look around's sizes — the bench's while it is open */
  scale?: RingFar;
}) {
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  const points = useRef<THREE.Points>(null);
  const live = useRef<ReturnType<typeof build> | null>(null);
  const made = useMemo(() => build(rings), [rings]);
  const geometry = made.geometry;
  useEffect(() => {
    live.current = made;
    return () => made.geometry.dispose();
  }, [made]);

  const near = NEAR[phone ? 'phone' : 'desk'];
  // the whole globe is as large as the screen's shorter side: a phone on its side is still a phone
  const far: RingScale = small
    ? { k: sizes.phoneK, min: sizes.phoneMin, stroke: sizes.phoneStroke }
    : { k: sizes.deskK, min: sizes.deskMin, stroke: sizes.deskStroke };
  const { grow, gap, pin } = sizes;
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
    const grown = Math.pow(Math.max(1, scale / scaleAt(fit)), grow);
    // Over the last of the way in, the marks draw down to pins and let go of
    // each other: towns ten kilometres apart are two pixels apart even here,
    // and pulled all the way in every ring has to stand on its own.
    const u = (scale / scaleAt(nearest) - PIN_FROM) / (1 - PIN_FROM);
    const pinned = look * Math.max(0, Math.min(1, u)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, u)));
    const k = Math.min(near.k, far.k * grown) * (1 - pinned);
    const lookMin = Math.min(near.min, far.min * grown);
    const min = lookMin + (pin - lookMin) * pinned;
    // how far from the journey's look the line and its band are
    const t =
      look *
      Math.max(
        0,
        Math.min(1, (near.k - Math.min(near.k, far.k * grown)) / Math.max(1e-3, near.k - far.k))
      );
    return {
      t,
      k: near.k + (k - near.k) * look,
      min: near.min + (min - near.min) * look,
      stroke: near.stroke + (far.stroke - near.stroke) * t,
      scale,
      gather: 1 - pinned,
    };
  };
  const atRef = useRef(at);
  const gapRef = useRef(gap);
  useEffect(() => {
    atRef.current = at;
    gapRef.current = gap;
  });

  // looking around or not, another screen: a new sorting
  useEffect(() => {
    if (live.current) live.current.sortedAt = 0;
    invalidate();
  }, [
    gather,
    phone,
    small,
    fit,
    nearest,
    height,
    made,
    invalidate,
    far.k,
    far.min,
    grow,
    gap,
    pin,
  ]);

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
    const ratio = now.scale / ((now.k * 3 + now.min) * Math.max(0.02, now.gather));
    if (!st.sortedAt || (gather && Math.abs(Math.log(ratio / st.sortedAt)) > SORT_STEP)) {
      st.groups = gather
        ? sortRings(rings, st.dirs, null, now.scale, now.k, now.min, gap, now.gather)
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
      // held under a press, it draws in; let go, it lets out
      const dSq = (st.pressed === i ? SQUEEZE : 1) - st.sq[i];
      if (Math.abs(dSq) > 0.004) {
        st.sq[i] += dSq * (reduced ? 1 : 1 - Math.exp(-dt / 0.05));
        moving = true;
      } else st.sq[i] = st.pressed === i ? SQUEEZE : 1;
    }
    const a = st.geometry.attributes;
    a.position.needsUpdate = true;
    a.aS.needsUpdate = true;
    a.aOuter.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    a.aSq.needsUpdate = true;
    st.moving = moving;
    // drawn on demand: there is a next frame while a ring is on its way
    if (moving) invalidate();
  });

  // A ring pressed. One of several: the camera comes close enough for it to
  // come apart. One on its own: that stay's photo book, the theme still on.
  const aim = useRef(onAim);
  const open = useRef(onOpen);
  const held = useRef(onPress);
  useEffect(() => {
    aim.current = onAim;
    open.current = onOpen;
    held.current = onPress;
  });
  useEffect(() => {
    // Heard on the window, not the canvas: on a phone the journey's canvas is
    // not touched at all (the page under it scrolls), and the press lands on
    // whatever lies there. Anything that is a thing of its own keeps its press.
    const own =
      'button, a, input, .journey-header, .theme-row, .stop-rail, .minimap, .country-inset, .filmstrip, .scrubber, .city-label, .about-overlay, .pb, .tuner';
    const mine = (e: PointerEvent) => !(e.target instanceof Element && e.target.closest(own));
    /** where a group is on the screen and how large it is drawn; null behind the globe */
    const spotOf = (g: Group, st: NonNullable<typeof live.current>) => {
      const eye = camera.position.clone().normalize();
      if (g.dir.dot(eye) < 0.15) return null;
      const now = atRef.current(camera.position.length(), st.look < 0 ? 0 : st.look);
      const rect = gl.domElement.getBoundingClientRect();
      const v = g.dir.clone().multiplyScalar(st.lift).project(camera);
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
        r: (now.k * Math.sqrt(g.n) + now.min) * st.sq[g.members[0]],
      };
    };
    const under = (x: number, y: number) => {
      const st = live.current;
      if (!st) return null;
      let best: Group | null = null;
      let bestD = Infinity;
      for (const g of st.groups) {
        const s = spotOf(g, st);
        if (!s) continue;
        const d = Math.hypot(x - s.x, y - s.y);
        if (d <= Math.max(TAP_REACH, s.r + 6) && d < bestD) {
          best = g;
          bestD = d;
        }
      }
      return best;
    };
    const press = (i: number) => {
      const st = live.current;
      if (!st || st.pressed === i) return;
      st.pressed = i;
      st.moving = true;
      invalidate();
    };
    // the book asks where a city's ring is, to open out of it and close into it
    if (spotRef)
      spotRef.current = (city: string) => {
        const st = live.current;
        const i = rings.findIndex((ring) => ring.city === city);
        const g = st?.groups.find((x) => x.members.includes(i));
        const s = st && g ? spotOf(g, st) : null;
        if (!s || s.x < 0 || s.y < 0 || s.x > window.innerWidth || s.y > window.innerHeight)
          return null;
        return s;
      };

    let down = { x: 0, y: 0, t: 0 };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (!mine(e)) return;
      const g = under(e.clientX, e.clientY);
      // a ring on its own tightens under the press, and its picture is sent for
      if (g && g.members.length === 1) {
        press(g.members[0]);
        const ring = rings[g.members[0]];
        held.current?.(ring.city, ring.stopId);
      }
    };
    const onMove = (e: PointerEvent) => {
      // a drag is a turn: the ring lets go
      if (live.current && live.current.pressed >= 0)
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) press(-1);
      if (e.pointerType !== 'mouse') return;
      const g = e.buttons === 0 && mine(e) ? under(e.clientX, e.clientY) : null;
      gl.domElement.style.cursor = g ? 'pointer' : '';
    };
    const onUp = (e: PointerEvent) => {
      const st = live.current;
      if (!st) return;
      const was = st.pressed;
      // the ring that opens its book stays drawn in under it; any other lets go
      const letGo = () => press(-1);
      if (!mine(e)) return letGo();
      // a drag is a turn, and a long press is not a press
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return letGo();
      if (performance.now() - down.t > 600) return letGo();
      const best = under(e.clientX, e.clientY);
      if (!best) return letGo();
      ringPress.at = performance.now();
      if (best.members.length < 2) {
        const ring = rings[best.members[0]];
        // Far off, a press comes closer; close by, it goes in. Looking around
        // from further out than the journey ever stands, the camera goes over
        // to the ring first, and the press after that opens its book.
        if (gather && camera.position.length() > COME_TO * 1.08) {
          letGo();
          aim.current?.(
            best.dir.clone(),
            Math.max(nearest, Math.min(COME_TO, camera.position.length()))
          );
          return;
        }
        if (was !== best.members[0]) letGo();
        // The click that follows this press belongs to it: the book is up by
        // then, and the click would land on its photo and turn the page.
        const swallow = (c: MouseEvent) => {
          c.stopPropagation();
          c.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 400);
        open.current?.(ring.city, ring.stopId);
        // the globe stands still under the book; the ring lets out when it is back
        st.pressed = -1;
        st.moving = true;
        return;
      }
      letGo();
      if (!gather) return;
      // closer by a tenth at a time until these are no longer one ring, and one step past it
      const distance = camera.position.length();
      let to = distance;
      for (let step = 0; step < 60 && to > nearest; step++) {
        to = GLOBE_R + (to - GLOBE_R) / 1.1;
        const then = atRef.current(to, 1);
        if (
          sortRings(
            rings,
            st.dirs,
            best.members,
            then.scale,
            then.k,
            then.min,
            gapRef.current,
            then.gather
          ).length > 1
        ) {
          to = GLOBE_R + (to - GLOBE_R) / 1.1;
          break;
        }
      }
      // (pulled all the way in, every ring stands on its own: there is always a distance)
      aim.current?.(best.dir.clone(), Math.max(nearest, to));
    };
    const onCancel = () => press(-1);
    const canvas = gl.domElement;
    // on the way down, so this is heard before the double tap makes up its mind
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      canvas.style.cursor = '';
      if (spotRef) spotRef.current = null;
    };
  }, [rings, camera, gl, nearest, gather, invalidate, spotRef]);

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
