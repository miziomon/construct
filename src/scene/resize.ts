import type { PrimitiveNode, Shape2DNode, Vec3 } from './types';
import { round } from './math';
import { maxPolyhedronRadius, polygonMaxRadius } from './polyhedra';

/** Dimensione minima di una misura (mm): sotto il kernel produrrebbe geometrie degeneri. */
const MIN_SIZE = 0.1;

type Resizable = PrimitiveNode | Shape2DNode;

/** Parametri geometrici modificati (misure in mm), da passare a updateNode. */
export type ResizePatch = Record<string, number | Vec3>;

/** Fattore più lontano da 1 tra quelli indicati: è quello che l'utente sta trascinando. */
const farthest = (...factors: number[]) => factors.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a));

/**
 * Converte la scala applicata dal gizmo (sx, sy, sz, nel sistema locale dell'oggetto) nelle nuove misure.
 * La scala non resta sull'oggetto: diventa lato, raggio o altezza veri, così il codice OpenSCAD e l'export restano semplici.
 * `step` è il passo di arrotondamento delle misure (0,5 mm, o 0,01 mm con Shift).
 *
 * Forme con più assi indipendenti (cubo, quadrato) seguono sx, sy, sz; le forme rotonde usano un solo fattore
 * per il raggio (quello più lontano da 1 tra sx e sy) e sz per l'altezza; sfere, toro e solidi dei dadi sono uniformi.
 */
export function applyScale(node: Resizable, scale: Vec3, step = 0.5): ResizePatch {
  const [sx, sy, sz] = scale;
  const fxy = farthest(sx, sy);
  const uniform = farthest(sx, sy, sz);
  const q = (v: number) => Math.max(MIN_SIZE, round(Math.round(v / step) * step, 3));
  // Raggi che possono arrivare a zero (cono)
  const q0 = (v: number) => Math.max(0, round(Math.round(v / step) * step, 3));

  if (node.type === 'shape2d') {
    const height = q(node.height * sz);
    if (node.kind === 'circle') {
      const radius = q(node.radius * fxy);
      return { height, radius, cornerRadius: Math.min(node.cornerRadius ?? 0, polygonMaxRadius(radius, node.segments)) };
    }
    const width = q(node.width * sx);
    const depth = q(node.depth * sy);
    return { height, width, depth, cornerRadius: Math.min(node.cornerRadius, Math.max(0, Math.min(width, depth) / 2 - 0.01)) };
  }

  switch (node.kind) {
    case 'box': {
      const size = [q(node.size[0] * sx), q(node.size[1] * sy), q(node.size[2] * sz)] as Vec3;
      return { size, cornerRadius: Math.min(node.cornerRadius ?? 0, Math.max(0, Math.min(...size) / 2 - 0.01)) };
    }
    case 'cylinder':
      return { radius: q(node.radius * fxy), height: q(node.height * sz) };
    case 'cone':
      return { radiusBottom: q0(node.radiusBottom * fxy), radiusTop: q0(node.radiusTop * fxy), height: q(node.height * sz) };
    case 'sphere':
      return { radius: q(node.radius * uniform) };
    case 'torus':
      return { majorRadius: q(node.majorRadius * uniform), minorRadius: q(node.minorRadius * uniform) };
    case 'octahedron':
    case 'decahedron':
    case 'dodecahedron':
    case 'icosahedron': {
      const size = q(node.size * uniform);
      return { size, cornerRadius: Math.min(node.cornerRadius, maxPolyhedronRadius(size)) };
    }
  }
}
