import { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Sphere, Line, Stars, Html } from '@react-three/drei';
import * as THREE from 'three';
import { ChevronDown, Globe, Languages, Camera as CameraIcon, ZoomIn } from 'lucide-react';
import journeyData from '../../data/journey.json';
import citiesData from '../../data/cities.json';
import countryBackgrounds from '../../data/countryBackgrounds.json';
import countriesData from '../../data/countries.json';
import { I18nProvider, useI18n, SUPPORTED_LANGUAGES, type Language } from '../../i18n';
import AboutOverlay from '../about/AboutOverlay';
import PhotoGallery from '../gallery/PhotoGallery';
import cityPhotosData from '../../data/cityPhotos.json';
import { WorldBorders } from './WorldBorders';
import './JourneyExperience.css';

// =============================================================================
// Constants
// =============================================================================

const SEGMENT_THRESHOLD = 0.15; // Progress within segment where we switch from showing "from" to "to" stop
const TIMELINE_ITEM_HEIGHT = 52; // Must match CSS .timeline-stop height

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

interface BackgroundImage {
  flag: string;
  landmark: string;
  landmarkName: { ko: string; en: string };
}

interface CountryData {
  code: string;
  name: { en: string; ko: string; native: string };
  coordinates: { lat: number; lng: number };
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

  for (let i = 0; i < stops.length - 1; i++) {
    const currentCity = cities[stops[i].city];
    const nextCity = cities[stops[i + 1].city];

    if (!currentCity || !nextCity) continue;

    const start = latLngToVector3(currentCity.lat, currentCity.lng, radius);
    const end = latLngToVector3(nextCity.lat, nextCity.lng, radius);
    const transport = stops[i + 1].transport;

    const segments = transport === 'flight' ? 80 : 30; // Flight has more segments = slower line drawing
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      const point = new THREE.Vector3().lerpVectors(start, end, t);

      if (transport === 'flight') {
        const arc = Math.sin(t * Math.PI) * 0.15;
        point.normalize().multiplyScalar(radius + arc);
      } else {
        point.normalize().multiplyScalar(radius);
      }

      // Track both source and destination stop, plus progress within segment
      points.push({
        point,
        transport,
        fromStopId: stops[i].id,
        toStopId: stops[i + 1].id,
        segmentProgress: t,
      });
    }
  }

  return points;
}

// =============================================================================
// 3D Components
// =============================================================================

function Earth() {
  // Use 8K high-resolution texture
  const hiresTexture = useLoader(THREE.TextureLoader, '/assets/textures/earth_8k.jpg');

  return (
    <group>
      {/* Beautiful blue ocean base */}
      <Sphere args={[1.99, 128, 128]}>
        <meshStandardMaterial color="#0277bd" roughness={0.3} metalness={0.5} />
      </Sphere>

      {/* High-res Earth texture */}
      <Sphere args={[2, 128, 128]}>
        <meshStandardMaterial map={hiresTexture} roughness={0.5} metalness={0.1} />
      </Sphere>

      {/* Atmosphere glow */}
      <Sphere args={[2.05, 64, 64]}>
        <meshBasicMaterial color="#4fc3f7" transparent opacity={0.08} side={THREE.BackSide} />
      </Sphere>

      {/* Outer glow */}
      <Sphere args={[2.1, 64, 64]}>
        <meshBasicMaterial color="#81d4fa" transparent opacity={0.04} side={THREE.BackSide} />
      </Sphere>
    </group>
  );
}

