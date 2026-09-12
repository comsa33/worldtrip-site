import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import landDots from '../../data/landDots.json';
import { GLOBE, type Theme } from '../../theme';

export const GLOBE_RADIUS = 2;

const DOT_SIZE = 0.035; // world units at distance 1
// The dots are a tone, not marks: a country the trip has reached reads as a
// lighter surface, never as bigger dots. Only the current one grows, barely.
const SIZE_BASE = 1;
const SIZE_VISITED = 1;
const SIZE_CURRENT = 1.05;

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
  attribute float aSize;
  uniform float uSize;
  uniform float uScale;
  uniform float uDpr;
  uniform float uMax;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // dots sit on a sphere centred at the origin, so the position is the surface normal
    vFacing = normalize(normalMatrix * normalize(position)).z;
    // perspective-scaled, but capped so a zoomed-in globe stays a dot map, not polka dots
    gl_PointSize = clamp(uSize * (uScale / -mv.z), 1.75 * uDpr, uMax * uDpr) * aSize;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uHush;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    // anti-aliased disc
    float d = length(gl_PointCoord - 0.5);
    float disc = 1.0 - smoothstep(0.38, 0.5, d);
    // fade dots out toward the limb so the edge of the globe stays clean
    float a = disc * smoothstep(0.0, 0.5, vFacing) * uHush;
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
/** How far the land steps back while a city is speaking. */
const HUSH = 0.38;

export function DotGlobe({
  countryCode,
  visitedCodes,
  theme,
  hush = false,
}: {
  countryCode?: string | null;
  visitedCodes: ReadonlySet<string>;
  theme: Theme;
  /** a note is up over the map: the land under it goes quieter */
  hush?: boolean;
}) {
  const data = landDots as LandDotsData;
  // Dot colours: land is quiet, countries the trip has reached stay lit, the current one is full ink.
  const palette = GLOBE[theme];
  const DOT_BASE = useMemo(() => new THREE.Color(palette.dotBase), [palette.dotBase]);
  const DOT_VISITED = useMemo(() => new THREE.Color(palette.dotVisited), [palette.dotVisited]);
  const DOT_CURRENT = useMemo(() => new THREE.Color(palette.dotCurrent), [palette.dotCurrent]);
  const { size, gl } = useThree();

  const { geometry, tags } = useMemo(() => {
    const n = data.dots.length / 3;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n).fill(SIZE_BASE);
    const tags = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const v = latLngToVector3(data.dots[i * 3], data.dots[i * 3 + 1], GLOBE_RADIUS + 0.002);
      positions.set([v.x, v.y, v.z], i * 3);
      colors.set([0.4, 0.4, 0.4], i * 3); // recoloured by the effect below
      tags[i] = data.dots[i * 3 + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    return { geometry: g, tags };
  }, [data.dots]);

  // Recolour dots whenever the current or visited countries change
  useEffect(() => {
    const attr = geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const sizeAttr = geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const sizes = sizeAttr.array as Float32Array;
    const currentIdx = countryCode ? data.countries.indexOf(countryCode) : -1;
    const visitedIdx = new Set<number>();
    visitedCodes.forEach((code) => {
      const i = data.countries.indexOf(code);
      if (i >= 0) visitedIdx.add(i);
    });
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      const isCurrent = t === currentIdx;
      const isVisited = t >= 0 && visitedIdx.has(t);
      const c = isCurrent ? DOT_CURRENT : isVisited ? DOT_VISITED : DOT_BASE;
      sizes[i] = isCurrent ? SIZE_CURRENT : isVisited ? SIZE_VISITED : SIZE_BASE;
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    attr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  }, [
    geometry,
    tags,
    data.countries,
    countryCode,
    visitedCodes,
    DOT_BASE,
    DOT_VISITED,
    DOT_CURRENT,
  ]);

  const uniforms = useMemo(
    () => ({
      uSize: { value: DOT_SIZE },
      uScale: { value: 1 },
      uDpr: { value: 1 },
      uMax: { value: 4.5 },
      uHush: { value: 1 },
    }),
    []
  );
  // eased like the borders, so the two layers step back as one
  const material = useRef<THREE.ShaderMaterial>(null);
  useFrame(() => {
    const u = material.current?.uniforms.uHush;
    if (u) u.value += ((hush ? HUSH : 1) - u.value) * 0.12;
  });
  // three's point-size scale: half the viewport height in device pixels
  const scale = size.height * 0.5 * gl.getPixelRatio();
  // Small enough that no single dot is a thing you look at — the surface is a
  // halftone, and the travelling dot is the only dot on it. Phones sit closer
  // to the surface, so smaller still.
  const maxPx = size.width < 768 ? 2.2 : 3;

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
        <meshBasicMaterial color={palette.sphere} />
      </mesh>
      <points geometry={geometry}>
        <shaderMaterial
          ref={material}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          uniforms-uScale-value={scale}
          uniforms-uDpr-value={gl.getPixelRatio()}
          uniforms-uMax-value={maxPx}
          transparent
          depthWrite={false}
        />
      </points>
    </group>
  );
}
