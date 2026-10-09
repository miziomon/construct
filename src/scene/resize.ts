import type { PrimitiveNode, Shape2DNode, Vec3 } from './types';
import { round } from './math';
import { primitiveDefaults, shape2dDefaults } from './defaults';
import { svgNaturalSize } from './shapes2d';
import { clampProfile, isBarShape, thicknessAxes } from './profiles';
import { maxPolyhedronRadius, polygonMaxRadius } from './polyhedra';

/** Dimensione minima di una misura (mm): sotto il kernel produrrebbe geometrie degeneri. */
const MIN_SIZE = 0.1;

type Resizable = PrimitiveNode | Shape2DNode;

/** Parametri geometrici modificati (misure in mm), da passare a updateNode. `undefined` toglie un campo opzionale. */
export type ResizePatch = Record<string, number | Vec3 | undefined>;

/**
 * Proporzioni bloccate? Gli SVG lo sono finché non si apre il lucchetto; le altre forme restano libere finché non si
 * chiude (così i progetti salvati prima del lucchetto si comportano come sempre).
 */
export const isRatioLocked = (node: Resizable): boolean => (node.type === 'shape2d' && node.kind === 'svg' ? node.lockRatio !== false : node.lockRatio === true);

/** Misure scalate dello stesso fattore: la più grande si arrotonda, le altre ne seguono il rapporto esatto. */
function proportional(values: readonly number[], factor: number, q: (v: number, s: number) => number): number[] {
  const largest = Math.max(...values);
  const scaledLargest = q(largest, factor);
  return values.map((v) => (v === largest ? scaledLargest : Math.max(MIN_SIZE, round(v * (scaledLargest / largest), 3))));
}

/** Fattore più lontano da 1 tra quelli indicati: è quello che l'utente sta trascinando. */
const farthest = (...factors: number[]) => factors.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a));

/**
 * Converte la scala applicata dal gizmo (sx, sy, sz, nel sistema locale dell'oggetto) nelle nuove misure.
 * La scala non resta sull'oggetto: diventa lato, raggio o altezza veri, così il codice OpenSCAD e l'export restano semplici.
 * `step` è il passo di arrotondamento delle misure (0,5 mm, o 0,01 mm con Shift). Un asse con fattore 1 non cambia
 * (nemmeno per l'arrotondamento).
 *
 * Cubo, quadrato, cilindro, cono, cerchio e sfera seguono ogni asse in modo indipendente (anche non proporzionale,
 * con il raggio Y e Z opzionali); toro e solidi dei dadi restano uniformi, con il fattore più lontano da 1.
 */
