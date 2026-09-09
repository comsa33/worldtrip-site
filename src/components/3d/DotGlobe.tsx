import { useMemo } from 'react';
import * as THREE from 'three';
import landDots from '../../data/landDots.json';

export const GLOBE_RADIUS = 2;

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// Round sprite so land dots render as circles instead of squares
function makeDotTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Dot-matrix globe: a flat dark sphere with land sampled as a 1.25° dot grid
 * (src/data/landDots.json, built by scripts/build-geo.mjs). No texture, no atmosphere.
 */
export function DotGlobe() {
  const geometry = useMemo(() => {
    const coords = landDots as number[];
    const positions = new Float32Array((coords.length / 2) * 3);
    for (let i = 0; i < coords.length; i += 2) {
      const v = latLngToVector3(coords[i], coords[i + 1], GLOBE_RADIUS + 0.002);
      positions.set([v.x, v.y, v.z], (i / 2) * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  const texture = useMemo(() => makeDotTexture(), []);

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
        <meshBasicMaterial color="#111111" />
      </mesh>
      <points geometry={geometry}>
        <pointsMaterial
          color="#6a6a6a"
          size={0.035}
          sizeAttenuation
          map={texture}
          alphaTest={0.5}
          transparent
          depthWrite={false}
        />
      </points>
    </group>
  );
}