function Traveler({ position, zoomScale }: { position: THREE.Vector3; zoomScale: number }) {
  // Red pulsing indicator - always visible and distinct
  const pulseRef = useRef<THREE.Mesh>(null);
  const outerPulseRef = useRef<THREE.Mesh>(null);

  // Scale inversely with zoom to maintain consistent visual size
  const scale = 1 / Math.max(zoomScale, 0.5);

  // Pulse animation
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pulse = 0.9 + Math.sin(t * 4) * 0.3; // Fast pulse between 0.6-1.2
    const outerPulse = 0.8 + Math.sin(t * 2) * 0.4;

    if (pulseRef.current) {
      pulseRef.current.scale.setScalar(pulse);
    }
    if (outerPulseRef.current) {
      outerPulseRef.current.scale.setScalar(outerPulse);
      (outerPulseRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.3 - Math.sin(t * 2) * 0.15;
    }
  });

  return (
    <group position={position} scale={[scale, scale, scale]}>
      {/* Bright red core - always visible */}
      <mesh>
        <sphereGeometry args={[0.01, 32, 32]} />
        <meshBasicMaterial color="#FF3B3B" />
      </mesh>

      {/* Pulsing inner glow - smaller */}
      <mesh ref={pulseRef}>
        <sphereGeometry args={[0.018, 32, 32]} />
        <meshBasicMaterial color="#FF6B6B" transparent opacity={0.5} />
      </mesh>

      {/* Pulsing outer halo - smaller */}
      <mesh ref={outerPulseRef}>
        <sphereGeometry args={[0.028, 32, 32]} />
        <meshBasicMaterial color="#FF4757" transparent opacity={0.2} />
      </mesh>
    </group>
  );
}

// Transport color palette - bright neon colors for high visibility
const TRANSPORT_COLORS: Record<string, string> = {
  flight: '#FF4757', // Bright red-coral
  bus: '#00D9FF', // Bright cyan
  train: '#C56CF0', // Bright purple
  boat: '#FFD93D', // Bright yellow
  trek: '#6BCB77', // Bright green
  start: '#FF6B9D', // Bright pink
};

function TravelPath({
  points,
  progress,
}: {
  points: { point: THREE.Vector3; transport: string }[];
  progress: number;
}) {
  const idx = Math.floor(points.length * progress);
  // Only show up to current position (no preview)
  const traveled = points.slice(0, Math.max(idx, 1));
  const future = points.slice(Math.max(0, idx));

  // Build segments grouped by transport type
  const segments = useMemo(() => {
    const result: { pts: THREE.Vector3[]; color: string }[] = [];
    let lastColor = '';

    for (const p of traveled) {
      const color = TRANSPORT_COLORS[p.transport] || '#4ECDC4';
      if (color !== lastColor) {
        // Start new segment, connect with previous if exists
        if (result.length > 0) {
          result[result.length - 1].pts.push(p.point);
        }
        result.push({ pts: [p.point], color });
        lastColor = color;
      } else {
        result[result.length - 1].pts.push(p.point);
      }
    }
    return result;
  }, [traveled]);

  return (
    <>
      {/* Render each segment with its transport color */}
      {segments.map((seg, i) => (
        <group key={i}>
          {/* Soft glow layer */}
          {seg.pts.length >= 2 && (
            <Line points={seg.pts} color={seg.color} lineWidth={6} transparent opacity={0.25} />
          )}
          {/* Main solid line - fully visible */}
          {seg.pts.length >= 2 && <Line points={seg.pts} color={seg.color} lineWidth={2} />}
        </group>
      ))}
      {/* Future path */}
      {future.length >= 2 && (
        <Line
          points={future.map((p) => p.point)}
          color="#666666"
          lineWidth={0.5}
          transparent
          opacity={0.06}
        />
      )}
    </>
  );
}

