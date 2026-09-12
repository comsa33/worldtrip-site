import { useRef } from 'react';
import { photosForStop } from '../../lib/visitPhotos';

/** How many frames the strip shows before the tail takes over. */
const SHOWN = 4;

/**
 * Cloudinary thumb: a 4:3 crop at the size it is actually drawn (64x48 CSS px,
 * 48x36 on a phone) for this screen's density, instead of the square 200x200
 * marker thumb scaled down in the browser.
 */
const thumb4x3 = (url?: string) => {
  if (!url) return undefined;
  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 3);
  return url.replace(
    'w_200,h_200,c_fill',
    `w_${Math.round(64 * dpr)},h_${Math.round(48 * dpr)},c_fill`
  );
};

/**
 * The photos from the visit being shown, pinned under the DAY meta: a short
 * piece of film. A city passed through twice keeps its two rolls apart — the
 * strip is the stop's, not the city's, so standing in Varanasi in October is
 * no longer handed the photos from the return in November.
 * The frame nearest the pointer lifts a little, the way a dock does — kept
 * small on purpose. The tail says how many more there are, once. The strip is
 * keyed on the stop, so each arrival winds the new roll in from the side.
 * Click anything to open the photo book there.
 */
export function Filmstrip({
  cityName,
  stopId,
  language,
  onOpen,
}: {
  cityName: string;
  stopId: number;
  language: 'ko' | 'en';
  onOpen: (cityName: string, photoId: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // already in date order, and empty for a stop nobody photographed: six of the
  // 155 are border runs and one-night returns, and they simply show no strip
  const sorted = photosForStop(stopId);
  if (sorted.length === 0) return null;
  const shown = sorted.slice(0, SHOWN);
  const rest = sorted.length - shown.length;

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const row = rowRef.current;
    if (!row) return;
    const rr = row.getBoundingClientRect();
    const x = e.clientX - rr.left;
    row.querySelectorAll<HTMLElement>('.filmstrip__thumb').forEach((f) => {
      const c = f.offsetLeft + f.offsetWidth / 2;
      const k = Math.max(0, 1 - Math.abs(x - c) / 110);
      f.style.transform = `translateY(${(-4 * k).toFixed(2)}px) scale(${(1 + 0.1 * k).toFixed(3)})`;
      f.style.zIndex = k > 0.45 ? '2' : '';
    });
  };
  const onLeave = () => {
    rowRef.current?.querySelectorAll<HTMLElement>('.filmstrip__thumb').forEach((f) => {
      f.style.transform = '';
      f.style.zIndex = '';
    });
  };

  return (
    <div className="filmstrip" aria-label={`${cityName} photos`}>
      <button
        type="button"
        className="filmstrip__count mono"
        onClick={() => onOpen(cityName, sorted[0].id)}
      >
        {sorted.length} photos
      </button>
      <div
        key={stopId}
        className="filmstrip__row"
        ref={rowRef}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      >
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            className="filmstrip__thumb"
            onClick={() => onOpen(cityName, p.id)}
            aria-label={p.caption[language] || p.id}
          >
            <img src={thumb4x3(p.thumbnail)} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
        {rest > 0 && (
          <button
            type="button"
            className="filmstrip__more mono"
            onClick={() => onOpen(cityName, sorted[SHOWN].id)}
            aria-label={`${rest} more`}
          >
            <span>+{rest}</span>
          </button>
        )}
      </div>
    </div>
  );
}
