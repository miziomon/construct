/**
 * Nucleo del risolutore di vincoli 2D dello studio «quote e vincoli» (docs/studio-quote-profilo.md).
 * NON è collegato all'app: sono funzioni pure, senza import, in TypeScript con sola sintassi cancellabile, perché lo
 * stesso testo (tolti i tipi) sta nel prototipo docs/prototipi/profilo-quote.html tra CORE-BEGIN e CORE-END
 * (scripts/constraints-sync.mjs lo genera, constraints.test.ts verifica che coincida).
 *
 * Modello: un disegno è un elenco di PUNTI (id, x, y in mm); i vincoli e le quote si riferiscono ai punti per id e un
 * segmento è la coppia di punti (a, b). Le maniglie delle curve non sono variabili: restano relative al nodo.
 * Metodo: Gauss-Newton smorzato (Levenberg-Marquardt) nella forma a norma minima, che parte sempre dalla configurazione
 * data. Così, dove il disegno non è del tutto vincolato, la soluzione è la più vicina possibile a quella di partenza.
 */

/** Un punto del disegno. */
export interface Pt {
  id: string;
  x: number;
  y: number;
}

/**
 * Tipi di vincolo, con i punti `p` che richiedono:
 * fixed [a] (con x, y), horizontal [a, b], vertical [a, b], coincident [a, b], dist [a, b] (v mm), distX e distY [a, b]
 * (v mm, `s` = segno), angle [a, b] (angolo del segmento rispetto all'asse X) oppure [a, b, c, d] (dal segmento ab al
 * segmento cd, antiorario), tutti con v in gradi, parallel / perpendicular / equal [a, b, c, d], midpoint [m, a, b],
 * collinear [a, b, c, d] (i segmenti sulla stessa retta), symmetric [a, b, c, d] (a e b simmetrici rispetto alla retta cd).
 */
export type ConstraintType = 'fixed' | 'horizontal' | 'vertical' | 'coincident' | 'dist' | 'distX' | 'distY' | 'angle' | 'parallel' | 'perpendicular' | 'equal' | 'midpoint' | 'collinear' | 'symmetric';

/** Un vincolo o una quota. `ref` = quota di riferimento: si misura ma non entra nel sistema. */
export interface Constraint {
  id: string;
  t: ConstraintType;
  p: string[];
  v?: number;
  s?: number;
  x?: number;
  y?: number;
  ref?: boolean;
}

/**
 * Opzioni: `weights` = peso per punto (più alto = si muove meno), `diagnose` = false salta la diagnosi (trascinamenti),
 * `tol` = residuo massimo accettato (mm), `maxIter` = tetto delle iterazioni (predefinito 60 con `diagnose: false`, 500 altrimenti).
 */
export interface SolveOptions {
  weights?: Record<string, number>;
  maxIter?: number;
  tol?: number;
  diagnose?: boolean;
}

/** Esito della risoluzione e della diagnosi. */
export interface Report {
  /** Punti nella soluzione (nuovi oggetti, stesso ordine). */
  points: Pt[];
  /** Tutti i residui sotto la tolleranza. */
  converged: boolean;
  iterations: number;
  /** Residuo massimo in valore assoluto (mm per le lunghezze, radianti per gli angoli). */
  residual: number;
  /** Gradi di libertà residui (variabili meno rango dello Jacobiano). */
  dof: number;
  /**
   * under = sottovincolato, full = completamente vincolato, over = ridondanze o conflitti,
   * unsolved = il risolutore si è fermato prima di una soluzione ma NON ha dimostrato un conflitto (riprovare con più
   * iterazioni): non si accusa nessun vincolo.
   */
  state: 'under' | 'full' | 'over' | 'unsolved';
  /** Non convergente e non in un minimo dei quadrati minimi: non si sa se il sistema sia risolubile (vedi `state`). */
  unsolved: boolean;
  /** Id dei punti che hanno ancora un grado di libertà. */
  free: string[];
  /** Vincoli che non aggiungono informazione e sono soddisfatti. */
  redundant: string[];
  /** Vincoli con residuo non nullo in un minimo dei quadrati minimi (gradiente nullo): non possono valere insieme agli altri. */
  conflicting: string[];
  /** Costo (metà della somma dei quadrati dei residui) a ogni iterazione: non cresce mai. */
  costs: number[];
}

