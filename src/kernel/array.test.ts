import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { defaultArrayParams } from '../scene/arrayPattern';
import { primitiveDefaults } from '../scene/defaults';
import type { ArrayParams, GroupNode, PrimitiveNode, Scene } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Un cubo da `size` mm all'origine del gruppo (come dopo "Ripetizione") dentro un gruppo array con i parametri dati. */
function scene(size: [number, number, number], patch: Partial<ArrayParams>, group: Partial<GroupNode> = {}): Scene {
  const cube = { ...primitiveDefaults('box'), id: 'c', name: 'Cubo', position: [0, 0, 0], size } as PrimitiveNode;
  const g: GroupNode = {
    id: 'g', name: 'Ripetizione', type: 'group', op: 'array', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
    array: { ...defaultArrayParams(), ...patch },
    ...group,
  };
  return { nodes: { c: cube, g }, rootIds: ['g'] };
}
const run = (s: Scene) => new Evaluator(wasm).evaluate(s).meshes[0];

describe('Ripetizione nel kernel', () => {
  it('lineare: cinque cubi in fila (volume e ingombro), un solo oggetto', () => {
    const m = run(scene([10, 10, 10], { count: 5, step: [30, 0, 0] }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeCloseTo(5000, 2);
    expect(m.bbox.min[0]).toBeCloseTo(-5, 3);
    expect(m.bbox.max[0]).toBeCloseTo(125, 3);
  });

  it('lineare con spazio totale e senza originale', () => {
    const total = run(scene([10, 10, 10], { count: 3, step: [100, 0, 0], spacing: 'total' }));
    expect(total.bbox.max[0]).toBeCloseTo(105, 3);
    const noOriginal = run(scene([10, 10, 10], { count: 4, step: [30, 0, 0], includeOriginal: false }));
    expect(noOriginal.volume).toBeCloseTo(3000, 2);
    expect(noOriginal.bbox.min[0]).toBeCloseTo(25, 3);
  });

  it('griglia: 3 × 2 × 2 cubi', () => {
    const m = run(scene([10, 10, 10], { kind: 'grid', counts: [3, 2, 2], gridStep: [20, 30, 40] }));
    expect(m.volume).toBeCloseTo(12000, 2);
    expect(m.bbox.max[0]).toBeCloseTo(45, 3);
    expect(m.bbox.max[1]).toBeCloseTo(35, 3);
    expect(m.bbox.max[2]).toBeCloseTo(45, 3);
  });

  it('circolare: quattro copie attorno a un asse a 30 mm, simmetriche rispetto al centro', () => {
    const m = run(scene([10, 10, 10], { kind: 'circular', count: 4, angle: 360, axis: 2, center: [-30, 0, 0], rotateCopies: true }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeCloseTo(4000, 1);
    // Copie a x = 0, -30 (due: y = ±30) e -60; il centro dell'ingombro è l'asse
    expect(m.bbox.max[0]).toBeCloseTo(5, 2);
    expect(m.bbox.min[0]).toBeCloseTo(-65, 2);
    expect(m.bbox.max[1]).toBeCloseTo(35, 2);
    expect(m.bbox.min[1]).toBeCloseTo(-35, 2);
  });

  it('circolare: con le copie ruotate un parallelepipedo lungo si dispone a raggiera, senza ruotare resta orientato come l\'originale', () => {
    const base = { kind: 'circular' as const, count: 4, angle: 360, axis: 2 as const, center: [-30, 0, 0] as [number, number, number] };
    const rotated = run(scene([20, 6, 6], { ...base, rotateCopies: true }));
    const parallel = run(scene([20, 6, 6], { ...base, rotateCopies: false }));
    // Ruotate: le due copie a ±90° sono lunghe 20 in Y (±30 ± 10); non ruotate restano larghe 6 in Y (±30 ± 3)
    expect(rotated.bbox.max[1]).toBeCloseTo(40, 2);
    expect(parallel.bbox.max[1]).toBeCloseTo(33, 2);
    expect(parallel.volume).toBeCloseTo(4 * 20 * 6 * 6, 1);
  });

  it('un arco di 180 gradi con tre copie e un asse X', () => {
    const m = run(scene([10, 10, 10], { kind: 'circular', count: 3, angle: 180, axis: 0, center: [0, 0, 30], rotateCopies: false }));
    // Copie a z = 0, 30 (y = -30 ... ) e 60: l'ingombro in Z raggiunge 65
    expect(m.bbox.max[2]).toBeCloseTo(65, 2);
    expect(m.volume).toBeCloseTo(3000, 1);
  });

  it('il gruppo si sposta e ruota con le sue copie, e un solido vuoto non è un errore', () => {
    const m = run(scene([10, 10, 10], { count: 2, step: [30, 0, 0] }, { position: [100, 0, 0], rotation: [0, 0, 90] }));
    // Ruotato di 90 gradi attorno a Z: la fila va lungo Y
    expect(m.bbox.max[1]).toBeCloseTo(35, 2);
    expect(m.bbox.min[0]).toBeCloseTo(95, 2);
    const empty = run(scene([10, 10, 10], { count: 1, includeOriginal: false }));
    expect(empty.empty).toBe(true);
  });

  it('oltre il massimo le copie si limitano a 200', () => {
    const m = run(scene([2, 2, 2], { count: 5000, step: [3, 0, 0] }));
    expect(m.volume).toBeCloseTo(200 * 8, 1);
  });
});

describe('Ripetizione nel codice OpenSCAD', () => {
  const code = (s: Scene) => sceneToOpenScad(s);

  it('lineare: un for con translate e l\'originale dentro', () => {
    const out = code(scene([10, 10, 10], { count: 5, step: [30, 0, 0] }));
    expect(out).toContain('for (i = [0 : 4]) {');
    expect(out).toContain('translate([i * 30, i * 0, i * 0]) {');
    expect(out).toContain('cube([10, 10, 10], center = true);');
    // Le parentesi graffe sono bilanciate
    expect(out.split('{').length).toBe(out.split('}').length);
  });

  it('lineare senza originale parte da 1; con spazio totale usa il passo calcolato', () => {
    expect(code(scene([10, 10, 10], { count: 4, step: [30, 0, 0], includeOriginal: false }))).toContain('for (i = [1 : 3])');
    expect(code(scene([10, 10, 10], { count: 5, step: [100, 0, 0], spacing: 'total' }))).toContain('translate([i * 25, i * 0, i * 0])');
  });

  it('griglia: un for per ogni asse con più di una copia', () => {
    const out = code(scene([10, 10, 10], { kind: 'grid', counts: [3, 1, 2], gridStep: [20, 30, 40] }));
    expect(out).toContain('for (i = [0 : 2]) {');
    expect(out).toContain('for (k = [0 : 1]) {');
    expect(out).not.toContain('for (j');
    expect(out).toContain('translate([i * 20, 0, k * 40]) {');
    expect(out.split('{').length).toBe(out.split('}').length);
  });

  it('circolare: rotate attorno al centro; senza ruotare le copie si annulla la rotazione', () => {
    const base = { kind: 'circular' as const, count: 6, angle: 360, axis: 2 as const, center: [-30, 0, 0] as [number, number, number] };
    const rotated = code(scene([10, 10, 10], { ...base, rotateCopies: true }));
    expect(rotated).toContain('for (i = [0 : 5]) {');
    expect(rotated).toContain('rotate([0, 0, i * 60])');
    expect(rotated).toContain('translate([30, 0, 0]) {');
    const plain = code(scene([10, 10, 10], { ...base, rotateCopies: false }));
    expect(plain).toContain('rotate([0, 0, -i * 60]) {');
    expect(plain.split('{').length).toBe(plain.split('}').length);
  });
});
