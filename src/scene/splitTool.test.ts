import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from '../kernel/evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from './defaults';
import { buildSplit, canSplit } from './splitTool';
import type { GroupNode, PrimitiveNode, Scene, Vec3 } from './types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Cubo da 20 mm con il centro in (10, 0, 10): ingombro da 0 a 20 in X. */
const box = (extra: Partial<PrimitiveNode> = {}): PrimitiveNode => ({ ...primitiveDefaults('box'), id: 'b', name: 'Cubo', position: [10, 0, 10] as Vec3, ...extra }) as PrimitiveNode;
const sceneOf = (node: PrimitiveNode): Scene => ({ nodes: { [node.id]: node }, rootIds: [node.id] });
const BOUNDS = { min: [0, -10, 0] as Vec3, max: [20, 10, 20] as Vec3 };

const volumes = (scene: Scene) => new Evaluator(wasm).evaluate(scene).meshes.map((m) => ({ rootId: m.rootId, volume: m.volume, status: m.status }));

describe('Dividi con un piano', () => {
  it('cubo tagliato a X = 5: due gruppi Intersezione con i volumi 5·20·20 e 15·20·20, il taglio al posto giusto', () => {
    const result = buildSplit(sceneOf(box()), 'b', 0, 5, BOUNDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { scene, ids } = result;
    expect(scene.rootIds).toEqual(ids);
    for (const id of ids) {
      const g = scene.nodes[id] as GroupNode;
      expect(g.op).toBe('intersection');
      expect(g.children).toHaveLength(2);
      expect(scene.nodes[g.children[1]]).toMatchObject({ type: 'primitive', kind: 'box', name: expect.stringMatching(/^Taglio/) });
    }
    expect(scene.nodes[ids[0]].name).toBe('Cubo (1)');
    expect(scene.nodes[ids[1]].name).toBe('Cubo (2)');
    const v = volumes(scene);
    expect(v.every((m) => m.status === 'NoError')).toBe(true);
    expect(v.find((m) => m.rootId === ids[0])!.volume).toBeCloseTo(5 * 20 * 20, 3);
    expect(v.find((m) => m.rootId === ids[1])!.volume).toBeCloseTo(15 * 20 * 20, 3);
    // Il codice è un'intersezione con un cube per metà
    const code = sceneToOpenScad(scene);
    expect(code.split('intersection() {').length - 1).toBe(2);
    expect(code).toContain('cube([40, 40, 40], center = true);');
  });

  it('con il pezzo ruotato il cubo di taglio sta nel sistema del gruppo e il piano resta quello del mondo', () => {
    // Cubo ruotato di 45° attorno a Z: l'ingombro in X va da 10 − 14,14 a 10 + 14,14
    const r = Math.SQRT2 * 10;
    const bounds = { min: [10 - r, -r, 0] as Vec3, max: [10 + r, r, 20] as Vec3 };
    const result = buildSplit(sceneOf(box({ rotation: [0, 0, 45] })), 'b', 0, 10, bounds);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const v = volumes(result.scene);
    // Il piano passa dal centro: due metà uguali (posizione del taglio arrotondata a 4 decimali: scarto sotto 0,1 mm³)
    expect(v[0].volume).toBeCloseTo(4000, 1);
    expect(v[1].volume).toBeCloseTo(4000, 1);
    const cutter = result.scene.nodes[(result.scene.nodes[result.ids[0]] as GroupNode).children[1]] as PrimitiveNode;
    // Nel sistema del gruppo (ruotato di 45°) il cubo è ruotato di −45°
    expect(cutter.rotation[2]).toBeCloseTo(-45, 3);
  });

  it('piano fuori dall\'ingombro, oggetto bloccato, foro: errore e scena intatta', () => {
    const scene = sceneOf(box());
    expect(buildSplit(scene, 'b', 0, 25, BOUNDS)).toMatchObject({ ok: false, error: expect.stringContaining('non taglia') });
    expect(buildSplit(scene, 'b', 0, 0.05, BOUNDS).ok).toBe(false);
    expect(buildSplit(sceneOf(box({ locked: true })), 'b', 0, 5, BOUNDS)).toMatchObject({ ok: false, error: expect.stringContaining('bloccato') });
    expect(buildSplit(sceneOf(box({ mode: 'hole' })), 'b', 0, 5, BOUNDS).ok).toBe(false);
    expect(buildSplit(scene, 'x', 0, 5, BOUNDS).ok).toBe(false);
    expect(scene.rootIds).toEqual(['b']);
  });

  it('canSplit: un solo oggetto alla radice, solido e non bloccato', () => {
    expect(canSplit(sceneOf(box()), ['b'])).toBe(true);
    expect(canSplit(sceneOf(box({ locked: true })), ['b'])).toBe(false);
    expect(canSplit(sceneOf(box({ mode: 'hole' })), ['b'])).toBe(false);
    expect(canSplit(sceneOf(box()), [])).toBe(false);
    expect(canSplit(sceneOf(box()), ['b', 'b'])).toBe(false);
  });
});
