import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import {
  brickLayout,
  craterList,
  dentList,
  dentProfile,
  facetList,
  grainDepth,
  isAdditive,
  normalizeRelief,
  pyramidPolyhedron,
  reliefDepth,
  rustMaxDepth,
  sampleGrid,
  SCALE_ASPECT,
  scaleList,
  studGrid,
  studHeight,
  studProfile,
  woodBoxes,
  woodMaxDepth,
} from '../scene/relief';
import type { Box, Facet, HeightGrid, ReliefParams, WoodParams } from '../scene/relief';
import type { Rect, Vec2 } from '../scene/voronoi';

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
  /** Solo borchie: i centri già scelti dal chiamante (vedi `studCentersFor`); se mancano si scartano quelli che non stanno interi nella regione (`studsInRegion`). */
  centers?: Vec2[];
  /** Solo borchie: quanto il piede entra nel pezzo (mm); vale `EMBED` ma non più di metà dello spessore (vedi `studEmbedOf`). */
  embed?: number;
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
export const ABOVE = 0.5;
export const EMBED = 0.2;
/** Spessore minimo oltre il quale una mappa di altezze taglia: sotto, la superficie resta sopra la faccia (niente facce complanari). */
export const FLOOR = 0.02;

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
export function prism(wasm: ManifoldToplevel, section: CrossSection, z0: number, z1: number): Manifold {
  const slab = wasm.Manifold.extrude(section, z1 - z0, 0, 0, [1, 1], false);
  const moved = slab.translate([0, 0, z0]);
  slab.delete();
  return moved;
}

// ---------------------------------------------------------------------------------------------------------------------
// Mappa di altezze: griglia chiusa in un solido
// ---------------------------------------------------------------------------------------------------------------------

/** Da che parte della superficie sta il materiale di `heightSolid`: sotto (il piano di chiusura è più in basso) o sopra. */
export type HeightSide = 'below' | 'above';

/**
 * Solido chiuso tra la superficie z = f(x, y) della griglia e il piano orizzontale `planeZ`, con il materiale `side` della
 * superficie ('below': piano sotto, per le borchie; 'above': piano sopra, per i tagli). Le pareti sono verticali: ogni vertice
 * del bordo della superficie ha il suo gemello sul piano, quindi le pareti sono strisce di quadrilateri che non si
 * rovesciano mai, qualunque sia la superficie. Il piano di chiusura è un ventaglio dal suo centro ai vertici del bordo
 * (nessun triangolo degenere: il centro non sta mai su un lato). Tutti i vertici sono condivisi, quindi la mesh è a tenuta
 * senza fusione. La superficie e il piano non devono toccarsi.
 */
export function heightSolid(wasm: ManifoldToplevel, grid: HeightGrid, planeZ: number, side: HeightSide): Manifold {
  const { nx, ny, x0, y0, dx, dy, z } = grid;
  const n = nx * ny;
  const v = (i: number, j: number) => j * nx + i;
  // Bordo della griglia in senso antiorario visto dall'alto: lato basso, destro, alto, sinistro (senza ripetere gli angoli)
  const loop: number[] = [];
  for (let i = 0; i < nx; i++) loop.push(v(i, 0));
  for (let j = 1; j < ny; j++) loop.push(v(nx - 1, j));
  for (let i = nx - 2; i >= 0; i--) loop.push(v(i, ny - 1));
  for (let j = ny - 2; j >= 1; j--) loop.push(v(0, j));
  const count = loop.length;

  // Vertici: griglia, poi un gemello sul piano per ogni vertice del bordo (indice n + k), poi il centro del piano
  const vertices = new Float32Array((n + count + 1) * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) vertices.set([x0 + i * dx, y0 + j * dy, z[v(i, j)]], v(i, j) * 3);
  }
  loop.forEach((s, k) => vertices.set([vertices[s * 3], vertices[s * 3 + 1], planeZ], (n + k) * 3));
  const centre = n + count;
  vertices.set([x0 + ((nx - 1) * dx) / 2, y0 + ((ny - 1) * dy) / 2, planeZ], centre * 3);

  // Orientazione "sotto": normali verso l'esterno con i vertici antiorari visti da fuori
  const tris: number[] = [];
  // Superficie: due triangoli per cella, antiorari visti dall'alto (normale verso +Z)
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) tris.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
  }
  for (let k = 0; k < count; k++) {
    const next = (k + 1) % count;
    // Parete: quadrilatero verticale sotto il lato k del bordo (verso opposto a quello del lato nella superficie)
    tris.push(loop[next], loop[k], n + k, loop[next], n + k, n + next);
    // Piano di chiusura (normale verso -Z): ventaglio dal centro
    tris.push(centre, n + next, n + k);
  }
  // Materiale sopra la superficie: stessa mesh con i triangoli rovesciati
  if (side === 'above') for (let t = 0; t < tris.length; t += 3) [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: vertices, triVerts: new Uint32Array(tris) });
  return new wasm.Manifold(mesh);
}

