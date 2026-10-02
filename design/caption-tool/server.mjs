// The caption tool (D1) — internal, never built or deployed.
//
//   node design/caption-tool/server.mjs            → http://127.0.0.1:5181
//   HOST=100.98.29.113 node design/caption-tool/server.mjs   (Tailscale only)
//
// Reads and writes design/photo-themes/captions/<cityCode>.json in this
// worktree, formatted by the repo's prettier so a commit carries only the
// words that changed. Photos are the local originals under the main working
// tree's photos/cities/ (never Cloudinary). Clues come from facts.jsonl, which
// is local only and is shown here but never written anywhere.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, renameSync, existsSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const MAIN = process.env.MAIN_TREE ?? '/Users/ruo/projects/worldtrip-site';
const CAPTIONS = join(repo, 'design', 'photo-themes', 'captions');
const PHOTOS = join(MAIN, 'photos', 'cities');
const FACTS = join(MAIN, 'design', 'photo-themes', 'facts.jsonl');
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 5181);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---- the photos, in the order the tool walks them ---------------------------------
const cityPhotos = readJson(join(repo, 'src', 'data', 'cityPhotos.json'));
const journey = readJson(join(repo, 'src', 'data', 'journey.json'));
const tags = readJson(join(repo, 'src', 'data', 'photoTags.json'));
const review = readJson(join(here, 'review.json'));

const facts = new Map();
if (existsSync(FACTS)) {
  for (const line of readFileSync(FACTS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const f = JSON.parse(line);
    facts.set(f.photoId, f);
  }
}

/** photoId → { cityCode, city (ko), date, file } */
const photos = new Map();
const files = new Map(); // cityCode → names in its folder
for (const [city, data] of Object.entries(cityPhotos)) {
  const code = data.cityCode;
  if (!files.has(code)) {
    const dir = join(PHOTOS, code);
    files.set(code, existsSync(dir) ? readdirSync(dir) : []);
  }
  for (const p of data.photos) {
    const uuid = facts.get(p.id)?.uuid;
    const name = uuid ? files.get(code).find((n) => n.startsWith(uuid)) : undefined;
    photos.set(p.id, { cityCode: code, city, date: p.date ?? '', file: name ? join(PHOTOS, code, name) : null });
  }
}

// cities in the order the journey first reached them, each city's photos by time
const cityOrder = [];
for (const s of journey.stops) if (cityPhotos[s.city] && !cityOrder.includes(s.city)) cityOrder.push(s.city);
for (const c of Object.keys(cityPhotos)) if (!cityOrder.includes(c)) cityOrder.push(c);

function order() {
  const seen = new Set();
  const out = [];
  const reviewIds = review.photos.filter((id) => photos.has(id));
  for (const id of reviewIds) {
    seen.add(id);
    out.push({ id, group: 'review' });
  }
  for (const city of cityOrder) {
    const list = [...cityPhotos[city].photos].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    for (const p of list) if (!seen.has(p.id)) out.push({ id: p.id, group: city });
  }
  return out;
}

// ---- captions ---------------------------------------------------------------------
const capPath = (code) => join(CAPTIONS, `${code}.json`);
const readCaps = (code) => (existsSync(capPath(code)) ? readJson(capPath(code)) : {});

function allCaptions() {
  const out = {};
  for (const name of readdirSync(CAPTIONS)) if (name.endsWith('.json')) Object.assign(out, readJson(join(CAPTIONS, name)));
  return out;
}

let writing = Promise.resolve();
function saveCaption(id, ko, en) {
  const job = writing.then(async () => {
    const { cityCode } = photos.get(id);
    const caps = readCaps(cityCode);
    caps[id] = { ko, en };
    const sorted = Object.fromEntries(Object.keys(caps).sort().map((k) => [k, caps[k]]));
    const file = capPath(cityCode);
    const options = (await prettier.resolveConfig(file)) ?? {};
    // indented first: prettier keeps an object open only if it already was,
    // and every caption in these files is written open
    const text = await prettier.format(JSON.stringify(sorted, null, 2), { ...options, filepath: file });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  });
  writing = job.catch(() => {});
  return job;
}

// ---- clues: shown beside the photo, never put into a caption ----------------------
function cluesOf(id) {
  const f = facts.get(id) ?? {};
  const p = photos.get(id);
  return {
    apple: f.appleCaption ?? '',
    address: f.address ?? '',
    landmarks: [...(f.landmarks ?? []), ...(f.pois ?? [])],
    time: (f.localTime ?? p.date ?? '').replace('T', ' ').slice(0, 16),
    people: f.people ?? [],
    themes: tags.photos[id] ?? [],
  };
}

// ---- http -------------------------------------------------------------------------
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, readFileSync(join(here, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const caps = allCaptions();
      const list = order().map(({ id, group }) => {
        const p = photos.get(id);
        return { id, group, city: p.city, hasFile: Boolean(p.file), ko: caps[id]?.ko ?? '', en: caps[id]?.en ?? '' };
      });
      return send(res, 200, { list, themes: tags.categories, reviewNote: review.note ?? '' });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/clues/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/clues/'.length));
      if (!photos.has(id)) return send(res, 404, { error: 'no such photo' });
      return send(res, 200, cluesOf(id));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
      const id = decodeURIComponent(url.pathname.slice('/img/'.length));
      const file = photos.get(id)?.file;
      if (!file) return send(res, 404, 'no local file', 'text/plain');
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' });
      return createReadStream(file).pipe(res);
    }
    if (req.method === 'POST' && url.pathname === '/api/caption') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 20000) return send(res, 413, { error: 'too long' });
      }
      const { id, ko, en } = JSON.parse(raw);
      if (!photos.has(id)) return send(res, 404, { error: 'no such photo' });
      if (typeof ko !== 'string' || typeof en !== 'string') return send(res, 400, { error: 'ko and en are text' });
      const k = ko.trim();
      const e = en.trim();
      if (!k || !e) return send(res, 400, { error: 'ko와 en 둘 다 써야 저장된다' });
      await saveCaption(id, k, e);
      return send(res, 200, { ok: true, id, ko: k, en: e });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, HOST, () => {
  const missing = [...photos.values()].filter((p) => !p.file).length;
  console.log(`caption tool  http://${HOST}:${PORT}/  · ${photos.size} photos · ${missing} without a local file · facts ${facts.size}`);
});
