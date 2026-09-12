/**
 * The places that are not a city on the map — a lake, a desert, a border
 * post, a pass — or cities OpenStreetMap has no outline for. Each is drawn as
 * a small line glyph in the ring's place: one stroke or a few, in a box from
 * -1 to 1 with y up, in the same two inks a ring uses.
 */
export type Glyph =
  | 'city'
  | 'island'
  | 'waves'
  | 'lake'
  | 'dune'
  | 'salt'
  | 'falls'
  | 'peak'
  | 'gate'
  | 'ruins';

/** which places are a glyph rather than an outline, and which one */
export const PLACE_GLYPH: Record<string, Glyph> = {
  호치민: 'city',
  다낭: 'city',
  두바이: 'city',
  카르타헤나: 'city',
  발파라이소: 'city',
  엘알토: 'city',
  뚝뚝섬: 'island',
  다합: 'waves',
  파라티: 'waves',
  '바히아 잉글레사': 'waves',
  코파카바나: 'lake',
  '라구나 베르데': 'lake',
  '오르타 호수': 'lake',
  '산 페드로 데 아타카마': 'dune',
  '살바도르 달리 사막': 'dune',
  우유니: 'salt',
  '이과수 폭포': 'falls',
  안나푸르나: 'peak',
  마추픽추: 'peak',
  국경: 'gate',
  함피: 'ruins',
  아잔타: 'ruins',
};

type Pt = [number, number];
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 12): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
const wave = (y: number, x0: number, x1: number, amp: number, n = 16): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / n;
    return [x, y + amp * Math.sin(((x - x0) / (x1 - x0)) * Math.PI * 2)];
  });
const hex = (cx: number, cy: number, r: number): Pt[] => [
  ...arc(cx, cy, r, Math.PI / 6, Math.PI / 6 + Math.PI * 2, 6),
];

/** the strokes of each glyph — polylines, not closed unless they close themselves */
export const GLYPH_STROKES: Record<Glyph, Pt[][]> = {
  city: [
    [
      [-1, -1],
      [-1, 0.1],
      [-0.45, 0.1],
      [-0.45, -1],
    ],
    [
      [-0.15, -1],
      [-0.15, 0.85],
      [0.35, 0.85],
      [0.35, -1],
    ],
    [
      [0.55, -1],
      [0.55, -0.3],
      [1, -0.3],
      [1, -1],
    ],
    [
      [-1, -1],
      [1, -1],
    ],
  ],
  island: [arc(0, -0.15, 0.7, Math.PI, 0), wave(-0.55, -1, 1, 0.13)],
  waves: [wave(0.3, -1, 1, 0.16), wave(-0.35, -1, 1, 0.16)],
  lake: [
    Array.from({ length: 25 }, (_, i): Pt => {
      const a = (i / 24) * Math.PI * 2;
      return [Math.cos(a), 0.55 * Math.sin(a)];
    }),
    wave(-0.05, -0.5, 0.5, 0.1, 8),
  ],
  dune: [
    arc(-0.25, -0.6, 0.9, Math.PI, 0),
    arc(0.5, -0.6, 0.5, Math.PI, 0, 8),
    [
      [-1, -0.6],
      [1, -0.6],
    ],
  ],
  salt: [hex(-0.45, 0.1, 0.5), hex(0.45, -0.35, 0.5)],
  falls: [
    [
      [-0.45, 0.9],
      [-0.45, -0.25],
    ],
    [
      [0, 0.9],
      [0, -0.25],
    ],
    [
      [0.45, 0.9],
      [0.45, -0.25],
    ],
    wave(-0.6, -1, 1, 0.12),
  ],
  peak: [
    [
      [-1, -0.8],
      [-0.35, 0.75],
      [0.05, 0.05],
      [0.35, 0.5],
      [1, -0.8],
    ],
    [
      [-0.55, 0.3],
      [-0.35, 0.75],
      [-0.15, 0.3],
    ],
  ],
  gate: [
    [
      [-0.6, -0.9],
      [-0.6, 0.5],
    ],
    [
      [0.6, -0.9],
      [0.6, 0.5],
    ],
    [
      [-0.8, 0.5],
      [0.8, 0.5],
    ],
    [
      [0, -0.9],
      [0, -0.55],
    ],
    [
      [0, -0.35],
      [0, 0],
    ],
    [
      [0, 0.2],
      [0, 0.45],
    ],
  ],
  ruins: [
    [
      [-0.7, -0.9],
      [-0.7, 0.5],
    ],
    [
      [-0.3, -0.9],
      [-0.3, 0.5],
    ],
    [
      [-0.85, 0.5],
      [-0.15, 0.5],
    ],
    [
      [0.3, -0.9],
      [0.3, 0.1],
    ],
    [
      [0.7, -0.9],
      [0.7, 0.1],
    ],
    [
      [0.15, 0.1],
      [0.85, 0.1],
    ],
    [
      [-1, -0.9],
      [1, -0.9],
    ],
  ],
};
