import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { buildPattern } from './pattern';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from '../scene/defaults';
import { defaultPatternParams, faceFromBounds, frameRect, normalizePattern, patternRelief, thicknessAlong } from '../scene/pattern';
import { HAMMERED_DESIGNS, WOOD_DESIGNS, dentList, facetList, grainDepth, reliefDefaults, reliefDepth, sampleGrid, scaleList, woodBoxes } from '../scene/relief';
import type { HammeredDesign, HammeredParams, WoodDesign, WoodParams } from '../scene/relief';
import type { GroupNode, PatternParams, PrimitiveNode, Scene, Vec3 } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const SIZE: Vec3 = [80, 60, 5];
const bounds = { min: SIZE.map((v) => -v / 2) as Vec3, max: SIZE.map((v) => v / 2) as Vec3 };
const FULL = 80 * 60 * 5;
const hammered = reliefDefaults('hammered') as HammeredParams;
const wood = reliefDefaults('wood') as WoodParams;

/** Pannello 80 × 60 × 5 dentro un gruppo Pattern del tipo dato (depth 0 e silhouette di partenza, come `defaultPatternParams`). */
function scene(patch: Partial<PatternParams>, size: Vec3 = SIZE): Scene {
  const cube = { ...primitiveDefaults('box'), id: 'c', name: 'Pannello', position: [0, 0, 0], size } as PrimitiveNode;
  const b = { min: size.map((v) => -v / 2) as Vec3, max: size.map((v) => v / 2) as Vec3 };
  const g: GroupNode = {
    id: 'g', name: 'Pattern', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
    pattern: { ...defaultPatternParams(b, 7), margin: 0, ...patch },
  };
  return { nodes: { c: cube, g }, rootIds: ['g'] };
}
const run = (s: Scene) => new Evaluator(wasm).evaluate(s).meshes[0];
const patternOf = (s: Scene) => (s.nodes.g as GroupNode).pattern as PatternParams;

/** Volume che il rilievo deve togliere: integrale numerico della sua funzione di profondità sulla faccia (passo 0,25 mm). */
function integral(s: Scene, region = { minX: -40, maxX: 40, minY: -30, maxY: 30 }): number {
  const p = normalizePattern(patternOf(s));
  const { relief } = patternRelief(p);
  const depth = reliefDepth(frameRect(p, p.faces[0]), relief);
  const step = 0.25;
  let sum = 0;
  // La mappa di altezze taglia FLOOR (0,02 mm) meno della profondità (e niente dove questa è sotto FLOOR); le fughe del legno sono CSG esatto
  const isWood = patternOf(s).kind === 'wood';
  const mapped = (v: number) => (isWood && v <= 2 * wood.grainDepth + 1e-9 ? Math.max(0, v - 0.02) : v);
  for (let x = region.minX + step / 2; x < region.maxX; x += step) for (let y = region.minY + step / 2; y < region.maxY; y += step) sum += mapped(depth(x, y));
  return sum * step * step;
}

