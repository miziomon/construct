import { beforeAll, describe, expect, it, vi } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from '../scene/defaults';
import { defaultPatternParams, faceFromBounds, frameRect, thicknessAlong } from '../scene/pattern';
import { BRICK_DESIGNS, brickLayout, reliefDefaults } from '../scene/relief';
import type { BrickDesign, BrickParams } from '../scene/relief';
import type { GroupNode, PatternParams, PrimitiveNode, Scene, Vec3 } from '../scene/types';

// Calcoli con molte celle: sotto carico (altri test in parallelo) i 5 s predefiniti non bastano
vi.setConfig({ testTimeout: 60_000 });

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const SIZE: Vec3 = [80, 60, 5];
const bounds = { min: SIZE.map((v) => -v / 2) as Vec3, max: SIZE.map((v) => v / 2) as Vec3 };
const FULL = 80 * 60 * 5;
const brick = reliefDefaults('brick') as BrickParams;

/** Pannello 80 × 60 × 5 dentro un gruppo Pattern: di partenza passante (depth 0) e silhouette, come i valori di `defaultPatternParams`. */
function scene(patch: Partial<PatternParams>): Scene {
  const cube = { ...primitiveDefaults('box'), id: 'c', name: 'Pannello', position: [0, 0, 0], size: SIZE } as PrimitiveNode;
  const g: GroupNode = {
    id: 'g', name: 'Pattern', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
    pattern: { ...defaultPatternParams(bounds, 7), kind: 'brick', margin: 0, ...patch },
  };
  return { nodes: { c: cube, g }, rootIds: ['g'] };
}
const run = (s: Scene) => new Evaluator(wasm).evaluate(s).meshes[0];

/** Volume che le fughe devono togliere: profondità per l'area della faccia (meno il margine) non coperta dai mattoni. */
function expectedRemoved(patch: Partial<PatternParams>, relief: BrickParams): number {
  const p = { ...defaultPatternParams(bounds, 7), margin: 0, ...patch } as PatternParams;
  const rect = frameRect(p, p.faces[0]);
  const m = p.margin;
  // Regione: la faccia 80 × 60 ridotta del margine
  const region = { minX: -40 + m, maxX: 40 - m, minY: -30 + m, maxY: 30 - m };
  const covered = brickLayout(rect, relief).reduce((sum, [x0, y0, x1, y1]) => {
    const w = Math.min(x1, region.maxX) - Math.max(x0, region.minX);
    const h = Math.min(y1, region.maxY) - Math.max(y0, region.minY);
    return sum + (w > 0 && h > 0 ? w * h : 0);
  }, 0);
  return relief.depth * ((region.maxX - region.minX) * (region.maxY - region.minY) - covered);
}

