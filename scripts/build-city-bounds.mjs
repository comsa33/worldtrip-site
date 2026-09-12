// Builds src/data/cityBounds.json: the administrative outline of every city on
// the route, from OpenStreetMap via Nominatim (© OpenStreetMap contributors, ODbL).
// One request a second, as their policy asks. Run: node scripts/build-city-bounds.mjs
import { readFileSync, writeFileSync } from 'node:fs';

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

async function lookup(key, c) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(c.en)}&countrycodes=${c.country.toLowerCase()}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0015&limit=8`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const list = await res.json();
  const here = [c.lng, c.lat];
  const cands = [];
  for (const d of list) {
    if (!d.geojson) continue;
    const rs = rings(d.geojson);
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

const FILL = process.argv.includes('--fill');
const out = FILL ? JSON.parse(readFileSync('src/data/cityBounds.json', 'utf8')) : {};
const missing = [];
const keys = Object.keys(cities).filter((k) => !FILL || !out[k]);

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
      const rs = rings(d.geojson);
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
