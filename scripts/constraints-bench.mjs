// Misura i criteri a-e del risolutore di vincoli (docs/studio-quote-profilo.md, sezione «Risolutore») e li stampa in
// tabelle Markdown. Il codice provato è quello del prototipo: si estrae il blocco CORE-BEGIN / CORE-END da
// docs/prototipi/profilo-quote.html (con --from-ts lo si ricava invece da constraints.ts, come fa constraints-sync.mjs).
// Uso: node scripts/constraints-bench.mjs [--from-ts] [--runs=30] [--out=docs/prototipi/misure-quote.txt]
import { readFileSync, writeFileSync } from 'node:fs';
import { HTML_PATH, coreBlock, coreSource, htmlBlock } from './constraints-core.mjs';

// Tutto ciò che si stampa si raccoglie anche per --out (scrittura UTF-8 con a capo LF, senza dipendere dalla shell)
const lines = [];
const log = console.log;
console.log = (...a) => { lines.push(a.join(' ')); log(...a); };
const outPath = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
console.log(`Misure del risolutore di vincoli, ${new Date().toISOString().slice(0, 10)} (Node ${process.version}, ${process.platform}).`);
console.log('Generate con: node --no-warnings scripts/constraints-bench.mjs ' + process.argv.slice(2).join(' ') + ' (estrae il blocco CORE-BEGIN / CORE-END di profilo-quote.html, oppure constraints.ts con --from-ts).');
const fromTs = process.argv.includes('--from-ts');
const runs = Number((process.argv.find((a) => a.startsWith('--runs=')) ?? '--runs=30').slice(7));
const block = fromTs ? coreBlock() : htmlBlock(readFileSync(HTML_PATH, 'utf8'));
const { solveSketch, dragSketch, measure, validateValue, maxResidual } = new Function(coreSource(block) + '; return { solveSketch, dragSketch, measure, validateValue, maxResidual };')();

