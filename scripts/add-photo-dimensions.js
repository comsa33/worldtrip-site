/**
 * 사진의 실제 크기를 cityPhotos.json 에 구워 넣는다.
 *
 * 크기를 미리 알면 사진이 도착하기 전에 프레임이 제자리를 잡는다 — 라이트박스가
 * 빈칸으로 튀지 않고, srcset 도 표시 크기에 맞춰 고를 수 있다.
 * Admin API 목록 호출만 쓰므로(500장씩) 사진 수와 무관하게 몇 번이면 끝난다.
 *
 * 사용법: node scripts/add-photo-dimensions.js [--dry]
 */

import { v2 as cloudinary } from 'cloudinary';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const DRY = process.argv.includes('--dry');
const JSON_PATH = path.join(__dirname, '../src/data/cityPhotos.json');

/** Every upload under cities/, as publicId -> {w, h}. */
async function fetchSizes() {
  const sizes = new Map();
  let cursor;
  let calls = 0;
  do {
    const res = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'cities/',
      max_results: 500,
      next_cursor: cursor,
    });
    for (const r of res.resources) {
      if (r.width && r.height) sizes.set(r.public_id, { w: r.width, h: r.height });
    }
    cursor = res.next_cursor;
    calls += 1;
  } while (cursor);
  console.log(`Cloudinary: ${sizes.size}장의 크기를 ${calls}번의 호출로 읽었다`);
  return sizes;
}

const sizes = await fetchSizes();
const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

let filled = 0;
let missing = 0;
for (const city of Object.values(data)) {
  for (const photo of city.photos) {
    const size = sizes.get(photo.publicId);
    if (!size) {
      missing += 1;
      continue;
    }
    photo.w = size.w;
    photo.h = size.h;
    filled += 1;
  }
}

console.log(`채움 ${filled}장 · 못 찾음 ${missing}장`);
if (DRY) {
  console.log('--dry: 파일은 건드리지 않았다');
} else {
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
  console.log(`${path.relative(process.cwd(), JSON_PATH)} 갱신`);
}
