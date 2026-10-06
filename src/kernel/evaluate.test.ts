import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import type { GroupNode, PrimitiveNode, Scene, Shape2DNode } from '../scene/types';
import { primitiveDefaults, shape2dDefaults } from '../scene/defaults';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const prim = (id: string, kind: Parameters<typeof primitiveDefaults>[0], patch: Partial<PrimitiveNode> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults(kind), id, name: id, position: [0, 0, 0], ...patch }) as PrimitiveNode;

const shape = (id: string, kind: Parameters<typeof shape2dDefaults>[0], patch: Partial<Shape2DNode> = {}): Shape2DNode =>
  ({ ...shape2dDefaults(kind), id, name: id, position: [0, 0, 0], ...patch }) as Shape2DNode;

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

  it('differenza: il primo figlio meno gli altri, ignorando il modo solid/hole', () => {
    const a = prim('a', 'box', { size: [20, 20, 20] } as Partial<PrimitiveNode>);
    const b = prim('b', 'box', { size: [10, 20, 20], position: [5, 0, 0] } as Partial<PrimitiveNode>);
    const scene: Scene = { nodes: { a, b, g: group('g', ['a', 'b'], { op: 'difference' }) }, rootIds: ['g'] };
    const [m] = new Evaluator(wasm).evaluate(scene).meshes;
    expect(m.volume).toBeCloseTo(4000, 1); // resta metà scatola
    // Scambiando la base resta solo la parte di B che non si sovrappone: nulla, perché B sta dentro A
    const swapped: Scene = { nodes: { a, b, g: group('g', ['b', 'a'], { op: 'difference' }) }, rootIds: ['g'] };
    expect(new Evaluator(wasm).evaluate(swapped).meshes[0].empty).toBe(true);
  });

  describe('forme 2D estruse', () => {
    const volumeOf = (node: Shape2DNode) => new Evaluator(wasm).evaluate({ nodes: { a: node }, rootIds: ['a'] }).meshes[0];

    it('il cerchio con 6 lati è un esagono regolare ($fn = 6)', () => {
      const m = volumeOf(shape('a', 'circle', { radius: 10, segments: 6, height: 5 } as Partial<Shape2DNode>));
      expect(m.status).toBe('NoError');
      expect(m.volume).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 100 * 5, 1);
      // Il primo vertice sta a +X: l'ingombro in X è il diametro, in Y è l'apotema per due
      expect(m.bbox.max[0]).toBeCloseTo(10, 3);
      expect(m.bbox.max[1]).toBeCloseTo(10 * Math.sin(Math.PI / 3), 3);
    });

    it('con 3 lati è un triangolo equilatero', () => {
      const m = volumeOf(shape('a', 'circle', { radius: 10, segments: 3, height: 4 } as Partial<Shape2DNode>));
      expect(m.volume).toBeCloseTo(((3 * Math.sqrt(3)) / 4) * 100 * 4, 1);
      expect(m.indices.length / 3).toBe(8); // 2 triangoli di base + 6 di fianco
    });

    it('il quadrato con angoli arrotondati perde l area dei quattro angoli', () => {
      const m = volumeOf(shape('a', 'square', { width: 30, depth: 20, cornerRadius: 4, height: 10 } as Partial<Shape2DNode>));
      const area = 30 * 20 - (4 - Math.PI) * 16;
      expect(m.volume / 10).toBeCloseTo(area, 0);
      expect(m.bbox.max[0]).toBeCloseTo(15, 3);
    });

    it('la scala della cima a 0 produce un cono (un terzo del prisma)', () => {
      const prism = volumeOf(shape('a', 'circle', { radius: 10, segments: 32, height: 9 } as Partial<Shape2DNode>));
      const cone = volumeOf(shape('a', 'circle', { radius: 10, segments: 32, height: 9, scaleTop: 0 } as Partial<Shape2DNode>));
      expect(cone.volume).toBeCloseTo(prism.volume / 3, 0);
    });

    it('la torsione conserva il volume e ruota la cima in senso antiorario per valori positivi', () => {
      const flat = volumeOf(shape('a', 'square', { width: 20, depth: 2, height: 10 } as Partial<Shape2DNode>));
      const twisted = volumeOf(shape('a', 'square', { width: 20, depth: 2, height: 10, twist: 45 } as Partial<Shape2DNode>));
      expect(twisted.status).toBe('NoError');
      // Profilo sottile 10:1, il caso peggiore: con passi di 2° l'errore resta sotto il 6% (a 5° era del 13%)
      expect(Math.abs(twisted.volume / flat.volume - 1)).toBeLessThan(0.06);
      // Vertici della faccia superiore (z = +5): con rotazione antioraria di 45° l'asse lungo punta verso (1, 1)
      let alongPlus = -Infinity;
      let alongMinus = -Infinity;
      for (let i = 0; i < twisted.positions.length; i += 3) {
        if (Math.abs(twisted.positions[i + 2] - 5) > 1e-3) continue;
        alongPlus = Math.max(alongPlus, twisted.positions[i] + twisted.positions[i + 1]);
        alongMinus = Math.max(alongMinus, twisted.positions[i] - twisted.positions[i + 1]);
      }
      expect(alongPlus).toBeGreaterThan(alongMinus + 5);
    });
  });

  it('scatola arrotondata: volume del solido di Minkowski scatola + sfera e tempo di calcolo', () => {
    const [a, r] = [20, 2];
    const box = prim('a', 'box', { size: [a, a, a], cornerRadius: r } as Partial<PrimitiveNode>);
    const { meshes, ms } = new Evaluator(wasm).evaluate({ nodes: { a: box }, rootIds: ['a'] });
    const c = a - 2 * r;
    const expected = c ** 3 + 2 * r * 3 * c ** 2 + Math.PI * r * r * 3 * c + (4 / 3) * Math.PI * r ** 3;
    expect(meshes[0].status).toBe('NoError');
    expect(meshes[0].volume / expected).toBeGreaterThan(0.99);
    expect(meshes[0].volume / expected).toBeLessThan(1.001);
    // Ingombro invariato: le facce restano piane alla distanza originale
    expect(meshes[0].bbox.max[0]).toBeCloseTo(10, 3);
    expect(ms).toBeLessThan(200);
  });
});
