import { produce } from 'immer';
import { matrixToEuler, round, toLocalTransform } from './math';
import { isLocked, newId, parentOf, uniqueName, worldTransform } from './store';
import { chamferSecondDistance, maxFilletRadius } from './edgeProfile';
import type { EdgeNode, EndPlane, GroupNode, Scene, Vec3 } from './types';

/**
 * Raccordo e smusso tra due superfici piane: dalla mesh calcolata (in coordinate mondo) si ricavano le facce,
 * lo spigolo che le unisce e il "taglierino" che lo arrotonda o lo smussa. Funzioni pure, senza stato.
 */

/** Dati minimi di una mesh: coincidono con i campi di `NodeMesh`. */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Una superficie piana della mesh: triangoli complanari e collegati tra loro. */
export interface Face {
  triangles: number[];
  /** Normale uscente dal solido (dal verso dei triangoli). */
  normal: Vec3;
  /** Posizione del piano: normale · p = offset. */
  offset: number;
  /** Falso se i triangoli raggruppati non stanno davvero su un piano (non si può raccordare). */
  planar: boolean;
}

export interface FaceMap {
  /** Faccia di ogni triangolo (-1 per i triangoli degeneri). */
  triFace: Int32Array;
  faces: Face[];
  /** Facce che toccano ogni vertice, costruite alla prima richiesta. */
  vertexFaces?: Map<number, number[]>;
}

// Due triangoli adiacenti sono complanari se le normali coincidono (circa 0,26°) e i piani distano meno di 2 µm.
// Le sfaccettature di una superficie curva hanno un angolo maggiore: restano facce separate.
const COPLANAR_COS = 1 - 1e-5;
const COPLANAR_OFFSET = 2e-3;
/** Scarto massimo dei vertici di una faccia dal suo piano (mm). */
const PLANAR_TOLERANCE = 0.05;
/** Scarto massimo (mm) dei vertici di uno spigolo dalla retta comune. */
const LINE_TOLERANCE = 5e-3;

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: readonly number[], k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a: readonly number[]): Vec3 => scale(a, 1 / (len(a) || 1));

const vertex = (mesh: MeshData, i: number): Vec3 => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];

const maps = new WeakMap<MeshData, FaceMap>();

/** Raggruppa i triangoli in facce piane (riempimento per spigoli condivisi tra triangoli complanari). Calcolata una volta per mesh. */
export function faceMap(mesh: MeshData): FaceMap {
  const cached = maps.get(mesh);
  if (cached) return cached;

  const triangleCount = mesh.indices.length / 3;
  const vertexCount = mesh.positions.length / 3;
  const normals = new Float32Array(triangleCount * 3);
  const offsets = new Float32Array(triangleCount);
  const valid = new Uint8Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [vertex(mesh, mesh.indices[t * 3]), vertex(mesh, mesh.indices[t * 3 + 1]), vertex(mesh, mesh.indices[t * 3 + 2])];
    const n = cross(sub(b, a), sub(c, a));
    const l = len(n);
    if (l < 1e-12) continue;
    valid[t] = 1;
    normals.set([n[0] / l, n[1] / l, n[2] / l], t * 3);
    offsets[t] = (n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) / l;
  }

  // Unione di triangoli complanari che condividono uno spigolo
  const parent = new Int32Array(triangleCount).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const coplanar = (s: number, t: number) =>
    valid[s] === 1 &&
    valid[t] === 1 &&
    normals[s * 3] * normals[t * 3] + normals[s * 3 + 1] * normals[t * 3 + 1] + normals[s * 3 + 2] * normals[t * 3 + 2] > COPLANAR_COS &&
    Math.abs(offsets[s] - offsets[t]) < COPLANAR_OFFSET;
  const firstOnEdge = new Map<number, number>();
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const i = mesh.indices[t * 3 + k];
      const j = mesh.indices[t * 3 + ((k + 1) % 3)];
      const key = Math.min(i, j) * vertexCount + Math.max(i, j);
      const other = firstOnEdge.get(key);
      if (other === undefined) firstOnEdge.set(key, t);
      else if (coplanar(other, t)) parent[find(t)] = find(other);
    }
  }

  const triFace = new Int32Array(triangleCount).fill(-1);
  const faceOfRoot = new Map<number, number>();
  const faces: Face[] = [];
  for (let t = 0; t < triangleCount; t++) {
    if (!valid[t]) continue;
    const root = find(t);
    let id = faceOfRoot.get(root);
    if (id === undefined) {
      id = faces.length;
      faceOfRoot.set(root, id);
      faces.push({ triangles: [], normal: [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]], offset: offsets[t], planar: true });
    }
    faces[id].triangles.push(t);
    triFace[t] = id;
  }
  // Un riempimento a catena potrebbe accumulare piccole deviazioni: se i vertici si allontanano dal piano non è piana
  for (const face of faces) {
    for (const t of face.triangles) {
      for (let k = 0; k < 3; k++) {
        if (Math.abs(dot(face.normal, vertex(mesh, mesh.indices[t * 3 + k])) - face.offset) > PLANAR_TOLERANCE) face.planar = false;
      }
    }
  }

  const map: FaceMap = { triFace, faces };
  maps.set(mesh, map);
  return map;
}

