import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from '../kernel/evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from './defaults';
import { isScaled, normalizeScale, resizeGroup, scaleOf, setGroupScale } from './groupScale';
import { canMoveInto, useSceneStore } from './store';
import type { GroupNode, GroupOp, PrimitiveNode, Scene, Vec3 } from './types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const near = (a: readonly number[], b: readonly number[], digits = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const cube = (id: string, size: Vec3, position: Vec3 = [0, 0, 0]) => ({ ...primitiveDefaults('box'), id, name: id, position, size }) as PrimitiveNode;
const group = (id: string, op: GroupOp, children: string[], patch: Partial<GroupNode> = {}): GroupNode => ({
  id, name: id, type: 'group', op, children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff', ...patch,
});
const bbox = (scene: Scene) => new Evaluator(wasm).evaluate(scene).meshes.map((m) => m.bbox);

describe('scala di un gruppo: calcoli puri', () => {
  const box = { min: [-10, -10, 0] as Vec3, max: [10, 10, 20] as Vec3 };

  it('normalizeScale toglie la scala unitaria e rialza i valori assurdi', () => {
    expect(normalizeScale([1, 1, 1])).toBeUndefined();
    expect(normalizeScale([2, 1, 1])).toEqual([2, 1, 1]);
    expect(normalizeScale([0, -3, Number.NaN])).toEqual([0.001, 0.001, 1]);
    expect(scaleOf({})).toEqual([1, 1, 1]);
    expect(isScaled({ groupScale: [1, 1, 1] })).toBe(false);
    expect(isScaled({ groupScale: [1, 2, 1] })).toBe(true);
  });

  it('il gizmo arrotonda le misure e tiene fermo il centro della base', () => {
    const r = resizeGroup({ position: [5, 6, 7], rotation: [0, 0, 0] }, box, [2.01, 1, 1], 0.5);
    // 20 mm × 2,01 = 40,2 → 40 mm, quindi scala X = 2; Y e Z non cambiano
    expect(r.scale).toEqual([2, 1, 1]);
    // Il centro della base (x = 0) non si muove: la posizione resta uguale
    near(r.position, [5, 6, 7]);
  });

  it('un ingombro non centrato sposta la posizione per tenere ferma la base', () => {
    const offset = { min: [10, 0, 0] as Vec3, max: [30, 20, 20] as Vec3 };
    const r = resizeGroup({ position: [0, 0, 0], rotation: [0, 0, 0] }, offset, [2, 1, 1], 0.5);
    // Centro della base a x = 20: raddoppiando la scala va a 40, quindi il gruppo si sposta di -20
    near(r.position, [-20, 0, 0]);
  });

  it('lo spostamento segue rotazione e specchio del gruppo', () => {
    const offset = { min: [10, 0, 0] as Vec3, max: [30, 20, 20] as Vec3 };
    // Ruotato di 90° attorno a Z: l'asse locale X punta lungo Y del mondo
    const turned = resizeGroup({ position: [0, 0, 0], rotation: [0, 0, 90] }, offset, [2, 1, 1], 0.5);
    near(turned.position, [0, -20, 0]);
    // Specchiato su X: la X locale punta verso -X del mondo
    const mirrored = resizeGroup({ position: [0, 0, 0], rotation: [0, 0, 0], mirror: [true, false, false] }, offset, [2, 1, 1], 0.5);
    near(mirrored.position, [20, 0, 0]);
  });

  it('un ingombro vuoto non cambia niente (niente posizioni NaN)', () => {
    const empty = { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 };
    const r = resizeGroup({ position: [1, 2, 3], rotation: [0, 0, 0], groupScale: [2, 1, 1] }, empty, [2, 1, 1]);
    expect(r).toEqual({ scale: [2, 1, 1], position: [1, 2, 3] });
  });

  it('una seconda scala si compone con la prima e setGroupScale dà esattamente quella richiesta', () => {
    const before = { groupScale: [2, 1, 1] as Vec3, position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };
    // L'ingombro è già scalato (40 mm di larghezza)
    const scaled = { min: [-20, -10, 0] as Vec3, max: [20, 10, 20] as Vec3 };
    expect(resizeGroup(before, scaled, [1.5, 1, 1], 0.5).scale).toEqual([3, 1, 1]);
    expect(setGroupScale(before, scaled, [3, 1, 2]).scale).toEqual([3, 1, 2]);
    expect(setGroupScale(before, scaled, [1, 1, 1]).scale).toBeUndefined();
  });
});

