import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Line2 } from 'three-stdlib';
import * as THREE from 'three';
import { GLOBE, type Theme } from '../../theme';
import { handoff, type Outline } from './cityOutlines';
import { GLYPH_STROKES, type Glyph } from './placeGlyphs';
import { Billboard } from '@react-three/drei';

/**
 * A city drawn as itself: its administrative outline on the globe, from
 * OpenStreetMap. One the journey has been to wears the line already walked —
 * the border's weight, in the route's orange; one still ahead is a hairline in
 * the ink the unvisited ring uses.
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
  widthBeen,
  widthAhead,
  blend,
}: {
  outline: Outline;
  been: boolean;
  hovered: boolean;
  theme: Theme;
  widthBeen: number;
  widthAhead: number;
  blend: MutableRefObject<Map<string, number>>;
}) {
  const ref = useRef<Line2>(null);
  const base = hovered ? 1 : been ? 0.9 : 0.35;
  useFrame(() => {
    const m = ref.current?.material;
    if (!m) return;
    const k = blend.current.get(outline.city) ?? 0;
    m.opacity = base * k;
    m.visible = k > 0.001;
  });
  return (
    <Line
      ref={ref}
      points={outline.pairs}
      segments
      color={been ? GLOBE[theme].routePast : GLOBE[theme].ink}
      lineWidth={been ? widthBeen : widthAhead}
      transparent
      opacity={0}
      depthWrite={false}
    />
  );
}

export function CityBounds({
  outlines,
  been,
  hoveredCity,
  theme,
  widthBeen,
  widthAhead,
  blend,
}: {
  outlines: Map<string, Outline>;
  /** whether the journey has been to a city */
  been: (city: string) => boolean;
  hoveredCity: string | null;
  theme: Theme;
  /** the border's base weight — what a visited city's outline is drawn with */
  widthBeen: number;
  /** the weight of the line not yet walked — what a city ahead is drawn with */
  widthAhead: number;
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
          widthBeen={widthBeen}
          widthAhead={widthAhead}
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
