import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { primitiveDefaults } from '../scene/defaults';
import type { MeshNode, PrimitiveNode, Scene } from '../scene/types';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const meshNode = (patch: Partial<MeshNode> = {}): MeshNode => ({
  type: 'mesh', id: 'm', name: 'm', assetId: 'cubo', fileName: 'cubo.stl', origin: [0, 0, 0], scale: 1, triangles: 12,
  position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#fff', ...patch,
});

/** Mesh di un cubo da 10 mm, generata dal kernel stesso. */
function cube(ev: Evaluator) {
  const box = { ...primitiveDefaults('box'), id: 'a', name: 'a', position: [0, 0, 0], size: [10, 10, 10] } as PrimitiveNode;
  return ev.evaluate({ nodes: { a: box }, rootIds: ['a'] }).meshes[0];
}

describe('mesh importate nel kernel', () => {
  it('registra una mesh valida e la usa in un nodo, anche scalata', () => {
    const ev = new Evaluator(wasm);
    const src = cube(ev);
    expect(ev.registerAsset('cubo', src.positions, src.indices)).toMatchObject({ ok: true, status: 'NoError', triangles: 12 });
    const scene = (scale: number): Scene => ({ nodes: { m: meshNode({ scale }) }, rootIds: ['m'] });
    expect(ev.evaluate(scene(1)).meshes[0].volume).toBeCloseTo(1000, 1);
    expect(ev.evaluate(scene(2)).meshes[0].volume).toBeCloseTo(8000, 1);
  });

  it('un STL con vertici non condivisi viene fuso e accettato', () => {
    const ev = new Evaluator(wasm);
    const src = cube(ev);
    // Vertici duplicati per ogni triangolo, come in un vero STL
    const soup = new Float32Array(src.indices.length * 3);
    src.indices.forEach((vi, i) => soup.set(src.positions.subarray(vi * 3, vi * 3 + 3), i * 3));
    const seq = Uint32Array.from({ length: src.indices.length }, (_, i) => i);
    expect(ev.registerAsset('zuppa', soup, seq).ok).toBe(true);
  });

  it('rifiuta mesh aperte o con le facce rovesciate', () => {
    const ev = new Evaluator(wasm);
    const src = cube(ev);
    // Un triangolo da solo non è un solido chiuso
    expect(ev.registerAsset('aperta', src.positions, src.indices.slice(0, 3)).ok).toBe(false);
    // Facce rovesciate: volume negativo
    const flipped = Uint32Array.from(src.indices);
    for (let i = 0; i < flipped.length; i += 3) [flipped[i + 1], flipped[i + 2]] = [flipped[i + 2], flipped[i + 1]];
    expect(ev.registerAsset('rovescia', src.positions, flipped).ok).toBe(false);
  });

  it('un asset mancante produce un errore che dice cosa fare', () => {
    const scene: Scene = { nodes: { m: meshNode({ assetId: 'ignoto' }) }, rootIds: ['m'] };
    expect(() => new Evaluator(wasm).evaluate(scene)).toThrow(/reimporta/);
  });

  it('una mesh importata si combina con le altre forme (differenza)', () => {
    const ev = new Evaluator(wasm);
    const src = cube(ev);
    ev.registerAsset('cubo', src.positions, src.indices);
    const hole = { ...primitiveDefaults('cylinder'), id: 'h', name: 'h', position: [0, 0, 0], radius: 2, height: 30, segments: 64 } as PrimitiveNode;
    const scene: Scene = {
      nodes: {
        m: meshNode(),
        h: hole,
        g: { id: 'g', name: 'g', type: 'group', op: 'difference', children: ['m', 'h'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#fff' },
      },
      rootIds: ['g'],
    };
    const area = 0.5 * 64 * 4 * Math.sin((2 * Math.PI) / 64);
    expect(ev.evaluate(scene).meshes[0].volume).toBeCloseTo(1000 - area * 10, 1);
  });
});
