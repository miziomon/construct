import { apply, matrixToEuler, round, transpose } from './math';
import type { Mat3 } from './math';
import { rotationToDown } from './layFlat';
import { PATTERN_ALGORITHM, randomVoronoi } from './voronoi';
import type { Rect, Vec2 } from './voronoi';
import type { PatternFace, PatternParams, Vec3 } from './types';

/**
 * Applica pattern: calcoli puri condivisi da kernel, generatore OpenSCAD, pannello e test. Un pattern è un disegno 2D di
 * celle (Voronoi casuale con seme, esagoni, cerchi, rombi o triangoli) calcolato nel riferimento di una faccia del pezzo e
 * tagliato verso l'interno; con più facce ognuna ha il suo disegno.
 */

/** Celle massime per il Voronoi 2D e per le griglie (oltre il disegno non serve e il calcolo rallenta). */
export const PATTERN_MAX_CELLS = 500;

/** Direzione di una faccia dell'ingombro: asse e verso della normale uscente. */
export type FaceDirection = 'z+' | 'z-' | 'x+' | 'x-' | 'y+' | 'y-';

export const FACE_DIRECTIONS: FaceDirection[] = ['z+', 'z-', 'x+', 'x-', 'y+', 'y-'];

type Bounds = { min: Vec3; max: Vec3 };

const sizeOf = (b: Bounds): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];

/** La faccia dell'ingombro nella direzione data (al centro di quel lato), con lo spessore lungo l'asse. */
export function faceFromBounds(bounds: Bounds, direction: FaceDirection): PatternFace {
  const axis = 'xyz'.indexOf(direction[0]);
  const positive = direction[1] === '+';
  const origin: Vec3 = [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2) as Vec3;
  origin[axis] = positive ? bounds.max[axis] : bounds.min[axis];
  const normal: Vec3 = [0, 0, 0];
  normal[axis] = positive ? 1 : -1;
  return { origin: origin.map((v) => round(v, 3)) as Vec3, normal, thickness: round(sizeOf(bounds)[axis], 3) };
}

/** Lo spessore del pezzo lungo la normale di una faccia: la differenza tra gli estremi dell'ingombro proiettati sulla normale. */
export function thicknessAlong(bounds: Bounds, normal: Vec3): number {
  const projections = [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => normal[0] * bounds[a ? 'max' : 'min'][0] + normal[1] * bounds[b ? 'max' : 'min'][1] + normal[2] * bounds[c ? 'max' : 'min'][2])));
  return Math.max(...projections) - Math.min(...projections);
}

/** Riferimento di una faccia: la rotazione che porta la normale su +Z e il punto del piano che diventa l'origine. */
export interface FaceFrame {
  /** Rotazione Q: `x' = Q·(x − origin)`; il pezzo sta sotto il piano (z' ≤ 0). */
  matrix: Mat3;
  /** Angoli X, Y, Z di Q (gradi) e della sua inversa, per `rotate()` del kernel e di OpenSCAD. */
  euler: Vec3;
  inverseEuler: Vec3;
  origin: Vec3;
}

export function faceFrame(face: PatternFace): FaceFrame {
  const n = face.normal;
  // rotationToDown porta una normale su -Z: con la normale opposta si porta la faccia su +Z
  const matrix = rotationToDown([-n[0], -n[1], -n[2]]);
  const round4 = (v: Vec3) => v.map((x) => round(x, 4)) as Vec3;
  return { matrix, euler: round4(matrixToEuler(matrix)), inverseEuler: round4(matrixToEuler(transpose(matrix))), origin: face.origin };
}

/** Rettangolo (nel riferimento della faccia) che contiene tutto l'ingombro del pezzo: dove si generano le celle. */
export function frameRect(p: PatternParams, face: PatternFace = p.faces[0]): Rect {
  const frame = faceFrame(face);
  const corners = [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => [p.bounds[a ? 'max' : 'min'][0], p.bounds[b ? 'max' : 'min'][1], p.bounds[c ? 'max' : 'min'][2]] as Vec3)));
  // Si usa la stessa rotazione (con i soli angoli arrotondati) del kernel, così le celle coprono la stessa area
  const turned = corners.map((c) => apply(frame.matrix, [c[0] - frame.origin[0], c[1] - frame.origin[1], c[2] - frame.origin[2]]));
  const xs = turned.map((t) => t[0]);
  const ys = turned.map((t) => t[1]);
  const pad = 1;
  return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
}

