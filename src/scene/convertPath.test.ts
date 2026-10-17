import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { sceneToOpenScad } from '../codegen/openscad';
import { Evaluator } from '../kernel/evaluate';
import { canConvertToPath, convertToPath } from './convertPath';
import { shape2dDefaults } from './defaults';
import { pathNaturalSize } from './shapes2d';
import { draftFromNode } from '../ui/ProfileEditor/model';
import type { Scene, Shape2DKind, Shape2DNode } from './types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Nodo di una forma 2D con valori di prova (fuori dall'origine e ruotato, così la compensazione della posizione si vede). */
const shape = (kind: Shape2DKind, patch: Record<string, unknown> = {}): Shape2DNode => ({ ...shape2dDefaults(kind), id: 's', name: 'Forma', position: [5, 7, 10], rotation: [0, 0, 25], height: 6, ...patch }) as Shape2DNode;

/** Volume e riquadro del solido di un nodo. */
function solid(node: Shape2DNode) {
  const scene: Scene = { nodes: { [node.id]: node }, rootIds: [node.id] };
  const [m] = new Evaluator(wasm).evaluate(scene).meshes;
  expect(m.status).toBe('NoError');
  return { volume: m.volume!, min: m.bbox.min, max: m.bbox.max };
}

/** Converte una forma che deve potersi convertire. */
function convert(node: Shape2DNode) {
  const result = convertToPath(node);
  if (typeof result === 'string') throw new Error(result);
  return result;
}

/** Converte e confronta il solido prima e dopo: volume entro `rel` (relativo) e riquadro entro `box` mm. */
function expectSame(node: Shape2DNode, rel: number, box = 0.01) {
  const result = convert(node);
  const [before, after] = [solid(node), solid(result.node)];
  expect(Math.abs(after.volume - before.volume) / before.volume).toBeLessThan(rel);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(after.min[i] - before.min[i])).toBeLessThan(box);
    expect(Math.abs(after.max[i] - before.max[i])).toBeLessThan(box);
  }
  return result;
}

