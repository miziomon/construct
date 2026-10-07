import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { Evaluator, type NodeMesh } from '../kernel/evaluate';
import { primitiveDefaults } from './defaults';
import { buildEdgeTreatment, defaultEdgeParams, edgeBetween, faceMap, type EdgeGeometry } from './edgeTool';
import { buildShell } from './shellTool';
import { normalizeTreatmentGroups } from './treatment';
import { sceneFromJson } from './persistence';
import { sceneToOpenScad } from '../codegen/openscad';
import type { EdgeNode, GroupNode, PrimitiveNode, Scene, SceneNode, Vec3 } from './types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const box = (id: string, position: Vec3, size: Vec3, extra: Partial<PrimitiveNode> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults('box'), id, name: id, position, size, ...extra }) as PrimitiveNode;
const sceneOf = (nodes: SceneNode[], rootIds: string[]): Scene => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds });
const evaluate = (scene: Scene) => new Evaluator(wasm).evaluate(scene).meshes;
/** Solido calcolato dal kernel per l'intera scena (unione dei solid). */
const solidOf = (scene: Scene): Manifold => new Evaluator(wasm).unionOfSolids(scene);

/** Faccia della mesh la cui normale è più vicina alla direzione indicata. */
function faceFacing(mesh: NodeMesh, direction: Vec3): number {
  const map = faceMap(mesh);
  let best = 0;
  let bestScore = -Infinity;
  map.faces.forEach((f, i) => {
    const score = (f.normal[0] * direction[0] + f.normal[1] * direction[1] + f.normal[2] * direction[2]) * 1000 + f.triangles.length * 1e-6;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Spigolo tra le facce di una mesh scelte per direzione della normale. */
function edgeOf(mesh: NodeMesh, a: Vec3, b: Vec3): EdgeGeometry {
  const result = edgeBetween(mesh, faceMap(mesh), faceFacing(mesh, a), faceFacing(mesh, b));
  if (!result.ok) throw new Error(result.error);
  return result.geometry;
}


/**
 * Due solidi sono lo stesso solido se hanno lo stesso volume e le sezioni (ogni mezzo millimetro, lungo i tre assi) la
 * stessa area. Il confronto non usa booleane tra i due (tra superfici quasi complanari darebbero falsi residui) e il
 * solido calcolato è quello del kernel, non una mesh riletta: la mesh ha coordinate float32 e ricostruirne un Manifold
 * può spostare di qualche decimo di mm³ il volume.
 */
function expectSameSolid(actual: Manifold, expected: Manifold) {
  expect(actual.volume()).toBeCloseTo(expected.volume(), 2);
  const turns: [number, number, number][] = [[0, 0, 0], [90, 0, 0], [0, 90, 0]];
  for (const turn of turns) {
    const a = actual.rotate(turn);
    const e = expected.rotate(turn);
    const box = e.boundingBox();
    for (let z = box.min[2] + 0.25; z < box.max[2]; z += 0.5) {
      const [sa, se] = [a.slice(z), e.slice(z)];
      expect(sa.area(), `sezione a ${z} (rotazione ${turn})`).toBeCloseTo(se.area(), 2);
      sa.delete();
      se.delete();
    }
    a.delete();
    e.delete();
  }
}

describe('il gruppo dei trattamenti prende la posizione del pezzo (gizmo sull\'oggetto)', () => {
  const bboxOf = (scene: Scene) => evaluate(scene)[0].bbox;

  it('raccordo: il gruppo ha posizione e rotazione del pezzo e nel mondo nulla si sposta', () => {
    const scene = sceneOf([box('a', [30, 40, 10], [20, 20, 20], { rotation: [0, 0, 30] })], ['a']);
    const [mesh] = evaluate(scene);
    const geometry = edgeOf(mesh, [0, 0, 1], [0, -1, 0]);
    const result = buildEdgeTreatment(scene, 'a', geometry, { ...defaultEdgeParams('chamfer', geometry), distance1: 3, distance2: 3 });
    if (!result.ok) throw new Error(result.error);
    const group = result.scene.nodes[result.groupId] as GroupNode;
    expect(group.position).toEqual([30, 40, 10]);
    expect(group.rotation).toEqual([0, 0, 30]);
    expect(result.scene.nodes.a.position).toEqual([0, 0, 0]);
    expect(result.scene.nodes.a.rotation).toEqual([0, 0, 0]);
    // Il taglierino sta nel sistema del gruppo: la mesh ha lo stesso ingombro di prima dello smusso
    const after = bboxOf(result.scene);
    const before = mesh.bbox;
    for (let i = 0; i < 3; i++) {
      expect(after.min[i]).toBeCloseTo(before.min[i], 3);
      expect(after.max[i]).toBeCloseTo(before.max[i], 3);
    }
    expect(evaluate(result.scene)[0].volume).toBeLessThan(8000);
  });

  it('guscio: il gruppo prende posizione e rotazione, la geometria è la stessa di quando il pezzo le aveva', () => {
    const cube = box('a', [30, 40, 10], [20, 20, 20], { rotation: [0, 0, 30] });
    const result = buildShell(sceneOf([cube], ['a']), 'a', { wall: 2, bottom: 2 });
    if (!result.ok) throw new Error(result.error);
    const group = result.scene.nodes[result.groupId] as GroupNode;
    expect(group.position).toEqual([30, 40, 10]);
    expect(group.rotation).toEqual([0, 0, 30]);
    expect(evaluate(result.scene)[0].volume).toBeCloseTo(8000 - 16 * 16 * 18, 3);
    // Il solido pieno e quello svuotato hanno lo stesso ingombro nel mondo
    const full = evaluate(sceneOf([cube], ['a']))[0].bbox;
    const hollow = evaluate(result.scene)[0].bbox;
    for (let i = 0; i < 3; i++) {
      expect(hollow.min[i]).toBeCloseTo(full.min[i], 3);
      expect(hollow.max[i]).toBeCloseTo(full.max[i], 3);
    }
  });

  it('trattamento di un pezzo dentro un gruppo trasformato: la posizione resta quella del mondo', () => {
    const inner = box('a', [10, 0, 10], [20, 20, 20]);
    const outer: GroupNode = { id: 'g', name: 'g', type: 'group', op: 'group', children: ['a'], position: [30, 5, 0], rotation: [0, 0, 40], mode: 'solid', color: '#fff' };
    const scene = sceneOf([inner, outer], ['g']);
    const before = evaluate(scene)[0].bbox;
    const result = buildShell(scene, 'a', { wall: 2, bottom: 2 });
    if (!result.ok) throw new Error(result.error);
    const after = evaluate(result.scene)[0].bbox;
    for (let i = 0; i < 3; i++) {
      expect(after.min[i]).toBeCloseTo(before.min[i], 3);
      expect(after.max[i]).toBeCloseTo(before.max[i], 3);
    }
    expect((result.scene.nodes[result.groupId] as GroupNode).position).toEqual([10, 0, 10]);
  });
});

describe('migrazione delle scene salvate con il gruppo all\'origine', () => {
  /** Scena nel formato della 0.9.0: gruppo a zero, posizione sul pezzo, taglierino nel sistema del genitore. */
  function legacyScene() {
    const cube = box('a', [30, 40, 10], [20, 20, 20], { rotation: [0, 0, 30] });
    const fresh = sceneOf([cube], ['a']);
    const geometry = edgeOf(evaluate(fresh)[0], [0, 0, 1], [0, -1, 0]);
    const result = buildEdgeTreatment(fresh, 'a', geometry, { ...defaultEdgeParams('chamfer', geometry), distance1: 3, distance2: 3 });
    if (!result.ok) throw new Error(result.error);
    return { fresh: result.scene, groupId: result.groupId, edgeId: result.edgeId, cube, geometry };
  }

  it('riporta la trasformazione sul gruppo senza cambiare la mesh', () => {
    const { fresh, groupId, edgeId, cube, geometry } = legacyScene();
    // Ricostruisce il vecchio formato: gruppo a zero, trasformazione sul pezzo e taglierino nel mondo
    const legacy: Scene = JSON.parse(JSON.stringify(fresh));
    legacy.nodes.a = cube;
    legacy.nodes[groupId] = { ...(legacy.nodes[groupId] as GroupNode), position: [0, 0, 0], rotation: [0, 0, 0] };
    legacy.nodes[edgeId] = { ...(legacy.nodes[edgeId] as EdgeNode), position: geometry.origin.map((v) => Math.round(v * 1e4) / 1e4) as Vec3, rotation: geometry.rotation.map((v) => Math.round(v * 1e4) / 1e4) as Vec3 };

    const migrated = normalizeTreatmentGroups(legacy);
    expect((migrated.nodes[groupId] as GroupNode).position).toEqual([30, 40, 10]);
    expect(migrated.nodes.a.position).toEqual([0, 0, 0]);
    const [expected] = evaluate(fresh);
    const [actual] = evaluate(migrated);
    expect(actual.volume).toBeCloseTo(expected.volume, 1);
    for (let i = 0; i < 3; i++) {
      expect(actual.bbox.min[i]).toBeCloseTo(expected.bbox.min[i], 2);
      expect(actual.bbox.max[i]).toBeCloseTo(expected.bbox.max[i], 2);
    }
    // Idempotente: un secondo passaggio non cambia nulla
    expect(normalizeTreatmentGroups(migrated)).toBe(migrated);
  });
});

describe('due smussi su spigoli adiacenti della faccia superiore', () => {
  /**
   * Cubo da 20 mm con uno smusso piano su ciascuno degli spigoli superiori indicati: lato (normale uscente della faccia
   * laterale), distanza lungo la cima `top` e lungo il lato `side`. Il piano passa per i punti a `top` dallo spigolo sulla
   * cima e a `side` di profondità sul lato: ds·u + dt·z = 10·ds + 20·dt − ds·dt, con u la coordinata lungo la normale del lato.
   */
  function reference(cuts: { side: [number, number]; top: number; sideDepth: number }[]): Manifold {
    let m = wasm.Manifold.cube([20, 20, 20]).translate([-10, -10, 0]);
    for (const { side: [sx, sy], top, sideDepth } of cuts) {
      const norm = Math.hypot(sideDepth, top);
      const offset = (10 * sideDepth + 20 * top - sideDepth * top) / norm;
      // Si tiene la parte con n·p ≤ offset; trimByPlane tiene il lato verso cui punta la normale, quindi si inverte
      const trimmed = m.trimByPlane([(-sideDepth * sx) / norm, (-sideDepth * sy) / norm, -top / norm], -offset);
      m.delete();
      m = trimmed;
    }
    return m;
  }

  const SIDES: Record<string, { side: [number, number]; normal: Vec3 }> = {
    fronte: { side: [0, -1], normal: [0, -1, 0] },
    retro: { side: [0, 1], normal: [0, 1, 0] },
    sinistra: { side: [-1, 0], normal: [-1, 0, 0] },
    destra: { side: [1, 0], normal: [1, 0, 0] },
  };
  const PAIRS: [keyof typeof SIDES, keyof typeof SIDES][] = [
    ['fronte', 'destra'],
    ['destra', 'fronte'],
    ['fronte', 'sinistra'],
    ['sinistra', 'fronte'],
    ['retro', 'destra'],
    ['destra', 'retro'],
    ['retro', 'sinistra'],
    ['sinistra', 'retro'],
  ];

  /** Applica in sequenza smussi (top, lato) agli spigoli indicati e confronta con la costruzione di riferimento. */
  function chamferSequence(names: (keyof typeof SIDES)[], dists: [number, number][], options: { rotation?: Vec3; position?: Vec3; shellWall?: number } = {}) {
    const position = options.position ?? [0, 0, 10];
    const rotation = options.rotation ?? [0, 0, 0];
    let scene = sceneOf([box('a', position, [20, 20, 20], { rotation })], ['a']);
    let target = 'a';
    if (options.shellWall) {
      // Prima si svuota il cubo (cima aperta): gli smussi vanno sul bordo superiore delle pareti
      const shell = buildShell(scene, 'a', { wall: options.shellWall, bottom: options.shellWall });
      if (!shell.ok) throw new Error(shell.error);
      scene = shell.scene;
      target = shell.groupId;
    }
    names.forEach((name, i) => {
      const mesh = evaluate(scene)[0];
      // Prima faccia = la cima, seconda = il lato: distance1 corre lungo la cima, distance2 lungo il lato
      const geometry = edgeOf(mesh, [0, 0, 1], SIDES[name].normal);
      const result = buildEdgeTreatment(scene, target, geometry, { ...defaultEdgeParams('chamfer', geometry), distance1: dists[i][0], distance2: dists[i][1] });
      if (!result.ok) throw new Error(result.error);
      scene = result.scene;
      target = result.groupId;
    });
    const [mesh] = evaluate(scene);
    expect(mesh.status).toBe('NoError');
    const actual = solidOf(scene);
    let expected = reference(names.map((n, i) => ({ side: SIDES[n].side, top: dists[i][0], sideDepth: dists[i][1] })));
    if (options.shellWall) {
      // Cavità del guscio: stessa del kernel (parete e fondo di `shellWall`, aperta in cima)
      const w = options.shellWall;
      const cavity = wasm.Manifold.cube([20 - 2 * w, 20 - 2 * w, 20 - w + 1]).translate([-10 + w, -10 + w, w]);
      expected = wasm.Manifold.difference([expected, cavity]);
    }
    // Il cubo di riferimento è nel suo sistema locale (base a z = 0, centrato in xy): lo si porta dove sta il cubo
    expected = expected.translate([0, 0, -10]).rotate(rotation).translate(position);
    // Stesso solido: stesso volume e stesse aree delle sezioni lungo i tre assi
    expectSameSolid(actual, expected);
    expect(mesh.volume).toBeCloseTo(expected.volume(), 2);
  }

  it.each(PAIRS)('distanze uguali: %s e poi %s coincide con la costruzione di riferimento', (first, second) => {
    chamferSequence([first, second], [[3, 3], [3, 3]]);
  });

  it.each(PAIRS)('distanze diverse per ciascuno smusso: %s (5) e poi %s (2)', (first, second) => {
    chamferSequence([first, second], [[5, 5], [2, 2]]);
  });

  it.each(PAIRS)('due distanze diverse in ogni smusso: %s e poi %s', (first, second) => {
    chamferSequence([first, second], [[6, 2], [3, 7]]);
  });

  it('tre e quattro spigoli superiori di seguito', () => {
    chamferSequence(['fronte', 'destra', 'retro'], [[3, 3], [2, 4], [5, 5]]);
    chamferSequence(['fronte', 'destra', 'retro', 'sinistra'], [[3, 3], [3, 3], [3, 3], [3, 3]]);
  });

  it.each(PAIRS)('cubo ruotato e spostato: %s e poi %s', (first, second) => {
    chamferSequence([first, second], [[3, 3], [4, 2]], { rotation: [0, 0, 30], position: [30, 40, 10] });
  });

  it.each(PAIRS)('bordo superiore delle pareti di un guscio: %s e poi %s', (first, second) => {
    chamferSequence([first, second], [[1.5, 1.5], [1.5, 1.5]], { shellWall: 4 });
  });
});

describe('smussi a coppie su tutti gli spigoli di un cubo', () => {
  type V = [number, number, number];
  const AXES: V[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const unit = (a: V): V => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

  /** I 12 spigoli del cubo: coppie di normali perpendicolari, ciascuna una volta sola. */
  const EDGES: [V, V][] = [];
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (dot(AXES[i], AXES[j]) === 0) EDGES.push([AXES[i], AXES[j]]);

  /** Taglio di riferimento di uno smusso piano tra le facce n1 (distanza d1 lungo di essa) e n2 (d2), su un cubo di lato 20 centrato nell'origine. */
  function cut(m: Manifold, n1: V, n2: V, d1: number, d2: number): Manifold {
    const t = cross(n1, n2);
    // Punto sullo spigolo, poi i due punti dello smusso: a d1 dallo spigolo sulla faccia 1 e a d2 sulla faccia 2
    const e: V = [10 * (n1[0] + n2[0]), 10 * (n1[1] + n2[1]), 10 * (n1[2] + n2[2])];
    const p1: V = [e[0] - d1 * n2[0], e[1] - d1 * n2[1], e[2] - d1 * n2[2]];
    const p2: V = [e[0] - d2 * n1[0], e[1] - d2 * n1[1], e[2] - d2 * n1[2]];
    let normal = unit(cross(sub(p2, p1), t));
    // La normale deve guardare verso l'esterno (verso lo spigolo)
    if (dot(normal, sub(e, p1)) < 0) normal = [-normal[0], -normal[1], -normal[2]];
    // trimByPlane tiene il lato verso cui punta la normale: si inverte per tenere normale·p ≤ offset
    return m.trimByPlane([-normal[0], -normal[1], -normal[2]], -dot(normal, p1));
  }

  /** Smussa in sequenza gli spigoli indicati (come farebbe l'utente) e confronta con il riferimento. */
  function run(steps: { edge: [V, V]; swap: boolean; d: [number, number] }[]) {
    let scene = sceneOf([box('a', [0, 0, 10], [20, 20, 20])], ['a']);
    let target = 'a';
    let expected = wasm.Manifold.cube([20, 20, 20], true);
    for (const { edge: [n1, n2], swap, d } of steps) {
      const [fa, fb] = swap ? [n2, n1] : [n1, n2];
      // Le normali delle facce del cubo sono quelle del cubo in posizione: il cubo sta a z da 0 a 20
      const mesh = evaluate(scene)[0];
      const geometry = edgeOf(mesh, fa, fb);
      const result = buildEdgeTreatment(scene, target, geometry, { ...defaultEdgeParams('chamfer', geometry), distance1: d[0], distance2: d[1] });
      if (!result.ok) throw new Error(result.error);
      scene = result.scene;
      target = result.groupId;
      // distance1 corre sulla prima faccia scelta
      expected = cut(expected, fa, fb, d[0], d[1]);
    }
    const [mesh] = evaluate(scene);
    expect(mesh.status).toBe('NoError');
    // Il cubo di riferimento sta centrato nell'origine, quello della scena ha la base a z = 0
    const actual = solidOf(scene).translate([0, 0, -10]);
    expectSameSolid(actual, expected);
    expect(mesh.volume).toBeCloseTo(expected.volume(), 2);
  }

  // Coppie di spigoli che si incontrano in un vertice (condividono una normale con la stessa combinazione in un angolo)
  const sharesVertex = (a: [V, V], b: [V, V]) => {
    for (const x of AXES) for (const y of AXES) for (const z of AXES) {
      if (dot(x, y) || dot(x, z) || dot(y, z)) continue;
      const faces = [x, y, z];
      const has = (e: [V, V]) => e.every((n) => faces.some((f) => f === n));
      if (has(a) && has(b)) return true;
    }
    return false;
  };
  const PAIRS: [number, number][] = [];
  for (let i = 0; i < EDGES.length; i++) for (let j = 0; j < EDGES.length; j++) if (i !== j && sharesVertex(EDGES[i], EDGES[j])) PAIRS.push([i, j]);

  it('ci sono 48 coppie ordinate di spigoli che si incontrano in un vertice', () => {
    expect(PAIRS).toHaveLength(48);
  });

  it.each(PAIRS)('spigolo %i e poi %i, ordine delle facce e distanze diversi', (i, j) => {
    for (const swap of [false, true]) {
      run([{ edge: EDGES[i], swap, d: [3, 3] }, { edge: EDGES[j], swap: !swap, d: [4, 2] }]);
    }
  });
});

describe('modifica del primo smusso dopo aver creato il secondo', () => {
  /** Cubo centrato nell'origine con uno smusso 45° di distanza d sullo spigolo superiore verso il lato (sx, sy): n·p ≤ (20 − d)/√2. */
  function reference(cuts: { side: [number, number]; d: number }[]): Manifold {
    let m = wasm.Manifold.cube([20, 20, 20], true);
    for (const { side: [sx, sy], d } of cuts) {
      const k = Math.SQRT1_2;
      const trimmed = m.trimByPlane([-sx * k, -sy * k, -k], -((20 - d) * k));
      m.delete();
      m = trimmed;
    }
    return m;
  }

  it.each([1, 3, 5, 8])('il primo smusso passa da 3 mm a %s mm: il secondo resta coerente', (d1) => {
    let scene = sceneOf([box('a', [0, 0, 10], [20, 20, 20])], ['a']);
    let target = 'a';
    const ids: string[] = [];
    for (const normal of [[0, -1, 0], [1, 0, 0]] as Vec3[]) {
      const geometry = edgeOf(evaluate(scene)[0], [0, 0, 1], normal);
      const result = buildEdgeTreatment(scene, target, geometry, { ...defaultEdgeParams('chamfer', geometry), distance1: 3, distance2: 3 });
      if (!result.ok) throw new Error(result.error);
      scene = result.scene;
      target = result.groupId;
      ids.push(result.edgeId);
    }
    // Come dal pannello delle proprietà: si cambia la misura del primo taglierino
    scene = { ...scene, nodes: { ...scene.nodes, [ids[0]]: { ...scene.nodes[ids[0]], distance1: d1, distance2: d1 } as EdgeNode } };
    const expected = reference([{ side: [0, -1], d: d1 }, { side: [1, 0], d: 3 }]).translate([0, 0, 10]);
    expectSameSolid(solidOf(scene), expected);
  });

  it('anche il codice OpenSCAD segue il primo smusso: il piano di chiusura cambia con la sua misura', () => {
    let scene = sceneOf([box('a', [0, 0, 10], [20, 20, 20])], ['a']);
    let target = 'a';
    const ids: string[] = [];
    for (const normal of [[0, -1, 0], [1, 0, 0]] as Vec3[]) {
      const geometry = edgeOf(evaluate(scene)[0], [0, 0, 1], normal);
      const result = buildEdgeTreatment(scene, target, geometry, { ...defaultEdgeParams('chamfer', geometry), distance1: 3, distance2: 3 });
      if (!result.ok) throw new Error(result.error);
      scene = result.scene;
      target = result.groupId;
      ids.push(result.edgeId);
    }
    // Il secondo taglierino ricorda quale smusso chiude la sua estremità
    expect((scene.nodes[ids[1]] as EdgeNode).endVia?.filter(Boolean)).toEqual([ids[0]]);
    const before = sceneToOpenScad(scene);
    const changed = { ...scene, nodes: { ...scene.nodes, [ids[0]]: { ...scene.nodes[ids[0]], distance1: 1, distance2: 1 } as EdgeNode } };
    expect(sceneToOpenScad(changed)).not.toBe(before);
  });
});


describe('due smussi che si incontrano in un angolo', () => {
  it('il secondo taglierino non lascia pellicole oltre la faccia del primo', () => {
    const scene = sceneFromJson(readFileSync('save/webcad-progetto.json', 'utf8')).scene;
    const [mesh] = evaluate(scene);
    // Il volume è quello corretto (cubo 50 con due smussi da 10) e la mesh non ha vertici spuri sulla faccia alta
    expect(mesh.volume).toBeCloseTo(120333.333, 1);
    const vertices = new Set<string>();
    for (let i = 0; i < mesh.positions.length; i += 3) vertices.add([0, 1, 2].map((k) => mesh.positions[i + k].toFixed(2)).join(','));
    expect(vertices.has('25.00,-15.00,50.00')).toBe(false);
  });
});

describe('raccordi che si incontrano in un angolo', () => {
  /** Taglierino di raccordo come lo produce lo strumento, ma con la lunghezza e la posizione indicate. */
  const filletCutter = (id: string, position: Vec3, rotation: Vec3, length: number): EdgeNode => ({
    id, type: 'edge', name: id, position, rotation, mode: 'solid', color: '#fff', treatment: 'fillet', convex: true, angle: 90,
    length, radius: 10, segments: 64, distance1: 2, distance2: 2, reach: 50, ends: [null, null],
  });

  it('tre raccordi in sequenza danno l\'incontro di cilindri, senza pinne oltre la tangenza', () => {
    // Cubo 50 sul piatto: raccordi sugli spigoli alti +X, poi -Y, poi -X, tutti di raggio 10
    let scene = sceneOf([box('a', [0, 0, 25], [50, 50, 50])], ['a']);
    let target = 'a';
    for (const normal of [[1, 0, 0], [0, -1, 0], [-1, 0, 0]] as Vec3[]) {
      const geometry = edgeOf(evaluate(scene)[0], [0, 0, 1], normal);
      const result = buildEdgeTreatment(scene, target, geometry, { ...defaultEdgeParams('fillet', geometry), radius: 10 });
      if (!result.ok) throw new Error(result.error);
      scene = result.scene;
      target = result.groupId;
    }

    // Riferimento: stesso cubo meno tre taglierini a lunghezza piena (i valori sono quelli del file di progetto)
    const group: GroupNode = {
      id: 'g', name: 'g', type: 'group', op: 'difference', children: ['a', 'c1', 'c2', 'c3'], position: [0, 0, 25], rotation: [0, 0, 0], mode: 'solid', color: '#fff',
    };
    const reference = sceneOf(
      [
        box('a', [0, 0, 0], [50, 50, 50]),
        filletCutter('c1', [25, 25, 25], [-90, 45, 180], 50),
        filletCutter('c2', [25, -25, 25], [-90, 45, 90], 50),
        filletCutter('c3', [-25, -25, 25], [-90, 45, 0], 50),
        group,
      ],
      ['g'],
    );
    expectSameSolid(solidOf(scene), solidOf(reference));

    // Le estremità libere dei taglierini sono sulle facce del cubo: senza un po' di abbondanza il taglio si ferma una
    // frazione di micron prima e resta una lamina con lo spigolo vivo (vertici sugli angoli alti non raccordati)
    const [mesh] = evaluate(scene);
    const vertices = new Set<string>();
    for (let i = 0; i < mesh.positions.length; i += 3) vertices.add([0, 1, 2].map((k) => mesh.positions[i + k].toFixed(2)).join(','));
    for (const corner of ['25.00,25.00,50.00', '-25.00,25.00,50.00', '-25.00,-25.00,50.00', '25.00,-25.00,50.00']) {
      expect(vertices.has(corner), `vertice vivo ${corner}`).toBe(false);
    }
    // Nessun triangolo degenere (area quasi nulla)
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a0, b0, c0] = [0, 1, 2].map((k) => [0, 1, 2].map((j) => mesh.positions[mesh.indices[t + k] * 3 + j]));
      const u = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]];
      const v = [c0[0] - a0[0], c0[1] - a0[1], c0[2] - a0[2]];
      const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
      expect(area, `triangolo ${t / 3}`).toBeGreaterThan(1e-6);
    }
  });
});
