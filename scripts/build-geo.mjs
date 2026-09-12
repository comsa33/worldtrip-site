// Builds from Natural Earth 10m/50m (globe) and 110m (minimap):
//  - src/data/landDots.json: a 0.7° land dot grid, each dot tagged with the visited country it falls in
//  - src/data/worldBorders.json: boundaries of the countries we never entered at 50m,
//    and the 31 visited countries at 10m
// Run: node scripts/build-geo.mjs  (downloads the 13MB 10m set once into .cache/)
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoContains } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const require = createRequire(import.meta.url);
// Dots and the 240px minimap come from 110m, which is all they can show and is
// quick to test points against. The lines drawn on the globe come from 50m: at
// 110m a coastline is a handful of straight segments and reads as crude.
const land = JSON.parse(readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'));
const countries = JSON.parse(
  readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf8')
);
const countries50 = JSON.parse(
  readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8')
);
const visited = JSON.parse(readFileSync('src/data/countries.json', 'utf8')).countries.map(
  (c) => c.code
);

// ISO 3166-1 alpha-2 -> numeric (world-atlas feature ids)
const NUMERIC = {
  KR: 410,
  VN: 704,
  MY: 458,
  ID: 360,
  LA: 418,
  TH: 764,
  KH: 116,
  IN: 356,
  NP: 524,
  JP: 392,
  AE: 784,
  EG: 818,
  ES: 724,
  BG: 100,
  IT: 380,
  RS: 688,
  HU: 348,
  PL: 616,
  CZ: 203,
  BE: 56,
  FR: 250,
  MA: 504,
  PT: 620,
  BR: 76,
  UY: 858,
  AR: 32,
  CL: 152,
  BO: 68,
  PE: 604,
  EC: 218,
  CO: 170,
};

const landFeature = feature(land, land.objects.land);
const feats = feature(countries, countries.objects.countries).features;
const countryFeatures = visited.map((code) => {
  const id = String(NUMERIC[code]).padStart(3, '0');
  const f = feats.find((x) => x.id === id);
  if (!f) console.warn('no feature for', code);
  return f;
});

const STEP = 0.7;
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
      if (countryFeatures[k] && geoContains(countryFeatures[k], pt)) {
        c = k;
        break;
      }
    }
    dots.push(+lat.toFixed(2), +lng.toFixed(2), c);
  }
}
writeFileSync('src/data/landDots.json', JSON.stringify({ countries: visited, dots }));
const tagged = dots.filter((_, i) => i % 3 === 2 && dots[i] >= 0).length;

// --- borders
// Two resolutions, and the seam between them is the point. 50m puts a vertex
// every ~9km, which is a fair drawing of a country seen whole and a lie once the
// camera is down over a city: at Florianópolis the island's 50m outline misses
// the coast by a couple of kilometres, so it cut straight through the city
// boundary drawn from OSM and through the road we actually took. The 31 countries
// we entered are the only ones ever seen that close, so they come from Natural
// Earth 10m (~1km between vertices) and everyone else stays at 50m.
//
// The two sets do not agree along a shared border, so nothing may be drawn from
// both: the 50m mesh keeps only the arcs where neither side was visited, and a
// visited country's own 10m ring is the only drawing of its boundary. Where two
// visited countries meet, both rings carry the same border with the same
// vertices — identical, so the renderer inks the segment once (see WorldBorders).
const NE10_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const NE10_CACHE = '.cache/ne_10m_admin_0_countries.geojson';
if (!existsSync(NE10_CACHE)) {
  mkdirSync('.cache', { recursive: true });
  process.stdout.write(`downloading 10m countries (13MB)... `);
  const res = await fetch(NE10_URL);
  if (!res.ok) throw new Error(`${NE10_URL}: ${res.status}`);
  writeFileSync(NE10_CACHE, Buffer.from(await res.arrayBuffer()));
  console.log('cached');
}
const ne10 = JSON.parse(readFileSync(NE10_CACHE, 'utf8'));

