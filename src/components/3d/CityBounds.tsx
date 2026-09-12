import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { GLOBE, type Theme } from '../../theme';
import { handoff, type Outline } from './cityOutlines';
import { GLYPH_STROKES, type Glyph } from './placeGlyphs';
import { Billboard } from '@react-three/drei';

/**
 * A city drawn as itself: the ground its administrative boundary covers, from
 * OpenStreetMap, washed over the globe. One the journey has been to is tinted in
 * the route's orange; one still ahead is a breath of ink.
 *
 * It was an outline once, and the outline was the problem: a hairline round a
 * city and a hairline for the road between cities are the same material, and
 * telling them apart by weight alone asked more of the eye than it should. A
 * wash is not a line at all, so there is nothing to confuse it with — and the
 * route, drawn over it, has the only lines on the map to itself.
 *
 * An outline is true to scale, and a ring is not. Close up a city is a shape
 * you can read; from a long hop's height it is a few pixels, and there the
 * ring has to say where it is. So each city is both, and which one you see
 * is decided by how big the outline is on screen right now: below ~10px it is
 * all ring, above ~24px all outline, and between them the two hand over — the
 * ring opening out to the outline's size as it fades, the outline arriving
 * inside it. The blend is written to `handoff` every frame for the rings.
 */

function CityOutline({
  outline,
  been,
  hovered,
  theme,
  fillBeen,
  fillAhead,
  fillHover,
  blend,
}: {
  outline: Outline;
  been: boolean;
  hovered: boolean;
  theme: Theme;
  /** how much ink a wash carries — set by eye in the `?tune=1` bench */
  fillBeen: number;
  fillAhead: number;
  fillHover: number;
  blend: MutableRefObject<Map<string, number>>;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const base = hovered ? fillHover : been ? fillBeen : fillAhead;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(outline.fill, 3));
    return g;
  }, [outline.fill]);
  useFrame(() => {
    const m = ref.current?.material as THREE.Material | undefined;
    if (!m) return;
    const k = blend.current.get(outline.city) ?? 0;
    m.opacity = base * k;
    m.visible = k > 0.001;
  });
  return (
    <mesh ref={ref} geometry={geometry} renderOrder={-1}>
      <meshBasicMaterial
        color={been ? GLOBE[theme].routePast : GLOBE[theme].ink}
        transparent
        opacity={0}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function CityBounds({
  outlines,
  been,
  hoveredCity,
  theme,
  fillBeen,
  fillAhead,
  fillHover,
  blend,
}: {
  outlines: Map<string, Outline>;
  /** whether the journey has been to a city */
  been: (city: string) => boolean;
  hoveredCity: string | null;
  theme: Theme;
  /** how much ink the wash carries — a city been to, one ahead, one under the hand */
  fillBeen: number;
  fillAhead: number;
  fillHover: number;
  /** written every frame: city → how far it has handed over from ring to outline */
  blend: MutableRefObject<Map<string, number>>;
}) {
  const { camera, size } = useThree();

  // the handoff, decided once a frame for every city from the outline's size on screen
  useFrame(() => {
    const fov = ((camera as THREE.PerspectiveCamera).fov ?? 45) * (Math.PI / 180);
    const eye = camera.position;
    const eyeDir = eye.clone().normalize();
    for (const o of outlines.values()) {
      // the far side of the world has nothing to hand over
      if (o.center.clone().normalize().dot(eyeDir) < -0.1) {
        blend.current.set(o.city, 0);
        continue;
      }
      const dist = eye.distanceTo(o.center);
      const px = ((2 * o.reach) / (dist * Math.tan(fov / 2))) * (size.height / 2);
      blend.current.set(o.city, handoff(px));
    }
  });

  return (
    <group>
      {[...outlines.values()].map((o) => (
        <CityOutline
          key={o.city}
          outline={o}
          been={been(o.city)}
          hovered={hoveredCity === o.city}
          theme={theme}
          fillBeen={fillBeen}
          fillAhead={fillAhead}
          fillHover={fillHover}
          blend={blend}
        />
      ))}
    </group>
  );
}

/**
 * A place drawn as a glyph, in the ring's place and the ring's two inks: a
 * lake, a desert, a pass — or a city with no outline to draw. Thinner than
 * any route line, so it reads as a mark on the map, not a road.
 */
export function PlaceGlyph({
  glyph,
  size,
  been,
  hovered,
  theme,
  width,
}: {
  glyph: Glyph;
  /** half the glyph's extent, in the marker group's units */
  size: number;
  been: boolean;
  hovered: boolean;
  theme: Theme;
  width: number;
}) {
  const pairs = useMemo(() => {
    const out: [number, number, number][] = [];
    for (const stroke of GLYPH_STROKES[glyph]) {
      for (let i = 0; i < stroke.length - 1; i++) {
        out.push(
          [stroke[i][0] * size, stroke[i][1] * size, 0],
          [stroke[i + 1][0] * size, stroke[i + 1][1] * size, 0]
        );
      }
    }
    return out;
  }, [glyph, size]);
  return (
    <Billboard>
      <Line
        points={pairs}
        segments
        color={been ? GLOBE[theme].routePast : GLOBE[theme].ink}
        lineWidth={width}
        transparent
        opacity={hovered ? 1 : been ? 0.9 : 0.35}
        depthWrite={false}
      />
    </Billboard>
  );
}
