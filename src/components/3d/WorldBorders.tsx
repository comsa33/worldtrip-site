import { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import worldBorders from '../../data/worldBorders.json';
import { GLOBE, type Theme } from '../../theme';
import { TUNE_ON, defaults, useTuning } from './routeTuning';

const RADIUS = 2.003;
/**
 * How far the current country's outline sits above the rest, so the two do not
 * fight for the same depth. It has to be enough to win the depth test and no
 * more: at 0.002 the parallax was a visible gap at close zoom and the one
 * border read as two lines side by side.
 */
const LIFT = 0.0004;

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
 * scripts/build-geo.mjs). Every boundary is drawn faintly; the current country is
 * drawn again at full ink and heavier still.
 *
 * Both are drawn as fat lines rather than as raw `lineSegments`, because WebGL
 * ignores a line material's width — everything came out one device pixel however
 * thin the screen's pixels were, which is a hairline on a laptop and a thread on
 * anything retina. 78,658 boundary segments is one instanced draw, which the GPU
 * does not notice; the cost is the geometry built once at mount.
 */
export function WorldBorders({
  countryCode,
  theme,
}: {
  countryCode?: string | null;
  theme: Theme;
}) {
  const data = worldBorders as BorderData;
  const INK = GLOBE[theme].ink;
  const tuned = useTuning();
  const w = TUNE_ON ? tuned : defaults(theme);

  // pairs of points: every boundary segment, laid end to end for `segments`
  const borderPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (const line of data.borders) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = latLngToVector3(line[i][1], line[i][0], RADIUS);
        const b = latLngToVector3(line[i + 1][1], line[i + 1][0], RADIUS);
        pts.push([a.x, a.y, a.z], [b.x, b.y, b.z]);
      }
    }
    return pts;
  }, [data.borders]);

  const highlight = useMemo(() => {
    const rings = countryCode ? data.countries[countryCode] : undefined;
    if (!rings) return [];
    return rings.map((ring) => ring.map(([lng, lat]) => latLngToVector3(lat, lng, RADIUS + LIFT)));
  }, [data.countries, countryCode]);

  return (
    <group>
      {/* Every border, legible on its own: the map has to read as a map before
          the current country reads as the current one. Hairlines lose a lot of
          ink on a light ground, so light mode gets more. */}
      <Line
        points={borderPoints}
        segments
        color={INK}
        lineWidth={w.borderBase}
        transparent
        opacity={theme === 'light' ? 0.55 : 0.42}
        depthWrite={false}
      />
      {highlight.map((path, i) => (
        <Line
          key={`${countryCode}-${i}`}
          points={path}
          color={INK}
          lineWidth={w.borderActive}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      ))}
    </group>
  );
}