/** Mappa di profondità (mm, >= 0) come solido da togliere: va dalla superficie z = FLOOR - profondità fino a `ABOVE` sopra la faccia. */
function depthMapCutter(wasm: ManifoldToplevel, rect: Rect, step: number, depth: (x: number, y: number) => number): Manifold {
  // Dove la profondità è sotto FLOOR la superficie resta sopra la faccia e non taglia nulla
  const grid = sampleGrid(rect, step, (x, y) => FLOOR - depth(x, y));
  return heightSolid(wasm, grid, ABOVE + 1, 'above');
}

/** Intersezione con il prisma della regione e pulizia: restituisce null se non resta nulla. */
export function clipToRegion(wasm: ManifoldToplevel, solid: Manifold, region: CrossSection, z0: number, z1: number): Manifold | null {
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

/** Piramide a base quadrata con il piede nel pezzo (vedi `pyramidPolyhedron`), con la base della punta su z = 0. */
function pyramidStud(wasm: ManifoldToplevel, radius: number, height: number, embed: number): Manifold {
  const { points, faces } = pyramidPolyhedron(radius, height, embed);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(points.flat()), triVerts: new Uint32Array(faces.flat()) });
  return new wasm.Manifold(mesh);
}

/** Calotta concava (cavità di una sfera di raggio R, profondità d, bordo r) con il bordo a z = 0, profondità verso il basso. */
function dentCutter(wasm: ManifoldToplevel, r: number, d: number, R: number, segments: number): Manifold {
  // Arco dal fondo (0, -d) al bordo (r, 0); gli anelli sono pochi perché la calotta è molto piatta
  const profile = dentProfile(r, d, R, 4);
  return revolved(wasm, profile, ABOVE, segments);
}

// ---------------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Il solido da togliere dal pezzo per le texture sottrattive (mattoni, legno, ruggine, rame battuto), nel riferimento della
 * faccia, già ritagliato sulla regione. Restituisce null se non toglie nulla.
 */
export function reliefCutter(wasm: ManifoldToplevel, region: CrossSection, params: ReliefParams, options: ReliefOptions = {}): Manifold | null {
  if (isAdditive(params)) throw new Error('Texture additiva: usare reliefAddition');
  const { Manifold } = wasm;
  const p = normalizeRelief(params);
  const engine = options.engine ?? BEST_ENGINE[p.kind];
  // Il motore ibrido esiste solo per il legno: per le altre texture è un errore, non un ripiego silenzioso sul CSG
  if (engine === 'hybrid' && p.kind !== 'wood') throw new Error(`Motore 'hybrid' non disponibile per la texture '${p.kind}'`);
  // Regione vuota (margine troppo grande, faccia senza area): niente da fare, e senza limiti finiti i cicli non finirebbero
  if (region.isEmpty()) return null;
  const step = options.step ?? DEFAULT_STEP;
  const segments = options.segments ?? DEFAULT_SEGMENTS;
  const rect = options.rect ?? regionRect(region);
  // Quanto in basso arriva al massimo il taglio, per il prisma di ritaglio
  const zMin = -(p.kind === 'rust' ? rustMaxDepth(p) : p.kind === 'hammered' ? p.depth * (1 + p.jitter) + 0.1 : p.kind === 'wood' ? woodMaxDepth(p) : p.depth) - 1;

  // Mappa di altezze (anche per il legno in modo 'heightmap', con le fughe nella mappa)
  if (engine === 'heightmap') return clipToRegion(wasm, depthMapCutter(wasm, rect, step, reliefDepth(rect, p)), region, zMin, ABOVE + 1);

  if (p.kind === 'brick') {
    // Fughe: la regione meno i mattoni, estruse della profondità della fuga
    const cells = boxesSection(wasm, brickLayout(rect, p));
    const grooves = region.subtract(cells);
    cells.delete();
    const groovesSolid = grooves.isEmpty() ? null : prism(wasm, grooves, -p.depth, ABOVE);
    grooves.delete();
    return groovesSolid;
  }
  if (p.kind === 'wood') return woodCutter(wasm, region, p, engine, step, rect, zMin);

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
  } else if (p.kind === 'hammered' && p.design === 'facets') {
    // Una faccetta piana inclinata per cella
    for (const f of facetList(rect, p)) caps.push(facetSolid(wasm, f));
  } else if (p.kind === 'hammered') {
    // Calotte (martellato) oppure calotte ovali, stirate in Y e sfalsate (scaglie)
    const scales = p.design === 'scales';
    for (const d of scales ? scaleList(rect, p).map((c) => ({ x: c.x, y: c.y, r: c.rx, d: c.d, R: c.R })) : dentList(rect, p)) {
      const cap = dentCutter(wasm, d.r, d.d, d.R, segments);
      // Per le scaglie la copia stirata in Y; per le calotte una copia identica, così `stretched` si libera allo stesso modo nei due casi
      const stretched = scales ? cap.scale([1, SCALE_ASPECT, 1]) : cap.translate([0, 0, 0]);
      cap.delete();
      caps.push(stretched.translate([d.x, d.y, 0]));
      stretched.delete();
    }
  }
  const all = Manifold.union(caps);
  caps.forEach((c) => c.delete());
  return clipToRegion(wasm, all, region, zMin, ABOVE + 1);
}