// Progressive zoom logic:
// - Start: Gwangju(1) very zoomed in → Incheon(2) zooming out → flight = fully out
// - India 1st: Chennai(16)→Mumbai(22) zoom in, Mumbai(22)→Varanasi(28) zoom out, Sonoli(29)=snap out
// - Italy: Milan(51)→La Spezia(56) zoom in, back to Milan(62)=snap out
function getProgressiveZoom(stopId: number): number {
  // START: Gwangju(1) - very zoomed in, Korea focus
  if (stopId === 1) {
    return 1.5; // Maximum close-up on Korea
  }

  // Incheon(2) - still fairly zoomed in
  if (stopId === 2) {
    return 0.8;
  }

  // First flight onwards - zoomed out (except special sections)
  if (stopId >= 3 && stopId <= 6) {
    return 0; // Fully zoomed out until Kuala Lumpur 1st
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
  if (stopId >= 12 && stopId <= 14) {
    return 2.0; // Maximum zoom in Laos
  }

  // Udon Thani(15) - still fairly zoomed
  if (stopId === 15) {
    return 1.8;
  }

  // INDIA starts at Chennai(16) - gradual transition handled by India section

  // INDIA FIRST LEG: Chennai(16) → Hyderabad(20) → Kolkata(27) → Sonoli(29)
  // Chennai(16): 1.5
  if (stopId === 16) return 1.5;
  // Pondicherry(17): 1.7
  if (stopId === 17) return 1.7;
  // Gradual 1.7 → 2.0: Bengaluru(18) to Hyderabad(20)
  if (stopId === 18) return 1.8;
  if (stopId === 19) return 1.9;
  if (stopId === 20) return 2.0;
  // Maintain 2.0: Pune(21) to Kolkata(27)
  if (stopId >= 21 && stopId <= 27) return 2.0;
  // Gradual 2.0 → 1.8: Varanasi(28) to Sonoli(29)
  if (stopId === 28) return 1.9;
  if (stopId === 29) return 1.8;

  // NEPAL: Pokhara(30) → Annapurna(31) → Kathmandu(32) → Pokhara(33)
  // New Delhi(30) to Incheon(31): Flight - Zoom out to 1.0
  if (stopId === 30 || stopId === 31) return 1.0;

  // Gwangju(32) and Incheon(33) - Zoom in for Korea stay
  if (stopId === 32 || stopId === 33) return 1.5;

  // INDIA RETURN: Varanasi(37) -> Gorakhpur(38) -> Sonauli(39)
  if (stopId >= 37 && stopId <= 39) return 1.5;

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

  // ITALY: Milan(58) → gradual to Bra(60), maintain, zoom out at end
  if (stopId === 58) return 1.8; // Milan entry
  if (stopId === 59) return 1.95; // Torino
  if (stopId === 60) return 2.1; // Bra - peak
  if (stopId >= 61 && stopId <= 68) return 2.1; // Maintain through Italy
  if (stopId === 69) return 1.9; // Milan exit - zoom out

  // EUROPE (Sofia to Lisbon): maintain 1.5 until leaving for Brazil
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
}: {
  progress: number;
  zoom: number;
  isUserInteracting: boolean;
  onInteraction: () => void;
  onCityClick: (cityName: string) => void;
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
    return { position: pt.point, displayStopId: showStopId, fromStopId: pt.fromStopId };
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

  // Get current country code for highlighting
  const currentCountryCode = useMemo(() => {
    const currentCity = stops[currentStopIdx];
    if (!currentCity) return null;
    const cityData = cities[currentCity.city];
    return cityData?.country || null;
  }, [stops, currentStopIdx, cities]);

  // Get nearby countries data for labels on globe (current ±1 for performance)
  const allCountriesData = useMemo(() => {
    const countries = (countriesData as { countries: CountryData[] }).countries;

    // Find visited countries in order
    const visitedCountryCodes = stops
      .map((stop) => {
        const cityData = cities[stop.city];
        return cityData?.country;
      })
      .filter((code, index, self) => code && self.indexOf(code) === index);

    const currentIndex = visitedCountryCodes.indexOf(currentCountryCode || '');

    // Show current ±1 countries only (3 total max)
    const visibleCountryCodes = new Set<string>();
    if (currentCountryCode) {
      visibleCountryCodes.add(currentCountryCode);
      if (currentIndex > 0) {
        visibleCountryCodes.add(visitedCountryCodes[currentIndex - 1]!);
      }
      if (currentIndex < visitedCountryCodes.length - 1) {
        visibleCountryCodes.add(visitedCountryCodes[currentIndex + 1]!);
      }
    }

    return countries
      .filter((country) => visibleCountryCodes.has(country.code))
      .map((country) => {
        const labelPos = latLngToVector3(country.coordinates.lat, country.coordinates.lng, 2.02);
        return {
          code: country.code,
          name: country.name,
          position: labelPos,
          isCurrent: country.code === currentCountryCode,
        };
      });
  }, [currentCountryCode, stops, cities]);

  return (
    <>
      <TransportLegend />
      <ambientLight intensity={1.0} />
      <directionalLight position={[5, 3, 5]} intensity={1.4} />
      <directionalLight position={[-5, -2, -3]} intensity={0.4} />
      <pointLight position={[0, 0, 5]} intensity={0.7} />
      <Stars radius={200} depth={100} count={1500} factor={3} fade speed={0.2} />
      <Earth />
      <TravelPath points={path} progress={progress} />

      {/* Country name labels on globe surface */}
      {allCountriesData.map((countryData) => {
        const pos = countryData.position;

        // Check if label is facing camera (dot product check)
        const labelDir = pos.clone().normalize();
        const cameraDir = position.clone().normalize();
        const dotProduct = labelDir.dot(cameraDir);
        const isVisible = dotProduct > -0.2; // Hide if on back of globe

        if (!isVisible) return null;

        const isCurrent = countryData.isCurrent;
        const mainOpacity = isCurrent ? 0.35 : 0.1;
        const nativeOpacity = isCurrent ? 0.25 : 0.08;

        return (
          <group key={countryData.code} position={pos.toArray()}>
            <group rotation={[0, Math.atan2(pos.x, pos.z), 0]} scale={[0.05, 0.05, 0.05]}>
              <Html
                center
                transform
                pointerEvents="none"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  transition: 'opacity 0.5s ease',
                }}
              >
                <div
                  style={{
                    fontSize: '32px',
                    fontWeight: '800',
                    letterSpacing: '0.08em',
                    color: `rgba(255, 255, 255, ${mainOpacity})`,
                    textShadow: '0 0 20px rgba(255,255,255,0.1)',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.2,
                    transition: 'color 0.5s ease',
                    pointerEvents: 'none',
                  }}
                >
                  {language === 'ko' ? countryData.name.ko : countryData.name.en.toUpperCase()}
                </div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    letterSpacing: '0.02em',
                    color: `rgba(255, 255, 255, ${nativeOpacity})`,
                    textShadow: '0 0 10px rgba(255,255,255,0.05)',
                    whiteSpace: 'nowrap',
                    marginTop: '4px',
                    transition: 'color 0.5s ease',
                    pointerEvents: 'none',
                  }}
                >
                  {countryData.name.native}
                </div>
              </Html>
            </group>
          </group>
        );
      })}

      {/* City markers for visited stops */}
      {visitedStops.map((stop) => {
        // Calculate if marker is facing camera (simple dot product check)
        const markerDir = stop.position.clone().normalize();
        const cameraDir = position.clone().normalize();
        const dotProduct = markerDir.dot(cameraDir);
        const isVisible = dotProduct > -0.3; // Show if roughly facing same hemisphere as current position

        if (!isVisible) return null;

        // Calculate marker scale (inverse of zoom)
        const markerScale = 1 / Math.max(zoomScale, 0.5);

        // Baedal Minjok mint color for all markers
        const baemin = '#2AC1BC';
        const baeminGlow = '#3DD8D4';

        if (stop.isCurrentStop) {
          // Check if this city has photos - use original Korean city name from journey data
          const originalCityName = stops[currentStopIdx]?.city;
          const cityHasPhotos = Boolean(
            originalCityName && cityPhotosData[originalCityName as keyof typeof cityPhotosData]
          );

          // DESTINATION: Ring (empty circle) + glow effect
          return (
            <group
              key={stop.id}
              position={stop.position}
              scale={[markerScale, markerScale, markerScale]}
            >
              {/* Outer glow */}
              <mesh>
                <sphereGeometry args={[0.022, 16, 16]} />
                <meshBasicMaterial color={baeminGlow} transparent opacity={0.3} />
              </mesh>
              {/* Ring - larger sphere with transparent center illusion */}
              <mesh>
                <ringGeometry args={[0.012, 0.016, 24]} />
                <meshBasicMaterial color={baemin} side={THREE.DoubleSide} />
              </mesh>
              {/* Inner glow for ring */}
              <mesh>
                <ringGeometry args={[0.008, 0.02, 24]} />
                <meshBasicMaterial
                  color={baeminGlow}
                  transparent
                  opacity={0.4}
                  side={THREE.DoubleSide}
                />
              </mesh>
              {/* City name label - clickable for current stop */}
              <Html
                position={[0, 0.035, 0]}
                center
                style={{
                  color: baemin,
                  fontSize: '14px',
                  fontWeight: '600',
                  textShadow: '0 2px 8px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.8)',
                  whiteSpace: 'nowrap',
                  pointerEvents: cityHasPhotos ? 'auto' : 'none',
                  cursor: cityHasPhotos ? 'pointer' : 'default',
                }}
              >
                <div
                  onClick={cityHasPhotos ? () => onCityClick(originalCityName!) : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  {stop.name}
                  {cityHasPhotos && (
                    <CameraIcon
                      size={12}
                      style={{
                        animation: 'floatBounce 1.5s ease-in-out infinite',
                        opacity: 0.9,
                      }}
                    />
                  )}
                </div>
              </Html>
            </group>
          );
        } else if (stop.isFromStop) {
          // FROM STOP (departure): Same size as destination but not bold
          return (
            <group
              key={stop.id}
              position={stop.position}
              scale={[markerScale, markerScale, markerScale]}
            >
              {/* White core for visibility */}
              <mesh>
                <sphereGeometry args={[0.005, 12, 12]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
              {/* Mint glow outer */}
              <mesh>
                <sphereGeometry args={[0.01, 12, 12]} />
                <meshBasicMaterial color={baemin} transparent opacity={0.6} />
              </mesh>
              {/* City name label - same size as destination, but normal weight */}
              <Html
                position={[0, 0.025, 0]}
                center
                style={{
                  color: baemin,
                  fontSize: '14px',
                  fontWeight: '400', // Normal weight (not bold)
                  textShadow: '0 2px 8px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.8)',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  opacity: 0.85,
                }}
              >
                {stop.name}
              </Html>
            </group>
          );
        } else {
          // PAST STOPS: Small filled circle with white core
          return (
            <group
              key={stop.id}
              position={stop.position}
              scale={[markerScale, markerScale, markerScale]}
            >
              {/* White core for visibility */}
              <mesh>
                <sphereGeometry args={[0.003, 12, 12]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
              {/* Mint glow outer */}
              <mesh>
                <sphereGeometry args={[0.006, 12, 12]} />
                <meshBasicMaterial color={baemin} transparent opacity={0.7} />
              </mesh>
              {/* Show label only when very close */}
              {dotProduct > 0.8 && (
                <Html
                  position={[0, 0.02, 0]}
                  center
                  style={{
                    color: baemin,
                    fontSize: '10px',
                    fontWeight: '400',
                    textShadow: '0 2px 6px rgba(0,0,0,1), 0 0 16px rgba(0,0,0,0.8)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    opacity: 0.7,
                  }}
                >
                  {stop.name}
                </Html>
              )}
            </group>
          );
        }
      })}

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
  const [open, setOpen] = useState(false);

  return (
    <div className="lang-toggle">
      <button className="lang-toggle__btn" onClick={() => setOpen(!open)}>
        <Languages size={16} />
        <span>{language.toUpperCase()}</span>
      </button>
      {open && (
        <div className="lang-toggle__menu">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              className={`lang-toggle__item ${language === lang.code ? 'active' : ''}`}
              onClick={() => {
                setLanguage(lang.code as Language);
                setOpen(false);
              }}
            >
              {lang.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function VerticalTimeline({
  currentStopIndex,
  stops,
}: {
  currentStopIndex: number;
  stops: Stop[];
}) {
  const { language } = useI18n();
  const cities = citiesData.cities as Record<string, CityData>;

  // Show 7 stops centered on current (3 before, current, 3 after)
  const visibleRange = 3;
  const startIdx = Math.max(0, currentStopIndex - visibleRange);
  const endIdx = Math.min(stops.length - 1, currentStopIndex + visibleRange);

  const visibleStops = stops.slice(startIdx, endIdx + 1);
  const centerOffset = currentStopIndex - startIdx;

  // Item height for positioning - use constant
  const itemHeight = TIMELINE_ITEM_HEIGHT;

  // Format date: "2016-09-15" -> "'16.09.15"
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    return `'${parts[0].slice(2)}.${parts[1]}.${parts[2]}`;
  };

  return (
    <div className="vertical-timeline">
      <div className="vertical-timeline__track" />
      <div
        className="vertical-timeline__stops"
        style={{
          transform: `translateY(calc(50% - ${centerOffset * itemHeight}px))`,
        }}
      >
        {visibleStops.map((stop, idx) => {
          const actualIdx = startIdx + idx;
          const isVisited = actualIdx < currentStopIndex;
          const isCurrent = actualIdx === currentStopIndex;
          const city = cities[stop.city];
          const cityName = city ? city[language as 'ko' | 'en'] : stop.city;

          return (
            <div
              key={stop.id}
              className={`timeline-stop ${isCurrent ? 'timeline-stop--current' : ''} ${isVisited ? 'timeline-stop--visited' : ''}`}
            >
              <div className="timeline-stop__dot">
                {isCurrent && <div className="timeline-stop__pulse" />}
              </div>
              <div className="timeline-stop__info">
                <span className="timeline-stop__city">{cityName}</span>
                <span className="timeline-stop__date">
                  {formatDate(stop.startDate) || formatDate(stop.endDate)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FlipboardCountry({ countryCode }: { countryCode: string }) {
  const { language } = useI18n();
  const countries = journeyData.countries as Record<string, { name: { ko: string; en: string } }>;
  const [displayChars, setDisplayChars] = useState<string[]>([]);
  const [settledCount, setSettledCount] = useState(0);

  const countryName = (
    countries[countryCode]?.name?.[language as 'ko' | 'en'] ||
    (countries[countryCode]?.name as unknown as string) ||
    countryCode
  ).toUpperCase();

  useEffect(() => {
    // Compute targetChars inside effect to avoid stale closure
    const targetChars = countryName.split('');

    // Reset with exact length
    setSettledCount(0);
    setDisplayChars(new Array(targetChars.length).fill(' '));

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ가나다라마바사아자차카타파하';
    let currentSettled = 0;

    // Progressive reveal: settle one character at a time
    const settleInterval = setInterval(() => {
      if (currentSettled >= targetChars.length) {
        clearInterval(settleInterval);
        // Ensure final state is exact
        setDisplayChars([...targetChars]);
        return;
      }

      // Flip animation for current character
      let flipCount = 0;
      const maxFlips = 6;

      const flipChar = setInterval(() => {
        setDisplayChars(() => {
          const newChars = new Array(targetChars.length).fill(' ');
          // Already settled characters stay fixed
          for (let i = 0; i < currentSettled; i++) {
            newChars[i] = targetChars[i];
          }
          // Current flipping character
          if (flipCount >= maxFlips) {
            newChars[currentSettled] = targetChars[currentSettled];
          } else {
            newChars[currentSettled] = chars[Math.floor(Math.random() * chars.length)];
          }
          // Remaining characters show random
          for (let i = currentSettled + 1; i < targetChars.length; i++) {
            newChars[i] = chars[Math.floor(Math.random() * chars.length)];
          }
          return newChars;
        });

        flipCount++;
        if (flipCount > maxFlips) {
          clearInterval(flipChar);
          currentSettled++;
          setSettledCount(currentSettled);
        }
      }, 50);
    }, 150);

    return () => clearInterval(settleInterval);
  }, [countryName]);

  // Slice to exact length to prevent extra empty flipboards
  const visibleChars = displayChars.slice(0, countryName.length);

  return (
    <div className="flipboard-country">
      <div className="flipboard-country__text">
        {visibleChars.map((char, idx) => (
          <span
            key={idx}
            className={`flipboard-char ${idx < settledCount ? 'flipboard-char--settled' : 'flipboard-char--flipping'}`}
          >
            {char || countryName[idx]}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScrollHint() {
  const { t } = useI18n();
  return (
    <div className="scroll-hint">
      <span>{t('journey.scrollToExplore')}</span>
      <ChevronDown size={24} />
    </div>
  );
}

function MobileSwipeHint() {
  const { language } = useI18n();
  const swipeText = language === 'ko' ? '스와이프로 탐색' : 'Swipe to navigate';
  const pinchText = language === 'ko' ? '핀치로 확대/축소' : 'Pinch to zoom';

  return (
    <div className="mobile-swipe-hint">
      <div className="mobile-swipe-hint__row">
        <ChevronDown size={12} />
        <span>{swipeText}</span>
        <ChevronDown size={12} style={{ transform: 'rotate(180deg)' }} />
      </div>
      <div className="mobile-swipe-hint__row mobile-swipe-hint__row--pinch">
        <ZoomIn size={12} />
        <span>{pinchText}</span>
      </div>
    </div>
  );
}

function TransportLegend() {
  const { language } = useI18n();
  const transportData = (citiesData as { transport: Record<string, { ko: string; en: string }> })
    .transport;

  return (
    <Html
      fullscreen
      className="transport-legend-container"
      style={{
        pointerEvents: 'none',
      }}
      zIndexRange={[100, 0]}
    >
      <div className="transport-legend">
        {Object.entries(TRANSPORT_COLORS).map(([key, color]) => {
          if (key === 'start') return null;
          const label = transportData[key] ? transportData[key][language as 'ko' | 'en'] : key;
          return (
            <div key={key} className="transport-legend__item">
              <div className="transport-legend__color" style={{ backgroundColor: color }} />
              <span className="transport-legend__label">{label}</span>
            </div>
          );
        })}
      </div>
    </Html>
  );
}

function Header() {
  const { t } = useI18n();
  return (
    <header className="journey-header">
      <div className="journey-header__brand">
        <Globe size={20} />
        <span>{t('journey.title')}</span>
      </div>
      <LanguageToggle />
    </header>
  );
}

// =============================================================================
// Country Background Component
// =============================================================================

function CountryBackground({ countryCode }: { countryCode: string }) {
  const [currentCode, setCurrentCode] = useState<string>(countryCode);
  const [previousCode, setPreviousCode] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const prevCodeRef = useRef<string>(countryCode);

  const backgrounds = countryBackgrounds as Record<string, BackgroundImage>;

  useEffect(() => {
    // Only trigger transition if country actually changed
    if (countryCode !== prevCodeRef.current) {
      const oldCode = prevCodeRef.current;
      prevCodeRef.current = countryCode;

      // Use requestAnimationFrame to defer state updates
      requestAnimationFrame(() => {
        setPreviousCode(oldCode);
        setCurrentCode(countryCode);
        setTransitioning(true);
      });

      // Match CSS animation duration (1.2s) + buffer
      const timer = setTimeout(() => {
        setTransitioning(false);
        setPreviousCode(null);
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [countryCode]);

  const currentBg = backgrounds[currentCode] || null;
  const previousBg = previousCode ? backgrounds[previousCode] : null;

  if (!currentBg) return null;

  return (
    <div className="country-background">
      {/* Previous background - exits */}
      {previousBg && transitioning && (
        <div
          key={`out-${previousCode}`}
          className="country-background__layer country-background__layer--out"
        >
          <div
            className="country-background__flag"
            style={{ backgroundImage: `url(${previousBg.flag})` }}
          />
          <div
            className="country-background__landmark"
            style={{ backgroundImage: `url(${previousBg.landmark})` }}
          />
        </div>
      )}

      {/* Current background - enters */}
      <div
        key={`in-${currentCode}-${transitioning}`}
        className={`country-background__layer ${transitioning ? 'country-background__layer--in' : ''}`}
      >
        <div
          className="country-background__flag"
          style={{ backgroundImage: `url(${currentBg.flag})` }}
        />
        <div
          className="country-background__landmark"
          style={{ backgroundImage: `url(${currentBg.landmark})` }}
        />
      </div>

      <div className="country-background__blend" />
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function JourneyExperienceContent() {
  const [progress, setProgress] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
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

  // Handle city click for photo gallery
  const handleCityClick = (cityName: string) => {
    setSelectedCity(cityName);
  };

  const handleCloseGallery = () => {
    setSelectedCity(null);
  };

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
      // Allow default scrolling if gallery is open (for thumbnail scroll)
      if (selectedCityRef.current !== null) return;

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

      <CountryBackground countryCode={currentCountry} />

      <div className="canvas-container">
        <Canvas camera={{ position: [-2.5, 3, -3.5], fov: 45 }} gl={{ antialias: true }}>
          <Scene
            progress={progress}
            zoom={zoom}
            isUserInteracting={isUserInteracting}
            onInteraction={handleUserInteraction}
            onCityClick={handleCityClick}
          />
          <WorldBorders countryCode={currentCountry} />
        </Canvas>
      </div>

      <Header />

      <VerticalTimeline currentStopIndex={currentStop} stops={stops} />
      <FlipboardCountry countryCode={currentCountry} />

      {progress < 0.02 && <ScrollHint />}
      {progress < 0.05 && <MobileSwipeHint />}

      {/* About section at starting point */}
      <AboutOverlay visible={currentStop === 0 && progress < 0.03} />

      {/* Photo gallery overlay */}
      <PhotoGallery cityName={selectedCity} onClose={handleCloseGallery} />
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
