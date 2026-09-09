import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { Camera as CameraIcon, Plane, Bus, TrainFront, Ship, Mountain } from 'lucide-react';
import journeyData from '../../data/journey.json';
import citiesData from '../../data/cities.json';
import countriesData from '../../data/countries.json';
import { I18nProvider, useI18n, SUPPORTED_LANGUAGES, type Language } from '../../i18n';
import AboutOverlay from '../about/AboutOverlay';
import PhotoGallery from '../gallery/PhotoGallery';
import cityPhotosData from '../../data/cityPhotos.json';
import { DotGlobe } from './DotGlobe';
import { WorldBorders } from './WorldBorders';
import { Scrubber } from './Scrubber';
import { PhotoMarkers } from './PhotoMarkers';
import osrmRoutes from '../../data/osrmRoutes.json';
import './JourneyExperience.css';

// =============================================================================
// Constants
// =============================================================================

const SEGMENT_THRESHOLD = 0.15; // Progress within segment where we switch from showing "from" to "to" stop
const TIMELINE_ITEM_HEIGHT = 34; // Must match CSS .timeline-stop height
const JOURNEY_START = new Date('2016-08-13T00:00:00');

const INK = '#f2f2f2';

// Route line style per transport: flights dash, ground solid, boats dot, treks fine dots
const TRANSPORT_DASH: Record<string, { dashSize: number; gapSize: number } | null> = {
  flight: { dashSize: 0.05, gapSize: 0.035 },
  boat: { dashSize: 0.012, gapSize: 0.03 },
  trek: { dashSize: 0.006, gapSize: 0.02 },
  bus: null,
  train: null,
  start: null,
};

function dayNumber(dateStr?: string): number | null {
  if (!dateStr || dateStr.includes('?')) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - JOURNEY_START.getTime()) / 86400000) + 1;
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
    const routeKey = `${stops[i].id}-${stops[i + 1].id}`;
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

function Traveler({ position, zoomScale }: { position: THREE.Vector3; zoomScale: number }) {
  const scale = 1 / Math.max(zoomScale, 0.5);
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <Html center sprite style={{ pointerEvents: 'none' }}>
        <div className="traveler-dot" />
      </Html>
    </group>
  );
}

type PathPoint = {
  point: THREE.Vector3;
  transport: string;
  fromStopId: number;
  toStopId: number;
  segmentProgress: number;
};

function RouteLine({
  points,
  transport,
  opacity,
}: {
  points: THREE.Vector3[];
  transport: string;
  opacity: number;
}) {
  if (points.length < 2) return null;
  const dash = TRANSPORT_DASH[transport] ?? null;
  return (
    <Line
      points={points}
      color={INK}
      lineWidth={1.25}
      transparent
      opacity={opacity}
      depthWrite={false}
      dashed={dash !== null}
      dashSize={dash?.dashSize ?? 1}
      gapSize={dash?.gapSize ?? 0}
      dashScale={1}
    />
  );
}

