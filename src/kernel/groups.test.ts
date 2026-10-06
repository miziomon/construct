import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import { Evaluator, toMesh } from './evaluate';
import { write3mf } from './export/threemf';
import { primitiveDefaults } from '../scene/defaults';
import type { GroupNode, GroupOp, PrimitiveNode, Scene, SceneNode, Vec3 } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const box = (id: string, position: Vec3, color: string, extra: Partial<PrimitiveNode> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults('box'), id, name: id, position, color, ...extra }) as PrimitiveNode;

const group = (id: string, op: GroupOp, children: string[], extra: Partial<GroupNode> = {}): GroupNode => ({
  id, name: id, type: 'group', op, children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#ffffff', ...extra,
});

const sceneOf = (nodes: SceneNode[], rootIds: string[]): Scene => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds });

describe('Raggruppa nel kernel', () => {
  it('produce una mesh per figlio, ciascuna nel suo colore, con la trasformazione del gruppo', () => {
    const scene = sceneOf(
      [box('a', [-20, 0, 0], '#ff0000'), box('b', [20, 0, 0], '#00ff00'), group('g', 'group', ['a', 'b'], { position: [100, 0, 0], rotation: [0, 0, 90] })],
      ['g'],
    );
    const { meshes } = new Evaluator(wasm).evaluate(scene);
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m) => m.color)).toEqual(['#ff0000', '#00ff00']);
    expect(meshes.map((m) => m.rootId)).toEqual(['g', 'g']);
    expect(meshes.map((m) => m.path)).toEqual([['g', 'a'], ['g', 'b']]);
    // Il gruppo ruota di 90° attorno a Z e si sposta di 100 mm in X: il figlio a (-20, 0) va in (100, -20)
    const centerOf = (m: (typeof meshes)[number]) => [0, 1].map((i) => (m.bbox.min[i] + m.bbox.max[i]) / 2);
    expect(centerOf(meshes[0])[0]).toBeCloseTo(100, 3);
    expect(centerOf(meshes[0])[1]).toBeCloseTo(-20, 3);
    expect(centerOf(meshes[1])[1]).toBeCloseTo(20, 3);
    // Le mesh non sono fuse: restano due solidi da 8000 mm³
    expect(meshes.map((m) => Math.round(m.volume))).toEqual([8000, 8000]);
  });

  it('un oggetto semplice alla radice ha rootId e path propri', () => {
    const [m] = new Evaluator(wasm).evaluate(sceneOf([box('a', [0, 0, 0], '#ff0000')], ['a'])).meshes;
    expect(m.rootId).toBe('a');
    expect(m.path).toEqual(['a']);
  });

  it('i fori dentro un Raggruppa sono solidi (anche in vecchie scene)', () => {
    const scene = sceneOf([box('a', [0, 0, 0], '#ff0000'), box('h', [0, 0, 0], '#00ff00', { mode: 'hole' }), group('g', 'group', ['a', 'h'])], ['g']);
    const { meshes } = new Evaluator(wasm).evaluate(scene);
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => !m.isHole && Math.round(m.volume) === 8000)).toBe(true);
  });

  it('un foro alla radice resta un foro', () => {
    const [m] = new Evaluator(wasm).evaluate(sceneOf([box('h', [0, 0, 0], '#ff0000', { mode: 'hole' })], ['h'])).meshes;
    expect(m.isHole).toBe(true);
  });

  it('più livelli: un Raggruppa con dentro una Unione che contiene una Differenza', () => {
    // Differenza: cubo 20 mm meno un cubo piccolo al centro (che lo fora): 8000 - 1000 = 7000 mm³
    const cut = box('cut', [0, 0, 0], '#000000', { size: [10, 10, 30] } as Partial<PrimitiveNode>);
    const diff = group('diff', 'difference', ['base', 'cut']);
    const base = box('base', [0, 0, 0], '#4da3ff');
    // L'unione fonde la differenza con un secondo cubo disgiunto (a 100 mm di distanza)
    const far = box('far', [100, 0, 0], '#ff8800');
    const union = group('uni', 'union', ['diff', 'far']);
    const side = box('side', [200, 0, 0], '#00ff88');
    const root = group('root', 'group', ['uni', 'side']);
    const { meshes } = new Evaluator(wasm).evaluate(sceneOf([cut, diff, base, far, union, side, root], ['root']));
    // Due mesh: l'unione (fusa, una sola) e il cubo laterale
    expect(meshes.map((m) => m.id)).toEqual(['uni', 'side']);
    expect(meshes.map((m) => m.rootId)).toEqual(['root', 'root']);
    expect(Math.round(meshes[0].volume)).toBe(Math.round(8000 - 10 * 10 * 20 + 8000));
    expect(Math.round(meshes[1].volume)).toBe(8000);
  });

  it('più livelli: una Differenza con dentro un Raggruppa vale come unione dei suoi figli', () => {
    // Differenza: (gruppo di due cubi disgiunti) meno un cubo che ne taglia metà del primo
    const g = group('g', 'group', ['a', 'b']);
    const a = box('a', [0, 0, 0], '#ff0000');
    const b = box('b', [100, 0, 0], '#00ff00');
    const cut = box('cut', [-10, 0, 0], '#000000', { size: [20, 40, 40] } as Partial<PrimitiveNode>);
    const diff = group('diff', 'difference', ['g', 'cut']);
    const { meshes } = new Evaluator(wasm).evaluate(sceneOf([a, b, g, cut, diff], ['diff']));
    expect(meshes).toHaveLength(1);
    // Il primo cubo perde la metà (x da -10 a 0): 8000 - 4000, il secondo resta intero
    expect(Math.round(meshes[0].volume)).toBe(4000 + 8000);
  });

  it('più livelli: Raggruppa dentro Raggruppa compone le trasformazioni', () => {
    const inner = group('inner', 'group', ['a'], { position: [10, 0, 0] });
    const outer = group('outer', 'group', ['inner', 'b'], { position: [0, 50, 0] });
    const a = box('a', [5, 0, 0], '#ff0000');
    const b = box('b', [0, 0, 0], '#00ff00');
    const { meshes } = new Evaluator(wasm).evaluate(sceneOf([a, b, inner, outer], ['outer']));
    const a1 = meshes.find((m) => m.id === 'a')!;
    expect(a1.path).toEqual(['outer', 'inner', 'a']);
    // x: 5 + 10 (gruppo interno), y: 0 + 50 (gruppo esterno)
    expect((a1.bbox.min[0] + a1.bbox.max[0]) / 2).toBeCloseTo(15, 3);
    expect((a1.bbox.min[1] + a1.bbox.max[1]) / 2).toBeCloseTo(50, 3);
  });

  it('l\'unione per l\'STL comprende tutti i figli dei Raggruppa e salta i fori alla radice', () => {
    const scene = sceneOf(
      [box('a', [0, 0, 0], '#ff0000'), box('b', [100, 0, 0], '#00ff00'), group('g', 'group', ['a', 'b']), box('h', [300, 0, 0], '#0000ff', { mode: 'hole' })],
      ['g', 'h'],
    );
    const ev = new Evaluator(wasm);
    const union = ev.unionOfSolids(scene);
    const mesh = toMesh({ id: 'all', color: '#fff', mode: 'solid' } as SceneNode, union);
    union.delete();
    expect(Math.round(mesh.volume)).toBe(16000);
  });

  it('il 3MF di un Raggruppa ha un oggetto per figlio, ognuno col suo colore e nome', () => {
    const scene = sceneOf([box('a', [-20, 0, 0], '#ff0000'), box('b', [20, 0, 0], '#00ff00'), group('g', 'group', ['a', 'b'])], ['g']);
    const { meshes } = new Evaluator(wasm).evaluate(scene);
    const parts = meshes.filter((m) => !m.isHole && !m.empty).map((m) => ({ name: scene.nodes[m.id].name, color: m.color, positions: m.positions, indices: m.indices }));
    const files = unzipSync(write3mf(parts));
    const xml = strFromU8(files[Object.keys(files).find((p) => /3dmodel\.model$/i.test(p))!]);
    expect(xml.match(/<object /g)).toHaveLength(2);
    expect(xml).toContain('name="a"');
    expect(xml).toContain('name="b"');
    expect(xml.toLowerCase()).toContain('#ff0000');
    expect(xml.toLowerCase()).toContain('#00ff00');
  });
});