/** Triangoli di una faccia come elenco di coordinate xyz (per evidenziarla nella vista 3D). */
export function faceTriangles(mesh: MeshData, map: FaceMap, face: number): Float32Array {
  const triangles = map.faces[face].triangles;
  const out = new Float32Array(triangles.length * 9);
  triangles.forEach((t, n) => {
    for (let k = 0; k < 3; k++) out.set(vertex(mesh, mesh.indices[t * 3 + k]), n * 9 + k * 3);
  });
  return out;
}

function facesAtVertex(mesh: MeshData, map: FaceMap, v: number): number[] {
  if (!map.vertexFaces) {
    const byVertex = new Map<number, number[]>();
    for (let t = 0; t < map.triFace.length; t++) {
      const face = map.triFace[t];
      if (face < 0) continue;
      for (let k = 0; k < 3; k++) {
        const list = byVertex.get(mesh.indices[t * 3 + k]);
        if (!list) byVertex.set(mesh.indices[t * 3 + k], [face]);
        else if (!list.includes(face)) list.push(face);
      }
    }
    map.vertexFaces = byVertex;
  }
  return map.vertexFaces.get(v) ?? [];
}

/** Spigolo tra due facce, con tutto quello che serve per costruire il taglierino (coordinate mondo). */
export interface EdgeGeometry {
  /** Estremo iniziale dello spigolo: origine del taglierino. */
  origin: Vec3;
  /** Rotazione (gradi) del taglierino: X verso l'interno dell'angolo, Z lungo lo spigolo. */
  rotation: Vec3;
  length: number;
  convex: boolean;
  /** Apertura tra le due facce in gradi. */
  angle: number;
  /** Larghezza minima delle due facce, perpendicolare allo spigolo. */
  reach: number;
  ends: [EndPlane | null, EndPlane | null];
}

export type EdgeResult = { ok: true; geometry: EdgeGeometry } | { ok: false; error: string };

const fail = (error: string): EdgeResult => ({ ok: false, error });

/** Chiave di uno spigolo non orientato. */
const edgeKey = (i: number, j: number, vertexCount: number) => Math.min(i, j) * vertexCount + Math.max(i, j);

