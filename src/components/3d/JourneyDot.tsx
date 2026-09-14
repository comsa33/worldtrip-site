import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { NOTE_GAP, NOTE_H, NOTE_W } from '../about/useDotAnchor';

/** The mark is never smaller than the header mark it comes from, nor larger than this. */
const DOT_MIN = 8;
const DOT_MAX = 20;
/** Any thinner and the ribbon stops reading as a line. */
const MIN_W = 0.9;
/** The most the mark is ever drawn out, in screen pixels. */
const MAX_LEN = 120;
/** How long the tail takes to make up most of the distance to the head. */
const TAIL_TAU_MS = 150;
/** Below this the ribbon is a dot again. */
const REST_PX = 0.8;
/** A move shorter than this is a shiver, not a journey — no landing bounce. */
const JOURNEY_PX = 6;

export type PathPoint = {
  point: THREE.Vector3;
  segmentProgress: number;
  transport?: string;
};

/**
 * The head of the route, projected onto the page every frame, and the mark
 * drawn out along it while it moves.
 *
 * The dot itself belongs to TravelingDot. This component moves a seat for it
 * (`[data-dot-follow]`) to wherever the head of the route is on screen, and
 * while the head is moving it draws the mark as a ribbon instead: head first
 * along the route, tail following late, so the mark stretches out and gathers
 * back. Not the dot scaled — a stroke running the path. The width is not
 * animated: it is read off the length each frame, the way a band's is, and
 * tapers from the head to the tail so the mark keeps a front. What is
 * conserved is the dot's area, so the further it is drawn out the finer even
 * its head becomes. When the tail catches the head the ribbon is a dot again
 * and the seat says so, which is TravelingDot's cue to bounce.
 *
 * The mark is the size of the current city's marker on screen, whatever the
 * zoom — the marker's world radius is projected every frame, so the two never
 * disagree.
 */
