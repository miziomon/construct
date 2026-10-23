import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { buildPattern } from './pattern';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from '../scene/defaults';
import { defaultPatternParams, faceFromBounds, normalizePattern, studCentersOf, thicknessAlong } from '../scene/pattern';
import { reliefDefaults } from '../scene/relief';
import type { StudParams, StudShape } from '../scene/relief';
import type { GroupNode, PatternParams, PrimitiveNode, Scene, Vec3 } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const SIZE: Vec3 = [80, 60, 5];
const bounds = { min: SIZE.map((v) => -v / 2) as Vec3, max: SIZE.map((v) => v / 2) as Vec3 };
const FULL = 80 * 60 * 5;
const studs = reliefDefaults('studs') as StudParams;

/** Pannello 80 × 60 × 5 dentro un gruppo Pattern di tipo Borchie (depth 0 e silhouette di partenza, come `defaultPatternParams`). */
function scene(patch: Partial<PatternParams>): Scene {
  const cube = { ...primitiveDefaults('box'), id: 'c', name: 'Pannello', position: [0, 0, 0], size: SIZE } as PrimitiveNode;
  const g: GroupNode = {
    id: 'g', name: 'Pattern', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
    pattern: { ...defaultPatternParams(bounds, 7), kind: 'studs', margin: 0, ...patch },
  };
  return { nodes: { c: cube, g }, rootIds: ['g'] };
}
const run = (s: Scene) => new Evaluator(wasm).evaluate(s).meshes[0];
/** I parametri del Pattern del gruppo `g` di una scena di prova. */
const patternOf = (s: Scene) => (s.nodes.g as GroupNode).pattern as PatternParams;

/** Volume di una borchia sopra la faccia (mm³), da formula: calotta, cilindro con smusso a 45° o piramide. */
function studVolume(shape: StudShape, p: StudParams): number {
  const { radius: r, height } = p;
  if (shape === 'pyramid') return (4 * r * r * height) / 3;
  if (shape === 'chamfered') {
    const c = Math.min(p.chamfer, height, r);
    // Cilindro fino all'inizio dello smusso, poi tronco di cono da r a r - c
    return Math.PI * r * r * (height - c) + (Math.PI * c * (r * r + r * (r - c) + (r - c) * (r - c))) / 3;
  }
  const h = Math.min(height, r);
  return (Math.PI * h * (3 * r * r + h * h)) / 6;
}

