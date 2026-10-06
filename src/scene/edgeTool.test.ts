import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator, type NodeMesh } from '../kernel/evaluate';
import { primitiveDefaults } from './defaults';
import { buildEdgeTreatment, defaultEdgeParams, edgeBetween, faceMap, faceTriangles, type EdgeGeometry } from './edgeTool';
import { chamferAngle, chamferSecondDistance, edgeProfile } from './edgeProfile';
import { eulerToMatrix } from './math';
import { parentOf, useSceneStore } from './store';
import { sceneToOpenScad } from '../codegen/openscad';
import type { GroupNode, MeshNode, PrimitiveNode, Scene, SceneNode, Vec3 } from './types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

beforeEach(() => {
  useSceneStore.getState().clear();
});

const box = (id: string, position: Vec3, size: Vec3, extra: Partial<PrimitiveNode> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults('box'), id, name: id, position, size, ...extra }) as PrimitiveNode;
const group = (id: string, op: GroupNode['op'], children: string[], extra: Partial<GroupNode> = {}): GroupNode => ({
  id, name: id, type: 'group', op, children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#ffffff', ...extra,
});
const sceneOf = (nodes: SceneNode[], rootIds: string[]): Scene => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds });

/**
 * Faccia della mesh la cui normale è più vicina alla direzione indicata; con `offset` si sceglie tra le facce con la stessa
 * normale quella il cui piano (normale · p) è più vicino a quel valore.
 */
