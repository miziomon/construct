import type { Manifold, ManifoldToplevel } from 'manifold-3d';

type Vec3 = [number, number, number];
type Wasm = ManifoldToplevel['Manifold'];

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

/**
 * Scompone un solido concavo in toppe convesse: gruppi di triangoli adiacenti il cui inviluppo sta tutto dentro il solido.
 * Restituisce i vertici di ogni toppa, oppure `null` se la scomposizione non conviene (troppi triangoli o toppe quasi
 * una per triangolo, come nelle superfici molto curve): allora è meglio il calcolo di manifold.
 *
 * Una toppa cresce un triangolo alla volta. Prima di un controllo costoso (inviluppo meno solido) si applica la
 * condizione necessaria di convessità: ogni vertice nuovo sotto i piani delle facce già nella toppa e viceversa.
 */
function convexPatches(Class: Wasm, m: Manifold): Vec3[][] | null {
  const { pts, tris } = meshOf(m);
  const nt = tris.length / 3;
  if (nt === 0 || nt > MAX_PATCH_TRIANGLES) return null;

  // Piano (normale uscente e distanza) di ogni triangolo
  const plane = new Float64Array(nt * 4);
  for (let f = 0; f < nt; f++) {
    const a = pts[tris[f * 3]], b = pts[tris[f * 3 + 1]], c = pts[tris[f * 3 + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    plane.set([n[0] / len, n[1] / len, n[2] / len, (n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) / len], f * 4);
  }
  const above = (f: number, p: Vec3) => plane[f * 4] * p[0] + plane[f * 4 + 1] * p[1] + plane[f * 4 + 2] * p[2] - plane[f * 4 + 3];

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
    const faces = [seed];
    const verts = new Set<number>([tris[seed * 3], tris[seed * 3 + 1], tris[seed * 3 + 2]]);
    const queue = [...adj[seed]];
    const tried = new Set<number>();
    while (queue.length) {
      const g = queue.shift()!;
      if (owned[g] || tried.has(g)) continue;
      tried.add(g);
      const fresh = [0, 1, 2].map((k) => tris[g * 3 + k]).filter((v) => !verts.has(v));
      // Condizione necessaria: nessun vertice nuovo sopra le facce della toppa, nessun vertice della toppa sopra la nuova
      if (fresh.some((v) => faces.some((f) => above(f, pts[v]) > PLANE_EPS))) continue;
      let sticks = false;
      for (const v of verts) if (above(g, pts[v]) > PLANE_EPS) { sticks = true; break; }
      if (sticks) continue;

      // Controllo vero: l'inviluppo dei vertici deve stare dentro il solido
      const candidate = [...verts, ...fresh].map((v) => pts[v]);
      if (!insideSolid(Class, m, candidate, plane, seed)) continue;
      faces.push(g);
      owned[g] = 1;
      for (const v of fresh) verts.add(v);
      queue.push(...adj[g]);
    }
    patches.push([...verts].map((v) => pts[v]));
  }
  return patches;
}

/** Vero se l'inviluppo dei punti sta dentro `m` (una toppa piana si gonfia di `SLAB` verso l'interno prima del controllo). */
function insideSolid(Class: Wasm, m: Manifold, points: Vec3[], plane: Float64Array, seed: number): boolean {
  let hull = Class.hull(points);
  if (hull.isEmpty() || hull.volume() < 1e-9) {
    hull.delete();
    const n = [plane[seed * 4], plane[seed * 4 + 1], plane[seed * 4 + 2]];
    hull = Class.hull([...points, ...points.map((p): Vec3 => [p[0] - n[0] * SLAB, p[1] - n[1] * SLAB, p[2] - n[2] * SLAB])]);
  }
  const outside = hull.subtract(m);
  const ok = outside.volume() < Math.max(1e-7, 1e-6 * hull.volume());
  outside.delete();
  hull.delete();
  return ok;
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
