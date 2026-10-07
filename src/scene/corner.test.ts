import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator, type NodeMesh } from '../kernel/evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from './defaults';
import { cornerCutter, cornerSphere, effectiveDistance } from './cornerProfile';
import { buildCornerTreatment, cornerAt, cornerData, defaultCornerDistance, faceMap, type CornerGeometry } from './edgeTool';
import { buildShell } from './shellTool';
import type { CornerNode, GroupNode, PrimitiveNode, Scene, SceneNode, Vec3 } from './types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const prim = (kind: PrimitiveNode['kind'], extra: Record<string, unknown> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults(kind), id: 'a', name: 'a', position: [0, 0, 10], ...extra }) as PrimitiveNode;
const sceneOf = (nodes: SceneNode[], rootIds: string[]): Scene => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds });
const evaluate = (scene: Scene) => new Evaluator(wasm).evaluate(scene).meshes;

/** Faccia con la normale più vicina alla direzione indicata. */
function faceFacing(mesh: NodeMesh, direction: Vec3): number {
  let best = 0;
  let bestScore = -Infinity;
  faceMap(mesh).faces.forEach((f, i) => {
    const score = f.normal[0] * direction[0] + f.normal[1] * direction[1] + f.normal[2] * direction[2];
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Angolo più vicino a un punto, scelto tra i vertici della faccia che guarda `facing` (come farebbe il mouse). */
function cornerNear(mesh: NodeMesh, facing: Vec3, point: Vec3): CornerGeometry {
  const map = faceMap(mesh);
  const v = cornerAt(mesh, map, faceFacing(mesh, facing), point);
  expect(v).toBeGreaterThanOrEqual(0);
  const result = cornerData(mesh, map, v);
  if (!result.ok) throw new Error(result.error);
  return result.geometry;
}

/** Applica lo smusso angolare e restituisce scena e mesh risultanti. */
function apply(scene: Scene, geometry: CornerGeometry, params: { treatment: 'chamfer' | 'fillet'; distance: number; segments?: number }, target = 'a') {
  const result = buildCornerTreatment(scene, target, geometry, params);
  if (!result.ok) throw new Error(result.error);
  return { ...result, meshes: evaluate(result.scene) };
}

describe('scelta e dati del vertice', () => {
  it('un angolo di un cubo ha tre spigoli lunghi 20 mm, convesso', () => {
    const [mesh] = evaluate(sceneOf([prim('box')], ['a']));
    const g = cornerNear(mesh, [0, 0, 1], [9, 9, 20]);
    expect(g.vertex.map((v) => Math.round(v))).toEqual([10, 10, 20]);
    expect(g.directions).toHaveLength(3);
    expect(g.lengths.every((l) => Math.abs(l - 20) < 1e-3)).toBe(true);
    // Gli spigoli escono dal vertice verso l'interno del cubo
    expect(g.directions.every((u) => u[0] + u[1] + u[2] < 0)).toBe(true);
  });

  it('cornerAt sceglie il vertice più vicino al punto e non uno lontano', () => {
    const [mesh] = evaluate(sceneOf([prim('box')], ['a']));
    const map = faceMap(mesh);
    const top = faceFacing(mesh, [0, 0, 1]);
    const near = (p: Vec3) => {
      const v = cornerAt(mesh, map, top, p);
      return [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]].map(Math.round);
    };
    expect(near([-8, 9, 20])).toEqual([-10, 10, 20]);
    expect(near([8, -9, 20])).toEqual([10, -10, 20]);
  });

  it('un angolo concavo è rifiutato con un messaggio', () => {
    // Due cubi a L: l'angolo interno dove il pavimento incontra la parete è concavo
    const floor = prim('box', { id: 'floor', name: 'floor', size: [60, 20, 10], position: [0, 0, 5] });
    const wall = prim('box', { id: 'wall', name: 'wall', size: [20, 20, 30], position: [-20, 0, 15] });
    const l: GroupNode = { id: 'l', name: 'l', type: 'group', op: 'union', children: ['floor', 'wall'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#fff' };
    const [mesh] = evaluate(sceneOf([floor, wall, l], ['l']));
    const map = faceMap(mesh);
    // Vertice interno (-10, ±10, 10): quello tra il pavimento e la parete
    let found = -1;
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      if (Math.abs(mesh.positions[i * 3] + 10) < 1e-3 && Math.abs(mesh.positions[i * 3 + 1] - 10) < 1e-3 && Math.abs(mesh.positions[i * 3 + 2] - 10) < 1e-3) found = i;
    }
    expect(found).toBeGreaterThanOrEqual(0);
    const result = cornerData(mesh, map, found);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('concavo') });
  });
});

describe('smusso piano', () => {
  it('un cubo con lo smusso d sull\'angolo perde d³/6', () => {
    const scene = sceneOf([prim('box')], ['a']);
    const g = cornerNear(evaluate(scene)[0], [0, 0, 1], [9, 9, 20]);
    for (const d of [2, 4, 7]) {
      const { meshes } = apply(scene, g, { treatment: 'chamfer', distance: d });
      expect(meshes[0].status).toBe('NoError');
      expect(meshes[0].volume).toBeCloseTo(8000 - d ** 3 / 6, 2);
    }
  });

  it('la distanza non supera lo spigolo più corto', () => {
    expect(effectiveDistance({ distance: 50, lengths: [20, 30, 12] })).toBe(12);
  });

  it('cubo ruotato e spostato: lo stesso volume e l\'ingombro invariato nei tre assi', () => {
    const cube = prim('box', { position: [30, 40, 10], rotation: [0, 0, 30] });
    const scene = sceneOf([cube], ['a']);
    const [before] = evaluate(scene);
    const g = cornerNear(before, [0, 0, 1], [30 + 6, 40 + 10, 20]);
    const { meshes, scene: next, groupId } = apply(scene, g, { treatment: 'chamfer', distance: 5 });
    expect(meshes[0].volume).toBeCloseTo(8000 - 125 / 6, 2);
    // Il gruppo prende la posizione del pezzo
    expect((next.nodes[groupId] as GroupNode).position).toEqual([30, 40, 10]);
    expect(meshes[0].bbox.max[2]).toBeCloseTo(before.bbox.max[2], 3);
  });

  it('due angoli di seguito (uno smusso dopo l\'altro) restano validi', () => {
    const scene = sceneOf([prim('box')], ['a']);
    const first = apply(scene, cornerNear(evaluate(scene)[0], [0, 0, 1], [9, 9, 20]), { treatment: 'chamfer', distance: 4 });
    const second = apply(first.scene, cornerNear(first.meshes[0], [0, 0, 1], [-9, 9, 20]), { treatment: 'chamfer', distance: 4 }, first.groupId);
    expect(second.meshes[0].status).toBe('NoError');
    expect(second.meshes[0].volume).toBeCloseTo(8000 - 2 * (64 / 6), 2);
  });

  it('icosaedro: un angolo con cinque spigoli si smussa e la mesh resta valida', () => {
    const scene = sceneOf([prim('icosahedron', { size: 20, cornerRadius: 0 })], ['a']);
    const [mesh] = evaluate(scene);
    const map = faceMap(mesh);
    const v = cornerAt(mesh, map, faceFacing(mesh, [0, 0, 1]), [0, 0, 20]);
    const data = cornerData(mesh, map, v);
    if (!data.ok) throw new Error(data.error);
    expect(data.geometry.directions).toHaveLength(5);
    const { meshes } = apply(scene, data.geometry, { treatment: 'chamfer', distance: 3 });
    expect(meshes[0].status).toBe('NoError');
    expect(meshes[0].volume).toBeLessThan(mesh.volume);
  });

  it('un guscio si smussa su un angolo del bordo e il codice OpenSCAD contiene hull() e polyhedron', () => {
    const shell = buildShell(sceneOf([prim('box')], ['a']), 'a', { wall: 4, bottom: 4 });
    if (!shell.ok) throw new Error(shell.error);
    const [mesh] = evaluate(shell.scene);
    const g = cornerNear(mesh, [0, 0, 1], [9.5, 9.5, 20]);
    const { scene } = apply(shell.scene, g, { treatment: 'chamfer', distance: 2 }, shell.groupId);
    const code = sceneToOpenScad(scene);
    expect(code).toContain('hull()');
    expect(code).toContain('polyhedron(');
    expect(code).not.toContain('sphere(');
  });
});

describe('smusso sferico', () => {
  it('cubo: la sfera ha centro (d,d,d) dal vertice e raggio d·√2, tangente agli spigoli', () => {
    const d = 5;
    const sphere = cornerSphere([[-1, 0, 0], [0, -1, 0], [0, 0, -1]], d)!;
    // Dal vertice, gli spigoli vanno verso -x, -y, -z: il centro sta a (-d, -d, -d)
    expect(sphere.center.map((c) => Math.round(c * 1e6) / 1e6)).toEqual([-d, -d, -d]);
    expect(sphere.radius).toBeCloseTo(d * Math.SQRT2, 9);
  });

  it('il taglierino sferico ha una sfera con i segmenti richiesti (multipli di 4, minimo 8)', () => {
    const base = { treatment: 'fillet' as const, directions: [[-1, 0, 0], [0, -1, 0], [0, 0, -1]] as Vec3[], lengths: [20, 20, 20], distance: 4 };
    expect(cornerCutter({ ...base, segments: 16 }).sphere?.segments).toBe(16);
    expect(cornerCutter({ ...base, segments: 18 }).sphere?.segments).toBe(20);
    expect(cornerCutter({ ...base, segments: 4 }).sphere?.segments).toBe(8);
    expect(cornerCutter({ ...base }).sphere?.segments).toBe(24);
  });

  it('cubo: il volume tolto coincide con la stima numerica di tetraedro meno sfera, e il raccordo toglie meno del piano', () => {
    const d = 6;
    const scene = sceneOf([prim('box')], ['a']);
    const g = cornerNear(evaluate(scene)[0], [0, 0, 1], [9, 9, 20]);
    const { meshes } = apply(scene, g, { treatment: 'fillet', distance: d, segments: 96 });
    const removed = 8000 - meshes[0].volume;

    // Stima numerica: punti del tetraedro (x + y + z ≤ d, coordinate dal vertice) fuori dalla sfera di centro (d,d,d), r = d·√2
    const n = 120;
    let outside = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const [x, y, z] = [(i + 0.5) / n * d, (j + 0.5) / n * d, (k + 0.5) / n * d];
      if (x + y + z > d) continue;
      if (Math.hypot(x - d, y - d, z - d) > d * Math.SQRT2) outside++;
    }
    const expected = outside * (d / n) ** 3;
    expect(removed).toBeGreaterThan(0);
    expect(removed).toBeLessThan((d ** 3) / 6);
    expect(Math.abs(removed - expected) / expected).toBeLessThan(0.03);
  });

  it('meno segmenti, sfera più piccola, quindi si toglie un poco di più (e la mesh resta valida)', () => {
    const scene = sceneOf([prim('box')], ['a']);
    const g = cornerNear(evaluate(scene)[0], [0, 0, 1], [9, 9, 20]);
    const rough = apply(scene, g, { treatment: 'fillet', distance: 6, segments: 8 }).meshes[0];
    const smooth = apply(scene, g, { treatment: 'fillet', distance: 6, segments: 96 }).meshes[0];
    expect(rough.status).toBe('NoError');
    expect(smooth.status).toBe('NoError');
    expect(rough.volume).toBeLessThanOrEqual(smooth.volume + 1e-6);
  });

  it('il codice OpenSCAD ha la sfera con i segmenti scelti', () => {
    const scene = sceneOf([prim('box')], ['a']);
    const g = cornerNear(evaluate(scene)[0], [0, 0, 1], [9, 9, 20]);
    const { scene: next, edgeId } = apply(scene, g, { treatment: 'fillet', distance: 5, segments: 32 });
    expect((next.nodes[edgeId] as CornerNode).segments).toBe(32);
    const code = sceneToOpenScad(next);
    expect(code).toContain('$fn = 32);');
    expect(code).toContain('sphere(r = 7.0711');
    expect(defaultCornerDistance({ lengths: [20, 20, 20] })).toBe(2);
  });
});

