// 검색 데이터의 판: 정거장·이야기·태그·캡션 파일의 해시. 배포마다 바뀌면 엣지 캐시 URL(v=)이
// 바뀌어 묵은 답이 나가지 않고, 구운 예시(searchExamples.json)의 신선도도 이것으로 잰다.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_FILES = [
  'src/data/journey.json',
  'src/data/cityNotes.json',
  'src/data/photoTags.json',
  'src/data/cities.json',
  'api/stopCaptions.json',
];

/** Ten hex characters of the hash of the data /api/search answers from. */
export function dataVersion() {
  const h = createHash('sha256');
  for (const f of DATA_FILES) h.update(fs.readFileSync(path.join(ROOT, f)));
  return h.digest('hex').slice(0, 10);
}