describe('ogni tipo di gruppo si ridimensiona nel kernel', () => {
  // Due cubi da 10 mm: uno a x = -10 e uno a x = +10, così il gruppo è largo 30 mm
  const base = (op: GroupOp, patch: Partial<GroupNode> = {}): Scene => ({
    nodes: { a: cube('a', [10, 10, 10], [-10, 0, 5]), b: cube('b', [10, 10, 10], [10, 0, 5]), g: group('g', op, ['a', 'b'], patch) },
    rootIds: ['g'],
  });
  const width = (scene: Scene) => {
    const boxes = bbox(scene);
    return Math.max(...boxes.map((b) => b.max[0])) - Math.min(...boxes.map((b) => b.min[0]));
  };

  it.each(['group', 'union', 'hull'] as GroupOp[])('%s: la scala X raddoppia la larghezza e la Z l\'altezza', (op) => {
    expect(width(base(op))).toBeCloseTo(30, 3);
    expect(width(base(op, { groupScale: [2, 1, 1] }))).toBeCloseTo(60, 3);
    const tall = bbox(base(op, { groupScale: [1, 1, 3] }));
    expect(Math.max(...tall.map((b) => b.max[2]))).toBeCloseTo(30, 3);
  });

  it('differenza e intersezione: la scala vale per il risultato', () => {
    const diff: Scene = { nodes: { a: cube('a', [20, 20, 20], [0, 0, 10]), b: cube('b', [5, 5, 30], [0, 0, 10]), g: group('g', 'difference', ['a', 'b'], { groupScale: [2, 2, 2] }) }, rootIds: ['g'] };
    const m = new Evaluator(wasm).evaluate(diff).meshes[0];
    // (20³ − 5·5·20) × 8
    expect(m.volume).toBeCloseTo((8000 - 500) * 8, 0);
    const inter: Scene = { nodes: { a: cube('a', [20, 20, 20], [0, 0, 10]), b: cube('b', [10, 10, 10], [0, 0, 10]), g: group('g', 'intersection', ['a', 'b'], { groupScale: [2, 1, 1] }) }, rootIds: ['g'] };
    expect(new Evaluator(wasm).evaluate(inter).meshes[0].volume).toBeCloseTo(2000, 0);
  });

  it('guscio, ripetizione e pattern: il risultato cresce dello stesso fattore', () => {
    const shell: Scene = { nodes: { a: cube('a', [20, 20, 20], [0, 0, 10]), g: group('g', 'shell', ['a'], { shell: { wall: 2, bottom: 2 }, groupScale: [2, 2, 2] }) }, rootIds: ['g'] };
    const plain = new Evaluator(wasm).evaluate({ ...shell, nodes: { ...shell.nodes, g: { ...shell.nodes.g, groupScale: undefined } as GroupNode } }).meshes[0];
    const big = new Evaluator(wasm).evaluate(shell).meshes[0];
    expect(big.volume).toBeCloseTo(plain.volume * 8, 0);

    const array: Scene = {
      nodes: { a: cube('a', [10, 10, 10], [0, 0, 5]), g: group('g', 'array', ['a'], { array: { kind: 'linear', count: 3, step: [20, 0, 0], spacing: 'step', includeOriginal: true, counts: [1, 1, 1], gridStep: [20, 20, 20], axis: 2, angle: 360, center: [0, 0, 0], rotateCopies: true }, groupScale: [2, 1, 1] }) },
      rootIds: ['g'],
    };
    const m = new Evaluator(wasm).evaluate(array).meshes[0];
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(2 * 50, 2);
  });

  it('il gruppo ridimensionato è una cache diversa da quello normale', () => {
    const scene = base('union');
    const evaluator = new Evaluator(wasm);
    const w = (s: Scene) => evaluator.evaluate(s).meshes[0].bbox.max[0] - evaluator.evaluate(s).meshes[0].bbox.min[0];
    expect(w(scene)).toBeCloseTo(30, 3);
    expect(w(base('union', { groupScale: [2, 1, 1] }))).toBeCloseTo(60, 3);
    expect(w(scene)).toBeCloseTo(30, 3);
  });
});

describe('codice OpenSCAD e regole di modifica di un gruppo ridimensionato', () => {
  it('scale() è il modificatore più interno di un gruppo, anche per il Raggruppa', () => {
    const union: Scene = { nodes: { a: cube('a', [10, 10, 10]), g: group('g', 'union', ['a'], { groupScale: [2, 1, 3], position: [4, 5, 6] }) }, rootIds: ['g'] };
    const code = sceneToOpenScad(union);
    expect(code).toContain('translate([4, 5, 6])');
    expect(code.indexOf('translate([4, 5, 6])')).toBeLessThan(code.indexOf('scale([2, 1, 3])'));
    expect(code.indexOf('scale([2, 1, 3])')).toBeLessThan(code.indexOf('union() {'));

    const app: Scene = { nodes: { a: cube('a', [10, 10, 10], [5, 0, 0]), g: group('g', 'group', ['a'], { groupScale: [2, 2, 2] }) }, rootIds: ['g'] };
    const appCode = sceneToOpenScad(app);
    expect(appCode).toContain('gruppo ridimensionato');
    expect(appCode).toContain('scale([2, 2, 2]) {');
    expect(appCode.split('{').length).toBe(appCode.split('}').length);
    expect(sceneToOpenScad({ ...union, nodes: { ...union.nodes, g: { ...union.nodes.g, groupScale: undefined } as GroupNode } })).not.toContain('scale(');
  });

  it('un nodo non entra né esce da un gruppo ridimensionato, e Separa lo lascia com\'è', () => {
    const scene: Scene = {
      nodes: { a: cube('a', [10, 10, 10]), b: cube('b', [10, 10, 10]), g: group('g', 'union', ['a'], { groupScale: [2, 1, 1] }), h: group('h', 'union', ['b']) },
      rootIds: ['g', 'h'],
    };
    expect(canMoveInto(scene, 'b', 'g')).toBe(false);
    expect(canMoveInto(scene, 'a', null)).toBe(false);
    expect(canMoveInto(scene, 'b', 'h')).toBe(true);
    useSceneStore.getState().loadScene(scene);
    useSceneStore.getState().select(['g']);
    useSceneStore.getState().ungroupSelected();
    expect(useSceneStore.getState().scene.rootIds).toEqual(['g', 'h']);
  });
});
