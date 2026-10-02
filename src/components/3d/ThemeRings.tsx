/**
 * The cities a chosen theme lights (B1): an ink ring each, sized by how many
 * of its photos are of the theme — the map's proportional symbol, radius ∝ √n
 * so the area is the count. Never filled and never the accent: the one filled
 * mark on the globe is the dot that says where the journey is.
 *
 * A city passed through twice is one ring with the two stays added up; when
 * both stays have the theme, a thin ring goes round it once more (the ×2 of
 * the label, said as a mark).
 *
 * One draw call: every ring is a point, drawn in screen pixels by its own
 * shader, behind the globe's limb it is not drawn at all. The buffers are
 * built when the choice changes and not again.
 */
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface ThemeRing {
  position: THREE.Vector3;
  /** photos of the theme, all stays added */
  n: number;
  /** more than one stay had the theme */
  twice: boolean;
}

const vertex = /* glsl */ `
  attribute float aR;
  attribute float aTwice;
  uniform float uDpr;
  varying float vR;
  varying float vTwice;
  varying float vSize;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // the far side of the globe: not drawn
    float facing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
    vSize = (aR + 6.0) * 2.0;
    vR = aR;
    vTwice = aTwice;
    gl_PointSize = facing > 0.04 ? vSize * uDpr : 0.0;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uGround;
  uniform float uOpacity;
  varying float vR;
  varying float vTwice;
  varying float vSize;
  // a stroke of width w (px) at radius r, antialiased by a pixel
  float stroke(float d, float r, float w) {
    return clamp(w * 0.5 + 0.5 - abs(d - r), 0.0, 1.0);
  }
  void main() {
    float d = length(gl_PointCoord - 0.5) * vSize;
    // a band of the ground under the ring, so it lifts off the route and the dots
    float halo = stroke(d, vR + 1.0, 4.0) * 0.85;
    float ink = stroke(d, vR, 1.5);
    if (vTwice > 0.5) ink = max(ink, stroke(d, vR + 3.2, 0.8));
    float a = max(halo, ink);
    if (a < 0.01) discard;
    vec3 col = mix(uGround, uInk, ink / max(a, 0.0001));
    gl_FragColor = vec4(col, a * uOpacity);
  }
`;

export function ThemeRings({
  rings,
  ink,
  ground,
  k,
  min,
}: {
  rings: ThemeRing[];
  ink: string;
  /** the globe's own colour, for the band under each ring */
  ground: string;
  /** radius in px = k·√n + min */
  k: number;
  min: number;
}) {
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(rings.length * 3);
    const r = new Float32Array(rings.length);
    const twice = new Float32Array(rings.length);
    rings.forEach((ring, i) => {
      pos[i * 3] = ring.position.x;
      pos[i * 3 + 1] = ring.position.y;
      pos[i * 3 + 2] = ring.position.z;
      r[i] = k * Math.sqrt(ring.n) + min;
      twice[i] = ring.twice ? 1 : 0;
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aR', new THREE.BufferAttribute(r, 1));
    g.setAttribute('aTwice', new THREE.BufferAttribute(twice, 1));
    return g;
  }, [rings, k, min]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // made again only when the theme's colours or the screen's density change
        uniforms: {
          uInk: { value: new THREE.Color(ink) },
          uGround: { value: new THREE.Color(ground) },
          uOpacity: { value: 1 },
          uDpr: { value: dpr },
        },
      }),
    [ink, ground, dpr]
  );
  useEffect(() => () => material.dispose(), [material]);

  if (!rings.length) return null;
  // above the route and the city rings, under the dot's own overlay (DOM)
  return <points geometry={geometry} material={material} renderOrder={5} frustumCulled={false} />;
}
