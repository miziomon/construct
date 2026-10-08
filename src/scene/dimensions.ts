import { applyScale, type ResizePatch } from './resize';
import { resizeGroup, type LocalBox } from './groupScale';
import { round } from './math';
import type { SceneNode, Vec3 } from './types';

/** Misura minima che si può assegnare a una quota (mm): sotto il kernel produrrebbe geometrie degeneri. */
export const MIN_DIMENSION = 0.1;

export type Axis = 0 | 1 | 2;

/** Lunghezze dell'ingombro lungo X, Y e Z del sistema locale dell'oggetto. */
export const sizeOfBox = (box: LocalBox): Vec3 => [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];

/**
 * Modifiche allo store per portare l'ingombro dell'oggetto a `value` mm lungo `axis` (la quota cliccata nella vista).
 * `box` è l'ingombro attuale nel sistema locale dell'oggetto. Restituisce null se la misura non è valida o il nodo non si
 * ridimensiona (raccordi e smussi). Le proporzioni bloccate e le forme a una sola misura (toro, dadi, testo) si
 * comportano come con il gizmo: gli altri assi seguono. Con `uniform` (il lucchetto delle quote) tutti gli assi scalano dello
 * stesso fattore, qualunque sia la forma. La base resta dov'era: chi applica la patch chiama `queueKeepBase`.
 */
export function resizeAxisPatch(node: SceneNode, box: LocalBox, axis: Axis, value: number, uniform = false): ResizePatch | null {
  const current = sizeOfBox(box)[axis];
  if (!Number.isFinite(value) || value < MIN_DIMENSION || !Number.isFinite(current) || current <= 0) return null;
  const f = value / current;
  /** Fattore sul solo asse indicato, 1 sugli altri. */
  const only = (extra: Axis[] = []): Vec3 => [0, 1, 2].map((i) => (uniform || i === axis || extra.includes(i as Axis) ? f : 1)) as Vec3;

  switch (node.type) {
    case 'primitive':
      // 0,001 mm: la misura digitata non si arrotonda al mezzo millimetro del gizmo
      return applyScale(node, only(), 0.001);
    case 'shape2d':
      // Il testo ha una sola misura (la dimensione del carattere): X e Y vanno insieme
      return applyScale(node, node.kind === 'text' && axis !== 2 ? only([0, 1]) : only(), 0.001);
    case 'group': {
      // Il centro della base resta fermo; il passo di 0,01 mm basta per una misura digitata
      const result = resizeGroup(node, box, only(), 0.01);
      return { groupScale: result.scale, position: result.position };
    }
    case 'mesh':
      // Una mesh importata si scala solo in modo uniforme
      return { scale: round(node.scale * f, 4) };
    default:
      return null;
  }
}
