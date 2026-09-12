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
import { HeadTracker, JourneyDotOverlay, NoteSideProbe } from './JourneyDot';
import { CursorHint, Kbd } from './FirstStep';
import { ZOOM_DEFAULTS, legProfile, lookAlong, restZoomsByCountry, zoomAlong } from './cityZoom';
import { CityBounds, PlaceGlyph } from './CityBounds';
import { PLACE_GLYPH } from './placeGlyphs';
import { useOutlines } from './cityOutlines';
import { useFirstMove, useLean } from './useFirstStep';
import { photosForStop, cityHasPhotos } from '../../lib/visitPhotos';
import { DotGlobe } from './DotGlobe';
import { WorldBorders } from './WorldBorders';
import { Scrubber } from './Scrubber';
import { Minimap } from './Minimap';
import { CountryInset } from './CountryInset';
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
  been: beenColor,
  handoff,
}: {
  radius: number;
  state: 'past' | 'next';
  hovered: boolean;
  ink: string;
  /** the colour of the line already walked — the ring a visited city wears is that line's */
  been: string;
  /**
   * The city's outline, when it has one. As the camera comes close enough for
   * the outline to be read, the ring opens out to the outline's size and
   * fades, and the outline takes over inside it (see CityBounds).
   */
  handoff?: {
    blend: React.MutableRefObject<Map<string, number>>;
    city: string;
    /** the outline's reach in world units, and the marker group's scale, to meet it */
    reach: number;
    markerScale: number;
  };
}) {
  const ref = useRef<THREE.Mesh>(null);
  const spring = useRef({ s: 1, v: 0 });
  const wasNext = useRef(state === 'next');
  useEffect(() => {
    if (wasNext.current && state !== 'next') spring.current = { s: 0.45, v: 0 };
    wasNext.current = state === 'next';
  }, [state]);
  const been = state !== 'next';
  const r = hovered ? radius * 1.3 : radius;
  const baseOpacity = hovered ? 1 : been ? 0.9 : 0.35;
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const sp = spring.current;
    if (Math.abs(1 - sp.s) >= 0.002 || Math.abs(sp.v) >= 0.002) {
      sp.v += (1 - sp.s) * 0.22;
      sp.v *= 0.72;
      sp.s += sp.v;
    }
    const k = handoff ? (handoff.blend.current.get(handoff.city) ?? 0) : 0;
    // opening out: the ring grows to where the outline's edge is, thinning as
    // it goes, so the outline arrives inside a ring that has become its size
    const meet = handoff ? handoff.reach / handoff.markerScale / r : 1;
    mesh.scale.setScalar(sp.s * (1 + (meet - 1) * k));
    (mesh.material as THREE.MeshBasicMaterial).opacity = baseOpacity * (1 - k) * (1 - k);
  });
  const thick = been ? 0.24 : 0.16;
  return (
    <Billboard>
      <mesh ref={ref}>
        <ringGeometry args={[r * (1 - thick), r, 40]} />
        <meshBasicMaterial
          color={been ? beenColor : ink}
          transparent
          opacity={baseOpacity}
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
 * Where the route sits in the paint, above the map and above its own backing.
 *
 * Both the backing and the line are transparent, and three.js sorts transparent
 * objects by how far they are from the camera. On a globe every leg is the same
 * distance away to within rounding, so that order is a coin toss that lands
 * differently depending on where the camera came from — and a backing that
 * lands after its neighbour's line paints the page colour straight over it. A
 * route that was there before a jump would simply be gone after one, and only
 * ever going backwards, because that is when the camera arrives from the far
 * side. Saying the order out loud costs nothing and settles it.
 */
const UNDERLAY_ORDER = 1;
const ROUTE_ORDER = 2;

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
          renderOrder={UNDERLAY_ORDER}
        />
      )}
      <Line
        ref={ref}
        points={points}
        color={color}
        lineWidth={width}
        renderOrder={ROUTE_ORDER}
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
  theme,
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
  theme: Theme;
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
  const t: Tuning = TUNE_ON ? tuned : { ...defaults(theme), aheadColor: ahead, aheadOpacity };

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

