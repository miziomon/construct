// Misura quanto cambia la scala di grigi decodificando la stessa immagine in modi diversi: Chrome (createImageBitmap senza conversione di colore,
// createImageBitmap predefinito, elemento img) contro Node (sharp/libvips e librsvg). Usa la formula intera del prototipo. Da lanciare dalla radice:
//   node scripts/texture-decode-check.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const { chromium } = await import(pathToFileURL(join(ROOT, 'node_modules/@playwright/test/index.mjs')).href);
const { default: sharp } = await import('sharp');

const W = 256;
// Immagine "fotografica": rumore a bassa frequenza più grana, valori continui (il caso peggiore per JPEG)
const rgb = Buffer.alloc(W * W * 3);
for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
  const base = 128 + 70 * Math.sin(i / 17) * Math.cos(j / 23) + 40 * Math.sin((i + j) / 7);
  const grain = ((Math.imul(i * 7919 + j * 104729, 2654435761) >>> 24) - 128) * 0.25;
  const v = Math.max(0, Math.min(255, base + grain));
  rgb.set([v, Math.max(0, Math.min(255, v * 0.9 + 12)), Math.max(0, Math.min(255, v * 0.7 + 30))], (j * W + i) * 3);
}
const alpha = Buffer.alloc(W * W * 4);
for (let k = 0; k < W * W; k++) alpha.set([rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2], 40 + ((k * 7) % 200)], k * 4);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256"><circle cx="50" cy="50" r="40" fill="#000"/><polygon points="50,15 62,45 90,45 68,62 76,90 50,72 24,90 32,62 10,45 38,45" fill="#fff"/></svg>`;
const files = {
  'png-grigio': await sharp(rgb, { raw: { width: W, height: W, channels: 3 } }).greyscale().png().toBuffer(),
  'png-rgb': await sharp(rgb, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer(),
  'png-p3': await sharp(rgb, { raw: { width: W, height: W, channels: 3 } }).withIccProfile('p3').png().toBuffer(),
  'png-alfa': await sharp(alpha, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer(),
  'jpg-q90': await sharp(rgb, { raw: { width: W, height: W, channels: 3 } }).jpeg({ quality: 90 }).toBuffer(),
  'jpg-q60': await sharp(rgb, { raw: { width: W, height: W, channels: 3 } }).jpeg({ quality: 60 }).toBuffer(),
  'svg': Buffer.from(svg),
};
const mime = { svg: 'image/svg+xml', jpg: 'image/jpeg', png: 'image/png' };

const html = readFileSync(join(ROOT, 'docs/prototipi/texture-immagine.html'));
const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__texture?.last, null, { timeout: 90000 });

// Riferimento in Node: libvips (o librsvg) senza gestione del colore, alfa dritto, formula intera del prototipo
const grayNode = async (name, buf) => {
  const { data } = await sharp(buf, { density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return page.evaluate(({ d, w }) => Array.from(window.__texture.rgbaToGray(Uint8Array.from(d), w, w).data), { d: Array.from(data), w: W });
};
const diff = (a, b) => { let max = 0, sum = 0, n = 0; for (let k = 0; k < a.length; k++) { const d = Math.abs(a[k] - b[k]); max = Math.max(max, d); sum += d; if (d > 0) n++; } return { max, mean: sum / a.length, share: n / a.length }; };

for (const [name, buf] of Object.entries(files)) {
  const type = mime[name.split('-')[0]] || 'image/png';
  const ref = await grayNode(name, buf);
  const viaBrowser = await page.evaluate(async ({ b64, type, w }) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });
    const toGray = (source) => { const c = document.createElement('canvas'); c.width = w; c.height = w; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(source, 0, 0, w, w); return Array.from(window.__texture.rgbaToGray(ctx.getImageData(0, 0, w, w).data, w, w).data); };
    const out = {};
    if (type !== 'image/svg+xml') {
      out.nessunaConversione = toGray(await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
      out.predefinito = toGray(await createImageBitmap(blob));
    }
    const url = URL.createObjectURL(blob), im = new Image(); im.src = url; await im.decode();
    out.elementoImg = toGray(im);
    return out;
  }, { b64: buf.toString('base64'), type, w: W });
  for (const [mode, g] of Object.entries(viaBrowser)) {
    const d = diff(ref, g);
    console.log(`${name.padEnd(11)} ${mode.padEnd(18)} differenza massima ${String(d.max).padStart(3)}/255, media ${d.mean.toFixed(3)}, pixel diversi ${(d.share * 100).toFixed(1)} %`);
  }
}
await browser.close();
server.close();
