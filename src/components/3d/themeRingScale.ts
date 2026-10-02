/**
 * How large the theme's rings are with the whole globe in view (B2), and how
 * they come together. Here rather than in ThemeRings so the `?tune=1` bench
 * can start from the same numbers the globe does.
 */
export type RingFar = {
  /** radius in px = k·√n + min, and the ring's own line — a phone, and a wider screen */
  phoneK: number;
  phoneMin: number;
  phoneStroke: number;
  deskK: number;
  deskMin: number;
  deskStroke: number;
  /** looking around, the marks grow by this power of how much the map has grown */
  grow: number;
  /** room left between two rings before they are one, px */
  gap: number;
};

export const RING_FAR: RingFar = {
  phoneK: 0.95,
  phoneMin: 1.6,
  phoneStroke: 1.1,
  deskK: 1.6,
  deskMin: 2.6,
  deskStroke: 1.3,
  grow: 0.35,
  gap: 1,
};
