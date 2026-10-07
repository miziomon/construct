import { produce } from 'immer';
import { eulerToMatrix, matrixToEuler, round, toLocalTransform } from './math';
import { CORNER_SPHERE_SEGMENTS } from './defaults';
import { descendants, isLocked, newId, uniqueName, worldTransform } from './store';
import { extendOverFillets, matchEndVia } from './edgeEnds';
import { treatmentFrame, wrapInGroup } from './treatment';
import { chamferSecondDistance, EDGE_SEGMENTS, maxFilletRadius } from './edgeProfile';
import type { CornerNode, EdgeNode, EndPlane, Scene, Vec3 } from './types';

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
  /** Triangoli che toccano ogni vertice, costruiti alla prima richiesta. */
  vertexTriangles?: Map<number, number[]>;
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
  // PASSO 1: gli spigoli in comune. Si raccolgono quelli di A, poi quelli di B che compaiono anche in A (un lato di
  // triangolo è condiviso se i due triangoli usano gli stessi due indici di vertice)
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

  // PASSO 2: lo spigolo è la retta di intersezione dei due piani: tutti i tratti condivisi devono stare su di essa
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

  // PASSO 3: per ogni faccia, la direzione perpendicolare allo spigolo in cui si allarga, e quanto: la bisettrice
  // di queste due direzioni è l'asse X del taglierino, la minore delle due larghezze (`reach`) il limite delle misure
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

  // PASSO 4: convesso o concavo. Convesso: la faccia A sta dietro il piano di B (materiale dentro l'angolo). Concavo: davanti.
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

/** Triangoli che toccano un vertice (indice costruito una volta per mesh, come `facesAtVertex`). */
function trianglesAtVertex(mesh: MeshData, map: FaceMap, v: number): number[] {
  if (!map.vertexTriangles) {
    const byVertex = new Map<number, number[]>();
    for (let t = 0; t < map.triFace.length; t++) {
      for (let k = 0; k < 3; k++) {
        const i = mesh.indices[t * 3 + k];
        const list = byVertex.get(i);
        if (list) list.push(t);
        else byVertex.set(i, [t]);
      }
    }
    map.vertexTriangles = byVertex;
  }
  return map.vertexTriangles.get(v) ?? [];
}

/**
 * Vertice d'angolo (dove si incontrano tre o più facce) più vicino a `point`, tra quelli della faccia sotto il puntatore.
 * Restituisce l'indice del vertice, oppure -1 se la faccia non ha angoli (per esempio una faccia curva).
 */