/** Riga compilata di un vincolo: indici dei punti, colonne globali e numero di residui. */
interface Row {
  c: Constraint;
  ix: number[];
  nres: number;
}

/** Scarto (mm) sotto cui un vincolo con lo stesso residuo è considerato soddisfatto nella diagnosi. */
const DIAG_TOL = 1e-7;
/** Passo delle differenze finite centrali per lo Jacobiano (mm). */
const FD_STEP = 1e-6;
/** Distanza (mm) con cui si separano i punti di un segmento di lunghezza nulla prima di risolvere. */
const NUDGE = 1e-3;

/** Numero di residui di ogni tipo. */
const NRES: Record<ConstraintType, number> = { fixed: 2, horizontal: 1, vertical: 1, coincident: 2, dist: 1, distX: 1, distY: 1, angle: 1, parallel: 1, perpendicular: 1, equal: 1, midpoint: 2, collinear: 2, symmetric: 2 };
/** Quanti punti richiede ogni tipo (angle ne accetta 2 oppure 4). */
const NPTS: Record<ConstraintType, number> = { fixed: 1, horizontal: 2, vertical: 2, coincident: 2, dist: 2, distX: 2, distY: 2, angle: 2, parallel: 4, perpendicular: 4, equal: 4, midpoint: 3, collinear: 4, symmetric: 4 };

/** Lunghezza con un minimo, per dividere senza esplodere sui segmenti degeneri. */
const safe = (l: number): number => (l < 1e-9 ? 1e-9 : l);
/** Porta un angolo in radianti nell'intervallo (-pi, pi]. */
const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * Residui di un vincolo. `q` contiene le coordinate dei suoi punti in ordine: [x0, y0, x1, y1, ...].
 * Le lunghezze danno residui in mm, gli angoli in radianti, parallelo e perpendicolare un seno e un coseno normalizzati.
 */
function evalCon(c: Constraint, q: number[]): number[] {
  const ux = q[2] - q[0];
  const uy = q[3] - q[1];
  switch (c.t) {
    case 'fixed':
      return [q[0] - (c.x ?? 0), q[1] - (c.y ?? 0)];
    case 'horizontal':
      return [q[1] - q[3]];
    case 'vertical':
      return [q[0] - q[2]];
    case 'coincident':
      return [q[0] - q[2], q[1] - q[3]];
    case 'dist':
      return [Math.hypot(ux, uy) - (c.v ?? 0)];
    case 'distX':
      return [(c.s ?? 1) * ux - (c.v ?? 0)];
    case 'distY':
      return [(c.s ?? 1) * uy - (c.v ?? 0)];
    case 'angle': {
      // Il primo segmento è ab (o l'asse X se i punti sono due), il secondo cd: angolo dal primo al secondo, con atan2 e
      // non con il seno, così passare da 10 a 170 gradi non scivola verso la radice sbagliata (-10)
      const two = c.p.length === 2;
      const [fx, fy, sx, sy] = two ? [1, 0, ux, uy] : [ux, uy, q[6] - q[4], q[7] - q[5]];
      return [wrap(Math.atan2(fx * sy - fy * sx, fx * sx + fy * sy) - ((c.v ?? 0) * Math.PI) / 180)];
    }
    case 'parallel':
    case 'perpendicular': {
      const vx = q[6] - q[4];
      const vy = q[7] - q[5];
      const n = safe(Math.hypot(ux, uy)) * safe(Math.hypot(vx, vy));
      return [c.t === 'parallel' ? (ux * vy - uy * vx) / n : (ux * vx + uy * vy) / n];
    }
    case 'equal':
      return [Math.hypot(ux, uy) - Math.hypot(q[6] - q[4], q[7] - q[5])];
    case 'midpoint':
      // p = [m, a, b]: m al centro di ab
      return [q[0] - (q[2] + q[4]) / 2, q[1] - (q[3] + q[5]) / 2];
    case 'collinear': {
      // I punti c e d stanno sulla retta ab
      const l = safe(Math.hypot(ux, uy));
      return [(ux * (q[5] - q[1]) - uy * (q[4] - q[0])) / l, (ux * (q[7] - q[1]) - uy * (q[6] - q[0])) / l];
    }
    case 'symmetric': {
      // a e b simmetrici rispetto alla retta cd: ab perpendicolare a cd e punto medio di ab sulla retta
      const wx = q[6] - q[4];
      const wy = q[7] - q[5];
      const l = safe(Math.hypot(wx, wy));
      const mx = (q[0] + q[2]) / 2 - q[4];
      const my = (q[1] + q[3]) / 2 - q[5];
      return [((q[2] - q[0]) * wx + (q[3] - q[1]) * wy) / l, (wx * my - wy * mx) / l];
    }
  }
}

