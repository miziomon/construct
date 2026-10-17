import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from '../kernel/evaluate';
import type { NodeMesh } from '../kernel/evaluate';
import { primitiveDefaults } from './defaults';
import { buildEdgeTreatment, edgeBetween, faceMap } from './edgeTool';
import { apply, eulerToMatrix } from './math';
import { localToWorld, worldToLocal } from './patternTool';
import { FACE_DIRECTIONS, defaultPatternParams, faceFrame, faceFromBounds, faceName, hasPlanarFace, isAxisFace, frameRect, normalizePattern, patternCells, PATTERN_MAX_CELLS, sameFace, thicknessAlong } from './pattern';
import type { FaceDirection } from './pattern';
import { PATTERN_ALGORITHM } from './voronoi';
import type { GroupNode, PatternParams, PrimitiveNode, Scene, Vec3 } from './types';

const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
const params = (patch: Partial<PatternParams> = {}): PatternParams => ({ ...defaultPatternParams(bounds, 7), ...patch });
const near = (a: readonly number[], b: readonly number[], digits = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('facce e riferimento', () => {
  it('faceFromBounds: la faccia al centro del lato scelto, con lo spessore lungo l\'asse', () => {
    expect(faceFromBounds(bounds, 'z+')).toEqual({ origin: [0, 0, 2.5], normal: [0, 0, 1], thickness: 5 });
    expect(faceFromBounds(bounds, 'x-')).toEqual({ origin: [-40, 0, 0], normal: [-1, 0, 0], thickness: 80 });
    expect(faceFromBounds(bounds, 'y+').normal).toEqual([0, 1, 0]);
  });

  it('faceName e isAxisFace: gli assi con il verso, le facce inclinate con l\'angolo da +Z', () => {
    expect(faceName(faceFromBounds(bounds, 'z+'))).toBe('+Z');
    expect(faceName(faceFromBounds(bounds, 'x-'))).toBe('−X');
    expect(faceName(faceFromBounds(bounds, 'y+'))).toBe('+Y');
    expect(isAxisFace(faceFromBounds(bounds, 'y-'))).toBe(true);
    const diag = Math.SQRT1_2;
    const tilted = { origin: [0, 0, 0] as Vec3, normal: [diag, 0, diag] as Vec3, thickness: 1 };
    expect(isAxisFace(tilted)).toBe(false);
    expect(faceName(tilted)).toBe('inclinata (45° da +Z)');
    // Poche decimi di grado di scarto contano ancora come allineata
    expect(isAxisFace({ ...tilted, normal: [0.001, 0, 1] })).toBe(true);
  });

  it('thicknessAlong dà lo spessore anche per una normale obliqua', () => {
    expect(thicknessAlong(bounds, [0, 0, 1])).toBe(5);
    expect(thicknessAlong(bounds, [1, 0, 0])).toBe(80);
    const diag = Math.SQRT1_2;
    expect(thicknessAlong(bounds, [diag, diag, 0])).toBeCloseTo((80 + 60) * diag, 6);
  });

  it('il riferimento della faccia porta la normale su +Z per tutte le direzioni e per una normale obliqua', () => {
    const faces = [...FACE_DIRECTIONS.map((d) => faceFromBounds(bounds, d)), { origin: [1, 2, 3] as Vec3, normal: [1, 2, -3] as Vec3, thickness: 4 }];
    for (const face of faces) {
      const frame = faceFrame(face);
      const n = Math.hypot(...face.normal);
      near(apply(frame.matrix, face.normal.map((v) => v / n) as Vec3), [0, 0, 1]);
      // Gli angoli di Q e della sua inversa si annullano a vicenda
      expect(frame.euler).toHaveLength(3);
    }
  });

  it('frameRect contiene l\'ingombro nel riferimento della faccia', () => {
    const rect = frameRect(params());
    expect(rect.maxX - rect.minX).toBeGreaterThanOrEqual(80);
    expect(rect.maxY - rect.minY).toBeGreaterThanOrEqual(60);
    // Una faccia laterale ha un rettangolo diverso (60 × 5 al posto di 80 × 60)
    const side = frameRect(params({ faces: [faceFromBounds(bounds, 'x+')] }));
    expect(Math.min(side.maxX - side.minX, side.maxY - side.minY)).toBeLessThan(10);
  });
});

describe('parametri', () => {
  it('i valori di partenza sono sensati per un pannello 80 × 60', () => {
    const p = defaultPatternParams(bounds, 123);
    expect(p).toMatchObject({ algorithm: PATTERN_ALGORITHM, kind: 'voronoi', mode: 'holes', seed: 123, depth: 0, sides: 'one' });
    expect(p.cells).toBeGreaterThanOrEqual(8);
    expect(p.cells).toBeLessThanOrEqual(80);
    expect(p.margin).toBeGreaterThanOrEqual(2);
    expect(p.wall).toBeGreaterThan(0.8);
  });

  it('normalizePattern porta tutto dentro i limiti', () => {
    const n = normalizePattern(params({ cells: 99999, regularity: 400, size: 0, wall: -3, rounding: -1, margin: -5, depth: -2, seed: -4, faces: [{ origin: [0, 0, 0], normal: [0, 0, 0], thickness: -1 }] }));
    expect(n.cells).toBe(PATTERN_MAX_CELLS);
    expect(n.regularity).toBe(100);
    expect(n.size).toBeGreaterThanOrEqual(2);
    expect(n.wall).toBeGreaterThan(0);
    expect([n.rounding, n.margin, n.depth, n.seed]).toEqual([0, 0, 0, 0]);
    expect(n.faces).toHaveLength(1);
    expect(n.faces[0].normal).toEqual([0, 0, 1]);
    expect(n.faces[0].thickness).toBeGreaterThan(0);
  });
});

describe('celle del pattern', () => {
  const rect = { minX: 0, minY: 0, maxX: 100, maxY: 60 };

  it('esagoni: celle a sei lati che coprono il rettangolo, con il passo dato', () => {
    const cells = patternCells(params({ kind: 'hexagon', size: 12 }), rect);
    expect(cells.every((c) => c.length === 6)).toBe(true);
    // Area di un esagono con apotema 6: 2·√3·6² ≈ 124,7; circa 100·60 / 124,7 ≈ 48 celle più il bordo
    expect(cells.length).toBeGreaterThan(48);
    expect(cells.length).toBeLessThan(120);
    // Ogni punto del rettangolo cade in almeno una cella: lo si verifica sul centro
    const cx = 50;
    const cy = 30;
    const contains = (poly: [number, number][]) => poly.every((a, i) => {
      const b = poly[(i + 1) % poly.length];
      return (b[0] - a[0]) * (cy - a[1]) - (b[1] - a[1]) * (cx - a[0]) >= -1e-6;
    });
    expect(cells.some(contains)).toBe(true);
  });

  it('cerchi: poligoni a 32 lati e rotazione della griglia', () => {
    const cells = patternCells(params({ kind: 'circle', size: 10 }), rect);
    expect(cells.every((c) => c.length === 32)).toBe(true);
    const turned = patternCells(params({ kind: 'circle', size: 10, angle: 30 }), rect);
    expect(turned).not.toEqual(cells);
  });

  it('il passo si allarga se servirebbero troppe celle', () => {
    const cells = patternCells(params({ kind: 'hexagon', size: 2 }), { minX: 0, minY: 0, maxX: 500, maxY: 500 });
    expect(cells.length).toBeLessThan(2500);
  });

  it('Voronoi: tante celle quante richieste, riproducibili con il seme', () => {
    const p = params({ kind: 'voronoi', cells: 25, seed: 5 });
    const a = patternCells(p, rect);
    expect(a).toHaveLength(25);
    expect(patternCells(p, rect)).toEqual(a);
    expect(patternCells({ ...p, seed: 6 }, rect)).not.toEqual(a);
    // Ogni faccia ha il suo disegno: l'indice cambia il seme
    expect(patternCells(p, rect, 1)).not.toEqual(a);
  });
});

describe('rombi, triangoli e più facce', () => {
  const rect = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const area = (poly: [number, number][]) => Math.abs(poly.reduce((sum, a, i) => { const b = poly[(i + 1) % poly.length]; return sum + (a[0] * b[1] - b[0] * a[1]); }, 0) / 2);

  it('rombi: quattro lati, area mezzo passo al quadrato, e coprono il rettangolo', () => {
    const cells = patternCells(params({ kind: 'diamond', size: 10 }), rect);
    expect(cells.every((c) => c.length === 4)).toBe(true);
    expect(area(cells[0])).toBeCloseTo(50, 3);
    // Con celle che si toccano, la somma delle aree di quelle che toccano il rettangolo lo copre almeno tutto
    expect(cells.reduce((s, c) => s + area(c), 0)).toBeGreaterThanOrEqual(100 * 60);
  });

  it('triangoli: equilateri con lato uguale al passo, punta su e punta giù alternati', () => {
    const cells = patternCells(params({ kind: 'triangle', size: 12 }), rect);
    expect(cells.every((c) => c.length === 3)).toBe(true);
    expect(area(cells[0])).toBeCloseTo((Math.sqrt(3) / 4) * 144, 2);
    expect(cells.reduce((s, c) => s + area(c), 0)).toBeGreaterThanOrEqual(100 * 60);
    // Rotazione di 30 gradi: altre posizioni
    expect(patternCells(params({ kind: 'triangle', size: 12, angle: 30 }), rect)).not.toEqual(cells);
  });

  it('normalizePattern converte i progetti della 0.20.0: face diventa faces e il reticolo diventa Voronoi', () => {
    const old = { ...params(), kind: 'lattice', face: faceFromBounds(bounds, 'x+') } as unknown as PatternParams;
    delete (old as { faces?: unknown }).faces;
    const n = normalizePattern(old);
    expect(n.kind).toBe('voronoi');
    expect(n.faces).toEqual([faceFromBounds(bounds, 'x+')]);
    expect(n.face).toBeUndefined();
  });

  it('le facce uguali non si ripetono e sameFace confronta normale e piano', () => {
    const top = faceFromBounds(bounds, 'z+');
    expect(normalizePattern(params({ faces: [top, { ...top }, faceFromBounds(bounds, 'z-')] })).faces).toHaveLength(2);
    expect(sameFace(top, faceFromBounds(bounds, 'z-'))).toBe(false);
    expect(sameFace(top, { ...top, origin: [5, -3, 2.5] })).toBe(true);
  });
});

describe('dal mondo al gruppo', () => {
  it('worldToLocal inverte posizione, rotazione e specchio del gruppo', () => {
    const world = { position: [10, 20, 30] as Vec3, rotation: [0, 0, 90] as Vec3, mirror: [true, false, false] as [boolean, boolean, boolean] };
    // Un punto locale portato nel mondo (x = R·D·x_local + p) e poi di nuovo nel locale
    const local: Vec3 = [3, -4, 5];
    const d: Vec3 = [-local[0], local[1], local[2]];
    const rotated = apply(eulerToMatrix(world.rotation), d);
    near(worldToLocal(world, rotated.map((v, i) => v + world.position[i]) as Vec3, true), local);
    // Una direzione non risente della traslazione
    near(worldToLocal(world, rotated, false), local);
    // E il percorso inverso
    near(localToWorld(world, local, true), rotated.map((v, i) => v + world.position[i]));
    near(localToWorld(world, local, false), rotated);
  });
});

describe('region del Pattern', () => {
  it('normalizePattern: senza region (progetti vecchi) vale silhouette, con face resta face', () => {
    const { region: _unused, ...old } = params();
    expect(normalizePattern(old as PatternParams).region).toBe('silhouette');
    expect(normalizePattern(params({ region: 'silhouette' })).region).toBe('silhouette');
    expect(normalizePattern(params({ region: 'face' })).region).toBe('face');
  });
});

describe('hasPlanarFace', () => {
  let wasm: ManifoldToplevel;
  beforeAll(async () => {
    wasm = await Module();
    wasm.setup();
  });
  const evaluate = (scene: Scene) => new Evaluator(wasm).evaluate(scene).meshes[0];
  const prim = (kind: 'box' | 'sphere' | 'cylinder', extra: Partial<PrimitiveNode>) => ({ ...primitiveDefaults(kind), id: 'p', name: 'p', position: [0, 0, 0], ...extra }) as PrimitiveNode;
  const meshOf = (node: PrimitiveNode) => evaluate({ nodes: { p: node }, rootIds: ['p'] });
  const identity = { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };
  /** Ha una faccia piana nella direzione dell'ingombro? */
  const has = (mesh: NodeMesh, direction: FaceDirection, world = identity) => hasPlanarFace(faceMap(mesh).faces, faceFromBounds(mesh.bbox, direction), world);

  it('scatola: tutte e sei le facce dell\'ingombro esistono come facce piane', () => {
    const mesh = meshOf(prim('box', { size: [20, 10, 6] }));
    for (const d of FACE_DIRECTIONS) expect(has(mesh, d)).toBe(true);
  });

  it('un piano diverso o una normale diversa non contano', () => {
    const mesh = meshOf(prim('box', { size: [20, 10, 6] }));
    const top = faceFromBounds(mesh.bbox, 'z+');
    expect(hasPlanarFace(faceMap(mesh).faces, { ...top, origin: [0, 0, 2] }, identity)).toBe(false);
    expect(hasPlanarFace(faceMap(mesh).faces, { ...top, normal: [0, 1, 0] }, identity)).toBe(false);
  });

  it('scatola smussata: le sei facce dell\'ingombro esistono ancora (più piccole, lo smusso è una settima faccia)', () => {
    const box = prim('box', { size: [20, 20, 20] });
    const base = meshOf(box);
    const map = faceMap(base);
    const find = (n: Vec3) => map.faces.findIndex((f) => f.normal[0] === n[0] && f.normal[1] === n[1] && f.normal[2] === n[2]);
    const edge = edgeBetween(base, map, find([0, 0, 1]), find([1, 0, 0]));
    if (!edge.ok) throw new Error(edge.error);
    const built = buildEdgeTreatment({ nodes: { p: box }, rootIds: ['p'] }, 'p', edge.geometry, { treatment: 'chamfer', radius: 1, distance1: 6, distance2: 6 });
    if (!built.ok) throw new Error(built.error);
    const chamfered = evaluate(built.scene);
    for (const d of FACE_DIRECTIONS) expect(has(chamfered, d)).toBe(true);
  });

  it('scatola smussata: la faccia reale c\'è da z+ e da x+ e non ci sono altri piani con la stessa normale', () => {
    const box = prim('box', { size: [20, 20, 20] });
    const base = meshOf(box);
    const map = faceMap(base);
    const find = (n: Vec3) => map.faces.findIndex((f) => f.normal[0] === n[0] && f.normal[1] === n[1] && f.normal[2] === n[2]);
    const edge = edgeBetween(base, map, find([0, 0, 1]), find([1, 0, 0]));
    if (!edge.ok) throw new Error(edge.error);
    const built = buildEdgeTreatment({ nodes: { p: box }, rootIds: ['p'] }, 'p', edge.geometry, { treatment: 'chamfer', radius: 1, distance1: 6, distance2: 6 });
    if (!built.ok) throw new Error(built.error);
    const chamfered = evaluate(built.scene);
    expect(has(chamfered, 'z+')).toBe(true);
    expect(has(chamfered, 'x+')).toBe(true);
  });

  it('pezzo a L e piastra con rilievo: più piani con la stessa normale, serve la silhouette', () => {
    const box = (id: string, position: Vec3, size: Vec3) => ({ ...primitiveDefaults('box'), id, name: id, position, size }) as PrimitiveNode;
    const union = (children: string[]) => ({ id: 'u', name: 'u', type: 'group', op: 'union', children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#ffffff' }) as GroupNode;
    // L: pavimento 60 x 20 x 10 e parete 20 x 20 x 30 sopra la sua parte sinistra
    const l = evaluate({ nodes: { floor: box('floor', [0, 0, 5], [60, 20, 10]), wall: box('wall', [-20, 0, 25], [20, 20, 30]), u: union(['floor', 'wall']) }, rootIds: ['u'] });
    expect(has(l, 'z+')).toBe(false);
    expect(has(l, 'x+')).toBe(false);
    // Piastra 40 x 40 x 4 con un rilievo 10 x 10 x 2 (come un testo o un logo in rilievo)
    const plate = evaluate({ nodes: { plate: box('plate', [0, 0, 2], [40, 40, 4]), relief: box('relief', [0, 0, 5], [10, 10, 2]), u: union(['plate', 'relief']) }, rootIds: ['u'] });
    expect(has(plate, 'z+')).toBe(false);
    // Il fondo è un piano solo
    expect(has(plate, 'z-')).toBe(true);
  });

  it('sfera e cilindro sdraiato: nessuna faccia piana nella direzione dell\'ingombro (serve la silhouette)', () => {
    const sphere = meshOf(prim('sphere', { radius: 15 }));
    for (const d of FACE_DIRECTIONS) expect(has(sphere, d)).toBe(false);
    // Il cilindro sdraiato (asse X) ha le basi piane a x±, ma il fianco curvo non ha una faccia a z+ o y+
    const cylinder = meshOf(prim('cylinder', { radius: 10, height: 30, rotation: [0, 90, 0] }));
    expect(has(cylinder, 'x+')).toBe(true);
    expect(has(cylinder, 'z+')).toBe(false);
  });

  it('tiene conto della trasformazione del gruppo: rotazione e posizione', () => {
    const mesh = meshOf(prim('box', { size: [20, 10, 6] }));
    const faces = faceMap(mesh).faces;
    // Gruppo ruotato di 90° attorno a Y: la sua +Z locale guarda +X nel mondo, dove la scatola ha la faccia a x = 10
    const turned = { position: [0, 0, 0] as Vec3, rotation: [0, 90, 0] as Vec3 };
    expect(hasPlanarFace(faces, { origin: [0, 0, 10], normal: [0, 0, 1], thickness: 20 }, turned)).toBe(true);
    expect(hasPlanarFace(faces, { origin: [0, 0, 3], normal: [0, 0, 1], thickness: 20 }, turned)).toBe(false);
    // Gruppo spostato a x = 4: la faccia a x locale 6 sta a x = 10 nel mondo
    const moved = { position: [4, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };
    expect(hasPlanarFace(faces, { origin: [6, 0, 0], normal: [1, 0, 0], thickness: 20 }, moved)).toBe(true);
    expect(hasPlanarFace(faces, { origin: [10, 0, 0], normal: [1, 0, 0], thickness: 20 }, moved)).toBe(false);
  });
});