describe('Pattern Mattoni nel kernel', () => {
  it.each(BRICK_DESIGNS)('%s: toglie esattamente il volume delle fughe e il pezzo resta un solido valido (con depth 0 di partenza)', (design: BrickDesign) => {
    const patch = { design };
    const m = run(scene(patch));
    expect(m.status).toBe('NoError');
    // Le fughe sono incavi: il volume cala, ma poco (0,8 mm su 5 di spessore, solo nelle fughe)
    expect(m.volume).toBeLessThan(FULL);
    expect(m.volume).toBeGreaterThan(FULL * 0.95);
    expect(FULL - m.volume).toBeCloseTo(expectedRemoved(patch, { ...brick, design }), 1);
    // Non fora: l'ingombro non cambia
    expect(m.bbox.min[2]).toBeCloseTo(-2.5, 3);
    expect(m.bbox.max[0]).toBeCloseTo(40, 3);
  });

  it.each(BRICK_DESIGNS)('%s: il margine lascia una cornice piena e il disegno resta ancorato alla faccia', (design: BrickDesign) => {
    const patch = { design, margin: 5 };
    const framed = run(scene(patch));
    expect(framed.status).toBe('NoError');
    expect(FULL - framed.volume).toBeCloseTo(expectedRemoved(patch, { ...brick, design }), 1);
    // Con il margine si toglie meno che senza
    expect(framed.volume).toBeGreaterThan(run(scene({ design })).volume);
  });

  it('profondità e misure dei mattoni cambiano il volume tolto; depth e sides del Pattern non contano', () => {
    const shallow = run(scene({ relief: { ...brick, depth: 0.4 } }));
    const deep = run(scene({ relief: { ...brick, depth: 1.6 } }));
    expect(FULL - deep.volume).toBeCloseTo(4 * (FULL - shallow.volume), 1);
    const same = run(scene({ depth: 2, sides: 'both' }));
    expect(same.volume).toBeCloseTo(run(scene({})).volume, 6);
  });

  it('i disegni diversi tolgono volumi diversi e il risultato è deterministico', () => {
    const volumes = BRICK_DESIGNS.map((design) => run(scene({ design })).volume);
    expect(new Set(volumes.map((v) => v.toFixed(3))).size).toBeGreaterThan(1);
    expect(run(scene({ design: 'herringbone' })).volume).toBe(run(scene({ design: 'herringbone' })).volume);
  });

  it('più facce: un rilievo per faccia, anche sulla faccia opposta', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    const one = run(scene({ design: 'basket' }));
    const two = run(scene({ design: 'basket', faces }));
    expect(two.status).toBe('NoError');
    expect(FULL - two.volume).toBeGreaterThan(1.9 * (FULL - one.volume));
  });

  it('da una faccia laterale (x+) scava la fuga dentro quella faccia', () => {
    const m = run(scene({ design: 'herringbone', faces: [faceFromBounds(bounds, 'x+')], relief: { ...brick, brickW: 12, brickH: 4, mortar: 1 } }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeLessThan(FULL);
    expect(m.volume).toBeGreaterThan(FULL * 0.9);
    expect(m.bbox.max[0]).toBeCloseTo(40, 3);
  });

  it('un margine che occupa tutta la faccia lascia il pezzo invariato', () => {
    expect(run(scene({ margin: 100 })).volume).toBeCloseTo(FULL, 3);
  });

  it('misure estreme: il calcolo finisce e il solido è valido', () => {
    const m = run(scene({ design: 'herringbone', relief: { ...brick, brickW: 0, brickH: 0, mortar: 0, depth: 0 } }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeLessThan(FULL);
  });
});

describe('Pattern Mattoni: profondità e faccia inclinata', () => {
  it('una profondità enorme non attraversa il pezzo: resta un solo solido, anche con facce opposte', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    for (const patch of [{}, { faces }]) {
      const m = run(scene({ ...patch, relief: { ...brick, depth: 50 } }));
      expect(m.status).toBe('NoError');
      expect(m.volume).toBeGreaterThan(0);
      // Resta almeno l'anima di 0,4 mm tra le due incisioni: il pezzo non si divide
      expect(m.volume).toBeGreaterThan(80 * 60 * 0.4);
      expect(new Evaluator(wasm).evaluate(scene({ ...patch, relief: { ...brick, depth: 50 } })).meshes).toHaveLength(1);
    }
  });

  // Piramide a base quadrata (cono a 4 segmenti): la faccia verso (1, 1) ha normale (1, 1, 1) / radice di 3
  const pyramid = (patch: Partial<PatternParams>): Scene => {
    const cone = { ...primitiveDefaults('cone'), id: 'c', name: 'Piramide', position: [0, 0, 0], radiusBottom: 20, radiusTop: 0, height: 20, segments: 4 } as PrimitiveNode;
    const pb = { min: [-20, -20, -10] as Vec3, max: [20, 20, 10] as Vec3 };
    const normal: Vec3 = [1, 1, 1].map((v) => v / Math.sqrt(3)) as Vec3;
    const face = { origin: [10 / 3, 10 / 3, 10 / 3] as Vec3, normal, thickness: thicknessAlong(pb, normal) };
    const g: GroupNode = {
      id: 'g', name: 'Pattern', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
      pattern: { ...defaultPatternParams(pb, 7), kind: 'brick', margin: 0, faces: [face], ...patch },
    };
    return { nodes: { c: cone, g }, rootIds: ['g'] };
  };
  const PYRAMID = (800 * 20) / 3;
  /** Area della faccia inclinata: triangolo (20, 0, -10), (0, 20, -10), (0, 0, 10). */
  const FACE_AREA = 0.5 * Math.hypot(400, 400, 400);

  it.each(BRICK_DESIGNS)('%s su una faccia inclinata: le fughe stanno dentro la faccia e tolgono la quota attesa', (design: BrickDesign) => {
    // Mattoni piccoli: la fuga copre circa il 36 % della faccia (mattone 6 × 3, passo 7 × 4)
    const relief = { ...brick, brickW: 6, brickH: 3, mortar: 1, depth: 0.8 };
    const m = run(pyramid({ design, relief }));
    expect(m.status).toBe('NoError');
    const removed = PYRAMID - m.volume;
    // Mai più di un prisma sulla faccia, e una frazione ragionevole di esso
    expect(removed).toBeGreaterThan(0.1 * 0.8 * FACE_AREA);
    expect(removed).toBeLessThan(0.7 * 0.8 * FACE_AREA);
    // La sagoma della piramide non cambia (nessuna fuga fuori dal contorno della faccia)
    expect(m.bbox.min[0]).toBeCloseTo(-20, 2);
    expect(m.bbox.max[2]).toBeCloseTo(10, 2);
  });

  it('il codice OpenSCAD della faccia inclinata ruota nel riferimento della faccia', () => {
    const code = sceneToOpenScad(pyramid({ design: 'herringbone' }));
    expect(code).toContain('projection(cut = true)');
    // Rotazione di ritorno e di andata non nulle (la faccia non sta sugli assi)
    expect(code).not.toContain('rotate([0, 0, 0]) intersection()');
  });
});

describe('Pattern Mattoni nel codice OpenSCAD', () => {
  it('mattoni sfalsati: due cicli e nessun elenco, ritagliati sulla regione della faccia', () => {
    const code = sceneToOpenScad(scene({ design: 'running' }));
    expect(code).toContain('intersection() {');
    expect(code).toContain('projection(cut = true) translate([0, 0, 0.01])');
    expect(code).toContain('for (r = [0 :');
    expect(code).not.toContain('bricks = [');
    expect(code).not.toContain('module relief');
    // Nessun taglio passante: non c'è il prisma lungo del Pattern a celle
    expect(code).not.toMatch(/linear_extrude\(height = [\d.]+, center = true\)/);
  });

  it.each(['herringbone', 'basket'] as const)('%s: un elenco con un mattone per riga, tanti quanti quelli del kernel', (design) => {
    const p = scene({ design }).nodes.g as GroupNode;
    const rect = frameRect(p.pattern!, p.pattern!.faces[0]);
    const code = sceneToOpenScad(scene({ design }));
    const list = /bricks = \[\n([\s\S]*?)\n\s*\];/.exec(code);
    expect(list).not.toBeNull();
    expect(list![1].trim().split('\n')).toHaveLength(brickLayout(rect, { ...brick, design }).length);
    expect(code).toContain('for (b = bricks) translate([b[0], b[1]]) square([b[2] - b[0], b[3] - b[1]]);');
    expect(code).toContain('intersection() {');
  });

  it('il margine diventa un offset della regione e il codice cambia con il disegno', () => {
    const framed = sceneToOpenScad(scene({ design: 'basket', margin: 4 }));
    expect(framed).toContain('offset(delta = -4) projection(cut = true)');
    expect(sceneToOpenScad(scene({ design: 'basket' }))).not.toContain('offset(delta');
    expect(sceneToOpenScad(scene({ design: 'basket' }))).not.toBe(sceneToOpenScad(scene({ design: 'herringbone' })));
  });

  it('con più facce i dati hanno nomi distinti e ogni faccia ha il suo taglio', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'x+')];
    const code = sceneToOpenScad(scene({ design: 'herringbone', faces }));
    expect(code).toContain('bricks_1 = [');
    expect(code).toContain('bricks_2 = [');
    expect(code).toContain('for (b = bricks_1)');
    expect(code).toContain('for (b = bricks_2)');
    expect(code.match(/intersection\(\) \{/g)).toHaveLength(2);
  });

  it('la profondità della fuga e il Pattern a celle esistente non cambiano', () => {
    expect(sceneToOpenScad(scene({ relief: { ...brick, depth: 1.5 } }))).toContain('linear_extrude(2)');
    const hex = sceneToOpenScad(scene({ kind: 'hexagon', size: 20, rounding: 0 }));
    expect(hex).toContain('cells = [');
    expect(hex).not.toContain('bricks');
  });
});