/** Facce, spigolo e orientamento: errori con un messaggio già pronto per l'utente. */
export function edgeBetween(mesh: MeshData, map: FaceMap, faceA: number, faceB: number): EdgeResult {
  const A = map.faces[faceA];
  const B = map.faces[faceB];
  if (!A || !B || faceA === faceB) return fail('Scegli due superfici diverse.');
  if (!A.planar || !B.planar) return fail('Le superfici devono essere piane: i raccordi su superfici curve non sono ancora supportati.');
  const parallel = Math.abs(dot(A.normal, B.normal));
  if (parallel > 1 - 1e-6) return fail('Le due superfici sono parallele: non hanno uno spigolo in comune.');

  const vertexCount = mesh.positions.length / 3;
  // Spigoli di A, poi quelli di B che compaiono anche in A
  const edgesOfA = new Set<number>();
  for (const t of A.triangles) {
    for (let k = 0; k < 3; k++) edgesOfA.add(edgeKey(mesh.indices[t * 3 + k], mesh.indices[t * 3 + ((k + 1) % 3)], vertexCount));
  }
  const shared: [number, number][] = [];
  const seen = new Set<number>();
  for (const t of B.triangles) {
    for (let k = 0; k < 3; k++) {
      const i = mesh.indices[t * 3 + k];
      const j = mesh.indices[t * 3 + ((k + 1) % 3)];
      const key = edgeKey(i, j, vertexCount);
      if (edgesOfA.has(key) && !seen.has(key)) {
        seen.add(key);
        shared.push([i, j]);
      }
    }
  }
  if (!shared.length) return fail('Le due superfici non sono adiacenti: scegli due superfici che si incontrano in uno spigolo.');

  // Lo spigolo è la retta di intersezione dei due piani: tutti i tratti condivisi devono stare su di essa
  let e = unit(cross(A.normal, B.normal));
  const p0 = vertex(mesh, shared[0][0]);
  const intervals: { lo: number; hi: number; vLo: number; vHi: number }[] = [];
  for (const [i, j] of shared) {
    const [va, vb] = [vertex(mesh, i), vertex(mesh, j)];
    for (const v of [va, vb]) {
      const rel = sub(v, p0);
      if (len(sub(rel, scale(e, dot(e, rel)))) > LINE_TOLERANCE) return fail('Lo spigolo tra le due superfici non è rettilineo: servono più raccordi, uno per ogni spigolo.');
    }
    const [ta, tb] = [dot(e, sub(va, p0)), dot(e, sub(vb, p0))];
    intervals.push(ta <= tb ? { lo: ta, hi: tb, vLo: i, vHi: j } : { lo: tb, hi: ta, vLo: j, vHi: i });
  }
  intervals.sort((x, y) => x.lo - y.lo);
  let merged = intervals[0];
  for (const next of intervals.slice(1)) {
    if (next.lo > merged.hi + 1e-3) return fail('Le due superfici si toccano in più tratti separati: scegli uno spigolo continuo.');
    if (next.hi > merged.hi) merged = { ...merged, hi: next.hi, vHi: next.vHi };
  }
  const length = merged.hi - merged.lo;
  if (length < 1e-3) return fail('Lo spigolo è troppo corto.');

  // Per ogni faccia: la direzione, perpendicolare allo spigolo, in cui si allarga, e quanto
  const spread = (face: Face) => {
    let width = 0;
    let direction: Vec3 = [0, 0, 0];
    let farthest: Vec3 = p0;
    for (const t of face.triangles) {
      for (let k = 0; k < 3; k++) {
        const v = vertex(mesh, mesh.indices[t * 3 + k]);
        const rel = sub(v, p0);
        const perp = sub(rel, scale(e, dot(e, rel)));
        const d = len(perp);
        if (d > width) {
          width = d;
          direction = perp;
          farthest = v;
        }
      }
    }
    return { width, direction: unit(direction), farthest };
  };
  const sa = spread(A);
  const sb = spread(B);
  if (sa.width < 1e-3 || sb.width < 1e-3) return fail('Le superfici sono troppo strette per un raccordo.');

  const bisector = add(sa.direction, sb.direction);
  if (len(bisector) < 1e-6) return fail('Le due superfici sono praticamente sullo stesso piano.');
  const angle = (Math.acos(Math.max(-1, Math.min(1, dot(sa.direction, sb.direction)))) * 180) / Math.PI;
  if (angle > 179.5 || angle < 0.5) return fail('L\'angolo tra le due superfici è troppo aperto o troppo chiuso per un raccordo.');

  // Convesso: la faccia A sta dietro il piano di B. Concavo: davanti.
  const side = dot(B.normal, sub(sa.farthest, p0));
  if (Math.abs(side) < 1e-6) return fail('Le due superfici sono praticamente sullo stesso piano.');
  const convex = side < 0;

  // Base del taglierino: X verso l'interno dell'angolo, Z lungo lo spigolo, con la prima faccia dal lato negativo di Y
  const x = unit(bisector);
  let flipped = false;
  if (dot(sa.direction, cross(e, x)) > 0) {
    e = scale(e, -1);
    flipped = true;
  }
  const z = e;
  const y = cross(z, x);
  const startVertex = flipped ? merged.vHi : merged.vLo;
  const endVertex = flipped ? merged.vLo : merged.vHi;
  const origin = vertex(mesh, startVertex);

  // Estremità: la faccia che chiude lo spigolo, se è obliqua si ritaglia con il suo piano
  const endPlane = (v: number, sign: 1 | -1): EndPlane | null => {
    let best: Face | null = null;
    let bestAlong = 0.05;
    for (const f of facesAtVertex(mesh, map, v)) {
      if (f === faceA || f === faceB) continue;
      const face = map.faces[f];
      const along = dot(face.normal, z) * sign;
      if (face.planar && along > bestAlong) {
        best = face;
        bestAlong = along;
      }
    }
    if (!best || bestAlong > 1 - 1e-6) return null;
    return {
      normal: [dot(best.normal, x), dot(best.normal, y), dot(best.normal, z)].map((c) => round(c, 9)) as Vec3,
      offset: round(dot(best.normal, sub(vertex(mesh, v), origin)), 9),
    };
  };

  return {
    ok: true,
    geometry: {
      origin,
      rotation: matrixToEuler([[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]]),
      length,
      convex,
      angle,
      reach: Math.min(sa.width, sb.width),
      ends: [endPlane(startVertex, -1), endPlane(endVertex, 1)],
    },
  };
}

