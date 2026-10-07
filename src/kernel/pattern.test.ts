import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { primitiveDefaults } from '../scene/defaults';
import { defaultPatternParams, faceFromBounds } from '../scene/pattern';
import type { GroupNode, PatternParams, PrimitiveNode, Scene, Vec3 } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Un pannello 80 × 60 × 5 all'origine del gruppo (centrato) dentro un gruppo pattern con i parametri dati. */
function scene(patch: Partial<PatternParams>, size: Vec3 = [80, 60, 5]): Scene {
  const cube = { ...primitiveDefaults('box'), id: 'c', name: 'Pannello', position: [0, 0, 0], size } as PrimitiveNode;
  const bounds = { min: size.map((v) => -v / 2) as Vec3, max: size.map((v) => v / 2) as Vec3 };
  const g: GroupNode = {
    id: 'g', name: 'Pattern', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
    pattern: { ...defaultPatternParams(bounds, 7), ...patch },
  };
  return { nodes: { c: cube, g }, rootIds: ['g'] };
}
const run = (s: Scene) => new Evaluator(wasm).evaluate(s).meshes[0];
const FULL = 80 * 60 * 5;

describe('Pattern nel kernel', () => {
  it('Voronoi passante: toglie volume, lascia la cornice e dà un solo solido valido', () => {
    const m = run(scene({ kind: 'voronoi', cells: 30, margin: 5 }));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeLessThan(FULL * 0.9);
    expect(m.volume).toBeGreaterThan(FULL * 0.2);
    // L'ingombro resta quello del pannello (la cornice è intatta)
    expect(m.bbox.min[0]).toBeCloseTo(-40, 2);
    expect(m.bbox.max[1]).toBeCloseTo(30, 2);
  });

  it('è deterministico con lo stesso seme e cambia con un altro', () => {
    const a = run(scene({ cells: 25, seed: 3 }));
    expect(run(scene({ cells: 25, seed: 3 })).volume).toBeCloseTo(a.volume, 6);
    expect(run(scene({ cells: 25, seed: 4 })).volume).not.toBeCloseTo(a.volume, 2);
  });

  it('con più parete resta più materiale', () => {
    const thin = run(scene({ cells: 30, wall: 1.2 }));
    const thick = run(scene({ cells: 30, wall: 3 }));
    expect(thick.volume).toBeGreaterThan(thin.volume);
  });

  it('Solchi: resta più materiale dei Fori con le stesse celle quando le celle sono grandi', () => {
    const holes = run(scene({ cells: 20, mode: 'holes', wall: 2 }));
    const grooves = run(scene({ cells: 20, mode: 'grooves', wall: 2 }));
    expect(grooves.status).toBe('NoError');
    expect(grooves.volume).toBeGreaterThan(holes.volume);
  });

  it('profondità parziale: tasca che non buca, e da due lati toglie di più', () => {
    const through = run(scene({ cells: 20 }));
    const pocket = run(scene({ cells: 20, depth: 2 }));
    const both = run(scene({ cells: 20, depth: 2, sides: 'both' }));
    expect(pocket.volume).toBeGreaterThan(through.volume);
    expect(pocket.volume).toBeLessThan(FULL);
    expect(both.volume).toBeLessThan(pocket.volume);
    // Con 2 mm da ciascun lato su 5 di spessore resta un'anima da 1 mm: il pezzo non si divide
    expect(both.status).toBe('NoError');
  });

  it('esagoni e cerchi: forano il pannello', () => {
    const hex = run(scene({ kind: 'hexagon', size: 12, wall: 2, rounding: 0 }));
    const circles = run(scene({ kind: 'circle', size: 12 }));
    expect(hex.volume).toBeLessThan(FULL * 0.8);
    expect(circles.volume).toBeLessThan(FULL * 0.9);
    expect(hex.status).toBe('NoError');
  });

  it('da una faccia laterale (x+) la direzione del taglio cambia', () => {
    const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
    const top = run(scene({ cells: 12, margin: 3 }));
    const side = run(scene({ cells: 12, margin: 1, face: faceFromBounds(bounds, 'x+') }));
    expect(side.status).toBe('NoError');
    expect(side.volume).toBeLessThan(FULL);
    expect(side.volume).not.toBeCloseTo(top.volume, 0);
  });

  it('reticolo 3D: resta meno di un quinto del cubo e il pezzo è valido', () => {
    const m = run(scene({ kind: 'lattice', latticeCells: 10, strut: 3 }, [30, 30, 30]));
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeGreaterThan(0);
    expect(m.volume).toBeLessThan(27000 * 0.5);
  });

  it('un margine che occupa tutto il pezzo lo lascia invariato', () => {
    const m = run(scene({ margin: 100 }));
    expect(m.volume).toBeCloseTo(FULL, 2);
  });
});

describe('Pattern nel codice OpenSCAD', () => {
  it('Voronoi passante: celle, parete, margine e proiezione del pezzo', () => {
    const code = sceneToOpenScad(scene({ cells: 6, margin: 4, wall: 2, rounding: 1 }));
    expect(code).toContain('cells = [');
    expect(code.match(/^\s+\[\[/gm)).toHaveLength(6);
    expect(code).toContain('for (c = cells) offset(r = 1, $fn = 32) offset(delta = -2) polygon(c);');
    expect(code).toContain('offset(delta = -4) projection() rotate(');
    expect(code).toContain('linear_extrude(height =');
    expect(code).toContain('difference() {');
    expect(code).not.toContain('NaN');
    // Le graffe sono bilanciate
    expect(code.split('{').length).toBe(code.split('}').length);
  });

  it('Solchi, tasca da due lati ed esagoni', () => {
    const grooves = sceneToOpenScad(scene({ mode: 'grooves', cells: 5, depth: 2, sides: 'both' }));
    expect(grooves).toContain('projection(cut = true) translate([0, 0, 0.01])');
    expect(grooves).toContain('for (z = [-2, -6]) translate([0, 0, z]) linear_extrude(height = 3)');
    expect(grooves.indexOf('difference() {', grooves.indexOf('linear_extrude'))).toBeGreaterThan(0);
    const hex = sceneToOpenScad(scene({ kind: 'hexagon', size: 20, rounding: 0 }));
    expect(hex).not.toContain('offset(r =');
    expect(hex).toContain('offset(delta = -0.8) polygon(c);');
  });

  it('reticolo: puntoni tra sfere intersecati con il pezzo', () => {
    const code = sceneToOpenScad(scene({ kind: 'lattice', latticeCells: 8, strut: 3 }, [30, 30, 30]));
    expect(code).toContain('edges = [');
    expect(code).toContain('for (e = edges) hull() {');
    expect(code).toContain('sphere(d = 3, $fn = 8)');
    expect(code.split('{').length).toBe(code.split('}').length);
  });
});