/** Coordinate dei punti di una riga nel vettore delle variabili. */
function gather(ix: number[], x: Float64Array): number[] {
  const q: number[] = [];
  for (const k of ix) q.push(x[2 * k], x[2 * k + 1]);
  return q;
}

/** Vettore dei residui di tutte le righe. */
function residuals(rows: Row[], x: Float64Array): number[] {
  const r: number[] = [];
  for (const row of rows) r.push(...evalCon(row.c, gather(row.ix, x)));
  return r;
}

/**
 * Derivate analitiche (una riga per residuo, una colonna per coordinata locale) di `dist` e `angle`; null per gli altri tipi,
 * che usano le differenze finite. Per `angle` serve: con la differenza finita il salto di `wrap` a 180 gradi la falsa.
 * La derivata dell'angolo di un vettore (x, y) è (-y, x) / |v|^2.
 */
function analytic(c: Constraint, q: number[]): number[][] | null {
  const ux = q[2] - q[0];
  const uy = q[3] - q[1];
  if (c.t === 'dist') {
    const l = safe(Math.hypot(ux, uy));
    return [[-ux / l, -uy / l, ux / l, uy / l]];
  }
  if (c.t !== 'angle') return null;
  const lu = safe(ux * ux + uy * uy);
  // Due punti: angolo di ab rispetto all'asse X
  if (c.p.length === 2) return [[uy / lu, -ux / lu, -uy / lu, ux / lu]];
  // Quattro punti: angolo di cd meno angolo di ab
  const sx = q[6] - q[4];
  const sy = q[7] - q[5];
  const ls = safe(sx * sx + sy * sy);
  return [[-uy / lu, ux / lu, uy / lu, -ux / lu, sy / ls, -sx / ls, -sy / ls, sx / ls]];
}

/** Jacobiano sparso: per ogni residuo le colonne (variabili) non nulle e i valori (analitici dove ci sono, altrimenti differenze finite centrali). */
function jacobian(rows: Row[], x: Float64Array): { cols: number[][]; vals: number[][] } {
  const cols: number[][] = [];
  const vals: number[][] = [];
  for (const row of rows) {
    const q = gather(row.ix, x);
    const base = cols.length;
    for (let k = 0; k < row.nres; k++) {
      cols.push([]);
      vals.push([]);
    }
    const exact = analytic(row.c, q);
    for (let j = 0; j < q.length; j++) {
      // Derivata rispetto alla coordinata j del vincolo; se lo stesso punto compare due volte, le derivate si sommano
      let hi: number[] = [];
      let lo: number[] = [];
      if (!exact) {
        const keep = q[j];
        q[j] = keep + FD_STEP;
        hi = evalCon(row.c, q);
        q[j] = keep - FD_STEP;
        lo = evalCon(row.c, q);
        q[j] = keep;
      }
      const col = 2 * row.ix[j >> 1] + (j & 1);
      for (let k = 0; k < row.nres; k++) {
        const d = exact ? exact[k][j] : (hi[k] - lo[k]) / (2 * FD_STEP);
        const at = cols[base + k].indexOf(col);
        if (at >= 0) vals[base + k][at] += d;
        else {
          cols[base + k].push(col);
          vals[base + k].push(d);
        }
      }
    }
  }
  return { cols, vals };
}

