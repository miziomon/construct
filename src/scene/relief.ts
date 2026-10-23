import { mulberry32, polygonCentroid, randomVoronoi } from './voronoi';
import type { Rect, Vec2 } from './voronoi';

/**
 * Texture in rilievo su una faccia piana (studio di fattibilità, non ancora collegato all'app): calcoli puri e
 * deterministici, nel riferimento della faccia (faccia su z = 0, pezzo sotto). A parità di seme e parametri la geometria è
 * sempre la stessa. Le funzioni "profondità" (`brickDepth`, `grainDepth`, `rustDepth`, `copperDepth`) restituiscono i mm
 * da togliere sotto la faccia (sempre >= 0); `studHeight` restituisce i mm di rilievo aggiunti sopra la faccia.
 */

export type ReliefKind = 'brick' | 'wood' | 'rust' | 'studs' | 'hammered';

/** Disegno di un rilievo nel Pattern: della muratura (Mattoni) o forma della borchia (Borchie). */
export type ReliefDesign = BrickDesign | StudShape | HammeredDesign | WoodDesign;

/** Disegno della muratura: mattoni sfalsati, spina di pesce (90°) o cesto. */
export type BrickDesign = 'running' | 'herringbone' | 'basket';

export const BRICK_DESIGNS: BrickDesign[] = ['running', 'herringbone', 'basket'];

/** Muro di mattoni: fughe incise (file sfalsate di mezzo mattone, spina di pesce o cesto). */
export interface BrickParams {
  kind: 'brick';
  /** Disegno (se manca vale 'running', i mattoni sfalsati). */
  design?: BrickDesign;
  /** Larghezza e altezza del mattone (mm), senza la fuga. */
  brickW: number;
  brickH: number;
  /** Spessore della fuga (mm) e sua profondità (mm). */
  mortar: number;
  depth: number;
}

/** Disegno del rame battuto: calotte su celle di Voronoi, faccette piane inclinate, file sfalsate di scaglie. */
export type HammeredDesign = 'dimples' | 'facets' | 'scales';

export const HAMMERED_DESIGNS: HammeredDesign[] = ['dimples', 'facets', 'scales'];

/** Disegno del legno: doghe affiancate, spina di pesce di listelli (parquet), tavola unica con nodi. */
export type WoodDesign = 'planks' | 'parquet' | 'single';

export const WOOD_DESIGNS: WoodDesign[] = ['planks', 'parquet', 'single'];

/** Tavole di legno: doghe lunghe con giunti sfalsati, fughe e venature. */
export interface WoodParams {
  kind: 'wood';
  /** Disegno (se manca vale 'planks', le doghe affiancate). */
  design?: WoodDesign;
  seed: number;
  /** Larghezza e lunghezza media della doga (mm). */
  plankW: number;
  plankL: number;
  /** Fuga tra le doghe (mm) e profondità (mm). */
  gap: number;
  gapDepth: number;
  /** Profondità massima delle venature (mm, frazioni di mm) e distanza media tra gli anelli (mm). */
  grainDepth: number;
  ringSpacing: number;
}

/** Lamiera o ferro arrugginito: superficie sempre ruvida e butterata. */
export interface RustParams {
  kind: 'rust';
  seed: number;
  /** Quanto tutta la faccia viene abbassata (mm): la ruvidità si somma attorno a questa quota. */
  baseDepth: number;
  /** Ampiezza del rumore frattale (mm, +/- attorno alla quota base). */
  roughness: number;
  /** Crateri (vaiolatura) ogni 100 mm² e profondità massima (mm) in più rispetto alla quota base. */
  craterDensity: number;
  craterDepth: number;
  /** Scaglie e pustole, 0-1: quota di superficie coperta da placche che restano alte. */
  flakes: number;
}

/** Forma di una borchia: cupola, cilindro smussato o piramide a base quadrata (lato = diametro). */
export type StudShape = 'dome' | 'chamfered' | 'pyramid';

export const STUD_SHAPES: StudShape[] = ['dome', 'chamfered', 'pyramid'];

/** Disposizione delle borchie: file allineate o file sfalsate di mezzo passo. */
export type StudLayout = 'square' | 'staggered';

export const STUD_LAYOUTS: StudLayout[] = ['square', 'staggered'];

/** Borchie: griglia di cupole, cilindri smussati o piramidi che si aggiungono alla faccia. */
export interface StudParams {
  kind: 'studs';
  /** Passo della griglia (mm), raggio alla base (mm, per la piramide metà lato), altezza (mm). */
  pitch: number;
  radius: number;
  height: number;
  shape: StudShape;
  /** Griglia (se manca vale 'square', come prima che esistesse la scelta). */
  layout?: StudLayout;
  /** Smusso del cilindro (mm). */
  chamfer: number;
}

/** Rame battuto: calotte concave sovrapposte ai centri di un Voronoi rilassato. */
export interface HammeredParams {
  kind: 'hammered';
  /** Disegno (se manca vale 'dimples', il martellato a calotte). */
  design?: HammeredDesign;
  seed: number;
  /** Diametro medio di una martellata (mm) e profondità media (mm). */
  size: number;
  depth: number;
  /** Variazione casuale di raggio e profondità, 0-1. */
  jitter: number;
  /** Regolarità del Voronoi (0-100): più alta = martellate più uniformi. */
  regularity: number;
}

export type ReliefParams = BrickParams | WoodParams | RustParams | StudParams | HammeredParams;

/** Vero per le texture additive (si uniscono al pezzo); le altre si tolgono. */
export const isAdditive = (p: ReliefParams): p is StudParams => p.kind === 'studs';

/** Parametri di partenza di ogni texture (misure pensate per una stampa FDM con ugello 0,4 mm e strato 0,2 mm). */
export function reliefDefaults(kind: ReliefKind): ReliefParams {
  switch (kind) {
    case 'brick':
      return { kind, design: 'running', brickW: 24, brickH: 8, mortar: 1.2, depth: 0.8 };
    case 'wood':
      return { kind, design: 'planks', seed: 1, plankW: 12, plankL: 60, gap: 0.8, gapDepth: 0.8, grainDepth: 0.25, ringSpacing: 3 };
    case 'rust':
      return { kind, seed: 1, baseDepth: 0.5, roughness: 0.35, craterDensity: 3, craterDepth: 0.5, flakes: 0.4 };
    case 'studs':
      return { kind, pitch: 12, radius: 2.5, height: 1.5, shape: 'dome', layout: 'square', chamfer: 0.5 };
    case 'hammered':
      return { kind, design: 'dimples', seed: 1, size: 8, depth: 0.5, jitter: 0.25, regularity: 60 };
  }
}

