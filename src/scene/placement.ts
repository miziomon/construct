import type { Vec3 } from './types';

/**
 * Calcoli puri di Allinea e Specchia sugli ingombri (box nel mondo): li usano sia le azioni sia l'anteprima nella
 * vista 3D, così quello che si vede prima del clic è esattamente quello che succede dopo.
 */

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Lato dell'ingombro della selezione su cui si allinea o passa il piano di specchio. */
export type AlignTarget = 'min' | 'center' | 'max';

/** Ingombro che contiene tutti gli ingombri dati. */
export function unionBounds(list: Bounds[]): Bounds {
  return {
    min: [0, 1, 2].map((i) => Math.min(...list.map((b) => b.min[i]))) as Vec3,
    max: [0, 1, 2].map((i) => Math.max(...list.map((b) => b.max[i]))) as Vec3,
  };
}

/** Coordinata, sull'asse, del lato scelto di un ingombro (minimo, centro o massimo). */
export function sideOf(b: Bounds, axis: 0 | 1 | 2, target: AlignTarget): number {
  return target === 'min' ? b.min[axis] : target === 'max' ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2;
}

/**
 * Spostamento di ogni ingombro perché il suo lato `target` coincida con quello dell'ingombro complessivo.
 * L'ordine delle chiavi segue quello di `bounds`.
 */
export function alignDeltas(bounds: Record<string, Bounds>, axis: 0 | 1 | 2, target: AlignTarget): Record<string, Vec3> {
  const goal = sideOf(unionBounds(Object.values(bounds)), axis, target);
  const deltas: Record<string, Vec3> = {};
  for (const [id, b] of Object.entries(bounds)) {
    const delta: Vec3 = [0, 0, 0];
    delta[axis] = goal - sideOf(b, axis, target);
    deltas[id] = delta;
  }
  return deltas;
}

/** Ingombro spostato di `delta`. */
export function shiftBounds(b: Bounds, delta: Vec3): Bounds {
  return { min: b.min.map((v, i) => v + delta[i]) as Vec3, max: b.max.map((v, i) => v + delta[i]) as Vec3 };
}

/** Coordinata del piano di specchio: il lato `target` dell'ingombro complessivo degli oggetti da specchiare. */
export function mirrorPlane(bounds: Bounds[], axis: 0 | 1 | 2, target: AlignTarget): number {
  return sideOf(unionBounds(bounds), axis, target);
}

/** Ingombro riflesso rispetto al piano `plane` perpendicolare all'asse. */
export function mirrorBounds(b: Bounds, axis: 0 | 1 | 2, plane: number): Bounds {
  const min: Vec3 = [...b.min];
  const max: Vec3 = [...b.max];
  min[axis] = 2 * plane - b.max[axis];
  max[axis] = 2 * plane - b.min[axis];
  return { min, max };
}
