/**
 * What the photos show, as the photo book and the globe light it.
 *
 * photoTags.json holds only theme ids — what a photo is of, never words about
 * it. One theme is chosen at a time, and the choice is one for the whole site:
 * snow lit on the globe is snow lit in the photo book, and back.
 */
import { useSyncExternalStore } from 'react';
import tagsData from '../data/photoTags.json';
import { journeyRoll, dayOf, JOURNEY_DAYS } from './journeyRoll';
import { litPerDay } from './themeStep';

export interface PhotoTheme {
  id: string;
  ko: string;
  en: string;
}

const TAGS = tagsData as {
  version: 1;
  categories: PhotoTheme[];
  photos: Record<string, string[]>;
  stops: Record<string, Record<string, number>>;
};

/** In the order the selector says them. */
export const THEMES: PhotoTheme[] = TAGS.categories;

export const themesOf = (photoId: string): string[] => TAGS.photos[photoId] ?? [];
export const hasTheme = (photoId: string, theme: string) => themesOf(photoId).includes(theme);

/** Photos of each theme across the whole roll — said beside the chosen word. */
export const THEME_TOTAL: Record<string, number> = Object.fromEntries(
  THEMES.map((t) => [t.id, journeyRoll.photos.filter((p) => hasTheme(p.id, t.id)).length])
);

/** A stop's photos of a theme (photoTags.stops) — 0 if none. */
export const stopThemeCount = (stopId: number, theme: string): number =>
  TAGS.stops[String(stopId)]?.[theme] ?? 0;

const dayCache = new Map<string, number[]>();
/** The theme's photos per journey day, for the year under the sheet. */
export function themeDays(theme: string): number[] {
  let out = dayCache.get(theme);
  if (!out) {
    const { photos } = journeyRoll;
    out = litPerDay(
      photos.map((p) => p.date),
      (i) => hasTheme(photos[i].id, theme),
      dayOf,
      JOURNEY_DAYS
    );
    dayCache.set(theme, out);
  }
  return out;
}

// ---- the one choice ------------------------------------------------------------

let chosen: string | null = null;
const listeners = new Set<() => void>();

export function setPhotoTheme(theme: string | null) {
  const next = theme && THEMES.some((t) => t.id === theme) ? theme : null;
  if (next === chosen) return;
  chosen = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The chosen theme, or null for all of them. */
export function usePhotoTheme(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => chosen,
    () => null
  );
}