/**
 * Fattorizza A (n x n, simmetrica definita positiva) in LLt sul posto; false se un pivot non è positivo.
 * La matrice è quasi a banda (un vincolo tocca pochi punti vicini): per ogni riga si parte dalla prima colonna non nulla,
 * e il fattore non riempie mai fuori da quel profilo.
 */
function cholesky(a: Float64Array, n: number): boolean {
  const first = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let f = 0;
    while (f < i && a[i * n + f] === 0) f++;
    first[i] = f;
  }
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j];
    for (let k = first[j]; k < j; k++) d -= a[j * n + k] * a[j * n + k];
    if (!(d > 1e-300)) return false;
    d = Math.sqrt(d);
    a[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      if (first[i] > j) continue;
      let s = a[i * n + j];
      for (let k = Math.max(first[i], first[j]); k < j; k++) s -= a[i * n + k] * a[j * n + k];
      a[i * n + j] = s / d;
    }
  }
  return true;
}

/** Risolve LLt y = b con il fattore di `cholesky`; il risultato sostituisce b. */
function choleskySolve(a: Float64Array, n: number, b: Float64Array): void {
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= a[i * n + k] * b[k];
    b[i] = s / a[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= a[k * n + i] * b[k];
    b[i] = s / a[i * n + i];
  }
}

/**
 * Passo smorzato: minimizza |r + J d|^2 + lambda d'Wd. Con meno equazioni che variabili si usa la forma a norma minima
 * d = -W^-1 J' (J W^-1 J' + lambda I)^-1 r (matrice m x m), altrimenti (J'J + lambda W) d = -J'r (matrice n x n).
 * Restituisce null se la fattorizzazione fallisce (lambda va alzato).
 */
function lmStep(jac: { cols: number[][]; vals: number[][] }, r: number[], w: Float64Array, nvar: number, lambda: number): Float64Array | null {
  const m = r.length;
  const d = new Float64Array(nvar);
  if (m <= nvar) {
    // Forma duale: A = J W^-1 J' + lambda I, costruita per colonne (ogni variabile compare in poche righe)
    const byCol = new Map<number, [number, number][]>();
    for (let i = 0; i < m; i++) jac.cols[i].forEach((c, k) => (byCol.get(c) ?? byCol.set(c, []).get(c)!).push([i, jac.vals[i][k]]));
    const a = new Float64Array(m * m);
    for (const [c, list] of byCol) for (const [i, vi] of list) for (const [j, vj] of list) a[i * m + j] += (vi * vj) / w[c];
    for (let i = 0; i < m; i++) a[i * m + i] += lambda;
    const y = Float64Array.from(r, (v) => -v);
    if (!cholesky(a, m)) return null;
    choleskySolve(a, m, y);
    for (let i = 0; i < m; i++) jac.cols[i].forEach((c, k) => (d[c] += (jac.vals[i][k] * y[i]) / w[c]));
    return d;
  }
  // Forma primale
  const a = new Float64Array(nvar * nvar);
  const g = new Float64Array(nvar);
  for (let i = 0; i < m; i++) {
    const cs = jac.cols[i];
    const vs = jac.vals[i];
    for (let p = 0; p < cs.length; p++) {
      g[cs[p]] -= vs[p] * r[i];
      for (let q = 0; q < cs.length; q++) a[cs[p] * nvar + cs[q]] += vs[p] * vs[q];
    }
  }
  for (let i = 0; i < nvar; i++) a[i * nvar + i] += lambda * w[i];
  if (!cholesky(a, nvar)) return null;
  choleskySolve(a, nvar, g);
  return g;
}