/** Lunghezza del prisma di un taglio passante: molto più del pezzo, per bucarlo comunque lo si orienti. */
export function cutReach(p: PatternParams, face: PatternFace = p.faces[0]): number {
  return 2 * (Math.hypot(p.bounds.max[0] - p.bounds.min[0], p.bounds.max[1] - p.bounds.min[1], p.bounds.max[2] - p.bounds.min[2]) + face.thickness) + 20;
}

/** Parametri di partenza per un pezzo con questo ingombro: Voronoi di celle da circa 15 mm, passante, dal lato di +Z. */
export function defaultPatternParams(bounds: Bounds, seed: number): PatternParams {
  const size = sizeOf(bounds);
  const face = faceFromBounds(bounds, 'z+');
  const area = size[0] * size[1];
  const smallest = Math.min(size[0], size[1]);
  return {
    algorithm: PATTERN_ALGORITHM,
    kind: 'voronoi',
    mode: 'holes',
    seed,
    cells: Math.min(80, Math.max(8, Math.round(area / 225))),
    regularity: 40,
    size: 12,
    angle: 0,
    wall: 1.6,
    rounding: 1,
    // Cornice piena: circa un decimo del lato minore, tra 2 e 6 mm
    margin: Math.min(6, Math.max(2, round(smallest / 10, 1))),
    faces: [face],
    depth: 0,
    sides: 'one',
    bounds: { min: [...bounds.min], max: [...bounds.max] },
  };
}

/** Faccia con normale unitaria e spessore positivo. */
function normalizeFace(f: PatternFace): PatternFace {
  const n = f.normal;
  const length = Math.hypot(n[0], n[1], n[2]);
  const normal: Vec3 = length > 1e-9 ? [n[0] / length, n[1] / length, n[2] / length] : [0, 0, 1];
  return { origin: f.origin, normal, thickness: Math.max(0.1, Number.isFinite(f.thickness) ? f.thickness : 1) };
}

/** Due facce coincidono se hanno la stessa normale e lo stesso piano. */
export function sameFace(a: PatternFace, b: PatternFace): boolean {
  const na = normalizeFace(a).normal;
  const nb = normalizeFace(b).normal;
  const offset = (f: PatternFace, n: Vec3) => f.origin[0] * n[0] + f.origin[1] * n[1] + f.origin[2] * n[2];
  return [0, 1, 2].every((i) => Math.abs(na[i] - nb[i]) < 1e-3) && Math.abs(offset(a, na) - offset(b, nb)) < 1e-2;
}

/**
 * Parametri entro i limiti: conteggi interi e massimi, misure positive, facce con normale unitaria (senza doppioni).
 * Converte anche i progetti della 0.20.0: la `face` unica diventa `faces` e il reticolo 3D (tolto) diventa Voronoi.
 */
export function normalizePattern(p: PatternParams): PatternParams {
  const num = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  const int = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(num(v, min))));
  const { face: legacy, ...rest } = p;
  const given = p.faces?.length ? p.faces : legacy ? [legacy] : [faceFromBounds(p.bounds, 'z+')];
  const faces = given.map(normalizeFace).filter((f, i, all) => all.findIndex((o) => sameFace(o, f)) === i);
  const kind = (['voronoi', 'hexagon', 'circle', 'diamond', 'triangle'] as string[]).includes(p.kind) ? p.kind : 'voronoi';
  return {
    ...rest,
    kind,
    seed: int(p.seed, 0, 2 ** 31),
    cells: int(p.cells, 3, PATTERN_MAX_CELLS),
    regularity: Math.min(100, Math.max(0, num(p.regularity, 0))),
    size: Math.max(2, num(p.size, 12)),
    angle: num(p.angle, 0),
    wall: Math.max(0.1, num(p.wall, 1.6)),
    rounding: Math.max(0, num(p.rounding, 0)),
    margin: Math.max(0, num(p.margin, 0)),
    depth: Math.max(0, num(p.depth, 0)),
    faces,
  };
}

/** Numero massimo di celle a griglia: il passo si allarga se servirebbero di più. */
const MAX_GRID_CELLS = 1500;

/**
 * Celle di una griglia (esagoni, cerchi, rombi o triangoli) con il passo dato, ruotata di `angle` attorno al centro del
 * rettangolo, tenendo solo le celle che toccano il rettangolo. Le celle adiacenti si toccano: l'esagono ha lo spigolo
 * piatto a `pitch / 2` dal centro, il cerchio ha raggio `pitch / 2`, il rombo ha le diagonali lunghe `pitch`, il triangolo
 * equilatero ha il lato lungo `pitch` (punta su e punta giù alternati).
 */
