import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const tags = read('../src/data/photoTags.json') as {
  version: number;
  categories: { id: string; ko: string; en: string }[];
  photos: Record<string, string[]>;
  stops: Record<string, Record<string, number>>;
};
const cityPhotos = read('../src/data/cityPhotos.json') as Record<
  string,
  { photos: { id: string }[] }
>;

test('categories are unique ids with both names', () => {
  const ids = tags.categories.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of tags.categories) assert.ok(c.id && c.ko && c.en, c.id);
});

test('every site photo has an entry, and only theme ids are in it', () => {
  const known = new Set(tags.categories.map((c) => c.id));
  const site = Object.values(cityPhotos).flatMap((c) => c.photos.map((p) => p.id));
  for (const id of site) assert.ok(Array.isArray(tags.photos[id]), id);
  for (const [id, list] of Object.entries(tags.photos))
    for (const t of list) assert.ok(known.has(t), `${id}: ${t}`);
});

test('stop counts use known themes and add up to the photo tags', () => {
  const known = new Set(tags.categories.map((c) => c.id));
  for (const c of tags.categories) {
    const byPhoto = Object.values(tags.photos).filter((l) => l.includes(c.id)).length;
    let byStop = 0;
    for (const s of Object.values(tags.stops)) {
      for (const k of Object.keys(s)) assert.ok(known.has(k), k);
      byStop += s[c.id] ?? 0;
    }
    assert.equal(byStop, byPhoto, c.id);
  }
});
