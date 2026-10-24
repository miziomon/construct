import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { patternRelief, cutReach, faceFrame, frameRect, isAdditiveKind, isAxisFace, isReliefKind, normalizePattern, patternCells, studCentersOf, studEmbedOf, studRelief, textureFloor, textureOf } from '../scene/pattern';
import { imageOf } from '../scene/textureImage';
import type { ImageLookup } from '../scene/textureImage';
import type { FaceFrame } from '../scene/pattern';
import type { PatternFace, PatternParams, Vec3 } from '../scene/types';
import { BEST_ENGINE, clipToRegion, heightSolid, prism, reliefAddition, reliefCutter } from './relief';
import { faceSurface } from './textureMap';
import type { GrayImage } from '../scene/textureMap';

/** Segmenti del cerchio nelle giunzioni arrotondate (gli stessi degli angoli arrotondati delle forme 2D). */
const ROUND_SEGMENTS = 32;
/** Segmenti nell'anteprima semplificata: angoli meno lisci ma calcolo molto più veloce. */
const PREVIEW_SEGMENTS = 8;
/** Passo (mm) delle mappe di altezze nell'anteprima: più rado di quello del risultato (0,5 mm). */
const PREVIEW_STEP = 0.8;

/**
 * Cella ridotta di metà parete (più il raggio) e poi arrotondata di `rounding`: così tra due celle resta una parete di
 * `wall` mm con gli angoli arrotondati. Restituisce null se la cella sparisce.
 */
function shrunk(wasm: ManifoldToplevel, cell: [number, number][], wall: number, rounding: number, segments: number): CrossSection | null {
  const { CrossSection } = wasm;
  const raw = new CrossSection([cell], 'NonZero');
  const inner = raw.offset(-(wall / 2 + rounding), 'Miter', 2, segments);
  raw.delete();
  if (inner.isEmpty()) {
    inner.delete();
    return null;
  }
  if (rounding <= 0) return inner;
  const rounded = inner.offset(rounding, 'Round', 2, segments);
  inner.delete();
  return rounded;
}

/**
 * Regione da lavorare di una faccia, nel riferimento della faccia (o null se è vuota). Passi: 1) si porta il pezzo nel
 * riferimento della faccia (faccia su z = 0, pezzo sotto); 2) la regione è la silhouette del pezzo (se `through`, `region`
 * non è 'face' e la faccia sta sugli assi) o la sua sezione appena sotto la faccia (il contorno vero della faccia), ridotta
 * del margine. Il chiamante possiede la regione.
 */
function faceRegion(child: Manifold, p: PatternParams, face: PatternFace, through: boolean, segments: number): { region: CrossSection; frame: FaceFrame } | null {
  const frame = faceFrame(face);
  const shifted = child.translate([-frame.origin[0], -frame.origin[1], -frame.origin[2]]);
  const inFrame = shifted.rotate(frame.euler);
  shifted.delete();
  // Faccia inclinata: la silhouette del pezzo lungo la normale invaderebbe le facce vicine, quindi la regione è sempre il
  // contorno della faccia e il taglio parte solo da lì (niente faccia opposta)
  const axisFace = isAxisFace(face);
  // Passante su una faccia sugli assi senza region 'face': silhouette di tutto il pezzo; altrimenti sezione appena sotto la
  // faccia (il contorno della faccia: così uno smusso accanto alla faccia non si fora)
  let region: CrossSection = through && axisFace && p.region !== 'face' ? inFrame.project() : inFrame.slice(-0.01);
  inFrame.delete();
  if (p.margin > 0) {
    const inset = region.offset(-p.margin, 'Miter', 2, segments);
    region.delete();
    region = inset;
  }
  if (region.isEmpty()) {
    region.delete();
    return null;
  }
  return { region, frame };
}

/** Riporta un solido dal riferimento della faccia a quello del pezzo (rotazione inversa e traslazione); `solid` si libera. */
function backToPiece(solid: Manifold, frame: FaceFrame): Manifold {
  const turned = solid.rotate(frame.inverseEuler);
  solid.delete();
  const moved = turned.translate(frame.origin as Vec3);
  turned.delete();
  return moved;
}

