import { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import worldBorders from '../../data/worldBorders.json';

const RADIUS = 2.003;
const INK = '#f2f2f2';

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

interface BorderData {
  borders: number[][][]; // every boundary line as [lng, lat][]
  countries: Record<string, number[][][]>; // visited countries: rings as [lng, lat][]
}

/**
 * Country outlines from Natural Earth 110m (src/data/worldBorders.json, built by
 * scripts/build-geo.mjs). Every boundary is drawn as a faint hairline; the current
 * country is drawn again at full ink.
 */
export function WorldBorders({ countryCode }: { countryCode?: string | null }) {
  const data = worldBorders as BorderData;

  const bordersGeometry = useMemo(() => {
    const pts: number[] = [];
    for (const line of data.borders) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = latLngToVector3(line[i][1], line[i][0], RADIUS);
        const b = latLngToVector3(line[i + 1][1], line[i + 1][0], RADIUS);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [data.borders]);

  const highlight = useMemo(() => {
    const rings = countryCode ? data.countries[countryCode] : undefined;
    if (!rings) return [];
    return rings.map((ring) => ring.map(([lng, lat]) => latLngToVector3(lat, lng, RADIUS + 0.002)));
  }, [data.countries, countryCode]);

  return (
    <group>
      <lineSegments geometry={bordersGeometry}>
        <lineBasicMaterial color={INK} transparent opacity={0.16} depthWrite={false} />
      </lineSegments>
      {highlight.map((path, i) => (
        <Line
          key={`${countryCode}-${i}`}
          points={path}
          color={INK}
          lineWidth={1.25}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      ))}
    </group>
  );
}
