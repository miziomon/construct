import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { MIN_SEGMENTS, MIN_SPHERE_SEGMENTS } from '../scene/defaults';
import type { PrimitiveNode } from '../scene/types';

type Vec3 = [number, number, number];
type Wasm = ManifoldToplevel['Manifold'];

/**
 * Errore di corda massimo (mm) ammesso per la "pennellata" di un Minkowski: il secondo operando, di solito una sfera che
 * arrotonda gli spigoli del primo. Sotto la risoluzione di qualsiasi stampante, ma riduce di molto i vertici: una sfera
 * di raggio 2 a 140 lati (4902 vertici) scende a 32 lati (258).
 */
export const MINKOWSKI_TOLERANCE = 0.01;

/** Segmenti di un cerchio di raggio `r` perché la corda non si discosti più di `tolerance` dall'arco. */
export function segmentsForTolerance(r: number, tolerance: number): number {
  if (!(r > tolerance)) return MIN_SEGMENTS;
  return Math.ceil(Math.PI / Math.acos(1 - tolerance / r));
}

/**
 * Segmenti con cui costruire una primitiva usata come pennellata di un Minkowski: il minimo entro `MINKOWSKI_TOLERANCE`
 * sul raggio maggiore, mai più di quelli del nodo. `null` se la primitiva non ha curve (o non conviene ridurla).
 */
export function brushSegments(node: PrimitiveNode): number | null {
  let radius: number;
  let minimum: number;
  let round = 1;
  if (node.kind === 'sphere') {
    radius = Math.max(node.radius, node.radiusY ?? 0, node.radiusZ ?? 0);
    minimum = MIN_SPHERE_SEGMENTS;
    // Le sfere di manifold vogliono un multiplo di 4
    round = 4;
  } else if (node.kind === 'cylinder') {
    radius = Math.max(node.radius, node.radiusY ?? 0);
    minimum = MIN_SEGMENTS;
  } else if (node.kind === 'cone') {
    radius = Math.max(node.radiusBottom, node.radiusTop, node.radiusY ?? 0);
    minimum = MIN_SEGMENTS;
  } else return null;
  const wanted = Math.max(minimum, Math.ceil(segmentsForTolerance(radius, MINKOWSKI_TOLERANCE) / round) * round);
  return wanted < node.segments ? wanted : null;
}

/** Oltre questo numero di coppie di componenti si usa il calcolo di manifold sull'insieme (la somma a coppie costerebbe di più). */
const MAX_PAIRS = 64;
/** Oltre questo numero di triangoli la scomposizione in toppe convesse non conviene più: si usa il calcolo di manifold. */
const MAX_PATCH_TRIANGLES = 6000;
/** Tolleranza (mm) dei controlli di convessità sui piani delle facce. */
const PLANE_EPS = 1e-5;
/** Spessore (mm) con cui si gonfia una toppa piana, il cui inviluppo altrimenti avrebbe volume nullo. */
const SLAB = 1e-3;

/** Centro del parallelepipedo che racchiude un solido. */
function centerOf(m: Manifold): Vec3 {
  const { min, max } = m.boundingBox();
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/** Vero se il solido è (quasi) convesso: coincide con il suo inviluppo. */
function isConvex(Class: Wasm, m: Manifold): boolean {
  const hull = Class.hull([m]);
  const convex = m.volume() >= hull.volume() * 0.999;
  hull.delete();
  return convex;
}

/** Vertici e triangoli (indici) di un solido. */
function meshOf(m: Manifold): { pts: Vec3[]; tris: ArrayLike<number> } {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const pts: Vec3[] = [];
  for (let i = 0; i < mesh.vertProperties.length; i += np) pts.push([mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]]);
  return { pts, tris: mesh.triVerts };
}

