/**
 * The marks for places that are not a city on the map — the conventions a
 * topographic map has used for a century, and nothing else: △ a summit, □ a
 * site, ○ with a waterline for water, a dashed ○ for desert, two ticks for a
 * border post. A city with no outline keeps the plain ring. Every mark is
 * one line weight, no fill, in the ring's own box (−1 to 1, y up) and the
 * ring's two inks.
 */
export type Glyph = 'peak' | 'site' | 'water' | 'desert' | 'gate';

/** which places wear a mark instead of a ring */
export const PLACE_GLYPH: Record<string, Glyph> = {
  안나푸르나: 'peak',
  마추픽추: 'peak',
  함피: 'site',
  아잔타: 'site',
  뚝뚝섬: 'water',
  다합: 'water',
  파라티: 'water',
  '바히아 잉글레사': 'water',
  코파카바나: 'water',
  '라구나 베르데': 'water',
  '오르타 호수': 'water',
  '이과수 폭포': 'water',
  '산 페드로 데 아타카마': 'desert',
  '살바도르 달리 사막': 'desert',
  우유니: 'desert',
  국경: 'gate',
};

/** cities whose fetched outline is the wrong shape (a district, a province) — ring instead */
export const OUTLINE_SKIP = new Set(['엘알토']);

type Pt = [number, number];
const arc = (r: number, a0: number, a1: number, n = 10): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
const circle = (r: number): Pt[] => arc(r, 0, Math.PI * 2, 28);

/** the strokes of each mark — polylines in the ring's box */
export const GLYPH_STROKES: Record<Glyph, Pt[][]> = {
  peak: [
    [
      [0, 0.95],
      [0.92, -0.7],
      [-0.92, -0.7],
      [0, 0.95],
    ],
  ],
  site: [
    [
      [-0.76, -0.76],
      [0.76, -0.76],
      [0.76, 0.76],
      [-0.76, 0.76],
      [-0.76, -0.76],
    ],
  ],
  water: [
    circle(0.92),
    [
      [-0.52, -0.14],
      [0.52, -0.14],
    ],
  ],
  // four dashes, each just over half a quadrant
  desert: [0, 1, 2, 3].map((q) => arc(0.92, (q * Math.PI) / 2 + 0.2, (q * Math.PI) / 2 + 1.15, 5)),
  gate: [
    [
      [-0.32, -0.8],
      [-0.32, 0.8],
    ],
    [
      [0.32, -0.8],
      [0.32, 0.8],
    ],
  ],
};
