import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

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
}: {
  path: PathPoint[];
  progress: number;
  seat: React.RefObject<HTMLSpanElement | null>;
  ribbon: React.RefObject<SVGPolygonElement | null>;
  /** false while something else (the photo book) has the dot */
  active: boolean;
  /** the current city marker's radius in world units, at the current zoom */
  markerRadius: number;
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

    const head = progress * (path.length - 1);
    if (tail.current === null) tail.current = head;

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
    const ordered = forward ? pts : pts.slice().reverse(); // tail → head
    const left: string[] = [];
    const right: string[] = [];
    for (let i = 0; i <= n; i++) {
      const p = ordered[i];
      const q = ordered[Math.min(n, i + 1)];
      const r = ordered[Math.max(0, i - 1)];
      let dx = q.x - r.x;
      let dy = q.y - r.y;
      const m = Math.hypot(dx, dy) || 1;
      dx /= m;
      dy /= m;
      const w = (W * Math.pow(i / n, 0.6)) / 2;
      left.push(`${p.x - dy * w},${p.y + dx * w}`);
      right.unshift(`${p.x + dy * w},${p.y - dx * w}`);
    }
    // a round cap on the head, so a ribbon that has gathered is a circle
    const h = ordered[n];
    const g = ordered[n - 1];
    const ang = Math.atan2(h.y - g.y, h.x - g.x);
    const cap: string[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = ang - Math.PI / 2 + (Math.PI * i) / 8;
      cap.push(`${h.x + Math.cos(a) * (W / 2)},${h.y + Math.sin(a) * (W / 2)}`);
    }
    poly.setAttribute('points', left.concat(cap, right).join(' '));
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
