import type { PrimitiveNode, Shape2DNode, Vec3 } from './types';
import { round } from './math';
import { maxPolyhedronRadius, polygonMaxRadius } from './polyhedra';

/** Dimensione minima di una misura (mm): sotto il kernel produrrebbe geometrie degeneri. */
const MIN_SIZE = 0.1;

type Resizable = PrimitiveNode | Shape2DNode;

/** Parametri geometrici modificati (misure in mm), da passare a updateNode. `undefined` toglie un campo opzionale. */
export type ResizePatch = Record<string, number | Vec3 | undefined>;

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
    const height = q(node.height, sz);
    if (node.kind === 'circle') {
      const radius = q(node.radius, sx);
      const radiusY = q(node.radiusY ?? node.radius, sy);
      return {
        height,
        radius,
        radiusY: optional(radiusY, radius),
        cornerRadius: Math.min(node.cornerRadius ?? 0, polygonMaxRadius(Math.min(radius, radiusY), node.segments)),
      };
    }
    const width = q(node.width, sx);
    const depth = q(node.depth, sy);
    return { height, width, depth, cornerRadius: Math.min(node.cornerRadius, Math.max(0, Math.min(width, depth) / 2 - 0.01)) };
  }

  switch (node.kind) {
    case 'box': {
      const size = [q(node.size[0], sx), q(node.size[1], sy), q(node.size[2], sz)] as Vec3;
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
