// Prova il prototipo docs/prototipi/profilo-quote.html in Chrome (Playwright, senza server: file://) e ne salva le immagini.
// Controlla che non ci siano errori in console e percorre i gesti principali: quota digitata, vincolo, sovravincolo, trascinamento.
// Uso: node scripts/quote-prototype-check.mjs [--shots]   (--shots scrive docs/images/profilo-quote-*.png)
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const url = pathToFileURL(root + 'docs/prototipi/profilo-quote.html').href;
const shots = process.argv.includes('--shots');
const errors = [];
const results = [];
const ok = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log((cond ? 'OK      ' : 'FALLITO ') + name + (extra ? ' (' + extra + ')' : '')); };

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.__proto);
await page.waitForTimeout(800);

const shot = async (name, panel) => {
  if (!shots) return;
  await page.waitForSelector('#toast', { state: 'hidden', timeout: 6000 }).catch(() => {});
  await page.evaluate((p) => { const o = document.getElementById('opts'); if (p) document.getElementById(p).scrollIntoView(); else o.scrollTop = 0; }, panel || null);
  await page.waitForTimeout(150);
  await page.locator('#frame').screenshot({ path: root + `docs/images/profilo-quote-${name}.png` });
};
const st = () => page.evaluate(() => { const S = window.__proto.S; return { n: S.cons.length, rep: S.rep && { state: S.rep.state, dof: S.rep.dof, conv: S.rep.converged, red: S.rep.redundant.length, conf: S.rep.conflicting.length }, paths: S.paths.length }; });
const status = () => page.locator('#status').innerText();
// Posizione dello schermo (pixel nella pagina) di un punto del disegno
const scr = (x, y) => page.evaluate(([x, y]) => { const P = window.__proto, s = P.toS([x, y]), r = document.getElementById('svg').getBoundingClientRect(); return [r.left + s[0], r.top + s[1]]; }, [x, y]);
const node = (pi, ni) => page.evaluate(([pi, ni]) => window.__proto.S.paths[pi].nodes[ni].p, [pi, ni]);
const click = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.click(sx, sy); await page.waitForTimeout(120); };
const drag = async (from, to) => { const a = await scr(...from), b = await scr(...to); await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(250); };
const edit = async (value) => { await page.waitForSelector('#qEdit:not([hidden])'); await page.fill('#qEdit', value); await page.keyboard.press('Enter'); await page.waitForTimeout(250); };
const hexa = () => page.evaluate(() => window.__proto.S.paths[0].nodes.map((n) => n.p));

// 1. Piastra con fori quotati: completamente vincolata
await shot('piastra');
await shot('vincoli', 'secCons');
let s = await st();
ok('piastra: 0 gradi di libertà', s.rep && s.rep.dof === 0 && s.rep.state === 'full', JSON.stringify(s.rep));
ok('piastra: il piede dice completamente vincolato', (await status()).includes('Completamente vincolato'));

// 2. Quota digitata: dall'etichetta della larghezza, da 60 a 70
await page.locator('#svg g.ql[data-qid]').filter({ hasText: /^60 / }).first().click();
await edit('70');
let p1 = await node(0, 1);
ok('quota digitata: la larghezza diventa 70', Math.abs(p1[0] - 70) < 1e-6, 'x = ' + p1[0]);
s = await st();
ok('dopo la quota resta completamente vincolato', s.rep && s.rep.dof === 0);
await shot('quota-70');