export function applyScale(node: Resizable, scale: Vec3, step = 0.5): ResizePatch {
  const [sx, sy, sz] = scale;
  const uniform = farthest(sx, sy, sz);
  const snap = (v: number) => round(Math.round(v / step) * step, 3);
  /** Nuova misura (almeno MIN_SIZE) se il fattore cambia qualcosa, altrimenti quella di prima. */
  const q = (v: number, s: number) => (s === 1 ? v : Math.max(MIN_SIZE, snap(v * s)));
  /** Come q, ma può arrivare a zero (raggio superiore del cono). */
  const q0 = (v: number, s: number) => (s === 1 ? v : Math.max(0, snap(v * s)));
  /** Raggio opzionale: se coincide con quello X la forma torna tonda e il campo si toglie. */
  const optional = (value: number, base: number) => (Math.abs(value - base) < 1e-9 ? undefined : value);

  if (node.type === 'shape2d') {
    // Estrusione rotazionale: la Z non è un'altezza lineare, quindi la maniglia Z non cambia nulla e il raggio dall'asse
    // segue la media di X e Y
    const rotate = node.extrusion === 'rotate';
    // Con il lucchetto X e Y seguono lo stesso fattore (quello trascinato), così il disegno non si deforma
    const locked = isRatioLocked(node);
    const fx = locked ? farthest(sx, sy) : sx;
    const fy = locked ? farthest(sx, sy) : sy;
    const common: ResizePatch = {
      ...(rotate ? {} : { height: q(node.height, sz) }),
      ...(rotate && node.revolveRadius !== undefined ? { revolveRadius: q0(node.revolveRadius, (fx + fy) / 2) } : {}),
    };
    if (node.kind === 'circle') {
      const radius = q(node.radius, fx);
      const currentY = node.radiusY ?? node.radius;
      // Bloccato: il rapporto tra i due raggi resta quello di prima (nessuna deriva da arrotondamento)
      const radiusY = locked && fx !== 1 ? Math.max(MIN_SIZE, round(currentY * (radius / node.radius), 3)) : q(currentY, fy);
      return {
        ...common,
        radius,
        radiusY: optional(radiusY, radius),
        cornerRadius: Math.min(node.cornerRadius ?? 0, polygonMaxRadius(Math.min(radius, radiusY), node.segments)),
      };
    }
    // Testo: la dimensione segue la media dei due assi del piano
    if (node.kind === 'text') return { ...common, size: q(node.size, (fx + fy) / 2) };
    if (node.kind === 'tubeRound') {
      // Tubo tondo: raggio e parete seguono la media dei due assi (resta tondo)
      const next = clampProfile({ ...node, radius: q(node.radius, (fx + fy) / 2), wall: q(node.wall, (fx + fy) / 2) });
      return { ...common, radius: next.radius, wall: next.wall };
    }
    const width = q(node.width, fx);
    const depth = locked && fx !== 1 ? Math.max(MIN_SIZE, round(node.depth * (width / node.width), 3)) : q(node.depth, fy);
    if (isBarShape(node)) {
      // Profilati: anche gli spessori seguono l'asse lungo cui si misurano, così la sezione si scala senza deformarsi
      const axes = thicknessAxes(node.kind);
      const factor = (axis: 0 | 1) => (axis === 0 ? fx : fy);
      const next = clampProfile({ ...node, width, depth, flange: q(node.flange, factor(axes.flange)), web: q(node.web, factor(axes.web)) });
      return { ...common, width, depth, flange: next.flange, web: next.web, rootRadius: next.rootRadius, tipSize: next.tipSize };
    }
    if (node.kind === 'tubeRect') {
      // Tubo rettangolare: la parete segue il fattore minore (così non supera mai metà del lato), il raggio idem
      const f = Math.min(fx, fy);
      const next = clampProfile({ ...node, width, depth, wall: q(node.wall, f), cornerRadius: Math.max(0, snap((node.cornerRadius ?? 0) * f)) });
      return { ...common, width, depth, wall: next.wall, cornerRadius: next.cornerRadius };
    }
    // Forme poligonali e SVG: solo l'ingombro (il parametro `ratio` è una proporzione e non cambia)
    if (node.kind !== 'square') return { ...common, width, depth };
    return { ...common, width, depth, cornerRadius: Math.min(node.cornerRadius, Math.max(0, Math.min(width, depth) / 2 - 0.01)) };
  }

  switch (node.kind) {
    case 'box': {
      // Con il lucchetto i tre lati seguono lo stesso fattore e restano nello stesso rapporto
      const f = isRatioLocked(node) ? farthest(sx, sy, sz) : undefined;
      const size = (f === undefined ? [q(node.size[0], sx), q(node.size[1], sy), q(node.size[2], sz)] : proportional(node.size, f, q)) as Vec3;
      return { size, cornerRadius: Math.min(node.cornerRadius ?? 0, Math.max(0, Math.min(...size) / 2 - 0.01)) };
    }
    case 'cylinder': {
      const radius = q(node.radius, sx);
      return { radius, radiusY: optional(q(node.radiusY ?? node.radius, sy), radius), height: q(node.height, sz) };
    }
    case 'cone': {
      const radiusBottom = q0(node.radiusBottom, sx);
      const radiusTop = q0(node.radiusTop, sx);
      // Il raggio Y è quello dell'estremità più larga: se coincide con il raggio X il cono torna tondo
      const radiusY = q(node.radiusY ?? Math.max(node.radiusBottom, node.radiusTop), sy);
      return { radiusBottom, radiusTop, radiusY: optional(radiusY, Math.max(radiusBottom, radiusTop)), height: q(node.height, sz) };
    }
    case 'sphere': {
      const radius = q(node.radius, sx);
      return {
        radius,
        radiusY: optional(q(node.radiusY ?? node.radius, sy), radius),
        radiusZ: optional(q(node.radiusZ ?? node.radius, sz), radius),
      };
    }
    case 'torus':
      return { majorRadius: q(node.majorRadius, uniform), minorRadius: q(node.minorRadius, uniform) };
    case 'octahedron':
    case 'decahedron':
    case 'dodecahedron':
    case 'icosahedron': {
      const size = q(node.size, uniform);
      return { size, cornerRadius: Math.min(node.cornerRadius, maxPolyhedronRadius(size)) };
    }
  }
}

