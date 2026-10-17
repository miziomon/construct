import { planOutline, planPaths, planTolerance, normalizeFree } from '../../scene/planShape';
import type { PlanDraft, PlanSym } from '../../scene/planShape';
import { radialAt } from '../../scene/planRevolve';
import type { PathContour, PathNode, Vec2 } from '../../scene/types';
import { insertNode } from './model';

/**
 * Modifica della sagoma nella modale del Profilo. La sagoma è un solo contorno sempre chiuso (nessuno strumento lo
 * apre) e, con una simmetria, si tiene simmetrica dal vivo: spostando un nodo si muovono anche i suoi speculari, quelli
 * sugli assi restano sugli assi con le maniglie perpendicolari.
 */

/** Un'immagine speculare del piano: `reflect` è vero per le riflessioni (cambiano il verso del contorno), falso per la rotazione di 180°. */
interface Mirror {
  f: (p: Vec2) => Vec2;
  reflect: boolean;
  /** Asse fissato da una riflessione (x = 0 per la riflessione in X, y = 0 per quella in Y). */
  axis?: 'x' | 'y';
}

const MX: Mirror = { f: (p) => [-p[0], p[1]], reflect: true, axis: 'x' };
const MY: Mirror = { f: (p) => [p[0], -p[1]], reflect: true, axis: 'y' };
const ROT: Mirror = { f: (p) => [-p[0], -p[1]], reflect: false };

const mirrorsFor = (sym: PlanSym): Mirror[] => (sym === 'v' ? [MX] : sym === 'h' ? [MY] : sym === 'q' ? [MX, MY, ROT] : []);

const same2 = (a: Vec2 | undefined, b: Vec2 | undefined) => (a === undefined || b === undefined ? a === b : a[0] === b[0] && a[1] === b[1]);
const sameNode = (a: PathNode, b: PathNode) => same2(a.p, b.p) && same2(a.in, b.in) && same2(a.out, b.out) && a.kind === b.kind;

/** Tolleranza per riconoscere un nodo speculare: relativa alla misura del contorno. */
function eps(c: PathContour): number {
  let m = 0;
  for (const n of c.nodes) m = Math.max(m, Math.abs(n.p[0]), Math.abs(n.p[1]));
  return Math.max(1e-6, m * 1e-4);
}

/** Indice del nodo in cui `m` porta il nodo `i` (anche `i` stesso se sta sull'asse), o -1. */
function partner(c: PathContour, i: number, m: Mirror): number {
  const q = m.f(c.nodes[i].p);
  const e = eps(c);
  return c.nodes.findIndex((n) => Math.abs(n.p[0] - q[0]) <= e && Math.abs(n.p[1] - q[1]) <= e);
}

/** Il nodo trasformato da `m`: le riflessioni scambiano la maniglia entrante con l'uscente. */
function mirrorNode(n: PathNode, m: Mirror): PathNode {
  const inn = m.reflect ? n.out : n.in;
  const out = m.reflect ? n.in : n.out;
  return { p: m.f(n.p), ...(inn ? { in: m.f(inn) } : {}), ...(out ? { out: m.f(out) } : {}), kind: n.kind };
}

/**
 * Tiene il nodo sugli assi che lo fissano: la posizione sull'asse e le maniglie speculari (con tangente perpendicolare
 * all'asse se il nodo non è uno spigolo). `prev` serve a sapere quale maniglia ha mosso l'utente.
 */
function constrainOnAxes(prev: PathNode, n: PathNode, fixed: Mirror[]): PathNode {
  let p = n.p;
  let inn = n.in;
  let out = n.out;
  for (const m of fixed) {
    p = m.axis === 'x' ? [0, p[1]] : [p[0], 0];
    const outMoved = !same2(out, prev.out);
    const inMoved = !same2(inn, prev.in);
    if (outMoved || !inMoved) inn = out ? m.f(out) : undefined;
    else out = inn ? m.f(inn) : undefined;
    if (n.kind !== 'corner') {
      // Tangente perpendicolare all'asse: orizzontale sull'asse X = 0 (qui `x`), verticale sull'asse Y = 0
      if (m.axis === 'x') {
        if (out) out = [out[0], 0];
        inn = out ? [-out[0], 0] : undefined;
      } else {
        if (out) out = [0, out[1]];
        inn = out ? [0, -out[1]] : undefined;
      }
    }
  }
  return { p, ...(inn ? { in: inn } : {}), ...(out ? { out } : {}), kind: n.kind };
}