// 2b. Parametri: la larghezza 80 sposta anche il secondo foro (distanza 0,6 x larghezza)
await page.locator('#btnUndo').click();
await page.waitForTimeout(150);
await page.locator('#parList li[data-p="0"] input.pv').fill('80');
await page.locator('#parList li[data-p="0"] input.pv').press('Enter');
await page.waitForTimeout(300);
{
  const [pw, c2] = await page.evaluate(() => { const S = window.__proto.S; return [S.paths[0].nodes[1].p[0], S.paths[2].circ.c.p[0]]; });
  ok('parametro larghezza = 80: la piastra e la distanza dei fori seguono', Math.abs(pw - 80) < 1e-6 && Math.abs(c2 - (12 + 48)) < 1e-6, 'larghezza ' + pw + ', x del secondo foro ' + c2);
  await page.locator('#zFit').click();
  await shot('parametri', 'secPar');
  await page.locator('#btnUndo').click();
  await page.waitForTimeout(200);
  ok('annulla il cambio di parametro in un passo solo', Math.abs((await node(0, 1))[0] - 60) < 1e-6);
  await page.locator('#btnRedo').click();
  await page.locator('#btnRedo').click().catch(() => {});
  await page.waitForTimeout(200);
}

// 3. Annulla e Ripeti: un passo solo
await page.locator('#btnUndo').click();
await page.waitForTimeout(150);
ok('annulla riporta la larghezza a 60', Math.abs((await node(0, 1))[0] - 60) < 1e-6);
await page.locator('#btnRedo').click();
await page.waitForTimeout(150);
ok('ripeti la riporta a 70', Math.abs((await node(0, 1))[0] - 70) < 1e-6 || Math.abs((await node(0, 1))[0] - 80) < 1e-6);

// 4. Rettangolo con vincoli dedotti, quota, conflitto e quota di riferimento
await page.locator('#ex').selectOption('vuoto');
await page.waitForTimeout(300);
await page.keyboard.press('r');
await drag([0, 20], [15, 30]);
s = await st();
ok('rettangolo: 4 vincoli dedotti (H, V, H, V)', s.n === 4, 'n = ' + s.n);
await page.keyboard.press('d');
await page.locator('#qModeSeg [data-q="h"]').click();
const pick2 = async () => { const [x0, y0] = await node(0, 0), [x1, y1] = await node(0, 1); await click(x0, y0); await click(x1, y1); };
await pick2();
await edit('30');
s = await st();
const w = async () => (await node(0, 1))[0] - (await node(0, 0))[0];
ok('quota orizzontale 30 aggiunta', s.n === 5 && Math.abs(await w() - 30) < 1e-6, 'n = ' + s.n);
await pick2();
await edit('45');
ok('quota in conflitto: compare la barra di proposta', await page.locator('#qbar').isVisible());
ok('quota in conflitto: il disegno non è cambiato', (await st()).n === 5 && Math.abs(await w() - 30) < 1e-6);
await shot('sovravincolo');
await page.locator('#qbarRef').click();
await page.waitForTimeout(250);
s = await st();
ok('aggiunta come quota di riferimento', s.n === 6 && (await page.locator('#svg g.ql.ref').count()) === 1);
await pick2();
await edit('30');
ok('quota uguale e ridondante: diventa di riferimento da sola', (await st()).n === 7 && (await page.locator('#svg g.ql.ref').count()) === 2);

// 4b. Modalità di prova: il vincolo in conflitto viene accettato e il disegno diventa rosso, sovravincolato
await page.locator('#cOver').check();
await page.keyboard.press('d');
await pick2();
await edit('45');
s = await st();
ok('conflitto accettato in modalità di prova: sovravincolato', s.rep && s.rep.state === 'over' && s.rep.conf > 0, JSON.stringify(s.rep));
ok('il piede segnala il sovravincolo', (await status()).includes('Sovravincolato'));
ok('il conflitto è evidenziato in rosso', (await page.locator('#svg .ql.err').count()) >= 1);
await shot('sovravincolo-rosso');
await page.locator('#btnUndo').click();
await page.waitForTimeout(250);
await page.locator('#cOver').uncheck();
await page.evaluate(() => document.activeElement.blur()); // le scorciatoie non valgono con il fuoco in un campo
ok('annullato il conflitto: di nuovo 7 vincoli', (await st()).n === 7, 'n = ' + (await st()).n);