/**
 * Modifica di una singola misura con il lucchetto chiuso: la misura cambia e le altre scalano dello stesso fattore.
 * `index` indica il lato del cubo (0 = X, 1 = Y, 2 = Z). Restituisce null se la misura non ha altre con cui legarsi
 * (testo, cilindro, ...): chi chiama usa allora la modifica semplice.
 */
export function lockedPatch(node: Resizable, key: string, value: number, index = 0): ResizePatch | null {
  const scaled = (v: number, f: number) => Math.max(MIN_SIZE, round(v * f, 3));
  if (node.type === 'primitive' && node.kind === 'box' && key === 'size') {
    const f = value / node.size[index];
    return { size: node.size.map((v, i) => (i === index ? value : scaled(v, f))) as Vec3 };
  }
  if (node.type !== 'shape2d') return null;
  if (node.kind === 'circle') {
    if (key === 'radius') return { radius: value, radiusY: node.radiusY === undefined ? undefined : scaled(node.radiusY, value / node.radius) };
    if (key === 'radiusY') {
      const f = value / (node.radiusY ?? node.radius);
      return { radius: scaled(node.radius, f), radiusY: value };
    }
    return null;
  }
  // Testo e tubo tondo hanno una sola misura: niente da legare
  if (node.kind === 'text' || node.kind === 'tubeRound') return null;
  if (key !== 'width' && key !== 'depth') return null;
  const f = key === 'width' ? value / node.width : value / node.depth;
  const outline = key === 'width' ? { width: value, depth: scaled(node.depth, f) } : { depth: value, width: scaled(node.width, f) };
  // Profilati: con il lucchetto chiuso anche pareti, raccordi e punte scalano dello stesso fattore (la sezione non si deforma)
  if (isBarShape(node)) {
    const next = clampProfile({ ...node, ...outline, flange: scaled(node.flange, f), web: scaled(node.web, f), rootRadius: (node.rootRadius ?? 0) * f, tipSize: (node.tipSize ?? 0) * f });
    return { ...outline, flange: next.flange, web: next.web, rootRadius: round(next.rootRadius ?? 0, 3), tipSize: round(next.tipSize ?? 0, 3) };
  }
  if (node.kind === 'tubeRect') {
    const next = clampProfile({ ...node, ...outline, wall: scaled(node.wall, f), cornerRadius: (node.cornerRadius ?? 0) * f });
    return { ...outline, wall: next.wall, cornerRadius: round(next.cornerRadius ?? 0, 3) };
  }
  return outline;
}

/** Misura principale che la Scala usa come riferimento (cubo: lato X, cerchio: raggio, testo: dimensione, il resto: larghezza). */
function primaryMeasure(node: Resizable): number {
  if (node.type === 'primitive') return node.kind === 'box' ? node.size[0] : 1;
  if (node.kind === 'circle' || node.kind === 'tubeRound') return node.radius;
  if (node.kind === 'text') return node.size;
  return node.width;
}

/** Misura principale predefinita: 100 % della Scala. Per gli SVG è la larghezza del file, per le altre la misura iniziale della forma. */
export function scaleReference(node: Resizable): number {
  if (node.type === 'shape2d' && node.kind === 'svg') return svgNaturalSize(node).width;
  return primaryMeasure(node.type === 'primitive' ? ({ ...primitiveDefaults(node.kind), id: '', name: '', position: [0, 0, 0] } as PrimitiveNode) : ({ ...shape2dDefaults(node.kind), id: '', name: '', position: [0, 0, 0] } as Shape2DNode));
}

/** Se la forma ha una Scala in percentuale (cubo e forme 2D). */
export const hasScale = (node: Resizable): boolean => (node.type === 'primitive' ? node.kind === 'box' : true);

/** Scala attuale in percentuale della misura iniziale (100 = come appena creata). */
export function scalePercent(node: Resizable): number {
  const reference = scaleReference(node);
  return reference > 0 ? (primaryMeasure(node) / reference) * 100 : 100;
}

/**
 * Misure per portare la forma alla Scala indicata, sempre in proporzione: un fattore uniforme su X e Y (e su Z per il
 * cubo). L'altezza di un'estrusione 2D non cambia.
 */
export function scalePatch(node: Resizable, percent: number): ResizePatch {
  const current = primaryMeasure(node);
  const target = (scaleReference(node) * percent) / 100;
  const f = current > 0 ? target / current : 1;
  return applyScale(node, [f, f, node.type === 'primitive' ? f : 1], 0.01);
}