describe('Pattern Rame battuto nel kernel', () => {
  it.each(HAMMERED_DESIGNS)('%s: toglie il volume atteso dalla funzione di profondità, il pezzo resta un solo solido valido', (design: HammeredDesign) => {
    const s = scene({ kind: 'hammered', design });
    const m = run(s);
    expect(m.status).toBe('NoError');
    // Il pezzo cala ma non si svuota, e l'ingombro non cambia (solo incavi)
    expect(m.volume).toBeLessThan(FULL);
    expect(m.volume).toBeGreaterThan(FULL * 0.9);
    expect(m.bbox.min[2]).toBeCloseTo(-2.5, 3);
    expect(m.bbox.max[0]).toBeCloseTo(40, 3);
    // Il CSG coincide con la mappa di profondità entro l'approssimazione delle calotte (poligoni a 24 lati, 4 anelli)
    const removed = FULL - m.volume;
    expect(removed / integral(s)).toBeGreaterThan(design === 'facets' ? 0.98 : 0.85);
    expect(removed / integral(s)).toBeLessThan(1.02);
    // Un solo corpo
    const piece = wasm.Manifold.cube(SIZE, true);
    const result = buildPattern(wasm, piece, normalizePattern(patternOf(s)));
    expect(result.decompose().length).toBe(1);
    [piece, result].forEach((x) => x.delete());
  });

  it.each(HAMMERED_DESIGNS)('%s: deterministico dal seme, diverso con un altro seme; profondità e diametro cambiano il volume', (design: HammeredDesign) => {
    const a = run(scene({ kind: 'hammered', design }));
    expect(run(scene({ kind: 'hammered', design })).volume).toBe(a.volume);
    expect(run(scene({ kind: 'hammered', design, relief: { ...hammered, seed: 2 } })).volume).not.toBeCloseTo(a.volume, 2);
    const deep = run(scene({ kind: 'hammered', design, relief: { ...hammered, depth: 1 } }));
    expect(FULL - deep.volume).toBeGreaterThan(1.5 * (FULL - a.volume));
  });

  it('i tre disegni tolgono volumi diversi; il margine lascia la cornice intatta', () => {
    const volumes = HAMMERED_DESIGNS.map((design) => run(scene({ kind: 'hammered', design })).volume.toFixed(2));
    expect(new Set(volumes).size).toBe(3);
    const framed = run(scene({ kind: 'hammered', design: 'facets', margin: 8 }));
    expect(framed.status).toBe('NoError');
    expect(framed.volume).toBeGreaterThan(run(scene({ kind: 'hammered', design: 'facets' })).volume);
    expect(run(scene({ kind: 'hammered', margin: 100 })).volume).toBeCloseTo(FULL, 3);
  });

  it('più facce: un rilievo per faccia, con semi diversi', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    for (const design of HAMMERED_DESIGNS) {
      const one = run(scene({ kind: 'hammered', design }));
      const two = run(scene({ kind: 'hammered', design, faces }));
      expect(two.status).toBe('NoError');
      expect(FULL - two.volume).toBeGreaterThan(1.8 * (FULL - one.volume));
    }
  });

  it('depth e sides del Pattern non contano; una profondità enorme non attraversa il pezzo', () => {
    expect(run(scene({ kind: 'hammered', depth: 2, sides: 'both' })).volume).toBeCloseTo(run(scene({ kind: 'hammered' })).volume, 6);
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    const m = run(scene({ kind: 'hammered', design: 'dimples', faces, relief: { ...hammered, depth: 50, size: 30 } }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeGreaterThan(80 * 60 * 0.4);
  });

  it('anteprima semplificata: volume vicino a quello finale', () => {
    for (const design of HAMMERED_DESIGNS) {
      const full = run(scene({ kind: 'hammered', design }));
      const preview = run(scene({ kind: 'hammered', design, preview: true }));
      expect(preview.status).toBe('NoError');
      expect(Math.abs(preview.volume - full.volume)).toBeLessThan(0.15 * (FULL - full.volume));
    }
  });

  it('misure estreme: il calcolo finisce e il solido è valido', () => {
    for (const design of HAMMERED_DESIGNS) {
      const m = run(scene({ kind: 'hammered', design, relief: { ...hammered, size: 0, depth: 0, jitter: 5, regularity: 400 } }));
      expect(m.status).toBe('NoError');
      expect(m.volume).toBeLessThan(FULL);
    }
  });
});

describe('Pattern Legno nel kernel', () => {
  it.each(WOOD_DESIGNS)('%s: toglie il volume atteso dalla funzione di profondità, il pezzo resta un solo solido valido', (design: WoodDesign) => {
    const s = scene({ kind: 'wood', design });
    const m = run(s);
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeLessThan(FULL);
    expect(m.volume).toBeGreaterThan(FULL * 0.9);
    expect(m.bbox.min[2]).toBeCloseTo(-2.5, 3);
    expect(m.bbox.max[2]).toBeCloseTo(2.5, 3);
    // CSG delle fughe più mappa della venatura (passo 0,5 mm) contro l'integrale della profondità, a meno dell'arrotondamento delle quote
    const removed = FULL - m.volume;
    expect(removed / integral(s)).toBeGreaterThan(0.93);
    expect(removed / integral(s)).toBeLessThan(1.07);
    const piece = wasm.Manifold.cube(SIZE, true);
    const result = buildPattern(wasm, piece, normalizePattern(patternOf(s)));
    expect(result.decompose().length).toBe(1);
    [piece, result].forEach((x) => x.delete());
  });

  it.each(WOOD_DESIGNS)('%s: deterministico dal seme, diverso con un altro seme', (design: WoodDesign) => {
    const a = run(scene({ kind: 'wood', design }));
    expect(run(scene({ kind: 'wood', design })).volume).toBe(a.volume);
    expect(run(scene({ kind: 'wood', design, relief: { ...wood, seed: 3 } })).volume).not.toBeCloseTo(a.volume, 2);
  });

  it('senza venatura restano le sole fughe (doghe e listelli); la tavola unica senza venatura non toglie nulla', () => {
    for (const design of ['planks', 'parquet'] as WoodDesign[]) {
      const grooves = run(scene({ kind: 'wood', design, relief: { ...wood, grainDepth: 0 } }));
      const grained = run(scene({ kind: 'wood', design }));
      expect(grooves.status).toBe('NoError');
      expect(grooves.volume).toBeLessThan(FULL);
      expect(grained.volume).toBeLessThan(grooves.volume);
      // Le fughe valgono area delle fughe per profondità
      const p = normalizePattern(patternOf(scene({ kind: 'wood', design })));
      const rect = frameRect(p, p.faces[0]);
      const covered = woodBoxes(rect, patternRelief(p).relief as WoodParams).reduce((sum, { box: [x0, y0, x1, y1] }) => sum + Math.max(0, Math.min(x1, 40) - Math.max(x0, -40)) * Math.max(0, Math.min(y1, 30) - Math.max(y0, -30)), 0);
      expect(FULL - grooves.volume).toBeCloseTo((4800 - covered) * wood.gapDepth, 1);
    }
    expect(run(scene({ kind: 'wood', design: 'single', relief: { ...wood, grainDepth: 0 } })).volume).toBeCloseTo(FULL, 3);
  });

  it('la venatura grande dà più volume tolto; i nodi della tavola unica la rendono più profonda dove stanno', () => {
    const light = run(scene({ kind: 'wood', design: 'single', relief: { ...wood, grainDepth: 0.2 } }));
    const strong = run(scene({ kind: 'wood', design: 'single', relief: { ...wood, grainDepth: 0.8 } }));
    expect(FULL - strong.volume).toBeGreaterThan(2.5 * (FULL - light.volume));
  });

  it('più facce, margine e anteprima', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    for (const design of WOOD_DESIGNS) {
      const one = run(scene({ kind: 'wood', design }));
      const two = run(scene({ kind: 'wood', design, faces }));
      expect(two.status).toBe('NoError');
      expect(FULL - two.volume).toBeGreaterThan(1.8 * (FULL - one.volume));
      const framed = run(scene({ kind: 'wood', design, margin: 8 }));
      expect(framed.status).toBe('NoError');
      expect(framed.volume).toBeGreaterThan(one.volume);
      const preview = run(scene({ kind: 'wood', design, preview: true }));
      expect(preview.status).toBe('NoError');
      expect(Math.abs(preview.volume - one.volume)).toBeLessThan(0.1 * (FULL - one.volume));
    }
    expect(run(scene({ kind: 'wood', margin: 100 })).volume).toBeCloseTo(FULL, 3);
  });

  it('misure estreme: il calcolo finisce e il solido è valido', () => {
    for (const design of WOOD_DESIGNS) {
      const m = run(scene({ kind: 'wood', design, relief: { ...wood, plankW: 0, plankL: 0, gap: 0, gapDepth: 0, ringSpacing: 0 } }));
      expect(m.status).toBe('NoError');
      expect(m.volume).toBeLessThan(FULL);
    }
  }, 60_000);
});

