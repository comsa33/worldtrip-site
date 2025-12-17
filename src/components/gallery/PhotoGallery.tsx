import { useRef, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n';
import cityPhotosData from '../../data/cityPhotos.json';
import './PhotoGallery.css';

interface Photo {
  id: string;
  filename?: string;
  url?: string;
  thumbnail?: string;
  publicId?: string;
  date: string;
  gps?: { lat: number; lng: number } | null;
  caption: { ko: string; en: string };
  alt?: string;
  location?: string;
}

interface CityPhotoData {
  cityCode: string;
  photos: Photo[];
}

interface PhotoGalleryProps {
  cityName: string | null;
  onClose: () => void;
}

export default function PhotoGallery({ cityName, onClose }: PhotoGalleryProps) {
  const { language } = useI18n();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isClosing, setIsClosing] = useState(false);

  const cityPhotos = cityPhotosData as Record<string, CityPhotoData>;

  // Get photos for the current city, sorted by date (chronological)
  const photos = (() => {
    if (!cityName || !cityPhotos[cityName]) return [];
    const cityPhotoList = cityPhotos[cityName].photos;
    // Sort by date in ascending order (oldest first)
    return [...cityPhotoList].sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  })();

  // Control the open state - stay open during closing animation
  const isOpen = !!cityName && !isClosing;

  // Block background scroll when gallery is open
  useEffect(() => {
    if (cityName) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [cityName]);

  // Handle close with animation
  const handleClose = () => {
    setIsClosing(true);
    // Wait for animation to complete before calling onClose
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 400);
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!cityName || photos.length === 0) return null;

  return (
    <div
      className={`photo-gallery ${isOpen ? 'photo-gallery--open' : ''}`}
      onClick={handleBackdropClick}
    >
      {/* Glassmorphism backdrop - click to close */}
      <div className="photo-gallery__backdrop" onClick={handleClose} />

      {/* Close button */}
      <button className="photo-gallery__close" onClick={handleClose}>
        <X size={24} />
      </button>

      {/* Left fade gradient */}
      <div className="photo-gallery__fade-left" />

      {/* Right fade gradient */}
      <div className="photo-gallery__fade-right" />

      {/* Vertical scroll container - Instagram-style feed */}
      <div
        className="photo-gallery__scroll-container"
        ref={scrollContainerRef}
        onClick={(e) => e.stopPropagation()}
      >
        {photos.map((photo) => (
          <div key={photo.id} className="photo-gallery__polaroid">
            <div className="photo-gallery__polaroid-content">
              <img
                src={
                  photo.url
                    ? photo.url.replace('/f_auto,q_auto/', '/f_auto,q_65,w_700/')
                    : photo.url
                }
                alt={photo.caption[language as 'ko' | 'en']}
              />
              <div className="photo-gallery__caption-area">
                <p className="photo-gallery__caption">
                  {photo.caption[language as 'ko' | 'en'] || '\u00A0'}
                </p>
                <div className="photo-gallery__meta">
                  <span className="photo-gallery__date">
                    {photo.date && photo.date.includes('T')
                      ? new Date(photo.date).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : photo.date || ''}
                  </span>
                  {(photo.location || photo.gps) && (
                    <span className="photo-gallery__location">
                      📍{' '}
                      {photo.location ||
                        `${photo.gps!.lat.toFixed(2)}, ${photo.gps!.lng.toFixed(2)}`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
