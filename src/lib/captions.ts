/**
 * What each photo says under itself in the photo book.
 *
 * The words live in src/data/captions/<cityCode>.json — one file a city,
 * { photoId: { ko, en } } — and that is the only copy: the caption tool
 * (design/caption-tool) reads and writes the same files. They are not in
 * cityPhotos.json, which the photo sync writes over.
 *
 * A city's file is fetched when its photos are looked at and not before, so
 * none of it is in the first screen's bundle.
 */
import { useEffect, useSyncExternalStore } from 'react';

type Lang = 'ko' | 'en';
type CityCaptions = Record<string, { ko?: string; en?: string }>;

const files = import.meta.glob<{ default: CityCaptions }>('../data/captions/*.json');
const pathOf = (code: string) => `../data/captions/${code}.json`;

const loaded = new Map<string, CityCaptions>();
const asked = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

/** A photo's id is its city's code and a number: abudhabi-021. */
export const cityCodeOf = (photoId: string) => photoId.replace(/-\d+$/, '');

/** Fetch a city's captions (once). A city with no file has none. */
export function loadCaptions(code: string): Promise<void> {
  let p = asked.get(code);
  if (!p) {
    const file = files[pathOf(code)];
    p = (file ? file().then((m) => m.default) : Promise.resolve({} as CityCaptions))
      .catch(() => ({}) as CityCaptions)
      .then((data) => {
        loaded.set(code, data);
        version += 1;
        listeners.forEach((l) => l());
      });
    asked.set(code, p);
    // noted for the next run of this module on dev (below); not a dispose
    // hook, which only the module that accepts the update gets to run
    if (import.meta.hot) import.meta.hot.data.cities = [...asked.keys()];
  }
  return p;
}

/* On dev, a city's file saved while the book is open: this module is run
   again with its maps empty, and the book, which keeps its place, does not
   ask for the city a second time — so the cities the old module had fetched
   are fetched again here. (import.meta.hot is undefined in a build.) */
if (import.meta.hot) {
  const had = import.meta.hot.data.cities as string[] | undefined;
  had?.forEach((code) => void loadCaptions(code));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * The photo's caption in this language: the words, '' if it has none, or
 * undefined while its city's file is still on the way (so the place for it
 * can be kept).
 */
export function useCaption(photoId: string | undefined, lang: Lang): string | undefined {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version
  );
  const code = photoId ? cityCodeOf(photoId) : '';
  useEffect(() => {
    if (code) void loadCaptions(code);
  }, [code]);
  if (!photoId) return '';
  const city = loaded.get(code);
  return city ? (city[photoId]?.[lang]?.trim() ?? '') : undefined;
}