export function HeadTracker({
  path,
  progress,
  seat: seatRef,
  ribbon: ribbonRef,
  active,
  markerRadius,
  lean,
  leanSpan = 0,
}: {
  path: PathPoint[];
  progress: number;
  seat: React.RefObject<HTMLSpanElement | null>;
  ribbon: React.RefObject<SVGPolygonElement | null>;
  /** false while something else (the photo book) has the dot */
  active: boolean;
  /** the current city marker's radius in world units, at the current zoom */
  markerRadius: number;
  /** a share of `leanSpan` path steps the head is pushed ahead — the first-step hint */
  lean?: React.RefObject<number>;
  leanSpan?: number;
}) {
  const { camera, size, gl } = useThree();
  const tail = useRef<number | null>(null);
  const lastT = useRef(0);
  const travelled = useRef(0);
  const landings = useRef(0);
  const lastCarry = useRef('');
  const v = useRef(new THREE.Vector3());

  useEffect(() => {
    tail.current = null;
  }, [path]);

  useFrame(({ clock }) => {
    const seatEl = seatRef.current;
    const poly = ribbonRef.current;
    if (!seatEl || !poly || path.length < 2) return;

    const now = clock.elapsedTime * 1000;
    const dt = Math.min(64, now - lastT.current || 16);
    lastT.current = now;

    const rect = gl.domElement.getBoundingClientRect();
    const toScreen = (p: THREE.Vector3, out: { x: number; y: number }) => {
      v.current.copy(p).project(camera);
      out.x = rect.left + ((v.current.x + 1) / 2) * size.width;
      out.y = rect.top + ((1 - v.current.y) / 2) * size.height;
      return out;
    };
    const at = (f: number, out: THREE.Vector3) => {
      const i = Math.max(0, Math.min(path.length - 1, f));
      const a = Math.floor(i);
      const b = Math.min(path.length - 1, a + 1);
      return out.lerpVectors(path[a].point, path[b].point, i - a);
    };

    const head = Math.min(
      path.length - 1,
      progress * (path.length - 1) + (lean?.current ?? 0) * leanSpan
    );
    // a tail that went bad (NaN, seen once after the photo book closed under a
    // finger) starts again at the head rather than taking the frame loop down
    if (tail.current === null || !Number.isFinite(tail.current)) tail.current = head;

    // in the air the mark is faster, and a faster mark is drawn out longer:
    // the tail hangs back more and the streak may run further
    const flying =
      path[Math.min(path.length - 1, Math.max(0, Math.round(head)))].transport === 'flight';
    const tau = flying ? TAIL_TAU_MS * 1.8 : TAIL_TAU_MS;
    const maxLen = flying ? MAX_LEN * 1.6 : MAX_LEN;

    // the tail closes on the head with a time constant, and is dragged along
    // if the head gets further ahead than the ribbon is allowed to be long
    const k = 1 - Math.exp(-dt / tau);
    let t = tail.current + (head - tail.current) * k;
    if (!Number.isFinite(t)) t = head;
    if (Math.abs(head - t) < 0.002) t = head;

    // front or back of the world
    const hp = at(head, new THREE.Vector3());
    const facing = hp.clone().normalize().dot(camera.position.clone().normalize()) > 0.08;

    // the marker's radius, in pixels, at this distance from the camera
    const fov = ((camera as THREE.PerspectiveCamera).fov ?? 45) * (Math.PI / 180);
    const dist = camera.position.distanceTo(hp);
    const rPx = (markerRadius / (dist * Math.tan(fov / 2))) * (size.height / 2);
    const DOT = Math.max(DOT_MIN, Math.min(DOT_MAX, Math.round(rPx * 2)));
    seatEl.style.setProperty('--dot-size', `${DOT}px`);

    const hs = toScreen(hp, { x: 0, y: 0 });
    seatEl.style.transform = `translate(${hs.x - DOT / 2}px, ${hs.y - DOT / 2}px)`;

    const setCarry = (c: string) => {
      if (lastCarry.current === c) return;
      lastCarry.current = c;
      seatEl.setAttribute('data-dot-carry', c);
    };

    if (!active || !facing) {
      poly.removeAttribute('data-on');
      tail.current = head;
      setCarry(facing ? '' : 'hidden');
      return;
    }

    // sample the route between tail and head, in screen space
    const n = 22;
    const lo = Math.min(t, head);
    const hi = Math.max(t, head);
    const pts: { x: number; y: number }[] = [];
    const tmp = new THREE.Vector3();
    let len = 0;
    for (let i = 0; i <= n; i++) {
      const s = toScreen(at(lo + ((hi - lo) * i) / n, tmp), { x: 0, y: 0 });
      if (i) len += Math.hypot(s.x - pts[i - 1].x, s.y - pts[i - 1].y);
      pts.push(s);
    }
    if (len > maxLen) {
      // too far behind: bring the tail up to where the ribbon is as long as allowed
      t = head - (head - t) * (maxLen / len);
      if (!Number.isFinite(t)) t = head;
      len = maxLen;
    }
    tail.current = t;
    travelled.current = Math.max(travelled.current, len);

    if (len < REST_PX) {
      poly.removeAttribute('data-on');

      // A snap tidying up after a reader who has already stopped is a correction,
      // not a journey: the mark bounced once where they left it, and bouncing
      // again at the city reads as a hiccup rather than an arrival. It arrives
      // quietly, the way a move too short to be travel does.
      if (seatEl.hasAttribute('data-dot-correcting')) {
        setCarry('');
        travelled.current = 0;
        return;
      }

      // While the page is still being put down, a ribbon that dips below resting
      // length for a frame is not an arrival — it is the middle of one. The
      // distance already run stays on the clock so the landing that does come
      // still counts as travel and bounces.
      if (seatEl.hasAttribute('data-dot-gliding')) {
        setCarry('');
        return;
      }

      if (travelled.current >= JOURNEY_PX) {
        landings.current += 1;
        setCarry(`land:${landings.current}`);
      } else {
        setCarry('');
      }
      travelled.current = 0;
      return;
    }

    // the mark, drawn out: a tapered ribbon whose area is the dot's
    const area = Math.PI * (DOT / 2) * (DOT / 2);
    const W = Math.max(MIN_W, Math.min(DOT, area / (0.625 * len))); // ∫ t^0.6 = 0.625
    const forward = head >= t; // which end is the head
    let ordered = forward ? pts : pts.slice().reverse(); // tail → head
    // Gathering in, the mark is short and nearly as wide as it is long. A
    // ribbon that wide cannot follow a bend in the road — its inner side folds
    // over itself into a spike — and a tail drawn to a point at that length is
    // a thorn, not a comet. So under three diameters the mark is a straight
    // capsule between tail and head, and the tail rounds off as it closes in.
    const short = len < 3 * DOT;
    const tailRound = short ? 1 - len / (3 * DOT) : 0;
    if (short) {
      const a0 = ordered[0];
      const a1 = ordered[n];
      ordered = [];
      for (let i = 0; i <= n; i++) {
        ordered.push({ x: a0.x + ((a1.x - a0.x) * i) / n, y: a0.y + ((a1.y - a0.y) * i) / n });
      }
    }
    // The direction at each sample, carried over wherever two samples land on
    // the same pixel. The route repeats a city's point where one leg ends and
    // the next begins, so on arrival the samples nearest the head coincide —
    // and a direction read off two identical points is (0,0): the sides pinch
    // to nothing and the cap swings to «right», an elbow for a frame.
    const dir: { x: number; y: number }[] = [];
    let ldx = 1;
    let ldy = 0;
    let firstReal = -1;
    for (let i = 0; i <= n; i++) {
      const q = ordered[Math.min(n, i + 1)];
      const r = ordered[Math.max(0, i - 1)];
      const dx = q.x - r.x;
      const dy = q.y - r.y;
      const m = Math.hypot(dx, dy);
      if (m > 0.05) {
        ldx = dx / m;
        ldy = dy / m;
        if (firstReal < 0) firstReal = i;
      }
      dir.push({ x: ldx, y: ldy });
    }
    // samples before the first real direction take it, rather than «right»
    for (let i = 0; i < firstReal; i++) dir[i] = dir[firstReal];
    const left: string[] = [];
    const right: string[] = [];
    const halfAt = (i: number) => (W / 2) * ((1 - tailRound) * Math.pow(i / n, 0.6) + tailRound);
    for (let i = 0; i <= n; i++) {
      const p = ordered[i];
      const { x: dx, y: dy } = dir[i];
      const w = halfAt(i);
      left.push(`${p.x - dy * w},${p.y + dx * w}`);
      right.unshift(`${p.x + dy * w},${p.y - dx * w}`);
    }
    // Round caps, walked in the polygon's own order so no edge crosses the
    // mark: the left side ends at the head's +90° point, so the head's cap
    // runs from +90° through «ahead» to −90°, where the right side begins; the
    // right side ends at the tail's −90° point, and a rounded tail runs from
    // there through «behind» back to +90°, where the left side began.
    const arc = (c: { x: number; y: number }, from: number, sweep: number, r: number) => {
      const out: string[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = from + (sweep * i) / 8;
        out.push(`${c.x + Math.cos(a) * r},${c.y + Math.sin(a) * r}`);
      }
      return out;
    };
    const ang = Math.atan2(dir[n].y, dir[n].x);
    const cap = arc(ordered[n], ang + Math.PI / 2, -Math.PI, W / 2);
    const ang0 = Math.atan2(dir[0].y, dir[0].x);
    const tailCap = tailRound > 0 ? arc(ordered[0], ang0 - Math.PI / 2, -Math.PI, halfAt(0)) : [];
    poly.setAttribute('points', left.concat(cap, right, tailCap).join(' '));
    poly.setAttribute('data-on', '');
    setCarry('ribbon');
  });

  return null;
}

