// 정거장마다 그곳 사진들의 캡션(en)을 모은다 → api/stopCaptions.json
// /api/search 가 Jev 에게 정거장을 설명할 때 쓴다(cityNotes en · 주제 사진 수 와 함께).
// 사진→정거장 짝은 사이트와 같은 규칙(src/lib/visitPhotos.ts: 찍은 날이 든 방문, 없으면
// 가장 가까운 방문)으로 배포 데이터(cityPhotos.json · journey.json)에서만 만든다.
// Apple 설명문·장면 라벨·얼굴 이름은 재료가 아니다.
// 요약용 사본 api/stopSummary.json 도 함께 만든다: 정거장 이야기·캡션을 Jev 입력에 맞게 줄인 것
// (화면의 캡션과 사진 고르기는 stopCaptions.json 그대로).
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

/** { "<stopId>": [{ id, en }, …] } — 찍은 차례, 빈 캡션은 뺀다. id 는 사진 고르기(B)가 쓴다. */
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
      list.push({ date: photo.date, id: photo.id, en });
      rows.set(chosen.id, list);
    }
  }
  const out = {};
  for (const s of stops) {
    const list = rows.get(s.id);
    if (!list) continue;
    list.sort((a, b) => +new Date(a.date) - +new Date(b.date));
    out[String(s.id)] = list.map((r) => ({ id: r.id, en: r.en }));
  }
  return out;
}

export const OUT = path.join(ROOT, 'api/stopCaptions.json');

// ---- 요약용 사본 ---------------------------------------------------------------
// 검색 한 번에 정거장 요약 전부가 Jev 로 간다(입력 한도 64K). 2026-10-03 측정: 아래 셋을
// 합치면 46.8K → 39.3K 토큰, 질의 여섯의 상위 12곳이 Q2 그대로와 47/50 겹치고 맞힌 곳 수는
// 같았다. 정거장당 20장 상한은 「30장 중 한 장」인 정거장의 그 한 장을 버려 쓰지 않는다.
const ARTICLES = /\b(a|an|the)\b\s*/gi;
const FILLER = /\b(I|my|was|were|there|just|very)\b\s*/g;
const IGNORED = new Set('a an the i my me we our was were is are it its there this that so just then very also'.split(' '));
const wordsOf = (s) =>
  new Set((s.toLowerCase().match(/[a-zà-ÿ0-9'-]+/g) ?? []).filter((w) => w.length > 2 && !IGNORED.has(w)));
const overlap = (a, b) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
};

/** { "<stopId>": { story?, captions } } — Jev 에게 보내는 이야기·캡션, 줄인 것. */
export function buildStopSummary(stopCaptions = buildStopCaptions()) {
  const notes = read('src/data/cityNotes.json');
  const out = {};
  for (const s of read('src/data/journey.json').stops) {
    const story = notes[String(s.id)]?.en?.story?.replace(/\s*\n\s*/g, ' ').trim();
    const list = stopCaptions[String(s.id)] ?? [];
    if (!story && !list.length) continue;
    const storyWords = story ? wordsOf(story) : new Set();
    const kept = [];
    const seen = [];
    for (const { en } of list) {
      const w = wordsOf(en);
      // ① 이야기가 이미 말한 것(낱말의 60% 이상이 이야기에 있다)
      if (w.size && overlap(w, storyWords) / w.size >= 0.6) continue;
      // ② 앞의 캡션과 거의 같은 것(자카드 0.6 이상)
      if (seen.some((x) => { const n = overlap(x, w); return n / (x.size + w.size - n || 1) >= 0.6; })) continue;
      seen.push(w);
      // ③ 관사·대명사 같은 군말을 걷는다
      const short = en.trim().replace(/[.。]$/, '').replace(ARTICLES, '').replace(FILLER, '').replace(/\s+/g, ' ').replace(/[.,]$/, '').trim();
      if (short) kept.push(short);
    }
    const row = { captions: kept };
    if (story) row.story = story.replace(ARTICLES, '');
    out[String(s.id)] = row;
  }
  return out;
}

export const SUMMARY_OUT = path.join(ROOT, 'api/stopSummary.json');

function write(file, data) {
  const text = JSON.stringify(data, null, 2) + '\n';
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (before !== text) fs.writeFileSync(file, text);
  return before === text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = buildStopCaptions();
  const same = write(OUT, out);
  const n = Object.values(out).reduce((a, l) => a + l.length, 0);
  console.log(
    `api/stopCaptions.json: ${Object.keys(out).length} stops, ${n} captions${same ? ' (unchanged)' : ''}`
  );
  const summary = buildStopSummary(out);
  const sameSummary = write(SUMMARY_OUT, summary);
  const k = Object.values(summary).reduce((a, r) => a + r.captions.length, 0);
  console.log(`api/stopSummary.json: ${k} captions for Jev${sameSummary ? ' (unchanged)' : ''}`);
}
