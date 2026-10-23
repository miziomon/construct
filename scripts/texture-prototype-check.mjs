// Prova il prototipo docs/prototipi/texture-immagine.html in Chrome (Playwright): nessun errore in console, caricamento di PNG, JPG e SVG,
// cambio di motore e di oggetto, schermate in docs/studio-texture/. Da lanciare dalla radice del repository:
//   node scripts/texture-prototype-check.mjs [cartella delle schermate, predefinita docs/studio-texture]
// Serve il Chrome installato (come i test e2e), la rete (manifold-3d e three.js da jsDelivr) e `sharp` per le immagini di prova.
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const OUT = resolve(process.argv[2] || join(ROOT, 'docs/studio-texture'));
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(pathToFileURL(join(ROOT, 'node_modules/@playwright/test/index.mjs')).href);
const { default: sharp } = await import('sharp');

// Immagini di prova: un PNG (gradiente a onde), un JPG (stesso disegno) e uno SVG (stemma)
const dir = mkdtempSync(join(tmpdir(), 'texture-proto-'));
const W = 256;
const raw = Buffer.alloc(W * W * 3);
for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
  const v = Math.round(127.5 + 127.5 * Math.sin((2 * Math.PI * (3 * i + 40 * Math.sin((2 * Math.PI * 2 * j) / W))) / W));
  raw.set([v, v, v], (j * W + i) * 3);
}
await sharp(raw, { raw: { width: W, height: W, channels: 3 } }).png().toFile(join(dir, 'onde.png'));
await sharp(raw, { raw: { width: W, height: W, channels: 3 } }).jpeg({ quality: 85 }).toFile(join(dir, 'onde.jpg'));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400"><rect width="100" height="100" fill="#fff"/><path fill-rule="evenodd" d="M50 4 A46 46 0 1 1 49.99 4 Z M50 12 A38 38 0 1 0 50.01 12 Z"/><polygon points="50,22 58,42 80,42 62,55 69,76 50,63 31,76 38,55 20,42 42,42"/></svg>`;
writeFileSync(join(dir, 'stemma.svg'), svg);

const html = readFileSync(join(ROOT, 'docs/prototipi/texture-immagine.html'));
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(html);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
let failed = false;
const check = (cond, text) => { console.log(`${cond ? 'ok   ' : 'FALLITO'} ${text}`); if (!cond) failed = true; };

for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: scheme });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${scheme}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${scheme}] pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/`);
  // Attesa del primo risultato: l'ultimo calcolo compare nella barra di stato
  const ready = () => page.waitForFunction(() => window.__texture?.last && !document.getElementById('stat').textContent.includes('…'), null, { timeout: 90000 });
  const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: join(OUT, `${name}-${scheme}.png`) }); };
  const stat = () => page.evaluate(() => ({ ...window.__texture.last.stats, ms: window.__texture.last.ms, scadKb: window.__texture.last.scadKb, msg: document.getElementById('msg').textContent }));
  await ready();
  let s = await stat();
  check(s.status === 'NoError' && s.triangles > 1000, `[${scheme}] pannello, motore F, pelle: ${s.status}, ${s.triangles} triangoli, ${s.ms.toFixed(0)} ms`);
  await shot('01-pannello-F-pelle');

  if (scheme === 'light') {
    // Immagini caricate: PNG, JPG e SVG
    for (const [file, name] of [['onde.png', '02-pannello-F-png'], ['onde.jpg', '03-pannello-F-jpg'], ['stemma.svg', '04-pannello-F-svg']]) {
      const before = await page.evaluate(() => window.__texture.runs);
      await page.setInputFiles('#file', join(dir, file));
      await page.waitForFunction((f) => document.getElementById('imgInfo').textContent.startsWith(f), file, { timeout: 30000 });
      await page.waitForFunction((n) => window.__texture.runs > n, before, { timeout: 60000 });
      s = await stat();
      check(s.status === 'NoError', `${file}: ${s.status}, ${s.triangles} triangoli, ${s.ms.toFixed(0)} ms, info "${await page.textContent('#imgInfo')}"`);
      await shot(name);
    }
    // Torna a un esempio, poi motore M su pannello, cilindro e cubo
    await page.selectOption('#sample', 'knurl');
    await page.waitForFunction(() => document.getElementById('imgInfo').textContent.includes('knurl'));
    await ready();
    for (const [obj, name, proj] of [['panel', '05-pannello-M', 'triplanar'], ['cyl', '06-cilindro-M', 'cylindrical'], ['cube', '07-cubo-M', 'triplanar']]) {
      await page.click(`[data-k="engine"] button[data-v="M"]`);
      await page.click(`[data-k="obj"] button[data-v="${obj}"]`);
      await page.selectOption('#proj', proj);
      await page.fill('input[type="number"][data-k="amp"]', '0.8');
      await page.dispatchEvent('input[type="number"][data-k="amp"]', 'input');
      await page.waitForTimeout(300);
      await ready();
      s = await stat();
      check(s.status === 'NoError' && s.flipped === 0, `${obj} motore M ${proj}: ${s.status}, ${s.triangles} triangoli, ${s.flipped} rovesciati, ${s.ms.toFixed(0)} ms`);
      await shot(name);
    }
    // Normali separate: manifold rifiuta la mesh aperta e il prototipo lo dice
    await page.selectOption('#normals', 'split');
    await page.waitForTimeout(500);
    const msg = await page.textContent('#msg');
    check(/Nessun solido/.test(msg), `normali separate: "${msg.slice(0, 80)}"`);
    await shot('08-cubo-M-separate');
    await page.selectOption('#normals', 'smooth');
    // Cilindro e cubo con il motore F (faccia superiore)
    await page.click(`[data-k="engine"] button[data-v="F"]`);
    await page.click(`[data-k="obj"] button[data-v="cyl"]`);
    await page.waitForTimeout(300);
    await ready();
    s = await stat();
    check(s.status === 'NoError', `cilindro motore F: ${s.status}, ${s.triangles} triangoli`);
    await shot('09-cilindro-F');
    // Download: STL e .scad
    const [stl] = await Promise.all([page.waitForEvent('download'), page.click('#dlStl')]);
    check((await stl.suggestedFilename()).endsWith('.stl'), `scarico ${await stl.suggestedFilename()}`);
    const [scad] = await Promise.all([page.waitForEvent('download'), page.click('#dlScad')]);
    check((await scad.suggestedFilename()).endsWith('.scad'), `scarico ${await scad.suggestedFilename()}`);
  }
  await page.close();
}
await browser.close();
server.close();
console.log(errors.length ? `Console: ${errors.length} messaggi\n${errors.join('\n')}` : 'Console: nessun errore né avviso');
if (errors.length) failed = true;
process.exit(failed ? 1 : 0);
