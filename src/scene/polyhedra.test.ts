import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from '../kernel/evaluate';
import { primitiveDefaults, shape2dDefaults } from './defaults';
import { polygonMaxRadius, polygonShrunkRadius, polyhedronVertices } from './polyhedra';
import type { PolyhedronKind, PrimitiveNode, Scene, Shape2DNode } from './types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const KINDS: PolyhedronKind[] = ['octahedron', 'decahedron', 'dodecahedron', 'icosahedron'];
const PHI = (1 + Math.sqrt(5)) / 2;

/** Valuta un solido da dado di 20 mm (opzionalmente arrotondato). */
function build(kind: PolyhedronKind, cornerRadius = 0) {
  const node = { ...primitiveDefaults(kind), id: 'a', name: 'a', position: [0, 0, 0], cornerRadius } as PrimitiveNode;
  const scene: Scene = { nodes: { a: node }, rootIds: ['a'] };
  return new Evaluator(wasm).evaluate(scene).meshes[0];
}

describe('polyhedronVertices', () => {
  it('ha il numero di vertici atteso', () => {
    expect(polyhedronVertices('octahedron', 20)).toHaveLength(6);
    expect(polyhedronVertices('decahedron', 20)).toHaveLength(12);
    expect(polyhedronVertices('dodecahedron', 20)).toHaveLength(20);
    expect(polyhedronVertices('icosahedron', 20)).toHaveLength(12);
  });

  it.each(KINDS)('%s: una faccia poggia sul piatto e l ingombro è alto quanto la dimensione', (kind) => {
    const zs = polyhedronVertices(kind, 20).map((v) => v[2]);
    expect(Math.min(...zs)).toBeCloseTo(-10, 6);
    expect(Math.max(...zs)).toBeCloseTo(10, 6);
    // La faccia in basso ha almeno tre vertici alla stessa quota
    expect(zs.filter((z) => Math.abs(z + 10) < 1e-6).length).toBeGreaterThanOrEqual(3);
  });
});

describe('solidi da dado nel kernel', () => {
  it.each(KINDS)('%s: solido valido con altezza uguale alla dimensione', (kind) => {
    const m = build(kind);
    expect(m.status).toBe('NoError');
    expect(m.bbox.max[2] - m.bbox.min[2]).toBeCloseTo(20, 4);
  });

  it('i volumi corrispondono alle formule dei solidi platonici (inraggio 10)', () => {
    const ri = 10;
    const octa = Math.sqrt(6) * ri;
    expect(build('octahedron').volume).toBeCloseTo((Math.SQRT2 / 3) * octa ** 3, 1);
    const ico = (ri * 2 * Math.sqrt(3)) / PHI ** 2;
    expect(build('icosahedron').volume).toBeCloseTo((5 / 12) * (3 + Math.sqrt(5)) * ico ** 3, 1);
    const dod = (2 * ri) / Math.sqrt((25 + 11 * Math.sqrt(5)) / 10);
    expect(build('dodecahedron').volume).toBeCloseTo(((15 + 7 * Math.sqrt(5)) / 4) * dod ** 3, 1);
  });

  it.each(KINDS)('%s: con il raccordo il volume scende e l altezza resta', (kind) => {
    const sharp = build(kind);
    const round = build(kind, 3);
    expect(round.status).toBe('NoError');
    expect(round.volume).toBeLessThan(sharp.volume);
    expect(round.volume).toBeGreaterThan(sharp.volume * 0.6);
    expect(round.bbox.max[2] - round.bbox.min[2]).toBeCloseTo(20, 0);
  });
});

describe('raccordo dei poligoni 2D', () => {
  const polygon = (cornerRadius: number) => {
    const node = { ...shape2dDefaults('circle'), id: 's', name: 's', position: [0, 0, 0], radius: 10, segments: 6, height: 10, cornerRadius } as Shape2DNode;
    return new Evaluator(wasm).evaluate({ nodes: { s: node }, rootIds: ['s'] }).meshes[0];
  };

  it('esagono: il volume scende e i lati restano alla stessa distanza', () => {
    const sharp = polygon(0);
    const round = polygon(2);
    expect(round.status).toBe('NoError');
    expect(round.volume).toBeLessThan(sharp.volume);
    // Lati piatti ai due estremi in Y (l'inraggio 10·cos30° non cambia)
    expect(round.bbox.max[1]).toBeCloseTo(sharp.bbox.max[1], 2);
  });

  it('il raggio massimo resta sotto l inraggio', () => {
    expect(polygonMaxRadius(10, 6)).toBeLessThan(10 * Math.cos(Math.PI / 6));
    expect(polygonShrunkRadius(10, 6, 0)).toBeCloseTo(10, 9);
  });
});