describe('Rame battuto e Legno su una faccia inclinata', () => {
  // Piramide a base quadrata (cono a 4 segmenti): la faccia verso (1, 1) ha normale (1, 1, 1) / radice di 3
  const pyramid = (patch: Partial<PatternParams>): Scene => {
    const cone = { ...primitiveDefaults('cone'), id: 'c', name: 'Piramide', position: [0, 0, 0], radiusBottom: 20, radiusTop: 0, height: 20, segments: 4 } as PrimitiveNode;
    const pb = { min: [-20, -20, -10] as Vec3, max: [20, 20, 10] as Vec3 };
    const normal: Vec3 = [1, 1, 1].map((v) => v / Math.sqrt(3)) as Vec3;
    const face = { origin: [10 / 3, 10 / 3, 10 / 3] as Vec3, normal, thickness: thicknessAlong(pb, normal) };
    const g: GroupNode = {
      id: 'g', name: 'Pattern', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
      pattern: { ...defaultPatternParams(pb, 7), margin: 0, faces: [face], ...patch },
    };
    return { nodes: { c: cone, g }, rootIds: ['g'] };
  };
  const PYRAMID = (800 * 20) / 3;
  /** Area della faccia inclinata: triangolo (20, 0, -10), (0, 20, -10), (0, 0, 10). */
  const FACE_AREA = 0.5 * Math.hypot(400, 400, 400);

  it.each([
    ['hammered', 'dimples'],
    ['hammered', 'facets'],
    ['hammered', 'scales'],
    ['wood', 'planks'],
    ['wood', 'parquet'],
    ['wood', 'single'],
  ] as const)('%s %s: il rilievo sta dentro la faccia e toglie al più un prisma sulla faccia', (kind, design) => {
    const m = run(pyramid({ kind, design }));
    expect(m.status).toBe('NoError');
    const removed = PYRAMID - m.volume;
    expect(removed).toBeGreaterThan(0);
    // Mai oltre un prisma sulla faccia con la profondità massima, e la sagoma della piramide non cambia
    expect(removed).toBeLessThan(FACE_AREA * 1.1);
    expect(m.bbox.min[0]).toBeCloseTo(-20, 2);
    expect(m.bbox.max[2]).toBeCloseTo(10, 2);
  });

  it('il codice OpenSCAD della faccia inclinata ruota nel riferimento della faccia', () => {
    const code = sceneToOpenScad(pyramid({ kind: 'hammered', design: 'facets' }));
    expect(code).toContain('projection(cut = true)');
    expect(code).not.toContain('rotate([0, 0, 0]) intersection()');
  });
});

