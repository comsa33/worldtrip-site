import { useEffect, useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import cityPhotosData from '../../data/cityPhotos.json';
import './PhotoGallery.css';

interface Photo {
  id: string;
  url?: string;
  thumbnail?: string;
  date: string;
  gps?: { lat: number; lng: number } | null;
  caption: { ko: string; en: string };
  location?: string | null;
}

interface CityPhotoData {
  cityCode: string;
  photos: Photo[];
}

interface PhotoGalleryProps {
  cityName: string | null;
  photoIds?: string[] | null;
  initialPhotoId?: string | null;
  onClose: () => void;
}

const large = (url?: string) => (url ? url.replace('/f_auto,q_auto/', '/f_auto,q_75,w_1600/') : '');

/**
 * Lightbox: one photo at a time in a 1px frame, caption and date underneath,
 * a thumbnail strip to jump around. ← → move, Esc closes.
 */
export default function PhotoGallery({
  cityName,
  photoIds,
  initialPhotoId,
  onClose,
}: PhotoGalleryProps) {
  const { language } = useI18n();
  const lang = language as 'ko' | 'en';
  const cityPhotos = cityPhotosData as Record<string, CityPhotoData>;

  const photos = useMemo(() => {
    if (!cityName || !cityPhotos[cityName]) return [];
    let list = cityPhotos[cityName].photos;
    if (photoIds && photoIds.length > 0) {
      const ids = new Set(photoIds);
      list = list.filter((p) => ids.has(p.id));
    }
    return [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [cityName, photoIds, cityPhotos]);

  const [index, setIndex] = useState(0);
  const openKey = `${cityName}:${initialPhotoId ?? ''}:${photoIds?.join(',') ?? ''}`;
  const [lastKey, setLastKey] = useState(openKey);
  if (openKey !== lastKey) {
    // a new open: start at the requested photo (state reset during render, per React guidance)
    setLastKey(openKey);
    const i = initialPhotoId ? photos.findIndex((p) => p.id === initialPhotoId) : 0;
    setIndex(i >= 0 ? i : 0);
  }

  const count = photos.length;
  const go = (d: number) => setIndex((i) => (count ? (i + d + count) % count : 0));

  useEffect(() => {
    if (!cityName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityName, count, onClose]);

  if (!cityName || count === 0) return null;
  const photo = photos[Math.min(index, count - 1)];
  const date =
    photo.date && photo.date.includes('T')
      ? new Date(photo.date).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : photo.date || '';
  const place =
    photo.location || (photo.gps ? `${photo.gps.lat.toFixed(3)}, ${photo.gps.lng.toFixed(3)}` : '');

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={cityName}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="lightbox__backdrop" onClick={onClose} />

      <div className="lightbox__top mono">
        <span className="lightbox__city">{cityName}</span>
        <span className="lightbox__counter">
          {index + 1} / {count}
        </span>
        <button type="button" className="lightbox__btn" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      <button
        type="button"
        className="lightbox__nav lightbox__nav--prev"
        onClick={() => go(-1)}
        aria-label="Previous"
      >
        <ChevronLeft size={20} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className="lightbox__nav lightbox__nav--next"
        onClick={() => go(1)}
        aria-label="Next"
      >
        <ChevronRight size={20} strokeWidth={1.5} />
      </button>

      <figure className="lightbox__figure">
        <div className="lightbox__frame">
          <img key={photo.id} src={large(photo.url)} alt={photo.caption[lang] || ''} />
        </div>
        <figcaption className="lightbox__caption">
          <span className="lightbox__text">{photo.caption[lang] || ' '}</span>
          <span className="lightbox__meta mono">
            {date}
            {place ? ` · ${place}` : ''}
          </span>
        </figcaption>
      </figure>

      <div className="lightbox__strip">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={`lightbox__thumb${i === index ? ' is-current' : ''}`}
            onClick={() => setIndex(i)}
            aria-label={`${i + 1}`}
          >
            <img src={p.thumbnail} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
    </div>
  );
}
