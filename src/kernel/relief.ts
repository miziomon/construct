import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import {
  brickLayout,
  craterList,
  dentList,
  grainDepth,
  isAdditive,
  plankLayout,
  reliefDepth,
  sampleGrid,
  studCenters,
  studHeight,
  studProfile,
} from '../scene/relief';
import type { Box, HeightGrid, ReliefParams } from '../scene/relief';
import type { Rect } from '../scene/voronoi';

/**
 * Texture in rilievo su una faccia piana (studio di fattibilità, non ancora collegato all'app). Tutto avviene nel
 * riferimento della faccia (faccia su z = 0, pezzo sotto): la regione è la sezione della faccia (CrossSection, già ridotta
 * del margine) e i solidi restituiti si tolgono (`reliefCutter`) o si uniscono (`reliefAddition`) al pezzo. Il chiamante
 * possiede la regione (non viene liberata) e il solido restituito.
 *
 * Due motori: 'csg' (celle 2D estruse, calotte ottenute per rivoluzione, unioni) e 'heightmap' (griglia z = f(x, y) chiusa
 * in un solido), più 'hybrid' per il legno (fughe in CSG e venatura in mappa di altezze).
 */
export type ReliefEngine = 'csg' | 'heightmap' | 'hybrid';

export interface ReliefOptions {
  engine?: ReliefEngine;
  /** Passo della mappa di altezze (mm): 0,8 anteprima, 0,5 normale, 0,3 fine. */
  step?: number;
  /** Segmenti angolari delle calotte nel motore CSG. */
  segments?: number;
  /** Rettangolo a cui ancorare il disegno (di solito `frameRect`, quello della faccia): così non si sposta quando il margine cambia la regione. Se manca si usa il riquadro della regione. */
  rect?: Rect;
}

/** Il motore consigliato per ogni texture (vedi docs/studio-pattern-rilievo.md). */
export const BEST_ENGINE: Record<ReliefParams['kind'], ReliefEngine> = {
  brick: 'csg',
  wood: 'hybrid',
  rust: 'heightmap',
  studs: 'csg',
  hammered: 'csg',
};

/** Quanto il solido del taglio sporge sopra la faccia (mm) e quanto la borchia entra nel pezzo (mm). */
const ABOVE = 0.5;
const EMBED = 0.2;
/** Spessore minimo oltre il quale una mappa di altezze taglia: sotto, la superficie resta sopra la faccia (niente facce complanari). */
const FLOOR = 0.02;

const DEFAULT_STEP = 0.5;
const DEFAULT_SEGMENTS = 24;

/** Rettangolo che contiene la regione. */
function regionRect(region: CrossSection): Rect {
  const b = region.bounds();
  return { minX: b.min[0], minY: b.min[1], maxX: b.max[0], maxY: b.max[1] };
}

/** Rettangoli come CrossSection unica (le celle disgiunte si compongono senza booleane). */
function boxesSection(wasm: ManifoldToplevel, boxes: Box[]): CrossSection {
  return wasm.CrossSection.compose(boxes.map(([x0, y0, x1, y1]) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]));
}

/** Prisma della sezione tra `z0` e `z1`. */
function prism(wasm: ManifoldToplevel, section: CrossSection, z0: number, z1: number): Manifold {
  const slab = wasm.Manifold.extrude(section, z1 - z0, 0, 0, [1, 1], false);
  const moved = slab.translate([0, 0, z0]);
  slab.delete();
  return moved;
}

// ---------------------------------------------------------------------------------------------------------------------
// Mappa di altezze: griglia chiusa in un solido
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Solido chiuso tra la superficie z = f(x, y) della griglia e il piano orizzontale `planeZ`. I vertici sono quelli della
 * griglia più i quattro angoli del piano: le pareti riusano gli indici dei vertici di bordo, quindi la mesh è a tenuta
 * senza fusione di vertici. Il piano sta sotto la superficie (solido "sotto la superficie") oppure sopra (solido "sopra"):
 * nel secondo caso si invertono i triangoli. La superficie e il piano non devono toccarsi (pareti degeneri).
 */