describe('Pattern Borchie nel kernel', () => {
  it.each(['dome', 'chamfered', 'pyramid'] as StudShape[])('%s: il volume cresce di N borchie e il pezzo resta un solido valido (con depth 0 di partenza)', (shape) => {
    const pattern = { design: shape } as Partial<PatternParams>;
    const n = studCentersOf(normalizePattern({ ...defaultPatternParams(bounds, 7), kind: 'studs', margin: 0, ...pattern }), faceFromBounds(bounds, 'z+')).centers.length;
    expect(n).toBeGreaterThan(20);
    const m = run(scene(pattern));
    expect(m.status).toBe('NoError');
    // Il volume aggiunto è N volte quello della borchia (l'approssimazione poligonale della cupola sta sotto il 3 %)
    const added = m.volume - FULL;
    expect(added).toBeGreaterThan(0);
    expect(added / (n * studVolume(shape, studs))).toBeGreaterThan(shape === 'pyramid' ? 0.9999 : 0.95);
    expect(added / (n * studVolume(shape, studs))).toBeLessThan(1.0001);
    // L'ingombro cresce solo verso l'alto, di `height` (la cupola non supera il raggio)
    expect(m.bbox.max[2]).toBeCloseTo(2.5 + Math.min(studs.height, studs.radius), 3);
    expect(m.bbox.min[2]).toBeCloseTo(-2.5, 3);
    expect(m.bbox.max[0]).toBeCloseTo(40, 3);
  });

  it('altezza della piramide e smusso del cilindro: l\'ingombro e il volume seguono i parametri', () => {
    const tall = run(scene({ design: 'pyramid', relief: { ...studs, height: 3 } }));
    expect(tall.bbox.max[2]).toBeCloseTo(2.5 + 3, 3);
    const flat = run(scene({ design: 'chamfered', relief: { ...studs, chamfer: 0 } }));
    const chamfered = run(scene({ design: 'chamfered', relief: { ...studs, chamfer: 1 } }));
    expect(flat.volume).toBeGreaterThan(chamfered.volume);
  });

  it('griglia sfalsata: stesso volume per borchia, centri diversi', () => {
    const square = run(scene({ design: 'pyramid' }));
    const staggered = run(scene({ design: 'pyramid', relief: { ...studs, layout: 'staggered' } }));
    expect(staggered.status).toBe('NoError');
    const nSquare = studCentersOf(normalizePattern(patternOf(scene({}))), faceFromBounds(bounds, 'z+')).centers.length;
    expect(square.volume - FULL).toBeCloseTo(nSquare * studVolume('pyramid', studs), 3);
    const nStaggered = studCentersOf(normalizePattern(patternOf(scene({ relief: { ...studs, layout: 'staggered' } }))), faceFromBounds(bounds, 'z+')).centers.length;
    expect(staggered.volume - FULL).toBeCloseTo(nStaggered * studVolume('pyramid', studs), 3);
  });

  it('con il margine restano le borchie intere dentro la cornice e il volume aggiunto cala; i bordi del pezzo sono intatti', () => {
    const full = run(scene({ design: 'pyramid' }));
    const framed = run(scene({ design: 'pyramid', margin: 8 }));
    expect(framed.status).toBe('NoError');
    expect(framed.volume - FULL).toBeLessThan(full.volume - FULL);
    expect(framed.volume - FULL).toBeGreaterThan(0);
    // Un margine che occupa tutta la faccia non lascia borchie: il pezzo resta invariato
    expect(run(scene({ margin: 100 })).volume).toBeCloseTo(FULL, 3);
  });

  it('depth e sides del Pattern non contano', () => {
    expect(run(scene({ depth: 2, sides: 'both' })).volume).toBeCloseTo(run(scene({})).volume, 6);
  });

  it('più facce: borchie anche sulla faccia opposta', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    const one = run(scene({ design: 'pyramid' }));
    const two = run(scene({ design: 'pyramid', faces }));
    expect(two.status).toBe('NoError');
    expect(two.volume - FULL).toBeCloseTo(2 * (one.volume - FULL), 3);
    expect(two.bbox.min[2]).toBeCloseTo(-2.5 - studs.height, 3);
    expect(two.bbox.max[2]).toBeCloseTo(2.5 + studs.height, 3);
  });

  it('da una faccia laterale (x+) le borchie sporgono in X', () => {
    const m = run(scene({ design: 'pyramid', faces: [faceFromBounds(bounds, 'x+')], relief: { ...studs, pitch: 8, radius: 2 } }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeGreaterThan(FULL);
    expect(m.bbox.max[0]).toBeCloseTo(40 + studs.height, 3);
  });

  it('è deterministico e ogni forma dà un volume diverso', () => {
    expect(run(scene({ design: 'chamfered' })).volume).toBe(run(scene({ design: 'chamfered' })).volume);
    const volumes = (['dome', 'chamfered', 'pyramid'] as StudShape[]).map((design) => run(scene({ design })).volume.toFixed(3));
    expect(new Set(volumes).size).toBe(3);
  });

  it('misure estreme: il calcolo finisce e il solido è valido', () => {
    const m = run(scene({ relief: { ...studs, pitch: 0, radius: 0, height: 0 } }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeGreaterThanOrEqual(FULL);
  });

  it('su un pezzo non rettangolare (cilindro) il contorno vero ritaglia le borchie e nessuna resta staccata', () => {
    const piece = wasm.Manifold.cylinder(10, 20, 20, 48);
    const cb = { min: [-20, -20, 0] as Vec3, max: [20, 20, 10] as Vec3 };
    const params = { ...defaultPatternParams(cb, 7), kind: 'studs', margin: 0, design: 'pyramid', faces: [faceFromBounds(cb, 'z+')], region: 'face' } as PatternParams;
    const result = buildPattern(wasm, piece, params);
    expect(result.status()).toBe('NoError');
    expect(result.volume()).toBeGreaterThan(piece.volume());
    // Un solo corpo: nessuna borchia fuori dal cerchio resta staccata, e il contorno non cresce
    expect(result.decompose().length).toBe(1);
    const box = result.boundingBox();
    expect(box.max[0]).toBeLessThanOrEqual(20 + 1e-3);
    expect(box.max[1]).toBeLessThanOrEqual(20 + 1e-3);
    [piece, result].forEach((m) => m.delete());
  });
});

describe('Pattern Borchie su una faccia inclinata', () => {
  // Piramide a base quadrata (cono a 4 segmenti): la faccia verso (1, 1) ha normale (1, 1, 1) / radice di 3
  const pyramid = (patch: Partial<PatternParams>): Scene => {
    const cone = { ...primitiveDefaults('cone'), id: 'c', name: 'Piramide', position: [0, 0, 0], radiusBottom: 20, radiusTop: 0, height: 20, segments: 4 } as PrimitiveNode;
    const pb = { min: [-20, -20, -10] as Vec3, max: [20, 20, 10] as Vec3 };
    const normal: Vec3 = [1, 1, 1].map((v) => v / Math.sqrt(3)) as Vec3;
    const face = { origin: [10 / 3, 10 / 3, 10 / 3] as Vec3, normal, thickness: thicknessAlong(pb, normal) };
    const g: GroupNode = {
      id: 'g', name: 'Pattern', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
      pattern: { ...defaultPatternParams(pb, 7), kind: 'studs', margin: 0, faces: [face], ...patch },
    };
    return { nodes: { c: cone, g }, rootIds: ['g'] };
  };
  const PYRAMID = (800 * 20) / 3;

  it.each(['dome', 'chamfered', 'pyramid'] as StudShape[])('%s: il volume cresce al più di N borchie e il solido è valido', (design) => {
    const relief = { ...studs, pitch: 6, radius: 1.5, height: 1 };
    const s = pyramid({ design, relief });
    const params = normalizePattern(patternOf(s));
    const { centers } = studCentersOf(params, params.faces[0]);
    expect(centers.length).toBeGreaterThan(3);
    const m = run(s);
    expect(m.status).toBe('NoError');
    const added = m.volume - PYRAMID;
    expect(added).toBeGreaterThan(0);
    // La griglia copre il rettangolo che contiene la faccia: le borchie che sporgono dal contorno sono ritagliate, al più tutte intere
    expect(added).toBeLessThanOrEqual(centers.length * studVolume(design, relief) * 1.0001);
    // ...e almeno qualche borchia intera dentro il triangolo della faccia (circa 9 passi da 6 mm sui 346 mm²: ne bastano 4)
    expect(added).toBeGreaterThan(4 * studVolume(design, relief));
  });

  it('il codice OpenSCAD della faccia inclinata ruota nel riferimento della faccia', () => {
    const code = sceneToOpenScad(pyramid({ design: 'pyramid' }));
    expect(code).toContain('union() {');
    expect(code).toContain('projection(cut = true)');
    expect(code).not.toContain('rotate([0, 0, 0]) intersection()');
  });
});

describe('Pattern Borchie nel codice OpenSCAD', () => {
  /** Centri scritti nell'elenco `studs` del codice. */
  const listed = (code: string, name = 'studs') => {
    const list = new RegExp(`${name} = \\[\\n([\\s\\S]*?)\\n\\s*\\];`).exec(code);
    expect(list).not.toBeNull();
    return list![1].trim().split('\n').map((line) => line.replace(/[[\],\s]+$/g, '').replace(/^\s*\[/, '').split(',').map(Number));
  };

  it('i centri esportati sono quelli del kernel, in union() con il pezzo, ritagliati sulla regione', () => {
    const s = scene({ design: 'dome', margin: 4 });
    const params = normalizePattern(patternOf(s));
    const { centers } = studCentersOf(params, params.faces[0]);
    const code = sceneToOpenScad(s);
    const written = listed(code);
    expect(written).toHaveLength(centers.length);
    written.forEach((c, k) => {
      expect(c[0]).toBeCloseTo(centers[k][0], 3);
      expect(c[1]).toBeCloseTo(centers[k][1], 3);
    });
    expect(code).toContain('union() {');
    expect(code).toContain('intersection() {');
    expect(code).toContain('offset(delta = -4) projection(cut = true)');
    expect(code).toContain('for (c = studs) translate([c[0], c[1], 0]) rotate_extrude($fn = 24) polygon(stud_profile);');
    expect(code).toContain('stud_profile = [');
    // Non si sottrae nulla e non c'è nessun modulo
    expect(code).not.toContain('difference()');
    expect(code).not.toContain('module relief');
  });

  it('la piramide è un polyhedron con i triangoli rovesciati, la forma smussata ha il suo profilo', () => {
    const pyramid = sceneToOpenScad(scene({ design: 'pyramid' }));
    expect(pyramid).toContain('polyhedron(points = [[-2.5, -2.5, -0.2]');
    expect(pyramid).toContain('[0, 0, 1.5]]');
    // Prima falda del fondo [0, 3, 2] rovesciata: [2, 3, 0]
    expect(pyramid).toContain('faces = [[2, 3, 0]');
    expect(pyramid).not.toContain('stud_profile');
    const chamfered = sceneToOpenScad(scene({ design: 'chamfered' }));
    expect(chamfered).toContain('stud_profile = [[0, 1.5], [2, 1.5], [2.5, 1], [2.5, 0], [2.5, -0.2], [0, -0.2]];');
  });

  it('la griglia sfalsata scrive i centri sfalsati e il codice cambia con la forma', () => {
    const square = listed(sceneToOpenScad(scene({ design: 'pyramid' })));
    const staggered = listed(sceneToOpenScad(scene({ design: 'pyramid', relief: { ...studs, layout: 'staggered' } })));
    expect(staggered).not.toEqual(square);
    // Due file vicine sono sfalsate di mezzo passo
    const ys = [...new Set(staggered.map((c) => c[1]))].sort((a, b) => a - b);
    const first = staggered.filter((c) => c[1] === ys[0]).map((c) => c[0]);
    const second = staggered.filter((c) => c[1] === ys[1]).map((c) => c[0]);
    expect(second[0] - first[0]).toBeCloseTo(6, 3);
    expect(sceneToOpenScad(scene({ design: 'dome' }))).not.toBe(sceneToOpenScad(scene({ design: 'pyramid' })));
  });

  it('con più facce i dati hanno nomi distinti; una faccia senza borchie non scrive nulla', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    const code = sceneToOpenScad(scene({ design: 'dome', faces }));
    expect(code).toContain('studs_1 = [');
    expect(code).toContain('studs_2 = [');
    expect(code).toContain('stud_profile_1 = [');
    expect(code).toContain('for (c = studs_2)');
    expect(code.match(/intersection\(\) \{/g)).toHaveLength(2);
    // Margine enorme: nessuna borchia, quindi nessun rilievo (resta solo il pezzo in un union)
    const none = sceneToOpenScad(scene({ margin: 100 }));
    expect(none).not.toContain('studs = [');
    expect(none).not.toContain('intersection()');
  });

  it('i Mattoni e i tipi a celle producono lo stesso codice di prima', () => {
    expect(sceneToOpenScad(scene({ kind: 'brick' }))).toContain('difference() {');
    expect(sceneToOpenScad(scene({ kind: 'hexagon', size: 20, rounding: 0 }))).toContain('cells = [');
  });
});