/** Nodi massimi di una mappa di altezze: oltre, il passo si allarga (a 0,3 mm sono circa 22 mila mm² di faccia). */
export const MAX_GRID_NODES = 250_000;

/**
 * Parametri entro i limiti, da applicare prima di ogni calcolo: valori non finiti sostituiti da quelli di partenza, misure
 * minime (passi, lunghezze e raggi almeno 1 mm o 2 mm, fughe almeno 0,2 mm, profondità almeno 0,05 mm) che evitano cicli che
 * non finiscono, densità, variazioni e scaglie nei loro intervalli, semi interi. I valori già validi non cambiano.
 */
export function normalizeRelief<T extends ReliefParams>(p: T): T {
  const base = reliefDefaults(p.kind) as unknown as Record<string, number | string>;
  const raw = p as unknown as Record<string, number | string>;
  // Numero finito dentro [min, max]; un valore non finito torna a quello di partenza
  const num = (key: string, min: number, max = Infinity) => {
    const v = typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? (raw[key] as number) : (base[key] as number);
    return Math.min(max, Math.max(min, v));
  };
  switch (p.kind) {
    case 'brick':
      return { ...p, design: BRICK_DESIGNS.includes(p.design as BrickDesign) ? p.design : 'running', brickW: num('brickW', 2), brickH: num('brickH', 2), mortar: num('mortar', 0.2), depth: num('depth', 0.05) };
    case 'wood':
      return { ...p, design: WOOD_DESIGNS.includes(p.design as WoodDesign) ? p.design : 'planks', seed: Math.round(num('seed', 0, 2 ** 31)), plankW: num('plankW', 2), plankL: num('plankL', 5), gap: num('gap', 0.2), gapDepth: num('gapDepth', 0.05), grainDepth: num('grainDepth', 0), ringSpacing: num('ringSpacing', 0.5) } as T;
    case 'rust':
      return { ...p, seed: Math.round(num('seed', 0, 2 ** 31)), baseDepth: num('baseDepth', 0.1), roughness: num('roughness', 0), craterDensity: num('craterDensity', 0, 20), craterDepth: num('craterDepth', 0), flakes: num('flakes', 0, 1) } as T;
    case 'studs':
      return { ...p, pitch: num('pitch', 2), radius: num('radius', 0.5), height: num('height', 0.2), chamfer: num('chamfer', 0), shape: STUD_SHAPES.includes(p.shape) ? p.shape : 'dome', layout: STUD_LAYOUTS.includes(p.layout as StudLayout) ? p.layout : 'square' } as T;
    case 'hammered':
      return { ...p, design: HAMMERED_DESIGNS.includes(p.design as HammeredDesign) ? p.design : 'dimples', seed: Math.round(num('seed', 0, 2 ** 31)), size: num('size', 2), depth: num('depth', 0.05), jitter: num('jitter', 0, 0.9), regularity: num('regularity', 0, 100) } as T;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rumore
// ---------------------------------------------------------------------------------------------------------------------

/** Hash intero di un punto del reticolo e di un seme: numero tra 0 (compreso) e 1 (escluso), senza tabelle né stato. */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, x: number) => smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));

/** Value noise 2D: interpolazione smussata dei valori casuali ai nodi interi. Risultato tra 0 e 1. */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Rumore frattale (fBm): somma di ottave di value noise a frequenza doppia e ampiezza dimezzata, normalizzata a 0-1. */
export function fbm(x: number, y: number, seed: number, octaves = 4, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    // Ogni ottava ha il suo seme e un piccolo scostamento, per non allineare i nodi delle ottave
    sum += amp * valueNoise(x * freq + o * 17.3, y * freq - o * 9.1, seed + o * 101);
    total += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / total;
}

// ---------------------------------------------------------------------------------------------------------------------
// Griglia di campioni (per le mappe di altezze)
// ---------------------------------------------------------------------------------------------------------------------

/** Griglia regolare di valori z = f(x, y) sul rettangolo: `nx` x `ny` nodi, passo reale `dx`, `dy` (<= passo richiesto). */
export interface HeightGrid {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  z: Float32Array;
}

/** Campiona `f` su una griglia di passo (al più) `step` che copre tutto il rettangolo; i valori sono arrotondati al centesimo di mm. */
export function sampleGrid(rect: Rect, requestedStep: number, f: (x: number, y: number) => number): HeightGrid {
  const width = rect.maxX - rect.minX;
  const height = rect.maxY - rect.minY;
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('Rettangolo vuoto o non finito');
  // Passo minimo 0,05 mm e al più MAX_GRID_NODES nodi: se servirebbero di più il passo si allarga
  const step = Math.max(Number.isFinite(requestedStep) ? requestedStep : 0.5, 0.05, Math.sqrt((width * height) / MAX_GRID_NODES));
  const nx = Math.max(2, Math.ceil(width / step) + 1);
  const ny = Math.max(2, Math.ceil(height / step) + 1);
  const dx = (rect.maxX - rect.minX) / (nx - 1);
  const dy = (rect.maxY - rect.minY) / (ny - 1);
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) z[j * nx + i] = Math.round(f(rect.minX + i * dx, rect.minY + j * dy) * 100) / 100;
  }
  return { nx, ny, x0: rect.minX, y0: rect.minY, dx, dy, z };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ricerca dei cerchi vicini (crateri, martellate): griglia di cassetti
// ---------------------------------------------------------------------------------------------------------------------

interface Disc {
  x: number;
  y: number;
  /** Raggio d'influenza (mm). */
  r: number;
}

