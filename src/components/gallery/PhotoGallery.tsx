import { useState, useEffect, useMemo } from 'react';
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
  caption: { ko: string; en: string };
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
  const [isEntering, setIsEntering] = useState(false);
  const [isPhotoZooming, setIsPhotoZooming] = useState(false);

  const cityPhotos = cityPhotosData as Record<string, CityPhotoData>;

  // Get photos for the current city
  const photos = useMemo(() => {
    if (!cityName || !cityPhotos[cityName]) return [];
    return cityPhotos[cityName].photos;
  }, [cityName, cityPhotos]);

  const cityCode = cityName ? cityPhotos[cityName]?.cityCode : null;

  // Animation on open
  useEffect(() => {
    if (cityName) {
      setIsEntering(true);
      setSelectedPhoto(null);
    } else {
      setIsEntering(false);
    }
  }, [cityName]);

  // Handle thumbnail click
  const handleThumbnailClick = (photo: Photo) => {
    setIsPhotoZooming(true);
    setSelectedPhoto(photo);
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
      <div className="photo-gallery__circle">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            className={`photo-gallery__thumbnail ${selectedPhoto?.id === photo.id ? 'photo-gallery__thumbnail--selected' : ''}`}
            style={{ '--delay': `${index * 0.08}s` } as React.CSSProperties}
            onClick={() => handleThumbnailClick(photo)}
          >
            <img
              src={photo.thumbnail || `/assets/images/cities/${cityCode}/${photo.filename?.replace('.jpg', '.png')}`}
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
              src={selectedPhoto.url || `/assets/images/cities/${cityCode}/${selectedPhoto.filename?.replace('.jpg', '.png')}`}
              alt={selectedPhoto.caption[language as 'ko' | 'en']}
            />
            <div className="photo-gallery__caption-area">
              <p className="photo-gallery__caption">
                {selectedPhoto.caption[language as 'ko' | 'en']}
              </p>
              <span className="photo-gallery__date">
                {selectedPhoto.date}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