/** Immagini del nodo `i` (nodi diversi da lui) e riflessioni che lo lasciano dov'è. */
function images(c: PathContour, i: number, ms: Mirror[]): { j: number; m: Mirror }[] {
  const out: { j: number; m: Mirror }[] = [];
  for (const m of ms) {
    const j = partner(c, i, m);
    if (j >= 0 && j !== i) out.push({ j, m });
  }
  return out;
}
const fixedBy = (c: PathContour, i: number, ms: Mirror[]): Mirror[] => ms.filter((m) => m.reflect && partner(c, i, m) === i);

/**
 * Riporta una modifica del contorno sui suoi speculari. `prev` è il contorno simmetrico di prima, `next` quello che esce
 * dall'editor (un nodo o un gruppo spostati, una maniglia mossa): per ogni nodo cambiato (il primo di ogni gruppo di
 * speculari) gli altri si rifanno come immagini speculari. Con un numero di nodi diverso non fa nulla: inserimento ed
 * eliminazione hanno funzioni a parte.
 */
export function applySymmetry(prev: PathContour, next: PathContour, sym: PlanSym): PathContour {
  const ms = mirrorsFor(sym);
  if (!ms.length || prev.nodes.length !== next.nodes.length) return next;
  const nodes = next.nodes.slice();
  const done = new Set<number>();
  for (let i = 0; i < nodes.length; i++) {
    if (done.has(i) || sameNode(next.nodes[i], prev.nodes[i])) continue;
    const fixed = fixedBy(prev, i, ms);
    const master = fixed.length ? constrainOnAxes(prev.nodes[i], next.nodes[i], fixed) : next.nodes[i];
    nodes[i] = master;
    done.add(i);
    for (const { j, m } of images(prev, i, ms)) {
      if (done.has(j)) continue;
      nodes[j] = mirrorNode(master, m);
      done.add(j);
    }
  }
  return { ...next, nodes };
}

/** Numero minimo di nodi di una sagoma. */
export const PLAN_MIN_NODES = 3;

/** Toglie i nodi indicati (e i loro speculari) senza aprire il contorno né scendere sotto 3 nodi. Null se non si può. */
export function deletePlanNodes(c: PathContour, indices: number[], sym: PlanSym): PathContour | null {
  const ms = mirrorsFor(sym);
  const gone = new Set<number>();
  for (const i of indices) {
    gone.add(i);
    for (const { j } of images(c, i, ms)) gone.add(j);
  }
  if (c.nodes.length - gone.size < PLAN_MIN_NODES) return null;
  return { closed: true, nodes: c.nodes.filter((_, i) => !gone.has(i)) };
}

/**
 * Inserisce un nodo sul segmento `seg` al parametro `t` (la forma non cambia) e, con una simmetria, anche negli speculari.
 * Restituisce il contorno e l'indice del nodo inserito, o null se si supera il limite di nodi.
 */