function Camera({
  target,
  zoom,
  isUserInteracting,
  progressiveZoom,
  unhurried = false,
}: {
  target: THREE.Vector3;
  zoom: number;
  isUserInteracting: boolean;
  /** the city's own zoom, already eased along the leg — never a step */
  progressiveZoom: number;
  /** a flight across the world turns the globe slowly, not at a scroll's pace */
  unhurried?: boolean;
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

    // Combine base zoom with progressive zoom
    const effectiveZoom = Math.max(zoom, progressiveZoom);
    const distance = 5.5 - effectiveZoom * 1.5; // Range: 4.0 to 5.5

    const dir = target.clone().normalize();
    cameraTarget.current.copy(dir.multiplyScalar(distance));
  }, [target, zoom, isUserInteracting, progressiveZoom]);

  useFrame(() => {
    // Only auto-follow when not interacting. The turn towards a city and the
    // change of distance are eased apart: the turn is quick, the distance is
    // slow — a zoom that takes its time is a zoom the stomach does not notice.
    if (!isUserInteracting) {
      const wantDist = cameraTarget.current.length();
      const dist = camera.position.length() + (wantDist - camera.position.length()) * 0.05;
      camera.position.lerp(cameraTarget.current, unhurried ? 0.045 : 0.15).setLength(dist);
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

/**
 * How close the camera stands comes from the journey's own distances (see
 * cityZoom.ts): each stop rests at a zoom, each leg is travelled at its own, and
 * between them the value runs level–out–in–level, never a step.
 *
 * Two things ask: the camera, which points itself with it, and the country inset,
 * which asks whether the country would fit on the screen at that height. They
 * have to get the same answer — including under `?tune=1`, where the bench is
 * moving the numbers around.
 */
function useRestZooms(stops: Stop[], cities: Record<string, CityData>) {
  const tuned = useTuning();
  const zoomParams = useMemo(
    () =>
      TUNE_ON
        ? {
            zMax: tuned.zMax,
            zMin: tuned.zMin,
            slope: tuned.zSlope,
            near: tuned.zNear,
            hold: tuned.zHold,
          }
        : ZOOM_DEFAULTS,
    [tuned.zMax, tuned.zMin, tuned.zSlope, tuned.zNear, tuned.zHold]
  );
  const legsKm = useMemo(
    () => stops.slice(1).map((st, i) => haversineKm(cities[stops[i].city], cities[st.city])),
    [stops, cities]
  );
  const rest = useMemo(
    () =>
      restZoomsByCountry(
        stops.map((st) => ({ ...cities[st.city], country: st.country })),
        legsKm,
        zoomParams
      ),
    [stops, cities, legsKm, zoomParams]
  );
  return { zoomParams, legsKm, rest };
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
  noteStop,
  onNoteSide,
  lean,
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
  /** the stop whose note is about to be written, or null */
  noteStop: number | null;
  onNoteSide: (side: 'below' | 'above') => void;
  /** the first-step hint: how far up the first leg the dot leans right now */
  lean: React.RefObject<number>;
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
  const tuned = useTuning();
  const widths = TUNE_ON ? tuned : defaults(theme);
  // every city that is a shape on the map, and how far each has handed over
  // from its ring to that shape this frame
  const outlines = useOutlines(cities);
  const blendRef = useRef(new Map<string, number>());
  // how many path steps the first leg is — what the dot leans along
  const firstLeg = useMemo(() => {
    const i = path.findIndex((p) => p.fromStopId === stops[1]?.id);
    return i < 0 ? 0 : i;
  }, [path, stops]);

  // rounded, not floored: a glide lands on whole pixels, and a scroll a hair
  // short of a stop must still count as that stop, not the last point of the
  // leg before it — that left the city it had arrived at drawn as not yet
  const pathIdx = Math.min(Math.round(progress * path.length), path.length - 1);

  const { position, displayStopId, fromStopId, toStopId, segProgress } = useMemo(() => {
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
      toStopId: pt.toStopId,
      segProgress: pt.segmentProgress,
    };
  }, [path, pathIdx]);

  const { zoomParams, legsKm, rest } = useRestZooms(stops, cities);
  const stopIndex = useMemo(() => new Map(stops.map((st, i) => [st.id, i])), [stops]);
  const { legZoom, look, staged } = useMemo(() => {
    const a = stopIndex.get(fromStopId) ?? 0;
    const b = stopIndex.get(toStopId) ?? a;
    // a leg across a border, or one too long for the view, is staged: out,
    // across, in. Any other leg follows the dot at the height it rests at.
    const restA = rest[a] ?? zoomParams.zMax;
    const restB = rest[b] ?? restA;
    const crosses = stops[a]?.country !== stops[b]?.country;
    const { travel, staged } = legProfile(restA, restB, legsKm[a] ?? 0, crosses, zoomParams);
    const legZoom = zoomAlong(restA, travel, restB, segProgress, staged);
    if (!staged) return { legZoom, look: position, staged };
    const ca = cities[stops[a]?.city];
    const cb = cities[stops[b]?.city];
    if (!ca || !cb) return { legZoom, look: position, staged };
    const A = latLngToVector3(ca.lat, ca.lng, 1);
    const B = latLngToVector3(cb.lat, cb.lng, 1);
    const [x, y, z] = lookAlong(A, B, segProgress);
    return { legZoom, look: new THREE.Vector3(x, y, z), staged };
  }, [
    stopIndex,
    fromStopId,
    toStopId,
    legsKm,
    rest,
    zoomParams,
    segProgress,
    position,
    stops,
    cities,
  ]);

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

  // Marker size follows the camera's distance: closer camera, smaller marker.
  // Below the design height (0.2 above the surface, zoom 2.2) the marks shrink
  // with the height too, so a camera skimming the ground does not blow them up.
  const zoomScale = 1 + legZoom * 0.5;
  const above = Math.max(0.02, 3.5 - 1.5 * legZoom);
  const skim = Math.min(1, above / 0.2);

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
        theme={theme}
        past={GLOBE[theme].routePast}
        ahead={GLOBE[theme].routeAhead}
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
        lean={lean}
        leanSpan={firstLeg}
      />
      <NoteSideProbe
        path={path}
        stopIds={stops.map((s) => s.id)}
        stopIdx={noteStop}
        onSide={onNoteSide}
      />
      {hoveredLeg && (
        <LegTooltip leg={hoveredLeg.leg} at={hoveredLeg.at} stops={stops} cities={cities} />
      )}

      {/* Cities as their own outlines, where the camera is close enough to read them */}
      <CityBounds
        outlines={outlines}
        been={(c) => ringFor(c) !== 'next'}
        hoveredCity={hoveredCity}
        theme={theme}
        widthBeen={widths.cityBeen}
        widthAhead={widths.aheadLand}
        blend={blendRef}
      />

      {/* City markers: one per city, hover-linked with the rail */}
      {cityMarkers.map((m) => {
        const dotProduct = m.position.clone().normalize().dot(position.clone().normalize());
        if (dotProduct < -0.3) return null;
        const markerScale = skim / Math.max(zoomScale, 0.5);
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
            {/* the city the dot is sitting on has no mark of its own; every other
                place is a ring — or, where the map has no shape for it, a glyph */}
            {PLACE_GLYPH[m.city] && (
              <PlaceGlyph
                glyph={PLACE_GLYPH[m.city]}
                size={radius}
                been={ring !== 'next'}
                hovered={hovered}
                theme={theme}
                width={ring === 'next' ? widths.glyph * 0.6 : widths.glyph}
              />
            )}
            {ring !== 'none' && !PLACE_GLYPH[m.city] && (
              <CityRing
                radius={radius}
                state={ring}
                hovered={hovered}
                ink={INK}
                been={GLOBE[theme].routePast}
                handoff={
                  outlines.has(m.city)
                    ? {
                        blend: blendRef,
                        city: m.city,
                        reach: outlines.get(m.city)!.reach,
                        markerScale,
                      }
                    : undefined
                }
              />
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
        target={look}
        zoom={zoom}
        isUserInteracting={isUserInteracting}
        progressiveZoom={legZoom}
        unhurried={staged}
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
              {/* the key that goes here, shown while the hand is on the rail */}
              {actualIdx === currentStopIndex + 1 && (
                <span className="timeline-stop__key">
                  <Kbd>→</Kbd>
                </span>
              )}
              {actualIdx === currentStopIndex - 1 && (
                <span className="timeline-stop__key">
                  <Kbd>←</Kbd>
                </span>
              )}
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
    const pathIdx = Math.min(Math.round(progress * path.length), path.length - 1);
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
    const idx = Math.min(Math.round(smoothProgress * path.length), path.length - 1);
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
  /** the km of every leg between two points of the route, for pacing a jump */
  const legsKmBetween = useCallback(
    (p0: number, p1: number) => {
      let km = 0;
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stopProgress[i];
        const b = stopProgress[i + 1];
        if (b <= p0 || a >= p1) continue;
        const ca = cities[stops[i].city];
        const cb = cities[stops[i + 1].city];
        if (ca && cb) km += haversineKm(ca, cb);
      }
      return km;
    },
    [stops, stopProgress, cities]
  );
  /** The page's own glide (set up by the snap effect below), for controls to use. */
  const glideRef = useRef<((to: number, ms?: number) => void) | null>(null);
  /** Where the last jump was headed, while it is still on its way. */
  const jumpTargetRef = useRef<number | null>(null);

  // Every control (scrubber, rail, keys, autoplay) moves the page scroll; `progress` derives from it
  const seek = useCallback(
    (p: number, mode: 'drag' | 'jump') => {
      // a control already chose where this stops, so the rest-snap below stays out of it
      wheelAtRef.current = 0;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const to = Math.max(0, Math.min(1, p));
      // A jump is one move with one easing — the page's own glide, not the
      // browser's smooth scroll on top of the spring on top of the camera. Its
      // length grows with the distance, gently: a leg is quick, a far jump is
      // not a blur. A jump that starts mid-glide retargets from where it is.
      if (mode === 'jump' && glideRef.current) {
        const px = Math.abs(to * maxScroll - window.scrollY);
        // a hop between countries is given room to be seen: the further, the longer
        const fromP = window.scrollY / Math.max(1, maxScroll);
        const kmAcross = legsKmBetween(Math.min(fromP, to), Math.max(fromP, to));
        const ms = Math.min(2400, 360 + px / 8 + kmAcross / 5);
        glideRef.current(to, ms);
        return;
      }
      window.scrollTo({ top: to * maxScroll, behavior: mode === 'drag' ? 'auto' : 'smooth' });
    },
    [legsKmBetween]
  );

  const [playing, setPlaying] = useState(false);
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);

  const goToStop = useCallback(
    (idx: number) => {
      const i = Math.max(0, Math.min(stops.length - 1, idx));
      jumpTargetRef.current = i;
      seek(stopProgress[i], 'jump');
    },
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
        if (e.repeat) return;
        setPlaying(false);
        goToStop((jumpTargetRef.current ?? currentStop) + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.repeat) return;
        setPlaying(false);
        goToStop((jumpTargetRef.current ?? currentStop) - 1);
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
  // the same zoom the camera will rest at here — the inset measures the screen
  // against it (see useRestZooms)
  const { rest: restZooms, zoomParams: insetZoomParams } = useRestZooms(stops, cities);
  const restZoom = restZooms[currentStop] ?? insetZoomParams.zMax;

  /**
   * Which map is open, if either. Held here rather than in each map because
   * only one may be: both put the cursor away and draw a ring where the hand
   * is, and two rings is two answers to one question.
   */
  const [openMap, setOpenMap] = useState<'world' | 'country' | null>(null);
  const settledStop = useSettledStop(currentStop, progress);

  // The first step. Once the opening has been written and nothing has been
  // touched, the dot leans up the first leg and settles back; on a desktop the
  // pointer carries a one-line hint over the globe. The first real input ends
  // both, for this visit and the next.
  const moved = useFirstMove();
  const [openingWritten, setOpeningWritten] = useState(false);
  const leanRef = useRef(0);
  const firstStep =
    openingWritten && !moved && currentStop === 0 && dotOut && selectedCity === null;
  useLean(firstStep, leanRef);
  const nextCityName = cities[stops[1]?.city]?.[language as 'ko' | 'en'] ?? stops[1]?.city ?? '';

  // Which side of the dot the city's note sits on — decided on the globe, in
  // screen space, once the reader has settled (NoteSideProbe)
  const [noteSide, setNoteSide] = useState<'below' | 'above'>('below');
  const noteStop =
    settledStop === currentStop && currentStop !== 0 && !finale && selectedCity === null
      ? currentStop
      : null;
  // a block is up over the map — the opening, a city's note, or the closing —
  // and the world steps back a shade so the words sit above it
  const noteUp = noteStop !== null || (currentStop === 0 && progress < 0.03) || finale;

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
   * The SNAP is for a wheel or a trackpad only — the phone lands on a stop of
   * its own (the touch handlers below), and a reader asking for less motion gets
   * the page left exactly where they put it.
   *
   * The GLIDE is not. Every control jumps with it — keys, the rail, both maps,
   * the scrubber — and it was shut away in here behind the phone's early return,
   * so `seek` found no glide on a phone and fell through to the browser's smooth
   * scroll. That is the one thing this was written to avoid: a smooth scroll is
   * abandoned the moment any scroll input arrives, and on Android the tail of the
   * finger that asked for the jump is exactly that. The page went nowhere, or
   * stopped halfway — a jump from Marrakesh came to rest in Portugal. So the
   * glide is built on every device and only the snap listeners are held back.
   */
  useEffect(() => {
    if (reducedMotion) return;

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
      jumpTargetRef.current = null;
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

    const glide = (to: number, maxScroll: number, ms: number = SNAP_MS) => {
      if (raf) cancelAnimationFrame(raf);
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
        const t = Math.min(1, (now - t0) / ms);
        window.scrollTo(0, from + (target - from) * (1 - Math.pow(1 - t, 3)));
        if (t < 1) {
          raf = requestAnimationFrame(step);
          return;
        }
        stopGlide(false);
      };
      raf = requestAnimationFrame(step);
    };

    // controls (keys, rail, both maps, scrubber) jump with this same glide
    glideRef.current = (to, ms) =>
      glide(to, document.documentElement.scrollHeight - window.innerHeight, ms);

    // A phone takes the glide and one listener: a hand laid on the page still
    // puts it down where it is. What it does not take is the rest-snap, which
    // is the wheel's, and the finger that ASKED for the jump cannot cancel it —
    // that press came and went before the glide existed.
    if (isMobile) {
      window.addEventListener('pointerdown', drop, { passive: true });
      return () => {
        window.removeEventListener('pointerdown', drop);
        glideRef.current = null;
        drop();
      };
    }

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
      glideRef.current = null;
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

      const currentPathIdx = Math.min(Math.round(progress * path.length), path.length - 1);
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
        <Canvas
          camera={{ position: [-2.5, 3, -3.5], fov: 45, near: 0.01 }}
          gl={{ antialias: true }}
        >
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
            noteStop={noteStop}
            onNoteSide={setNoteSide}
            lean={leanRef}
          />
          <DotGlobe
            countryCode={currentCountry}
            visitedCodes={visitedCountries}
            theme={theme}
            hush={noteUp}
          />
          <WorldBorders countryCode={currentCountry} theme={theme} hush={noteUp} />
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
      <CountryInset
        countryCode={currentCountry}
        stops={stops}
        cities={cities}
        currentStopIdx={currentStop}
        restZoom={restZoom}
        open={openMap === 'country'}
        onOpenChange={(v) => setOpenMap(v ? 'country' : null)}
        onSelect={(i) => {
          setPlaying(false);
          goToStop(i);
        }}
      />
      <Minimap
        stops={stops}
        cities={cities}
        currentStopIdx={currentStop}
        lat={currentLatLng.lat}
        lng={currentLatLng.lng}
        open={openMap === 'world'}
        onOpenChange={(v) => setOpenMap(v ? 'world' : null)}
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
      <AboutOverlay
        visible={currentStop === 0 && progress < 0.03}
        onWritten={() => setOpeningWritten(true)}
      />
      <CursorHint active={firstStep} next={nextCityName} />
      {TUNE_ON && <RouteTuner theme={theme} />}
      {/* What a city has to say — only once the journey has actually stopped
          there. Scrubbing past a dozen of them says nothing. */}
      {city && (
        <StopNote
          stopId={city.id}
          city={cities[city.city]?.[language as 'ko' | 'en'] ?? city.city}
          startDate={city.startDate ?? ''}
          side={noteSide}
          visible={noteStop !== null && !isUserInteracting}
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
