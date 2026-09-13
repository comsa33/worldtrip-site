// Builds src/data/cityBounds.json: the administrative outline of every city on
// the route, from OpenStreetMap via Nominatim (© OpenStreetMap contributors, ODbL).
// One request a second, as their policy asks. Run: node scripts/build-city-bounds.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import polygonClipping from 'polygon-clipping';

const UA = 'worldtrip-site build (comsa333@gmail.com)';
const cities = JSON.parse(readFileSync('src/data/cities.json', 'utf8')).cities;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rad = (d) => (d * Math.PI) / 180;

/** every ring of a (Multi)Polygon as [lng, lat][] */
const rings = (g) => (g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : []);
const extentKm = (rs, lat) => {
  const pts = rs.flat();
  const lats = pts.map((p) => p[1]);
  const lngs = pts.map((p) => p[0]);
  return Math.max((Math.max(...lngs) - Math.min(...lngs)) * 111 * Math.cos(rad(lat)), (Math.max(...lats) - Math.min(...lats)) * 111);
};
const contains = (ring, [x, y]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Douglas–Peucker in degrees
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1];
    return ex * ex + ey * ey;
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bd = tol * tol;
    for (let i = a + 1; i < b; i++) { const d = d2(pts[i], pts[a], pts[b]); if (d > bd) { bd = d; best = i; } }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const OK_TYPES = new Set(['city', 'town', 'municipality', 'village', 'borough', 'city_district', 'county', 'administrative']);
const MIN_KM = 3, MAX_KM = 130;

/**
 * A city too wide only because it owns land far off — Dubai's Hatta exclave,
 * Valparaíso's islands out in the Pacific, Cartagena's Rosario archipelago —
 * is drawn as the one piece the city itself stands on.
 */
const mainland = (rs, here, lat) =>
  extentKm(rs, lat) > MAX_KM ? rs.filter((r) => contains(r, here)) : rs;

