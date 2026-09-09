// Builds from Natural Earth 110m (world-atlas):
//  - src/data/landDots.json: a 1° land dot grid, each dot tagged with the visited country it falls in
//  - src/data/worldBorders.json: every boundary line, plus rings of the visited countries
// Run: node scripts/build-geo.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoContains } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const require = createRequire(import.meta.url);
const land = JSON.parse(readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'));
const countries = JSON.parse(readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf8'));
const visited = JSON.parse(readFileSync('src/data/countries.json', 'utf8')).countries.map((c) => c.code);

// ISO 3166-1 alpha-2 -> numeric (world-atlas feature ids)
const NUMERIC = {
  KR: 410, VN: 704, MY: 458, ID: 360, LA: 418, TH: 764, KH: 116, IN: 356, NP: 524, JP: 392,
  AE: 784, EG: 818, ES: 724, BG: 100, IT: 380, RS: 688, HU: 348, PL: 616, CZ: 203, BE: 56,
  FR: 250, MA: 504, PT: 620, BR: 76, UY: 858, AR: 32, CL: 152, BO: 68, PE: 604, EC: 218, CO: 170,
};

const landFeature = feature(land, land.objects.land);
const feats = feature(countries, countries.objects.countries).features;
const countryFeatures = visited.map((code) => {
  const id = String(NUMERIC[code]).padStart(3, '0');
  const f = feats.find((x) => x.id === id);
  if (!f) console.warn('no feature for', code);
  return f;
});

const STEP = 1.0;
const dots = []; // flat triples: lat, lng, countryIndex (-1 = not a visited country)
for (let lat = -88; lat <= 88; lat += STEP) {
  const n = Math.max(1, Math.round((360 / STEP) * Math.cos((lat * Math.PI) / 180)));
  const offset = (Math.round(lat / STEP) % 2) * (180 / n); // stagger rows
  for (let j = 0; j < n; j++) {
    const lng = -180 + (360 * j) / n + offset;
    const pt = [lng, lat];
    if (!geoContains(landFeature, pt)) continue;
    let c = -1;
    for (let k = 0; k < countryFeatures.length; k++) {
      if (countryFeatures[k] && geoContains(countryFeatures[k], pt)) { c = k; break; }
    }
    dots.push(+lat.toFixed(2), +lng.toFixed(2), c);
  }
}
writeFileSync('src/data/landDots.json', JSON.stringify({ countries: visited, dots }));
const tagged = dots.filter((_, i) => i % 3 === 2 && dots[i] >= 0).length;

// --- borders: every boundary (coastlines + country borders) as line strings
const round = (c) => [+c[0].toFixed(2), +c[1].toFixed(2)];
const borders = mesh(countries, countries.objects.countries).coordinates.map((line) => line.map(round));
const byCode = {};
visited.forEach((code, i) => {
  const f = countryFeatures[i];
  if (!f) return;
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  byCode[code] = rings.map((r) => r.map(round));
});
writeFileSync('src/data/worldBorders.json', JSON.stringify({ borders, countries: byCode }));

console.log(`landDots: ${dots.length / 3} dots, ${tagged} in visited countries · borders: ${borders.length} lines · countries: ${Object.keys(byCode).length}`);