const maxAbs = (v: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i]));
  return m;
};

/** Separa i punti dei segmenti di lunghezza nulla (tranne se un vincolo li fa coincidere apposta), senza numeri casuali. */
function nudge(rows: Row[], x: Float64Array): void {
  const joined = new Set<string>();
  for (const row of rows) if (row.c.t === 'coincident') joined.add(row.ix[0] + '|' + row.ix[1]), joined.add(row.ix[1] + '|' + row.ix[0]);
  const pairs: [number, number][] = [];
  for (const row of rows) {
    const t = row.c.t;
    if (t === 'dist' || t === 'angle' || t === 'collinear') pairs.push([row.ix[0], row.ix[1]]);
    if (t === 'equal' || t === 'parallel' || t === 'perpendicular' || (t === 'angle' && row.ix.length === 4)) pairs.push([row.ix[0], row.ix[1]], [row.ix[2], row.ix[3]]);
    if (t === 'symmetric') pairs.push([row.ix[2], row.ix[3]]);
  }
  for (const [a, b] of pairs) {
    if (a === b || joined.has(a + '|' + b)) continue;
    if (Math.hypot(x[2 * a] - x[2 * b], x[2 * a + 1] - x[2 * b + 1]) < 1e-9) x[2 * b] += NUDGE;
  }
}

/** Misura corrente di una quota nei punti dati: mm per dist, distX, distY; gradi per angle. */
export function measure(c: Constraint, points: Pt[]): number {
  const at = (id: string): Pt => points.find((p) => p.id === id) as Pt;
  const q: number[] = [];
  for (const id of c.p) q.push(at(id).x, at(id).y);
  const ux = q[2] - q[0];
  const uy = q[3] - q[1];
  if (c.t === 'dist') return Math.hypot(ux, uy);
  if (c.t === 'distX') return (c.s ?? 1) * ux;
  if (c.t === 'distY') return (c.s ?? 1) * uy;
  // Angolo: il residuo con v = 0 è già l'angolo in radianti, portato in (-180, 180]
  return (evalCon({ ...c, v: 0 }, q)[0] * 180) / Math.PI;
}

/** Messaggio se un valore digitato non è ammesso per quel tipo di quota (zero, negativo, non finito), altrimenti null. */
export function validateValue(t: ConstraintType, v: number): string | null {
  if (!Number.isFinite(v)) return 'Il valore non è un numero';
  if ((t === 'dist' || t === 'distX' || t === 'distY') && v < 1e-6) return 'La misura deve essere maggiore di zero';
  if ((t === 'dist' || t === 'distX' || t === 'distY') && v > 1e5) return 'La misura è troppo grande';
  if (t === 'angle' && Math.abs(v) > 360) return 'L\'angolo deve stare tra -360 e 360 gradi';
  return null;
}

/** Residuo massimo di tutti i vincoli pilotanti (non di riferimento) nei punti dati, per esempio dopo un arrotondamento. */
export function maxResidual(points: Pt[], constraints: Constraint[]): number {
  const index = new Map(points.map((p, i) => [p.id, i]));
  const x = new Float64Array(points.length * 2);
  points.forEach((p, i) => ((x[2 * i] = p.x), (x[2 * i + 1] = p.y)));
  const rows = compile(constraints, index);
  return maxAbs(residuals(rows, x));
}

/** Compila i vincoli: scarta quelli di riferimento, con punti mancanti o con il numero di punti sbagliato. */
function compile(constraints: Constraint[], index: Map<string, number>): Row[] {
  const rows: Row[] = [];
  for (const c of constraints) {
    if (c.ref) continue;
    const need = NPTS[c.t];
    if (!(c.p.length === need || (c.t === 'angle' && c.p.length === 4))) continue;
    const ix = c.p.map((id) => index.get(id));
    if (ix.some((k) => k === undefined)) continue;
    rows.push({ c, ix: ix as number[], nres: NRES[c.t] });
  }
  return rows;
}

