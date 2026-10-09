import { describe, expect, it } from 'vitest';
import { layDownState, layDownStep } from './layDown';
import { apply, eulerToMatrix } from './math';
import type { Vec3 } from './types';

const up = (rotation: Vec3) => apply(eulerToMatrix(rotation), [0, 0, 1]);

describe('Sdraia', () => {
  it('ciclo completo da in piedi: lungo X, poi lungo Y, poi di nuovo in piedi', () => {
    const center: Vec3 = [10, 5, 20];
    let node = { position: [10, 5, 20] as Vec3, rotation: [0, 0, 0] as Vec3 };
    expect(layDownState(node.rotation)).toBe('upright');
    node = layDownStep(node, center);
    expect(up(node.rotation).map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, 0]);
    expect(layDownState(node.rotation)).toBe('alongX');
    node = layDownStep(node, center);
    expect(up(node.rotation).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, 0]);
    expect(layDownState(node.rotation)).toBe('other');
    node = layDownStep(node, center);
    expect(up(node.rotation).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 1]);
    // Ruotando attorno al centro dell'ingombro (che coincide con la posizione) la posizione non cambia
    expect(node.position).toEqual([10, 5, 20]);
  });

  it('la posizione ruota attorno al centro dato, non attorno all\'origine', () => {
    const node = { position: [0, 0, 20] as Vec3, rotation: [0, 0, 0] as Vec3 };
    const next = layDownStep(node, [0, 0, 0]);
    // Rotazione di 90° attorno a Y: il punto (0, 0, 20) va in (20, 0, 0)
    expect(next.position).toEqual([20, 0, 0]);
  });

  it('un oggetto inclinato in modo qualsiasi torna in piedi in un passo', () => {
    const node = { position: [0, 0, 0] as Vec3, rotation: [35, -20, 70] as Vec3 };
    expect(layDownState(node.rotation)).toBe('other');
    const next = layDownStep(node, [0, 0, 0]);
    const dz = up(next.rotation);
    expect(dz[2]).toBeCloseTo(1, 6);
    expect(layDownState(next.rotation)).toBe('upright');
  });
});