describe('convertToPath: il solido resta lo stesso', () => {
  it('quadrato (4 spigoli) entro 1e-3', () => {
    const { node } = expectSame(shape('square', { width: 30, depth: 18 }), 1e-3);
    expect(node.paths).toHaveLength(1);
    expect(node.paths[0].nodes).toHaveLength(4);
    expect(node.paths[0].nodes.every((n) => n.kind === 'corner' && !n.in && !n.out)).toBe(true);
  });

  it('quadrato con raccordo: 8 nodi, volume entro 0,5%', () => {
    const { node } = expectSame(shape('square', { width: 30, depth: 18, cornerRadius: 4 }), 5e-3);
    expect(node.paths[0].nodes).toHaveLength(8);
  });

  it('quadrato con il raccordo al massimo (quasi un cerchio): la differenza è l\'arco a 32 segmenti del kernel, entro 1%', () => {
    expectSame(shape('square', { width: 20, depth: 20, cornerRadius: 50 }), 1e-2);
  });

  it.each([3, 5, 6, 12])('cerchio a %i lati: N spigoli, volume e riquadro entro 1e-3', (segments) => {
    const { node } = expectSame(shape('circle', { radius: 12, segments }), 1e-3);
    expect(node.paths[0].nodes).toHaveLength(segments);
  });

  it('cerchio non proporzionale (radiusY) a 6 e a 5 lati', () => {
    expectSame(shape('circle', { radius: 12, segments: 6, radiusY: 5 }), 1e-3);
    expectSame(shape('circle', { radius: 12, segments: 5, radiusY: 20 }), 1e-3);
  });

  it('poligono con il raccordo: 12 nodi per un esagono, volume entro 0,5%', () => {
    const { node } = expectSame(shape('circle', { radius: 12, segments: 6, cornerRadius: 2 }), 5e-3);
    expect(node.paths[0].nodes).toHaveLength(12);
  });

  it('cerchio a 64 lati: 4 nodi simmetrici, volume entro 0,3%', () => {
    const { node } = expectSame(shape('circle', { radius: 20, segments: 64 }), 3e-3, 0.2);
    expect(node.paths[0].nodes).toHaveLength(4);
    expect(node.paths[0].nodes.every((n) => n.kind === 'symmetric')).toBe(true);
  });

  it('cerchio a 64 lati ellittico', () => {
    expectSame(shape('circle', { radius: 20, segments: 64, radiusY: 8 }), 3e-3, 0.2);
  });

  it.each(['star', 'ring', 'cross', 'heart', 'profileL', 'profileH', 'tubeRect', 'tubeRound'] as const)('forma %s: spigoli dai contorni, entro 1e-3', (kind) => {
    expectSame(shape(kind), 1e-3);
  });

  it('anello: due contorni, il foro resta un foro', () => {
    const { node } = expectSame(shape('ring', { width: 30, depth: 30, ratio: 0.5 }), 1e-3);
    expect(node.paths).toHaveLength(2);
  });

  it('SVG scalato: i contorni portati alla misura attuale', () => {
    // Quadrato con foro di 20 × 10 e 8 × 4 alla misura naturale, ingrandito a 60 × 30
    const contours: [number, number][][] = [[[-10, -5], [10, -5], [10, 5], [-10, 5]], [[-4, -2], [4, -2], [4, 2], [-4, 2]]];
    const { node } = expectSame(shape('svg', { contours, width: 60, depth: 30, fileName: 'f.svg' }), 1e-3);
    expect(node.width).toBeCloseTo(60, 3);
    expect(node.depth).toBeCloseTo(30, 3);
  });

  it('con torsione e scala in cima (forma centrata)', () => {
    expectSame(shape('circle', { radius: 12, segments: 6, twist: 40, scaleTop: 0.6 }), 1e-3, 0.02);
  });

  it('con il contorno (offset) e l\'angolo vivo', () => {
    expectSame(shape('square', { width: 30, depth: 18, offset: 2, offsetJoin: 'sharp' }), 1e-3);
  });

  it('estrusione rotazionale: il raggio dall\'asse resta quello della forma (anche con un numero dispari di lati)', () => {
    expectSame(shape('circle', { radius: 8, segments: 6, extrusion: 'rotate', revolveRadius: 25, revolveSegments: 48 }), 1e-3);
    expectSame(shape('circle', { radius: 8, segments: 5, extrusion: 'rotate', revolveRadius: 25, revolveSegments: 48 }), 1e-3);
    expectSame(shape('square', { width: 10, depth: 16, extrusion: 'rotate', revolveAngle: 200 }), 1e-3);
  });
});

