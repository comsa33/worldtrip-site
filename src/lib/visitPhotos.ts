import journeyData from '../data/journey.json';
import cityPhotosData from '../data/cityPhotos.json';

export interface VisitPhoto {
  id: string;
  url?: string;
  thumbnail?: string;
  date: string;
  gps?: { lat: number; lng: number } | null;
  caption: { ko: string; en: string };
  location?: string | null;
  /** Baked in by scripts/add-photo-dimensions.js — the frame needs it before the photo arrives. */
  w?: number;
  h?: number;
}

interface Visit {
  id: number;
  city: string;
  country: string;
  order: number;
  transport: string;
  startDate: string;
  endDate: string;
}

const stops = journeyData.stops as Visit[];
const cityPhotos = cityPhotosData as Record<string, { cityCode: string; photos: VisitPhoto[] }>;

const dayOf = (iso: string) => (iso || '').slice(0, 10);
const DAY = 86400000;

/** Days between a photo's day and a visit — 0 while the visit was under way. */
function daysOutside(day: string, visit: Visit): number {
  if (day < visit.startDate) return (+new Date(visit.startDate) - +new Date(day)) / DAY;
  if (day > visit.endDate) return (+new Date(day) - +new Date(visit.endDate)) / DAY;
  return 0;
}

/**
 * Which visit each photo belongs to.
 *
 * 26 cities were passed through more than once, and until now the photo book
 * showed a city's whole roll at every one of them: standing in Varanasi on
 * 10-28 you were handed the photos from the return two weeks later. The EXIF
 * date already says which visit a photo came from, so the journey's own dates
 * can do the sorting.
 *
 * Of the 623 photos taken in a revisited city, 608 fall inside exactly one
 * visit and none fall inside two — the dates never disagree, they only go
 * missing. The other 15 (a day or two off, where journey.json rounded a border
 * crossing) go to the nearest visit rather than nowhere.
 */
const byStopId: Map<number, VisitPhoto[]> = (() => {
  const visitsOf = new Map<string, Visit[]>();
  for (const stop of stops) {
    const list = visitsOf.get(stop.city);
    if (list) list.push(stop);
    else visitsOf.set(stop.city, [stop]);
  }

  const buckets = new Map<number, VisitPhoto[]>();
  for (const stop of stops) buckets.set(stop.id, []);

  for (const [city, data] of Object.entries(cityPhotos)) {
    const visits = visitsOf.get(city);
    if (!visits) continue;

    for (const photo of data.photos) {
      let chosen = visits[0];
      if (visits.length > 1) {
        const day = dayOf(photo.date);
        // an undated photo stays with the first visit rather than being dropped
        if (day) {
          let best = Infinity;
          for (const visit of visits) {
            const gap = daysOutside(day, visit);
            // ties go to the earlier visit: arrival days overlap departures
            if (gap < best) {
              best = gap;
              chosen = visit;
            }
            if (best === 0) break;
          }
        }
      }
      buckets.get(chosen.id)!.push(photo);
    }
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }
  return buckets;
})();

const NONE: VisitPhoto[] = [];

/** The photos taken during one visit, oldest first. */
export function photosForStop(stopId: number | undefined): VisitPhoto[] {
  return (stopId !== undefined && byStopId.get(stopId)) || NONE;
}

/** The same set as ids, for handing the gallery a single visit to page through. */
export function photoIdsForStop(stopId: number | undefined): string[] {
  return photosForStop(stopId).map((p) => p.id);
}

/** Whether any stop at this city has photos — the globe's per-city test. */
export function cityHasPhotos(city: string): boolean {
  return Boolean(cityPhotos[city]?.photos.length);
}

export interface CityVisit {
  stopId: number;
  startDate: string;
  endDate: string;
  photos: VisitPhoto[];
}

/**
 * A city's whole roll, split into the visits it was taken on, in order.
 *
 * A city passed through twice has two rolls weeks apart, and mixing them in one
 * sheet loses what the journey is about. Cities visited once come back as a
 * single group, and the caller can then ignore the split entirely.
 */
export function visitsForCity(city: string | null): CityVisit[] {
  if (!city) return [];
  const here = stops.filter((s) => s.city === city);
  if (!here.length) return [];
  return here
    .map((s) => ({
      stopId: s.id,
      startDate: s.startDate,
      endDate: s.endDate,
      photos: photosForStop(s.id),
    }))
    .filter((v) => v.photos.length > 0);
}

export interface Leg {
  city: string;
  country: string;
  startDate: string;
  endDate: string;
  transport: string;
}

export interface Interlude {
  /** Nights between leaving and coming back. */
  days: number;
  /** Every stop passed through, in order. */
  legs: Leg[];
  /** Countries entered on the way, in order, excluding the city's own. */
  countries: string[];
}

/**
 * What happened between two visits to the same city.
 *
 * A city visited twice is not the same thing twice — there is a reason the
 * journey came back, and the reason is in the stops between. Varanasi's two
 * visits have fifteen days of Nepal and the Annapurna trek between them;
 * Cusco's have Machu Picchu. That is what the seam in the photo book says.
 */
export function interludeBetween(fromStopId: number, toStopId: number): Interlude | null {
  const a = stops.find((s) => s.id === fromStopId);
  const b = stops.find((s) => s.id === toStopId);
  if (!a || !b) return null;
  const legs = stops
    .filter((s) => s.order > a.order && s.order < b.order)
    .map((s) => ({
      city: s.city,
      country: s.country,
      startDate: s.startDate,
      endDate: s.endDate,
      transport: s.transport,
    }));
  const days = Math.round((+new Date(b.startDate) - +new Date(a.endDate)) / DAY);
  const countries = [...new Set(legs.map((l) => l.country))].filter((c) => c !== a.country);
  return { days, legs, countries };
}
