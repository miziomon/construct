import { describe, expect, it } from 'vitest';
import { compensatePosition } from './pathPlacement';
import { apply, eulerToMatrix } from './math';
import type { Mirror } from './math';
import type { Vec2, Vec3 } from './types';

const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 4));

describe('compensatePosition', () => {
  it('senza rotazione né specchio lo spostamento del centro si somma alla posizione (lineare)', () => {
    expect(compensatePosition({ position: [10, 20, 5], rotation: [0, 0, 0] }, 'linear', [0, 0], [3, -2])).toEqual([13, 18, 5]);
  });

  it('rotazione Z di 90°: la X del disegno punta lungo Y nel mondo', () => {
    near(compensatePosition({ position: [0, 0, 5], rotation: [0, 0, 90] }, 'linear', [0, 0], [10, 0]), [0, 10, 5]);
    near(compensatePosition({ position: [0, 0, 5], rotation: [0, 0, 90] }, 'linear', [0, 0], [0, 4]), [-4, 0, 5]);
  });

  it('specchio su X: il segno della componente X si inverte', () => {
    near(compensatePosition({ position: [0, 0, 0], rotation: [0, 0, 0], mirror: [true, false, false] }, 'linear', [0, 0], [10, 5]), [-10, 5, 0]);
  });

  it('rotazionale: conta solo la Y del disegno, che è la quota Z (la X è il raggio e si adegua da sé)', () => {
    expect(compensatePosition({ position: [1, 2, 3], rotation: [0, 0, 0] }, 'rotate', [0, 0], [7, 4])).toEqual([1, 2, 7]);
    // Con il nodo coricato attorno a X la quota locale Z diventa -Y nel mondo
    near(compensatePosition({ position: [0, 0, 0], rotation: [90, 0, 0] }, 'rotate', [0, 0], [7, 3]), [0, -3, 0]);
    // Specchio su Z: inverte il segno della quota
    expect(compensatePosition({ position: [0, 0, 0], rotation: [0, 0, 0], mirror: [false, false, true] }, 'rotate', [0, 0], [0, 3])).toEqual([0, 0, -3]);
  });

  it('un centro che non si muove non sposta il nodo', () => {
    expect(compensatePosition({ position: [4, 5, 6], rotation: [10, 20, 30], mirror: [true, false, true] }, 'linear', [2, 3], [2, 3])).toEqual([4, 5, 6]);
  });

  it('un punto del disegno che non cambia resta fermo nel mondo con qualsiasi rotazione e specchio', () => {
    const rotation: Vec3 = [30, 45, 60];
    const mirror: Mirror = [true, false, true];
    const position: Vec3 = [7, -3, 11];
    const [before, after]: [Vec2, Vec2] = [[2, 5], [-1, 9]];
    // Punto fisso del disegno (coordinate dell'editor); localmente sta a (q - centro) in X e Y (scala 1)
    const q: Vec2 = [12, 20];
    const world = (pos: Vec3, c: Vec2, mode: 'linear' | 'rotate'): Vec3 => {
      // Lineare: [qx - cx, qy - cy, 0]. Rotazione: il punto sta a distanza qx dall'asse (traslazione di r) e a quota qy - cy
      const local: Vec3 = mode === 'linear' ? [q[0] - c[0], q[1] - c[1], 0] : [q[0], 0, q[1] - c[1]];
      const d: Vec3 = [mirror[0] ? -local[0] : local[0], mirror[1] ? -local[1] : local[1], mirror[2] ? -local[2] : local[2]];
      const w = apply(eulerToMatrix(rotation), d);
      return [w[0] + pos[0], w[1] + pos[1], w[2] + pos[2]];
    };
    for (const mode of ['linear', 'rotate'] as const) {
      const moved = compensatePosition({ position, rotation, mirror }, mode, before, after);
      near(world(moved, after, mode), world(position, before, mode));
    }
  });
});