describe('convertToPath: il nodo', () => {
  it('stesso id e campi comuni, nessun campo proprio della forma originale', () => {
    const node = shape('circle', { radius: 12, segments: 6, cornerRadius: 1, radiusY: 4, mirror: [true, false, false], hidden: true, color: '#123456', mode: 'hole', offset: 1 });
    const path = convert(node).node as unknown as Record<string, unknown>;
    expect(path).toMatchObject({ id: 's', name: 'Forma', type: 'shape2d', kind: 'path', color: '#123456', mode: 'hole', hidden: true, mirror: [true, false, false], rotation: [0, 0, 25], height: 6, offset: 1 });
    for (const key of ['radius', 'segments', 'cornerRadius', 'radiusY', 'revolveRadius']) expect(key in path).toBe(false);
  });

  it('approximate: solo il cerchio con più di 12 lati', () => {
    expect(convert(shape('circle', { radius: 12, segments: 13 })).approximate).toBe(true);
    expect(convert(shape('circle', { radius: 12, segments: 64 })).approximate).toBe(true);
    expect(convert(shape('circle', { radius: 12, segments: 12 })).approximate).toBe(false);
    expect(convert(shape('square')).approximate).toBe(false);
    expect(convert(shape('star')).approximate).toBe(false);
  });

  it('width e depth sono la misura naturale dei nodi: aprire il Profilo convertito non incorpora nessuna scala', () => {
    for (const segments of [5, 6, 7]) {
      const { node } = convert(shape('circle', { radius: 12, segments }));
      expect(node.width).toBe(pathNaturalSize(node).width);
      expect(node.depth).toBe(pathNaturalSize(node).depth);
      expect(draftFromNode(node).paths).toBe(node.paths);
    }
  });

  it('il lucchetto delle proporzioni resta com\'era', () => {
    expect(convert(shape('square')).node.lockRatio).toBe(false);
    expect(convert(shape('square', { lockRatio: true })).node.lockRatio).toBe(true);
  });

  it('i legami a un parametro: restano quelli dei campi del Profilo, gli altri si tolgono e si elencano', () => {
    const bind = (expr: string) => ({ expr });
    const result = convert(shape('circle', { radius: 12, segments: 6, exprs: { radius: bind('r'), height: bind('h'), 'position.0': bind('x'), 'rotation.2': bind('a') } }));
    expect(Object.keys(result.node.exprs!).sort()).toEqual(['height', 'position.0', 'rotation.2']);
    expect(result.dropped).toEqual(['radius']);
  });

  it('un legame di posizione che la compensazione sposta si perde', () => {
    // Pentagono: il centro del riquadro non è nell'origine, quindi la posizione cambia
    const result = convert(shape('circle', { radius: 12, segments: 5, exprs: { 'position.0': { expr: 'x' }, 'position.2': { expr: 'z' } } }));
    expect(result.dropped).toContain('position.0');
    expect(Object.keys(result.node.exprs ?? {})).toEqual(['position.2']);
  });

  it('il codice OpenSCAD del Profilo convertito porta il commento construct:path', () => {
    const code = sceneToOpenScad({ nodes: { s: convert(shape('circle', { radius: 12, segments: 6 })).node }, rootIds: ['s'] });
    expect(code).toContain('// construct:path ');
  });
});

describe('convertToPath: i casi rifiutati', () => {
  it('il testo e il Profilo non si convertono', () => {
    const text = shape('text');
    const path = shape('path');
    expect(canConvertToPath(text)).toBe(false);
    expect(canConvertToPath(path)).toBe(false);
    expect(canConvertToPath(shape('square'))).toBe(true);
    expect(typeof convertToPath(text)).toBe('string');
    expect(typeof convertToPath(path)).toBe('string');
  });

  it('un SVG con troppi punti in un contorno rimanda all\'import nella modale', () => {
    const contour = Array.from({ length: 600 }, (_, i): [number, number] => [10 * Math.cos((2 * Math.PI * i) / 600), 10 * Math.sin((2 * Math.PI * i) / 600)]);
    const result = convertToPath(shape('svg', { contours: [contour], width: 20, depth: 20, fileName: 'f.svg' }));
    expect(result).toContain('600 punti in un contorno (massimo 500)');
    expect(result).toContain('importa il file SVG dentro la modale del Profilo');
  });

  it('troppi contorni (oltre 100) rimanda all\'import nella modale', () => {
    const square = (i: number): [number, number][] => [[i, 0], [i + 0.5, 0], [i + 0.5, 1], [i, 1]];
    const result = convertToPath(shape('svg', { contours: Array.from({ length: 101 }, (_, i) => square(i * 2)), width: 200, depth: 1, fileName: 'f.svg' }));
    expect(result).toContain('101 contorni (massimo 100)');
  });

  it('un poligono con il centro fuori dal riquadro (lati dispari) non si converte con torsione o scala in cima', () => {
    expect(typeof convertToPath(shape('circle', { radius: 12, segments: 5, twist: 30 }))).toBe('string');
    expect(typeof convertToPath(shape('circle', { radius: 12, segments: 5, scaleTop: 0.5 }))).toBe('string');
    // Senza torsione e scala si converte, e con i lati pari (centro nel riquadro) anche con la torsione
    expect(typeof convertToPath(shape('circle', { radius: 12, segments: 5 }))).toBe('object');
    expect(typeof convertToPath(shape('circle', { radius: 12, segments: 6, twist: 30 }))).toBe('object');
  });
});