// Generatore pseudo-casuale con seme (nessun Math.random: i numeri sono riproducibili)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const P = (id, x, y) => ({ id, x, y });
let seq = 0;
const C = (t, p, extra = {}) => ({ id: 'c' + ++seq, t, p, ...extra });
const at = (pts, id) => pts.find((p) => p.id === id);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ms = (v) => v.toFixed(2).replace('.', ',');
const yes = (b) => (b ? 'sì' : 'NO');
const rows = [];
const table = (title, head, body) => {
  console.log(`\n### ${title}\n\n| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
  body.forEach((r) => console.log(`| ${r.join(' | ')} |`));
};

// ---------------------------------------------------------------- criterio a: il rettangolo
const skewed = () => [P('a', 0.3, -0.2), P('b', 38, 1.5), P('c', 41, 27), P('d', -2, 24)];
const rect = (fixed, dims = true) => [
  C('horizontal', ['a', 'b']), C('vertical', ['b', 'c']), C('horizontal', ['d', 'c']), C('vertical', ['a', 'd']),
  ...(dims ? [C('distX', ['a', 'b'], { v: 40 }), C('distY', ['a', 'd'], { v: 25 })] : []),
  ...(fixed ? [C('fixed', ['a'], { x: 0, y: 0 })] : []),
];
{
  const cases = [
    ['4 vincoli H/V + 2 quote + punto fisso', rect(true), 0, 'full'],
    ['4 vincoli H/V + 2 quote (senza punto fisso)', rect(false), 2, 'under'],
    ['4 vincoli H/V + punto fisso (senza quote)', rect(true, false), 2, 'under'],
    ['solo 4 vincoli H/V', rect(false, false), 4, 'under'],
  ];
  table('Criterio a: rettangolo quotato', ['Vincoli', 'Gradi di libertà', 'Stato', 'Atteso', 'Residuo max', 'Esito'],
    cases.map(([name, cons, dof, state]) => {
      const r = solveSketch(skewed(), cons);
      return [name, r.dof, r.state, `${dof} / ${state}`, r.residual.toExponential(1), yes(r.converged && r.dof === dof && r.state === state)];
    }));
}

// ---------------------------------------------------------------- criterio b: sovravincolo
{
  const diag = Math.hypot(40, 25);
  const cases = [
    ['quota in più coerente (diagonale 47,17)', C('dist', ['a', 'c'], { v: diag }), 'redundant'],
    ['stessa larghezza due volte (40 e 40)', C('distX', ['a', 'b'], { v: 40 }), 'redundant'],
    ['larghezza in conflitto (40 e 55)', C('distX', ['a', 'b'], { v: 55 }), 'conflicting'],
    ['diagonale incompatibile (60)', C('dist', ['a', 'c'], { v: 60 }), 'conflicting'],
  ];
  table('Criterio b: un vincolo in più, senza oscillazioni', ['Vincolo aggiunto', 'Segnalato come', 'Stato', 'Iterazioni', 'Costo mai in salita', 'Ripetibile', 'Esito'],
    cases.map(([name, extra, want]) => {
      const cons = [...rect(true), extra];
      const r = solveSketch(skewed(), cons);
      const again = solveSketch(skewed(), cons);
      const stable = solveSketch(r.points, cons);
      const monotone = r.costs.every((c, i) => i === 0 || c <= r.costs[i - 1]);
      const same = JSON.stringify(r.points) === JSON.stringify(again.points);
      const moved = Math.max(...r.points.map((p, i) => Math.hypot(p.x - stable.points[i].x, p.y - stable.points[i].y)));
      const flagged = r[want].includes(extra.id);
      return [name, flagged ? (want === 'redundant' ? 'ridondante' : 'in conflitto') : 'NON segnalato', r.state, r.iterations, yes(monotone), same && moved < 1e-6 ? 'sì (scarto ' + moved.toExponential(0) + ')' : 'NO', yes(flagged && r.state === 'over' && monotone && same && r.iterations <= 60)];
    }));
}

// ---------------------------------------------------------------- criterio c: spostamento minimo
{
  // Un fotogramma come nel prototipo: dragSketch (prima rigido, poi morbido con peso 30)
  const drag = (pts, cons, id, to) => dragSketch(pts, cons, { [id]: to });
  const out = [];
  // 1) solo H/V: il nodo opposto non deve muoversi
  {
    const cons = rect(true, false);
    const start = solveSketch(skewed(), cons).points;
    const to = [at(start, 'c').x + 3, at(start, 'c').y + 2];
    const moved = drag(start, cons, 'c', to).points;
    const d = (id) => Math.hypot(at(moved, id).x - at(start, id).x, at(moved, id).y - at(start, id).y);
    out.push(['H/V + punto fisso, trascino c di 3,61 mm', 'a (fisso) ' + d('a').toExponential(0) + ', b ' + ms(d('b')) + ', d ' + ms(d('d')), ms(Math.hypot(at(moved, 'c').x - to[0], at(moved, 'c').y - to[1])), yes(d('a') < 1e-9 && d('b') <= 3.62 && d('d') <= 3.62)]);
  }
  // 2) con le quote, senza punto fisso: traslazione rigida, nessun nodo si muove più del mouse
  {
    const cons = rect(false);
    const start = solveSketch(skewed(), cons).points;
    const to = [at(start, 'c').x + 3, at(start, 'c').y + 2];
    const moved = drag(start, cons, 'c', to).points;
    const worst = Math.max(...moved.map((p) => Math.hypot(p.x - at(start, p.id).x, p.y - at(start, p.id).y)));
    out.push(['H/V + 2 quote, trascino c di 3,61 mm', 'spostamento massimo ' + ms(worst) + ' mm', ms(Math.hypot(at(moved, 'c').x - to[0], at(moved, 'c').y - to[1])), yes(worst <= 3.6056 * 1.001)]);
  }
  // 3) trascinamento a fotogrammi: nessun salto tra un fotogramma e il successivo
  {
    const cons = rect(false, false).concat([C('distX', ['a', 'b'], { v: 40 })]);
    let pts = solveSketch(skewed(), cons).points;
    let worstJump = 0;
    let worstOther = 0;
    for (let f = 1; f <= 60; f++) {
      const to = [at(pts, 'c').x + 0.5, at(pts, 'c').y + 0.25];
      const next = drag(pts, cons, 'c', to).points;
      for (const p of next) {
        const j = Math.hypot(p.x - at(pts, p.id).x, p.y - at(pts, p.id).y);
        worstJump = Math.max(worstJump, j);
        if (p.id !== 'c') worstOther = Math.max(worstOther, j);
      }
      pts = next;
    }
    out.push(['60 fotogrammi da 0,56 mm (H/V + larghezza)', 'salto max ' + ms(worstJump) + ' mm, altri nodi ' + ms(worstOther) + ' mm', '-', yes(worstJump <= 0.56 * 1.05)]);
  }
  // 4) poligono non lineare tutto quotato SENZA nodo fisso (si muove solo in modo rigido): ritardo del nodo trascinato a regime
  for (const n of [25, 50, 100]) {
    const { pts, cons } = polygon(n, false);
    const solved = solveSketch(pts, cons).points;
    const run = (frame) => {
      let cur = solved;
      const s0 = at(cur, 'p3');
      let mouse = [s0.x, s0.y];
      let soft = false;
      for (let f = 0; f < 60; f++) {
        mouse = [mouse[0] + 0.5, mouse[1] + 0.25];
        const r = frame(cur, mouse, soft);
        if (!r.pinned) soft = true;
        if (r.residual < 1e-4) cur = r.points;
      }
      const q = at(cur, 'p3');
      return Math.hypot(q.x - mouse[0], q.y - mouse[1]);
    };
    const old = run((cur, mouse) => ({ ...solveSketch(cur.map((p) => (p.id === 'p3' ? { ...p, x: mouse[0], y: mouse[1] } : p)), cons, { weights: { p3: 30 }, diagnose: false, tol: 1e-6 }), pinned: false }));
    const now = run((cur, mouse, soft) => dragSketch(cur, cons, { p3: mouse }, soft));
    out.push([`poligono non lineare di ${n} lati, tutto quotato, senza nodo fisso, 60 fotogrammi da 0,56 mm`, `ritardo a regime: ${ms(old)} mm con il solo peso 30, ${ms(now)} mm con dragSketch`, ms(now), yes(now < 1e-3)]);
  }
  table('Criterio c: trascinando una geometria non del tutto vincolata la soluzione resta vicina', ['Prova', 'Spostamento dei nodi non trascinati', 'Distanza del nodo trascinato dal mouse (mm)', 'Esito'], out);
}

// ---------------------------------------------------------------- criterio d: tempi
// Poligono rettilineo a gradini con n segmenti: lati H/V alternati e quote (ogni due lati se `dense` è falso, tutti se vero)
function staircase(n, dense) {
  const pts = [];
  const cons = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i <= n; i++) {
    pts.push(P('p' + i, x, y));
    if (i % 2 === 0) x += 10 + (i % 3);
    else y += 6 + (i % 4);
  }
  for (let i = 0; i < n; i++) {
    cons.push(C(i % 2 === 0 ? 'horizontal' : 'vertical', ['p' + i, 'p' + (i + 1)]));
    if (dense || i % 4 < 2) cons.push(C(i % 2 === 0 ? 'distX' : 'distY', ['p' + i, 'p' + (i + 1)], { v: i % 2 === 0 ? 10 + (i % 3) : 6 + (i % 4), s: 1 }));
  }
  if (dense) cons.push(C('fixed', ['p0'], { x: 0, y: 0 }));
  return { pts, cons };
}
const time = (fn) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};
// Poligono chiuso di n lati, NON lineare: lunghezza sui lati pari, uguaglianza sui dispari, angolo tra lati consecutivi,
// un nodo fisso e l'angolo del primo lato se `anchored` (n punti, circa 2n equazioni); senza ancoraggio restano 3 gradi di libertà (moto rigido)
function polygon(n, anchored = true) {
  const R = 10 * n / (2 * Math.PI);
  const pts = Array.from({ length: n }, (_, i) => P('p' + i, R * Math.cos(2 * Math.PI * i / n) + 0.7 * Math.sin(i * 1.7), R * Math.sin(2 * Math.PI * i / n) + 0.5 * Math.cos(i * 2.3)));
  const cons = anchored ? [C('fixed', ['p0'], { x: pts[0].x, y: pts[0].y }), C('angle', ['p0', 'p1'], { v: 90 + 180 / n })] : [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cons.push(i % 2 === 0 ? C('dist', ['p' + i, 'p' + j], { v: 10 }) : C('equal', ['p' + i, 'p' + j, 'p' + ((i + n - 1) % n), 'p' + i]));
    if (i < n - 3) cons.push(C('angle', ['p' + i, 'p' + j, 'p' + j, 'p' + ((i + 2) % n)], { v: 360 / n }));
  }
  return { pts, cons };
}
const rows_ = (cons) => cons.reduce((sum, c) => sum + ({ fixed: 2, coincident: 2, midpoint: 2, collinear: 2, symmetric: 2 }[c.t] ?? 1), 0);
{
  const out = [];
  // Il trascinamento è dragSketch come nel prototipo (rigido, poi morbido con peso 30), un passo di mouse di 0,5 x 0,3 mm; si misura il
  // secondo fotogramma di un trascinamento, dopo che il primo ha deciso se il tentativo rigido riesce (se no, i successivi vanno subito al morbido)
  for (const kind of ['leggera', 'densa', 'non lineare', 'non lineare non ancorato']) {
    for (const n of [10, 25, 50, 100]) {
      const { pts, cons } = kind.startsWith('non lineare') ? polygon(n, kind === 'non lineare') : staircase(n, kind === 'densa');
      const solved = solveSketch(pts, cons).points;
      const noise = rng(n * 7 + kind.length);
      const drag = [];
      const cold = [];
      const full = [];
      let skipped = 0;
      let unsolvedCold = 0;
      for (let k = -5; k < runs; k++) {
        // Fotogramma di trascinamento: dalla soluzione, un nodo spostato di 0,5 x 0,3 mm
        const id = 'p' + (1 + Math.floor(noise() * (n - 1)));
        const s0 = solved.find((p) => p.id === id);
        const first = dragSketch(solved, cons, { [id]: [s0.x + 0.5, s0.y + 0.25] });
        const cur = first.residual < 1e-4 ? first.points : solved;
        const s1 = cur.find((p) => p.id === id);
        let frame;
        const t1 = time(() => { frame = dragSketch(cur, cons, { [id]: [s1.x + 0.5, s1.y + 0.25] }, !first.pinned); });
        // Partenza a freddo: tutti i punti sporcati di circa 1,5 mm; senza diagnosi (tetto 300 iterazioni) e con diagnosi (tetto 500)
        const messy = pts.map((p) => ({ ...p, x: p.x + (noise() - 0.5) * 3, y: p.y + (noise() - 0.5) * 3 }));
        let c0;
        const t2 = time(() => { c0 = solveSketch(messy, cons, { diagnose: false, maxIter: 300 }); });
        let c1;
        const t3 = time(() => { c1 = solveSketch(messy, cons); });
        if (k >= 0) {
          drag.push(t1); cold.push(t2); full.push(t3);
          if (!(frame.residual < 1e-4)) skipped++;
          if (!c1.converged) unsolvedCold++;
        }
      }
      const r = solveSketch(pts, cons);
      out.push([kind, n, 2 * n + (kind.startsWith('non lineare') ? 0 : 2) + ' / ' + rows_(cons), r.dof, ms(median(drag)), ms(Math.max(...drag)), skipped + ' / ' + runs, ms(median(cold)), ms(median(full)), ms(Math.max(...full)), unsolvedCold + ' / ' + runs, yes(median(drag) < 16 && skipped === 0)]);
    }
  }
  table(`Criterio d: tempo di risoluzione (ms, ${runs} ripetizioni dopo 5 di riscaldamento, ${process.version}; il massimo di una sola esecuzione oscilla molto tra un'esecuzione e l'altra, contano le mediane)`, ['Vincoli', 'Segmenti', 'Variabili / equazioni', 'DOF', 'Trascinamento mediana', 'massimo', 'Fotogrammi scartati', 'A freddo mediana', 'A freddo con diagnosi mediana', 'massimo', 'Non convergenti a freddo', 'Trascinamento < 16 ms, nessuno scartato'], out);
}

// ---------------------------------------------------------------- criterio e: casi limite
{
  const out = [];
  const t = (name, fn) => out.push([name, ...fn()]);
  t('quota a zero', () => [validateValue('dist', 0) ?? '(accettata)', yes(validateValue('dist', 0) !== null)]);
  t('quota negativa', () => [validateValue('distX', -4) ?? '(accettata)', yes(validateValue('distX', -4) !== null)]);
  t('quota non numerica', () => [validateValue('dist', NaN) ?? '(accettata)', yes(validateValue('dist', NaN) !== null)]);
  t('triangolo impossibile 3, 4, 10', () => {
    const r = solveSketch([P('a', 0, 0), P('b', 3, 0.2), P('c', 1, 3)], [C('dist', ['a', 'b'], { v: 3 }), C('dist', ['b', 'c'], { v: 4 }), C('dist', ['a', 'c'], { v: 10 })]);
    return [`non converge, ${r.conflicting.length} vincoli in conflitto, ${r.iterations} iterazioni, residuo ${r.residual.toFixed(2)}`, yes(!r.converged && r.conflicting.length > 0 && r.points.every((p) => Number.isFinite(p.x + p.y)))];
  });
  t('H e V sullo stesso segmento con lunghezza 10', () => {
    const cons = [C('horizontal', ['a', 'b']), C('vertical', ['a', 'b']), C('dist', ['a', 'b'], { v: 10 })];
    const r = solveSketch([P('a', 0, 0), P('b', 10, 1)], cons);
    return [`non converge, in conflitto: ${r.conflicting.length}`, yes(!r.converged && r.conflicting.includes(cons[2].id))];
  });
  t('segmento di lunghezza nulla con quota 12 e angolo 30', () => {
    const r = solveSketch([P('a', 5, 5), P('b', 5, 5)], [C('dist', ['a', 'b'], { v: 12 }), C('angle', ['a', 'b'], { v: 30 })]);
    const L = measure({ id: 'k', t: 'dist', p: ['a', 'b'] }, r.points);
    const A = measure({ id: 'k', t: 'angle', p: ['a', 'b'] }, r.points);
    return [`separato: lunghezza ${L.toFixed(6)}, angolo ${A.toFixed(4)}`, yes(r.converged && Math.abs(L - 12) < 1e-6 && Math.abs(A - 30) < 1e-4)];
  });
  t('dato non finito (NaN) nei punti', () => {
    const r = solveSketch([P('a', 0, 0), P('b', NaN, 1)], [C('horizontal', ['a', 'b'])]);
    return ['non converge, nessun calcolo', yes(!r.converged && r.state === 'over' && r.iterations === 0)];
  });
  t('angolo da 10 a 170 gradi (ramo giusto)', () => {
    const r = solveSketch([P('a', 0, 0), P('b', 10, 1.7632698)], [C('angle', ['a', 'b'], { v: 170 })]);
    return [`b.x = ${at(r.points, 'b').x.toFixed(3)}`, yes(r.converged && at(r.points, 'b').x < 0)];
  });
  table('Criterio e: casi limite', ['Caso', 'Comportamento', 'Esito'], out);
}

// ---------------------------------------------------------------- arrotondamento a 4 decimali (come roundPaths)
// Catena di n segmenti con lunghezza e angolo irrazionali: le coordinate non cadono mai su 4 decimali esatti
{
  const out = [];
  for (const n of [10, 50, 100]) {
    const pts = [P('p0', 0, 0)];
    const cons = [C('fixed', ['p0'], { x: 0, y: 0 })];
    for (let i = 0; i < n; i++) {
      pts.push(P('p' + (i + 1), 5 * (i + 1), 3 * ((i * 7) % 5)));
      cons.push(C('dist', ['p' + i, 'p' + (i + 1)], { v: 7.31 + 0.377 * i }), C('angle', ['p' + i, 'p' + (i + 1)], { v: (11.3 + 17.9 * i) % 140 - 70 }));
    }
    const r = solveSketch(pts, cons);
    const rounded = r.points.map((p) => ({ ...p, x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 }));
    const after = maxResidual(rounded, cons);
    out.push([n, r.converged ? r.residual.toExponential(1) : 'non converge', after.toExponential(1), yes(r.converged && after < 2e-4)]);
  }
  table('Errore residuo dopo arrotondamento a 4 decimali dei punti (mm per le quote, radianti per gli angoli)', ['Segmenti', 'Prima', 'Dopo', 'Sotto 0,0002'], out);
}
if (outPath) writeFileSync(outPath, lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