/**
 * Risolve il disegno e lo diagnostica. I punti in ingresso sono la configurazione di partenza (anche con il punto
 * trascinato già portato sul mouse: dategli un peso alto in `weights` e si muoverà il meno possibile).
 * La diagnosi (gradi di libertà, punti liberi, vincoli ridondanti o in conflitto) usa il rango dello Jacobiano nella
 * soluzione: le righe si ortogonalizzano nell'ordine dei vincoli, perciò una riga dipendente è sempre la più recente.
 */
export function solveSketch(points: Pt[], constraints: Constraint[], opts: SolveOptions = {}): Report {
  const tol = opts.tol ?? 1e-9;
  // Fuori dal trascinamento si può aspettare: un poligono di 100 lati con angoli e lunghezze vuole oltre 130 iterazioni
  const maxIter = opts.maxIter ?? (opts.diagnose === false ? 60 : 500);
  const n = points.length;
  const index = new Map(points.map((p, i) => [p.id, i]));
  const x = new Float64Array(2 * n);
  points.forEach((p, i) => ((x[2 * i] = p.x), (x[2 * i + 1] = p.y)));
  const w = new Float64Array(2 * n).fill(1);
  for (const [id, wt] of Object.entries(opts.weights ?? {})) {
    const k = index.get(id);
    if (k !== undefined && wt > 0) (w[2 * k] = wt), (w[2 * k + 1] = wt);
  }
  const rows = compile(constraints, index);
  const finite = Array.from(x).every(Number.isFinite) && constraints.every((c) => [c.v, c.x, c.y, c.s].every((v) => v === undefined || Number.isFinite(v)));
  const out = (xs: Float64Array): Pt[] => points.map((p, i) => ({ id: p.id, x: xs[2 * i] + 0, y: xs[2 * i + 1] + 0 }));
  if (!finite) return { points: out(Float64Array.from(points.flatMap((p) => [p.x, p.y]))), converged: false, iterations: 0, residual: Infinity, dof: 0, state: 'over', unsolved: false, free: [], redundant: [], conflicting: constraints.filter((c) => !c.ref).map((c) => c.id), costs: [] };

  nudge(rows, x);
  // Levenberg-Marquardt: un passo si accetta solo se il costo scende, altrimenti si smorza di più (nessuna oscillazione).
  // Lo smorzamento segue il rapporto tra riduzione ottenuta e prevista (Nielsen): cala in fretta se il modello lineare regge.
  let r = residuals(rows, x);
  let cost = r.reduce((s, v) => s + v * v, 0) / 2;
  const costs = [cost];
  let lambda = 1e-3;
  let nu = 2;
  let iterations = 0;
  let still = 0;
  while (iterations < maxIter && maxAbs(r) >= tol) {
    iterations++;
    const jac = jacobian(rows, x);
    // Gradiente J'r: serve a prevedere di quanto scende il costo con un passo
    const g = new Float64Array(2 * n);
    jac.cols.forEach((cs, i) => cs.forEach((c, k) => (g[c] += jac.vals[i][k] * r[i])));
    let accepted = false;
    for (let tries = 0; tries < 30 && !accepted; tries++) {
      const d = lmStep(jac, r, w, 2 * n, lambda);
      if (d) {
        const trial = Float64Array.from(x, (v, i) => v + d[i]);
        const rt = residuals(rows, trial);
        const ct = rt.reduce((s, v) => s + v * v, 0) / 2;
        if (Number.isFinite(ct) && ct < cost) {
          let predicted = 0;
          for (let i = 0; i < d.length; i++) predicted += lambda * w[i] * d[i] * d[i] - g[i] * d[i];
          predicted /= 2;
          const rho = predicted > 0 ? (cost - ct) / predicted : 1;
          // Poco progresso per tre passi di fila: ci si ferma (sistema incompatibile, minimo locale)
          still = cost - ct < 1e-14 * cost ? still + 1 : 0;
          x.set(trial);
          r = rt;
          cost = ct;
          accepted = true;
          lambda = Math.min(1e12, Math.max(1e-12, lambda * Math.max(1 / 3, 1 - (2 * rho - 1) ** 3)));
          nu = 2;
        }
      }
      if (!accepted) {
        lambda = Math.min(1e12, lambda * nu);
        nu *= 2;
      }
    }
    costs.push(cost);
    if (!accepted || still >= 3) break;
  }
  const residual = maxAbs(r);
  const converged = residual < Math.max(tol, 1e-9);
  // Non convergente: è un conflitto vero solo se si è in un minimo dei quadrati minimi (gradiente quasi nullo).
  // Altrimenti il risolutore si è fermato presto (iterazioni finite, passo troppo piccolo): «non risolto», nessun colpevole.
  let unsolved = false;
  if (!converged) {
    const j0 = jacobian(rows, x);
    const g0 = new Float64Array(2 * n);
    j0.cols.forEach((cs, i) => cs.forEach((c, k) => (g0[c] += j0.vals[i][k] * r[i])));
    unsolved = maxAbs(g0) > 1e-5 * Math.max(1, residual);
  }
  const base = { points: out(x), converged, iterations, residual, costs, unsolved };
  if (opts.diagnose === false) return { ...base, dof: 0, state: converged ? 'under' : unsolved ? 'unsolved' : 'over', free: [], redundant: [], conflicting: [] };

  // Diagnosi: righe dello Jacobiano ortogonalizzate una alla volta (Gram-Schmidt con doppio passaggio), in ordine
  const jac = jacobian(rows, x);
  const basis: Float64Array[] = [];
  const dependent: boolean[] = [];
  for (let i = 0; i < r.length; i++) {
    const v = new Float64Array(2 * n);
    jac.cols[i].forEach((c, k) => (v[c] = jac.vals[i][k]));
    const norm0 = Math.hypot(...v);
    let independent = false;
    if (norm0 > 1e-9) {
      for (let pass = 0; pass < 2; pass++) {
        for (const q of basis) {
          let dot = 0;
          for (let c = 0; c < v.length; c++) dot += v[c] * q[c];
          for (let c = 0; c < v.length; c++) v[c] -= dot * q[c];
        }
      }
      const norm1 = Math.hypot(...v);
      independent = norm1 > 1e-6 * norm0;
      if (independent) basis.push(v.map((c) => c / norm1));
    }
    dependent.push(!independent);
  }
  // Un punto è libero se una sua coordinata ha componente non nulla nello spazio nullo: 1 - somma dei q^2 sulla base
  const free: string[] = [];
  points.forEach((p, i) => {
    const px = basis.reduce((s, q) => s + q[2 * i] * q[2 * i], 0);
    const py = basis.reduce((s, q) => s + q[2 * i + 1] * q[2 * i + 1], 0);
    if (1 - px > 1e-6 || 1 - py > 1e-6) free.push(p.id);
  });
  // Classificazione per vincolo: ridondante se tutte le sue righe sono dipendenti e soddisfatte, in conflitto se un suo residuo non è nullo
  const redundant: string[] = [];
  const conflicting: string[] = [];
  let at = 0;
  for (const row of rows) {
    const mine = Array.from({ length: row.nres }, (_, k) => at + k);
    at += row.nres;
    const bad = mine.some((k) => Math.abs(r[k]) > DIAG_TOL);
    if (bad) conflicting.push(row.c.id);
    else if (mine.every((k) => dependent[k])) redundant.push(row.c.id);
  }
  const dof = 2 * n - basis.length;
  // Non risolto: nessun colpevole, perché il sistema potrebbe essere risolubile con più iterazioni
  if (unsolved) return { ...base, dof, state: 'unsolved', free, redundant: [], conflicting: [] };
  const over = redundant.length > 0 || conflicting.length > 0 || !converged;
  return { ...base, dof, state: over ? 'over' : dof === 0 ? 'full' : 'under', free, redundant, conflicting };
}
