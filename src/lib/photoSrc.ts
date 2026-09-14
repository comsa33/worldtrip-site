/** Widths worth asking Cloudinary for. Anything between rounds up to the next one. */
const STEPS = [480, 640, 800, 1000, 1280, 1600, 2048, 2560];

/**
 * One source at the size it will actually be drawn, capped at the original.
 * Asking for a single 1600px file meant every phone paid for pixels it threw
 * away, and every retina desktop got less than it needed.
 */
export function srcFor(p: { url?: string; w?: number }, cssWidth: number): string {
  if (!p.url) return '';
  const want = cssWidth * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const step = STEPS.find((s) => s >= want) ?? STEPS[STEPS.length - 1];
  const w = p.w ? Math.min(step, p.w) : step;
  return p.url.replace('/f_auto,q_auto/', `/f_auto,q_auto:good,w_${w}/`);
}
