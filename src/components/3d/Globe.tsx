import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sphere, Line, Html, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { useNavigate } from 'react-router-dom';
import countriesData from '../../data/countries.json';
import journeyData from '../../data/journey.json';
import type { Country } from '../../types';
import './Globe.css';

// Convert lat/lng to 3D coordinates
function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);

  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// Generate arc curve between two points
function generateArcPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  segments: number = 64
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const midPoint = start.clone().add(end).multiplyScalar(0.5);
  const distance = start.distanceTo(end);
  midPoint.normalize().multiplyScalar(2.2 + distance * 0.25);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = new THREE.Vector3();

    point.x = (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * midPoint.x + t * t * end.x;
    point.y = (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * midPoint.y + t * t * end.y;
    point.z = (1 - t) * (1 - t) * start.z + 2 * (1 - t) * t * midPoint.z + t * t * end.z;

    points.push(point);
  }

  return points;
}

// Country Marker Component
interface MarkerProps {
  country: Country;
  position: THREE.Vector3;
  onHover: (country: Country | null) => void;
  onClick: (country: Country) => void;
  isHovered: boolean;
  index: number;
}

function CountryMarker({ country, position, onHover, onClick, isHovered, index }: MarkerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), index * 50);
    return () => clearTimeout(timer);
  }, [index]);

  useFrame((state) => {
    if (ringRef.current) {
      ringRef.current.rotation.z = state.clock.elapsedTime * 0.5;
    }
    if (groupRef.current) {
      const scale = isHovered ? 1.8 : 1;
      groupRef.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.1);
    }
  });

  const color = new THREE.Color(country.theme.primary);

  if (!visible) return null;

  return (
    <group ref={groupRef} position={position}>
      {/* Outer ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.045, 0.055, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isHovered ? 0.8 : 0.4}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Center dot */}
      <mesh
        onPointerEnter={(e) => {
          e.stopPropagation();
          onHover(country);
          document.body.style.cursor = 'pointer';
        }}
        onPointerLeave={() => {
          onHover(null);
          document.body.style.cursor = 'auto';
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(country);
        }}
      >
        <sphereGeometry args={[0.03, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Glow effect */}
      {isHovered && (
        <mesh>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.2} />
        </mesh>
      )}

      {/* Label */}
      {isHovered && (
        <Html distanceFactor={8} style={{ pointerEvents: 'none' }}>
          <div className="globe-tooltip">
            <span className="globe-tooltip__name">{country.name.ko}</span>
            <span className="globe-tooltip__days">{country.stats.days}일</span>
          </div>
        </Html>
      )}
    </group>
  );
}

// Travel Arc Component with animation
interface ArcProps {
  from: Country;
  to: Country;
  index: number;
}

function TravelArc({ from, to, index }: ArcProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const delay = index * 100;
    const timer = setTimeout(() => {
      const animate = () => {
        setProgress((p) => {
          if (p >= 1) return 1;
          return p + 0.02;
        });
      };
      const interval = setInterval(animate, 16);
      setTimeout(() => clearInterval(interval), 1000);
    }, delay);
    return () => clearTimeout(timer);
  }, [index]);

  const points = useMemo(() => {
    const start = latLngToVector3(from.coordinates.lat, from.coordinates.lng, 2);
    const end = latLngToVector3(to.coordinates.lat, to.coordinates.lng, 2);
    return generateArcPoints(start, end);
  }, [from, to]);

  const visiblePoints = useMemo(() => {
    const count = Math.floor(points.length * progress);
    return points.slice(0, Math.max(count, 2));
  }, [points, progress]);

  return <Line points={visiblePoints} color="#2997ff" lineWidth={1.5} transparent opacity={0.5} />;
}

// Earth with realistic texture
function Earth() {
  const meshRef = useRef<THREE.Mesh>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.0005;
    }
    if (cloudsRef.current) {
      cloudsRef.current.rotation.y += 0.0007;
    }
  });

  return (
    <group>
      {/* Main Earth */}
      <Sphere ref={meshRef} args={[2, 128, 128]}>
        <meshStandardMaterial color="#1a3a5c" roughness={0.9} metalness={0.1} />
      </Sphere>

      {/* Atmosphere glow */}
      <Sphere args={[2.05, 64, 64]}>
        <meshBasicMaterial color="#2997ff" transparent opacity={0.05} side={THREE.BackSide} />
      </Sphere>

      {/* Continents overlay - simplified geometry approach */}
      <Sphere args={[2.01, 64, 64]}>
        <meshStandardMaterial
          color="#2a4a6c"
          roughness={0.8}
          metalness={0.1}
          transparent
          opacity={0.3}
          wireframe
        />
      </Sphere>
    </group>
  );
}