// A line is written as its first point and then the step to each next one, in
// whole units of `unit` degrees. `[-48.613,-27.614],[-48.61,-27.627]` is 36
// bytes of JSON and `-48613,-27614,3,-13` is 19, the steps are small numbers
// that repeat, which is what gzip lives on, and the whole file came out smaller
// than the 50m one it replaced. WorldBorders.tsx walks it back.
const encode = (line, unit) => {
  const q = (v) => Math.round(v / unit);
  let x = q(line[0][0]);
  let y = q(line[0][1]);
  const out = [x, y];
  for (let i = 1; i < line.length; i++) {
    const nx = q(line[i][0]);
    const ny = q(line[i][1]);
    out.push(nx - x, ny - y);
    x = nx;
    y = ny;
  }
  return out;
};
// 0.01° is 1.1km — fine for a 50m line whose own vertices are 9km apart, and a
// staircase under a 10m one, so the finer set is kept to 0.001° (110m).
const BORDER_UNIT = 0.01;
const RING_UNIT = 0.001;

const visitedIds = new Set(visited.map((code) => String(NUMERIC[code]).padStart(3, '0')));
const borderLines = mesh(
  countries50,
  countries50.objects.countries,
  (a, b) => !visitedIds.has(a.id) && !visitedIds.has(b.id)
).coordinates.map((line) => encode(line, BORDER_UNIT));

// Natural Earth files a handful of specks under a country's own ISO number
// (Clipperton under France, Brazilian I. under Brazil). The mainland is the one
// with the vertices.
const byNumeric = {};
for (const f of ne10.features) {
  const n = +(f.properties.ISO_N3_EH || f.properties.ISO_N3);
  (byNumeric[n] ??= []).push(f);
}
const ringsOf = (f) =>
  f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
const size = (f) => ringsOf(f).reduce((s, r) => s + r.length, 0);
const byCode = {};
visited.forEach((code) => {
  const found = byNumeric[NUMERIC[code]];
  if (!found) return console.warn('no 10m feature for', code);
  const f = found.reduce((a, b) => (size(a) >= size(b) ? a : b));
  byCode[code] = ringsOf(f).map((r) => encode(r, RING_UNIT));
});
writeFileSync(
  'src/data/worldBorders.json',
  JSON.stringify({
    borders: { unit: BORDER_UNIT, lines: borderLines },
    countries: { unit: RING_UNIT, rings: byCode },
  })
);

const count = (ls) => ls.reduce((s, l) => s + l.length / 2, 0);
const ringPts = Object.values(byCode).reduce((s, rs) => s + count(rs), 0);
console.log(
  `landDots: ${dots.length / 3} dots, ${tagged} in visited countries · ` +
    `borders: ${borderLines.length} lines / ${count(borderLines)} pts (50m) · ` +
    `countries: ${Object.keys(byCode).length} / ${ringPts} pts (10m)`
);

// --- minimap: land silhouette + per-leg route, pre-projected (Natural Earth I) into a 1000×500 box
import { geoNaturalEarth1, geoPath, geoInterpolate } from 'd3-geo';
const W = 1000;
const H = 500;
const projection = geoNaturalEarth1().fitSize([W, H], { type: 'Sphere' });
const pathGen = geoPath(projection);
const journey = JSON.parse(readFileSync('src/data/journey.json', 'utf8')).stops;
const cities = JSON.parse(readFileSync('src/data/cities.json', 'utf8')).cities;
const legs = [];
for (let i = 0; i < journey.length - 1; i++) {
  const a = cities[journey[i].city];
  const b = cities[journey[i + 1].city];
  const ip = geoInterpolate([a.lng, a.lat], [b.lng, b.lat]);
  const pts = Array.from({ length: 17 }, (_, k) => ip(k / 16));
  legs.push(pathGen({ type: 'LineString', coordinates: pts }) || '');
}
const round1 = (d) => d.replace(/(\d+\.\d{1})\d+/g, '$1');
writeFileSync(
  'src/data/minimap.json',
  JSON.stringify({
    w: W,
    h: H,
    scale: projection.scale(),
    translate: projection.translate(),
    land: round1(pathGen(landFeature)),
    legs: legs.map(round1),
  })
);
console.log(`minimap: land path ${pathGen(landFeature).length} chars · ${legs.length} legs`);
