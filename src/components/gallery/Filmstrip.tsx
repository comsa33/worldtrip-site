import cityPhotosData from '../../data/cityPhotos.json';

interface FilmPhoto {
  id: string;
  thumbnail?: string;
  date: string;
  caption: { ko: string; en: string };
}

const photos = cityPhotosData as Record<string, { photos: FilmPhoto[] }>;

// Cloudinary thumb: 4:3 crop instead of the square marker thumb
const thumb4x3 = (url?: string) =>
  url ? url.replace('w_200,h_200,c_fill', 'w_192,h_144,c_fill') : undefined;

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