/**
 * Rilievo sottrattivo (Mattoni, Rame battuto, Legno) di una faccia: il solido da scavare nella regione della faccia (sempre il
 * suo contorno, mai la silhouette: `depth` e `sides` del Pattern non contano), ancorato al rettangolo della faccia così il
 * disegno non si sposta quando cambia il margine. Nell'anteprima semplificata calotte con meno segmenti e mappe di altezze più
 * rade; il risultato dopo l'OK è a qualità piena. Nel riferimento del pezzo, o null se non toglie nulla.
 */
function reliefCutterFor(wasm: ManifoldToplevel, child: Manifold, p: PatternParams, face: PatternFace, index: number): Manifold | null {
  const found = faceRegion(child, p, face, false, ROUND_SEGMENTS);
  if (!found) return null;
  const { relief } = patternRelief(p, index);
  const cutter = reliefCutter(wasm, found.region, relief, { engine: BEST_ENGINE[relief.kind], rect: frameRect(p, face), segments: p.preview ? PREVIEW_SEGMENTS : undefined, step: p.preview ? PREVIEW_STEP : undefined });
  found.region.delete();
  return cutter ? backToPiece(cutter, found.frame) : null;
}

/**
 * Rilievo additivo (Borchie) di una faccia: le borchie da unire al pezzo, sulla regione della faccia (sempre il suo contorno,
 * meno il margine). I centri sono quelli del calcolo puro (`studCentersOf`, gli stessi del codice OpenSCAD) e il contorno vero
 * ritaglia le borchie che lo sporgono. Nel riferimento del pezzo, o null se non resta nulla.
 */
function studAdditionFor(wasm: ManifoldToplevel, child: Manifold, p: PatternParams, face: PatternFace): Manifold | null {
  const found = faceRegion(child, p, face, false, ROUND_SEGMENTS);
  if (!found) return null;
  const { rect, centers } = studCentersOf(p, face);
  // Anteprima semplificata: cupole e cilindri con meno segmenti; il piede non esce dalla faccia opposta (`studEmbedOf`)
  const solid = reliefAddition(wasm, found.region, studRelief(p).relief, { engine: BEST_ENGINE.studs, rect, centers, embed: studEmbedOf(face), segments: p.preview ? PREVIEW_SEGMENTS : undefined });
  found.region.delete();
  return solid ? backToPiece(solid, found.frame) : null;
}

/**
 * Texture da immagine di una faccia: gli utensili nel riferimento del pezzo. Incavo: un solido da togliere; rilievo: una pelle da
 * unire (entra nel pezzo di `studEmbedOf`); entrambi: la colonna da togliere e poi la pelle da unire. La superficie
 * (`faceSurface`) è la griglia di quote che scrive anche il codice OpenSCAD; la regione è il contorno della faccia meno il
 * margine. Vuoto se la quota è nulla ovunque.
 */
function textureToolsFor(wasm: ManifoldToplevel, child: Manifold, p: PatternParams, face: PatternFace, image: GrayImage): { cut: Manifold[]; add: Manifold[] } {
  const found = faceRegion(child, p, face, false, ROUND_SEGMENTS);
  const none = { cut: [] as Manifold[], add: [] as Manifold[] };
  if (!found) return none;
  const { region, frame } = found;
  const surface = faceSurface(image, textureOf(p), frameRect(p, face), p.preview ? PREVIEW_STEP : 0.5, studEmbedOf(face), textureFloor(p));
  const tool = surface ? clipToRegion(wasm, heightSolid(wasm, surface.grid, surface.planeZ, surface.side), region, surface.zFrom, surface.zTo) : null;
  if (!surface || !tool) {
    region.delete();
    return none;
  }
  const out = { cut: [] as Manifold[], add: [] as Manifold[] };
  (surface.op === 'subtract' ? out.cut : out.add).push(backToPiece(tool, frame));
  // Entrambi: prima si toglie la colonna della regione fino sotto l'incavo più profondo, poi si unisce la pelle
  if (surface.column) out.cut.push(backToPiece(prism(wasm, region, surface.column[0], surface.column[1]), frame));
  region.delete();
  return out;
}

/**
 * Il solido da togliere per una faccia, nel riferimento del pezzo (o null se la faccia non taglia nulla).
 * Passi: 1) regione della faccia (vedi `faceRegion`); 2) le celle si riducono
 * per la parete, si arrotondano e si intersecano con la regione (Fori) oppure si tolgono da essa (Solchi); 3) si estrude
 * a partire dalla faccia (e dalla faccia opposta con `sides: 'both'`) e si riporta nel riferimento del pezzo.
 */