// 5. Vincolo dalla barra: due segmenti già paralleli, il Parallelo è ridondante e viene rifiutato
await page.keyboard.press('k');
{ const [x0, y0] = await node(0, 1), [x1, y1] = await node(0, 2); await click((x0 + x1) / 2, (y0 + y1) / 2); }
{ const [x0, y0] = await node(0, 3), [x1, y1] = await node(0, 0); await click((x0 + x1) / 2, (y0 + y1) / 2); }
await page.waitForFunction(() => !document.querySelector('#cbtns [data-c="parallel"]').disabled, null, { timeout: 3000 }).catch(() => {}); // il pannello si aggiorna al fotogramma successivo
ok('due segmenti scelti: Parallelo abilitato', await page.locator('#cbtns [data-c="parallel"]').isEnabled());
await page.locator('#cbtns [data-c="parallel"]').click();
await page.waitForTimeout(250);
ok('parallelo ridondante rifiutato', (await st()).n === 7);

// 6. Trascinamento con le quote: la larghezza resta 30, l'altezza segue il mouse
await page.keyboard.press('v');
{
  const [x2, y2] = await node(0, 2);
  await drag([x2, y2], [x2 + 8, y2 + 6]);
  const after2 = await node(0, 2), p3 = await node(0, 3);
  ok('trascinamento: la larghezza resta 30', Math.abs(await w() - 30) < 1e-6 && Math.abs(after2[0] - p3[0] - 30) < 1e-6, 'w = ' + await w());
  ok('trascinamento: il nodo ha seguito il mouse in altezza', after2[1] > y2 + 3, 'y: ' + y2.toFixed(2) + ' -> ' + after2[1].toFixed(2));
}

// 7. Penna con misure digitate: numero, Tab, angolo, Invio
await page.locator('#ex').selectOption('vuoto');
await page.waitForTimeout(300);
await page.keyboard.press('p');
{ const a = await scr(-20, 10); await page.mouse.click(a[0], a[1]); }
await page.keyboard.type('25');
await page.waitForSelector('#penIn:not([hidden])');
await page.keyboard.press('Tab');
await page.keyboard.type('30');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
{
  const p = await page.evaluate(() => window.__proto.S.paths[0].nodes.map((n) => n.p));
  const d = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), a = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) * 180 / Math.PI;
  ok('penna: lunghezza 25 e angolo 30 digitati', Math.abs(d - 25) < 1e-6 && Math.abs(a - 30) < 1e-6, d.toFixed(3) + ' mm, ' + a.toFixed(2) + ' gradi');
  s = await st();
  ok('penna: i due valori sono diventati quote', s.n === 2, 'n = ' + s.n);
}
await page.waitForSelector('#toast', { state: 'hidden', timeout: 6000 }).catch(() => {});
await shot('penna');

// 8. Esempi: staffa ed esagono
for (const name of ['staffa', 'esagono']) {
  await page.locator('#ex').selectOption(name);
  await page.keyboard.press('v');
  await page.waitForTimeout(500);
  s = await st();
  ok(name + ': 0 gradi di libertà', s.rep && s.rep.dof === 0 && s.rep.conv, JSON.stringify(s.rep));
  await shot(name);
}
{
  const h = await hexa(), sides = h.map((p, i) => Math.hypot(p[0] - h[(i + 1) % 6][0], p[1] - h[(i + 1) % 6][1]));
  ok('esagono regolare: 6 lati da 20 mm', sides.every((l) => Math.abs(l - 20) < 1e-6), sides.map((l) => l.toFixed(4)).join(' '));
}
{
  const [x3, y3] = await node(0, 3);
  await page.keyboard.press('v');
  await drag([x3, y3], [x3 + 6, y3 + 4]);
  const h = await hexa(), sides = h.map((p, i) => Math.hypot(p[0] - h[(i + 1) % 6][0], p[1] - h[(i + 1) % 6][1]));
  ok('esagono: dopo il trascinamento è ancora regolare', sides.every((l) => Math.abs(l - 20) < 1e-5), sides.map((l) => l.toFixed(3)).join(' '));
}