function gridCells(p: PatternParams, rect: Rect): Vec2[][] {
  const width = rect.maxX - rect.minX;
  const height = rect.maxY - rect.minY;
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  const half = Math.hypot(width, height) / 2;
  // Area di una cella in unità di pitch², per non superare MAX_GRID_CELLS
  const unitArea = p.kind === 'hexagon' ? Math.sqrt(3) / 2 : p.kind === 'circle' ? Math.sqrt(3) / 2 : p.kind === 'diamond' ? 0.5 : Math.sqrt(3) / 4;
  const pitch = Math.max(p.size, Math.sqrt((width * height * unitArea) / MAX_GRID_CELLS));
  const rad = (p.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const circle: Vec2[] = Array.from({ length: 32 }, (_, k) => [(pitch / 2) * Math.cos((k * 2 * Math.PI) / 32), (pitch / 2) * Math.sin((k * 2 * Math.PI) / 32)]);
  const radius = pitch / Math.sqrt(3);
  const hexagon: Vec2[] = Array.from({ length: 6 }, (_, k) => [radius * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), radius * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)]);
  const diamond: Vec2[] = [[pitch / 2, 0], [0, pitch / 2], [-pitch / 2, 0], [0, -pitch / 2]];
  // Triangolo con la base su y = 0 e la punta in alto; quello capovolto ha la base in alto
  const h = (pitch * Math.sqrt(3)) / 2;
  const up: Vec2[] = [[-pitch / 2, 0], [pitch / 2, 0], [0, h]];
  const down: Vec2[] = [[-pitch / 2, h], [0, 0], [pitch / 2, h]];

  /** Cella di una riga e di una colonna: posizione del centro (prima della rotazione) e poligono relativo. */
  const cellAt = (row: number, col: number): { x: number; y: number; shape: Vec2[] } => {
    if (p.kind === 'diamond') return { x: (col + (Math.abs(row) % 2) / 2) * pitch, y: (row * pitch) / 2, shape: diamond };
    if (p.kind === 'triangle') {
      const pointsUp = Math.abs(col + row) % 2 === 0;
      return { x: (col * pitch) / 2, y: row * h, shape: pointsUp ? up : down };
    }
    // Esagoni e cerchi: griglia esagonale, file sfalsate di mezzo passo
    return { x: (col + (Math.abs(row) % 2) / 2) * pitch, y: (row * pitch * Math.sqrt(3)) / 2, shape: p.kind === 'hexagon' ? hexagon : circle };
  };
  const rowStep = p.kind === 'diamond' ? pitch / 2 : p.kind === 'triangle' ? h : (pitch * Math.sqrt(3)) / 2;
  const colStep = p.kind === 'triangle' ? pitch / 2 : pitch;
  const cells: Vec2[][] = [];
  const rows = Math.ceil(half / rowStep) + 1;
  const cols = Math.ceil(half / colStep) + 1;
  for (let row = -rows; row <= rows; row++) {
    for (let col = -cols; col <= cols; col++) {
      const { x, y, shape } = cellAt(row, col);
      const center: Vec2 = [cx + x * cos - y * sin, cy + x * sin + y * cos];
      // Si tengono le celle il cui centro dista meno del passo dal rettangolo
      const dx = Math.max(rect.minX - center[0], 0, center[0] - rect.maxX);
      const dy = Math.max(rect.minY - center[1], 0, center[1] - rect.maxY);
      if (Math.hypot(dx, dy) > pitch) continue;
      // La cella ruota con la griglia
      cells.push(shape.map(([sx, sy]) => [round(center[0] + sx * cos - sy * sin, 4), round(center[1] + sx * sin + sy * cos, 4)] as Vec2));
    }
  }
  return cells;
}

/** Le celle del pattern per la faccia `faceIndex` (poligoni nel riferimento della faccia, prima della riduzione per la parete). */
export function patternCells(params: PatternParams, rect: Rect, faceIndex = 0): Vec2[][] {
  const p = normalizePattern(params);
  // Ogni faccia ha il suo disegno: il seme cambia con l'indice (la prima faccia usa il seme così com'è)
  if (p.kind === 'voronoi') return randomVoronoi(p.cells, rect, p.seed + faceIndex, p.regularity).map((cell) => cell.map(([x, y]) => [round(x, 4), round(y, 4)] as Vec2));
  return gridCells(p, rect);
}
