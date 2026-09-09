import { useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import cityPhotosData from '../../data/cityPhotos.json';
import { Camera } from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface Stop {
  id: number;
  city: string;
  country: string;
  transport: string;
}

interface CityData {
  ko: string;
  en: string;
  lat: number;
  lng: number;
  country: string;
}

interface PhotoPoint {
  position: THREE.Vector3;
  thumbnail: string;
  cityName: string;
  lat: number;
  lng: number;
  id: string;
}

// =============================================================================
// Constants
// =============================================================================

const INK = '#f2f2f2';
const INK_2 = '#9a9a9a';
const PHOTO_RADIUS = 2.006; // Slightly above city markers (2.004)

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// =============================================================================
// PhotoCluster - Grouped photos at similar locations
// =============================================================================

function PhotoCluster({
  photos,
  center,
  markerScale,
  cameraPosition,
  onClick,
}: {
  photos: PhotoPoint[];
  center: THREE.Vector3;
  markerScale: number;
  cameraPosition: THREE.Vector3;
  onClick: () => void;
}) {
  const count = photos.length;

  // Visibility check
  const markerDir = center.clone().normalize();
  const cameraDir = cameraPosition.clone().normalize();
  const dotProduct = markerDir.dot(cameraDir);
  if (dotProduct < -0.2) return null;

  const isCluster = count > 1;
  const size = isCluster ? Math.min(0.003 + count * 0.0004, 0.006) : 0.002;

  return (
    <group position={center} scale={[markerScale, markerScale, markerScale]}>
      <mesh>
        <sphereGeometry args={[size, 10, 10]} />
        <meshBasicMaterial color={INK} transparent opacity={isCluster ? 0.8 : 0.55} />
      </mesh>
      {dotProduct > 0.5 && (
        <Html center position={[0, size + 0.008, 0]} style={{ pointerEvents: 'auto' }}>
          <button
            type="button"
            onClick={onClick}
            aria-label={`${count} photos`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              padding: '2px 4px',
              color: INK_2,
              fontFamily: 'var(--mono)',
              fontSize: '10px',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              textShadow: '0 0 2px #0d0d0d, 0 1px 2px #0d0d0d',
            }}
          >
            <Camera size={10} strokeWidth={1.75} />
            {isCluster && <span>{count}</span>}
          </button>
        </Html>
      )}
    </group>
  );
}

// =============================================================================
// PhotoMarkers - Main exported component
// =============================================================================

export function PhotoMarkers({
  currentStopIdx,
  stops,
  cities,
  cameraPosition,
  zoomScale,
  onPhotoClusterClick,
}: {
  currentStopIdx: number;
  stops: Stop[];
  cities: Record<string, CityData>;
  cameraPosition: THREE.Vector3;
  zoomScale: number;
  onPhotoClusterClick: (cityName: string, photoIds: string[]) => void;
}) {
  // Get the set of visited city names (cities the traveler has reached)
  const visitedCities = useMemo(() => {
    const visited = new Set<string>();
    for (let i = 0; i <= currentStopIdx; i++) {
      visited.add(stops[i].city);
    }
    return visited;
  }, [stops, currentStopIdx]);

  // Get current country to filter which photos to show
  const currentCountryCode = useMemo(() => {
    const currentCity = stops[currentStopIdx];
    if (!currentCity) return null;
    const cityData = cities[currentCity.city];
    return cityData?.country || null;
  }, [stops, currentStopIdx, cities]);

  // Build photo points for current and adjacent countries only
  const clusteredPhotos = useMemo(() => {
    if (!currentCountryCode) return [];

    // Get adjacent country codes for a wider view
    const visibleCountries = new Set<string>();
    visibleCountries.add(currentCountryCode);

    // Add previous country
    for (let i = currentStopIdx - 1; i >= 0; i--) {
      const cityData = cities[stops[i].city];
      if (cityData?.country && cityData.country !== currentCountryCode) {
        visibleCountries.add(cityData.country);
        break;
      }
    }

    // Collect all GPS photos for visible, visited cities
    const allPhotos: PhotoPoint[] = [];
    const photosData = cityPhotosData as Record<
      string,
      {
        cityCode: string;
        photos: Array<{
          id: string;
          thumbnail: string;
          gps?: { lat: number; lng: number };
        }>;
      }
    >;

    for (const [cityName, data] of Object.entries(photosData)) {
      if (!visitedCities.has(cityName)) continue;
      const cityData = cities[cityName];
      if (!cityData || !visibleCountries.has(cityData.country)) continue;

      for (const photo of data.photos) {
        if (!photo.gps || !photo.gps.lat || !photo.gps.lng) continue;
        allPhotos.push({
          position: latLngToVector3(photo.gps.lat, photo.gps.lng, PHOTO_RADIUS),
          thumbnail: photo.thumbnail,
          cityName,
          lat: photo.gps.lat,
          lng: photo.gps.lng,
          id: photo.id,
        });
      }
    }

    // Cluster nearby photos (within ~0.3 degrees)
    const CLUSTER_THRESHOLD = 0.3;
    const clusters: {
      photos: PhotoPoint[];
      centerLat: number;
      centerLng: number;
      cityName: string;
    }[] = [];

    for (const photo of allPhotos) {
      let addedToCluster = false;
      for (const cluster of clusters) {
        const dLat = Math.abs(photo.lat - cluster.centerLat);
        const dLng = Math.abs(photo.lng - cluster.centerLng);
        if (dLat < CLUSTER_THRESHOLD && dLng < CLUSTER_THRESHOLD) {
          cluster.photos.push(photo);
          // Update center
          cluster.centerLat = cluster.photos.reduce((s, p) => s + p.lat, 0) / cluster.photos.length;
          cluster.centerLng = cluster.photos.reduce((s, p) => s + p.lng, 0) / cluster.photos.length;
          addedToCluster = true;
          break;
        }
      }
      if (!addedToCluster) {
        clusters.push({
          photos: [photo],
          centerLat: photo.lat,
          centerLng: photo.lng,
          cityName: photo.cityName,
        });
      }
    }

    return clusters.map((cluster) => ({
      photos: cluster.photos,
      center: latLngToVector3(cluster.centerLat, cluster.centerLng, PHOTO_RADIUS),
      cityName: cluster.cityName,
    }));
  }, [currentCountryCode, currentStopIdx, visitedCities, cities, stops]);

  const markerScale = 1 / Math.max(zoomScale, 0.5);

  const handleClusterClick = useCallback(
    (cityName: string, photoIds: string[]) => {
      onPhotoClusterClick(cityName, photoIds);
    },
    [onPhotoClusterClick]
  );

  return (
    <>
      {clusteredPhotos.map((cluster, idx) => (
        <PhotoCluster
          key={`photo-cluster-${idx}`}
          photos={cluster.photos}
          center={cluster.center}
          markerScale={markerScale}
          cameraPosition={cameraPosition}
          onClick={() =>
            handleClusterClick(
              cluster.cityName,
              cluster.photos.map((p) => p.id)
            )
          }
        />
      ))}
    </>
  );
}