// 9. Raccordo digitato: staffa, il raccordo R4 dello spigolo interno diventa 6
await page.locator('#ex').selectOption('staffa');
await page.waitForTimeout(500);
await page.keyboard.press('v');
await page.locator('#svg g.ql[data-qid^="f:"]').filter({ hasText: /^R4$/ }).first().click();
await edit('6');
ok('raccordo: R4 diventa R6', await page.evaluate(() => window.__proto.S.paths[0].nodes[3].r === 6), 'r = ' + await page.evaluate(() => window.__proto.S.paths[0].nodes[3].r));
await page.locator('#svg g.ql[data-qid^="f:"]').filter({ hasText: /^R6$/ }).first().click();
await edit('99');
ok('raccordo: un raggio troppo grande si limita allo spazio disponibile', await page.evaluate(() => { const r = window.__proto.S.paths[0].nodes[3].r; return r > 6 && r <= 20; }));
await page.keyboard.press('d');
await page.locator('#qModeSeg [data-q="rad"]').click();
{ const [x, y] = await node(0, 4); await click(x, y); }
await edit('3');
ok('raccordo con lo strumento Quota: R3 sullo spigolo scelto', await page.evaluate(() => window.__proto.S.paths[0].nodes[4].r === 3));

// 10. Cerchio: il diametro cambiato dall'etichetta, con il foro che resta dov'è
await page.locator('#ex').selectOption('piastra');
await page.waitForTimeout(500);
await page.keyboard.press('v');
await page.locator('#svg g.ql[data-qid]').filter({ hasText: /^Ø5,5$/ }).first().click();
await edit('8');
{
  const d = await page.evaluate(() => { const S = window.__proto.S, c = S.paths[1]; return [Math.hypot(c.nodes[0].p[0] - c.circ.c.p[0], c.nodes[0].p[1] - c.circ.c.p[1]) * 2, S.paths[2].nodes[0].p[0] - S.paths[2].circ.c.p[0]];  });
  ok('diametro 8: il primo foro e, per il vincolo Uguale, anche il secondo', Math.abs(d[0] - 8) < 1e-6 && Math.abs(d[1] - 4) < 1e-6, d.map((v) => v.toFixed(3)).join(' '));
  ok('dopo il diametro resta completamente vincolato', (await st()).rep.dof === 0);
}
// Trascino il bordo del secondo foro: il raggio cambia, il centro resta (è quotato) e il primo foro lo segue (Uguale)
{
  const [rx, ry] = await page.evaluate(() => window.__proto.S.paths[2].nodes[0].p);
  await page.keyboard.press('v');
  await page.mouse.move(0, 0);
  await drag([rx, ry], [rx + 2, ry]);
  const d = await page.evaluate(() => { const S = window.__proto.S, r = (c) => Math.hypot(c.nodes[0].p[0] - c.circ.c.p[0], c.nodes[0].p[1] - c.circ.c.p[1]); return [r(S.paths[1]), r(S.paths[2])]; });
  ok('trascinamento del bordo: la quota del diametro la tiene ferma (nessun cambio)', Math.abs(d[0] - 4) < 1e-6 && Math.abs(d[1] - 4) < 1e-6, d.map((v) => v.toFixed(3)).join(' '));
}

