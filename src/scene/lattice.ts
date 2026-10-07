import { mulberry32 } from './voronoi';
import type { Vec3 } from './types';

/**
 * Voronoi 3D per il reticolo: celle poliedriche convesse ottenute ritagliando il parallelepipedo con i piani di
 * mezzeria dei punti vicini, e i loro spigoli (senza ripetizioni), che il kernel trasforma in puntoni cilindrici. Solo per
 * poche decine di celle: ogni spigolo diventa un solido e le celle crescono col cubo del volume. Funzioni pure.
 */

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

type Face = Vec3[];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** I sei lati di un parallelepipedo come poligoni. */
function boxFaces(b: Box3): Face[] {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  return [
    [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]],
    [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]],
    [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]],
  ];
}

/** Tiene del poligono la parte con `(p − mid)·dir ≤ 0` e restituisce anche i punti nuovi sul piano. */
function clipFace(face: Face, mid: Vec3, dir: Vec3): { kept: Face; onPlane: Vec3[] } {
  const side = (p: Vec3) => dot(sub(p, mid), dir);
  const kept: Face = [];
  const onPlane: Vec3[] = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 1e-9) {
      kept.push(a);
      if (Math.abs(sa) <= 1e-9) onPlane.push(a);
    }
    if ((sa < -1e-9 && sb > 1e-9) || (sa > 1e-9 && sb < -1e-9)) {
      const t = sa / (sa - sb);
      const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      kept.push(p);
      onPlane.push(p);
    }
  }
  return { kept, onPlane };
}

/** Ordina i punti di un poligono convesso piano attorno al loro centro, secondo la normale `n`. */
function orderAround(points: Vec3[], n: Vec3): Vec3[] {
  const c: Vec3 = [0, 1, 2].map((i) => points.reduce((s, p) => s + p[i], 0) / points.length) as Vec3;
  const u = sub(points[0], c);
  const v = cross(n, u);
  return [...points].sort((p, q) => Math.atan2(dot(sub(p, c), v), dot(sub(p, c), u)) - Math.atan2(dot(sub(q, c), v), dot(sub(q, c), u)));
}

/** Rimuove i punti quasi coincidenti di un elenco. */
function dedupe(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) if (!out.some((q) => Math.hypot(...sub(p, q)) < 1e-7)) out.push(p);
  return out;
}

/** Una cella di Voronoi 3D: le sue facce (poligoni convessi). Vuota se i piani la annullano. */
export function voronoiCell3d(points: Vec3[], index: number, box: Box3): Face[] {
  const p = points[index];
  let faces = boxFaces(box);
  const others = points
    .map((q, j) => ({ j, d2: dot(sub(q, p), sub(q, p)) }))
    .filter((o) => o.j !== index)
    .sort((a, b) => a.d2 - b.d2 || a.j - b.j);
  for (const { j } of others) {
    const q = points[j];
    const mid: Vec3 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    const dir = sub(q, p);
    const clipped: Face[] = [];
    const cap: Vec3[] = [];
    for (const f of faces) {
      const { kept, onPlane } = clipFace(f, mid, dir);
      if (kept.length >= 3) clipped.push(kept);
      cap.push(...onPlane);
    }
    const capPoints = dedupe(cap);
    if (capPoints.length >= 3) clipped.push(orderAround(capPoints, dir));
    faces = clipped;
    if (faces.length < 4) return [];
  }
  return faces;
}

/** Volume di una cella (somma dei tetraedri dal centro): serve ai test (le celle riempiono il parallelepipedo). */
export function cellVolume(faces: Face[], inside: Vec3): number {
  let v = 0;
  for (const f of faces) {
    for (let i = 1; i < f.length - 1; i++) v += Math.abs(dot(sub(f[0], inside), cross(sub(f[i], inside), sub(f[i + 1], inside)))) / 6;
  }
  return v;
}

/** Punti casuali nel parallelepipedo, con distanza minima desiderata (come in 2D, si accetta comunque il punto dopo 30 tentativi). */
export function randomPoints3d(count: number, box: Box3, seed: number, minDistance: number): Vec3[] {
  const random = mulberry32(seed);
  const points: Vec3[] = [];
  const min2 = minDistance * minDistance;
  for (let i = 0; i < count; i++) {
    let candidate: Vec3 = [0, 0, 0];
    for (let attempt = 0; attempt < 30; attempt++) {
      candidate = [0, 1, 2].map((a) => box.min[a] + random() * (box.max[a] - box.min[a])) as Vec3;
      if (min2 === 0 || points.every((q) => dot(sub(q, candidate), sub(q, candidate)) >= min2)) break;
    }
    points.push(candidate);
  }
  return points;
}

/**
 * Spigoli del Voronoi 3D di `count` punti casuali nel parallelepipedo: coppie di punti, senza ripetizioni, escluse quelle
 * che stanno sulla superficie del parallelepipedo (resta un reticolo interno, senza gabbia esterna).
 * `regularity` 0–100 % distanzia i punti (celle più uniformi).
 */
export function latticeEdges(count: number, box: Box3, seed: number, regularity: number): [Vec3, Vec3][] {
  const r = Math.min(100, Math.max(0, regularity)) / 100;
  const volume = (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) * (box.max[2] - box.min[2]);
  const points = randomPoints3d(count, box, seed, 0.7 * r * Math.cbrt(volume / Math.max(1, count)));
  const key = (p: Vec3) => p.map((v) => Math.round(v * 1e4)).join(',');
  const seen = new Map<string, [Vec3, Vec3]>();
  const onBoundary = (a: Vec3, b: Vec3) =>
    [0, 1, 2].some((axis) => [box.min[axis], box.max[axis]].some((wall) => Math.abs(a[axis] - wall) < 1e-6 && Math.abs(b[axis] - wall) < 1e-6));
  for (let i = 0; i < points.length; i++) {
    for (const face of voronoiCell3d(points, i, box)) {
      for (let k = 0; k < face.length; k++) {
        const a = face[k];
        const b = face[(k + 1) % face.length];
        if (onBoundary(a, b)) continue;
        const ka = key(a);
        const kb = key(b);
        if (ka === kb) continue;
        seen.set(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, [a, b]);
      }
    }
  }
  return [...seen.values()];
}