/** Cassetti spaziali: `near(x, y)` restituisce i cerchi che potrebbero contenere il punto, senza scorrerli tutti. */
function binDiscs<T extends Disc>(items: T[], rect: Rect): (x: number, y: number, visit: (item: T) => void) => void {
  const size = Math.max(1, ...items.map((d) => d.r));
  const cols = Math.ceil((rect.maxX - rect.minX) / size) + 1;
  const rows = Math.ceil((rect.maxY - rect.minY) / size) + 1;
  const bins: T[][] = Array.from({ length: cols * rows }, () => []);
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - rect.minX) / size)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - rect.minY) / size)));
  // Ogni cerchio sta in tutti i cassetti che il suo raggio tocca
  for (const d of items) {
    for (let j = row(d.y - d.r); j <= row(d.y + d.r); j++) for (let i = col(d.x - d.r); i <= col(d.x + d.r); i++) bins[j * cols + i].push(d);
  }
  return (x, y, visit) => {
    // Fuori dal rettangolo non ci sono cerchi da visitare
    if (x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY) return;
    for (const d of bins[row(y) * cols + col(x)]) visit(d);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mattoni
// ---------------------------------------------------------------------------------------------------------------------

/** Rettangolo [x0, y0, x1, y1] di un mattone o di una doga (misure vere, fuga esclusa). */
export type Box = [number, number, number, number];

/** Passo orizzontale e verticale del muro: mattone più fuga. */
export const brickPitch = (p: BrickParams): Vec2 => [p.brickW + p.mortar, p.brickH + p.mortar];

/** Posizione x di inizio dei mattoni della fila `row`: le file dispari sono sfalsate di mezzo mattone. */
const brickRowStart = (rect: Rect, p: BrickParams, row: number) => rect.minX - (row % 2 === 0 ? 0 : brickPitch(p)[0] / 2);

/** Mattoni massimi su una faccia: oltre, le misure si allargano (come il tetto di celle del Voronoi). */
export const MAX_BRICKS = 4000;

/**
 * Spina di pesce e cesto: il mattone è un rettangolo lungo `n` volte il passo corto `u` (altezza più fuga). Il disegno si
 * chiude solo se `n` è intero, quindi la lunghezza si arrotonda al multiplo più vicino (almeno 2): con 24 x 8 e fuga 1,2
 * il mattone diventa 26,4 x 8. Il muro a mattoni sfalsati usa invece le misure così come sono.
 */
export function brickModule(p: BrickParams): { u: number; n: number } {
  const u = p.brickH + p.mortar;
  return { u, n: Math.max(2, Math.round((p.brickW + p.mortar) / u)) };
}

/** Area della cella (mattone più fuga) del disegno, per contare i mattoni di una faccia. */
const brickCellArea = (p: BrickParams) => {
  if (p.design === 'herringbone' || p.design === 'basket') {
    const { u, n } = brickModule(p);
    return n * u * u;
  }
  return (p.brickW + p.mortar) * (p.brickH + p.mortar);
};

/**
 * Parametri dei mattoni entro i limiti e, se sul rettangolo ne servirebbero più di MAX_BRICKS, con le misure (fuga esclusa)
 * ingrandite quanto basta: i valori normali non cambiano.
 */
export function fitBrick(rect: Rect, params: BrickParams): BrickParams & { design: BrickDesign } {
  const p = normalizeRelief(params) as BrickParams & { design: BrickDesign };
  const count = ((rect.maxX - rect.minX) * (rect.maxY - rect.minY)) / brickCellArea(p);
  if (!(count > MAX_BRICKS)) return p;
  const f = Math.sqrt(count / MAX_BRICKS);
  return { ...p, brickW: (p.brickW + p.mortar) * f - p.mortar, brickH: (p.brickH + p.mortar) * f - p.mortar };
}

/** Rettangolo della cella ridotto di mezza fuga per lato: il mattone vero. */
const shrinkCell = ([x0, y0, x1, y1]: Box, mortar: number): Box => [x0 + mortar / 2, y0 + mortar / 2, x1 - mortar / 2, y1 - mortar / 2];

/** Vero se la cella ha area in comune con il rettangolo (toccarsi sul bordo non conta). */
const touches = (rect: Rect, [x0, y0, x1, y1]: Box) => x0 < rect.maxX && x1 > rect.minX && y0 < rect.maxY && y1 > rect.minY;

/**
 * Celle (mattone più fuga) della spina di pesce a 90°: due mattoni per passo, uno orizzontale `[0, L] x [0, u]` e uno
 * verticale `[L, L + u] x [u - L, u]` accanto alla sua punta; la scala si ripete lungo la diagonale (u, u) e le scale vicine
 * sono spostate di (L + u, u - L). Si enumerano gli indici (a, b) delle due direzioni la cui origine può toccare il rettangolo.
 */
function herringboneCells(rect: Rect, u: number, n: number): Box[] {
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  const length = n * u;
  // Origini possibili di una coppia: in x da -(L + u) a w, in y da -u a h + L - u (rispetto all'angolo del rettangolo)
  const corners: Vec2[] = [[-(length + u), -u], [w, -u], [-(length + u), h + length - u], [w, h + length - u]];
  // Indici nella base (u, u), (L + u, u - L): b = (x - y) / (2 n u) e a = x / u - b (n + 1), lineari, quindi basta guardare gli angoli
  const bs = corners.map(([x, y]) => (x - y) / (2 * n * u));
  const as = corners.map(([x], k) => x / u - bs[k] * (n + 1));
  const cells: Box[] = [];
  for (let a = Math.floor(Math.min(...as)) - 1; a <= Math.ceil(Math.max(...as)) + 1; a++) {
    for (let b = Math.floor(Math.min(...bs)) - 1; b <= Math.ceil(Math.max(...bs)) + 1; b++) {
      const x = rect.minX + (a + b * (n + 1)) * u;
      const y = rect.minY + (a + b * (1 - n)) * u;
      for (const cell of [[x, y, x + length, y + u], [x + length, y + u - length, x + length + u, y + u]] as Box[]) if (touches(rect, cell)) cells.push(cell);
    }
  }
  return cells;
}

/** Celle del cesto: blocchi quadrati di lato `n u` con `n` mattoni affiancati, orizzontali e verticali a scacchiera. */
function basketCells(rect: Rect, u: number, n: number): Box[] {
  const side = n * u;
  const cells: Box[] = [];
  for (let j = 0; j < Math.ceil((rect.maxY - rect.minY) / side); j++) {
    for (let i = 0; i < Math.ceil((rect.maxX - rect.minX) / side); i++) {
      const x = rect.minX + i * side;
      const y = rect.minY + j * side;
      for (let k = 0; k < n; k++) {
        const cell: Box = (i + j) % 2 === 0 ? [x, y + k * u, x + side, y + (k + 1) * u] : [x + k * u, y, x + (k + 1) * u, y + side];
        // L'ultimo blocco di una riga o di una colonna può uscire dal rettangolo: si tengono solo i mattoni che lo toccano
        if (touches(rect, cell)) cells.push(cell);
      }
    }
  }
  return cells;
}

/** I mattoni che toccano il rettangolo (la fuga sta a cavallo dei bordi del passo, quindi il primo mattone parte a metà fuga). */
export function brickLayout(rect: Rect, params: BrickParams): Box[] {
  const p = fitBrick(rect, params);
  // Spina di pesce e cesto: celle a incastro, ridotte di mezza fuga
  if (p.design === 'herringbone' || p.design === 'basket') {
    const { u, n } = brickModule(p);
    return (p.design === 'herringbone' ? herringboneCells(rect, u, n) : basketCells(rect, u, n)).map((cell) => shrinkCell(cell, p.mortar));
  }
  const [px, py] = brickPitch(p);
  const boxes: Box[] = [];
  const rows = Math.ceil((rect.maxY - rect.minY) / py);
  for (let r = 0; r < rows; r++) {
    const y0 = rect.minY + r * py + p.mortar / 2;
    for (let x = brickRowStart(rect, p, r); x < rect.maxX; x += px) boxes.push([x + p.mortar / 2, y0, x + p.mortar / 2 + p.brickW, y0 + p.brickH]);
  }
  return boxes;
}

/** Cerca il rettangolo che contiene il punto (indice, -1 se nessuno) con cassetti spaziali (i mattoni sono migliaia: niente scansione di tutti). */
function boxIndex(boxes: Box[], rect: Rect): (x: number, y: number) => number {
  const size = boxes.reduce((m, b) => Math.max(m, b[2] - b[0], b[3] - b[1]), 1);
  const cols = Math.ceil((rect.maxX - rect.minX) / size) + 1;
  const rows = Math.ceil((rect.maxY - rect.minY) / size) + 1;
  const bins: number[][] = Array.from({ length: cols * rows }, () => []);
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - rect.minX) / size)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - rect.minY) / size)));
  // Ogni rettangolo sta in tutti i cassetti che tocca
  boxes.forEach((b, k) => {
    for (let j = row(b[1]); j <= row(b[3]); j++) for (let i = col(b[0]); i <= col(b[2]); i++) bins[j * cols + i].push(k);
  });
  return (x, y) => {
    if (x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY) return -1;
    return bins[row(y) * cols + col(x)].find((k) => x >= boxes[k][0] && x <= boxes[k][2] && y >= boxes[k][1] && y <= boxes[k][3]) ?? -1;
  };
}