// 11. Angolo tra due segmenti (strumento Quota): da un disegno libero
await page.locator('#ex').selectOption('vuoto');
await page.waitForTimeout(300);
await page.keyboard.press('p');
for (const q of [[0, 0], [20, 3], [35, 20]]) { const a = await scr(...q); await page.mouse.click(a[0], a[1]); await page.waitForTimeout(80); }
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
s = await st();
ok('penna: due segmenti senza vincoli dedotti (angoli liberi)', s.n === 0, 'n = ' + s.n);
await page.keyboard.press('d');
await page.locator('#qModeSeg [data-q="ang"]').click();
{
  const p = await page.evaluate(() => window.__proto.S.paths[0].nodes.map((n) => n.p));
  await click((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2);
  await click((p[1][0] + p[2][0]) / 2, (p[1][1] + p[2][1]) / 2);
  await edit('90');
  const q = await page.evaluate(() => window.__proto.S.paths[0].nodes.map((n) => n.p));
  const u = [q[0][0] - q[1][0], q[0][1] - q[1][1]], v = [q[2][0] - q[1][0], q[2][1] - q[1][1]];
  const ang = Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))) * 180 / Math.PI;
  ok('angolo tra due segmenti: 90 gradi', Math.abs(ang - 90) < 1e-6, ang.toFixed(4));
}
await shot('angolo');

// 11a. Angolo da circa 11 a 170 gradi: il segmento gira attorno a un estremo, l'altro nodo non salta (niente scarti di decine di mm)
await page.locator('#ex').selectOption('vuoto');
await page.waitForTimeout(300);
await page.keyboard.press('p');
for (const q of [[-10, 5], [10, 9]]) { const a = await scr(...q); await page.mouse.click(a[0], a[1]); await page.waitForTimeout(80); }
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
{
  const before = await page.evaluate(() => window.__proto.S.paths[0].nodes.map((n) => n.p.slice()));
  await page.keyboard.press('d');
  await page.locator('#qModeSeg [data-q="ang"]').click();
  await click((before[0][0] + before[1][0]) / 2, (before[0][1] + before[1][1]) / 2);
  await page.keyboard.press('Enter');
  await edit('170');
  const after = await page.evaluate(() => window.__proto.S.paths[0].nodes.map((n) => n.p.slice()));
  const L0 = Math.hypot(before[1][0] - before[0][0], before[1][1] - before[0][1]), L1 = Math.hypot(after[1][0] - after[0][0], after[1][1] - after[0][1]);
  const ang = Math.atan2(after[1][1] - after[0][1], after[1][0] - after[0][0]) * 180 / Math.PI;
  ok('angolo portato a 170 gradi: raggiunto', Math.abs(ang - 170) < 1e-6, ang.toFixed(6));
  ok('angolo a 170 gradi: il nodo di partenza non si muove e la lunghezza resta', Math.hypot(after[0][0] - before[0][0], after[0][1] - before[0][1]) < 1e-6 && Math.abs(L1 - L0) < 1e-6, 'lunghezza ' + L0.toFixed(4) + ' -> ' + L1.toFixed(4));
}