async function lookup(key, c) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(c.en)}&countrycodes=${c.country.toLowerCase()}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0015&limit=8`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const list = await res.json();
  const here = [c.lng, c.lat];
  const cands = [];
  for (const d of list) {
    if (!d.geojson) continue;
    const rs = mainland(rings(d.geojson), here, c.lat);
    if (!rs.length) continue;
    const km = extentKm(rs, c.lat);
    const inside = rs.some((r) => contains(r, here));
    if (!inside || km < MIN_KM || km > MAX_KM) continue;
    const tier = d.addresstype === 'city' || d.addresstype === 'town' || d.addresstype === 'municipality' ? 0 : OK_TYPES.has(d.addresstype) ? 1 : 2;
    cands.push({ d, rs, km, tier });
  }
  // the tightest city-grade polygon that contains the point
  cands.sort((a, b) => a.tier - b.tier || a.km - b.km);
  return cands[0] ?? null;
}

// --- places whose boundary has since been redrawn. In July 2025 Vietnam merged
// its provinces: Ho Chi Minh City took in Bình Dương and Bà Rịa–Vũng Tàu (350km
// across) and Da Nang took in Quảng Nam (193km), so today's outlines fail the
// size check and are not the cities the trip went to in 2016 anyway. Overpass
// keeps the history, so these are the OSM relations as they stood before the
// merger. Run: node scripts/build-city-bounds.mjs --dated
const DATED = {
  호치민: { relation: 1973756, date: '2025-01-01T00:00:00Z' },
  다낭: { relation: 1891418, date: '2025-01-01T00:00:00Z' },
};

/** join a relation's outer ways, end to end, into closed rings */
function stitch(ways) {
  const k = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const segs = ways.map((w) => w.map((g) => [g.lon, g.lat]));
  const out = [];
  while (segs.length) {
    let ring = segs.shift();
    let grew = true;
    while (k(ring[0]) !== k(ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const sg = segs[i];
        const head = k(ring[0]);
        const tail = k(ring[ring.length - 1]);
        if (k(sg[0]) === tail) ring = ring.concat(sg.slice(1));
        else if (k(sg[sg.length - 1]) === tail) ring = ring.concat(sg.slice(0, -1).reverse());
        else if (k(sg[sg.length - 1]) === head) ring = sg.slice(0, -1).concat(ring);
        else if (k(sg[0]) === head) ring = sg.slice(1).reverse().concat(ring);
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (k(ring[0]) === k(ring[ring.length - 1])) out.push(ring);
  }
  return out;
}

/**
 * What of an outline is land. Some administrations draw their waters into the
 * city — Da Nang a box out over the South China Sea, Ho Chi Minh City a wedge
 * off Cần Giờ, Dubai a third of the Gulf — and on the globe that reads as a city painted on the sea. The
 * country's Natural Earth 10m polygon (cached by build-geo.mjs) is the land.
 */
let ne10 = null;
function onLand(rs, country) {
  const cache = '.cache/ne_10m_admin_0_countries.geojson';
  if (!existsSync(cache)) throw new Error(`${cache} missing — run node scripts/build-geo.mjs once`);
  ne10 ??= JSON.parse(readFileSync(cache, 'utf8')).features;
  const f = ne10.find((x) => x.properties.ISO_A2 === country || x.properties.ISO_A2_EH === country);
  const land = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return polygonClipping.intersection(rs.map((r) => [r]), land).map((poly) => poly[0]);
}

/**
 * Places that are not a city: their own shape where OpenStreetMap has one — the
 * lake, the island, the salt flat, the park around the falls, the sanctuary
 * around the ruins — found by hand and named by id, since a search for the name
 * finds the nearest town. Each lies on or within 2km of the journey's point for
 * it, except the two big ones the point sits at the edge of: Uyuni is the town
 * beside the salar (12km), the Annapurna point is on the trek inside the
 * conservation area's bounds (17km from its line). `null` is a place with no
 * shape of its own, or only one too small to ever be drawn (the Ajanta caves
 * are 400m across): it keeps its map mark, and a wrong outline fetched for it
 * earlier — a province, a county — is dropped.
 * Run: node scripts/build-city-bounds.mjs --picked
 */
const PICKED = {
  안나푸르나: 'R4497739', // Annapurna Conservation Area
  마추픽추: 'R3891114', // Santuario Histórico de Machupicchu
  함피: 'W823174016', // Group of Monuments at Hampi
  뚝뚝섬: 'R13202530', // Pulau Samosir
  파라티: 'R14602147', // Paraty, the district
  '라구나 베르데': 'W23690519',
  '오르타 호수': 'R2024365', // Lago d'Orta
  '이과수 폭포': 'R2639206', // Parque Nacional do Iguaçu
  우유니: 'R1769713', // Salar de Uyuni
  아잔타: null,
  다합: null,
  '바히아 잉글레사': null,
  코파카바나: null,
  '산 페드로 데 아타카마': null,
  // OSM's Desierto Salvador Dalí lies 60km from the journey's point for it
  '살바도르 달리 사막': null,
  국경: null,
};

if (process.argv.includes('--picked')) {
  const bounds = JSON.parse(readFileSync('src/data/cityBounds.json', 'utf8'));
  for (const [key, id] of Object.entries(PICKED)) {
    if (!id) {
      if (bounds[key]) console.log(`${key} — dropped ${bounds[key].name}, keeps its mark`);
      delete bounds[key];
      continue;
    }
    const c = cities[key];
    const url = `https://nominatim.openstreetmap.org/lookup?osm_ids=${id}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0015`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Nominatim ${res.status} for ${key}`);
    const [d] = await res.json();
    const rs = rings(d.geojson);
    const km = extentKm(rs, c.lat);
    const simplified = rs.map((r) => simplify(r, 0.0025).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)])).filter((r) => r.length >= 4);
    bounds[key] = { name: d.name, type: d.type, km: Math.round(km), rings: simplified };
    console.log(`${key} ${d.name} (${d.category}/${d.type}, ${Math.round(km)}km, ${simplified.reduce((n, r) => n + r.length, 0)} pts)`);
    await sleep(1100);
  }
  writeFileSync('src/data/cityBounds.json', JSON.stringify(bounds));
  process.exit(0);
}

// `--coast 호치민,다낭,두바이` trims those outlines, already in the file, to the land
if (process.argv.includes('--coast')) {
  const bounds = JSON.parse(readFileSync('src/data/cityBounds.json', 'utf8'));
  for (const key of process.argv[process.argv.indexOf('--coast') + 1].split(',')) {
    const c = cities[key];
    const before = bounds[key].rings;
    const rs = onLand(before, c.country).filter((r) => extentKm([r], c.lat) >= 0.5);
    bounds[key] = { ...bounds[key], km: Math.round(extentKm(rs, c.lat)), rings: rs.map((r) => r.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)])) };
    console.log(`${key} ${before.length} rings → ${rs.length} on land, ${bounds[key].km}km`);
  }
  writeFileSync('src/data/cityBounds.json', JSON.stringify(bounds));
  process.exit(0);
}

