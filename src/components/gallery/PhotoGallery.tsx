import { useState, useMemo, useEffect } from 'react';
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
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [isPhotoZooming, setIsPhotoZooming] = useState(false);

  const cityPhotos = cityPhotosData as Record<string, CityPhotoData>;

  // Get photos for the current city
  const photos = useMemo(() => {
    if (!cityName || !cityPhotos[cityName]) return [];
    return cityPhotos[cityName].photos;
  }, [cityName, cityPhotos]);

  // Derive entering state from cityName (no useEffect needed)
  const isEntering = !!cityName;

  // Preload first few thumbnails for instant display
  useEffect(() => {
    if (photos.length > 0) {
      photos.slice(0, 4).forEach((photo) => {
        if (photo.thumbnail) {
          const img = new Image();
          img.src = photo.thumbnail;
        }
      });
    }
  }, [photos]);

  // Handle thumbnail click
  const handleThumbnailClick = (photo: Photo) => {
    setIsPhotoZooming(true);
    setSelectedPhoto(photo);

    // Preload current and adjacent photos for instant switching
    const currentIndex = photos.findIndex((p) => p.id === photo.id);
    const photosToPreload = [
      photo, // Current
      photos[currentIndex - 1], // Previous
      photos[currentIndex + 1], // Next
    ].filter(Boolean);

    photosToPreload.forEach((p) => {
      if (p?.url) {
        const img = new Image();
        img.src = p.url.replace('/f_auto,q_auto/', '/f_auto,q_65,w_700/');
      }
    });
  };

  // Handle close photo
  const handleClosePhoto = () => {
    setIsPhotoZooming(false);
    setTimeout(() => setSelectedPhoto(null), 300);
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      if (selectedPhoto) {
        handleClosePhoto();
      } else {
        onClose();
      }
    }
  };

  // Handle horizontal scroll with mouse wheel on thumbnail bar
  const handleThumbnailWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // Convert vertical wheel to horizontal scroll
    e.currentTarget.scrollLeft += e.deltaY;
    e.preventDefault();
  };

  if (!cityName || photos.length === 0) return null;

  return (
    <div
      className={`photo-gallery ${isEntering ? 'photo-gallery--open' : ''}`}
      onClick={handleBackdropClick}
    >
      {/* Glassmorphism backdrop - click to close */}
      <div className="photo-gallery__backdrop" onClick={onClose} />

      {/* Close button */}
      <button className="photo-gallery__close" onClick={onClose}>
        <X size={24} />
      </button>

      {/* Horizontal thumbnail bar */}
      <div className="photo-gallery__circle" onWheel={handleThumbnailWheel}>
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            className={`photo-gallery__thumbnail ${selectedPhoto?.id === photo.id ? 'photo-gallery__thumbnail--selected' : ''}`}
            style={{ '--delay': `${index * 0.08}s` } as React.CSSProperties}
            onClick={() => handleThumbnailClick(photo)}
          >
            <img
              src={photo.thumbnail?.replace('w_200,h_200', 'w_120,h_120')}
              alt={photo.caption[language as 'ko' | 'en']}
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {/* Center photo viewer - Polaroid style */}
      {selectedPhoto && (
        <div
          className={`photo-gallery__viewer ${isPhotoZooming ? 'photo-gallery__viewer--zoomed' : ''}`}
          onClick={handleClosePhoto}
        >
          <div className="photo-gallery__viewer-content">
            <img
              src={
                selectedPhoto.url
                  ? selectedPhoto.url.replace('/f_auto,q_auto/', '/f_auto,q_65,w_700/')
                  : selectedPhoto.url
              }
              alt={selectedPhoto.caption[language as 'ko' | 'en']}
            />
            <div className="photo-gallery__caption-area">
              <p className="photo-gallery__caption">
                {selectedPhoto.caption[language as 'ko' | 'en']}
              </p>
              {selectedPhoto.alt &&
                selectedPhoto.alt !== selectedPhoto.caption[language as 'ko' | 'en'] && (
                  <p className="photo-gallery__alt">{selectedPhoto.alt}</p>
                )}
              <div className="photo-gallery__meta">
                {selectedPhoto.date && (
                  <span className="photo-gallery__date">
                    {selectedPhoto.date.includes('T')
                      ? new Date(selectedPhoto.date).toLocaleString(
                          language === 'ko' ? 'ko-KR' : 'en-US',
                          {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          }
                        )
                      : selectedPhoto.date}
                  </span>
                )}
                {selectedPhoto.gps && (
                  <span className="photo-gallery__location">
                    📍 {selectedPhoto.gps.lat.toFixed(2)}, {selectedPhoto.gps.lng.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
