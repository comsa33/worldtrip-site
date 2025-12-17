import { useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';

// Extracted from Globe.tsx to solve import issues
function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// Chaikin's smoothing algorithm
function smoothRing(points: number[][], iterations: number = 3): number[][] {
  let current = points;

  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 3) break;
    const next: number[][] = [];
    // Handle closed loop property (GeoJSON rings are closed)
    // We process segments. For a closed loop of N points (0..N-1 where 0==N-1),
    // we effectively have N-1 segments.

    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];

      // Cut corner at 25% and 75%
      next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
      next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
    }

    // Close the loop explicitly by connecting last generated point to first?
    // GeoJSON polygons must have first point == last point.
    // Our 'next' array generated points along the segments.
    // The last segment (N-2 to N-1) generated 2 points.
    // To close it properly, we just need to ensure the ring starts and ends effectively.
    // Simple approach: Close the ring by appending the first point.
    next.push(next[0]);
    current = next;
  }
  return current;
}

interface FeatureProperties {
  ISO_A2?: string;
  ISO_A3?: string;
  ADM0_A3?: string;
  [key: string]: unknown;
}

interface GeoJsonFeature {
  type: string;
  properties: FeatureProperties;
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

interface GeoJsonData {
  type: string;
  features: GeoJsonFeature[];
}

// World Borders Component
export function WorldBorders({ countryCode }: { countryCode?: string | null }) {
  const [data, setData] = useState<GeoJsonData | null>(null);

  useEffect(() => {
    // Try primary source (GitHub Raw)
    fetch(
      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then((d: GeoJsonData) => setData(d))
      .catch((err) => {
        console.warn('Failed to load borders fallback...', err);
        fetch(
          'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson'
        )
          .then((res) => res.json())
          .then(setData)
          .catch((e) => console.error('Border fallback failed', e));
      });
  }, []);

  const borderPaths = useMemo(() => {
    if (!data || !countryCode) return [];

    const paths: THREE.Vector3[][] = [];
    const radius = 2.002; // Close to surface

    const ISO2_TO_3: Record<string, string> = { FR: 'FRA', NO: 'NOR' };
    const targetISO3 = countryCode ? ISO2_TO_3[countryCode] || countryCode : null;

    data.features.forEach((feature: GeoJsonFeature) => {
      const props = feature.properties;
      const matches =
        props.ISO_A2 === countryCode ||
        props.ISO_A3 === countryCode ||
        props.ADM0_A3 === countryCode ||
        (targetISO3 && (props.ISO_A3 === targetISO3 || props.ADM0_A3 === targetISO3));

      if (!matches) return;

      const geometry = feature.geometry;
      const coordinates = geometry.coordinates;

      const processRing = (ring: number[][]) => {
        // Reduced smoothing for less vertices -> less dots? or more smoothing for curves?
        // 2 iterations is good balance
        const smoothed = smoothRing(ring, 2);
        const points = smoothed.map(([lng, lat]) => latLngToVector3(lat, lng, radius));
        paths.push(points);
      };

      if (geometry.type === 'Polygon') {
        coordinates.forEach(processRing);
      } else if (geometry.type === 'MultiPolygon') {
        coordinates.forEach((polygon: number[][][]) => {
          polygon.forEach(processRing);
        });
      }
    });

    return paths;
  }, [data, countryCode]);

  if (borderPaths.length === 0) return null;

  return (
    <group>
      {borderPaths.map((path, i) => (
        <group key={i}>
          {/* Outer Glow: Wide and faint */}
          <Line
            points={path}
            color="#00e5ff"
            opacity={0.3} // Reduced from 0.15 (additive is brighter)
            transparent
            lineWidth={6}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
          {/* Inner Glow: Medium and brighter */}
          <Line
            points={path}
            color="#00e5ff"
            opacity={0.6} // Reduced (additive is brighter)
            transparent
            lineWidth={3}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
          {/* Core Outline: Thin and white-hot */}
          <Line
            points={path}
            color="#e0ffff"
            opacity={1}
            transparent
            lineWidth={1}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </group>
      ))}
    </group>
  );
}