describe('Rame battuto e Legno nel codice OpenSCAD', () => {
  /** Numeri di ogni riga di un elenco `name = [ ... ];` (una riga per elemento). */
  const listed = (code: string, name: string) => {
    const list = new RegExp(`${name} = \\[\\n([\\s\\S]*?)\\n\\s*\\];`).exec(code);
    expect(list).not.toBeNull();
    return list![1].trim().split('\n').map((line) => line.replace(/^\s*/, ''));
  };
  const numbers = (line: string) => (line.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);

  it('nessun module né function nel codice del Pattern (in OpenSCAD non si definiscono dentro un blocco)', () => {
    for (const [kind, designs] of [['hammered', HAMMERED_DESIGNS], ['wood', WOOD_DESIGNS]] as const) {
      for (const design of designs) {
        const code = sceneToOpenScad(scene({ kind, design } as Partial<PatternParams>));
        expect(code).not.toMatch(/\bmodule\s+\w+\s*\(/);
        expect(code).not.toMatch(/\bfunction\s+\w+\s*\(/);
        expect(code).toContain('difference() {');
        expect(code).toContain('intersection() {');
        expect(code).toContain('projection(cut = true)');
      }
    }
  });

  it('martellato: l\'elenco delle martellate è quello del kernel e la calotta è lo stesso arco ruotato', () => {
    const s = scene({ kind: 'hammered', design: 'dimples' });
    const p = normalizePattern(patternOf(s));
    const dents = dentList(frameRect(p, p.faces[0]), patternRelief(p).relief as HammeredParams);
    const code = sceneToOpenScad(s);
    const rows = listed(code, 'dents').map(numbers);
    expect(rows).toHaveLength(dents.length);
    rows.forEach((row, k) => {
      expect(row[0]).toBeCloseTo(dents[k].x, 3);
      expect(row[1]).toBeCloseTo(dents[k].y, 3);
      expect(row[2]).toBeCloseTo(dents[k].r, 3);
      expect(row[3]).toBeCloseTo(dents[k].d, 3);
    });
    expect(code).toContain('for (d = dents) translate([d[0], d[1], 0]) rotate_extrude($fn = 24) polygon(concat(');
    expect(code).not.toContain('scale([1,');
  });

  it('scaglie: elenco delle scaglie del kernel e calotta stirata in Y', () => {
    const s = scene({ kind: 'hammered', design: 'scales' });
    const p = normalizePattern(patternOf(s));
    const scales = scaleList(frameRect(p, p.faces[0]), patternRelief(p).relief as HammeredParams);
    const code = sceneToOpenScad(s);
    const rows = listed(code, 'dents').map(numbers);
    expect(rows).toHaveLength(scales.length);
    rows.forEach((row, k) => {
      expect(row[0]).toBeCloseTo(scales[k].x, 3);
      expect(row[1]).toBeCloseTo(scales[k].y, 3);
      expect(row[2]).toBeCloseTo(scales[k].rx, 3);
      expect(row[3]).toBeCloseTo(scales[k].d, 3);
    });
    expect(code).toContain('scale([1, 1.1, 1]) rotate_extrude($fn = 24)');
  });

  it('sfaccettato: i vertici di ogni cella sono quelli del kernel, un polyhedron convesso per cella', () => {
    const s = scene({ kind: 'hammered', design: 'facets' });
    const p = normalizePattern(patternOf(s));
    const facets = facetList(frameRect(p, p.faces[0]), patternRelief(p).relief as HammeredParams);
    const code = sceneToOpenScad(s);
    const rows = listed(code, 'facets').map(numbers);
    expect(rows).toHaveLength(facets.length);
    rows.forEach((row, k) => {
      expect(row).toHaveLength(facets[k].ring.length * 3);
      facets[k].ring.flat().forEach((v, i) => expect(row[i]).toBeCloseTo(v, 3));
    });
    expect(code).toContain('for (c = facets) polyhedron(points = concat([for (v = c) v], [for (v = c) [v[0], v[1], 0.5]]), faces = concat(');
    expect(code).toContain('[for (i = [1 : len(c) - 2]) [0, i, i + 1]]');
  });

  it('doghe e listelli: un elenco di rettangoli e la mappa della venatura con le stesse quote del kernel', () => {
    for (const design of ['planks', 'parquet'] as WoodDesign[]) {
      const s = scene({ kind: 'wood', design });
      const p = normalizePattern(patternOf(s));
      const rect = frameRect(p, p.faces[0]);
      const relief = patternRelief(p).relief as WoodParams;
      const code = sceneToOpenScad(s);
      expect(listed(code, 'planks')).toHaveLength(woodBoxes(rect, relief).length);
      expect(code).toContain('for (b = planks) translate([b[0], b[1]]) square([b[2] - b[0], b[3] - b[1]]);');
      expect(code).toContain('polyhedron(pts, faces, convexity = 10);');
      expect(code).toContain('union() {');
      // La mappa è la griglia del kernel (stesso passo, stesse quote in centesimi di mm)
      const depth = grainDepth(rect, relief);
      const grid = sampleGrid(rect, 0.5, (x, y) => 0.02 - depth(x, y));
      const rows = listed(code, 'zmap').map((line) => numbers(line));
      expect(rows).toHaveLength(grid.ny);
      expect(Number(/nx = (\d+);/.exec(code)![1])).toBe(grid.nx);
      rows.forEach((row, j) => {
        expect(row).toHaveLength(grid.nx);
        row.forEach((v, i) => expect(v).toBeCloseTo(Math.round(grid.z[j * grid.nx + i] * 100), 6));
      });
    }
  });

  it('tavola unica: solo la mappa (nessuna fuga, nessun elenco); senza venatura non scrive nulla da togliere', () => {
    const code = sceneToOpenScad(scene({ kind: 'wood', design: 'single' }));
    expect(code).not.toContain('planks');
    expect(code).toContain('zmap = [');
    expect(code).toContain('polyhedron(pts, faces, convexity = 10);');
    expect(code).not.toContain('linear_extrude(1.3)');
    const flat = sceneToOpenScad(scene({ kind: 'wood', design: 'single', relief: { ...wood, grainDepth: 0 } }));
    expect(flat).not.toContain('zmap');
    // Doghe senza venatura: solo le fughe
    const grooves = sceneToOpenScad(scene({ kind: 'wood', design: 'planks', relief: { ...wood, grainDepth: 0 } }));
    expect(grooves).toContain('planks = [');
    expect(grooves).not.toContain('zmap');
  });

  it('con più facce i dati hanno nomi distinti', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    const w = sceneToOpenScad(scene({ kind: 'wood', design: 'planks', faces }));
    for (const name of ['planks_1 = [', 'planks_2 = [', 'zmap_1 = [', 'zmap_2 = [', 'pts_1 = concat(', 'pts_2 = concat(', 'polyhedron(pts_2, faces_2']) expect(w).toContain(name);
    const h = sceneToOpenScad(scene({ kind: 'hammered', design: 'dimples', faces }));
    expect(h).toContain('dents_1 = [');
    expect(h).toContain('for (d = dents_2)');
    expect(h.match(/intersection\(\) \{/g)).toHaveLength(2);
    // Il seme della seconda faccia è quello della prima più uno: le liste sono diverse
    expect(listed(h, 'dents_1')).not.toEqual(listed(h, 'dents_2'));
  });

  it('i Mattoni, le Borchie e i tipi a celle non cambiano', () => {
    expect(sceneToOpenScad(scene({ kind: 'brick' }))).toContain('for (r = [0 :');
    expect(sceneToOpenScad(scene({ kind: 'studs' }))).toContain('union() {');
    expect(sceneToOpenScad(scene({ kind: 'hexagon', size: 20, rounding: 0 }))).toContain('cells = [');
  });
});