/**
 * The DOM half: the seat the dot is pinned to, and the ribbon it becomes on
 * the move. Both are fixed to the viewport, like the dot itself.
 */
export function JourneyDotOverlay({
  seat,
  ribbon,
  active,
}: {
  seat: React.RefObject<HTMLSpanElement | null>;
  ribbon: React.RefObject<SVGPolygonElement | null>;
  active: boolean;
}) {
  return (
    <>
      <svg className="route-ribbon" aria-hidden="true">
        <polygon ref={ribbon} points="0,0" />
      </svg>
      <span
        ref={seat}
        className="journey-seat"
        data-dot-follow=""
        data-dot-active={active ? '' : undefined}
        aria-hidden="true"
      />
    </>
  );
}

/**
 * Which side of the dot a city's note should sit on: below, unless the route
 * runs under the words there and not above.
 *
 * Decided in screen space, once, on the frame after the journey has settled on
 * a stop: the last two legs walked and the one ahead are projected, and each
 * of the two seats — the note's footprint under the dot, and over it — is
 * charged for every route point that falls inside it. The line already walked
 * is orange and the eye follows it in, so it counts double; the dull line
 * ahead counts once. Ties go below. The note never moves after this.
 */
export function NoteSideProbe({
  path,
  stopIds,
  stopIdx,
  onSide,
}: {
  path: { point: THREE.Vector3; fromStopId: number }[];
  /** stop ids in journey order */
  stopIds: number[];
  /** the stop the reader has settled on, or null while moving */
  stopIdx: number | null;
  onSide: (side: 'below' | 'above') => void;
}) {
  const { camera, size, gl } = useThree();
  const pending = useRef<number | null>(null);
  const v = useRef(new THREE.Vector3());
  const lastCam = useRef(new THREE.Vector3());

  useEffect(() => {
    pending.current = stopIdx;
  }, [stopIdx]);

  useFrame(() => {
    const i = pending.current;
    if (i === null) return;
    // not while the camera is still gliding in: the lines have not landed yet
    const moved = lastCam.current.distanceToSquared(camera.position);
    lastCam.current.copy(camera.position);
    if (moved > 1e-6) return;
    pending.current = null;

    const rect = gl.domElement.getBoundingClientRect();
    const toScreen = (p: THREE.Vector3) => {
      v.current.copy(p).project(camera);
      return {
        x: rect.left + ((v.current.x + 1) / 2) * size.width,
        y: rect.top + ((1 - v.current.y) / 2) * size.height,
      };
    };

    const id = stopIds[i];
    const headIdx = path.findIndex((p) => p.fromStopId === id);
    const head = toScreen((path[headIdx] ?? path[path.length - 1]).point);
    const past = new Set([stopIds[i - 1], stopIds[i - 2]].filter((x) => x !== undefined));

    let below = 0;
    let above = 0;
    for (const p of path) {
      const weight = past.has(p.fromStopId) ? 2 : p.fromStopId === id ? 1 : 0;
      if (!weight) continue;
      const s = toScreen(p.point);
      if (s.x < head.x || s.x > head.x + NOTE_W) continue;
      const dy = s.y - head.y;
      if (dy > NOTE_GAP && dy < NOTE_GAP + NOTE_H) below += weight;
      else if (dy < -NOTE_GAP && dy > -(NOTE_GAP + NOTE_H)) above += weight;
    }
    onSide(above < below ? 'above' : 'below');
  });

  return null;
}