export function heightSolid(wasm: ManifoldToplevel, grid: HeightGrid, planeZ: number): Manifold {
  const { nx, ny, x0, y0, dx, dy, z } = grid;
  const n = nx * ny;
  const vertices = new Float32Array((n + 4) * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) vertices.set([x0 + i * dx, y0 + j * dy, z[j * nx + i]], (j * nx + i) * 3);
  }
  // Angoli del piano, in senso antiorario visto dall'alto: c00, c10, c11, c01
  const [c00, c10, c11, c01] = [n, n + 1, n + 2, n + 3];
  const x1 = x0 + (nx - 1) * dx;
  const y1 = y0 + (ny - 1) * dy;
  vertices.set([x0, y0, planeZ, x1, y0, planeZ, x1, y1, planeZ, x0, y1, planeZ], n * 3);

  const tris: number[] = [];
  const v = (i: number, j: number) => j * nx + i;
  // Superficie: due triangoli per cella, antiorari visti dall'alto (normale verso +Z)
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) tris.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
  }
  // Piano di chiusura (normale verso -Z)
  tris.push(c10, c00, c01, c10, c01, c11);
  // Pareti: per ogni lato, ventaglio dall'angolo di partenza del piano verso i vertici di bordo (ordine antiorario del bordo)
  const side = (cA: number, cB: number, edge: number[]) => {
    tris.push(cA, cB, edge[edge.length - 1]);
    for (let k = edge.length - 1; k >= 1; k--) tris.push(cA, edge[k], edge[k - 1]);
  };
  const range = (count: number) => Array.from({ length: count }, (_, k) => k);
  side(c00, c10, range(nx).map((i) => v(i, 0)));
  side(c10, c11, range(ny).map((j) => v(nx - 1, j)));
  side(c11, c01, range(nx).map((i) => v(nx - 1 - i, ny - 1)));
  side(c01, c00, range(ny).map((j) => v(0, ny - 1 - j)));

  // Solido "sopra la superficie": stessa mesh con i triangoli rovesciati
  const above = planeZ > z[0];
  if (above) for (let t = 0; t < tris.length; t += 3) [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: vertices, triVerts: new Uint32Array(tris) });
  return new wasm.Manifold(mesh);
}

/** Mappa di profondità (mm, >= 0) come solido da togliere: va dalla superficie z = FLOOR - profondità fino a `ABOVE` sopra la faccia. */
function depthMapCutter(wasm: ManifoldToplevel, rect: Rect, step: number, depth: (x: number, y: number) => number): Manifold {
  // Dove la profondità è sotto FLOOR la superficie resta sopra la faccia e non taglia nulla
  const grid = sampleGrid(rect, step, (x, y) => FLOOR - depth(x, y));
  return heightSolid(wasm, grid, ABOVE + 1);
}

/** Intersezione con il prisma della regione e pulizia: restituisce null se non resta nulla. */
function clipToRegion(wasm: ManifoldToplevel, solid: Manifold, region: CrossSection, z0: number, z1: number): Manifold | null {
  const box = prism(wasm, region, z0, z1);
  const clipped = solid.intersect(box);
  box.delete();
  solid.delete();
  if (clipped.isEmpty()) {
    clipped.delete();
    return null;
  }
  return clipped;
}

// ---------------------------------------------------------------------------------------------------------------------
// Calotte per rivoluzione (motore CSG)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Solido di rivoluzione di un profilo (raggio, quota) chiuso verso l'asse: `profile` va dall'asse al bordo, poi si chiude
 * con `top` e torna all'asse. Una calotta così ha pochi triangoli (anelli dell'arco x segmenti) invece dei molti di una
 * sfera intera.
 */
function revolved(wasm: ManifoldToplevel, profile: [number, number][], closeZ: number, segments: number): Manifold {
  const last = profile[profile.length - 1];
  const section = new wasm.CrossSection([[...profile, [last[0], closeZ], [0, closeZ]]], 'NonZero');
  const solid = wasm.Manifold.revolve(section, segments);
  section.delete();
  return solid;
}

/** Calotta concava (cavità di una sfera di raggio R, profondità d, bordo r) con il bordo a z = 0, profondità verso il basso. */
function dentCutter(wasm: ManifoldToplevel, r: number, d: number, R: number, segments: number): Manifold {
  // Arco dal fondo (0, -d) al bordo (r, 0); gli anelli sono pochi perché la calotta è molto piatta
  const rings = 4;
  const maxAngle = Math.asin(Math.min(1, r / R));
  const profile: [number, number][] = [];
  for (let k = 0; k <= rings; k++) {
    const a = (maxAngle * k) / rings;
    // Centro della sfera a z = R - d: il fondo (a = 0) sta a -d, il bordo a 0
    profile.push([R * Math.sin(a), R - d - R * Math.cos(a)]);
  }
  // L'ultimo punto cade a z = 0 (a meno degli arrotondamenti): lo si fissa
  profile[profile.length - 1] = [r, 0];
  return revolved(wasm, profile, ABOVE, segments);
}

// ---------------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Il solido da togliere dal pezzo per le texture sottrattive (mattoni, legno, ruggine, rame battuto), nel riferimento della
 * faccia, già ritagliato sulla regione. Restituisce null se non toglie nulla.
 */
