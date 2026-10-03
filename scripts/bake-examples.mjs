// 예시 다섯(ko·en)의 답을 운영 로직(questionsFor·resultOf)으로 한 번 구워 src/data/searchExamples.json 에 둔다.
// 매 배포가 아니라 데이터가 바뀔 때만 다시 굽는다(테스트가 version 으로 신선도를 본다). Jev 10건.
// 실행: TYPESAFE_API_KEY=… node scripts/bake-examples.mjs   (.env.local 의 키도 읽는다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataVersion } from './dataVersion.ts';
import { EXAMPLES } from '../src/lib/askExamples.ts';
import { questionsFor, resultOf, themeOf, normalize, rankByTheme } from '../api/search.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/searchExamples.json');
let key = process.env.TYPESAFE_API_KEY;
if (!key && fs.existsSync(path.join(ROOT, '.env.local')))
  key = fs
    .readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .match(/^TYPESAFE_API_KEY=(.*)$/m)?.[1]
    ?.trim();
if (!key) throw new Error('TYPESAFE_API_KEY');

const version = dataVersion();
const prev = fs.existsSync(OUT)
  ? JSON.parse(fs.readFileSync(OUT, 'utf8'))
  : { version: '', results: {} };
const results = {};
const questions = questionsFor();
let calls = 0;
for (const words of [...EXAMPLES.ko, ...EXAMPLES.en]) {
  const q = normalize(words);
  const theme = themeOf(q);
  if (theme) {
    results[q] = { theme, stops: rankByTheme(theme) };
    continue;
  }
  if (prev.version === version && prev.results[q]) {
    results[q] = prev.results[q];
    console.log(q, '— kept (same data)');
    continue;
  }
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: { query: q }, questions }),
    signal: AbortSignal.timeout(30000),
  });
  calls += 1;
  if (!res.ok) throw new Error(`${q}: HTTP ${res.status}`);
  const data = await res.json();
  results[q] = resultOf(data.answers ?? {});
  console.log(
    `${q} → ${results[q].stops.length} stops, themes ${(results[q].themes ?? []).map((t) => t.id).join(' ')} (${data.usage?.input_tokens} in)`
  );
}
fs.writeFileSync(OUT, JSON.stringify({ version, results }, null, 2) + '\n');
console.log(
  `searchExamples.json: ${Object.keys(results).length} examples, version ${version}, Jev ${calls}`
);
