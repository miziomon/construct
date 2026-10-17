import { samplePaths, sanitizePaths } from './bezier';
import type { PathContour, PathNode, Vec2 } from './types';

/**
 * Sagoma di rotazione del Profilo (sperimentale): la forma che il solido ruotato ha visto dall'alto. È un insieme di
 * contorni di Bézier come quelli del Profilo, così l'editor li disegna e li modifica con gli stessi strumenti. Le forme
 * parametriche (cerchio, poligono, rettangolo, stella) sono generate dai parametri; la prima modifica a mano le "rompe"
 * in una forma libera (`kind: 'free'`), da cui `resetPlan` le riporta ai parametri.
 */

export type PlanKind = 'circle' | 'polygon' | 'rect' | 'star' | 'free';
export type PlanParamKind = Exclude<PlanKind, 'free'>;
/** Simmetria della forma libera: nessuna, verticale (asse Y), orizzontale (asse X), quattro quarti. */
export type PlanSym = 'none' | 'v' | 'h' | 'q';
export type PlanModel = 'offset' | 'scale';
export type PlanFit = 'planToProfile' | 'profileToPlan';

export interface PlanDraft {
  kind: PlanKind;
  /** Ultima forma parametrica scelta: a lei torna `resetPlan`. */
  base: PlanParamKind;
  /** Lati (poligono) o punte (stella). */
  n: number;
  /** Raggio interno della stella rispetto a quello esterno (0..1). */
  ratio: number;
  /** Rotazione (gradi) di poligono e stella. */
  rot: number;
  /** Raggio (mm) degli angoli esterni (convessi). */
  cornerR: number;
  /** Raggio (mm) degli angoli interni (concavi) della stella. */
  innerR: number;
  /** Arrotondamento ad arco di cerchio o continuo (come le icone di Apple). */
  cornerType: 'arc' | 'smooth';
  /** Morbidezza dell'angolo continuo (0..1). */
  smooth: number;
  /** Scala X e Y (percento) della forma parametrica. */
  sx: number;
  sy: number;
  /** Contorni della forma libera, in mm alla scala di `refR` (ogni modifica li porta alla scala corrente). */
  paths: PathContour[];
  /** Raggio massimo a cui erano disegnati `paths`. */
  refR: number;
  sym: PlanSym;
  /** Equidistante (pareti costanti) oppure omotetico (scala dal centro). */
  model: PlanModel;
  /** Chi si adatta all'altro: la sagoma al raggio del profilo o il profilo alla larghezza della sagoma. */
  fit: PlanFit;
  /** Larghezza (mm) della sagoma quando è il profilo ad adattarsi. */
  planW: number;
}

export const DEFAULT_PLAN: PlanDraft = {
  kind: 'circle', base: 'circle', n: 6, ratio: 0.5, rot: 0, cornerR: 6, innerR: 3, cornerType: 'arc', smooth: 0.6, sx: 100, sy: 100,
  paths: [], refR: 1, sym: 'none', model: 'offset', fit: 'planToProfile', planW: 70,
};

/** Forme pronte (Squircle, Esagono...): i parametri che cambiano rispetto all'ultima forma scelta. */
export const PLAN_PRESETS = {
  circle: { kind: 'circle', base: 'circle', sx: 100, sy: 100 },
  squircle: { kind: 'rect', base: 'rect', sx: 100, sy: 100, cornerR: 14, cornerType: 'smooth', smooth: 1 },
  hex: { kind: 'polygon', base: 'polygon', n: 6, rot: 0, sx: 100, sy: 100, cornerR: 5, cornerType: 'arc' },
  star: { kind: 'star', base: 'star', n: 5, ratio: 0.5, rot: 0, sx: 100, sy: 100, cornerR: 3, innerR: 4, cornerType: 'smooth', smooth: 0.8 },
  oval: { kind: 'circle', base: 'circle', sx: 100, sy: 62 },
} satisfies Record<string, Partial<PlanDraft>>;

/** Limiti dei parametri numerici (anche per i campi dell'interfaccia). */
export const PLAN_LIMITS = {
  n: [3, 16], ratio: [0.2, 0.95], rot: [-180, 180], cornerR: [0, 60], innerR: [0, 30], smooth: [0, 1], sx: [40, 200], sy: [40, 200], planW: [10, 400],
} as const;

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
/** Controllo della cubica che approssima un quarto di cerchio. */
const KAPPA = 0.5522847498;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Numero di lati o punte in un intervallo valido (intero). */
export const clampPlanN = (n: number) => Math.round(clamp(n, PLAN_LIMITS.n[0], PLAN_LIMITS.n[1]));

// --- Contorni --------------------------------------------------------------------------------------------------------