export function insertPlanNode(c: PathContour, seg: number, t: number, sym: PlanSym): { contour: PathContour; node: number } | null {
  const ms = mirrorsFor(sym);
  const n = c.nodes.length;
  const reqs: { s: number; t: number; main: boolean }[] = [{ s: seg, t, main: true }];
  const a = seg;
  const b = (seg + 1) % n;
  for (const m of ms) {
    const ja = partner(c, a, m);
    const jb = partner(c, b, m);
    if (ja < 0 || jb < 0) continue;
    // Una riflessione inverte il verso: il segmento speculare va da `jb` a `ja` e il parametro si rovescia
    const s2 = m.reflect ? jb : ja;
    const end = m.reflect ? ja : jb;
    if ((s2 + 1) % n !== end) continue;
    const t2 = m.reflect ? 1 - t : t;
    if (!reqs.some((r) => r.s === s2 && Math.abs(r.t - t2) < 0.02)) reqs.push({ s: s2, t: t2, main: false });
  }
  // Dal segmento più alto e dal parametro più grande: gli indici dei precedenti non cambiano
  reqs.sort((x, y) => y.s - x.s || y.t - x.t);
  let paths: PathContour[] = [c];
  let lastS = -1;
  let lastT = 1;
  for (const r of reqs) {
    const tt = r.s === lastS ? r.t / lastT : r.t;
    const ins = insertNode(paths, { path: 0, segment: r.s }, tt);
    if (!ins) return null;
    paths = ins.paths;
    lastS = r.s;
    lastT = r.t;
  }
  // Indice del nodo richiesto dopo tutti gli inserimenti: ogni inserimento a un segmento minore, o nello stesso con t minore, lo sposta di uno
  const shift = reqs.filter((r) => !r.main && (r.s < seg || (r.s === seg && r.t < t))).length;
  return { contour: paths[0], node: seg + 1 + shift };
}

/** Contorno liscio (Catmull-Rom convertito in Bézier) che passa per i punti: le tangenti nascono dai vicini. */
export function smoothContour(pts: Vec2[]): PathContour {
  const m = pts.length;
  return {
    closed: true,
    nodes: pts.map((p, i): PathNode => {
      const prev = pts[(i + m - 1) % m];
      const next = pts[(i + 1) % m];
      const out: Vec2 = [(next[0] - prev[0]) / 6, (next[1] - prev[1]) / 6];
      return { p, in: [-out[0], -out[1]], out, kind: 'smooth' };
    }),
  };
}

/** Parte della forma da disegnare e angoli (gradi) a cui campionare il raggio della sagoma, per ogni simmetria. */
const SAMPLING: Record<PlanSym, number[]> = {
  none: [90, 60, 30, 0, -30, -60, -90, -120, -150, 180, 150, 120],
  v: [90, 60, 30, 0, -30, -60, -90],
  h: [180, 150, 120, 90, 60, 30, 0],
  q: [90, 67.5, 45, 22.5, 0],
};

/** Punti del contorno intero, simmetrico, da campionare sulla parte maestra: la metà o il quarto, poi gli speculari. */
function fullPoints(master: Vec2[], sym: PlanSym): Vec2[] {
  const join = (pts: Vec2[], m: (p: Vec2) => Vec2) => pts.concat(pts.slice(1, -1).reverse().map(m));
  if (sym === 'v') return join(master, MX.f);
  if (sym === 'h') return join(master, MY.f);
  if (sym === 'q') return join(master.concat(master.slice(0, -1).reverse().map(MY.f)), MX.f);
  return master;
}

/**
 * La sagoma attuale come forma libera con la simmetria `sym`: il contorno si ricampiona sul raggio della sagoma (nodi
 * lisci, quelli sugli assi esattamente sugli assi) e si riporta alla scala corrente. Con `none` non è una forma nuova ma
 * il campionamento in dodici nodi (Libera da zero).
 */
export function symmetrizePlan(plan: PlanDraft, rt: number, sym: PlanSym): PlanDraft {
  const outline = planOutline(planPaths(plan, rt).paths, planTolerance(rt));
  const master = SAMPLING[sym].map((deg): Vec2 => {
    const a = (deg * Math.PI) / 180;
    const r = radialAt(outline, a);
    return [Math.abs(Math.cos(a)) < 1e-9 ? 0 : r * Math.cos(a), Math.abs(Math.sin(a)) < 1e-9 ? 0 : r * Math.sin(a)];
  });
  const paths = [smoothContour(fullPoints(master, sym))];
  const norm = normalizeFree(paths, rt);
  return { ...plan, kind: 'free', base: plan.kind === 'free' ? plan.base : plan.kind, sym, paths: norm.paths, refR: norm.refR };
}