function TravelPath({ points, progress }: { points: PathPoint[]; progress: number }) {
  const idx = Math.min(Math.floor(points.length * progress), points.length - 1);

  // One segment per leg (stop -> stop), keeping its index range in `points`
  const segments = useMemo(() => {
    const result: { pts: THREE.Vector3[]; transport: string; start: number; end: number }[] = [];
    let key = '';
    points.forEach((p, i) => {
      const k = `${p.fromStopId}-${p.toStopId}`;
      if (k !== key) {
        result.push({ pts: [p.point], transport: p.transport, start: i, end: i });
        key = k;
      } else {
        const seg = result[result.length - 1];
        seg.pts.push(p.point);
        seg.end = i;
      }
    });
    return result;
  }, [points]);

  return (
    <>
      {segments.map((seg) => {
        if (seg.end <= idx) {
          return (
            <RouteLine key={seg.start} points={seg.pts} transport={seg.transport} opacity={1} />
          );
        }
        if (seg.start >= idx) {
          return (
            <RouteLine key={seg.start} points={seg.pts} transport={seg.transport} opacity={0.22} />
          );
        }
        const split = idx - seg.start;
        return (
          <group key={seg.start}>
            <RouteLine points={seg.pts.slice(0, split + 1)} transport={seg.transport} opacity={1} />
            <RouteLine points={seg.pts.slice(split)} transport={seg.transport} opacity={0.22} />
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
function getProgressiveZoom(stopId: number): number {
  // START: Gwangju(1) - very zoomed in, Korea focus
  if (stopId <= 2) {
    return 1.7; // Maximum close-up on Korea
  }

  // First flight onwards - zoomed out (except special sections)
  if (stopId >= 4 && stopId <= 6) {
    return 1; // Fully zoomed out until Kuala Lumpur 1st
  }

  // INDONESIA (Lake Toba): Medan(7) → Tuktuk(8) zoom in, then zoom out
  if (stopId === 7) {
    return 1.5; // Very strong zoom for Medan
  }
  if (stopId === 8) {
    return 2.0; // Extreme zoom at Tuktuk (Lake Toba)
  }
  if (stopId === 9) {
    return 2.0; // Stay zoomed in at Medan return
  }
  if (stopId === 10) {
    return 0.5; // Continuing zoom out at Kuala Lumpur 2nd
  }
  if (stopId === 11) {
    return 1.5; // Zoom in heading to Laos (Bangkok → Vang Vieng)
  }

  // LAOS: Vang Vieng(12), Luang Prabang(13), Vientiane(14) - stay zoomed in
  if (stopId >= 12 && stopId <= 17) {
    return 2.0; // Maximum zoom in Laos
  }

  if (stopId === 18) {
    return 1.3;
  }

  // INDIA starts at Chennai(16) - gradual transition handled by India section

  // INDIA FIRST LEG: Chennai(16) → Hyderabad(20) → Kolkata(27) → Sonoli(29)
  // Chennai(16): 1.5
  if (stopId === 18) return 1.5;
  // Pondicherry(17): 1.7
  if (stopId === 19) return 1.7;
  // Gradual 1.7 → 2.0: Bengaluru(18) to Hyderabad(20)
  if (stopId === 20) return 1.8;
  if (stopId === 21) return 1.9;
  if (stopId === 20) return 2.0;
  // Maintain 2.0: Pune(21) to Kolkata(27)
  if (stopId >= 21 && stopId <= 24) return 2.0;
  if (stopId >= 25 && stopId <= 28) return 1.7;
  // Gradual 2.0 → 1.8: Varanasi(28) to Sonoli(29)
  if (stopId >= 29 && stopId <= 30) return 1.8;

  // NEPAL: Pokhara(30) → Annapurna(31) → Kathmandu(32) → Pokhara(33)
  // New Delhi(30) to Incheon(31): Flight - Zoom out to 1.0
  if (stopId === 31) return 1.0;

  // Gwangju(32) and Incheon(33) - Zoom in for Korea stay
  if (stopId === 32 || stopId === 33) return 1.5;

  if (stopId >= 34 && stopId <= 35) return 0;

  // INDIA RETURN: Varanasi(37) -> Gorakhpur(38) -> Sonauli(39)
  if (stopId >= 36 && stopId <= 39) return 1.8;

  // NEPAL MAIN: Siddharthanagar(40) to Bhaktapur(45)
  if (stopId >= 40 && stopId <= 45) return 2.2;

  // NEPAL RETURN: Siddharthanagar(46) -> Sonauli(47)
  if (stopId === 46 || stopId === 47) return 1.9;

  // INDIA RE-ENTRY: Varanasi(48) -> Abu Dhabi (Flight): Zoom out to 1.5
  if (stopId === 48) return 1.5;

  // UAE: Abu Dhabi(49, 1.3x) -> Dubai(50, 2.0x->2.2x) -> Sharjah(51, 2.2x) -> Abu Dhabi(52, 1.3x)
  if (stopId === 49) return 1.3;
  if (stopId >= 50 && stopId <= 51) return 2.2;
  if (stopId === 52) return 2.0;

  // EGYPT: Cairo(53) 1.3, Dahab(54) 1.7
  if (stopId === 53) return 1.3;
  if (stopId === 54) return 1.7;

  // SPAIN: Barcelona(55) 1.5
  if (stopId === 55) return 1.5; // Barcelona 1
  if (stopId === 56) return 2.2; // Sitges (Zoom in tight for short trip)
  if (stopId === 57) return 1.8; // Barcelona 2

  // EASTERN EUROPE: Sofia(58) -> Prague(63)
  if (stopId >= 58 && stopId <= 63) return 2.0;

  // ITALY: Milan(64) -> Milan(75) (Shifted by +6)
  if (stopId === 64) return 1.8; // Milan entry
  if (stopId >= 65 && stopId <= 74) return 2.2; // Italy detailed tour (Turin...Orta)
  if (stopId === 75) return 1.8; // Milan exit

  // WESTERN EUROPE: Brussels(76), Paris(77)
  if (stopId === 76) return 2.0;
  if (stopId === 77) return 1.5; // Paris wide view

  // MOROCCO: Madrid(78) is transit, Porto(79). Marrakesh(80)...
  if (stopId >= 78 && stopId <= 79) return 1.5; // Madrid, Porto
  // From Milan(69) to Rio(83) is mostly flight/long bus - keep far zoom
  if (stopId >= 70 && stopId <= 82) return 1.5;

  // BRAZIL Coast: Rio(83) → gradual to Paraty(87) = 2.1
  if (stopId === 83) return 1.1; // Rio de Janeiro
  if (stopId === 84) return 2.1; // Angra
  if (stopId === 85) return 2.2; // Ilha Grande
  if (stopId === 86) return 2.2; // Angra return
  if (stopId === 87) return 2.1; // Paraty - peak
  if (stopId >= 88 && stopId <= 91) return 2.0; // Maintain to Santos

  // São Paulo(92) zoom out to 1.7, maintain to Navegantes(94)
  if (stopId >= 92 && stopId <= 94) return 1.7; // (was 90-92)

  // Bombinhas(95) 1.9, then 2.0 through Imbituba(100)
  if (stopId === 95) return 1.9; // (was 93)
  if (stopId >= 96 && stopId <= 100) return 2.0; // (was 94-98)

  // Iguazu(101) zoom out to 1.5, maintain to Posadas(102)
  if (stopId === 101 || stopId === 102) return 1.5; // (was 99-100)

  // Montevideo(103) and Buenos Aires(104): 1.6
  if (stopId === 103 || stopId === 104) return 1.6; // (was 101-102)

  // Santiago(105): 1.3 zoom out
  if (stopId === 105) return 1.3; // (was 103)

  // Valparaíso(106) to Bahía Inglesa(107): 1.5
  if (stopId === 106 || stopId === 107) return 1.5; // (was 104-105)

  // Atacama(108) to Sucre(113): 2.0 (zoomed in for desert/highlands)
  if (stopId >= 108 && stopId <= 113) return 2.0; // (was 106-111)

  // El Alto(114) to Machu Picchu(118): 2.0 (maintain zoom through Peru)
  if (stopId >= 114 && stopId <= 118) return 2.0; // (was 112-116)

  // Lima(119): 1.5
  if (stopId === 119) return 1.5; // (was 117)

  // Piura(120) to Border(121): 1.7
  if (stopId >= 120 && stopId <= 121) return 1.7; // (was 118-119)

  // Cajas(122) to Pasto(129): 1.8 (zoomed in for Andes region)
  if (stopId >= 122 && stopId <= 129) return 1.8; // (was 120-127)

  // Cali(130): zoom out to 1.5
  if (stopId === 130) return 1.5; // (was 128)

  // Bogotá(131) and Medellín(132): 1.5
  if (stopId === 131 || stopId === 132) return 1.5; // (was 129-130)

  // Cartagena(133): 1.7
  if (stopId === 133) return 1.7; // (was 131)

  // Barranquilla(134) to Incheon(135): 1.0 zoom out
  if (stopId >= 134) return 1.0;

  // Everything else - zoomed out
  return 0;
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

function Scene({
  progress,
  zoom,
  isUserInteracting,
  onInteraction,
  onCityClick,
  onPhotoClusterClick,
}: {
  progress: number;
  zoom: number;
  isUserInteracting: boolean;
  onInteraction: () => void;
  onCityClick: (cityName: string) => void;
  onPhotoClusterClick: (cityName: string, photoIds: string[]) => void;
}) {
  const stops = journeyData.stops as Stop[];
  const cities = citiesData.cities as Record<string, CityData>;
  const { language } = useI18n();

  const path = useMemo(() => generatePath(stops, cities, 2.003), [stops, cities]);

  const pathIdx = Math.min(Math.floor(progress * path.length), path.length - 1);

  const { position, displayStopId, fromStopId } = useMemo(() => {
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
    };
  }, [path, pathIdx]);

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

  // Get visited stops (only show stops we've actually reached)
  const visitedStops = useMemo(() => {
    const currentCityName = stops[currentStopIdx]?.city;

    // Show stops up to and including the one we're currently at
    return stops
      .slice(0, currentStopIdx + 1)
      .map((stop, idx) => {
        const isCurrentStop = idx === currentStopIdx;

        // If this is a past stop but for the same city as current stop, skip it
        // This prevents double rendering (small label under big label)
        if (!isCurrentStop && stop.city === currentCityName) {
          return null;
        }

        const city = cities[stop.city];
        if (!city) return null;
        const pos = latLngToVector3(city.lat, city.lng, 2.004);
        return {
          id: stop.id,
          position: pos,
          name: city[language as 'ko' | 'en'],
          isCurrentStop,
          isFromStop: stop.id === fromStopId && fromStopId !== displayStopId, // Departure city (not the same as destination)
        };
      })
      .filter(Boolean) as {
      id: number;
      position: THREE.Vector3;
      name: string;
      isCurrentStop: boolean;
      isFromStop: boolean;
    }[];
  }, [stops, cities, currentStopIdx, language, fromStopId, displayStopId]);

  return (
    <>
      <TravelPath points={path} progress={progress} />

      {/* City markers for visited stops */}
      {visitedStops.map((stop) => {
        const markerDir = stop.position.clone().normalize();
        const cameraDir = position.clone().normalize();
        const dotProduct = markerDir.dot(cameraDir);
        if (dotProduct < -0.3) return null;

        const markerScale = 1 / Math.max(zoomScale, 0.5);

        if (stop.isCurrentStop) {
          const originalCityName = stops[currentStopIdx]?.city;
          const cityHasPhotos = Boolean(
            originalCityName && cityPhotosData[originalCityName as keyof typeof cityPhotosData]
          );
          return (
            <group
              key={stop.id}
              position={stop.position}
              scale={[markerScale, markerScale, markerScale]}
            >
              <mesh>
                <sphereGeometry args={[0.007, 16, 16]} />
                <meshBasicMaterial color={INK} />
              </mesh>
              <Html center style={{ pointerEvents: 'none' }}>
                <div
                  className={`city-label city-label--current${cityHasPhotos ? ' city-label--link' : ''}`}
                  onClick={cityHasPhotos ? () => onCityClick(originalCityName!) : undefined}
                >
                  {stop.name}
                  {cityHasPhotos && <CameraIcon size={11} strokeWidth={1.75} />}
                </div>
              </Html>
            </group>
          );
        }

        if (stop.isFromStop) {
          return (
            <group
              key={stop.id}
              position={stop.position}
              scale={[markerScale, markerScale, markerScale]}
            >
              <mesh>
                <sphereGeometry args={[0.005, 12, 12]} />
                <meshBasicMaterial color={INK} transparent opacity={0.8} />
              </mesh>
              <Html center style={{ pointerEvents: 'none' }}>
                <div className="city-label city-label--from">{stop.name}</div>
              </Html>
            </group>
          );
        }

        return (
          <group
            key={stop.id}
            position={stop.position}
            scale={[markerScale, markerScale, markerScale]}
          >
            <mesh>
              <sphereGeometry args={[0.004, 12, 12]} />
              <meshBasicMaterial color={INK} transparent opacity={0.55} />
            </mesh>
            {dotProduct > 0.8 && (
              <Html center style={{ pointerEvents: 'none' }}>
                <div className="city-label city-label--past">{stop.name}</div>
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
        onPhotoClusterClick={onPhotoClusterClick}
      />
      <Traveler position={position} zoomScale={zoomScale} />
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

function LanguageToggle() {
  const { language, setLanguage } = useI18n();
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          type="button"
          className={`lang-toggle__item${language === lang.code ? ' is-active' : ''}`}
          onClick={() => setLanguage(lang.code as Language)}
          aria-pressed={language === lang.code}
        >
          {lang.code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
function VerticalTimeline({
  currentStopIndex,
  stops,
  onSelect,
}: {
  currentStopIndex: number;
  stops: Stop[];
  onSelect: (index: number) => void;
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
    <nav className="stop-rail" aria-label="Stops">
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
              className={`timeline-stop timeline-stop--${state}`}
              role="button"
              tabIndex={-1}
              onClick={() => onSelect(actualIdx)}
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
      <span className="stop-meta__place">
        {cityName}, {countryName}
      </span>
      <span className="stop-meta__coords mono">{coords}</span>
    </div>
  );
}

function Header() {
  const { t } = useI18n();
  return (
    <header className="journey-header">
      <div className="journey-header__brand">
        <span className="journey-header__dot" aria-hidden="true" />
        <span>{t('journey.title')}</span>
      </div>
      <span className="journey-header__period mono">2016.08.13 — 2017.07.06</span>
      <LanguageToggle />
    </header>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function JourneyExperienceContent() {
  const { language } = useI18n();
  const [progress, setProgress] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[] | null>(null);
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

  // Every control (scrubber, rail, keys, autoplay) moves the page scroll; `progress` derives from it
  const seek = useCallback((p: number, mode: 'drag' | 'jump') => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({
      top: Math.max(0, Math.min(1, p)) * maxScroll,
      behavior: mode === 'drag' ? 'auto' : 'smooth',
    });
  }, []);

  const [playing, setPlaying] = useState(false);
  const goToStop = useCallback(
    (idx: number) => seek(stopProgress[Math.max(0, Math.min(stops.length - 1, idx))], 'jump'),
    [seek, stopProgress, stops.length]
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

  // Handle city click for photo gallery (from city markers - show all photos)
  const handleCityClick = (cityName: string) => {
    setSelectedCity(cityName);
    setSelectedPhotoIds(null);
  };

  // Handle photo cluster click (from PhotoMarkers - show only cluster photos)
  const handlePhotoClusterClick = (cityName: string, photoIds: string[]) => {
    setSelectedCity(cityName);
    setSelectedPhotoIds(photoIds);
  };

  const handleCloseGallery = () => {
    setSelectedCity(null);
    setSelectedPhotoIds(null);
  };

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
            progress={progress}
            zoom={zoom}
            isUserInteracting={isUserInteracting}
            onInteraction={handleUserInteraction}
            onCityClick={handleCityClick}
            onPhotoClusterClick={handlePhotoClusterClick}
          />
          <DotGlobe countryCode={currentCountry} visitedCodes={visitedCountries} />
          <WorldBorders countryCode={currentCountry} />
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
      />
      {city && <StopMeta stop={city} />}
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

      {/* Photo gallery overlay */}
      <PhotoGallery
        cityName={selectedCity}
        photoIds={selectedPhotoIds}
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