function faceFacing(mesh: NodeMesh, direction: Vec3, offset?: number): number {
  const map = faceMap(mesh);
  let best = 0;
  let bestScore = -Infinity;
  map.faces.forEach((f, i) => {
    const facing = f.normal[0] * direction[0] + f.normal[1] * direction[1] + f.normal[2] * direction[2];
    const score = facing * 1000 - (offset === undefined ? 0 : Math.abs(f.offset - offset)) + f.triangles.length * 1e-6;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Valuta la scena e restituisce la prima mesh con i suoi dati. */
const evaluate = (scene: Scene, ev = new Evaluator(wasm)) => ev.evaluate(scene).meshes;

/** Geometria dello spigolo tra due facce di una mesh, scelte per direzione della normale (e piano, se indicato). */
function edgeOf(mesh: NodeMesh, a: Vec3, b: Vec3, offsets: [number?, number?] = []): EdgeGeometry {
  const result = edgeBetween(mesh, faceMap(mesh), faceFacing(mesh, a, offsets[0]), faceFacing(mesh, b, offsets[1]));
  if (!result.ok) throw new Error(result.error);
  return result.geometry;
}

const SEGMENTS = 64;
/** Area per unità di lunghezza tolta da un raccordo con il cerchio poligonale a 64 lati, apertura β (gradi). */
function filletArea(r: number, beta: number) {
  const b = (beta * Math.PI) / 180;
  const polygon = 0.5 * SEGMENTS * r * r * Math.sin((2 * Math.PI) / SEGMENTS);
  return (r * r) / Math.tan(b / 2) - polygon * ((Math.PI - b) / (2 * Math.PI));
}

describe('facce e spigoli', () => {
  it('un cubo ha sei facce piane da due triangoli', () => {
    const [mesh] = evaluate(sceneOf([box('a', [0, 0, 10], [20, 20, 20])], ['a']));
    const map = faceMap(mesh);
    expect(map.faces).toHaveLength(6);
    expect(map.faces.every((f) => f.planar && f.triangles.length === 2)).toBe(true);
    expect(faceTriangles(mesh, map, 0)).toHaveLength(2 * 9);
  });

  it('i triangoli di una L si raggruppano nelle sue 8 facce, anche se vengono da due forme', () => {
    const l = group('l', 'union', ['floor', 'wall']);
    const scene = sceneOf([box('floor', [0, 0, 5], [60, 20, 10]), box('wall', [-20, 0, 15], [20, 20, 30]), l], ['l']);
    expect(faceMap(evaluate(scene)[0]).faces).toHaveLength(8);
  });

  it('spigolo tra la faccia superiore e quella frontale di un cubo: convesso, 90°, lungo 20 mm', () => {
    const [mesh] = evaluate(sceneOf([box('a', [0, 0, 10], [20, 20, 20])], ['a']));
    const g = edgeOf(mesh, [0, 0, 1], [0, -1, 0]);
    expect(g.convex).toBe(true);
    expect(g.angle).toBeCloseTo(90, 6);
    expect(g.length).toBeCloseTo(20, 6);
    expect(g.reach).toBeCloseTo(20, 6);
    expect(g.ends).toEqual([null, null]);
    // L'origine sta su uno spigolo: y = -10, z = 20, x a un estremo
    expect(g.origin[1]).toBeCloseTo(-10, 6);
    expect(g.origin[2]).toBeCloseTo(20, 6);
    expect(Math.abs(g.origin[0])).toBeCloseTo(10, 6);
  });

  it('errori comprensibili: facce parallele, non adiacenti, la stessa faccia', () => {
    const [cube] = evaluate(sceneOf([box('a', [0, 0, 10], [20, 20, 20])], ['a']));
    const map = faceMap(cube);
    const top = faceFacing(cube, [0, 0, 1]);
    const bottom = faceFacing(cube, [0, 0, -1]);
    expect(edgeBetween(cube, map, top, bottom)).toMatchObject({ ok: false, error: expect.stringContaining('parallele') });
    expect(edgeBetween(cube, map, top, top)).toMatchObject({ ok: false });

    const l = group('l', 'union', ['floor', 'wall']);
    const [lMesh] = evaluate(sceneOf([box('floor', [0, 0, 5], [60, 20, 10]), box('wall', [-20, 0, 15], [20, 20, 30]), l], ['l']));
    // Il lato sinistro della parete e il piano del pavimento sono perpendicolari ma non si toccano
    const result = edgeBetween(lMesh, faceMap(lMesh), faceFacing(lMesh, [-1, 0, 0]), faceFacing(lMesh, [0, 0, 1], 10));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('adiacenti') });
  });
});

describe('profilo del taglierino', () => {
  it('smusso con distanza e angolo: la seconda distanza chiude il triangolo e si può rileggere', () => {
    // Apertura 90° e angolo 45° sulla prima faccia: triangolo isoscele, d2 = d1
    expect(chamferSecondDistance(4, 45, 90)).toBeCloseTo(4, 9);
    // Angolo 30°: d2 = d1·sin30°/sin120°
    const d2 = chamferSecondDistance(4, 30, 90);
    expect(d2).toBeCloseTo((4 * Math.sin(Math.PI / 6)) / Math.sin((120 * Math.PI) / 180), 9);
    expect(chamferAngle(4, d2, 90)).toBeCloseTo(30, 6);
  });

  it('il raccordo ha il cerchio tangente alle due facce', () => {
    const { polygon, circle } = edgeProfile({ treatment: 'fillet', angle: 90, radius: 3, distance1: 1, distance2: 1 });
    // Punti di tangenza a distanza r / tan(45°) = 3 dall'apice, centro a r / sin(45°)
    expect(Math.hypot(polygon[1][0], polygon[1][1])).toBeCloseTo(3, 9);
    expect(circle!.center[0]).toBeCloseTo(3 * Math.SQRT2, 9);
  });
});

describe('raccordi e smussi applicati alla scena', () => {
  const cubeScene = () => sceneOf([box('a', [0, 0, 10], [20, 20, 20])], ['a']);

  /** Applica il trattamento a uno spigolo del pezzo `target` e valuta la nuova scena. */
  function apply(scene: Scene, target: string, geometry: EdgeGeometry, params: ReturnType<typeof defaultEdgeParams>) {
    const result = buildEdgeTreatment(scene, target, geometry, params);
    if (!result.ok) throw new Error(result.error);
    return { ...result, meshes: evaluate(result.scene) };
  }

  it('raccordo su uno spigolo convesso: toglie la sezione per la lunghezza, scena valida', () => {
    const scene = cubeScene();
    const [mesh] = evaluate(scene);
    const geometry = edgeOf(mesh, [0, 0, 1], [0, -1, 0]);
    const { meshes, scene: next, groupId, edgeId } = apply(scene, 'a', geometry, { treatment: 'fillet', radius: 3, distance1: 1, distance2: 1 });
    expect(meshes).toHaveLength(1);
    expect(meshes[0].status).toBe('NoError');
    expect(meshes[0].volume).toBeCloseTo(8000 - filletArea(3, 90) * 20, 1);
    // Struttura: gruppo Differenza con pezzo e taglierino, al posto del pezzo alla radice
    expect(next.rootIds).toEqual([groupId]);
    expect((next.nodes[groupId] as GroupNode).op).toBe('difference');
    expect((next.nodes[groupId] as GroupNode).children).toEqual(['a', edgeId]);
    // La scena originale non cambia
    expect(scene.rootIds).toEqual(['a']);
  });

  it('smusso a distanza uguale: toglie ½·d²·L', () => {
    const scene = cubeScene();
    const geometry = edgeOf(evaluate(scene)[0], [0, 0, 1], [1, 0, 0]);
    const { meshes } = apply(scene, 'a', geometry, { treatment: 'chamfer', radius: 1, distance1: 3, distance2: 3 });
    expect(meshes[0].volume).toBeCloseTo(8000 - 0.5 * 3 * 3 * 20, 2);
  });

  it('smusso a due distanze: toglie ½·d1·d2·L', () => {
    const scene = cubeScene();
    const geometry = edgeOf(evaluate(scene)[0], [0, 0, 1], [0, 1, 0]);
    const { meshes } = apply(scene, 'a', geometry, { treatment: 'chamfer', radius: 1, distance1: 2, distance2: 5 });
    expect(meshes[0].volume).toBeCloseTo(8000 - 0.5 * 2 * 5 * 20, 2);
  });

  it('spigolo concavo di una L: aggiunge materiale con un gruppo Unione', () => {
    const l = group('l', 'union', ['floor', 'wall']);
    const scene = sceneOf([box('floor', [0, 0, 5], [60, 20, 10]), box('wall', [-20, 0, 15], [20, 20, 30]), l], ['l']);
    const [mesh] = evaluate(scene);
    // Parete interna (normale +X nel piano x = -10) e piano del pavimento (normale +Z, z = 10)
    const geometry = edgeOf(mesh, [1, 0, 0], [0, 0, 1], [-10, 10]);
    expect(geometry.convex).toBe(false);
    const { meshes, scene: next, groupId } = apply(scene, 'l', geometry, { treatment: 'fillet', radius: 3, distance1: 1, distance2: 1 });
    expect((next.nodes[groupId] as GroupNode).op).toBe('union');
    expect(meshes[0].status).toBe('NoError');
    expect(meshes[0].volume).toBeCloseTo(20000 + filletArea(3, 90) * 20, 1);
  });

  it('cubo ruotato e traslato: stesso volume rimosso', () => {
    const rotation: Vec3 = [10, 20, 30];
    const scene = sceneOf([box('a', [15, -8, 12], [20, 20, 20], { rotation })], ['a']);
    const [mesh] = evaluate(scene);
    const m = eulerToMatrix(rotation);
    const axis = (col: number, sign: number): Vec3 => [sign * m[0][col], sign * m[1][col], sign * m[2][col]];
    const geometry = edgeOf(mesh, axis(2, 1), axis(1, -1));
    const { meshes } = apply(scene, 'a', geometry, { treatment: 'fillet', radius: 3, distance1: 1, distance2: 1 });
    expect(meshes[0].status).toBe('NoError');
    expect(meshes[0].volume).toBeCloseTo(8000 - filletArea(3, 90) * 20, 1);
  });

  it('pezzo dentro un Raggruppa trasformato: il raccordo entra nel gruppo e la forma è corretta', () => {
    const scene = sceneOf([box('a', [10, 0, 10], [20, 20, 20]), group('g', 'group', ['a'], { position: [30, 5, 0], rotation: [0, 0, 40] })], ['g']);
    const [mesh] = evaluate(scene);
    const geometry = edgeOf(mesh, [0, 0, 1], [-Math.sin((40 * Math.PI) / 180), -Math.cos((40 * Math.PI) / 180), 0]);
    const { meshes, scene: next, groupId } = apply(scene, 'a', geometry, { treatment: 'fillet', radius: 3, distance1: 1, distance2: 1 });
    expect(parentOf(next, groupId)).toBe('g');
    expect((next.nodes.g as GroupNode).children).toEqual([groupId]);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].volume).toBeCloseTo(8000 - filletArea(3, 90) * 20, 1);
  });

  it('due raccordi di seguito: i gruppi si annidano e la mesh resta valida', () => {
    const scene = cubeScene();
    const first = apply(scene, 'a', edgeOf(evaluate(scene)[0], [0, 0, 1], [0, -1, 0]), { treatment: 'fillet', radius: 3, distance1: 1, distance2: 1 });
    const second = apply(first.scene, first.groupId, edgeOf(first.meshes[0], [0, 0, 1], [1, 0, 0]), { treatment: 'chamfer', radius: 1, distance1: 2, distance2: 2 });
    expect(second.meshes[0].status).toBe('NoError');
    expect(second.meshes[0].volume).toBeLessThan(first.meshes[0].volume);
    expect((second.scene.nodes[second.groupId] as GroupNode).children[0]).toBe(first.groupId);
  });

  it('estremità oblique: il taglierino si ritaglia sui piani di chiusura e il volume resta A·L', () => {
    // Prisma con le basi tagliate in modo obliquo (z = 0,5·y e z = 20 + 0,5·y): ogni spigolo verticale è lungo 20 mm
    const corners: [number, number][] = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const positions = new Float32Array([...corners.flatMap(([x, y]) => [x, y, 0.5 * y]), ...corners.flatMap(([x, y]) => [x, y, 20 + 0.5 * y])]);
    const indices = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    const ev = new Evaluator(wasm);
    expect(ev.registerAsset('prism', positions, indices).ok).toBe(true);
    const mesh: MeshNode = { id: 'p', name: 'p', type: 'mesh', assetId: 'prism', fileName: 'p.stl', origin: [0, 0, 0], scale: 1, triangles: 12, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#fff' };
    const scene = sceneOf([mesh], ['p']);
    const [m0] = evaluate(scene, ev);
    const geometry = edgeOf(m0, [1, 0, 0], [0, 1, 0]);
    expect(geometry.ends[0]).not.toBeNull();
    expect(geometry.ends[1]).not.toBeNull();
    expect(geometry.length).toBeCloseTo(20, 6); // lo spigolo verticale in (10, 10) va da z = 5 a z = 25

    const result = buildEdgeTreatment(scene, 'p', geometry, { treatment: 'fillet', radius: 3, distance1: 1, distance2: 1 });
    if (!result.ok) throw new Error(result.error);
    const filleted = evaluate(result.scene, ev);
    expect(filleted[0].status).toBe('NoError');
    // Le due basi sono parallele e inclinate allo stesso modo: ogni punto della sezione ha lunghezza 20, quindi toglie A·20
    expect(filleted[0].volume).toBeCloseTo(8000 - filletArea(3, 90) * 20, 1);

    // Il codice usa l'intersezione con i piani di chiusura
    const code = sceneToOpenScad(result.scene);
    expect(code).toContain('intersection() {');
    expect(code).toContain('multmatrix(');
  });
});

