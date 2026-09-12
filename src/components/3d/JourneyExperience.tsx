import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Line, Html, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import {
  Camera as CameraIcon,
  ChevronUp,
  Plane,
  Bus,
  TrainFront,
  Ship,
  Mountain,
} from 'lucide-react';
import journeyData from '../../data/journey.json';

// 헤더 기간 표시: journey.json에서 유도한다 (데이터가 바뀌면 같이 따라간다)
const journeyPeriod = `${journeyData.startDate.replace(/-/g, '.')} — ${journeyData.endDate.replace(/-/g, '.')}`;
import citiesData from '../../data/cities.json';
import countriesData from '../../data/countries.json';
import { I18nProvider, useI18n, SUPPORTED_LANGUAGES, type Language } from '../../i18n';
import AboutOverlay from '../about/AboutOverlay';
import FinaleOverlay from '../about/FinaleOverlay';
import StopNote from '../about/StopNote';
import { useSettledStop } from '../about/useSettledStop';
import PhotoGallery from '../gallery/PhotoGallery';
import { Filmstrip } from '../gallery/Filmstrip';
import { TravelingDot } from '../gallery/TravelingDot';
import { HeadTracker, JourneyDotOverlay } from './JourneyDot';
import { photosForStop, cityHasPhotos } from '../../lib/visitPhotos';
import { DotGlobe } from './DotGlobe';
import { WorldBorders } from './WorldBorders';
import { Scrubber } from './Scrubber';
import { Minimap } from './Minimap';
import { GLOBE, useTheme, useToggleTheme, type Theme } from '../../theme';
import { RouteTuner } from './RouteTuner';
import { TUNE_ON, defaults, useTuning, type Tuning } from './routeTuning';
import { PhotoMarkers } from './PhotoMarkers';
import osrmRoutes from '../../data/osrmRoutes.json';
import './JourneyExperience.css';

// =============================================================================
// Constants
// =============================================================================

const SEGMENT_THRESHOLD = 0.15; // Progress within segment where we switch from showing "from" to "to" stop
const TIMELINE_ITEM_HEIGHT = 34; // Must match CSS .timeline-stop height
const JOURNEY_START = new Date('2016-08-13T00:00:00');
const ACCENT = '#ff670d';

/**
 * How long the page has to be still before a stop may claim it.
 *
 * This has a ceiling the mark sets, not taste. The scene rides a critically
 * damped spring (K below), which takes 470–780ms to come to rest depending on
 * how hard the page was thrown, and the mark bounces when it lands — a bounce
 * that restarts rather than catches. Fire after the mark has already landed and
 * it lands a second time. Staying well under that keeps the snap inside the one
 * movement, so the glide is the tail of the same journey and there is one
 * landing at the end of it.
 */
const SNAP_REST_MS = 120;
/** How near a stop has to be to claim the rest, as a share of the leg stood on. */
const SNAP_ZONE = 0.3;
/** The glide itself. The spring is doing the smoothing; this only sets the reach. */
const SNAP_MS = 320;
/** A hand's scroll that ended longer ago than this was not what moved the page. */
const SNAP_HAND_MS = 600;
/** Nearer than this the page is already there, and moving would be a twitch. */
const SNAP_MIN_PX = 2;
/** How long after a correction arrives the mark is still settling into it. */
const SNAP_QUIET_MS = 500;

function haversineKm(a: CityData, b: CityData): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function dayNumber(dateStr?: string): number | null {
  if (!dateStr || dateStr.includes('?')) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = Math.round((d.getTime() - JOURNEY_START.getTime()) / 86400000) + 1;
  return day >= 1 ? day : null; // a date before departure is a data typo, not a day
}

// =============================================================================
// Types
// =============================================================================

interface Stop {
  id: number;
  city: string;
  country: string;
  transport: string;
  startDate?: string;
  endDate?: string;
  note?: string;
}

interface CityData {
  ko: string;
  en: string;
  lat: number;
  lng: number;
  country: string;
}

interface CountryData {
  code: string;
  name: { en: string; ko: string; native: string };
  coordinates: { lat: number; lng: number };
  continent?: string;
}

// =============================================================================
// Hooks
// =============================================================================

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}

// =============================================================================
// Utility Functions
// =============================================================================

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function generatePath(stops: Stop[], cities: Record<string, CityData>, radius: number) {
  const points: {
    point: THREE.Vector3;
    transport: string;
    fromStopId: number;
    toStopId: number;
    segmentProgress: number;
  }[] = [];

  const routes = osrmRoutes as Record<string, number[][]>;

  for (let i = 0; i < stops.length - 1; i++) {
    const currentCity = cities[stops[i].city];
    const nextCity = cities[stops[i + 1].city];

    if (!currentCity || !nextCity) continue;

    const transport = stops[i + 1].transport;
    const routeKey = `${stops[i].city}\u2192${stops[i + 1].city}`;
    const osrmCoords = routes[routeKey];

    // Use OSRM route data for bus/train if available
    if (osrmCoords && osrmCoords.length > 2 && (transport === 'bus' || transport === 'train')) {
      for (let j = 0; j <= osrmCoords.length - 1; j++) {
        const t = j / (osrmCoords.length - 1);
        const [lng, lat] = osrmCoords[j];
        const point = latLngToVector3(lat, lng, radius);

        points.push({
          point,
          transport,
          fromStopId: stops[i].id,
          toStopId: stops[i + 1].id,
          segmentProgress: t,
        });
      }
    } else {
      // Fallback: lerp for flights, boats, treks, or missing OSRM data
      const start = latLngToVector3(currentCity.lat, currentCity.lng, radius);
      const end = latLngToVector3(nextCity.lat, nextCity.lng, radius);

      const segments = transport === 'flight' ? 80 : 30;
      for (let j = 0; j <= segments; j++) {
        const t = j / segments;
        const point = new THREE.Vector3().lerpVectors(start, end, t);

        if (transport === 'flight') {
          const arc = Math.sin(t * Math.PI) * 0.15;
          point.normalize().multiplyScalar(radius + arc);
        } else {
          point.normalize().multiplyScalar(radius);
        }

        points.push({
          point,
          transport,
          fromStopId: stops[i].id,
          toStopId: stops[i + 1].id,
          segmentProgress: t,
        });
      }
    }
  }

  return points;
}

// =============================================================================
// 3D Components
// =============================================================================

const TRANSPORT_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
> = {
  flight: Plane,
  bus: Bus,
  train: TrainFront,
  boat: Ship,
  trek: Mountain,
  start: Plane,
};

type PathPoint = {
  point: THREE.Vector3;
  transport: string;
  fromStopId: number;
  toStopId: number;
  segmentProgress: number;
};

type Leg = { fromStopId: number; toStopId: number; transport: string };

type Segment = { pts: THREE.Vector3[]; transport: string; start: number; end: number; leg: Leg };

/**
 * A city is a ring, flat and always facing you — the dot is the only solid
 * mark on the map. Where the dot has sat the ring is accent, the way the mark
 * in the header is once the dot has left it; where it has not yet been, the
 * ring is a hairline in ink. The current city wears no ring: the dot is there.
 *
 * The moment the dot leaves a city, that city's ring pops in from small — a
 * body pulling out of a socket, not a colour change.
 */
