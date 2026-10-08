import { describe, expect, it } from 'vitest';
import { resizeAxisPatch, sizeOfBox } from './dimensions';
import { primitiveDefaults, shape2dDefaults } from './defaults';
import type { GroupNode, MeshNode, PrimitiveNode, Shape2DNode, Vec3 } from './types';

const prim = (kind: Parameters<typeof primitiveDefaults>[0], patch: Partial<PrimitiveNode> = {}) =>
  ({ ...primitiveDefaults(kind), id: 'a', name: 'a', position: [0, 0, 0], ...patch }) as PrimitiveNode;
const shape = (kind: Parameters<typeof shape2dDefaults>[0], patch: Partial<Shape2DNode> = {}) =>
  ({ ...shape2dDefaults(kind), id: 'a', name: 'a', position: [0, 0, 0], ...patch }) as Shape2DNode;
const group = (patch: Partial<GroupNode> = {}): GroupNode => ({
  id: 'g', name: 'g', type: 'group', op: 'union', children: [], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff', ...patch,
});
const box = (min: Vec3, max: Vec3) => ({ min, max });

describe('quote: misura di un asse', () => {
  it('sizeOfBox dà le tre lunghezze dell ingombro', () => {
    expect(sizeOfBox(box([-10, -5, 0], [10, 5, 30]))).toEqual([20, 10, 30]);
  });

  it('cubo: cambia solo il lato richiesto', () => {
    const node = prim('box', { size: [20, 20, 20] } as Partial<PrimitiveNode>);
    const patch = resizeAxisPatch(node, box([-10, -10, -10], [10, 10, 10]), 0, 40)!;
    expect(patch.size).toEqual([40, 20, 20]);
  });

  it('cubo con proporzioni bloccate: gli altri lati seguono', () => {
    const node = prim('box', { size: [20, 10, 5], lockRatio: true } as Partial<PrimitiveNode>);
    const patch = resizeAxisPatch(node, box([-10, -5, -2.5], [10, 5, 2.5]), 1, 20)!;
    expect(patch.size).toEqual([40, 20, 10]);
  });

  it('cilindro: la quota X è il diametro, quindi il raggio è la metà', () => {
    const node = prim('cylinder');
    const patch = resizeAxisPatch(node, box([-10, -10, 0], [10, 10, 20]), 0, 30)!;
    expect(patch.radius).toBe(15);
  });

  it('testo: X e Y insieme, la quota Z cambia l altezza', () => {
    const node = shape('text');
    const wide = resizeAxisPatch(node, box([-20, -5, 0], [20, 5, 3]), 0, 80)!;
    expect(wide.size).toBeCloseTo((node as Extract<Shape2DNode, { kind: 'text' }>).size * 2, 3);
    const tall = resizeAxisPatch(node, box([-20, -5, 0], [20, 5, 3]), 2, 6)!;
    expect(tall.height).toBe(6);
  });

  it('gruppo: scala per asse e centro della base fermo', () => {
    const patch = resizeAxisPatch(group(), box([-10, -10, 0], [10, 10, 20]), 2, 40)!;
    expect(patch.groupScale).toEqual([1, 1, 2]);
    expect(patch.position).toEqual([0, 0, 0]);
  });

  it('mesh: la scala è uniforme', () => {
    const mesh = { id: 'm', name: 'm', type: 'mesh', scale: 1, position: [0, 0, 0] } as unknown as MeshNode;
    expect(resizeAxisPatch(mesh, box([0, 0, 0], [10, 20, 30]), 1, 40)).toEqual({ scale: 2 });
  });

  it('misure non valide o ingombro vuoto: nessuna modifica', () => {
    const node = prim('box');
    const b = box([-10, -10, -10], [10, 10, 10]);
    expect(resizeAxisPatch(node, b, 0, 0)).toBeNull();
    expect(resizeAxisPatch(node, b, 0, -5)).toBeNull();
    expect(resizeAxisPatch(node, b, 0, Number.NaN)).toBeNull();
    expect(resizeAxisPatch(node, box([0, 0, 0], [0, 0, 0]), 0, 10)).toBeNull();
  });
});
