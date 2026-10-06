import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from '../kernel/evaluate';
import { primitiveDefaults, shape2dDefaults } from './defaults';
import { stretchFactors } from './ellipse';
import type { PrimitiveNode, Shape2DNode } from './types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const prim = (kind: Parameters<typeof primitiveDefaults>[0], patch: Record<string, unknown> = {}) =>
  ({ ...primitiveDefaults(kind), id: 'a', name: 'a', position: [0, 0, 0], ...patch }) as PrimitiveNode;
const shape = (patch: Record<string, unknown> = {}) =>
  ({ ...shape2dDefaults('circle'), id: 'a', name: 'a', position: [0, 0, 0], ...patch }) as Shape2DNode;
const build = (node: PrimitiveNode | Shape2DNode) => new Evaluator(wasm).evaluate({ nodes: { a: node }, rootIds: ['a'] }).meshes[0];

describe('stretchFactors', () => {
  it('forme proporzionali: nessun fattore', () => {
    expect(stretchFactors(prim('cylinder'))).toBeNull();
    expect(stretchFactors(prim('cylinder', { radiusY: 10 }))).toBeNull();
    expect(stretchFactors(prim('sphere', { radiusY: 10, radiusZ: 10 }))).toBeNull();
    expect(stretchFactors(prim('box'))).toBeNull();
  });

  it('forme non proporzionali: rapporti rispetto al raggio X', () => {
    expect(stretchFactors(prim('cylinder', { radiusY: 5 }))).toEqual([1, 0.5, 1]);
    expect(stretchFactors(prim('sphere', { radiusZ: 20 }))).toEqual([1, 1, 2]);
    expect(stretchFactors(shape({ radiusY: 20 }))).toEqual([1, 2, 1]);
  });

  it('cono: radiusY è il raggio Y dell estremità più larga', () => {
    expect(stretchFactors(prim('cone', { radiusBottom: 10, radiusTop: 4, radiusY: 5 }))).toEqual([1, 0.5, 1]);
    expect(stretchFactors(prim('cone', { radiusBottom: 2, radiusTop: 10, radiusY: 20 }))).toEqual([1, 2, 1]);
  });
});

describe('forme non proporzionali nel kernel', () => {
  it('cilindro ellittico: volume e ingombro seguono i due raggi', () => {
    const m = build(prim('cylinder', { radius: 10, radiusY: 5, height: 20 }));
    // Poligono a 64 lati con raggi 10 e 5, scalato in Y: area = 0,5 · n · rx · ry · sin(2π/n)
    const area = 0.5 * 64 * 10 * 5 * Math.sin((2 * Math.PI) / 64);
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeCloseTo(area * 20, 1);
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(20, 3);
    expect(m.bbox.max[1] - m.bbox.min[1]).toBeCloseTo(10, 3);
  });

  it('ellissoide: volume vicino a 4/3·π·rx·ry·rz e altezza 2·rz', () => {
    const m = build(prim('sphere', { radius: 10, radiusY: 5, radiusZ: 20 }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeGreaterThan((4 / 3) * Math.PI * 10 * 5 * 20 * 0.98);
    expect(m.volume).toBeLessThan((4 / 3) * Math.PI * 10 * 5 * 20 * 1.001);
    expect(m.bbox.max[2] - m.bbox.min[2]).toBeCloseTo(40, 3);
  });

  it('cono ellittico: l estremità larga ha il raggio Y indicato', () => {
    const m = build(prim('cone', { radiusBottom: 10, radiusTop: 0, radiusY: 4, height: 20 }));
    expect(m.status).toBe('NoError');
    expect(m.bbox.max[1] - m.bbox.min[1]).toBeCloseTo(8, 3);
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(20, 3);
  });

  it('cerchio 2D ellittico estruso: ingombro e volume', () => {
    const m = build(shape({ radius: 10, radiusY: 5, height: 10 }));
    const area = 0.5 * 64 * 10 * 5 * Math.sin((2 * Math.PI) / 64);
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeCloseTo(area * 10, 1);
    expect(m.bbox.max[1] - m.bbox.min[1]).toBeCloseTo(10, 3);
  });
});
