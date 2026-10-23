// Fotografa gli STL di una cartella con three.js in Chrome, con luce radente e una camera per ogni file (views.json nella cartella):
//   { "nome": { "pos": [x, y, z], "target": [x, y, z], "sun": [x, y, z] (facoltativo), "color": "#rrggbb" (facoltativo) } }
//   node scripts/texture-render.mjs <cartella STL e views.json> [cartella dei PNG, predefinita docs/studio-texture]
// Serve il Chrome installato (come i test e2e) e il pacchetto three già presente in node_modules.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const SRC = resolve(process.argv[2] || '');
const OUT = resolve(process.argv[3] || join(ROOT, 'docs/studio-texture'));
mkdirSync(OUT, { recursive: true });
const views = JSON.parse(readFileSync(join(SRC, 'views.json'), 'utf8'));
const { chromium } = await import(pathToFileURL(join(ROOT, 'node_modules/@playwright/test/index.mjs')).href);

const page = `<!doctype html><html><body style="margin:0;background:#1d2127">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<canvas id="c" width="900" height="600"></canvas>
<script type="module">
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
const q = new URLSearchParams(location.search);
const v = JSON.parse(q.get('v'));
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setSize(900, 600);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1d2127');
const geo = await new STLLoader().loadAsync('/stl/' + q.get('n') + '.stl');
geo.computeVertexNormals();
scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: v.color || '#c9d1dc', roughness: 0.75, metalness: 0.05 })));
scene.add(new THREE.HemisphereLight('#ffffff', '#3a3f48', 0.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.8);
sun.position.set(...(v.sun || [-32, -20, 17]));
scene.add(sun);
const cam = new THREE.PerspectiveCamera(v.fov || 32, 900 / 600, 0.1, 800);
cam.position.set(...v.pos);
cam.up.set(0, 0, 1);
cam.lookAt(...v.target);
renderer.render(scene, cam);
window.__done = true;
</script></body></html>`;

const types = { '.js': 'text/javascript', '.stl': 'application/octet-stream', '.html': 'text/html' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/r.html') { res.setHeader('content-type', 'text/html'); return res.end(page); }
  // Solo le due cartelle servite, senza uscirne (niente `..` nemmeno codificati)
  const [base, rest] = url.pathname.startsWith('/stl/') ? [SRC, url.pathname.slice(5)] : url.pathname.startsWith('/three/') ? [join(ROOT, 'node_modules/three'), url.pathname.slice(7)] : [null, ''];
  const file = base && resolve(base, decodeURIComponent(rest));
  if (!file || !(file === base || file.startsWith(base + sep)) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 900, height: 600 } });
p.on('console', (m) => console.log('console', m.text()));
p.on('pageerror', (e) => console.log('pageerror', e.message));
for (const [name, view] of Object.entries(views)) {
  await p.goto(`http://127.0.0.1:${port}/r.html?n=${encodeURIComponent(name)}&v=${encodeURIComponent(JSON.stringify(view))}`);
  await p.waitForFunction(() => window.__done, null, { timeout: 60000 });
  await p.locator('#c').screenshot({ path: join(OUT, `${name}.png`) });
  console.log('ok', name);
}
await browser.close();
server.close();
