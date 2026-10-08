import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { shape2dDefaults } from '../scene/defaults';
import type { Scene, Shape2DNode } from '../scene/types';
import { Evaluator } from './evaluate';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Pala sottile 120 × 5 mm alta 120 mm, con la torsione data. */
const blade = (twist: number): Scene => ({
  nodes: { a: { ...shape2dDefaults('square'), id: 'a', name: 'a', position: [0, 0, 60], width: 120, depth: 5, height: 120, twist } as Shape2DNode },
  rootIds: ['a'],
});

describe('estrusione con torsione di un profilo sottile', () => {
  it.each([160, -160, 45, -45])('il volume resta quello del prisma (torsione %d°)', (twist) => {
    const [m] = new Evaluator(wasm).evaluate(blade(twist)).meshes;
    expect(m.status).toBe('NoError');
    // Senza suddividere i lati il volume sbagliava del 14% (in più o in meno secondo il verso)
    expect(Math.abs(m.volume - 72000) / 72000).toBeLessThan(0.01);
  });

  it('senza torsione resta un prisma esatto', () => {
    const [m] = new Evaluator(wasm).evaluate(blade(0)).meshes;
    expect(m.volume).toBeCloseTo(72000, 1);
  });
});