/** Test "il punto sta dentro uno dei rettangoli" (vedi `boxIndex`). */
function boxLookup(boxes: Box[], rect: Rect): (x: number, y: number) => boolean {
  const index = boxIndex(boxes, rect);
  return (x, y) => index(x, y) >= 0;
}

/** Profondità delle fughe: `depth` dentro la fuga, 0 sul mattone (versione analitica o a cassetti, per la mappa di altezze). */
export function brickDepth(rect: Rect, params: BrickParams): (x: number, y: number) => number {
  const p = fitBrick(rect, params);
  // Spina di pesce e cesto: si cerca il mattone nei cassetti
  if (p.design !== 'running') {
    const inBrick = boxLookup(brickLayout(rect, p), rect);
    return (x, y) => (inBrick(x, y) ? 0 : p.depth);
  }
  const [px, py] = brickPitch(p);
  return (x, y) => {
    const row = Math.floor((y - rect.minY) / py);
    const ly = y - rect.minY - row * py;
    const lx = (((x - brickRowStart(rect, p, row)) % px) + px) % px;
    const inBrick = lx >= p.mortar / 2 && lx <= p.mortar / 2 + p.brickW && ly >= p.mortar / 2 && ly <= p.mortar / 2 + p.brickH;
    return inBrick ? 0 : p.depth;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Doghe di legno
// ---------------------------------------------------------------------------------------------------------------------

/** Una doga: rettangolo e numero progressivo (per la venatura, diversa da una doga all'altra). */
export interface Plank {
  box: Box;
  id: number;
}

/**
 * Le doghe: file lungo X di larghezza `plankW`, con fuga `gap` tra le file. Ogni fila parte da un punto diverso (il passo
 * aureo 0,382 della lunghezza, più un piccolo scarto casuale) e le doghe hanno lunghezza media `plankL` +/- 15 %, quindi i
 * giunti di file vicine non cadono mai allo stesso punto. Restituisce un elenco per fila.
 */
export function plankLayout(rect: Rect, params: WoodParams): Plank[][] {
  const p = normalizeRelief(params);
  const pitch = p.plankW + p.gap;
  const rows = Math.ceil((rect.maxY - rect.minY) / pitch);
  const out: Plank[][] = [];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    const random = mulberry32(p.seed * 7919 + r * 104729);
    const y0 = rect.minY + r * pitch + p.gap / 2;
    const row: Plank[] = [];
    // Primo giunto: scostamento della fila, sempre prima del bordo sinistro
    let x = rect.minX - (((r * 0.382 + random() * 0.1) % 1) * p.plankL + 1);
    while (x < rect.maxX) {
      const length = p.plankL * (1 + 0.15 * (random() * 2 - 1));
      row.push({ box: [x + p.gap / 2, y0, x + length - p.gap / 2, y0 + p.plankW], id: id++ });
      x += length;
    }
    out.push(row);
  }
  return out;
}

/**
 * Venatura (mm, 0 - `grainDepth`) di una doga o di un listello: anelli stirati lungo il lato lungo (`horizontal` se è X): la
 * fase dipende dalla distanza dal centro, deformata da un rumore lento lungo la doga (le curve degli anelli); sopra si somma
 * una fibra fine (rumore molto più lungo che largo). `id` rende diversa la venatura di ogni doga.
 */
function plankGrain(p: WoodParams, box: Box, id: number, x: number, y: number, horizontal: boolean): number {
  // Coordinate nella doga: u attraverso la larghezza dal centro, v lungo la doga
  const u = horizontal ? y - (box[1] + box[3]) / 2 : x - (box[0] + box[2]) / 2;
  const v = horizontal ? x - box[0] : y - box[1];
  const warp = fbm(v / 35, u / 5 + id * 17, p.seed, 3) - 0.5;
  const phase = u / p.ringSpacing + 3 * warp + valueNoise(id, 0, p.seed);
  // Anelli: creste strette (coseno alla terza) dove la fase è intera
  const ring = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * phase), 3);
  // Fibra fine: rumore lungo 25 mm e largo circa 0,4 mm
  const fiber = valueNoise(v / 25, u * 2.5, p.seed + id);
  return p.grainDepth * (0.7 * ring + 0.3 * fiber);
}

/** Rettangolo e numero progressivo di una doga o di un listello. */
export interface WoodBox {
  box: Box;
  id: number;
}