/** Piano (normale unitaria uscente e distanza dall'origine) di ogni triangolo, in un array piatto di 4 valori per triangolo. */
function planesOf(pts: Vec3[], tris: ArrayLike<number>): Float64Array {
  const nt = tris.length / 3;
  const plane = new Float64Array(nt * 4);
  for (let f = 0; f < nt; f++) {
    const a = pts[tris[f * 3]], b = pts[tris[f * 3 + 1]], c = pts[tris[f * 3 + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    plane.set([n[0] / len, n[1] / len, n[2] / len, (n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) / len], f * 4);
  }
  return plane;
}

/**
 * Griglia uniforme dei triangoli (per parallelepipedo di ingombro): `query` restituisce i triangoli il cui ingombro
 * interseca l'intervallo chiesto. Serve a trovare in fretta i triangoli vicini a una toppa.
 */
function triangleGrid(pts: Vec3[], tris: ArrayLike<number>, cell: number) {
  const nt = tris.length / 3;
  const cells = new Map<string, number[]>();
  const boxes: [Vec3, Vec3][] = [];
  const cellsOf = (min: Vec3, max: Vec3, visit: (key: string) => void) => {
    for (let i = Math.floor(min[0] / cell); i <= Math.floor(max[0] / cell); i++)
      for (let j = Math.floor(min[1] / cell); j <= Math.floor(max[1] / cell); j++)
        for (let k = Math.floor(min[2] / cell); k <= Math.floor(max[2] / cell); k++) visit(`${i},${j},${k}`);
  };
  for (let f = 0; f < nt; f++) {
    const P = [pts[tris[f * 3]], pts[tris[f * 3 + 1]], pts[tris[f * 3 + 2]]];
    const min = [0, 1, 2].map((a) => Math.min(P[0][a], P[1][a], P[2][a])) as Vec3;
    const max = [0, 1, 2].map((a) => Math.max(P[0][a], P[1][a], P[2][a])) as Vec3;
    boxes.push([min, max]);
    cellsOf(min, max, (key) => {
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push(f);
    });
  }
  return {
    query(min: Vec3, max: Vec3): Set<number> {
      const out = new Set<number>();
      cellsOf(min, max, (key) => {
        for (const f of cells.get(key) ?? []) {
          const [bmin, bmax] = boxes[f];
          if (bmin[0] <= max[0] && bmax[0] >= min[0] && bmin[1] <= max[1] && bmax[1] >= min[1] && bmin[2] <= max[2] && bmax[2] >= min[2]) out.add(f);
        }
      });
      return out;
    },
  };
}

/**
 * Vero se il triangolo entra nell'interno (stretto) del politopo convesso dato dai suoi semispazi: si ritaglia il
 * triangolo contro ogni piano (Sutherland–Hodgman) e si guarda se resta un poligono di area non nulla.
 */
function triangleEntersPolytope(triangle: Vec3[], planes: number[][]): boolean {
  let poly = triangle;
  for (const [a, b, c, d] of planes) {
    const next: Vec3[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      // Distanza con un margine: ciò che sta sul piano (vicini complanari) non conta come interno
      const dp = a * p[0] + b * p[1] + c * p[2] - d + PLANE_EPS;
      const dq = a * q[0] + b * q[1] + c * q[2] - d + PLANE_EPS;
      if (dp < 0) next.push(p);
      if (dp < 0 !== dq < 0) {
        const t = dp / (dp - dq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
      }
    }
    poly = next;
    if (poly.length < 3) return false;
  }
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i + 1 < poly.length; i++) {
    const u = [poly[i][0] - poly[0][0], poly[i][1] - poly[0][1], poly[i][2] - poly[0][2]];
    const v = [poly[i + 1][0] - poly[0][0], poly[i + 1][1] - poly[0][1], poly[i + 1][2] - poly[0][2]];
    ax += u[1] * v[2] - u[2] * v[1];
    ay += u[2] * v[0] - u[0] * v[2];
    az += u[0] * v[1] - u[1] * v[0];
  }
  return Math.hypot(ax, ay, az) > 1e-9;
}

/**
 * Scompone un solido concavo in toppe convesse: gruppi di triangoli adiacenti il cui inviluppo sta tutto dentro il solido.
 * Restituisce i vertici di ogni toppa, oppure `null` se la scomposizione non conviene (troppi triangoli o toppe quasi
 * una per triangolo, come nelle superfici molto curve): allora è meglio il calcolo di manifold.
 *
 * Una toppa cresce un triangolo alla volta. Prima del controllo vero si applica la condizione necessaria di convessità:
 * ogni vertice nuovo sotto i piani delle facce già nella toppa e viceversa. Il controllo vero è geometrico, senza
 * booleane: l'inviluppo della toppa confina con l'interno del solido lungo la toppa, quindi sta tutto dentro il solido
 * se nessun triangolo estraneo entra nel suo interno (`triangleEntersPolytope` sui triangoli vicini, dalla griglia).
 */
function convexPatches(Class: Wasm, m: Manifold): Vec3[][] | null {
  const { pts, tris } = meshOf(m);
  const nt = tris.length / 3;
  if (nt === 0 || nt > MAX_PATCH_TRIANGLES) return null;

  const plane = planesOf(pts, tris);
  const above = (f: number, p: Vec3) => plane[f * 4] * p[0] + plane[f * 4 + 1] * p[1] + plane[f * 4 + 2] * p[2] - plane[f * 4 + 3];
  const { min: bmin, max: bmax } = m.boundingBox();
  const grid = triangleGrid(pts, tris, Math.max(1e-3, Math.max(bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]) / 20));

  // Triangoli adiacenti: due triangoli con lo stesso spigolo
  const edge = new Map<number, number>();
  const adj: number[][] = Array.from({ length: nt }, () => []);
  for (let f = 0; f < nt; f++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[f * 3 + k], b = tris[f * 3 + ((k + 1) % 3)];
      const key = a < b ? a * pts.length + b : b * pts.length + a;
      const other = edge.get(key);
      if (other === undefined) edge.set(key, f);
      else {
        adj[f].push(other);
        adj[other].push(f);
      }
    }
  }

  const owned = new Uint8Array(nt);
  const patches: Vec3[][] = [];
  for (let seed = 0; seed < nt; seed++) {
    if (owned[seed]) continue;
    // Troppe toppe: la scomposizione non porta vantaggio
    if (patches.length > nt / 2) return null;
    owned[seed] = 1;
    const faces = new Set<number>([seed]);
    const verts = new Set<number>([tris[seed * 3], tris[seed * 3 + 1], tris[seed * 3 + 2]]);
    const queue = [...adj[seed]];
    const tried = new Set<number>();
    while (queue.length) {
      const g = queue.shift()!;
      if (owned[g] || tried.has(g)) continue;
      tried.add(g);
      const fresh = [0, 1, 2].map((k) => tris[g * 3 + k]).filter((v) => !verts.has(v));
      // Condizione necessaria: nessun vertice nuovo sopra le facce della toppa, nessun vertice della toppa sopra la nuova
      let bad = false;
      for (const v of fresh) {
        for (const f of faces) if (above(f, pts[v]) > PLANE_EPS) { bad = true; break; }
        if (bad) break;
      }
      if (bad) continue;
      for (const v of verts) if (above(g, pts[v]) > PLANE_EPS) { bad = true; break; }
      if (bad) continue;

      // Controllo vero: nessun triangolo estraneo alla toppa entra nell'inviluppo dei suoi vertici
      const candidate = [...verts, ...fresh].map((v) => pts[v]);
      const hull = hullPlanes(Class, candidate, plane, seed);
      let enters = false;
      for (const f of grid.query(hull.min, hull.max)) {
        if (f === g || faces.has(f)) continue;
        if (triangleEntersPolytope([pts[tris[f * 3]], pts[tris[f * 3 + 1]], pts[tris[f * 3 + 2]]], hull.planes)) { enters = true; break; }
      }
      if (enters) continue;
      faces.add(g);
      owned[g] = 1;
      for (const v of fresh) verts.add(v);
      queue.push(...adj[g]);
    }
    patches.push([...verts].map((v) => pts[v]));
  }
  return patches;
}

