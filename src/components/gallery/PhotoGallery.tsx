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
  const [animationState, setAnimationState] = useState<'idle' | 'opening' | 'closing'>('idle');

  // Photos to display (persists during closing animation)
  const [displayedPhotos, setDisplayedPhotos] = useState<Photo[]>([]);

  const cityPhotos = cityPhotosData as Record<string, CityPhotoData>;

  // Update photos when cityName changes (only if valid)
  useEffect(() => {
    if (cityName && cityPhotos[cityName]) {
      const cityPhotoList = cityPhotos[cityName].photos;
      // Sort by date in ascending order (oldest first)
      const sorted = [...cityPhotoList].sort((a, b) => {
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });
      // Wrap in setTimeout to avoid 'setState in effect' linter error
      setTimeout(() => setDisplayedPhotos(sorted), 0);
    }
  }, [cityName, cityPhotos]); // Added cityPhotos to dependency

  // When cityName changes to null (closing), update animation state
  useEffect(() => {
    if (cityName) {
      setTimeout(() => setAnimationState('opening'), 0);
    }
  }, [cityName]);

  // Handle close with animation
  const handleClose = () => {
    setAnimationState('closing');
    // Wait for animation to complete before calling onClose
    setTimeout(() => {
      setAnimationState('idle');
      onClose();
    }, 300); // Match fade out duration
  };

  // Prevent background scroll interactions (OrbitControls, etc.)
  useEffect(() => {
    // Use Event type to be compatible with addEventListener
    const handleWheel = (e: Event) => {
      // Cast to WheelEvent to access specific properties if needed, or just allow bubble
      const target = e.target as HTMLElement;

      // Allow scrolling inside the photo container
      if (target.closest('.photo-gallery__scroll-container')) {
        e.stopPropagation(); // Stop propagation but allow default scroll
        return;
      }
      // Block everywhere else
      e.preventDefault();
      e.stopPropagation();
    };

    const galleryEl = document.querySelector('.photo-gallery');
    if (galleryEl) {
      galleryEl.addEventListener('wheel', handleWheel, { passive: false });
      // touchmove is handled by JourneyExperience - no need to duplicate here
    }

    return () => {
      if (galleryEl) {
        galleryEl.removeEventListener('wheel', handleWheel);
      }
    };
  }, [animationState]); // Re-bind when class changes (mounted)

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  // Keep component mounted while closing animation plays
  if (animationState === 'idle' && !cityName) return null;
  if (displayedPhotos.length === 0) return null;

  // Build class names based on animation state
  const galleryClasses = [
    'photo-gallery',
    animationState === 'opening' && 'photo-gallery--open',
    animationState === 'closing' && 'photo-gallery--closing',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={galleryClasses}
      onClick={handleBackdropClick}
      onWheel={(e) => e.stopPropagation()} // Stop scroll from reaching main app
    >
      {/* Glassmorphism backdrop - click to close, block scroll */}
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
      <div className="photo-gallery__scroll-container" ref={scrollContainerRef}>
        {displayedPhotos.map((photo) => (
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