export function cornerAt(mesh: MeshData, map: FaceMap, face: number, point: Vec3): number {
  let best = -1;
  let bestDistance = Infinity;
  for (const t of map.faces[face]?.triangles ?? []) {
    for (let k = 0; k < 3; k++) {
      const i = mesh.indices[t * 3 + k];
      if (facesAtVertex(mesh, map, i).length < 3) continue;
      const distance = len(sub(vertex(mesh, i), point));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
  }
  return best;
}

/** Posizione di un vertice della mesh (coordinate mondo). */
export const vertexPosition = (mesh: MeshData, v: number): Vec3 => vertex(mesh, v);

/** Angolo (vertice) di un pezzo con i suoi spigoli uscenti, in coordinate mondo. */
export interface CornerGeometry {
  vertex: Vec3;
  /** Versori degli spigoli che partono dal vertice. */
  directions: Vec3[];
  /** Lunghezza di ciascuno spigolo fino al vertice successivo della mesh. */
  lengths: number[];
}

export type CornerResult = { ok: true; geometry: CornerGeometry } | { ok: false; error: string };

/**
 * Spigoli vivi che partono dal vertice `v` e controllo che sia un angolo convesso di superfici piane.
 * Uno spigolo è vivo se i due triangoli che lo condividono stanno su facce diverse (le diagonali dentro una faccia no).
 */
export function cornerData(mesh: MeshData, map: FaceMap, v: number): CornerResult {
  const faces = facesAtVertex(mesh, map, v);
  if (faces.length < 3) return { ok: false, error: 'Qui non si incontrano tre superfici: scegli un angolo del pezzo.' };
  if (faces.some((f) => !map.faces[f].planar)) return { ok: false, error: "L'angolo ha superfici curve: lo smusso angolare funziona solo con superfici piane." };

  const origin = vertex(mesh, v);
  const triangles = trianglesAtVertex(mesh, map, v);
  // Per ogni vertice vicino, le facce dei triangoli che condividono lo spigolo (v, w)
  const neighbours = new Map<number, Set<number>>();
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const w = mesh.indices[t * 3 + k];
      if (w === v) continue;
      const set = neighbours.get(w) ?? new Set<number>();
      set.add(map.triFace[t]);
      neighbours.set(w, set);
    }
  }
  const directions: Vec3[] = [];
  const lengths: number[] = [];
  for (const [w, sides] of neighbours) {
    // Spigolo vivo: le due facce adiacenti sono diverse (una diagonale interna a una faccia ne ha una sola)
    if (sides.size < 2) continue;
    const edge = sub(vertex(mesh, w), origin);
    if (len(edge) < 1e-6) continue;
    directions.push(unit(edge));
    lengths.push(len(edge));
  }
  if (directions.length < 3) return { ok: false, error: 'Servono almeno tre spigoli che partono dal vertice.' };

  // Convesso: nessuno spigolo esce dal materiale oltre una faccia incidente (normale uscente · spigolo ≤ 0)
  for (const f of faces) {
    if (directions.some((u) => dot(map.faces[f].normal, u) > 1e-4)) return { ok: false, error: "L'angolo è concavo: lo smusso angolare funziona sugli angoli convessi." };
  }
  return { ok: true, geometry: { vertex: origin, directions, lengths } };
}

/** Misure dello smusso angolare, come nel pannello. */
export interface CornerParams {
  treatment: 'chamfer' | 'fillet';
  distance: number;
  segments?: number;
}

/** Valore iniziale ragionevole: piccolo rispetto allo spigolo più corto, 2 mm se c'è spazio. */
export function defaultCornerDistance(geometry: Pick<CornerGeometry, 'lengths'>): number {
  return round(Math.max(0.1, Math.min(2, Math.min(...geometry.lengths) * 0.4)), 2);
}

/** Misure del raccordo o dello smusso, come nel pannello. */
export interface EdgeParams {
  treatment: 'fillet' | 'chamfer';
  radius: number;
  distance1: number;
  distance2: number;
  /** Solo raccordo: segmenti del cerchio intero (come $fn); assente = 64. */
  segments?: number;
}

/** Valori iniziali ragionevoli per uno spigolo: piccoli rispetto alle facce, 2 mm se c'è spazio. */
export function defaultEdgeParams(treatment: 'fillet' | 'chamfer', geometry: Pick<EdgeGeometry, 'angle' | 'reach'>): EdgeParams {
  // Il raggio non può superare metà del massimo consentito dalla larghezza delle facce
  const limit = maxFilletRadius(geometry);
  const radius = Math.max(0.1, Math.min(2, limit * 0.5));
  const distance = Math.max(0.1, Math.min(2, geometry.reach * 0.5));
  return { treatment, radius: round(radius, 2), distance1: round(distance, 2), distance2: round(distance, 2), segments: EDGE_SEGMENTS };
}

/** Seconda distanza per le opzioni di smusso del pannello (equivale a `chamferSecondDistance`). */
export { chamferSecondDistance };

/**
 * Applica il raccordo o lo smusso alla scena: il pezzo viene sostituito da un gruppo Differenza (spigolo convesso) o
 * Unione (concavo) che contiene il pezzo e il taglierino. La geometria è in coordinate mondo e si porta nel sistema del
 * nuovo gruppo, che prende la posizione e la rotazione del pezzo. Restituisce la nuova scena senza toccare quella ricevuta.
 */
