import type { Vec2, Vec3 } from './types';

/**
 * Rotazione di un profilo lungo una sagoma (sperimentale). Ogni punto del profilo a distanza x dall'asse diventa un
 * anello a forma di sagoma, con lo stesso numero di vertici per ogni anello (raggi uscenti dal centro, più i raggi che
 * passano per i nodi della sagoma, così gli spigoli restano vivi):
 *
 * - **equidistante**: l'anello è la sagoma rientrata di `R - x` (pareti di spessore costante, angoli convessi che si
 *   stringono fino a diventare vivi, angoli concavi che si allargano). La distanza dal bordo si campiona sui raggi;
 * - **omotetico**: l'anello è la sagoma ridotta in scala di `x / R`.
 *
 * Serve una sagoma stellata rispetto all'origine (ogni raggio incontra il bordo una volta sola).
 */

export type PlanRingModel = 'offset' | 'scale';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Distanze (lungo il raggio) alle quali il raggio con angolo `th` incontra il bordo del poligono. */
export function rayHits(pts: Vec2[], th: number): number[] {
  const e0 = Math.cos(th);
  const e1 = Math.sin(th);
  const hits: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const A = pts[i];
    const B = pts[(i + 1) % pts.length];
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const den = cross(e0, e1, dx, dy);
    if (Math.abs(den) < 1e-12) continue;
    const t = cross(A[0], A[1], dx, dy) / den;
    const u = cross(A[0], A[1], e0, e1) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) hits.push(t);
  }
  return hits;
}

/** Distanza dal centro del bordo lungo l'angolo `th` (0 se il raggio non lo incontra). */
export function radialAt(pts: Vec2[], th: number): number {
  const h = rayHits(pts, th);
  return h.length ? Math.max(...h) : 0;
}

/** Sagoma preparata: raggi, distanze del bordo e (a richiesta) campo di distanza lungo ogni raggio. */
export interface PlanPrep {
  pts: Vec2[];
  K: number;
  /** Campioni di distanza lungo ogni raggio. */
  M: number;
  th: number[];
  R: Float64Array;
  cos: Float64Array;
  sin: Float64Array;
  /** Misura di riferimento (mm) per le tolleranze. */
  size: number;
  /** Falso se la sagoma non è stellata rispetto all'origine. */
  ok: boolean;
  /** Distanza dal bordo campionata lungo i raggi, K × (M + 1); null finché non serve. */
  sdf: Float32Array | null;
  /** Raggio del cerchio inscritto (distanza massima dal bordo) misurato sui raggi. */
  inr: number;
  /** Cerchio perfetto: i due modelli coincidono e il campo di distanza non serve. */
  exact: boolean;
}

/**
 * Prepara la sagoma (poligono antiorario) con `K` raggi uniformi e `M` campioni per raggio. I raggi degli angoli `feats`
 * (i nodi della sagoma) prendono il posto del raggio uniforme più vicino, invece di aggiungersi accanto: due raggi quasi
 * coincidenti farebbero triangoli lunghissimi e sottili, che la vista ombreggia con righe bianche. Così due raggi distano
 * almeno mezzo passo (salvo nodi più fitti del passo, che si aggiungono).
 */
/** Raggi al massimo, anche con l'infittimento: protegge kernel e codice da sagome con molte curve strette. */
const MAX_RAYS = 1440;

/**
 * Infittisce i raggi dove la sagoma curva: tra due raggi vicini si aggiunge quello di mezzo finché il punto del bordo a
 * metà dista dalla corda meno di `tol` (mm). I lati dritti non ne ricevono, gli spigoli restano sui raggi dei nodi.
 */
function refineRays(pts: Vec2[], th: number[], tol: number): number[] {
  let list = th.slice();
  for (let pass = 0; pass < 6 && list.length < MAX_RAYS; pass++) {
    const next: number[] = [];
    let added = 0;
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      const b = k + 1 < list.length ? list[k + 1] : list[0] + TAU;
      next.push(a);
      const m = (a + b) / 2;
      const ra = radialAt(pts, a);
      const rb = radialAt(pts, b);
      const rm = radialAt(pts, m);
      const A: Vec2 = [ra * Math.cos(a), ra * Math.sin(a)];
      const B: Vec2 = [rb * Math.cos(b), rb * Math.sin(b)];
      const P: Vec2 = [rm * Math.cos(m), rm * Math.sin(m)];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const dev = len > 1e-12 ? Math.abs(cross(B[0] - A[0], B[1] - A[1], P[0] - A[0], P[1] - A[1])) / len : 0;
      if (dev > tol && list.length + added < MAX_RAYS) {
        next.push(m % TAU);
        added++;
      }
    }
    list = next.sort((x, y) => x - y);
    if (!added) break;
  }
  return list;
}