if (process.argv.includes('--dated')) {
  const bounds = JSON.parse(readFileSync('src/data/cityBounds.json', 'utf8'));
  for (const [key, { relation, date }] of Object.entries(DATED)) {
    const c = cities[key];
    const query = `[out:json][date:"${date}"][timeout:60];rel(${relation});out geom;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status} for ${key} — it is often busy, try again later`);
    const rel = (await res.json()).elements.find((e) => e.type === 'relation');
    const rs = onLand(stitch(rel.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry)), c.country);
    const km = rs.length ? extentKm(rs, c.lat) : 0;
    if (!rs.some((r) => contains(r, [c.lng, c.lat])) || km < MIN_KM || km > MAX_KM) {
      console.log(`${key} — ${rel.tags.name} as of ${date} does not fit (${Math.round(km)}km)`);
    } else {
      const simplified = rs.map((r) => simplify(r, 0.0025).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)])).filter((r) => r.length >= 4);
      bounds[key] = { name: rel.tags.name, type: 'city', km: Math.round(km), rings: simplified };
      console.log(`${key} ${rel.tags.name} as of ${date} (${Math.round(km)}km, ${simplified.reduce((n, r) => n + r.length, 0)} pts)`);
    }
    await sleep(5000);
  }
  writeFileSync('src/data/cityBounds.json', JSON.stringify(bounds));
  process.exit(0);
}

const FILL = process.argv.includes('--fill');
// `--only 두바이,카르타헤나` looks up just those and keeps every other outline
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const out = FILL || ONLY ? JSON.parse(readFileSync('src/data/cityBounds.json', 'utf8')) : {};
const missing = [];
const keys = ONLY ?? Object.keys(cities).filter((k) => !FILL || !out[k]);

async function lookupFallback(key, c) {
  const here = [c.lng, c.lat];
  const tries = [
    `https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&zoom=10&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0015`,
    `https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&zoom=8&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0015`,
    `https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&zoom=12&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0015`,
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(c.en)}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0015&limit=8`,
  ];
  const cands = [];
  for (const url of tries) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const data = await res.json();
    for (const d of Array.isArray(data) ? data : [data]) {
      if (!d?.geojson) continue;
      const rs = mainland(rings(d.geojson), here, c.lat);
      if (!rs.length) continue;
      const km = extentKm(rs, c.lat);
      if (!rs.some((r) => contains(r, here)) || km < MIN_KM || km > MAX_KM) continue;
      const tier = ['city', 'town', 'municipality', 'village'].includes(d.addresstype) ? 0 : ['borough', 'city_district', 'state_district', 'county', 'administrative', 'district'].includes(d.addresstype) ? 1 : 3;
      if (tier === 3) continue;
      cands.push({ d, rs, km, tier });
    }
    await sleep(1100);
  }
  cands.sort((a, b) => a.tier - b.tier || a.km - b.km);
  return cands[0] ?? null;
}

for (const [i, key] of keys.entries()) {
  const c = cities[key];
  let hit = null;
  try { hit = FILL ? await lookupFallback(key, c) : await lookup(key, c); } catch (e) { console.error(key, e.message); }
  if (hit) {
    const simplified = hit.rs.map((r) => simplify(r, 0.0025).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)])).filter((r) => r.length >= 4);
    out[key] = { name: hit.d.name, type: hit.d.addresstype, km: Math.round(hit.km), rings: simplified };
    console.log(`${String(i + 1).padStart(3)}/${keys.length} ${key.padEnd(10)} ${hit.d.name} (${hit.d.addresstype}, ${Math.round(hit.km)}km, ${simplified.reduce((n, r) => n + r.length, 0)} pts)`);
  } else {
    missing.push(key);
    console.log(`${String(i + 1).padStart(3)}/${keys.length} ${key.padEnd(10)} — no boundary`);
  }
  await sleep(1100);
}
writeFileSync('src/data/cityBounds.json', JSON.stringify(out));
console.log(`\nwrote ${Object.keys(out).length} outlines, ${missing.length} without: ${missing.join(', ')}`);
console.log('size', Math.round(readFileSync('src/data/cityBounds.json').length / 1024), 'KB');

// --- second pass for the places the search missed: reverse geocoding around the
// point at a few zooms, and a search without the country. Run: node scripts/build-city-bounds.mjs --fill