export function buildEdgeTreatment(
  scene: Scene,
  targetId: string,
  geometry: EdgeGeometry,
  params: EdgeParams,
): { ok: true; scene: Scene; groupId: string; edgeId: string; edgeIds: string[] } | { ok: false; error: string } {
  // 1) Controlli: il pezzo deve esistere, non essere bloccato e non essere un foro alla radice
  const target = scene.nodes[targetId];
  if (!target) return { ok: false, error: 'L\'oggetto non esiste più.' };
  if (isLocked(scene, targetId)) return { ok: false, error: 'L\'oggetto è bloccato: sbloccalo per modificarne gli spigoli.' };
  if (target.mode === 'hole' && scene.rootIds.includes(targetId)) return { ok: false, error: 'Un foro non si può raccordare.' };

  // Taglierini già presenti sul pezzo, con la loro trasformazione nel mondo
  const existing = [targetId, ...descendants(scene, targetId)].flatMap((id) => {
    const node = scene.nodes[id];
    return node?.type === 'edge' ? [{ edge: node, world: worldTransform(scene, id) }] : [];
  });

  // Se un'estremità finisce sulla linea di tangenza di un raccordo già presente, lo spigolo trovato è più corto del
  // vero: il taglierino prosegue fino all'angolo, come l'incontro di due cilindri (vedi edgeEnds.ts)
  const extended = extendOverFillets(geometry, existing.filter(({ edge }) => edge.treatment === 'fillet'));
  // Le estremità allungate sono perpendicolari (niente piano); i piani delle altre si misurano dall'origine, che si è spostata
  const moved = (end: EndPlane | null, extendedBy: number): EndPlane | null =>
    end && extendedBy === 0 ? { normal: end.normal, offset: round(end.offset + extended.before * end.normal[2], 9) } : null;
  geometry = { ...geometry, origin: extended.origin, length: extended.length, ends: [moved(geometry.ends[0], extended.before), moved(geometry.ends[1], extended.after)] };

  // 2) La geometria dello spigolo è in coordinate mondo: si porta nel sistema del NUOVO gruppo, che avrà la posizione e
  // la rotazione del pezzo (vedi treatment.ts): il taglierino diventa fratello del pezzo dentro quel gruppo
  const { groupWorld } = treatmentFrame(scene, targetId);
  const local = toLocalTransform(groupWorld, { position: geometry.origin, rotation: geometry.rotation });

  // Se un'estremità finisce sulla faccia di uno smusso già presente (due smussi che si incontrano in un angolo), si
  // ricorda quale: il piano di chiusura seguirà le misure di quello smusso se cambiano in seguito (vedi edgeEnds.ts)
  const endVia = matchEndVia(geometry.ends, { position: geometry.origin, rotation: geometry.rotation }, existing);

  // 3) Si crea il taglierino (nodo 'edge') e il gruppo che lo combina con il pezzo
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
      // Con il pezzo specchiato il gruppo porta lo specchio: il taglierino lo annulla, così resta dov'è nel mondo
      ...(local.mirror ? { mirror: local.mirror } : {}),
      mode: 'solid',
      color: target.color,
      treatment: params.treatment,
      convex: geometry.convex,
      angle: round(geometry.angle, 4),
      length: round(geometry.length, 4),
      radius: params.radius,
      // Lo smusso non ha cerchio: i segmenti si salvano solo per il raccordo
      ...(params.treatment === 'fillet' ? { segments: params.segments ?? EDGE_SEGMENTS } : {}),
      distance1: params.distance1,
      distance2: params.distance2,
      reach: round(geometry.reach, 4),
      ends: geometry.ends,
      // Solo se almeno un'estremità segue uno smusso (le scene senza angoli restano come prima)
      ...(endVia.some(Boolean) ? { endVia } : {}),
    };
    draft.nodes[edgeId] = edge;
    // Il gruppo prende il posto del pezzo (e la sua posizione). Spigolo convesso: DIFFERENZA, il taglierino toglie
    // materiale (il pezzo è il primo figlio, la base). Spigolo concavo: UNIONE, il taglierino aggiunge il materiale
    // che riempie l'angolo.
    wrapInGroup(draft, targetId, {
      id: groupId,
      name: uniqueName(draft, `${label}: ${target.name}`),
      mode: target.mode,
      color: target.color,
      op: geometry.convex ? 'difference' : 'union',
      children: [targetId, edgeId],
    });
  });
  return { ok: true, scene: next, groupId, edgeId, edgeIds: [edgeId] };
}


