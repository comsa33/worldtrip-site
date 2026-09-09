// Dev helper: screenshot the local preview at a given stop with headless Chrome.
// node scripts/shot.mjs <out.png> [stopId] [width height]
import puppeteer from 'puppeteer-core';
const [out = 'shot.png', stop = '', w = '1440', h = '900'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
if (process.env.THEME) await page.evaluateOnNewDocument((t) => localStorage.setItem('theme', t), process.env.THEME);
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`http://localhost:4173/${stop ? `?stop=${stop}` : ''}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: out });
console.log(`saved ${out} · scrollY=${await page.evaluate(() => window.scrollY)}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