/**
 * Semispazi (piani distinti delle facce) e ingombro dell'inviluppo dei punti. Una toppa piana, il cui inviluppo
 * avrebbe volume nullo, si gonfia di `SLAB` verso l'interno del solido (contro la normale del triangolo seme).
 */
function hullPlanes(Class: Wasm, points: Vec3[], plane: Float64Array, seed: number): { planes: number[][]; min: Vec3; max: Vec3 } {
  let hull = Class.hull(points);
  if (hull.isEmpty() || hull.volume() < 1e-9) {
    hull.delete();
    const n = [plane[seed * 4], plane[seed * 4 + 1], plane[seed * 4 + 2]];
    hull = Class.hull([...points, ...points.map((p): Vec3 => [p[0] - n[0] * SLAB, p[1] - n[1] * SLAB, p[2] - n[2] * SLAB])]);
  }
  const { pts, tris } = meshOf(hull);
  const { min, max } = hull.boundingBox();
  hull.delete();
  const all = planesOf(pts, tris);
  const planes: number[][] = [];
  const seen = new Set<string>();
  for (let f = 0; f < tris.length / 3; f++) {
    const p = [all[f * 4], all[f * 4 + 1], all[f * 4 + 2], all[f * 4 + 3]];
    const key = p.map((v) => v.toFixed(6)).join(',');
    if (!seen.has(key)) {
      seen.add(key);
      planes.push(p);
    }
  }
  return { planes, min: min as Vec3, max: max as Vec3 };
}

