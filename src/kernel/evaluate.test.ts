import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import type { GroupNode, PrimitiveNode, Scene } from '../scene/types';
import { primitiveDefaults } from '../scene/defaults';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const prim = (id: string, kind: Parameters<typeof primitiveDefaults>[0], patch: Partial<PrimitiveNode> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults(kind), id, name: id, position: [0, 0, 0], ...patch }) as PrimitiveNode;

const group = (id: string, children: string[], patch: Partial<GroupNode> = {}): GroupNode => ({
  id, name: id, type: 'group', op: 'union', children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#fff', ...patch,
});

describe('Evaluator', () => {
  it('calcola il volume di una scatola', () => {
    const scene: Scene = { nodes: { a: prim('a', 'box', { size: [20, 20, 20] } as Partial<PrimitiveNode>) }, rootIds: ['a'] };
    const ev = new Evaluator(wasm);
    const [m] = ev.evaluate(scene).meshes;
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeCloseTo(8000, 1);
    expect(m.indices.length / 3).toBe(12);
  });

  it('sottrae un hole da un solid dentro un gruppo', () => {
    // Scatola 20 mm con foro cilindrico passante r=5 (poligono a 64 lati)
    const box = prim('box', 'box', { size: [20, 20, 20] } as Partial<PrimitiveNode>);
    const hole = prim('hole', 'cylinder', { radius: 5, height: 40, mode: 'hole' } as Partial<PrimitiveNode>);
    const scene: Scene = { nodes: { box, hole, g: group('g', ['box', 'hole']) }, rootIds: ['g'] };
    const ev = new Evaluator(wasm);
    const [m] = ev.evaluate(scene).meshes;
    // Area del poligono regolare a 64 lati con raggio 5
    const area = 0.5 * 64 * 25 * Math.sin((2 * Math.PI) / 64);
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeCloseTo(8000 - area * 20, 1);
  });

  it('applica rotazione e traslazione nell ordine X, Y, Z', () => {
    // Una barra lunga in X, ruotata di 90° attorno a Z, diventa lunga in Y
    const bar = prim('bar', 'box', { size: [40, 4, 4], rotation: [0, 0, 90], position: [10, 0, 0] } as Partial<PrimitiveNode>);
    const scene: Scene = { nodes: { bar }, rootIds: ['bar'] };
    const [m] = new Evaluator(wasm).evaluate(scene).meshes;
    expect(m.bbox.min[1]).toBeCloseTo(-20, 3);
    expect(m.bbox.max[1]).toBeCloseTo(20, 3);
    expect(m.bbox.min[0]).toBeCloseTo(8, 3);
    expect(m.bbox.max[0]).toBeCloseTo(12, 3);
  });

  it('intersezione di due sfere sovrapposte non è vuota', () => {
    const a = prim('a', 'sphere', { radius: 10 } as Partial<PrimitiveNode>);
    const b = prim('b', 'sphere', { radius: 10, position: [10, 0, 0] } as Partial<PrimitiveNode>);
    const scene: Scene = { nodes: { a, b, g: group('g', ['a', 'b'], { op: 'intersection' }) }, rootIds: ['g'] };
    const [m] = new Evaluator(wasm).evaluate(scene).meshes;
    expect(m.empty).toBe(false);
    expect(m.volume).toBeGreaterThan(0);
    expect(m.bbox.min[0]).toBeGreaterThan(-0.01);
  });

  it('costruisce toro e cono con volumi plausibili', () => {
    const torus = prim('t', 'torus', { majorRadius: 12, minorRadius: 4 } as Partial<PrimitiveNode>);
    const cone = prim('c', 'cone', { radiusBottom: 0, radiusTop: 10, height: 20 } as Partial<PrimitiveNode>);
    const scene: Scene = { nodes: { t: torus, c: cone }, rootIds: ['t', 'c'] };
    const [t, c] = new Evaluator(wasm).evaluate(scene).meshes;
    expect(t.volume).toBeCloseTo(2 * Math.PI * Math.PI * 12 * 16, -2); // 2π²Rr² con tolleranza di faccettatura
    expect(c.volume).toBeCloseTo((Math.PI * 100 * 20) / 3, -1);
    expect(c.status).toBe('NoError');
  });

  it('la cache riusa i nodi invariati e libera quelli rimossi', () => {
    const a = prim('a', 'box');
    const b = prim('b', 'sphere', { position: [30, 0, 0] } as Partial<PrimitiveNode>);
    const ev = new Evaluator(wasm);
    ev.evaluate({ nodes: { a, b }, rootIds: ['a', 'b'] });
    // @ts-expect-error accesso al campo privato solo nel test
    expect(ev.cache.size).toBe(2);
    ev.evaluate({ nodes: { a }, rootIds: ['a'] });
    // @ts-expect-error accesso al campo privato solo nel test
    expect(ev.cache.size).toBe(1);
    // Una seconda valutazione identica non deve fallire usando handle in cache
    const [m] = ev.evaluate({ nodes: { a }, rootIds: ['a'] }).meshes;
    expect(m.volume).toBeCloseTo(8000, 1);
  });

  it('20 oggetti in un gruppo con 10 fori si calcolano rapidamente', () => {
    const nodes: Scene['nodes'] = {};
    const kids: string[] = [];
    for (let i = 0; i < 10; i++) {
      nodes[`s${i}`] = prim(`s${i}`, 'box', { size: [8, 8, 8], position: [i * 6, 0, 0] } as Partial<PrimitiveNode>);
      nodes[`h${i}`] = prim(`h${i}`, 'cylinder', { radius: 2, height: 20, position: [i * 6, 0, 0], mode: 'hole' } as Partial<PrimitiveNode>);
      kids.push(`s${i}`, `h${i}`);
    }
    nodes.g = group('g', kids);
    const { ms, meshes } = new Evaluator(wasm).evaluate({ nodes, rootIds: ['g'] });
    expect(meshes[0].status).toBe('NoError');
    expect(ms).toBeLessThan(500); // soglia larga per CI lente; il criterio del POC è 200 ms su desktop
  });
});