// 11b. Vincoli applicati dalla barra (strumento K) su una spezzata libera di quattro nodi
await page.locator('#ex').selectOption('vuoto');
await page.waitForTimeout(300);
await page.keyboard.press('p');
for (const q of [[-10, -5], [10, -2], [25, 15], [18, 37]]) { const a = await scr(...q); await page.mouse.click(a[0], a[1]); await page.waitForTimeout(80); }
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const pts4 = () => page.evaluate(() => window.__proto.S.paths[0].nodes.map((n) => n.p));
const mid = async (i) => { const p = await pts4(); return [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2]; };
const angleBetween = (p, i, j) => { const u = [p[i][0] - p[i + 1][0], p[i][1] - p[i + 1][1]], v = [p[j + 1][0] - p[j][0], p[j + 1][1] - p[j][1]]; return Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180 / Math.PI); };
await page.keyboard.press('k');
// Perpendicolare: primo e terzo segmento
await click(...(await mid(0))); await click(...(await mid(2)));
await page.locator('#cbtns [data-c="perpendicular"]').click();
await page.waitForTimeout(250);
{
  const p = await pts4(), n = (await st()).n, dir = (i) => Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]) * 180 / Math.PI, d = Math.abs(Math.abs(dir(0) - dir(2)) - 90);
  ok('vincolo Perpendicolare aggiunto dalla barra: i segmenti 1 e 3 a 90 gradi', n === 1 && (d < 1e-6 || Math.abs(d - 180) < 1e-6 || Math.abs(Math.abs(dir(0) - dir(2)) - 270) < 1e-6), 'n = ' + n + ', differenza di direzione ' + Math.abs(dir(0) - dir(2)).toFixed(4));
}
// Uguale: primo e secondo segmento
await click(...(await mid(0))); await click(...(await mid(1)));
await page.locator('#cbtns [data-c="equal"]').click();
await page.waitForTimeout(250);
{
  const p = await pts4(), L = (i) => Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  ok('vincolo Uguale: i segmenti 1 e 2 hanno la stessa lunghezza', (await st()).n === 2 && Math.abs(L(0) - L(1)) < 1e-6, 'L = ' + L(0).toFixed(4) + ' e ' + L(1).toFixed(4));
}
// Fisso: il primo nodo, poi lo si prova a trascinare
{
  const [x0, y0] = (await pts4())[0];
  await click(x0, y0);
  await page.locator('#cbtns [data-c="fixed"]').click();
  await page.waitForTimeout(250);
  ok('vincolo Fisso aggiunto (un vincolo per nodo scelto)', (await st()).n === 3);
  await page.keyboard.press('v');
  await drag([x0, y0], [x0 + 6, y0 + 6]);
  const q = (await pts4())[0];
  ok('un nodo fisso non segue il mouse', Math.hypot(q[0] - x0, q[1] - y0) < 1e-6, q.map((v) => v.toFixed(3)).join(', '));
}
// Tangente: il secondo nodo diventa Liscio
await page.keyboard.press('k');
{ const [x1, y1] = (await pts4())[1]; await click(x1, y1); }
await page.locator('#cbtns [data-c="tangent"]').click();
await page.waitForTimeout(250);
ok('Tangente: il nodo diventa Liscio', await page.evaluate(() => window.__proto.S.paths[0].nodes[1].kind === 'smooth'));
// Annulla toglie l'ultimo vincolo (o l'ultima azione): un solo passo
{
  const before = (await st()).n;
  await page.locator('#btnUndo').click();
  await page.waitForTimeout(200);
  ok('Annulla dopo la tangente: nessun vincolo perso, il nodo torna uno spigolo', (await st()).n === before && await page.evaluate(() => window.__proto.S.paths[0].nodes[1].kind === 'corner'));
}
await shot('vincoli-barra');