function CityRing({
  radius,
  state,
  hovered,
  ink,
}: {
  radius: number;
  state: 'past' | 'next';
  hovered: boolean;
  ink: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const spring = useRef({ s: 1, v: 0 });
  const wasNext = useRef(state === 'next');
  useEffect(() => {
    if (wasNext.current && state !== 'next') spring.current = { s: 0.45, v: 0 };
    wasNext.current = state === 'next';
  }, [state]);
  useFrame(() => {
    const sp = spring.current;
    if (!ref.current || (Math.abs(1 - sp.s) < 0.002 && Math.abs(sp.v) < 0.002)) return;
    sp.v += (1 - sp.s) * 0.22;
    sp.v *= 0.72;
    sp.s += sp.v;
    ref.current.scale.setScalar(sp.s);
  });
  const been = state !== 'next';
  const r = hovered ? radius * 1.3 : radius;
  const thick = been ? 0.24 : 0.16;
  return (
    <Billboard>
      <mesh ref={ref}>
        <ringGeometry args={[r * (1 - thick), r, 40]} />
        <meshBasicMaterial
          color={been ? ACCENT : ink}
          transparent
          opacity={hovered ? 1 : been ? 0.9 : 0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </Billboard>
  );
}

/** One segment per leg (stop -> stop), keeping its index range in `points`. */
function buildSegments(points: PathPoint[]): Segment[] {
  const result: Segment[] = [];
  let key = '';
  points.forEach((p, i) => {
    const k = `${p.fromStopId}-${p.toStopId}`;
    if (k !== key) {
      result.push({
        pts: [p.point],
        transport: p.transport,
        start: i,
        end: i,
        leg: { fromStopId: p.fromStopId, toStopId: p.toStopId, transport: p.transport },
      });
      key = k;
    } else {
      const seg = result[result.length - 1];
      seg.pts.push(p.point);
      seg.end = i;
    }
  });
  return result;
}

/**
 * The line a leg leaves behind is the line the mark drew while it was on it,
 * so it never changes on arrival. A flight leaves a finer, fainter one — a
 * fast thing high up leaves less of a trace than a bus does on a road.
 */
const trail = (transport: string, t: Tuning) =>
  transport === 'flight'
    ? { width: t.pastAir, opacity: t.pastAirOpacity }
    : { width: t.pastLand, opacity: t.pastLandOpacity };

/**
 * The same rule for a leg not yet walked. It used to be one width for
 * everything, so a flight ahead was drawn as heavily as a bus — the line
 * changed weight on arrival, which is exactly what the trail above promises
 * never to do.
 */
const trailAhead = (transport: string, t: Tuning) =>
  transport === 'flight' ? t.aheadAir : t.aheadLand;

const pathLength = (pts: THREE.Vector3[]) => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += pts[i].distanceTo(pts[i - 1]);
  return l;
};

/**
 * One leg of the route. Every leg is the same line whatever it was travelled
 * by — the dash-per-transport code was three kinds of noise on top of the
 * one thing that matters, which is where the line has been.
 *
 * A future leg can be `reveal`ed: on the opening the whole route is drawn out
 * of the dot, and this is how a leg knows how much of itself to show. The
 * length is fed to the dash pattern each frame rather than through React, so
 * a hundred and fifty legs do not re-render while the pen moves.
 */
function RouteLine({
  points,
  opacity,
  color,
  width = 1.5,
  underlay,
  onOver,
  onOut,
  reveal,
}: {
  points: THREE.Vector3[];
  opacity: number;
  color: string;
  width?: number;
  underlay?: string; // a wider line in the page colour beneath, so the route lifts off borders and dots
  onOver?: (e: ThreeEvent<PointerEvent>) => void;
  onOut?: () => void;
  reveal?: { ref: React.MutableRefObject<number>; start: number; end: number };
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  const len = useMemo(() => pathLength(points), [points]);
  useFrame(() => {
    if (!reveal || !ref.current?.material) return;
    const r = reveal.ref.current;
    const span = Math.max(1, reveal.end - reveal.start);
    const frac = r === Infinity ? 1 : Math.max(0, Math.min(1, (r - reveal.start) / span));
    ref.current.material.dashSize = Math.max(0.0001, frac * len);
    ref.current.material.gapSize = 1e6;
    ref.current.visible = frac > 0;
  });
  if (points.length < 2) return null;
  return (
    <>
      {underlay && (
        <Line
          points={points}
          color={underlay}
          lineWidth={width + 3}
          transparent
          opacity={0.92}
          depthWrite={false}
        />
      )}
      <Line
        ref={ref}
        points={points}
        color={color}
        lineWidth={width}
        transparent
        opacity={opacity}
        depthWrite={false}
        dashed={!!reveal}
        dashSize={reveal ? 0.0001 : 1}
        gapSize={reveal ? 1e6 : 0}
        dashScale={1}
        onPointerOver={onOver}
        onPointerOut={onOut}
      />
    </>
  );
}

/**
 * The opening: the route comes out of the dot, one leg at a time. Each leg runs
 * out with its own ease and the next starts as it lands — a beat per leg rather
 * than one even pour — with time shared by length so the long flights take
 * longer, floored so the short hops still register.
 */
function RevealDriver({
  segments,
  run,
  reveal: revealRef,
}: {
  segments: Segment[];
  run: boolean;
  reveal: React.MutableRefObject<number>;
}) {
  const st = useRef<{ i: number; t0: number; durs: number[] } | null>(null);
  useFrame(({ clock }) => {
    if (!run || revealRef.current === Infinity) return;
    const now = clock.elapsedTime * 1000;
    if (!st.current) {
      const lens = segments.map((sg) => pathLength(sg.pts));
      const total = lens.reduce((a, b) => a + b, 0) || 1;
      st.current = { i: 0, t0: now, durs: lens.map((l) => Math.max(14, (l / total) * 2600)) };
    }
    const s = st.current;
    while (s.i < segments.length) {
      const sg = segments[s.i];
      const k = Math.min(1, (now - s.t0) / s.durs[s.i]);
      const e = 1 - Math.pow(1 - k, 3);
      revealRef.current = sg.start + e * (sg.end - sg.start);
      if (k < 1) return;
      s.i += 1;
      s.t0 = now;
    }
    revealRef.current = Infinity;
  });
  return null;
}

function TravelPath({
  points,
  segments,
  progress,
  bg,
  past,
  ahead,
  aheadOpacity,
  reveal,
  hoveredLeg,
  onHoverLeg,
}: {
  points: PathPoint[];
  segments: Segment[];
  progress: number;
  bg: string;
  past: string;
  ahead: string;
  aheadOpacity: number;
  reveal: React.MutableRefObject<number>;
  hoveredLeg: Leg | null;
  onHoverLeg: (leg: Leg | null, at?: THREE.Vector3) => void;
}) {
  const idx = Math.min(Math.floor(points.length * progress), points.length - 1);
  // The travelled line is the one coloured thing on a monochrome map — and it
  // all stays, at one weight, however long ago it was walked. The shade comes
  // from the theme: the same orange sits differently on paper than on ink.
  const pastColor = past;

  // off the bench (`?tune=1`) these are the shipped numbers; on it, the sliders
  const tuned = useTuning();
  const t: Tuning = TUNE_ON ? tuned : { ...defaults('dark'), aheadColor: ahead, aheadOpacity };

  return (
    <>
      {segments.map((seg) => {
        const isHovered =
          hoveredLeg !== null &&
          hoveredLeg.fromStopId === seg.leg.fromStopId &&
          hoveredLeg.toStopId === seg.leg.toStopId;
        const hover = {
          onOver: (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            onHoverLeg(seg.leg, e.point);
          },
          onOut: () => onHoverLeg(null),
        };
        if (seg.end <= idx) {
          const w = trail(seg.transport, t);
          return (
            <RouteLine
              key={seg.start}
              points={seg.pts}
              color={pastColor}
              opacity={isHovered ? 1 : w.opacity}
              width={isHovered ? w.width + 0.75 : w.width}
              underlay={bg}
              {...hover}
            />
          );
        }
        if (seg.start >= idx) {
          return (
            <RouteLine
              key={seg.start}
              points={seg.pts}
              color={t.aheadColor}
              opacity={isHovered ? Math.min(1, t.aheadOpacity + 0.35) : t.aheadOpacity}
              width={trailAhead(seg.transport, t)}
              reveal={{ ref: reveal, start: seg.start, end: seg.end }}
              {...hover}
            />
          );
        }
        const split = idx - seg.start;
        return (
          <group key={seg.start}>
            <RouteLine
              points={seg.pts.slice(0, split + 1)}
              color={pastColor}
              opacity={trail(seg.transport, t).opacity}
              width={trail(seg.transport, t).width}
              underlay={bg}
              {...hover}
            />
            <RouteLine
              points={seg.pts.slice(split)}
              color={t.aheadColor}
              opacity={Math.min(1, t.aheadOpacity + 0.12)}
              width={trailAhead(seg.transport, t)}
              reveal={{ ref: reveal, start: seg.start + split, end: seg.end }}
            />
          </group>
        );
      })}
    </>
  );
}

// Progressive zoom logic:
// - Start: Gwangju(1) very zoomed in → Incheon(2) zooming out → flight = fully out
// - India 1st: Chennai(16)→Mumbai(22) zoom in, Mumbai(22)→Varanasi(28) zoom out, Sonoli(29)=snap out
// - Italy: Milan(51)→La Spezia(56) zoom in, back to Milan(62)=snap out
// 도시별 카메라 줌(0 = 완전히 축소, 2.2 = 최대 접근).
// 예전에는 stop id 기준으로 하드코딩돼 있었다. stop을 추가하거나 순서를 바꾸면
// 값이 통째로 다른 도시에 걸려 카메라가 엉뚱한 배율로 튀었다. 도시 이름을 키로 잡아
// 번호와 무관하게 만들고, 같은 도시를 다시 방문해도 배율이 흔들리지 않게 한다.
const CITY_ZOOM: Record<string, number> = {
  광주: 1.7,
  인천: 1.7,
  호치민: 0,
  다낭: 1,
  쿠알라룸푸르: 1,
  메단: 1.5,
  뚝뚝섬: 2,
  시엠립: 1.5,
  방콕: 2,
  비엔티안: 2,
  방비엥: 2,
  루앙프라방: 2,
  우돈타니: 2,
  첸나이: 1.3,
  퐁디셰리: 1.7,
  벵갈루루: 1.9,
  함피: 2,
  뭄바이: 2,
  아우랑가바드: 2,
  나그푸르: 1.7,
  자발푸르: 1.7,
  콜카타: 1.7,
  러크나우: 1.7,
  아그라: 1.8,
  뉴델리: 1.8,
  도쿄: 0,
  프라야그라지: 1.8,
  바라나시: 1.8,
  고라크푸르: 1.8,
  소놀리: 1.8,
  싯다르타나가르: 2.2,
  포카라: 2.2,
  안나푸르나: 2.2,
  카트만두: 2.2,
  박타푸르: 2.2,
  두바이: 1.3,
  아부다비: 2.2,
  샤르자: 2.2,
  카이로: 1.3,
  다합: 1.7,
  바르셀로나: 1.5,
  시체스: 2.2,
  몬세라트: 1.5,
  소피아: 2,
  베오그라드: 2,
  부다페스트: 2,
  레트샤그: 2,
  야블론카: 2,
  크라쿠프: 2,
  프라하: 2,
  베르가모: 1.8,
  밀라노: 1.8,
  토리노: 2.2,
  '오르타 호수': 2.2,
  칸노비오: 2.2,
  피사: 2.2,
  제노바: 2.2,
  포르토피노: 2.2,
  친퀘테레: 2.2,
  라스페치아: 2.2,
  브라: 2.2,
  사보나: 2.2,
  브뤼셀: 2,
  파리: 1.5,
  마드리드: 1.5,
  마라케쉬: 1.5,
  카사블랑카: 1.5,
  리스본: 1.5,
  신트라: 1.5,
  리우데자네이루: 1.1,
  부지오스: 2.0,
  아라이알두카부: 2.0,
  앙그라도스헤이스: 2.1,
  '일랴 그란지 섬': 2.2,
  파라티: 2.1,
  우바투바: 2,
  '사웅 세바스치앙': 2,
  카라구아타투바: 2,
  산토스: 2,
  상파울로: 1.7,
  쿠리치바: 1.7,
  나베간치스: 1.7,
  상조제: 2,
  봄비냐스: 1.9,
  플로리아노폴리스: 2,
  '과르다 두 엠바우': 2,
  가로파바: 2,
  임비투바: 2,
  라구나: 2,
  '이과수 폭포': 1.5,
  포사다스: 1.5,
  부에노스아이레스: 1.6,
  차스코무스: 2.0,
  몬테비데오: 1.6,
  산티아고: 1.3,
  발파라이소: 1.5,
  '바히아 잉글레사': 1.5,
  '산 페드로 데 아타카마': 2,
  '라구나 베르데': 2,
  '살바도르 달리 사막': 2,
  우유니: 2,
  포토시: 2,
  수크레: 2,
  엘알토: 2,
  코파카바나: 2,
  푸노: 2,
  줄리아카: 2,
  쿠스코: 2,
  마추픽추: 2,
  리마: 1.5,
  피우라: 1.7,
  국경: 1.7,
  쿠엔카: 1.8,
  '카하스 국립공원': 1.8,
  바뇨스: 1.8,
  푸힐리: 1.8,
  키토: 1.8,
  툴칸: 1.8,
  이피알레스: 1.8,
  파스토: 1.8,
  칼리: 1.5,
  메데진: 1.5,
  과타페: 1.5,
  카르타헤나: 1.7,
  바랑키야: 1,
  산타마르타: 1.7,
};

const STOP_CITY: Record<number, string> = Object.fromEntries(
  journeyData.stops.map((s) => [s.id, s.city])
);

function getProgressiveZoom(stopId: number): number {
  return CITY_ZOOM[STOP_CITY[stopId]] ?? 0;
}

function Camera({
  target,
  zoom,
  isUserInteracting,
  currentStopId,
}: {
  target: THREE.Vector3;
  zoom: number;
  isUserInteracting: boolean;
  currentStopId: number;
}) {
  const { camera } = useThree();
  const cameraTarget = useRef(new THREE.Vector3(-2.5, 3, -3.5));
  const initialized = useRef(false);

  useEffect(() => {
    // Skip auto-positioning when user is manually interacting
    if (isUserInteracting) return;

    // Initialize camera to face first position on mount
    if (!initialized.current && target.length() > 0) {
      const dir = target.clone().normalize();
      cameraTarget.current.copy(dir.multiplyScalar(5.5));
      initialized.current = true;
    }

    // Get progressive zoom based on current stop
    const progressiveZoom = getProgressiveZoom(currentStopId);

    // Combine base zoom with progressive zoom
    const effectiveZoom = Math.max(zoom, progressiveZoom);
    const distance = 5.5 - effectiveZoom * 1.5; // Range: 4.0 to 5.5

    const dir = target.clone().normalize();
    cameraTarget.current.copy(dir.multiplyScalar(distance));
  }, [target, zoom, isUserInteracting, currentStopId]);

  useFrame(() => {
    // Only auto-follow when not interacting
    if (!isUserInteracting) {
      camera.position.lerp(cameraTarget.current, 0.15);
    }
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function LegTooltip({
  leg,
  at,
  stops,
  cities,
}: {
  leg: Leg;
  at: THREE.Vector3;
  stops: Stop[];
  cities: Record<string, CityData>;
}) {
  const { language } = useI18n();
  const lang = language as 'ko' | 'en';
  const from = stops.find((s) => s.id === leg.fromStopId);
  const to = stops.find((s) => s.id === leg.toStopId);
  if (!from || !to) return null;
  const a = cities[from.city];
  const b = cities[to.city];
  const km = a && b ? Math.round(haversineKm(a, b)) : null;
  const transportLabel =
    (citiesData as { transport?: Record<string, { ko: string; en: string }> }).transport?.[
      leg.transport
    ]?.[lang] ?? leg.transport;
  const date =
    to.startDate && !to.startDate.includes('?') ? to.startDate.slice(5).replace('-', '.') : '';
  return (
    <Html position={at} center style={{ pointerEvents: 'none' }}>
      <div className="leg-tip">
        <span className="leg-tip__route">
          {a ? a[lang] : from.city} → {b ? b[lang] : to.city}
        </span>
        <span className="leg-tip__meta mono">
          {transportLabel}
          {km !== null ? ` · ${km.toLocaleString()} km` : ''}
          {date ? ` · ${date}` : ''}
        </span>
      </div>
    </Html>
  );
}

function Scene({
  progress,
  zoom,
  isUserInteracting,
  onInteraction,
  onCityClick,
  hoveredCity,
  onHoverCity,
  onSelectCity,
  theme,
  seat,
  ribbon,
  dotActive,
  reveal,
  revealRun,
}: {
  progress: number;
  zoom: number;
  isUserInteracting: boolean;
  onInteraction: () => void;
  onCityClick: (cityName: string) => void;
  hoveredCity: string | null;
  onHoverCity: (cityName: string | null) => void;
  onSelectCity: (cityName: string) => void;
  theme: Theme;
  seat: React.RefObject<HTMLSpanElement | null>;
  ribbon: React.RefObject<SVGPolygonElement | null>;
  dotActive: boolean;
  reveal: React.MutableRefObject<number>;
  revealRun: boolean;
}) {
  const INK = GLOBE[theme].ink;
  const BG = theme === 'light' ? '#fcfcfc' : '#0d0d0d';
  const [hoveredLeg, setHoveredLeg] = useState<{ leg: Leg; at: THREE.Vector3 } | null>(null);
  const onHoverLeg = useCallback((leg: Leg | null, at?: THREE.Vector3) => {
    setHoveredLeg(leg && at ? { leg, at: at.clone() } : null);
    document.body.style.cursor = leg ? 'crosshair' : '';
  }, []);
  const stops = journeyData.stops as Stop[];
  const cities = citiesData.cities as Record<string, CityData>;
  const { language } = useI18n();

  const path = useMemo(() => generatePath(stops, cities, 2.003), [stops, cities]);
  const segments = useMemo(() => buildSegments(path), [path]);

  const pathIdx = Math.min(Math.floor(progress * path.length), path.length - 1);

  const { position, displayStopId, fromStopId, segProgress } = useMemo(() => {
    const pt = path[pathIdx] || {
      point: new THREE.Vector3(0, 2, 0),
      transport: 'bus',
      fromStopId: 1,
      toStopId: 2,
      segmentProgress: 0,
    };
    // Show current stop when stationary (t < 0.15), destination when moving
    const showStopId = pt.segmentProgress < SEGMENT_THRESHOLD ? pt.fromStopId : pt.toStopId;
    return {
      position: pt.point,
      displayStopId: showStopId,
      fromStopId: pt.fromStopId,
      segProgress: pt.segmentProgress,
    };
  }, [path, pathIdx]);

  /*
   * What ring a city wears follows the dot's actual position, not the label
   * logic above (which names the destination as soon as a leg is 15% along).
   * A city the dot has sat on wears the accent ring it left behind; one it has
   * not reached yet wears a hairline; the one it is sitting on right now wears
   * nothing — the dot is there.
   */
  const fromStopIdx = useMemo(
    () => stops.findIndex((st) => st.id === fromStopId),
    [stops, fromStopId]
  );
  const resting = segProgress < 0.03;
  const ringFor = (cityName: string): 'past' | 'next' | 'none' => {
    const firstIdx = stops.findIndex(
      (st) => st.city === cityName && stops.indexOf(st) <= fromStopIdx
    );
    const satOn = firstIdx >= 0;
    if (!satOn) return 'next';
    if (resting && stops[fromStopIdx]?.city === cityName) return 'none';
    return 'past';
  };

  // Calculate current stop index from displayStopId
  const currentStopIdx = useMemo(() => {
    const stopIdx = stops.findIndex((s) => s.id === displayStopId);
    return Math.max(stopIdx, 0);
  }, [stops, displayStopId]);

  // Calculate zoom scale for markers (inverse of progressive zoom)
  const zoomScale = useMemo(() => {
    const progressiveZoom = getProgressiveZoom(displayStopId);
    // Convert zoom level to scale: higher zoom = smaller scale
    // 0 zoom = scale 1, 2 zoom = scale ~0.5
    return 1 + progressiveZoom * 0.5;
  }, [displayStopId]);

  // One marker per city. State: current, from (departure of the leg in progress), past, or next.
  const cityMarkers = useMemo(() => {
    const currentCityName = stops[currentStopIdx]?.city;
    const fromCityName = stops.find((st) => st.id === fromStopId)?.city;
    const seen = new Set<string>();
    const out: {
      city: string;
      position: THREE.Vector3;
      name: string;
      state: 'current' | 'from' | 'past' | 'next';
    }[] = [];
    stops.forEach((stop, idx) => {
      if (seen.has(stop.city)) return;
      seen.add(stop.city);
      const city = cities[stop.city];
      if (!city) return;
      const visitedIdx = stops.findIndex((st, k) => st.city === stop.city && k <= currentStopIdx);
      const state =
        stop.city === currentCityName
          ? 'current'
          : stop.city === fromCityName && fromStopId !== displayStopId
            ? 'from'
            : visitedIdx >= 0 || idx <= currentStopIdx
              ? 'past'
              : 'next';
      out.push({
        city: stop.city,
        position: latLngToVector3(city.lat, city.lng, 2.004),
        name: city[language as 'ko' | 'en'],
        state,
      });
    });
    return out;
  }, [stops, cities, currentStopIdx, language, fromStopId, displayStopId]);

  return (
    <>
      <TravelPath
        points={path}
        segments={segments}
        progress={progress}
        bg={BG}
        past={GLOBE[theme].routePast}
        ahead={
          // TEMP: ?t= 로 앞길 투명도 비교 (평가 후 제거)
          { T1: '#806249', T2: '#6f5540', LA: '#aa8d73', LB: '#987b60' }[
            new URLSearchParams(window.location.search).get('t') ?? ''
          ] ?? GLOBE[theme].routeAhead
        }
        aheadOpacity={GLOBE[theme].routeAheadOpacity}
        reveal={reveal}
        hoveredLeg={hoveredLeg?.leg ?? null}
        onHoverLeg={onHoverLeg}
      />
      <RevealDriver segments={segments} run={revealRun} reveal={reveal} />
      <HeadTracker
        path={path}
        progress={progress}
        seat={seat}
        ribbon={ribbon}
        active={dotActive}
        markerRadius={0.007 / Math.max(zoomScale, 0.5)}
      />
      {hoveredLeg && (
        <LegTooltip leg={hoveredLeg.leg} at={hoveredLeg.at} stops={stops} cities={cities} />
      )}

      {/* City markers: one per city, hover-linked with the rail */}
      {cityMarkers.map((m) => {
        const dotProduct = m.position.clone().normalize().dot(position.clone().normalize());
        if (dotProduct < -0.3) return null;
        const markerScale = 1 / Math.max(zoomScale, 0.5);
        const hovered = hoveredCity === m.city;
        const isCurrent = m.state === 'current';
        // the camera on the label belongs to this visit: a city passed through
        // twice can have a roll for one stop and nothing for the other
        const hasPhotos = isCurrent
          ? photosForStop(stops[currentStopIdx]?.id).length > 0
          : cityHasPhotos(m.city);
        // a city the dot has sat on wears a ring the dot's own size; one it has
        // not reached yet is a smaller hairline
        const ring = ringFor(m.city);
        const radius = ring === 'next' ? 0.005 : 0.007;
        const showLabel =
          hovered || isCurrent || m.state === 'from' || (m.state === 'past' && dotProduct > 0.9);
        return (
          <group key={m.city} position={m.position} scale={[markerScale, markerScale, markerScale]}>
            {/* the city the dot is sitting on has no mark of its own; every other city is a ring */}
            {ring !== 'none' && (
              <CityRing radius={radius} state={ring} hovered={hovered} ink={INK} />
            )}
            {/* hit area for hover / click */}
            <mesh
              onPointerOver={(e) => {
                e.stopPropagation();
                onHoverCity(m.city);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                onHoverCity(null);
                document.body.style.cursor = '';
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (isCurrent && hasPhotos) onCityClick(m.city);
                else onSelectCity(m.city);
              }}
            >
              <sphereGeometry args={[0.022, 8, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {showLabel && (
              <Html center style={{ pointerEvents: 'none' }}>
                <div
                  className={`city-label city-label--${m.state}${hovered ? ' is-hover' : ''}${isCurrent && hasPhotos ? ' city-label--link' : ''}`}
                  onClick={isCurrent && hasPhotos ? () => onCityClick(m.city) : undefined}
                >
                  {m.name}
                  {isCurrent && hasPhotos && (
                    <>
                      <CameraIcon size={11} strokeWidth={1.75} />
                      <span className="city-label__n mono">
                        {photosForStop(stops[currentStopIdx]?.id).length}
                      </span>
                    </>
                  )}
                </div>
              </Html>
            )}
          </group>
        );
      })}

      <PhotoMarkers
        currentStopIdx={currentStopIdx}
        stops={stops}
        cities={cities}
        cameraPosition={position}
        zoomScale={zoomScale}
        theme={theme}
      />
      <Camera
        target={position}
        zoom={zoom}
        isUserInteracting={isUserInteracting}
        currentStopId={displayStopId}
      />
      {(() => {
        const isMobile =
          typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
        return (
          <OrbitControls
            enableZoom={isMobile}
            enablePan={false}
            enableRotate={!isMobile}
            minDistance={1.5}
            maxDistance={8}
            zoomSpeed={0.5}
            autoRotate={!isUserInteracting && zoom < 0.2}
            autoRotateSpeed={0.15}
            onStart={onInteraction}
          />
        );
      })()}
    </>
  );
}

// =============================================================================
// UI Components
// =============================================================================

/**
 * The language switch names the one you are not reading in — "EN" while the
 * page is Korean — the way the portfolio and the blog do, rather than listing
 * both and underlining the current one. With more languages it would step
 * through them in order.
 */
function LanguageToggle() {
  const { language, setLanguage } = useI18n();
  const i = SUPPORTED_LANGUAGES.findIndex((l) => l.code === language);
  const next = SUPPORTED_LANGUAGES[(i + 1) % SUPPORTED_LANGUAGES.length];
  return (
    <button
      type="button"
      onClick={() => setLanguage(next.code as Language)}
      aria-label={next.nativeName}
      lang={next.code}
    >
      {next.code.toUpperCase()}
    </button>
  );
}
function VerticalTimeline({
  currentStopIndex,
  stops,
  onSelect,
  hoveredCity,
  onHover,
  sheet,
  open,
  onToggle,
}: {
  currentStopIndex: number;
  stops: Stop[];
  onSelect: (index: number) => void;
  hoveredCity: string | null;
  onHover: (cityName: string | null) => void;
  sheet: boolean; // phone: a collapsed one-row sheet above the scrubber, tap to expand
  open: boolean;
  onToggle: () => void;
}) {
  const { language } = useI18n();
  const cities = citiesData.cities as Record<string, CityData>;

  const visibleRange = 6;
  const startIdx = Math.max(0, currentStopIndex - visibleRange);
  const endIdx = Math.min(stops.length - 1, currentStopIndex + visibleRange);
  const visibleStops = stops.slice(startIdx, endIdx + 1);
  const centerOffset = currentStopIndex - startIdx;

  // "2016-09-15" -> "09.15"
  const formatDate = (dateStr?: string) => {
    if (!dateStr || dateStr.includes('?')) return '';
    const parts = dateStr.split('-');
    return `${parts[1]}.${parts[2]}`;
  };

  return (
    <nav
      className={`stop-rail${sheet ? ' stop-rail--sheet' : ''}${sheet && open ? ' is-open' : ''}`}
      aria-label="Stops"
      onClick={sheet && !open ? onToggle : undefined}
    >
      {sheet && (
        <button
          type="button"
          className="stop-rail__handle"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-expanded={open}
          aria-label={open ? 'Collapse stops' : 'Expand stops'}
        >
          <ChevronUp size={14} strokeWidth={1.75} />
        </button>
      )}
      <div
        className="stop-rail__list"
        style={{
          transform: `translateY(${-(centerOffset + 0.5) * TIMELINE_ITEM_HEIGHT}px)`,
        }}
      >
        {visibleStops.map((stop, idx) => {
          const actualIdx = startIdx + idx;
          const state =
            actualIdx === currentStopIndex
              ? 'current'
              : actualIdx < currentStopIndex
                ? 'past'
                : 'next';
          const city = cities[stop.city];
          const cityName = city ? city[language as 'ko' | 'en'] : stop.city;
          const Icon = TRANSPORT_ICONS[stop.transport] || Bus;
          return (
            <div
              key={stop.id}
              className={`timeline-stop timeline-stop--${state}${hoveredCity === stop.city ? ' is-hover' : ''}`}
              role="button"
              tabIndex={-1}
              onClick={() => {
                if (sheet && !open) return; // the sheet's own click opens it
                onSelect(actualIdx);
                if (sheet) onToggle();
              }}
              onMouseEnter={() => onHover(stop.city)}
              onMouseLeave={() => onHover(null)}
            >
              <span className="timeline-stop__icon" aria-hidden="true">
                <Icon size={13} strokeWidth={1.75} />
              </span>
              <span className="timeline-stop__city">{cityName}</span>
              <span className="timeline-stop__code mono">{stop.country}</span>
              <span className="timeline-stop__date mono">
                {formatDate(stop.startDate) || formatDate(stop.endDate)}
              </span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function StopMeta({ stop }: { stop: Stop }) {
  const { language } = useI18n();
  const cities = citiesData.cities as Record<string, CityData>;
  const city = cities[stop.city];
  const country = (countriesData as { countries: CountryData[] }).countries.find(
    (c) => c.code === stop.country
  );
  const day = dayNumber(stop.startDate) ?? dayNumber(stop.endDate);
  const lang = language as 'ko' | 'en';
  const cityName = city ? city[lang] : stop.city;
  const countryName = country ? country.name[lang] : stop.country;
  const coords = city
    ? `${Math.abs(city.lat).toFixed(2)}°${city.lat >= 0 ? 'N' : 'S'} ${Math.abs(city.lng).toFixed(2)}°${city.lng >= 0 ? 'E' : 'W'}`
    : '';

  return (
    <div className="stop-meta" aria-live="polite">
      <span className="stop-meta__day mono">{day !== null ? `DAY ${day}` : `STOP ${stop.id}`}</span>
      <span className="stop-meta__place" key={stop.id}>
        {cityName}, {countryName}
      </span>
      <span className="stop-meta__coords mono">{coords}</span>
    </div>
  );
}

function ThemeToggle() {
  const { language } = useI18n();
  const theme = useTheme();
  const toggle = useToggleTheme();
  const label = language === 'ko' ? '테마 전환' : 'Toggle theme';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={(e) => toggle(e.currentTarget.getBoundingClientRect())}
      aria-label={label}
      title={label}
    >
      {theme === 'dark' ? '○' : '●'}
    </button>
  );
}

function Header() {
  const { t } = useI18n();
  return (
    <header className="journey-header">
      <div className="journey-header__brand">
        <span className="journey-header__dot" data-dot-home aria-hidden="true" />
        <span>{t('journey.brand')}</span>
      </div>
      <span className="journey-header__period mono">{journeyPeriod}</span>
      <nav className="journey-header__nav mono" aria-label="Sites">
        <a href="https://po24lio.com">{t('nav.portfolio')}</a>
        <a href="https://blog.po24lio.com">{t('nav.blog')}</a>
        <LanguageToggle />
        <span className="journey-header__sep" aria-hidden="true" />
      </nav>
      <ThemeToggle />
    </header>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function JourneyExperienceContent() {
  const { language } = useI18n();
  const theme = useTheme();
  const [progress, setProgress] = useState(0);
  const [railOpen, setRailOpen] = useState(false);

  // The scene follows `progress` on a critically damped spring, so scrubbing and keys glide
  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [eased, setEased] = useState(0);
  const springRef = useRef({ x: 0, v: 0, last: 0 });
  const smoothProgress = reducedMotion ? progress : eased;
  useEffect(() => {
    if (reducedMotion) return;
    let raf = 0;
    const K = 170; // stiffness
    const D = 2 * Math.sqrt(K); // critical damping
    springRef.current.last = performance.now();
    const tick = (now: number) => {
      const sp = springRef.current;
      const dt = Math.min(0.05, (now - sp.last) / 1000);
      sp.last = now;
      const a = (progress - sp.x) * K - sp.v * D;
      sp.v += a * dt;
      sp.x += sp.v * dt;
      if (Math.abs(progress - sp.x) < 0.00002 && Math.abs(sp.v) < 0.0005) {
        sp.x = progress;
        sp.v = 0;
        setEased(progress);
        return;
      }
      setEased(sp.x);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress, reducedMotion]);
  const [zoom, setZoom] = useState(0);
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [sheetFirst, setSheetFirst] = useState(false);
  const [focusStopId, setFocusStopId] = useState<number | null>(null);
  const [initialPhotoId, setInitialPhotoId] = useState<string | null>(null);
  const interactionTimeoutRef = useRef<number | null>(null);

  const stops = journeyData.stops as Stop[];
  const cities = citiesData.cities as Record<string, CityData>;

  // Pre-generate path to calculate accurate current stop
  const path = useMemo(() => generatePath(stops, cities, 2.02), [stops, cities]);

  // Calculate current stop to display
  const currentStop = useMemo(() => {
    const pathIdx = Math.min(Math.floor(progress * path.length), path.length - 1);
    const pt = path[pathIdx];
    if (!pt) return 0;

    // Show current stop when stationary (t < 0.15), destination when moving
    const showStopId = pt.segmentProgress < SEGMENT_THRESHOLD ? pt.fromStopId : pt.toStopId;
    const stopIdx = stops.findIndex((s) => s.id === showStopId);
    return Math.max(stopIdx, 0);
  }, [path, progress, stops]);

  const city = stops[currentStop];
  const currentCountry = city?.country || 'KR';

  // Current position back in lat/lng (inverse of latLngToVector3) for the minimap
  const currentLatLng = useMemo(() => {
    const idx = Math.min(Math.floor(smoothProgress * path.length), path.length - 1);
    const pt = path[idx]?.point;
    if (!pt) return { lat: 35.16, lng: 126.85 };
    const r = pt.length();
    const lat = 90 - (Math.acos(pt.y / r) * 180) / Math.PI;
    let lng = (Math.atan2(pt.z, -pt.x) * 180) / Math.PI - 180;
    if (lng < -180) lng += 360;
    return { lat, lng };
  }, [path, smoothProgress]);

  // Where each stop begins on the 0..1 progress line (last stop = end of the path)
  const stopProgress = useMemo(
    () =>
      stops.map((s, i) => {
        if (i === stops.length - 1) return 1;
        const idx = path.findIndex((pt) => pt.fromStopId === s.id && pt.segmentProgress < 0.05);
        return idx < 0 ? 0 : idx / path.length;
      }),
    [stops, path]
  );

  /** When the hand last turned the wheel. A control that moves the page clears it. */
  const wheelAtRef = useRef(0);

  // Every control (scrubber, rail, keys, autoplay) moves the page scroll; `progress` derives from it
  const seek = useCallback((p: number, mode: 'drag' | 'jump') => {
    // a control already chose where this stops, so the rest-snap below stays out of it
    wheelAtRef.current = 0;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({
      top: Math.max(0, Math.min(1, p)) * maxScroll,
      behavior: mode === 'drag' ? 'auto' : 'smooth',
    });
  }, []);

  const [playing, setPlaying] = useState(false);
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);

  const goToStop = useCallback(
    (idx: number) => seek(stopProgress[Math.max(0, Math.min(stops.length - 1, idx))], 'jump'),
    [seek, stopProgress, stops.length]
  );

  // Jump to a city: the stop of that city nearest to where we are now
  const goToCity = useCallback(
    (cityName: string) => {
      let best = -1;
      let bestD = Infinity;
      stops.forEach((st, i) => {
        if (st.city !== cityName) return;
        const d = Math.abs(i - currentStop);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        setPlaying(false);
        goToStop(best);
      }
    },
    [stops, currentStop, goToStop]
  );

  // Autoplay: one stop per beat, a longer beat for flights; any manual scroll stops it
  useEffect(() => {
    if (!playing) return;
    const atEnd = currentStop >= stops.length - 1;
    const next = stops[currentStop + 1];
    const beat = next?.transport === 'flight' ? 2000 : 1200;
    const t = window.setTimeout(
      () => (atEnd ? setPlaying(false) : goToStop(currentStop + 1)),
      atEnd ? 0 : beat
    );
    const stop = () => setPlaying(false);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
    };
  }, [playing, currentStop, stops, goToStop]);

  // Keyboard: ← → stops, Space play/pause, Esc closes the gallery
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
      if (selectedCity !== null) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        goToStop(currentStop + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPlaying(false);
        goToStop(currentStop - 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentStop, goToStop, selectedCity]);

  // Countries the journey has reached so far (lights their land dots on the globe)
  const visitedCountries = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i <= currentStop; i++) set.add(stops[i].country);
    return set;
  }, [stops, currentStop]);

  // Handle user interaction - pause auto-follow for 3 seconds
  const handleUserInteraction = () => {
    setIsUserInteracting(true);

    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }

    interactionTimeoutRef.current = window.setTimeout(() => {
      setIsUserInteracting(false);
    }, 3000);
  };

  // From the camera on the city label: this visit's whole roll, as a contact
  // sheet. Both cameras on the globe open the same way — one is the place, the
  // other is the city — and a camera is a thing you expect to hand you all of
  // them. The filmstrip is the other door: it opens on the frame you clicked.
  const handleCityClick = (cityName: string) => {
    setSelectedCity(cityName);
    setInitialPhotoId(null);
    setFocusStopId(city?.id ?? null);
    setSheetFirst(true);
  };

  // From the filmstrip: the city's whole book, opened on the frame clicked.
  // The seam keeps the stays apart, so paging on lands in the next one rather
  // than in a shuffle of both.
  const handleOpenPhoto = (cityName: string, photoId: string) => {
    setSelectedCity(cityName);
    setInitialPhotoId(photoId);
    setFocusStopId(city?.id ?? null);
    setSheetFirst(false);
  };

  /* ── the opening ─────────────────────────────────────────────────────────
     Fresh at the top of the page, the mark in the header leaves for the globe,
     lands on the first stop, and the route comes out of it. Anyone who arrived
     scrolled, deep-linked, or asking for less motion gets the page as it is. */
  const seatRef = useRef<HTMLSpanElement>(null);
  const ribbonRef = useRef<SVGPolygonElement>(null);
  const openingWanted = () =>
    typeof window !== 'undefined' &&
    window.scrollY < 8 &&
    !new URLSearchParams(window.location.search).get('stop') &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealRef = useRef<number>(openingWanted() ? 0 : Infinity);
  const [dotOut, setDotOut] = useState(() => !openingWanted());
  const [revealRun, setRevealRun] = useState(false);
  useEffect(() => {
    if (dotOut) return;
    const leave = window.setTimeout(() => setDotOut(true), 700); // the mark leaves the header
    const draw = window.setTimeout(() => setRevealRun(true), 700 + 560 + 420); // landed; the route comes out of it
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the last stop: the dot leaves the globe to write the closing block
  const finale = currentStop === stops.length - 1 && selectedCity === null;

  // the stop the reader has actually come to rest on, a beat after they stop
  const settledStop = useSettledStop(currentStop, progress);

  const handleCloseGallery = useCallback(() => {
    setSelectedCity(null);
    setInitialPhotoId(null);
    setSheetFirst(false);
    setFocusStopId(null);
  }, []);

  // Deep link: /?stop=53 opens the journey at that stop
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('stop'));
    if (!id) return;
    const idx = path.findIndex((pt) => pt.fromStopId === id && pt.segmentProgress < 0.05);
    if (idx < 0) return;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: (idx / path.length) * maxScroll });
  }, [path]);

  useEffect(() => {
    let rafId: number | null = null;
    let lastScrollTime = 0;
    const throttleMs = 16; // 60fps

    const onScroll = () => {
      // Don't update globe when gallery is open
      if (selectedCity !== null) return;

      const now = Date.now();
      if (now - lastScrollTime < throttleMs) {
        // Too soon, skip this event
        return;
      }
      lastScrollTime = now;

      // Cancel any pending RAF
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      // Schedule update on next animation frame
      rafId = requestAnimationFrame(() => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        const p = Math.max(0, Math.min(1, window.scrollY / h));
        setProgress(p);
        setZoom(p < 0.05 ? 0 : Math.min((p - 0.05) / 0.2, 1));
        // Reset user interaction on scroll
        setIsUserInteracting(false);
        rafId = null;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (interactionTimeoutRef.current) {
        clearTimeout(interactionTimeoutRef.current);
      }
    };
  }, [selectedCity]);

  // Mobile fullscreen swipe handling - using refs for non-passive event listeners
  const touchStartY = useRef<number | null>(null);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Store path and progress in refs for use in event handlers
  const pathRef = useRef(path);
  const progressRef = useRef(progress);
  const currentStopRef = useRef(currentStop);
  const stopsRef = useRef(stops);
  const selectedCityRef = useRef<string | null>(null);

  useEffect(() => {
    pathRef.current = path;
    progressRef.current = progress;
    currentStopRef.current = currentStop;
    stopsRef.current = stops;
    selectedCityRef.current = selectedCity;
  }, [path, progress, currentStop, stops, selectedCity]);

  // Detect mobile for touch-action - using hook for proper reactivity
  const isMobile = useIsMobile();

  /**
   * Where a scroll comes to rest.
   *
   * A hand that stops a little short leaves the globe mid-leg, the ribbon half
   * drawn and the city with nothing to say. So once the hand and its momentum
   * are both done, a stop near enough gets the rest of the way: the page scroll
   * glides there, and the mark stretches into it and lands, the same travel as
   * any other — the snap is not drawn, it is the mark doing what it always does.
   *
   * Nothing is taken while the hand is on it. This only ever runs from rest, and
   * the first turn of the wheel or press of a pointer drops it where it is.
   *
   * Only for a wheel or a trackpad. The phone lands on a stop of its own (the
   * touch handlers below), and a reader asking for less motion gets the page
   * left exactly where they put it.
   */
  useEffect(() => {
    if (reducedMotion || isMobile) return;

    let restTimer = 0;
    let quietTimer = 0;
    let raf = 0;
    let gliding = false;
    let held = false;

    /**
     * `cancelled` is the difference between the hand coming back and the glide
     * simply arriving. Either way the page stops being put down. But a glide the
     * hand interrupted is no longer a correction — whatever the mark does next is
     * its own — while one that arrived has to keep saying so until the mark has
     * actually settled, which is a few hundred milliseconds after the last pixel
     * of scroll, once the spring behind it has caught up.
     */
    const stopGlide = (cancelled: boolean) => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      gliding = false;
      const seat = seatRef.current;
      seat?.removeAttribute('data-dot-gliding');
      window.clearTimeout(quietTimer);
      if (cancelled) {
        seat?.removeAttribute('data-dot-correcting');
      } else if (seat?.hasAttribute('data-dot-correcting')) {
        quietTimer = window.setTimeout(
          () => seat.removeAttribute('data-dot-correcting'),
          SNAP_QUIET_MS
        );
      }
    };
    const drop = () => stopGlide(true);

    const glide = (to: number, maxScroll: number) => {
      const from = window.scrollY;
      const target = Math.max(0, Math.min(maxScroll, to * maxScroll));
      const t0 = performance.now();
      gliding = true;

      // If the mark is still drawn out it is still travelling, and the glide is
      // simply the tail of that journey — it lands once, at the city. If it has
      // already come to rest the page is being tidied up behind the reader, and
      // the mark is told to arrive without a second landing.
      const seat = seatRef.current;
      if (seat) {
        seat.setAttribute('data-dot-gliding', '');
        if (seat.getAttribute('data-dot-carry') !== 'ribbon') {
          seat.setAttribute('data-dot-correcting', '');
        }
      }
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / SNAP_MS);
        window.scrollTo(0, from + (target - from) * (1 - Math.pow(1 - t, 3)));
        if (t < 1) {
          raf = requestAnimationFrame(step);
          return;
        }
        stopGlide(false);
      };
      raf = requestAnimationFrame(step);
    };

    const settle = () => {
      if (gliding || held || playing || selectedCity !== null) return;
      // a page that moved on its own already chose where to stop
      if (performance.now() - wheelAtRef.current > SNAP_HAND_MS) return;

      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= 0) return;
      const p = window.scrollY / maxScroll;

      let best = -1;
      let bestD = Infinity;
      stopProgress.forEach((sp, i) => {
        const d = Math.abs(sp - p);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0 || bestD * maxScroll < SNAP_MIN_PX) return;

      // near enough is measured against the leg being stood on, not the route:
      // legs run 0.498 to 1.300 viewports, and a share of each keeps the reach
      // the same wherever you are
      const fromIdx = stopProgress[best] > p ? best - 1 : best;
      const leg = Math.abs((stopProgress[fromIdx + 1] ?? 1) - (stopProgress[fromIdx] ?? 0));
      if (!leg || bestD > SNAP_ZONE * leg) return;

      glide(stopProgress[best], maxScroll);
    };

    const rest = () => {
      window.clearTimeout(restTimer);
      restTimer = window.setTimeout(settle, SNAP_REST_MS);
    };

    const onScroll = () => {
      if (gliding) return;
      rest();
    };
    const onWheel = () => {
      wheelAtRef.current = performance.now();
      drop();
      rest();
    };
    const onDown = () => {
      held = true;
      drop();
      window.clearTimeout(restTimer);
    };
    const onUp = () => {
      held = false;
      rest();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    return () => {
      window.clearTimeout(restTimer);
      window.clearTimeout(quietTimer);
      drop();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [reducedMotion, isMobile, playing, selectedCity, stopProgress]);

  // Setup non-passive touch event listeners
  useEffect(() => {
    if (!isMobile || !containerRef.current) return;

    const container = containerRef.current;

    const handleTouchStart = (e: TouchEvent) => {
      // Don't handle touch if gallery is open
      if (selectedCityRef.current !== null) return;

      if (e.touches.length === 1) {
        touchStartY.current = e.touches[0].clientY;
        isDragging.current = true;
      } else {
        isDragging.current = false;
        touchStartY.current = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      // Don't handle touch if gallery is open - let gallery handle it naturally
      if (selectedCityRef.current !== null) {
        return; // Gallery is open, don't interfere with its scrolling
      }

      // Only prevent default when gallery is closed and we're handling journey navigation
      if (isDragging.current && e.touches.length === 1) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      // Don't handle swipe if gallery is open
      if (selectedCityRef.current !== null) return;

      if (!isDragging.current || touchStartY.current === null) return;

      const touchEndY = e.changedTouches[0].clientY;
      const deltaY = touchStartY.current - touchEndY;
      const swipeThreshold = 40;

      const path = pathRef.current;
      const progress = progressRef.current;
      const currentStop = currentStopRef.current;
      const stops = stopsRef.current;

      const currentPathIdx = Math.min(Math.floor(progress * path.length), path.length - 1);
      const currentPt = path[currentPathIdx];

      let targetPathIndex = currentPathIdx;

      if (deltaY > swipeThreshold) {
        // Swiped UP = go FORWARD
        const isMidFlight =
          currentPt &&
          currentPt.transport === 'flight' &&
          currentPt.segmentProgress > 0.2 &&
          currentPt.segmentProgress < 0.8;

        if (isMidFlight) {
          for (let i = currentPathIdx; i < path.length; i++) {
            const pt = path[i];
            if (pt.fromStopId === currentPt.toStopId && pt.segmentProgress < 0.05) {
              targetPathIndex = i;
              break;
            }
            if (pt.toStopId === currentPt.toStopId && pt.segmentProgress > 0.95) {
              targetPathIndex = i;
            }
          }
        } else {
          const nextStopIndex = Math.min(currentStop + 1, stops.length - 1);
          const nextStop = stops[nextStopIndex];
          const isNextFlight = nextStop?.transport === 'flight';

          if (isNextFlight) {
            for (let i = currentPathIdx; i < path.length; i++) {
              const pt = path[i];
              if (
                pt.toStopId === nextStop.id &&
                pt.segmentProgress >= 0.45 &&
                pt.segmentProgress <= 0.55
              ) {
                targetPathIndex = i;
                break;
              }
            }
          } else {
            const targetStopIndex = nextStopIndex;
            const targetStopId = stops[targetStopIndex]?.id;
            const isLastStop = targetStopIndex === stops.length - 1;

            if (isLastStop) {
              for (let i = path.length - 1; i >= 0; i--) {
                if (path[i].toStopId === targetStopId) {
                  targetPathIndex = i;
                  break;
                }
              }
            } else {
              for (let i = 0; i < path.length; i++) {
                const pt = path[i];
                if (pt.fromStopId === targetStopId && pt.segmentProgress < 0.05) {
                  targetPathIndex = i;
                  break;
                }
              }
            }
          }
        }
      } else if (deltaY < -swipeThreshold) {
        // Swiped DOWN = go BACKWARD
        const isMidFlight =
          currentPt &&
          currentPt.transport === 'flight' &&
          currentPt.segmentProgress > 0.2 &&
          currentPt.segmentProgress < 0.8;

        if (isMidFlight) {
          const departureStopId = currentPt.fromStopId;
          for (let i = 0; i < path.length; i++) {
            const pt = path[i];
            if (pt.fromStopId === departureStopId && pt.segmentProgress < 0.05) {
              targetPathIndex = i;
              break;
            }
          }
        } else {
          const prevStopIndex = Math.max(currentStop - 1, 0);
          const currentStopData = stops[currentStop];
          const wasPrevFlight = currentStopData?.transport === 'flight';

          if (wasPrevFlight && currentStop > 0) {
            for (let i = currentPathIdx; i >= 0; i--) {
              const pt = path[i];
              if (
                pt.toStopId === currentStopData.id &&
                pt.segmentProgress >= 0.45 &&
                pt.segmentProgress <= 0.55
              ) {
                targetPathIndex = i;
                break;
              }
            }
          } else {
            const targetStopIndex = prevStopIndex;
            const targetStopId = stops[targetStopIndex]?.id;

            for (let i = 0; i < path.length; i++) {
              const pt = path[i];
              if (pt.fromStopId === targetStopId && pt.segmentProgress < 0.05) {
                targetPathIndex = i;
                break;
              }
            }
          }
        }
      }

      const targetProgress = targetPathIndex / path.length;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const targetScrollY = targetProgress * maxScroll;

      window.scrollTo({
        top: targetScrollY,
        behavior: 'smooth',
      });

      isDragging.current = false;
      touchStartY.current = null;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isMobile]);

  return (
    <div
      ref={containerRef}
      className="journey-experience"
      style={isMobile ? { touchAction: 'none' } : undefined}
    >
      <div className="scroll-spacer" style={{ height: `${stops.length * 100}vh` }} />

      <div className="canvas-container">
        <Canvas camera={{ position: [-2.5, 3, -3.5], fov: 45 }} gl={{ antialias: true }}>
          <Scene
            progress={smoothProgress}
            zoom={zoom}
            isUserInteracting={isUserInteracting}
            onInteraction={handleUserInteraction}
            onCityClick={handleCityClick}
            hoveredCity={hoveredCity}
            onHoverCity={setHoveredCity}
            onSelectCity={goToCity}
            theme={theme}
            seat={seatRef}
            ribbon={ribbonRef}
            dotActive={dotOut && selectedCity === null && !finale}
            reveal={revealRef}
            revealRun={revealRun}
          />
          <DotGlobe countryCode={currentCountry} visitedCodes={visitedCountries} theme={theme} />
          <WorldBorders countryCode={currentCountry} theme={theme} />
        </Canvas>
      </div>

      <Header />

      <VerticalTimeline
        currentStopIndex={currentStop}
        stops={stops}
        onSelect={(i) => {
          setPlaying(false);
          goToStop(i);
        }}
        hoveredCity={hoveredCity}
        onHover={setHoveredCity}
        sheet={isMobile}
        open={railOpen}
        onToggle={() => setRailOpen((v) => !v)}
      />
      {city && <StopMeta stop={city} />}
      {city && (
        <Filmstrip
          cityName={city.city}
          stopId={city.id}
          language={language as 'ko' | 'en'}
          onOpen={handleOpenPhoto}
        />
      )}
      <Minimap
        stops={stops}
        cities={cities}
        currentStopIdx={currentStop}
        lat={currentLatLng.lat}
        lng={currentLatLng.lng}
        onSelect={(i) => {
          setPlaying(false);
          goToStop(i);
        }}
      />
      <Scrubber
        stops={stops}
        stopProgress={stopProgress}
        progress={progress}
        currentStopIdx={currentStop}
        cityName={cities[city?.city]?.[language as 'ko' | 'en'] ?? city?.city ?? ''}
        countryName={
          (countriesData as { countries: CountryData[] }).countries.find(
            (c) => c.code === currentCountry
          )?.name[language as 'ko' | 'en'] ?? currentCountry
        }
        playing={playing}
        onSeek={(p, mode) => {
          setPlaying(false);
          seek(p, mode);
        }}
        onTogglePlay={() => setPlaying((v) => !v)}
      />

      {/* About section at starting point */}
      <AboutOverlay visible={currentStop === 0 && progress < 0.03} />
      {TUNE_ON && <RouteTuner theme={theme} />}
      {/* What a city has to say — only once the journey has actually stopped
          there. Scrubbing past a dozen of them says nothing. */}
      {city && (
        <StopNote
          stopId={city.id}
          city={cities[city.city]?.[language as 'ko' | 'en'] ?? city.city}
          startDate={city.startDate ?? ''}
          visible={
            settledStop === currentStop && currentStop !== 0 && !finale && selectedCity === null
          }
        />
      )}
      {/* And the last word, back where it started — written by the dot itself */}
      <FinaleOverlay visible={finale} />

      {/* One dot for the whole site. Its home is the mark in the header; it
          rides the head of the route on the globe, and flies into the photo
          book when one opens. */}
      <JourneyDotOverlay
        seat={seatRef}
        ribbon={ribbonRef}
        active={dotOut && selectedCity === null && !finale}
      />
      <TravelingDot />

      {/* Photo gallery overlay */}
      <PhotoGallery
        cityName={selectedCity}
        initialPhotoId={initialPhotoId}
        initialSheet={sheetFirst}
        focusStopId={focusStopId}
        onClose={handleCloseGallery}
      />
    </div>
  );
}

export default function JourneyExperience() {
  return (
    <I18nProvider>
      <JourneyExperienceContent />
    </I18nProvider>
  );
}
