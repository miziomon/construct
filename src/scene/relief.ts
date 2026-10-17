import { mulberry32, polygonCentroid, randomVoronoi } from './voronoi';
import type { Rect, Vec2 } from './voronoi';

/**
 * Texture in rilievo su una faccia piana (studio di fattibilità, non ancora collegato all'app): calcoli puri e
 * deterministici, nel riferimento della faccia (faccia su z = 0, pezzo sotto). A parità di seme e parametri la geometria è
 * sempre la stessa. Le funzioni "profondità" (`brickDepth`, `grainDepth`, `rustDepth`, `copperDepth`) restituiscono i mm
 * da togliere sotto la faccia (sempre >= 0); `studHeight` restituisce i mm di rilievo aggiunti sopra la faccia.
 */

export type ReliefKind = 'brick' | 'wood' | 'rust' | 'studs' | 'hammered';

/** Muro di mattoni: file sfalsate di mezzo mattone, fughe incise. */
export interface BrickParams {
  kind: 'brick';
  /** Larghezza e altezza del mattone (mm), senza la fuga. */
  brickW: number;
  brickH: number;
  /** Spessore della fuga (mm) e sua profondità (mm). */
  mortar: number;
  depth: number;
}

/** Tavole di legno: doghe lunghe con giunti sfalsati, fughe e venature. */
export interface WoodParams {
  kind: 'wood';
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

/** Borchie: griglia di calotte o cilindri smussati che si aggiungono alla faccia. */
export interface StudParams {
  kind: 'studs';
  /** Passo della griglia (mm), raggio alla base (mm), altezza (mm). */
  pitch: number;
  radius: number;
  height: number;
  shape: 'dome' | 'chamfered';
  /** Smusso del cilindro (mm). */
  chamfer: number;
}

/** Rame battuto: calotte concave sovrapposte ai centri di un Voronoi rilassato. */
export interface HammeredParams {
  kind: 'hammered';
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
      return { kind, brickW: 24, brickH: 8, mortar: 1.2, depth: 0.8 };
    case 'wood':
      return { kind, seed: 1, plankW: 12, plankL: 60, gap: 0.8, gapDepth: 0.8, grainDepth: 0.25, ringSpacing: 3 };
    case 'rust':
      return { kind, seed: 1, baseDepth: 0.5, roughness: 0.35, craterDensity: 3, craterDepth: 0.5, flakes: 0.4 };
    case 'studs':
      return { kind, pitch: 12, radius: 2.5, height: 1.5, shape: 'dome', chamfer: 0.5 };
    case 'hammered':
      return { kind, seed: 1, size: 8, depth: 0.5, jitter: 0.25, regularity: 60 };
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
export function sampleGrid(rect: Rect, step: number, f: (x: number, y: number) => number): HeightGrid {
  const nx = Math.max(2, Math.ceil((rect.maxX - rect.minX) / step) + 1);
  const ny = Math.max(2, Math.ceil((rect.maxY - rect.minY) / step) + 1);
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

/** I mattoni che toccano il rettangolo (la fuga sta a cavallo dei bordi del passo, quindi il primo mattone parte a metà fuga). */
export function brickLayout(rect: Rect, p: BrickParams): Box[] {
  const [px, py] = brickPitch(p);
  const boxes: Box[] = [];
  const rows = Math.ceil((rect.maxY - rect.minY) / py);
  for (let r = 0; r < rows; r++) {
    const y0 = rect.minY + r * py + p.mortar / 2;
    for (let x = brickRowStart(rect, p, r); x < rect.maxX; x += px) boxes.push([x + p.mortar / 2, y0, x + p.mortar / 2 + p.brickW, y0 + p.brickH]);
  }
  return boxes;
}

/** Profondità delle fughe: `depth` dentro la fuga, 0 sul mattone (versione analitica, per la mappa di altezze). */
export function brickDepth(rect: Rect, p: BrickParams): (x: number, y: number) => number {
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
export function plankLayout(rect: Rect, p: WoodParams): Plank[][] {
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
 * Profondità della venatura (mm, 0 - `grainDepth`) dentro le doghe; 0 nelle fughe. Anelli stirati lungo la doga: la fase
 * dipende dalla distanza dal centro della doga, deformata da un rumore lento lungo la doga (le curve degli anelli); sopra
 * si somma una fibra fine (rumore molto più lungo che largo). Se `withGaps` anche le fughe valgono `gapDepth`.
 */
export function grainDepth(rect: Rect, p: WoodParams, withGaps = false): (x: number, y: number) => number {
  const layout = plankLayout(rect, p);
  const pitch = p.plankW + p.gap;
  return (x, y) => {
    const r = Math.floor((y - rect.minY) / pitch);
    const plank = layout[r]?.find((pl) => x >= pl.box[0] && x <= pl.box[2]);
    if (!plank || y < plank.box[1] || y > plank.box[3]) return withGaps ? p.gapDepth : 0;
    // Coordinate nella doga: u attraverso la larghezza dal centro, v lungo la doga
    const u = y - (plank.box[1] + plank.box[3]) / 2;
    const v = x - plank.box[0];
    const warp = fbm(v / 35, u / 5 + plank.id * 17, p.seed, 3) - 0.5;
    const phase = u / p.ringSpacing + 3 * warp + valueNoise(plank.id, 0, p.seed);
    // Anelli: creste strette (coseno alla terza) dove la fase è intera
    const ring = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * phase), 3);
    // Fibra fine: rumore lungo 25 mm e largo circa 0,4 mm
    const fiber = valueNoise(v / 25, u * 2.5, p.seed + plank.id);
    return p.grainDepth * (0.7 * ring + 0.3 * fiber);
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
export function craterList(rect: Rect, p: RustParams): Crater[] {
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

/** Profondità di un cratere a distanza `dist` dal centro: conca liscia con bordo a pendenza nulla. */
const craterProfile = (c: Crater, dist: number) => (dist >= c.r ? 0 : c.d * (1 - (dist / c.r) ** 2) ** 2);

/**
 * Profondità della ruggine (mm, sempre almeno 0,05): quota base + rumore frattale (ruvidità) + crateri, ridotta dove ci
 * sono scaglie/pustole (placche che restano alte). Tutta la faccia sta quindi circa `baseDepth` sotto il piano originale.
 */
export function rustDepth(rect: Rect, p: RustParams): (x: number, y: number) => number {
  const near = binDiscs(craterList(rect, p), rect);
  return (x, y) => {
    // Ruvidità: 4 ottave a partire da 0,25 cicli/mm, centrata sulla quota base
    let depth = p.baseDepth + p.roughness * (2 * fbm(x * 0.25, y * 0.25, p.seed, 4) - 1);
    // Vaiolatura: vale il cratere più profondo tra quelli che coprono il punto
    let pit = 0;
    near(x, y, (c) => {
      pit = Math.max(pit, craterProfile(c, Math.hypot(x - c.x, y - c.y)));
    });
    depth += pit;
    // Scaglie: dove il rumore lento supera una soglia la superficie risale (soglia più bassa con più `flakes`)
    const threshold = 0.75 - 0.25 * Math.min(1, Math.max(0, p.flakes));
    const flake = smoothstep(threshold, threshold + 0.05, fbm(x * 0.1 + 31, y * 0.1, p.seed + 77, 2));
    depth *= 1 - 0.75 * flake;
    return Math.max(0.05, depth);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Borchie
// ---------------------------------------------------------------------------------------------------------------------

/** Centri delle borchie: griglia quadrata di passo `pitch` che parte a mezzo passo dall'angolo, solo dentro il rettangolo. */
export function studCenters(rect: Rect, p: StudParams): Vec2[] {
  const centers: Vec2[] = [];
  for (let y = rect.minY + p.pitch / 2; y < rect.maxY; y += p.pitch) {
    for (let x = rect.minX + p.pitch / 2; x < rect.maxX; x += p.pitch) centers.push([x, y]);
  }
  return centers;
}

/**
 * Profilo di una borchia come punti (raggio, quota) dall'asse al bordo della base, con la base a z = 0. Calotta sferica:
 * altezza al massimo pari al raggio (oltre, la borchia avrebbe un sottosquadro); cilindro: tetto piatto con smusso a 45°.
 */
export function studProfile(p: StudParams, arcPoints = 6): Vec2[] {
  const r = p.radius;
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

/** Quota delle borchie in un punto (mm sopra la faccia, 0 fuori dalle borchie), per la mappa di altezze. */
export function studHeight(rect: Rect, p: StudParams): (x: number, y: number) => number {
  const profile = studProfile(p, 24);
  return (x, y) => {
    const i = Math.round((x - rect.minX - p.pitch / 2) / p.pitch);
    const j = Math.round((y - rect.minY - p.pitch / 2) / p.pitch);
    const r = Math.hypot(x - (rect.minX + p.pitch / 2 + i * p.pitch), y - (rect.minY + p.pitch / 2 + j * p.pitch));
    if (r >= p.radius) return 0;
    // Interpolazione lineare sul profilo (il raggio dei punti cresce)
    for (let k = 1; k < profile.length; k++) {
      if (r <= profile[k][0]) {
        const [r0, z0] = profile[k - 1];
        const [r1, z1] = profile[k];
        return r1 === r0 ? z1 : z0 + ((z1 - z0) * (r - r0)) / (r1 - r0);
      }
    }
    return 0;
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
export function dentList(rect: Rect, p: HammeredParams): Dent[] {
  const area = (rect.maxX - rect.minX) * (rect.maxY - rect.minY);
  const count = Math.min(500, Math.max(3, Math.round(area / (0.785 * p.size * p.size))));
  const random = mulberry32(p.seed * 131 + 9);
  return randomVoronoi(count, rect, p.seed, p.regularity).map((cell) => {
    const { area: a, centroid } = polygonCentroid(cell);
    const r = Math.sqrt(Math.abs(a) / Math.PI) * 1.25 * (1 + p.jitter * (2 * random() - 1));
    const d = Math.max(0.05, p.depth * (1 + p.jitter * (2 * random() - 1)));
    return { x: centroid[0], y: centroid[1], r, d, R: (r * r + d * d) / (2 * d) };
  });
}

/** Profondità del rame battuto: la martellata più profonda tra quelle che coprono il punto. */
export function copperDepth(rect: Rect, p: HammeredParams): (x: number, y: number) => number {
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
      return copperDepth(rect, p);
    case 'studs':
      throw new Error('Le borchie sono additive: usare studHeight');
  }
}
