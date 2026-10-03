// 정거장마다 그곳 사진들의 캡션(en)을 모은다 → api/stopCaptions.json
// /api/search 가 Jev 에게 정거장을 설명할 때 쓴다(cityNotes en · 주제 사진 수 와 함께).
// 사진→정거장 짝은 사이트와 같은 규칙(src/lib/visitPhotos.ts: 찍은 날이 든 방문, 없으면
// 가장 가까운 방문)으로 배포 데이터(cityPhotos.json · journey.json)에서만 만든다.
// Apple 설명문·장면 라벨·얼굴 이름은 재료가 아니다.
// 실행: node scripts/build-stop-captions.mjs   (npm run build / npm test 앞에 저절로 돈다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const DAY = 86400000;
const dayOf = (iso) => (iso || '').slice(0, 10);
function daysOutside(day, visit) {
  if (day < visit.startDate) return (+new Date(visit.startDate) - +new Date(day)) / DAY;
  if (day > visit.endDate) return (+new Date(day) - +new Date(visit.endDate)) / DAY;
  return 0;
}

/** { "<stopId>": ["caption en", …] } — 찍은 차례, 빈 캡션은 뺀다. */
export function buildStopCaptions() {
  const stops = read('src/data/journey.json').stops;
  const cityPhotos = read('src/data/cityPhotos.json');
  const captionDir = path.join(ROOT, 'src/data/captions');
  const captions = {};
  for (const f of fs.readdirSync(captionDir)) {
    if (f.endsWith('.json')) Object.assign(captions, read(path.join('src/data/captions', f)));
  }

  const visitsOf = new Map();
  for (const s of stops) {
    const list = visitsOf.get(s.city);
    if (list) list.push(s);
    else visitsOf.set(s.city, [s]);
  }
  const rows = new Map();
  for (const data of Object.values(cityPhotos)) {
    for (const photo of data.photos) {
      const visits = visitsOf.get(Object.keys(cityPhotos).find((c) => cityPhotos[c] === data));
      if (!visits) continue;
      let chosen = visits[0];
      if (visits.length > 1) {
        const day = dayOf(photo.date);
        if (day) {
          let best = Infinity;
          for (const v of visits) {
            const gap = daysOutside(day, v);
            if (gap < best) {
              best = gap;
              chosen = v;
            }
            if (best === 0) break;
          }
        }
      }
      const en = captions[photo.id]?.en?.trim();
      if (!en) continue;
      const list = rows.get(chosen.id) ?? [];
      list.push({ date: photo.date, en });
      rows.set(chosen.id, list);
    }
  }
  const out = {};
  for (const s of stops) {
    const list = rows.get(s.id);
    if (!list) continue;
    list.sort((a, b) => +new Date(a.date) - +new Date(b.date));
    out[String(s.id)] = list.map((r) => r.en);
  }
  return out;
}

export const OUT = path.join(ROOT, 'api/stopCaptions.json');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = buildStopCaptions();
  const text = JSON.stringify(out, null, 2) + '\n';
  const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (before !== text) fs.writeFileSync(OUT, text);
  const n = Object.values(out).reduce((a, l) => a + l.length, 0);
  console.log(
    `api/stopCaptions.json: ${Object.keys(out).length} stops, ${n} captions${before === text ? ' (unchanged)' : ''}`
  );
}