/** Moltiplica posizioni e maniglie per `k` (attorno all'origine). */
export function scalePaths(paths: PathContour[], k: number): PathContour[] {
  if (k === 1) return paths;
  const s = (v: Vec2): Vec2 => [v[0] * k, v[1] * k];
  return paths.map((c) => ({ ...c, nodes: c.nodes.map((n) => ({ ...n, p: s(n.p), ...(n.in ? { in: s(n.in) } : {}), ...(n.out ? { out: s(n.out) } : {}) })) }));
}

const areaOf = (p: Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
};

/** Poligono antiorario del primo contorno (campionato alla tolleranza data), o [] se non c'è. */
export function planOutline(paths: PathContour[], tolerance: number): Vec2[] {
  const c = paths[0];
  if (!c || c.nodes.length < 3) return [];
  const pts = samplePaths([{ ...c, closed: true }], tolerance).contours[0].points;
  return areaOf(pts) < 0 ? pts.slice().reverse() : pts;
}

/** Tolleranza di campionamento adatta a un raggio (mm). */
export const planTolerance = (rt: number) => clamp(rt * 0.002, 0.01, 0.5);

/** Semi-larghezza massima in X del contorno (la sagoma deve stare in ±hx). */
export function halfWidth(paths: PathContour[], tolerance: number): number {
  let hx = 0;
  for (const p of planOutline(paths, tolerance)) hx = Math.max(hx, Math.abs(p[0]));
  return hx;
}

const node = (p: Vec2, inn: Vec2 | undefined, out: Vec2 | undefined, kind: PathNode['kind']): PathNode => ({ p, ...(inn ? { in: inn } : {}), ...(out ? { out } : {}), kind });

/**
 * Poligono con gli angoli arrotondati, come contorno di nodi. `rad[i]` è il raggio (nelle stesse unità dei vertici) del
 * vertice i; il poligono è antiorario. Arco: cubica (due se l'angolo da percorrere supera 100°); continuo: una cubica con
 * la tangente più lunga, come negli angoli delle icone di Apple. `limited` dice se un raggio è stato ridotto perché i lati
 * adiacenti non bastavano.
 */
export function roundedContour(V: Vec2[], rad: number[], type: 'arc' | 'smooth', smooth: number): { contour: PathContour; limited: boolean } {
  const m = V.length;
  const nodes: PathNode[] = [];
  let limited = false;
  for (let i = 0; i < m; i++) {
    const P = V[(i + m - 1) % m];
    const C = V[i];
    const N = V[(i + 1) % m];
    const r = rad[i];
    if (!(r > 1e-9)) {
      nodes.push(node(C, undefined, undefined, 'corner'));
      continue;
    }
    let e1x = P[0] - C[0], e1y = P[1] - C[1];
    const l1 = Math.hypot(e1x, e1y);
    e1x /= l1; e1y /= l1;
    let e2x = N[0] - C[0], e2y = N[1] - C[1];
    const l2 = Math.hypot(e2x, e2y);
    e2x /= l2; e2y /= l2;
    const phi = Math.acos(clamp(e1x * e2x + e1y * e2y, -1, 1));
    if (phi < 1e-6 || phi > Math.PI - 1e-6) {
      nodes.push(node(C, undefined, undefined, 'corner'));
      continue;
    }
    let t = r / Math.tan(phi / 2);
    const tmax = 0.5 * Math.min(l1, l2);
    if (t > tmax) {
      t = tmax;
      limited = true;
    }
    const sweep = Math.PI - phi;
    if (type === 'smooth') {
      const T = Math.min(t * (1 + 0.5 * smooth), tmax);
      const c0 = (4 / 3) * Math.tan(sweep / 4) * Math.tan(phi / 2);
      const cs = Math.min(c0 * (1 + 0.45 * smooth), 0.95);
      const A: Vec2 = [C[0] + e1x * T, C[1] + e1y * T];
      const B: Vec2 = [C[0] + e2x * T, C[1] + e2y * T];
      nodes.push(node(A, undefined, [-e1x * T * cs, -e1y * T * cs], 'corner'));
      nodes.push(node(B, [-e2x * T * cs, -e2y * T * cs], undefined, 'corner'));
      continue;
    }
    const rEff = t * Math.tan(phi / 2);
    const A: Vec2 = [C[0] + e1x * t, C[1] + e1y * t];
    const B: Vec2 = [C[0] + e2x * t, C[1] + e2y * t];
    if (sweep <= 100 * D2R) {
      const off = (4 / 3) * Math.tan(sweep / 4) * rEff;
      nodes.push(node(A, undefined, [-e1x * off, -e1y * off], 'corner'));
      nodes.push(node(B, [-e2x * off, -e2y * off], undefined, 'corner'));
    } else {
      // Angolo ampio: due cubiche, con un nodo liscio a metà dell'arco
      const off = (4 / 3) * Math.tan(sweep / 8) * rEff;
      let bx = e1x + e2x, by = e1y + e2y;
      const bl = Math.hypot(bx, by);
      bx /= bl; by /= bl;
      const dc = rEff / Math.sin(phi / 2);
      const M: Vec2 = [C[0] + bx * dc - bx * rEff, C[1] + by * dc - by * rEff];
      let tx = B[0] - A[0], ty = B[1] - A[1];
      const tl = Math.hypot(tx, ty);
      tx /= tl; ty /= tl;
      nodes.push(node(A, undefined, [-e1x * off, -e1y * off], 'corner'));
      nodes.push(node(M, [-tx * off, -ty * off], [tx * off, ty * off], 'smooth'));
      nodes.push(node(B, [-e2x * off, -e2y * off], undefined, 'corner'));
    }
  }
  return { contour: { closed: true, nodes }, limited };
}