/**
 * Applica lo smusso angolare alla scena: il pezzo viene sostituito da un gruppo Differenza che contiene il pezzo e il
 * taglierino dell'angolo. Come per gli spigoli, il gruppo prende la posizione e la rotazione del pezzo e la geometria
 * (in coordinate mondo) si porta nel sistema del nuovo gruppo.
 */
export function buildCornerTreatment(
  scene: Scene,
  targetId: string,
  geometries: CornerGeometry | CornerGeometry[],
  params: CornerParams,
): { ok: true; scene: Scene; groupId: string; edgeId: string; edgeIds: string[] } | { ok: false; error: string } {
  // Più vertici dello stesso pezzo: un taglierino per vertice, tutti nello stesso gruppo e con le stesse misure
  const list = Array.isArray(geometries) ? geometries : [geometries];
  if (list.length === 0) return { ok: false, error: 'Scegli almeno un vertice.' };
  // 1) Controlli: il pezzo deve esistere, non essere bloccato e non essere un foro alla radice
  const target = scene.nodes[targetId];
  if (!target) return { ok: false, error: "L'oggetto non esiste più." };
  if (isLocked(scene, targetId)) return { ok: false, error: "L'oggetto è bloccato: sbloccalo per modificarne gli angoli." };
  if (target.mode === 'hole' && scene.rootIds.includes(targetId)) return { ok: false, error: 'Un foro non si può smussare.' };

  // 2) Il vertice e gli spigoli sono in coordinate mondo: si portano nel sistema del nuovo gruppo (posizione e rotazione
  // del pezzo). Il nodo sta nel vertice e senza rotazione, quindi le direzioni vanno ruotate nel sistema del gruppo
  const { groupWorld } = treatmentFrame(scene, targetId);
  const rotation = eulerToMatrix(groupWorld.rotation);
  // La trasposta di una rotazione è la sua inversa: da mondo a locale; poi lo specchio del gruppo (se c'è) rovescia gli assi
  const toLocal = (u: Vec3): Vec3 =>
    [0, 1, 2].map((i) => round((groupWorld.mirror?.[i] ? -1 : 1) * (rotation[0][i] * u[0] + rotation[1][i] * u[1] + rotation[2][i] * u[2]), 6)) as Vec3;

  // 3) Si crea il taglierino (nodo 'corner') e il gruppo Differenza che lo toglie dal pezzo
  const groupId = newId();
  const cornerIds = list.map(() => newId());
  const label = params.treatment === 'fillet' ? 'Raccordo angolare' : 'Smusso angolare';
  const next = produce(scene, (draft) => {
    list.forEach((geometry, i) => {
      // Del taglierino angolare serve solo la posizione: rotazione e specchio restano nulli e le direzioni sono già nel sistema del gruppo
      const local = toLocalTransform(groupWorld, { position: geometry.vertex, rotation: [0, 0, 0] });
      const corner: CornerNode = {
        id: cornerIds[i],
        type: 'corner',
        name: uniqueName(draft, label),
        position: local.position.map((v) => round(v, 4)) as Vec3,
        rotation: [0, 0, 0],
        mode: 'solid',
        color: target.color,
        treatment: params.treatment,
        directions: geometry.directions.map(toLocal),
        lengths: geometry.lengths.map((l) => round(l, 4)),
        distance: params.distance,
        ...(params.treatment === 'fillet' ? { segments: params.segments ?? CORNER_SPHERE_SEGMENTS } : {}),
      };
      draft.nodes[cornerIds[i]] = corner;
    });
    // Un solo gruppo Differenza: il pezzo è la base e tutti i taglierini sono sottratti
    wrapInGroup(draft, targetId, {
      id: groupId,
      name: uniqueName(draft, `${label}: ${target.name}`),
      mode: target.mode,
      color: target.color,
      op: 'difference',
      children: [targetId, ...cornerIds],
    });
  });
  return { ok: true, scene: next, groupId, edgeId: cornerIds[0], edgeIds: cornerIds };
}
