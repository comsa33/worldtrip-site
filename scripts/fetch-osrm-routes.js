/**
 * OSRM 육로 경로 데이터 fetch 스크립트
 * journey.json의 bus/train 구간에 대해 OSRM API로 실제 도로 경로를 가져와
 * src/data/osrmRoutes.json에 캐시
 *
 * 사용법: node scripts/fetch-osrm-routes.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'src', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'osrmRoutes.json');

// Read source data
const journey = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'journey.json'), 'utf-8'));
const citiesData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cities.json'), 'utf-8'));
const cities = citiesData.cities;

// OSRM public API base
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

// Rate limiting: ms between requests
const DELAY_MS = 1100;

// Max waypoints per route segment (downsample to keep file size small)
const MAX_POINTS = 60;

/**
 * Downsample an array of coordinates to at most maxPoints using uniform sampling
 */
function downsample(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords;
  const result = [coords[0]];
  const step = (coords.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) {
    result.push(coords[Math.round(i * step)]);
  }
  result.push(coords[coords.length - 1]);
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRoute(fromLng, fromLat, toLng, toLat) {
  const url = `${OSRM_BASE}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error(`OSRM error: ${data.code || 'no routes'}`);
  }

  // GeoJSON coordinates are [lng, lat]
  return data.routes[0].geometry.coordinates;
}

async function main() {
  const stops = journey.stops;
  const routes = {};

  // Load existing routes to allow resuming
  let existing = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      console.log(`기존 캐시 로드: ${Object.keys(existing).length}개 경로`);
    } catch {
      // ignore
    }
  }

  // Collect segments that need OSRM routing
  const segments = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    const transport = to.transport;

    // Only route bus and train segments via OSRM
    // boat/trek/flight segments skip OSRM
    if (transport !== 'bus' && transport !== 'train') continue;

    const fromCity = cities[from.city];
    const toCity = cities[to.city];
    if (!fromCity || !toCity) {
      console.warn(`⚠️  도시 좌표 없음: ${from.city} -> ${to.city}`);
      continue;
    }

    // 키는 stop 번호가 아니라 도시 이름 쌍으로 잡는다.
    // 번호로 잡으면 stop을 추가·재정렬했을 때 캐시가 엉뚱한 구간에 붙어
    // 경로가 전혀 다른 곳으로 이어진다.
    const key = `${from.city}\u2192${to.city}`;

    // Skip if already cached
    if (existing[key] && existing[key].length > 0) {
      routes[key] = existing[key];
      continue;
    }

    segments.push({
      key,
      fromCity: from.city,
      toCity: to.city,
      fromLng: fromCity.lng,
      fromLat: fromCity.lat,
      toLng: toCity.lng,
      toLat: toCity.lat,
      transport,
    });
  }

  // Copy existing routes
  Object.assign(routes, existing);

  console.log(`\n🚀 OSRM 경로 fetch 시작`);
  console.log(`   총 육로 구간: ${segments.length}개 (새로 fetch 필요)`);
  console.log(`   캐시 재사용: ${Object.keys(existing).length}개\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const progress = `[${i + 1}/${segments.length}]`;

    try {
      const coords = await fetchRoute(seg.fromLng, seg.fromLat, seg.toLng, seg.toLat);
      const downsampled = downsample(coords, MAX_POINTS);
      routes[seg.key] = downsampled;
      success++;
      console.log(
        `✅ ${progress} ${seg.fromCity} → ${seg.toCity} (${seg.transport}): ${coords.length} → ${downsampled.length} points`
      );
    } catch (err) {
      failed++;
      console.warn(`❌ ${progress} ${seg.fromCity} → ${seg.toCity}: ${err.message}`);
      routes[seg.key] = []; // empty = fallback to lerp
    }

    // Save incrementally every 10 routes
    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(routes, null, 2));
    }

    // Rate limit
    if (i < segments.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(routes, null, 2));

  console.log(`\n📊 완료:`);
  console.log(`   성공: ${success}개`);
  console.log(`   실패: ${failed}개`);
  console.log(`   총 캐시: ${Object.keys(routes).length}개`);
  console.log(`   파일: ${OUTPUT_FILE}`);

  const stats = fs.statSync(OUTPUT_FILE);
  console.log(`   파일 크기: ${(stats.size / 1024).toFixed(1)} KB`);
}

main().catch(console.error);