describe('smusso angolare su più vertici', () => {
  it('i quattro vertici alti di un cubo: un solo gruppo con quattro taglierini e le stesse misure', () => {
    const scene = sceneOf([prim('box')], ['a']);
    const [mesh] = evaluate(scene);
    const corners = ([[9, 9], [-9, 9], [-9, -9], [9, -9]] as const).map(([x, y]) => cornerNear(mesh, [0, 0, 1], [x, y, 20]));
    const result = buildCornerTreatment(scene, 'a', corners, { treatment: 'chamfer', distance: 5 });
    if (!result.ok) throw new Error(result.error);

    // Un solo gruppo Differenza: il cubo e i quattro taglierini
    const group = result.scene.nodes[result.groupId] as GroupNode;
    expect(group.children).toEqual(['a', ...result.edgeIds]);
    expect(result.edgeIds).toHaveLength(4);
    expect(result.edgeIds.every((id) => (result.scene.nodes[id] as CornerNode).distance === 5)).toBe(true);
    expect(new Set(result.edgeIds.map((id) => result.scene.nodes[id].name)).size).toBe(4);

    // Ogni angolo perde un tetraedro di lato 5: 5³/6 mm³
    const [after] = evaluate(result.scene);
    expect(after.status).toBe('NoError');
    expect(after.volume).toBeCloseTo(8000 - 4 * (125 / 6), 2);

    // Nel codice un solo difference() per il gruppo e un hull() per vertice
    const code = sceneToOpenScad(result.scene);
    expect(code.match(/difference\(\)/g)).toHaveLength(1);
    expect(code.match(/hull\(\)/g)).toHaveLength(4);
  });

  it('senza vertici dà un errore', () => {
    const result = buildCornerTreatment(sceneOf([prim('box')], ['a']), 'a', [], { treatment: 'chamfer', distance: 5 });
    expect(result.ok).toBe(false);
  });
});