function cutterFor(wasm: ManifoldToplevel, child: Manifold, p: PatternParams, face: PatternFace, index: number): Manifold | null {
  const { Manifold, CrossSection } = wasm;
  // I rilievi hanno un ramo a parte: niente celle, regione sempre quella della faccia
  if (isReliefKind(p.kind)) return reliefCutterFor(wasm, child, p, face, index);
  const segments = p.preview ? PREVIEW_SEGMENTS : ROUND_SEGMENTS;
  const through = p.depth <= 0;
  const axisFace = isAxisFace(face);
  const found = faceRegion(child, p, face, through, segments);
  if (!found) return null;
  const { region, frame } = found;

  const shapes = patternCells(p, frameRect(p, face), index)
    .map((cell) => shrunk(wasm, cell, p.wall, p.rounding, segments))
    .filter((s): s is CrossSection => s !== null);
  const cellsSection = CrossSection.compose(shapes);
  shapes.forEach((s) => s.delete());
  const cut = p.mode === 'holes' ? cellsSection.intersect(region) : region.subtract(cellsSection);
  cellsSection.delete();
  region.delete();
  if (cut.isEmpty()) {
    cut.delete();
    return null;
  }

  // Prismi nel riferimento della faccia: passante = molto più lungo del pezzo; altrimenti `depth` sotto la faccia (e 1 mm sopra)
  const prisms: Manifold[] = [];
  if (through) {
    prisms.push(Manifold.extrude(cut, 2 * cutReach(p, face), 0, 0, [1, 1], true));
  } else {
    const slab = Manifold.extrude(cut, p.depth + 1, 0, 0, [1, 1], false);
    prisms.push(slab.translate([0, 0, -p.depth]));
    // Dalla faccia opposta (a `thickness` sotto): stessa profondità verso l'alto
    if (p.sides === 'both' && axisFace) prisms.push(slab.translate([0, 0, -face.thickness - 1]));
    slab.delete();
  }
  cut.delete();
  const cutterInFrame = prisms.length === 1 ? prisms[0] : Manifold.union(prisms);
  if (prisms.length > 1) prisms.forEach((m) => m.delete());
  return backToPiece(cutterInFrame, frame);
}

/**
 * Applica il pattern al pezzo (di proprietà del chiamante, non si libera) e restituisce un nuovo Manifold: il pezzo meno
 * i tagli di tutte le facce scelte (o, per le Borchie, più le borchie; per l'Immagine meno l'incavo e più il rilievo, `images` dà il grigio delle immagini caricate). Se nessuna faccia cambia nulla, il pezzo resta com'è.
 */
export function buildPattern(wasm: ManifoldToplevel, child: Manifold, params: PatternParams, images?: ImageLookup): Manifold {
  const { Manifold } = wasm;
  const p = normalizePattern(params);
  // Texture da immagine: utensili da togliere e da unire per ogni faccia; senza l'immagine (non caricata) il pezzo resta com'è
  if (p.kind === 'texture') {
    const image = imageOf(p, images);
    if (!image) return child.translate([0, 0, 0]);
    const tools = p.faces.map((face) => textureToolsFor(wasm, child, p, face, image));
    const cuts = tools.flatMap((t) => t.cut);
    const adds = tools.flatMap((t) => t.add);
    const base = cuts.length ? Manifold.difference([child, ...cuts]) : child.translate([0, 0, 0]);
    cuts.forEach((c) => c.delete());
    if (!adds.length) return base;
    const joined = Manifold.union([base, ...adds]);
    base.delete();
    adds.forEach((a) => a.delete());
    return joined;
  }
  // Rilievo additivo (Borchie): il pezzo più le borchie di ogni faccia, `depth` e `sides` non contano
  if (isAdditiveKind(p.kind)) {
    const additions = p.faces.map((face) => studAdditionFor(wasm, child, p, face)).filter((a): a is Manifold => a !== null);
    if (additions.length === 0) return child.translate([0, 0, 0]);
    const joined = Manifold.union([child, ...additions]);
    additions.forEach((a) => a.delete());
    return joined;
  }
  const cutters = p.faces.map((face, i) => cutterFor(wasm, child, p, face, i)).filter((c): c is Manifold => c !== null);
  if (cutters.length === 0) return child.translate([0, 0, 0]);
  const result = Manifold.difference([child, ...cutters]);
  cutters.forEach((c) => c.delete());
  return result;
}