describe('codice OpenSCAD del taglierino', () => {
  it('estremità perpendicolari: solo l\'estrusione della sezione, senza intersezioni', () => {
    const scene = sceneOf([box('a', [0, 0, 10], [20, 20, 20])], ['a']);
    const geometry = edgeOf(evaluate(scene)[0], [0, 0, 1], [0, -1, 0]);
    const result = buildEdgeTreatment(scene, 'a', geometry, { treatment: 'fillet', radius: 3, distance1: 1, distance2: 1 });
    if (!result.ok) throw new Error(result.error);
    const code = sceneToOpenScad(result.scene);
    expect(code).toContain('difference() {');
    expect(code).toContain('linear_extrude(height = 20)');
    expect(code).toContain('circle(r = 3, $fn = 64);');
    expect(code).not.toContain('intersection()');
    expect(code).not.toContain('multmatrix');
    // Un comando per riga
    for (const line of code.split('\n')) {
      const commands = line.replace(/\[[^\]]*\]/g, '[]').match(/\b[a-z_]+\s*\(/g) ?? [];
      expect(commands.length, line).toBeLessThanOrEqual(1);
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });

  it('smusso: poligono senza cerchio', () => {
    const scene = sceneOf([box('a', [0, 0, 10], [20, 20, 20])], ['a']);
    const geometry = edgeOf(evaluate(scene)[0], [0, 0, 1], [0, -1, 0]);
    const result = buildEdgeTreatment(scene, 'a', geometry, { treatment: 'chamfer', radius: 1, distance1: 2, distance2: 2 });
    if (!result.ok) throw new Error(result.error);
    const code = sceneToOpenScad(result.scene);
    expect(code).toContain('polygon([[0, 0],');
    expect(code).not.toContain('circle(');
  });
});

describe('rifiuti', () => {
  it('un oggetto bloccato non si raccorda', () => {
    const scene = sceneOf([box('a', [0, 0, 10], [20, 20, 20], { locked: true })], ['a']);
    const geometry = edgeOf(evaluate(scene)[0], [0, 0, 1], [0, -1, 0]);
    expect(buildEdgeTreatment(scene, 'a', geometry, { treatment: 'fillet', radius: 3, distance1: 1, distance2: 1 })).toMatchObject({ ok: false });
  });

  it('valori iniziali piccoli rispetto alle facce', () => {
    const params = defaultEdgeParams('fillet', { angle: 90, reach: 4 });
    expect(params.radius).toBeLessThanOrEqual(2);
    expect(params.radius).toBeGreaterThan(0);
  });
});