export function reliefCutter(wasm: ManifoldToplevel, region: CrossSection, p: ReliefParams, options: ReliefOptions = {}): Manifold | null {
  if (isAdditive(p)) throw new Error('Texture additiva: usare reliefAddition');
  const { Manifold } = wasm;
  const engine = options.engine ?? BEST_ENGINE[p.kind];
  const step = options.step ?? DEFAULT_STEP;
  const segments = options.segments ?? DEFAULT_SEGMENTS;
  const rect = options.rect ?? regionRect(region);
  // Quanto in basso arriva al massimo il taglio, per il prisma di ritaglio
  const zMin = -(p.kind === 'rust' ? p.baseDepth + p.roughness + p.craterDepth : p.kind === 'hammered' ? p.depth * (1 + p.jitter) + 0.1 : p.kind === 'wood' ? Math.max(p.gapDepth, p.grainDepth) : p.depth) - 1;

  // Mappa di altezze (anche per il legno in modo 'heightmap', con le fughe nella mappa)
  if (engine === 'heightmap') return clipToRegion(wasm, depthMapCutter(wasm, rect, step, reliefDepth(rect, p)), region, zMin, ABOVE + 1);

  if (p.kind === 'brick' || p.kind === 'wood') {
    // Fughe: la regione meno le celle (mattoni o doghe), estruse della profondità della fuga
    const boxes = p.kind === 'brick' ? brickLayout(rect, p) : plankLayout(rect, p).flat().map((pl) => pl.box);
    const cells = boxesSection(wasm, boxes);
    const grooves = region.subtract(cells);
    cells.delete();
    const depth = p.kind === 'brick' ? p.depth : p.gapDepth;
    const groovesSolid = grooves.isEmpty() ? null : prism(wasm, grooves, -depth, ABOVE);
    grooves.delete();
    if (p.kind === 'brick' || engine === 'csg') return groovesSolid;
    // Legno 'hybrid': si aggiunge la venatura in mappa di altezze
    const grain = clipToRegion(wasm, depthMapCutter(wasm, rect, step, grainDepth(rect, p)), region, zMin, ABOVE + 1);
    if (!groovesSolid) return grain;
    if (!grain) return groovesSolid;
    const both = Manifold.union([groovesSolid, grain]);
    groovesSolid.delete();
    grain.delete();
    return both;
  }

  // Ruggine in CSG: lastra alla quota base più i crateri come calotte (senza la ruvidità, impossibile in CSG)
  // Rame battuto in CSG: una calotta per martellata
  const caps: Manifold[] = [];
  if (p.kind === 'rust') {
    for (const c of craterList(rect, p)) {
      const cap = dentCutter(wasm, c.r, c.d, (c.r * c.r + c.d * c.d) / (2 * c.d), segments);
      caps.push(cap.translate([c.x, c.y, -p.baseDepth]));
      cap.delete();
    }
    const slab = regionSection(wasm, rect);
    caps.push(prism(wasm, slab, -p.baseDepth, ABOVE));
    slab.delete();
  } else if (p.kind === 'hammered') {
    for (const d of dentList(rect, p)) {
      const cap = dentCutter(wasm, d.r, d.d, d.R, segments);
      caps.push(cap.translate([d.x, d.y, 0]));
      cap.delete();
    }
  }
  const all = Manifold.union(caps);
  caps.forEach((c) => c.delete());
  return clipToRegion(wasm, all, region, zMin, ABOVE + 1);
}

/** Rettangolo come CrossSection (per la lastra di base della ruggine in CSG). */
function regionSection(wasm: ManifoldToplevel, rect: Rect): CrossSection {
  const square = wasm.CrossSection.square([rect.maxX - rect.minX, rect.maxY - rect.minY]);
  const moved = square.translate([rect.minX, rect.minY]);
  square.delete();
  return moved;
}

/**
 * Il solido da unire al pezzo per le texture additive (borchie), nel riferimento della faccia, ritagliato sulla regione:
 * entra di `EMBED` mm nel pezzo, così l'unione non lascia fessure. Restituisce null se non resta nulla.
 */
export function reliefAddition(wasm: ManifoldToplevel, region: CrossSection, p: ReliefParams, options: ReliefOptions = {}): Manifold | null {
  if (p.kind !== 'studs') throw new Error('Texture sottrattiva: usare reliefCutter');
  const { Manifold } = wasm;
  const engine = options.engine ?? BEST_ENGINE.studs;
  const rect = options.rect ?? regionRect(region);
  const top = p.height + 1;

  if (engine === 'heightmap') {
    // La mappa sta sopra il piano a -EMBED; fuori dalle borchie la superficie resta un po' sotto la faccia
    const height = studHeight(rect, p);
    const grid = sampleGrid(rect, options.step ?? DEFAULT_STEP, (x, y) => Math.max(height(x, y), -FLOOR));
    return clipToRegion(wasm, heightSolid(wasm, grid, -EMBED), region, -EMBED, top);
  }

  // CSG: una borchia per rivoluzione del profilo (con il piede che entra nel pezzo), copiata nei centri
  const stud = revolved(wasm, studProfile(p), -EMBED, options.segments ?? DEFAULT_SEGMENTS);
  const copies = studCenters(rect, p).map((c) => stud.translate([c[0], c[1], 0]));
  stud.delete();
  if (copies.length === 0) return null;
  // Con le borchie che si toccano serve l'unione; altrimenti basta compose (nessuna booleana)
  const joined = p.pitch > 2 * p.radius ? Manifold.compose(copies) : Manifold.union(copies);
  copies.forEach((c) => c.delete());
  return clipToRegion(wasm, joined, region, -EMBED, top);
}
