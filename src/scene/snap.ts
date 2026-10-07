import { faceMap } from './edgeTool';
import type { MeshData } from './edgeTool';
import type { Vec3 } from './types';

/**
 * Aggancio (snap) dei punti dello strumento Misura: dal punto colpito dal puntatore su un triangolo si sceglie il
 * punto notevole più vicino, in quest'ordine: vertice (angolo o intersezione di spigoli), punto medio di uno spigolo,
 * punto di uno spigolo e, se nulla è abbastanza vicino, il punto sulla superficie. Funzioni pure, senza stato.
 */

export type SnapKind = 'vertex' | 'midpoint' | 'edge' | 'face';

export interface Snap {
  point: Vec3;
  kind: SnapKind;
}

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const vertexAt = (mesh: MeshData, i: number): Vec3 => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];

/** Triangoli che condividono ogni spigolo (chiave = indice minore × numero di vertici + indice maggiore). Calcolata una volta per mesh. */
const edgeMaps = new WeakMap<MeshData, Map<number, number[]>>();

function edgeKey(mesh: MeshData, i: number, j: number): number {
  return Math.min(i, j) * (mesh.positions.length / 3) + Math.max(i, j);
}

function trianglesOnEdges(mesh: MeshData): Map<number, number[]> {
  const cached = edgeMaps.get(mesh);
  if (cached) return cached;
  const map = new Map<number, number[]>();
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(mesh, mesh.indices[t * 3 + k], mesh.indices[t * 3 + ((k + 1) % 3)]);
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
  }
  edgeMaps.set(mesh, map);
  return map;
}

/** Punto della retta (a, b) più vicino a `p`, limitato al segmento. */
function closestOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

/**
 * Punto da misurare per un clic su `triangle` nel punto `hit`. `tolerance` (mm) è la distanza entro cui si aggancia a
 * un vertice o a uno spigolo: chi chiama la ricava dalla distanza della camera, così a schermo vale circa lo stesso
 * numero di pixel qualunque sia lo zoom.
 *
 * Gli spigoli "veri" sono quelli tra due facce diverse (o sul bordo della mesh): la diagonale che divide in due
 * triangoli una faccia piana non è uno spigolo e non si aggancia.
 */
export function snapToMesh(mesh: MeshData, triangle: number, hit: Vec3, tolerance: number): Snap {
  const faces = faceMap(mesh);
  const edges = trianglesOnEdges(mesh);
  const ids = [0, 1, 2].map((k) => mesh.indices[triangle * 3 + k]);
  const corners = ids.map((i) => vertexAt(mesh, i));

  // Spigolo k congiunge il vertice k e il vertice k + 1 del triangolo
  const real = [0, 1, 2].map((k) => {
    const others = (edges.get(edgeKey(mesh, ids[k], ids[(k + 1) % 3])) ?? []).filter((t) => t !== triangle);
    // Vero se nessun altro triangolo sullo spigolo appartiene alla stessa faccia piana
    return !others.some((t) => faces.triFace[t] === faces.triFace[triangle]);
  });

  // 1) Vertice: il più vicino tra quelli che toccano almeno uno spigolo vero
  let best: Snap | null = null;
  let bestDist = tolerance;
  for (let k = 0; k < 3; k++) {
    if (!real[k] && !real[(k + 2) % 3]) continue;
    const d = dist(corners[k], hit);
    if (d <= bestDist) {
      best = { point: corners[k], kind: 'vertex' };
      bestDist = d;
    }
  }
  if (best) return best;

  // 2) Punto medio di uno spigolo vero
  for (let k = 0; k < 3; k++) {
    if (!real[k]) continue;
    const a = corners[k];
    const b = corners[(k + 1) % 3];
    const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const d = dist(mid, hit);
    if (d <= bestDist) {
      best = { point: mid, kind: 'midpoint' };
      bestDist = d;
    }
  }
  if (best) return best;

  // 3) Punto più vicino su uno spigolo vero
  for (let k = 0; k < 3; k++) {
    if (!real[k]) continue;
    const onEdge = closestOnSegment(corners[k], corners[(k + 1) % 3], hit);
    const d = dist(onEdge, hit);
    if (d <= bestDist) {
      best = { point: onEdge, kind: 'edge' };
      bestDist = d;
    }
  }
  // 4) Nulla di vicino: il punto sulla superficie, così si misura anche da una faccia a un'altra
  return best ?? { point: hit, kind: 'face' };
}

/** Distanza e componenti tra due punti, in mm. */
export function measure(a: Vec3, b: Vec3): { distance: number; delta: Vec3 } {
  const delta = sub(b, a);
  return { distance: Math.hypot(delta[0], delta[1], delta[2]), delta };
}
