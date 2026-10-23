// Fotografa gli STL di docs/studio-rilievo con three.js in Chrome (luce radente per far risaltare il rilievo).
// Da lanciare dalla radice del repository, dopo aver rigenerato gli STL:
//   $env:RELIEF_SAMPLES='1'; npx vitest run src/kernel/relief.test.ts -t esempi
//   node scripts/relief-render.mjs [cartella dei PNG, predefinita docs/studio-rilievo] [vista: a = tre quarti, b = più vicina]
// Serve il Chrome installato (come i test e2e) e il pacchetto three già presente in node_modules.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const { chromium } = await import(pathToFileURL(join(ROOT, 'node_modules/@playwright/test/index.mjs')).href);

const page = `<!doctype html><html><body style="margin:0;background:#1d2127">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<canvas id="c" width="1000" height="640"></canvas>
<script type="module">
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
const name = new URLSearchParams(location.search).get('n');
const view = new URLSearchParams(location.search).get('v') || 'a';
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1000, 640);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1d2127');
const geo = await new STLLoader().loadAsync('/docs/studio-rilievo/' + name + '.stl');
geo.computeVertexNormals();
const colors = { brick: '#b5533c', wood: '#c08a55', rust: '#8a4a2b', studs: '#9aa3ad', hammered: '#c4703f' };
const mat = new THREE.MeshStandardMaterial({ color: colors[name], roughness: name === 'hammered' || name === 'studs' ? 0.35 : 0.8, metalness: name === 'hammered' ? 0.7 : name === 'studs' ? 0.6 : 0.05, flatShading: false });
scene.add(new THREE.Mesh(geo, mat));
scene.add(new THREE.HemisphereLight('#ffffff', '#3a3f48', 0.9));
// Luce radente da un lato: mette in evidenza il rilievo
const sun = new THREE.DirectionalLight('#ffffff', 2.6);
sun.position.set(-32, -20, 17);
scene.add(sun);
const cam = new THREE.PerspectiveCamera(32, 1000 / 640, 1, 500);
if (view === 'a') cam.position.set(14, -48, 40); else cam.position.set(0, -34, 26);
cam.up.set(0, 0, 1);
cam.lookAt(0, 0, -1);
renderer.render(scene, cam);
window.__done = true;
</script></body></html>`;

const types = { '.js': 'text/javascript', '.stl': 'application/octet-stream', '.html': 'text/html' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/r.html') {
    res.setHeader('content-type', 'text/html');
    return res.end(page);
  }
  // Il percorso decodificato deve restare dentro la cartella servita (niente `..` nemmeno codificati)
  const file = resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.statusCode = 403;
    return res.end('vietato');
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('no');
  }
  res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
  // Solo l'interfaccia locale: il server non è raggiungibile dalla rete
}).listen(4555, '127.0.0.1');

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 1000, height: 640 } });
p.on('console', (m) => console.log('console', m.text()));
p.on('pageerror', (e) => console.log('pageerror', e.message));
for (const name of ['brick', 'wood', 'rust', 'studs', 'hammered']) {
  await p.goto(`http://127.0.0.1:4555/r.html?n=${name}&v=${process.argv[3] || 'a'}`);
  await p.waitForFunction(() => window.__done, null, { timeout: 60000 });
  await p.locator('#c').screenshot({ path: join(process.argv[2] || join(ROOT, 'docs/studio-rilievo'), `${name}.png`) });
  console.log('ok', name);
}
await browser.close();
server.close();