export function preparePlan(pts: Vec2[], feats: number[], K: number, M: number, size: number, exact = false, refineTol = 0): PlanPrep {
  const step = TAU / K;
  const grid = Array.from({ length: K }, (_, i) => i * step);
  const taken = new Uint8Array(K);
  const extra: number[] = [];
  for (const raw of feats) {
    const a = ((raw % TAU) + TAU) % TAU;
    const i = Math.round(a / step) % K;
    if (!taken[i]) {
      grid[i] = a;
      taken[i] = 1;
    } else extra.push(a);
  }
  const all = grid.concat(extra).sort((a, b) => a - b);
  const th: number[] = [];
  for (const a of all) if (!th.length || a - th[th.length - 1] > 1e-5) th.push(a);
  if (th.length > 1 && th[0] + TAU - th[th.length - 1] < 1e-5) th.pop();
  // Con una tolleranza (il kernel) i raggi si infittiscono dove la sagoma curva
  if (refineTol > 0 && !exact && pts.length >= 3) {
    const rays = refineRays(pts, th, refineTol);
    th.length = 0;
    th.push(...rays);
  }
  const n = th.length;
  const R = new Float64Array(n);
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  let ok = pts.length >= 3;
  for (let k = 0; k < n; k++) {
    cos[k] = Math.cos(th[k]);
    sin[k] = Math.sin(th[k]);
    const hits = rayHits(pts, th[k]).sort((a, b) => a - b);
    if (!hits.length) {
      ok = false;
      continue;
    }
    let clusters = 1;
    for (let i = 1; i < hits.length; i++) if (hits[i] - hits[i - 1] > 1e-6 * size) clusters++;
    if (clusters > 1) ok = false;
    R[k] = hits[hits.length - 1];
  }
  return { pts, K: n, M, th, R, cos, sin, size, ok, sdf: null, inr: 0, exact };
}

/** Calcola (una volta) la distanza dal bordo lungo ogni raggio. */
export function ensureSdf(prep: PlanPrep): void {
  if (prep.sdf) return;
  const { K, M, R, cos, sin, pts } = prep;
  const np = pts.length;
  const xs = new Float64Array(np);
  const ys = new Float64Array(np);
  pts.forEach((p, i) => {
    xs[i] = p[0];
    ys[i] = p[1];
  });
  const sdf = new Float32Array(K * (M + 1));
  let inr = 0;
  for (let k = 0; k < K; k++) {
    for (let m = 0; m <= M; m++) {
      const t = (R[k] * m) / M;
      const px = t * cos[k];
      const py = t * sin[k];
      let best = 1e18;
      for (let i = 0, j = np - 1; i < np; j = i++) {
        const ax = xs[j];
        const ay = ys[j];
        const bx = xs[i] - ax;
        const by = ys[i] - ay;
        const l2 = bx * bx + by * by;
        let u = l2 > 0 ? ((px - ax) * bx + (py - ay) * by) / l2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = px - ax - u * bx;
        const qy = py - ay - u * by;
        const d2 = qx * qx + qy * qy;
        if (d2 < best) best = d2;
      }
      const d = Math.sqrt(best);
      sdf[k * (M + 1) + m] = d;
      if (d > inr) inr = d;
    }
  }
  prep.sdf = sdf;
  prep.inr = inr;
}

/** Raggi (uno per raggio uscente) dell'anello del punto del profilo a distanza `x` dall'asse, con raggio massimo `rmax`. */
export function ringRadii(prep: PlanPrep, model: PlanRingModel, rmax: number, x: number): Float64Array {
  const { K, M, R } = prep;
  const out = new Float64Array(K);
  if (model === 'scale' || prep.exact) {
    const u = clamp(x / rmax, 0, 1);
    for (let k = 0; k < K; k++) out[k] = R[k] * u;
    return out;
  }
  ensureSdf(prep);
  const sdf = prep.sdf!;
  const d = rmax - x;
  const eps = 1e-6 * prep.size;
  if (d <= eps) {
    out.set(R);
    return out;
  }
  // Oltre il raggio inscritto l'anello è una cresta (un segmento): nel solido diventerebbe una pinna senza spessore, che
  // non è una varietà. Si fa collassare nel centro: la cupola su un rettangolo finisce in un punto invece che in un colmo
  for (let k = 0; k < K; k++) {
    const b = k * (M + 1);
    let m = M;
    while (m >= 0 && sdf[b + m] < d - eps) m--;
    if (m < 0) continue;
    if (m === M) {
      out[k] = R[k];
      continue;
    }
    const s0 = sdf[b + m];
    const s1 = sdf[b + m + 1];
    const u = s0 > s1 ? (s0 - d) / (s0 - s1) : 0;
    out[k] = (R[k] * (m + clamp(u, 0, 1))) / M;
  }
  return out;
}

/** Anelli già calcolati per distanza dall'asse (stesso x = stesso anello). */
export function ringCache(prep: PlanPrep, model: PlanRingModel, rmax: number): (x: number) => Float64Array {
  const cache = new Map<string, Float64Array>();
  return (x) => {
    const key = x.toFixed(4);
    let r = cache.get(key);
    if (!r) {
      r = ringRadii(prep, model, rmax, x);
      cache.set(key, r);
    }
    return r;
  };
}