/**
 * Solido di una faccetta: la cella estrusa dal piano inclinato (vertici `f.ring`, con la z del piano) fino a `ABOVE` sopra la
 * faccia. Poliedro convesso: fondo e coperchio a ventaglio, lati verticali; il codice OpenSCAD scrive gli stessi vertici.
 */
function facetSolid(wasm: ManifoldToplevel, f: Facet): Manifold {
  const n = f.ring.length;
  const vertices = new Float32Array(2 * n * 3);
  f.ring.forEach(([x, y, z], i) => {
    vertices.set([x, y, z], i * 3);
    vertices.set([x, y, ABOVE], (n + i) * 3);
  });
  const tris: number[] = [];
  // Fondo (normale verso il basso) e coperchio (verso l'alto), a ventaglio dal primo vertice
  for (let i = 1; i < n - 1; i++) tris.push(0, i + 1, i, n, n + i, n + i + 1);
  // Lati verticali: antiorari visti da fuori
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push(i, j, n + j, i, n + j, n + i);
  }
  return new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: vertices, triVerts: new Uint32Array(tris) }));
}

/**
 * Legno: le fughe tra doghe o listelli come prismi (la regione meno i rettangoli, CSG) e la venatura come mappa di altezze
 * ('hybrid', o solo CSG con 'csg'); la tavola unica non ha fughe e vale solo la mappa (venatura e nodi). Senza venatura
 * (`grainDepth` 0) restano le sole fughe.
 */
function woodCutter(wasm: ManifoldToplevel, region: CrossSection, p: WoodParams, engine: ReliefEngine, step: number, rect: Rect, zMin: number): Manifold | null {
  const boxes = woodBoxes(rect, p).map((w) => w.box);
  let groovesSolid: Manifold | null = null;
  if (boxes.length) {
    const cells = boxesSection(wasm, boxes);
    const grooves = region.subtract(cells);
    cells.delete();
    groovesSolid = grooves.isEmpty() ? null : prism(wasm, grooves, -p.gapDepth, ABOVE);
    grooves.delete();
  }
  if (engine === 'csg' || !(p.grainDepth > 0)) return groovesSolid;
  // Legno 'hybrid': si aggiunge la venatura in mappa di altezze
  const grain = clipToRegion(wasm, depthMapCutter(wasm, rect, step, grainDepth(rect, p)), region, zMin, ABOVE + 1);
  if (!groovesSolid) return grain;
  if (!grain) return groovesSolid;
  const both = wasm.Manifold.union([groovesSolid, grain]);
  groovesSolid.delete();
  grain.delete();
  return both;
}

/** Rettangolo come CrossSection (per la lastra di base della ruggine in CSG). */
function regionSection(wasm: ManifoldToplevel, rect: Rect): CrossSection {
  const square = wasm.CrossSection.square([rect.maxX - rect.minX, rect.maxY - rect.minY]);
  const moved = square.translate([rect.minX, rect.minY]);
  square.delete();
  return moved;
}

