import cityPhotosData from '../../data/cityPhotos.json';

interface FilmPhoto {
  id: string;
  thumbnail?: string;
  date: string;
  caption: { ko: string; en: string };
}

const photos = cityPhotosData as Record<string, { photos: FilmPhoto[] }>;

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
 * The current city's photos, pinned under the DAY meta. Click one to open it in the gallery.
 */
export function Filmstrip({
  cityName,
  language,
  onOpen,
}: {
  cityName: string;
  language: 'ko' | 'en';
  onOpen: (cityName: string, photoId: string) => void;
}) {
  const list = photos[cityName]?.photos;
  if (!list || list.length === 0) return null;
  const sorted = [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const shown = sorted.slice(0, 4);
  return (
    <div className="filmstrip" aria-label={`${cityName} photos`}>
      <button
        type="button"
        className="filmstrip__count mono"
        onClick={() => onOpen(cityName, sorted[0].id)}
      >
        {sorted.length} photos
      </button>
      <div className="filmstrip__row">
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
      </div>
    </div>
  );
}