/** Punti di un anello nel piano. */
export function ringPoints(prep: PlanPrep, radii: Float64Array): Vec2[] {
  return Array.from({ length: prep.K }, (_, k): Vec2 => [radii[k] * prep.cos[k], radii[k] * prep.sin[k]]);
}

// --- Mesh ------------------------------------------------------------------------------------------------------------

export interface RevolveMesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** Volume (mm³). */
  volume: number;
  bbox: { min: Vec3; max: Vec3 };
  /** Anelli (vertici del profilo) per punti di ogni anello. */
  rings: number;
  points: number;
}

/**
 * Mesh del solido: ogni contorno del profilo (x = distanza dall'asse, y = quota) è un giro di anelli. La parte con x
 * negativo si scarta, come fa il kernel. Le facce sono orientate verso l'esterno.
 */
export function revolveMesh(prep: PlanPrep, model: PlanRingModel, contours: Vec2[][], rmax: number): RevolveMesh {
  const ring = ringCache(prep, model, rmax);
  const K = prep.K;
  // Vertici unici per posizione: gli anelli collassati (asse, punte) condividono lo stesso vertice, così la superficie resta
  // chiusa; i triangoli piatti con vertici distinti restano e li collassa manifold
  const index = new Map<string, number>();
  const pos: number[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const vertex = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
    let i = index.get(key);
    if (i === undefined) {
      i = pos.length / 3;
      index.set(key, i);
      pos.push(x, y, z);
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    return i;
  };
  const indices: number[] = [];
  let rings = 0;
  for (const c of contours) {
    const J = c.length;
    const ids: number[][] = c.map(([x, z]) => {
      const r = ring(Math.max(0, x));
      return Array.from({ length: K }, (_, k) => vertex(r[k] * prep.cos[k], r[k] * prep.sin[k], z));
    });
    for (let j = 0; j < J; j++) {
      const a0 = ids[j];
      const a1 = ids[(j + 1) % J];
      for (let k = 0; k < K; k++) {
        const k2 = (k + 1) % K;
        for (const [p, q, t] of [[a0[k], a0[k2], a1[k2]], [a0[k], a1[k2], a1[k]]]) if (p !== q && q !== t && p !== t) indices.push(p, q, t);
      }
    }
    rings += J;
  }
  const positions = Float32Array.from(pos);
  // Volume con segno (tetraedri dall'origine): se è negativo le facce guardano dentro e si rovesciano
  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    vol += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
  }
  if (vol < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  if (!isFinite(min[0])) {
    min.fill(0);
    max.fill(0);
  }
  return { positions, indices: Uint32Array.from(indices), volume: Math.abs(vol), bbox: { min, max }, rings, points: K };
}

// --- Sezione e misure -------------------------------------------------------------------------------------------------

/** Ascisse (distanza dall'asse) in cui la quota `z` attraversa i contorni del profilo, in ordine crescente. */
export function crossingsAt(contours: Vec2[][], z: number): number[] {
  const xs: number[] = [];
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      if (a[1] <= z !== b[1] <= z) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
  }
  return xs.sort((p, q) => p - q);
}

function distToPolyline(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0] - ax, by = poly[i][1] - ay;
    const l2 = bx * bx + by * by;
    let u = l2 > 0 ? ((p[0] - ax) * bx + (p[1] - ay) * by) / l2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = p[0] - ax - u * bx, qy = p[1] - ay - u * by;
    best = Math.min(best, qx * qx + qy * qy);
  }
  return Math.sqrt(best);
}

/**
 * Spessore della parete più esterna alla quota data (le ascisse sono quelle di `crossingsAt`): minimo e massimo della
 * distanza tra l'anello esterno e quello interno, e la differenza nominale nel profilo. Null se la quota non attraversa
 * una parete (solo solidi che toccano l'asse).
 */
export function wallThickness(prep: PlanPrep, ring: (x: number) => Float64Array, xs: number[]): { min: number; max: number; nominal: number } | null {
  for (let i = xs.length - 2; i >= 0; i -= 2) {
    const xb = xs[i + 1];
    const xa = xs[i];
    if (xa > 0.05) {
      const outer = ringPoints(prep, ring(xb));
      const inner = ringPoints(prep, ring(xa));
      let mn = Infinity;
      let mx = 0;
      for (const p of outer) {
        const d = distToPolyline(p, inner);
        mn = Math.min(mn, d);
        mx = Math.max(mx, d);
      }
      return { min: mn, max: mx, nominal: xb - xa };
    }
  }
  return null;
}

/**
 * Raggio inscritto se un bordo inclinato del profilo lo attraversa (l'equidistante forma una cresta: nel prototipo le
 * facce sono a ventaglio), altrimenti null.
 */
export function ridgeRadius(prep: PlanPrep, model: PlanRingModel, contours: Vec2[][], rmax: number): number | null {
  if (model !== 'offset' || prep.exact) return null;
  ensureSdf(prep);
  const inr = prep.inr;
  const tol = 0.003 * rmax;
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      const da = rmax - a[0];
      const db = rmax - b[0];
      if (da > inr + tol !== db > inr + tol && Math.abs(a[1] - b[1]) > 0.5) return inr;
    }
  }
  return null;
}