// Globe Grid with subtle styling
function GlobeGrid() {
  const gridLines = useMemo(() => {
    const lines: THREE.Vector3[][] = [];
    const radius = 2.005;

    // Only major latitude lines
    for (let lat = -60; lat <= 60; lat += 30) {
      const points: THREE.Vector3[] = [];
      for (let lng = 0; lng <= 360; lng += 3) {
        points.push(latLngToVector3(lat, lng, radius));
      }
      lines.push(points);
    }

    // Only major longitude lines
    for (let lng = 0; lng < 360; lng += 30) {
      const points: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 3) {
        points.push(latLngToVector3(lat, lng, radius));
      }
      lines.push(points);
    }

    return lines;
  }, []);

  return (
    <>
      {gridLines.map((points, index) => (
        <Line
          key={index}
          points={points}
          color="#ffffff"
          lineWidth={0.3}
          transparent
          opacity={0.06}
        />
      ))}
    </>
  );
}

// Main Globe Scene
function GlobeScene() {
  const navigate = useNavigate();
  const [hoveredCountry, setHoveredCountry] = useState<Country | null>(null);

  const countries = countriesData.countries as Country[];
  const stops = journeyData.stops;

  const countryPositions = useMemo(() => {
    return countries.map((country) => ({
      country,
      position: latLngToVector3(country.coordinates.lat, country.coordinates.lng, 2.08),
    }));
  }, [countries]);

  const arcs = useMemo(() => {
    const result: { from: Country; to: Country }[] = [];

    for (let i = 0; i < stops.length - 1; i++) {
      const fromCountry = countries.find((c) => c.code === stops[i].countryCode);
      const toCountry = countries.find((c) => c.code === stops[i + 1].countryCode);

      if (fromCountry && toCountry && fromCountry.code !== toCountry.code) {
        const exists = result.some(
          (r) =>
            (r.from.code === fromCountry.code && r.to.code === toCountry.code) ||
            (r.from.code === toCountry.code && r.to.code === fromCountry.code)
        );
        if (!exists) {
          result.push({ from: fromCountry, to: toCountry });
        }
      }
    }

    return result;
  }, [countries, stops]);

  const handleCountryClick = useCallback(
    (country: Country) => {
      navigate(`/countries/${country.slug}`);
    },
    [navigate]
  );

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 3, 5]} intensity={0.8} color="#ffffff" />
      <directionalLight position={[-5, -3, -5]} intensity={0.3} color="#2997ff" />
      <pointLight position={[0, 0, 5]} intensity={0.5} color="#ffffff" />
      {/* Stars */}
      <Stars radius={200} depth={100} count={3000} factor={3} saturation={0} fade speed={0.5} />
      // ... existing code ...
      {/* Earth */}
      <Earth />
      <GlobeGrid />
      {/* Arcs */}
      {arcs.map((arc, index) => (
        <TravelArc
          key={`${arc.from.code}-${arc.to.code}`}
          from={arc.from}
          to={arc.to}
          index={index}
        />
      ))}
      {/* Markers */}
      {countryPositions.map(({ country, position }, index) => (
        <CountryMarker
          key={country.code}
          country={country}
          position={position}
          onHover={setHoveredCountry}
          onClick={handleCountryClick}
          isHovered={hoveredCountry?.code === country.code}
          index={index}
        />
      ))}
      {/* Controls */}
      <OrbitControls
        enableZoom={true}
        enablePan={false}
        minDistance={3.5}
        maxDistance={7}
        autoRotate
        autoRotateSpeed={0.3}
        rotateSpeed={0.5}
        zoomSpeed={0.5}
      />
    </>
  );
}

// Main Globe Component
export default function Globe() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`globe-container ${isLoaded ? 'globe-container--loaded' : ''}`}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        style={{ background: 'transparent' }}
        gl={{ antialias: true, alpha: true }}
      >
        <GlobeScene />
      </Canvas>

      {/* Stats Overlay */}
      <div className="globe-stats-panel glass-card">
        <div className="globe-stat">
          <span className="globe-stat__value">{journeyData.totalCountries}</span>
          <span className="globe-stat__label">Countries</span>
        </div>
        <div className="globe-stats-divider" />
        <div className="globe-stat">
          <span className="globe-stat__value">{journeyData.totalDays}</span>
          <span className="globe-stat__label">Days</span>
        </div>
        <div className="globe-stats-divider" />
        <div className="globe-stat">
          <span className="globe-stat__value">5</span>
          <span className="globe-stat__label">Continents</span>
        </div>
      </div>

      {/* Interaction hint */}
      <div className="globe-hint">
        <span>Drag to rotate • Scroll to zoom • Click marker to explore</span>
      </div>
    </div>
  );
}