/** Misure del raccordo o dello smusso, come nel pannello. */
export interface EdgeParams {
  treatment: 'fillet' | 'chamfer';
  radius: number;
  distance1: number;
  distance2: number;
}

/** Valori iniziali ragionevoli per uno spigolo: piccoli rispetto alle facce, 2 mm se c'è spazio. */
export function defaultEdgeParams(treatment: 'fillet' | 'chamfer', geometry: Pick<EdgeGeometry, 'angle' | 'reach'>): EdgeParams {
  const limit = maxFilletRadius(geometry);
  const radius = Math.max(0.1, Math.min(2, limit * 0.5));
  const distance = Math.max(0.1, Math.min(2, geometry.reach * 0.5));
  return { treatment, radius: round(radius, 2), distance1: round(distance, 2), distance2: round(distance, 2) };
}

/** Seconda distanza per le opzioni di smusso del pannello (equivale a `chamferSecondDistance`). */
export { chamferSecondDistance };

/**
 * Applica il raccordo o lo smusso alla scena: il pezzo viene sostituito da un gruppo Differenza (spigolo convesso) o
 * Unione (concavo) che contiene il pezzo e il taglierino. La geometria è in coordinate mondo e si porta nel sistema del
 * genitore del pezzo. Restituisce la nuova scena senza toccare quella ricevuta.
 */
export function buildEdgeTreatment(
  scene: Scene,
  targetId: string,
  geometry: EdgeGeometry,
  params: EdgeParams,
): { ok: true; scene: Scene; groupId: string; edgeId: string } | { ok: false; error: string } {
  const target = scene.nodes[targetId];
  if (!target) return { ok: false, error: 'L\'oggetto non esiste più.' };
  if (isLocked(scene, targetId)) return { ok: false, error: 'L\'oggetto è bloccato: sbloccalo per modificarne gli spigoli.' };
  if (target.mode === 'hole' && scene.rootIds.includes(targetId)) return { ok: false, error: 'Un foro non si può raccordare.' };

  const parentId = parentOf(scene, targetId) ?? null;
  const parentWorld = parentId ? worldTransform(scene, parentId) : { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };
  const local = toLocalTransform(parentWorld, { position: geometry.origin, rotation: geometry.rotation });

  const groupId = newId();
  const edgeId = newId();
  const label = params.treatment === 'fillet' ? 'Raccordo' : 'Smusso';
  const next = produce(scene, (draft) => {
    const edge: EdgeNode = {
      id: edgeId,
      type: 'edge',
      name: uniqueName(draft, label),
      position: local.position.map((v) => round(v, 4)) as Vec3,
      rotation: local.rotation.map((v) => round(v, 4)) as Vec3,
      mode: 'solid',
      color: target.color,
      treatment: params.treatment,
      convex: geometry.convex,
      angle: round(geometry.angle, 4),
      length: round(geometry.length, 4),
      radius: params.radius,
      distance1: params.distance1,
      distance2: params.distance2,
      reach: round(geometry.reach, 4),
      ends: geometry.ends,
    };
    const group: GroupNode = {
      id: groupId,
      type: 'group',
      name: uniqueName(draft, `${label}: ${target.name}`),
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      mode: target.mode,
      color: target.color,
      op: geometry.convex ? 'difference' : 'union',
      children: [targetId, edgeId],
    };
    draft.nodes[edgeId] = edge;
    draft.nodes[groupId] = group;
    // Il gruppo prende il posto del pezzo nel suo elenco (radice o gruppo)
    const siblings = parentId ? (draft.nodes[parentId] as GroupNode).children : draft.rootIds;
    siblings[siblings.indexOf(targetId)] = groupId;
  });
  return { ok: true, scene: next, groupId, edgeId };
}