/** Cerchio o ellisse: quattro nodi lisci con le maniglie della cubica, antiorari a partire da destra. */
function ellipseContour(a: number, b: number): PathContour {
  const k = KAPPA;
  return {
    closed: true,
    nodes: [
      node([a, 0], [0, -k * b], [0, k * b], 'symmetric'),
      node([0, b], [k * a, 0], [-k * a, 0], 'symmetric'),
      node([-a, 0], [0, k * b], [0, -k * b], 'symmetric'),
      node([0, -b], [-k * a, 0], [k * a, 0], 'symmetric'),
    ],
  };
}

/** Vertici (antiorari) di un poligono regolare con un vertice in alto, ruotato di `rot` gradi. */
function regular(n: number, rot: number): Vec2[] {
  return Array.from({ length: n }, (_, i): Vec2 => {
    const a = (90 + rot + (360 * i) / n) * D2R;
    return [Math.cos(a), Math.sin(a)];
  });
}
function starVerts(n: number, ratio: number, rot: number): Vec2[] {
  return Array.from({ length: 2 * n }, (_, i): Vec2 => {
    const a = (90 + rot + (180 * i) / n) * D2R;
    const r = i % 2 ? ratio : 1;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/**
 * Contorno di una forma parametrica con semi-larghezza massima `rt` (mm). I raggi sono in mm: la scala dipende dal
 * raggio (le dimensioni finali dipendono dagli angoli), quindi si risolve per iterazioni.
 */
export function parametricPaths(plan: PlanDraft, rt: number): { paths: PathContour[]; limited: boolean } {
  const sx = plan.sx / 100;
  const sy = plan.sy / 100;
  const base = plan.kind === 'free' ? plan.base : plan.kind;
  if (base === 'circle') return { paths: [ellipseContour(rt, (rt * sy) / sx)], limited: false };
  const V0 = base === 'rect' ? ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as Vec2[]) : base === 'polygon' ? regular(clampPlanN(plan.n), plan.rot) : starVerts(clampPlanN(plan.n), plan.ratio, plan.rot);
  const V = V0.map(([x, y]): Vec2 => [x * sx, y * sy]);
  const inner = (i: number) => base === 'star' && i % 2 === 1;
  let f = rt / Math.max(...V.map((v) => Math.abs(v[0])));
  let res = roundedContour(V, V.map((_, i) => (inner(i) ? plan.innerR : plan.cornerR) / f), plan.cornerType, plan.smooth);
  for (let it = 0; it < 8; it++) {
    const hx = halfWidth([res.contour], 0.0005);
    const fn = rt / hx;
    const done = Math.abs(fn - f) < 1e-7 * f;
    f = fn;
    if (done) break;
    res = roundedContour(V, V.map((_, i) => (inner(i) ? plan.innerR : plan.cornerR) / f), plan.cornerType, plan.smooth);
  }
  return { paths: scalePaths([res.contour], f), limited: res.limited };
}

/**
 * Contorni effettivi della sagoma (mm), con semi-larghezza `rt`: quelli generati dai parametri oppure, per la forma
 * libera, quelli disegnati portati dal raggio a cui erano alla scala corrente.
 */
export function planPaths(plan: PlanDraft, rt: number): { paths: PathContour[]; limited: boolean } {
  if (plan.kind === 'free') return { paths: plan.paths.length ? scalePaths(plan.paths, rt / (plan.refR || rt)) : [], limited: false };
  return parametricPaths(plan, rt);
}

/** Vero se la sagoma è un cerchio perfetto (non serve il campo di distanza: i due modelli coincidono). */
export const isPlainCircle = (plan: PlanDraft): boolean => plan.kind === 'circle' && Math.abs(plan.sx - plan.sy) < 1e-9;

/** Vero se la sagoma è quella di partenza (cerchio): il solido è quello del kernel di oggi. */
export const isDefaultPlan = (plan: PlanDraft): boolean => isPlainCircle(plan);

/**
 * Porta la forma libera alla scala `rt`: i contorni diventano quelli effettivi e la loro semi-larghezza massima è `rt`
 * (la sagoma si adatta al profilo: il disegno si riscala alla larghezza massima).
 */
export function normalizeFree(paths: PathContour[], rt: number): { paths: PathContour[]; refR: number } {
  const hx = halfWidth(paths, planTolerance(rt));
  if (!(hx > 1e-9)) return { paths, refR: rt };
  return { paths: scalePaths(paths, rt / hx), refR: rt };
}

/** La forma attuale come forma libera (primo ritocco a mano o pulsante Libera): i nodi sono quelli effettivi. */
export function breakPlan(plan: PlanDraft, rt: number): PlanDraft {
  if (plan.kind === 'free') return plan;
  const { paths } = planPaths(plan, rt);
  return { ...plan, kind: 'free', base: plan.kind, paths, refR: rt, sym: 'none' };
}

/** Torna alla forma parametrica di partenza (modello e adattamento restano). */
export function resetPlan(plan: PlanDraft): PlanDraft {
  return { ...plan, kind: plan.base, paths: [], refR: 1, sym: 'none' };
}

/** Reset della sagoma: torna al cerchio con i parametri iniziali; modello, adattamento e larghezza restano. */
export function resetPlanToDefault(plan: PlanDraft): PlanDraft {
  return { ...DEFAULT_PLAN, model: plan.model, fit: plan.fit, planW: plan.planW };
}

/** Sceglie la forma: una parametrica ritrova gli ultimi parametri noti, Libera parte dalla forma attuale. */
export function selectKind(plan: PlanDraft, kind: PlanKind, rt: number): PlanDraft {
  if (kind === plan.kind) return plan;
  if (kind === 'free') return breakPlan(plan, rt);
  return { ...plan, kind, base: kind, paths: [], refR: 1, sym: 'none' };
}

/** Angoli (radianti, da 0 a 2π) dei nodi: i raggi della mesh passano anche per gli spigoli. */
export function featureAngles(paths: PathContour[]): number[] {
  const out: number[] = [];
  for (const c of paths) for (const n of c.nodes) out.push((Math.atan2(n.p[1], n.p[0]) + TAU) % TAU);
  return out;
}

/** Un contorno chiuso e senza area non è una sagoma. */
export function isValidPlan(paths: PathContour[]): boolean {
  const c = paths[0];
  return !!c && c.nodes.length >= 3 && Math.abs(areaOf(planOutline(paths, 0.05))) > 1e-6;
}

/** Lati o punte validi (intero) e altri parametri entro i limiti: dati non fidati (bozza) o dei campi. */
export function cleanPlan(p: Partial<PlanDraft> | undefined): PlanDraft {
  const d = DEFAULT_PLAN;
  const num = (v: unknown, lim: readonly [number, number], dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lim[0], lim[1]) : dflt);
  const kinds: PlanKind[] = ['circle', 'polygon', 'rect', 'star', 'free'];
  const bases: PlanParamKind[] = ['circle', 'polygon', 'rect', 'star'];
  return {
    kind: kinds.includes(p?.kind as PlanKind) ? (p!.kind as PlanKind) : d.kind,
    base: bases.includes(p?.base as PlanParamKind) ? (p!.base as PlanParamKind) : d.base,
    n: clampPlanN(num(p?.n, PLAN_LIMITS.n, d.n)),
    ratio: num(p?.ratio, PLAN_LIMITS.ratio, d.ratio),
    rot: num(p?.rot, PLAN_LIMITS.rot, d.rot),
    cornerR: num(p?.cornerR, PLAN_LIMITS.cornerR, d.cornerR),
    innerR: num(p?.innerR, PLAN_LIMITS.innerR, d.innerR),
    cornerType: p?.cornerType === 'smooth' ? 'smooth' : 'arc',
    smooth: num(p?.smooth, PLAN_LIMITS.smooth, d.smooth),
    sx: num(p?.sx, PLAN_LIMITS.sx, d.sx),
    sy: num(p?.sy, PLAN_LIMITS.sy, d.sy),
    paths: sanitizePaths(p?.paths) ?? [],
    refR: typeof p?.refR === 'number' && p.refR > 0 ? p.refR : 1,
    sym: p?.sym === 'v' || p?.sym === 'h' || p?.sym === 'q' ? p.sym : 'none',
    model: p?.model === 'scale' ? 'scale' : 'offset',
    fit: p?.fit === 'profileToPlan' ? 'profileToPlan' : 'planToProfile',
    planW: num(p?.planW, PLAN_LIMITS.planW, d.planW),
  };
}