/**
 * I rettangoli delle doghe (design 'planks': file lungo X con giunti sfalsati), dei listelli (design 'parquet': spina di pesce a
 * 90° con la larghezza `plankW`, la lunghezza `plankL` arrotondata a un multiplo della larghezza e la fuga `gap`, come i
 * mattoni) oppure nessuno (design 'single': una tavola sola, senza fughe).
 */
export function woodBoxes(rect: Rect, params: WoodParams): WoodBox[] {
  const p = normalizeRelief(params);
  if (p.design === 'single') return [];
  if (p.design === 'parquet') {
    const strips = brickLayout(rect, { kind: 'brick', design: 'herringbone', brickW: p.plankL, brickH: p.plankW, mortar: p.gap, depth: p.gapDepth });
    return strips.map((box, id) => ({ box, id }));
  }
  return plankLayout(rect, p).flat();
}

/** Un nodo del legno: conca circolare di raggio `r` (mm) e profondità massima `depth` (mm) al centro. */
export interface Knot extends Disc {
  depth: number;
}

/** Nodi della tavola unica: da 2 a 4, in posizioni e con raggi (2 - 5 mm) dal seme, lontani dai bordi. */
export function knotList(rect: Rect, params: WoodParams): Knot[] {
  const p = normalizeRelief(params);
  const random = mulberry32(p.seed * 53 + 7);
  const count = 2 + Math.floor(random() * 3);
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  const knots: Knot[] = [];
  for (let i = 0; i < count; i++) {
    const x = rect.minX + (0.15 + 0.7 * random()) * w;
    const y = rect.minY + (0.15 + 0.7 * random()) * h;
    const r = 2 + 3 * random();
    knots.push({ x, y, r, depth: p.grainDepth * (1.5 + 0.5 * random()) });
  }
  return knots;
}

/** Quanto in basso arriva al massimo il legno (mm): la fuga o, nella tavola unica, il picco di un nodo (2 volte la venatura). */
export const woodMaxDepth = (params: WoodParams): number => {
  const p = normalizeRelief(params);
  return Math.max(p.gapDepth, 2 * p.grainDepth);
};

/**
 * Profondità della venatura (mm, 0 - `grainDepth`) sul legno; 0 nelle fughe. Doghe e listelli: la venatura di ogni pezzo (vedi
 * `plankGrain`). Tavola unica: una sola doga grande quanto il rettangolo, con in più i nodi (conche con anelli concentrici,
 * vale il più profondo tra venatura e nodo). Se `withGaps` anche le fughe valgono `gapDepth`.
 */