/** Vero se il punto sta dentro i contorni (regola pari-dispari: i fori contano). */
function insideRings(rings: Vec2[][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * I centri delle borchie la cui base sta tutta dentro la regione: il centro deve cadere nella regione ridotta del raggio.
 * Senza margine e con la faccia rettangolare sono tutti quelli della griglia centrata; con un margine o una faccia di
 * forma diversa alcuni vengono scartati (le mezze borchie lasciano pareti sottili e sono brutte).
 */
export function studsInRegion(region: CrossSection, rect: Rect, params: ReliefParams): Vec2[] {
  const p = normalizeRelief(params);
  if (p.kind !== 'studs') return [];
  const g = studGrid(rect, p);
  // Tolleranza di un decimo di micrometro: una borchia che tocca il bordo esatto della regione resta
  const inner = region.offset(-(p.radius - 1e-4), 'Round', 2, 32);
  const rings = inner.toPolygons() as Vec2[][];
  inner.delete();
  const centers: Vec2[] = [];
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.cols; i++) {
      // Le file dispari della griglia sfalsata sono spostate di mezzo passo (`g.stagger`, zero per la griglia quadrata)
      const c: Vec2 = [g.x0 + i * g.pitch + (j % 2 === 1 ? g.stagger : 0), g.y0 + j * g.pitch];
      if (insideRings(rings, c[0], c[1])) centers.push(c);
    }
  }
  return centers;
}

/**
 * Il solido da unire al pezzo per le texture additive (borchie), nel riferimento della faccia, ritagliato sulla regione:
 * entra di `EMBED` mm nel pezzo (o `options.embed`), così l'unione non lascia fessure. Restituisce null se non resta nulla.
 */
export function reliefAddition(wasm: ManifoldToplevel, region: CrossSection, params: ReliefParams, options: ReliefOptions = {}): Manifold | null {
  if (params.kind !== 'studs') throw new Error('Texture sottrattiva: usare reliefCutter');
  const { Manifold } = wasm;
  const p = normalizeRelief(params);
  const engine = options.engine ?? BEST_ENGINE.studs;
  if (engine === 'hybrid') throw new Error("Motore 'hybrid' non disponibile per la texture 'studs'");
  if (region.isEmpty()) return null;
  const rect = options.rect ?? regionRect(region);
  const top = p.height + 1;
  const embed = options.embed ?? EMBED;
  // Di solito solo le borchie che stanno intere nella regione (nessuna borchia tagliata a metà); nel Pattern i centri li sceglie il chiamante
  const centers = options.centers ?? studsInRegion(region, rect, p);
  if (centers.length === 0) return null;

  if (engine === 'heightmap') {
    // La mappa sta sopra il piano a -EMBED; fuori dalle borchie la superficie resta un po' sotto la faccia
    const height = studHeight(rect, p, centers);
    const grid = sampleGrid(rect, options.step ?? DEFAULT_STEP, (x, y) => Math.max(height(x, y), -FLOOR));
    return clipToRegion(wasm, heightSolid(wasm, grid, -embed, 'below'), region, -embed, top);
  }

  // CSG: una borchia per rivoluzione del profilo (con il piede che entra nel pezzo), o la piramide, copiata nei centri
  const stud = p.shape === 'pyramid' ? pyramidStud(wasm, p.radius, p.height, embed) : revolved(wasm, studProfile(p), -embed, options.segments ?? DEFAULT_SEGMENTS);
  const copies = centers.map((c) => stud.translate([c[0], c[1], 0]));
  stud.delete();
  // Con le borchie che si toccano serve l'unione; altrimenti basta compose (nessuna booleana)
  const joined = studGrid(rect, p).pitch > 2 * p.radius ? Manifold.compose(copies) : Manifold.union(copies);
  copies.forEach((c) => c.delete());
  // Se tutte le borchie stanno intere dentro una regione rettangolare il ritaglio non toglierebbe nulla: si salta (è l'intersezione
  // più costosa con molte borchie) e il risultato è lo stesso
  if (studsFitRegion(region, centers, p)) return joined;
  return clipToRegion(wasm, joined, region, -embed, top);
}

/** Vero se la regione è un rettangolo e tutte le borchie (base di raggio `radius`, anche quadrata) stanno dentro. */
function studsFitRegion(region: CrossSection, centers: Vec2[], p: { radius: number }): boolean {
  const b = region.bounds();
  const area = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]);
  // Rettangolo: l'area della regione coincide con quella del suo riquadro
  if (!(area > 0) || Math.abs(region.area() - area) > 1e-6 * area) return false;
  const tolerance = 1e-6;
  return centers.every(([x, y]) => x - p.radius >= b.min[0] - tolerance && x + p.radius <= b.max[0] + tolerance && y - p.radius >= b.min[1] - tolerance && y + p.radius <= b.max[1] + tolerance);
}
