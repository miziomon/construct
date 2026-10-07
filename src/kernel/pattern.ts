import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { cutReach, faceFrame, frameRect, normalizePattern, patternCells } from '../scene/pattern';
import type { PatternFace, PatternParams, Vec3 } from '../scene/types';

/** Segmenti del cerchio nelle giunzioni arrotondate (gli stessi degli angoli arrotondati delle forme 2D). */
const ROUND_SEGMENTS = 32;
/** Segmenti nell'anteprima semplificata: angoli meno lisci ma calcolo molto più veloce. */
const PREVIEW_SEGMENTS = 8;

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
 * Il solido da togliere per una faccia, nel riferimento del pezzo (o null se la faccia non taglia nulla).
 * Passi: 1) si porta il pezzo nel riferimento della faccia (faccia su z = 0, pezzo sotto); 2) la regione da forare è la
 * silhouette del pezzo (passante) o la sua sezione appena sotto la faccia, ridotta del margine; 3) le celle si riducono
 * per la parete, si arrotondano e si intersecano con la regione (Fori) oppure si tolgono da essa (Solchi); 4) si estrude
 * a partire dalla faccia (e dalla faccia opposta con `sides: 'both'`) e si riporta nel riferimento del pezzo.
 */
function cutterFor(wasm: ManifoldToplevel, child: Manifold, p: PatternParams, face: PatternFace, index: number): Manifold | null {
  const { Manifold, CrossSection } = wasm;
  const segments = p.preview ? PREVIEW_SEGMENTS : ROUND_SEGMENTS;
  const frame = faceFrame(face);
  const shifted = child.translate([-frame.origin[0], -frame.origin[1], -frame.origin[2]]);
  const inFrame = shifted.rotate(frame.euler);
  shifted.delete();
  const through = p.depth <= 0;
  // Passante: silhouette di tutto il pezzo; con profondità: sezione appena sotto la faccia (il contorno della faccia)
  let region: CrossSection = through ? inFrame.project() : inFrame.slice(-0.01);
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
    if (p.sides === 'both') prisms.push(slab.translate([0, 0, -face.thickness - 1]));
    slab.delete();
  }
  cut.delete();
  const cutterInFrame = prisms.length === 1 ? prisms[0] : Manifold.union(prisms);
  if (prisms.length > 1) prisms.forEach((m) => m.delete());
  const turned = cutterInFrame.rotate(frame.inverseEuler);
  cutterInFrame.delete();
  const cutter = turned.translate(frame.origin as Vec3);
  turned.delete();
  return cutter;
}

/**
 * Applica il pattern al pezzo (di proprietà del chiamante, non si libera) e restituisce un nuovo Manifold: il pezzo meno
 * i tagli di tutte le facce scelte. Se nessuna faccia taglia nulla, il pezzo resta com'è.
 */
export function buildPattern(wasm: ManifoldToplevel, child: Manifold, params: PatternParams): Manifold {
  const { Manifold } = wasm;
  const p = normalizePattern(params);
  const cutters = p.faces.map((face, i) => cutterFor(wasm, child, p, face, i)).filter((c): c is Manifold => c !== null);
  if (cutters.length === 0) return child.translate([0, 0, 0]);
  const result = Manifold.difference([child, ...cutters]);
  cutters.forEach((c) => c.delete());
  return result;
}
