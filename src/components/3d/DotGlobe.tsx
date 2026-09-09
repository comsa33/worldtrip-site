import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import landDots from '../../data/landDots.json';

export const GLOBE_RADIUS = 2;

// Dot colours: land is quiet, countries the trip has reached stay lit, the current one is full ink.
const DOT_BASE = new THREE.Color('#3a3a3a');
const DOT_VISITED = new THREE.Color('#8c8c8c');
const DOT_CURRENT = new THREE.Color('#f2f2f2');
const DOT_SIZE = 0.035; // world units at distance 1

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  uniform float uSize;
  uniform float uScale;
  uniform float uDpr;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // dots sit on a sphere centred at the origin, so the position is the surface normal
    vFacing = normalize(normalMatrix * normalize(position)).z;
    // perspective-scaled, but capped so a zoomed-in globe stays a dot map, not polka dots
    gl_PointSize = clamp(uSize * (uScale / -mv.z), 1.5 * uDpr, 4.5 * uDpr);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    if (dot(p, p) > 0.25) discard;
    // fade dots out toward the limb so the edge of the globe stays clean
    float a = smoothstep(0.0, 0.5, vFacing);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

interface LandDotsData {
  countries: string[]; // visited country codes, index = tag in `dots`
  dots: number[]; // flat triples: lat, lng, countryIndex (-1 = other land)
}

/**
 * Dot-matrix globe: a flat dark sphere with land sampled as a 1° dot grid
 * (src/data/landDots.json, built by scripts/build-geo.mjs). Dots of visited countries
 * brighten as the journey reaches them; the current country renders in full ink.
 */
export function DotGlobe({
  countryCode,
  visitedCodes,
}: {
  countryCode?: string | null;
  visitedCodes: ReadonlySet<string>;
}) {
  const data = landDots as LandDotsData;
  const { size, gl } = useThree();

  const { geometry, tags } = useMemo(() => {
    const n = data.dots.length / 3;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const tags = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const v = latLngToVector3(data.dots[i * 3], data.dots[i * 3 + 1], GLOBE_RADIUS + 0.002);
      positions.set([v.x, v.y, v.z], i * 3);
      colors.set([DOT_BASE.r, DOT_BASE.g, DOT_BASE.b], i * 3);
      tags[i] = data.dots[i * 3 + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    return { geometry: g, tags };
  }, [data.dots]);

  // Recolour dots whenever the current or visited countries change
  useEffect(() => {
    const attr = geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const currentIdx = countryCode ? data.countries.indexOf(countryCode) : -1;
    const visitedIdx = new Set<number>();
    visitedCodes.forEach((code) => {
      const i = data.countries.indexOf(code);
      if (i >= 0) visitedIdx.add(i);
    });
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      const c =
        t === currentIdx ? DOT_CURRENT : t >= 0 && visitedIdx.has(t) ? DOT_VISITED : DOT_BASE;
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    attr.needsUpdate = true;
  }, [geometry, tags, data.countries, countryCode, visitedCodes]);

  const uniforms = useMemo(
    () => ({ uSize: { value: DOT_SIZE }, uScale: { value: 1 }, uDpr: { value: 1 } }),
    []
  );
  // three's point-size scale: half the viewport height in device pixels
  const scale = size.height * 0.5 * gl.getPixelRatio();

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
        <meshBasicMaterial color="#111111" />
      </mesh>
      <points geometry={geometry}>
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          uniforms-uScale-value={scale}
          uniforms-uDpr-value={gl.getPixelRatio()}
          transparent
          depthWrite={false}
        />
      </points>
    </group>
  );
}