/**
 * Somma di Minkowski di un solido concavo `a` con uno convesso `b` per toppe convesse: l'unione delle somme di ogni
 * toppa della superficie con `b`, più `a` traslato di un punto di `b` (che riempie l'interno). Con tante facce piane
 * è molto più rapida del calcolo di manifold. `null` se la scomposizione non conviene.
 */
function sumByPatches(Class: Wasm, a: Manifold, b: Manifold): Manifold | null {
  const patches = convexPatches(Class, a);
  if (!patches) return null;
  const bPoints = meshOf(b).pts;
  const parts = patches.map((patch) => {
    const sums: Vec3[] = [];
    for (const p of patch) for (const q of bPoints) sums.push([p[0] + q[0], p[1] + q[1], p[2] + q[2]]);
    return Class.hull(sums);
  });
  const q = bPoints[0];
  parts.push(a.translate(q));
  const result = Class.union(parts);
  parts.forEach((p) => p.delete());
  return result;
}

/**
 * Somma di Minkowski di due solidi connessi. `minkowskiSum` di manifold sbaglia quando il secondo solido non contiene
 * l'origine: il risultato comprende anche il primo solido (un cubo con una sfera lontana "resta" dov'era). Per questo
 * i due solidi si portano con il centro nell'origine, si sommano, e il risultato si riporta al suo posto (la somma si
 * sposta della somma degli spostamenti). Se il secondo è concavo e il primo no, i ruoli si scambiano.
 * Con un solo operando concavo si prova prima la scomposizione in toppe convesse (molto più rapida con facce piane).
 */
function sumPair(Class: Wasm, a: Manifold, b: Manifold): Manifold {
  const convexA = isConvex(Class, a);
  const convexB = isConvex(Class, b);
  const [first, second] = !convexB && convexA ? [b, a] : [a, b];
  if (convexA !== convexB) {
    const byPatches = sumByPatches(Class, first, second);
    if (byPatches) return byPatches;
  }
  const ca = centerOf(first);
  const cb = centerOf(second);
  const x = first.translate([-ca[0], -ca[1], -ca[2]]);
  const y = second.translate([-cb[0], -cb[1], -cb[2]]);
  const sum = x.minkowskiSum(y);
  x.delete();
  y.delete();
  const placed = sum.translate([ca[0] + cb[0], ca[1] + cb[1], ca[2] + cb[2]]);
  sum.delete();
  // La somma di due solidi convessi è convessa: l'inviluppo ripulisce gli errori di calcolo, così i passi seguenti
  // la riconoscono come convessa (altrimenti manifold la scompone in molte parti e diventa decine di volte più lento)
  if (convexA && convexB) {
    const hull = Class.hull([placed]);
    placed.delete();
    return hull;
  }
  return placed;
}

/**
 * Somma di Minkowski di due solidi qualsiasi. Si distribuisce sull'unione: `(A1 ∪ A2) ⊕ B = (A1 ⊕ B) ∪ (A2 ⊕ B)`, quindi
 * si sommano a coppie le componenti connesse (di solito convesse, e allora il calcolo è istantaneo invece che decine di
 * secondi) e si uniscono i risultati.
 */
function sumOf(Class: Wasm, a: Manifold, b: Manifold): Manifold {
  if (a.isEmpty() || b.isEmpty()) return Class.union([]);
  const as = a.decompose();
  const bs = b.decompose();
  const release = () => [...as, ...bs].forEach((m) => m.delete());
  if (as.length * bs.length > MAX_PAIRS || as.length * bs.length <= 1) {
    release();
    return sumPair(Class, a, b);
  }
  const sums = as.flatMap((x) => bs.map((y) => sumPair(Class, x, y)));
  release();
  const result = Class.union(sums);
  sums.forEach((s) => s.delete());
  return result;
}

/**
 * Somma di Minkowski di più solidi (`minkowski()` di OpenSCAD): il primo si espande del volume di ogni successivo, uno
 * dopo l'altro. Con una sfera come secondo solido equivale ad arrotondare ogni spigolo del primo.
 * I solidi passati restano di chi li possiede (la cache): il risultato è sempre un Manifold nuovo, da liberare.
 */
export function minkowskiOf(Class: Wasm, solids: Manifold[]): Manifold {
  if (solids.length === 0) return Class.union([]);
  // Un solo figlio: la somma è il figlio stesso (una copia, perché il chiamante libera il risultato)
  let result = solids[0].translate([0, 0, 0]);
  for (const next of solids.slice(1)) {
    const grown = sumOf(Class, result, next);
    result.delete();
    result = grown;
  }
  return result;
}