// 12. Tempi nel browser (thread principale di Chrome): un fotogramma di trascinamento (dragSketch come il prototipo: rigido, poi morbido con peso 30)
const timing = await page.evaluate(() => {
  const solve = window.__proto.solveSketch, drag = window.__proto.dragSketch, out = [];
  const med = (t) => t.sort((x, y) => x - y)[t.length >> 1];
  for (const kind of ['lineare', 'non lineare', 'non lineare non ancorato']) for (const n of kind === 'lineare' ? [10, 25, 50, 100] : [10, 25, 50]) {
    const pts = [], cons = [];
    if (kind === 'lineare') {
      let x = 0, y = 0;
      for (let i = 0; i <= n; i++) { pts.push({ id: 'p' + i, x, y }); if (i % 2 === 0) x += 10 + (i % 3); else y += 6 + (i % 4); }
      for (let i = 0; i < n; i++) {
        cons.push({ id: 'h' + i, t: i % 2 === 0 ? 'horizontal' : 'vertical', p: ['p' + i, 'p' + (i + 1)] });
        if (i % 4 < 2) cons.push({ id: 'd' + i, t: i % 2 === 0 ? 'distX' : 'distY', p: ['p' + i, 'p' + (i + 1)], s: 1, v: i % 2 === 0 ? 10 + (i % 3) : 6 + (i % 4) });
      }
    } else { // poligono chiuso: lunghezze, uguaglianze e angoli tra lati consecutivi (non lineare), un nodo fisso e un angolo assoluto
      const R = 10 * n / (2 * Math.PI);
      for (let i = 0; i < n; i++) { const an = 2 * Math.PI * i / n; pts.push({ id: 'p' + i, x: R * Math.cos(an) + 0.7 * Math.sin(i * 1.7), y: R * Math.sin(an) + 0.5 * Math.cos(i * 2.3) }); }
      if (kind === 'non lineare') cons.push({ id: 'f', t: 'fixed', p: ['p0'], x: pts[0].x, y: pts[0].y }, { id: 'a0', t: 'angle', p: ['p0', 'p1'], v: 90 + 180 / n });
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        cons.push(i % 2 === 0 ? { id: 'd' + i, t: 'dist', p: ['p' + i, 'p' + j], v: 10 } : { id: 'e' + i, t: 'equal', p: ['p' + i, 'p' + j, 'p' + ((i + n - 1) % n), 'p' + i] });
        if (i < n - 3) cons.push({ id: 'g' + i, t: 'angle', p: ['p' + i, 'p' + j, 'p' + j, 'p' + ((i + 2) % n)], v: 360 / n });
      }
    }
    const solved = solve(pts, cons).points, times = [];
    let bad = 0, lag = 0;
    for (let k = -5; k < 30; k++) {
      // secondo fotogramma di un trascinamento (il primo decide se il tentativo rigido riesce)
      const id = 'p' + (1 + Math.floor(((k + 7) * 37) % (n - 1))), s0 = solved.find((p) => p.id === id);
      const first = drag(solved, cons, { [id]: [s0.x + 0.5, s0.y + 0.25] });
      const cur = first.residual < 1e-4 ? first.points : solved, s1 = cur.find((p) => p.id === id), to = [s1.x + 0.5, s1.y + 0.25];
      const t = performance.now(), r = drag(cur, cons, { [id]: to }, !first.pinned);
      if (k >= 0) { times.push(performance.now() - t); if (!(r.residual < 1e-4)) bad++; const q = r.points.find((p) => p.id === id); lag = Math.max(lag, Math.hypot(q.x - to[0], q.y - to[1])); }
    }
    out.push({ kind, n, median: med(times), max: Math.max(...times), bad, lag });
  }
  return out;
});
console.log('Tempi nel browser (un fotogramma di trascinamento, mediana e massimo su 30 fotogrammi): ' + timing.map((t) => t.kind + ' ' + t.n + ' segmenti ' + t.median.toFixed(2) + ' ms (massimo ' + t.max.toFixed(2) + ', scartati ' + t.bad + ', ritardo del nodo dal mouse ' + t.lag.toFixed(3) + ' mm)').join('; '));
ok('nel browser la mediana di un fotogramma lineare a 50 segmenti sta sotto 16 ms', timing.find((t) => t.kind === 'lineare' && t.n === 50).median < 16, JSON.stringify(timing.find((t) => t.kind === 'lineare' && t.n === 50)));
ok('nel browser la mediana di un fotogramma non lineare a 50 segmenti sta sotto 16 ms e nessun fotogramma si scarta', timing.find((t) => t.kind === 'non lineare' && t.n === 50).median < 16 && timing.find((t) => t.kind === 'non lineare' && t.n === 50).bad === 0, JSON.stringify(timing.find((t) => t.kind === 'non lineare' && t.n === 50)));
ok('nel browser un disegno solo rigido (non lineare, non ancorato) a 50 segmenti: il nodo segue il mouse senza ritardo e nessun fotogramma si scarta', timing.find((t) => t.kind === 'non lineare non ancorato' && t.n === 50).lag < 1e-3 && timing.find((t) => t.kind === 'non lineare non ancorato' && t.n === 50).bad === 0, JSON.stringify(timing.find((t) => t.kind === 'non lineare non ancorato' && t.n === 50)));

ok('nessun errore in console', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length} su ${results.length} controlli riusciti`);
process.exit(failed.length ? 1 : 0);