export function grainDepth(rect: Rect, params: WoodParams, withGaps = false): (x: number, y: number) => number {
  const p = normalizeRelief(params);
  if (p.design === 'single') {
    const whole: Box = [rect.minX, rect.minY, rect.maxX, rect.maxY];
    const knots = knotList(rect, p);
    const near = binDiscs(knots, rect);
    return (x, y) => {
      let depth = plankGrain(p, whole, 0, x, y, true);
      near(x, y, (k) => {
        const dist = Math.hypot(x - k.x, y - k.y);
        if (dist >= k.r) return;
        // Conca liscia ai bordi (bowl) con anelli concentrici che ne modulano il fondo
        const bowl = (1 - (dist / k.r) ** 2) ** 2;
        depth = Math.max(depth, k.depth * bowl * (0.75 + 0.25 * Math.cos((2 * Math.PI * dist) / (0.5 * p.ringSpacing))));
      });
      return depth;
    };
  }
  if (p.design === 'parquet') {
    const list = woodBoxes(rect, p);
    const index = boxIndex(list.map((w) => w.box), rect);
    return (x, y) => {
      const k = index(x, y);
      if (k < 0) return withGaps ? p.gapDepth : 0;
      const { box, id } = list[k];
      return plankGrain(p, box, id, x, y, box[2] - box[0] >= box[3] - box[1]);
    };
  }
  const layout = plankLayout(rect, p);
  const pitch = p.plankW + p.gap;
  return (x, y) => {
    const r = Math.floor((y - rect.minY) / pitch);
    const plank = layout[r]?.find((pl) => x >= pl.box[0] && x <= pl.box[2]);
    if (!plank || y < plank.box[1] || y > plank.box[3]) return withGaps ? p.gapDepth : 0;
    return plankGrain(p, plank.box, plank.id, x, y, true);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ruggine
// ---------------------------------------------------------------------------------------------------------------------

/** Un cratere della vaiolatura. */
export interface Crater extends Disc {
  /** Profondità al centro (mm, oltre la quota base). */
  d: number;
}

/** Crateri sparsi: posizioni uniformi, raggio 0,6 - 2 mm (più spesso i piccoli) e profondità 40-100 % del massimo. */
export function craterList(rect: Rect, params: RustParams): Crater[] {
  const p = normalizeRelief(params);
  const area = (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
  const count = Math.min(2000, Math.round((p.craterDensity * area) / 100));
  const random = mulberry32(p.seed * 31 + 5);
  const craters: Crater[] = [];
  for (let i = 0; i < count; i++) {
    const x = rect.minX + random() * (rect.maxX - rect.minX);
    const y = rect.minY + random() * (rect.maxY - rect.minY);
    const r = 0.6 + 1.4 * random() ** 1.5;
    craters.push({ x, y, r, d: p.craterDepth * (0.4 + 0.6 * random()) });
  }
  return craters;
}

/**
 * Profondità massima possibile della ruggine (mm): quota base, fBm fino a `roughness`, grana fine fino a 0,4 volte la
 * ruvidità e cratere più profondo. Serve al kernel per dimensionare il prisma di ritaglio, che non deve appiattire il fondo
 * della superficie (con ruvidità alta la grana da sola supera il margine di 1 mm).
 */
export function rustMaxDepth(params: RustParams): number {
  const p = normalizeRelief(params);
  return p.baseDepth + 1.4 * p.roughness + p.craterDepth;
}

/** Profondità di un cratere a distanza `dist` dal centro: conca liscia con bordo a pendenza nulla. */
const craterProfile = (c: Crater, dist: number) => (dist >= c.r ? 0 : c.d * (1 - (dist / c.r) ** 2) ** 2);

/**
 * Profondità della ruggine (mm, sempre almeno 0,05): quota base + rumore frattale (ruvidità) + crateri, diminuita di una quota fissa dove ci
 * sono scaglie/pustole (placche che restano alte). Tutta la faccia sta quindi circa `baseDepth` sotto il piano originale.
 */
export function rustDepth(rect: Rect, params: RustParams): (x: number, y: number) => number {
  const p = normalizeRelief(params);
  const near = binDiscs(craterList(rect, p), rect);
  return (x, y) => {
    // Ruvidità: fBm di 4 ottave da 0,3 cicli/mm (guadagno 0,6: le ottave fini pesano) centrato sulla quota base, più una
    // grana fine a 0,9 cicli/mm che garantisce un'escursione minima anche dove il rumore lento è quasi costante
    let depth = p.baseDepth + p.roughness * (2 * fbm(x * 0.3, y * 0.3, p.seed, 4, 0.6) - 1);
    depth += 0.4 * p.roughness * (2 * valueNoise(x * 0.9 + 7.7, y * 0.9 - 3.1, p.seed + 13) - 1);
    // Vaiolatura: vale il cratere più profondo tra quelli che coprono il punto
    let pit = 0;
    near(x, y, (c) => {
      pit = Math.max(pit, craterProfile(c, Math.hypot(x - c.x, y - c.y)));
    });
    depth += pit;
    // Scaglie: dove il rumore lento supera una soglia la superficie risale di una quota fissa (metà della quota base): così
    // la ruvidità e i crateri restano interi sulle placche (soglia più bassa con più `flakes`)
    const threshold = 0.75 - 0.25 * Math.min(1, Math.max(0, p.flakes));
    const flake = smoothstep(threshold, threshold + 0.05, fbm(x * 0.1 + 31, y * 0.1, p.seed + 77, 2));
    depth -= flake * 0.5 * p.baseDepth;
    return Math.max(0.05, depth);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Borchie
// ---------------------------------------------------------------------------------------------------------------------

/** Borchie massime sulla faccia (circa, più una fila e una colonna di arrotondamento): oltre, il passo si allarga. */
export const MAX_STUDS = 2000;

/** Griglia delle borchie: colonne, file, centro della prima, passo effettivo e sfalsamento delle file dispari (mm). */
export interface StudGrid {
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  pitch: number;
  stagger: number;
}

/**
 * La griglia delle borchie, **centrata** nel rettangolo e con tutte le borchie intere dentro: `cols = floor((w - 2r) /
 * passo) + 1` (0 se il lato è più corto del diametro), partenza a metà dello spazio che avanza. Con la disposizione 'staggered'
 * le file dispari sono spostate di mezzo passo (la distanza tra le file resta il passo, quindi anche le piramidi, che sono
 * quadrate, non si toccano mai se il passo è almeno il diametro) e il rettangolo deve ospitare mezzo passo in più.
 * Il passo si allarga se le borchie sarebbero più di MAX_STUDS.
 */
export function studGrid(rect: Rect, params: StudParams): StudGrid {
  const p = normalizeRelief(params);
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  const pitch = Math.max(p.pitch, Math.sqrt((w * h) / MAX_STUDS));
  const stagger = p.layout === 'staggered' ? pitch / 2 : 0;
  const count = (length: number) => (length < 2 * p.radius ? 0 : Math.floor((length - 2 * p.radius) / pitch) + 1);
  const cols = count(w - stagger);
  const rows = count(h);
  return { cols, rows, x0: rect.minX + (w - ((cols - 1) * pitch + stagger)) / 2, y0: rect.minY + (h - (rows - 1) * pitch) / 2, pitch, stagger };
}

/** Centri delle borchie (vedi `studGrid`), per file dal basso. */
export function studCenters(rect: Rect, p: StudParams): Vec2[] {
  const g = studGrid(rect, p);
  const centers: Vec2[] = [];
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) centers.push([g.x0 + i * g.pitch + (j % 2 === 1 ? g.stagger : 0), g.y0 + j * g.pitch]);
  return centers;
}

/**
 * Centri da usare nel Pattern: la griglia centrata nel rettangolo della faccia ridotto del margine, con tutte le borchie intere
 * dentro (`studGrid`). Con la griglia centrata nella faccia intera e poi filtrata dal margine, un pezzo piccolo non avrebbe
 * nessuna borchia: così il margine è una cornice libera e il disegno resta simmetrico. È un calcolo puro (senza il contorno vero
 * della faccia), così il kernel e il codice OpenSCAD partono dalla stessa lista; sul contorno vero (faccia non rettangolare)
 * ritaglia poi la regione. Un margine che lascia un rettangolo vuoto non lascia borchie.
 */
export function studCentersFor(rect: Rect, params: StudParams, margin: number): Vec2[] {
  const inner = studInnerRect(rect, margin);
  return inner.maxX > inner.minX && inner.maxY > inner.minY ? studCenters(inner, normalizeRelief(params)) : [];
}

/** Il rettangolo della faccia ridotto del margine (un margine non finito vale zero): quello in cui sta la griglia delle borchie. */
export function studInnerRect(rect: Rect, margin: number): Rect {
  const m = Math.max(0, Number.isFinite(margin) ? margin : 0);
  return { minX: rect.minX + m, minY: rect.minY + m, maxX: rect.maxX - m, maxY: rect.maxY - m };
}

/**
 * Piramide a base quadrata (lato 2r) con un piede prismatico che entra di `embed` mm nel pezzo: vertici e triangoli con le
 * normali verso l'esterno (antiorari visti da fuori). Li usano il kernel e il codice OpenSCAD (che rovescia i triangoli).
 */
export function pyramidPolyhedron(r: number, height: number, embed: number): { points: number[][]; faces: number[][] } {
  const points = [[-r, -r, -embed], [r, -r, -embed], [r, r, -embed], [-r, r, -embed], [-r, -r, 0], [r, -r, 0], [r, r, 0], [-r, r, 0], [0, 0, height]];
  const faces = [
    // Fondo e quattro lati del piede, poi le quattro falde del tetto
    [0, 3, 2], [0, 2, 1], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
    [4, 5, 8], [5, 6, 8], [6, 7, 8], [7, 4, 8],
  ];
  return { points, faces };
}

/**
 * Profilo di una borchia come punti (raggio, quota) dall'asse al bordo della base, con la base a z = 0. Calotta sferica:
 * altezza al massimo pari al raggio (oltre, la borchia avrebbe un sottosquadro); cilindro: tetto piatto con smusso a 45°.
 */
export function studProfile(params: StudParams, arcPoints = 6): Vec2[] {
  const p = normalizeRelief(params);
  const r = p.radius;
  // La piramide non è di rivoluzione (vedi `pyramidPolyhedron`): per chi chiede comunque un profilo, il cono inscritto
  if (p.shape === 'pyramid') return [[0, p.height], [r, 0]];
  if (p.shape === 'chamfered') {
    const c = Math.min(p.chamfer, p.height, r);
    return [[0, p.height], [r - c, p.height], [r, p.height - c], [r, 0]];
  }
  // Calotta: raggio della sfera R = (r² + h²) / 2h, punti sull'arco dall'apice alla base
  const h = Math.min(p.height, r);
  const R = (r * r + h * h) / (2 * h);
  const maxAngle = Math.asin(Math.min(1, r / R));
  const points: Vec2[] = [];
  for (let k = 0; k <= arcPoints; k++) {
    const a = (maxAngle * k) / arcPoints;
    points.push([R * Math.sin(a), R * Math.cos(a) - (R - h)]);
  }
  // L'ultimo punto cade a z = 0 (a meno degli arrotondamenti): lo si fissa
  points[points.length - 1] = [r, 0];
  return points;
}

/**
 * Quota delle borchie in un punto (mm sopra la faccia, 0 fuori dalle borchie), per la mappa di altezze. Vale la borchia più
 * alta tra quelle che coprono il punto (come l'unione del CSG, anche con borchie sovrapposte); `centers` sono quelli
 * effettivamente scritti (di solito `studCenters`, o quelli rimasti dentro la regione).
 */
export function studHeight(rect: Rect, params: StudParams, centers: Vec2[] = studCenters(rect, params)): (x: number, y: number) => number {
  const p = normalizeRelief(params);
  const profile = studProfile(p, 24);
  const near = binDiscs(centers.map(([x, y]) => ({ x, y, r: p.radius })), rect);
  return (x, y) => {
    let height = 0;
    near(x, y, (c) => {
      // Piramide: la quota scende linearmente con la distanza "a quadrato" dal centro
      if (p.shape === 'pyramid') {
        const d = Math.max(Math.abs(x - c.x), Math.abs(y - c.y));
        if (d < p.radius) height = Math.max(height, p.height * (1 - d / p.radius));
        return;
      }
      const r = Math.hypot(x - c.x, y - c.y);
      if (r >= p.radius) return;
      // Interpolazione lineare sul profilo (il raggio dei punti cresce)
      for (let k = 1; k < profile.length; k++) {
        if (r <= profile[k][0]) {
          const [r0, z0] = profile[k - 1];
          const [r1, z1] = profile[k];
          height = Math.max(height, r1 === r0 ? z1 : z0 + ((z1 - z0) * (r - r0)) / (r1 - r0));
          return;
        }
      }
    });
    return height;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rame battuto
// ---------------------------------------------------------------------------------------------------------------------

/** Una martellata: calotta sferica concava con bordo a raggio `r` (sul piano), profondità `d` e raggio di curvatura `R`. */
export interface Dent extends Disc {
  d: number;
  R: number;
}

/**
 * Le martellate ai centri (baricentri) di un Voronoi rilassato. Il raggio del bordo è 1,25 volte quello della cella (così
 * le calotte si sovrappongono) e varia di +/- `jitter` insieme alla profondità. I numeri casuali si estraggono in ordine
 * fisso (due per cella), quindi stesso seme = stesse martellate.
 */
export function dentList(rect: Rect, params: HammeredParams): Dent[] {
  const p = normalizeRelief(params);
  const count = hammerCount(rect, p);
  const random = mulberry32(p.seed * 131 + 9);
  return randomVoronoi(count, rect, p.seed, p.regularity).map((cell) => {
    const { area: a, centroid } = polygonCentroid(cell);
    const r = Math.sqrt(Math.abs(a) / Math.PI) * 1.25 * (1 + p.jitter * (2 * random() - 1));
    const d = Math.max(0.05, p.depth * (1 + p.jitter * (2 * random() - 1)));
    return { x: centroid[0], y: centroid[1], r, d, R: (r * r + d * d) / (2 * d) };
  });
}

/** Martellate (o faccette) massime: oltre, le celle si allargano. */
export const MAX_DENTS = 500;

/** Numero di celle di rame battuto per un rettangolo: area diviso area di una calotta, tra 3 e `MAX_DENTS`. */
const hammerCount = (rect: Rect, p: HammeredParams) => Math.min(MAX_DENTS, Math.max(3, Math.round(((rect.maxX - rect.minX) * (rect.maxY - rect.minY)) / (0.785 * p.size * p.size))));

/** True se la sovrapposizione di celle e il tetto allargano le celle di rame battuto rispetto al diametro chiesto (per l'avviso). */
export const hammerCapped = (rect: Rect, params: HammeredParams): boolean => {
  const p = normalizeRelief(params);
  if (p.design === 'scales') return scaleSize(rect, p.size) > p.size + 1e-9;
  return ((rect.maxX - rect.minX) * (rect.maxY - rect.minY)) / (0.785 * p.size * p.size) > MAX_DENTS + 0.5;
};

/** Profondità del rame battuto: la martellata più profonda tra quelle che coprono il punto. */
export function copperDepth(rect: Rect, params: HammeredParams): (x: number, y: number) => number {
  const p = normalizeRelief(params);
  const near = binDiscs(dentList(rect, p), rect);
  return (x, y) => {
    let depth = 0;
    near(x, y, (c) => {
      const dist = Math.hypot(x - c.x, y - c.y);
      // Quota della sfera sotto il piano: sqrt(R² - dist²) - (R - d)
      if (dist < c.r) depth = Math.max(depth, Math.sqrt(c.R * c.R - dist * dist) - (c.R - c.d));
    });
    return depth;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rame battuto sfaccettato
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Una faccetta: la cella (poligono convesso di un Voronoi) con un piano inclinato che parte dal bordo della faccia (profondità 0
 * sul lato `umin`) e scende fino a `d` mm sul lato opposto, nella direzione `dir`. `ring` ha i vertici (x, y, z) in senso
 * antiorario visto dall'alto, con la z del piano (<= 0), arrotondati a 0,1 micrometri: è ciò che scrivono kernel e codice.
 */
export interface Facet extends Disc {
  ring: [number, number, number][];
  /** Direzione della pendenza (versore) e quota minima della cella lungo di essa; lunghezza della cella e profondità massima. */
  dir: Vec2;
  umin: number;
  length: number;
  d: number;
}

/**
 * Le faccette: una per cella di un Voronoi rilassato (stesso seme e stessa regolarità delle martellate). Per cella si estraggono
 * in ordine fisso due numeri casuali: l'angolo della pendenza e la profondità massima (`depth` +/- `jitter`). Stesso seme, stesse
 * faccette.
 */
export function facetList(rect: Rect, params: HammeredParams): Facet[] {
  const p = normalizeRelief(params);
  const random = mulberry32(p.seed * 131 + 9);
  const facets: Facet[] = [];
  for (const cell of randomVoronoi(hammerCount(rect, p), rect, p.seed, p.regularity)) {
    const angle = 2 * Math.PI * random();
    const d = Math.max(0.05, p.depth * (1 + p.jitter * (2 * random() - 1)));
    const { area, centroid } = polygonCentroid(cell);
    // Sempre antiorario, per le facce del solido
    const poly = area < 0 ? [...cell].reverse() : cell;
    const dir: Vec2 = [Math.cos(angle), Math.sin(angle)];
    const along = poly.map(([x, y]) => x * dir[0] + y * dir[1]);
    const umin = Math.min(...along);
    const length = Math.max(Math.max(...along) - umin, 1e-6);
    const q = (v: number) => Math.round(v * 10000) / 10000;
    const ring = poly.map(([x, y], k) => [q(x), q(y), q((-d * (along[k] - umin)) / length)] as [number, number, number]);
    facets.push({ x: centroid[0], y: centroid[1], r: Math.max(...poly.map(([x, y]) => Math.hypot(x - centroid[0], y - centroid[1]))), ring, dir, umin, length, d });
  }
  return facets;
}

/** Profondità delle faccette: dentro una cella cresce linearmente da 0 a `d` lungo la direzione; sul bordo comune vale la più profonda. */
export function facetDepth(rect: Rect, params: HammeredParams): (x: number, y: number) => number {
  const near = binDiscs(facetList(rect, normalizeRelief(params)), rect);
  return (x, y) => {
    let depth = 0;
    near(x, y, (f) => {
      // Punto dentro la cella convessa (antioraria): sta a sinistra di ogni lato
      for (let k = 0; k < f.ring.length; k++) {
        const [ax, ay] = f.ring[k];
        const [bx, by] = f.ring[(k + 1) % f.ring.length];
        if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < -1e-9) return;
      }
      depth = Math.max(depth, f.d * Math.min(1, Math.max(0, (x * f.dir[0] + y * f.dir[1] - f.umin) / f.length)));
    });
    return depth;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rame battuto a scaglie
// ---------------------------------------------------------------------------------------------------------------------

/** Rapporto tra il semiasse lungo Y e quello lungo X di una scaglia (ovale, un po' più alta che larga). */
export const SCALE_ASPECT = 1.1;

/** Una scaglia: calotta concava ovale con semiasse `rx` lungo X (e `r` = `rx` · SCALE_ASPECT lungo Y), profondità `d` e raggio di curvatura `R`. */
export interface ScaleCap extends Disc {
  rx: number;
  d: number;
  R: number;
}

/** Posizioni delle scaglie di larghezza `size`: file a passo `size / 2` in Y (si sovrappongono) e `size` in X, le dispari sfalsate di mezzo passo. */
function scaleCenters(rect: Rect, size: number): Vec2[] {
  const rx = 0.55 * size;
  const ry = rx * SCALE_ASPECT;
  const rowPitch = size / 2;
  const centers: Vec2[] = [];
  for (let j = 0; rect.minY + j * rowPitch - ry < rect.maxY; j++) {
    const y = rect.minY + j * rowPitch;
    const shift = j % 2 === 1 ? 0.5 : 0;
    for (let i = 0; rect.minX + (i + shift) * size - rx < rect.maxX; i++) {
      const x = rect.minX + (i + shift) * size;
      if (x + rx > rect.minX && y + ry > rect.minY) centers.push([x, y]);
    }
  }
  return centers;
}

/** Larghezza effettiva delle scaglie: quella chiesta, allargata finché non servono più di `MAX_DENTS` scaglie. */
export function scaleSize(rect: Rect, requested: number): number {
  let size = Math.max(2, Number.isFinite(requested) ? requested : 8);
  // Prima una stima a forma chiusa (area con il bordo diviso area di una scaglia), poi il conteggio vero
  const estimate = (s: number) => ((rect.maxX - rect.minX + 1.2 * s) * (rect.maxY - rect.minY + 1.4 * s)) / (0.5 * s * s);
  while (estimate(size) > MAX_DENTS * 1.15) size *= 1.1;
  for (let guard = 0; guard < 100 && scaleCenters(rect, size).length > MAX_DENTS; guard++) size *= 1.05;
  return size;
}

/** Le scaglie: grigliato sfalsato, profondità di ognuna `depth` +/- `jitter` dal seme (un numero casuale per scaglia, in ordine fisso). */
export function scaleList(rect: Rect, params: HammeredParams): ScaleCap[] {
  const p = normalizeRelief(params);
  const size = scaleSize(rect, p.size);
  const rx = 0.55 * size;
  const random = mulberry32(p.seed * 131 + 9);
  return scaleCenters(rect, size).map(([x, y]) => {
    const d = Math.max(0.05, p.depth * (1 + p.jitter * (2 * random() - 1)));
    return { x, y, r: rx * SCALE_ASPECT, rx, d, R: (rx * rx + d * d) / (2 * d) };
  });
}

/** Profondità delle scaglie: la più profonda tra quelle che coprono il punto (la calotta si legge con la distanza ridotta in Y). */
export function scaleDepth(rect: Rect, params: HammeredParams): (x: number, y: number) => number {
  const near = binDiscs(scaleList(rect, normalizeRelief(params)), rect);
  return (x, y) => {
    let depth = 0;
    near(x, y, (c) => {
      const dist = Math.hypot(x - c.x, (y - c.y) / SCALE_ASPECT);
      if (dist < c.rx) depth = Math.max(depth, Math.sqrt(c.R * c.R - dist * dist) - (c.R - c.d));
    });
    return depth;
  };
}

/** Profondità (mm sotto la faccia) di una texture sottrattiva sul rettangolo, completa di fughe e quota base (per la mappa di altezze). */
export function reliefDepth(rect: Rect, p: ReliefParams): (x: number, y: number) => number {
  switch (p.kind) {
    case 'brick':
      return brickDepth(rect, p);
    case 'wood':
      return grainDepth(rect, p, true);
    case 'rust':
      return rustDepth(rect, p);
    case 'hammered':
      return p.design === 'facets' ? facetDepth(rect, p) : p.design === 'scales' ? scaleDepth(rect, p) : copperDepth(rect, p);
    case 'studs':
      throw new Error('Le borchie sono additive: usare studHeight');
  }
}
