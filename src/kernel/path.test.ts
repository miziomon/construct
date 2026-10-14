import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { shape2dDefaults } from '../scene/defaults';
import { sceneToOpenScad } from '../codegen/openscad';
import { importScad } from '../import/scad/toScene';
import type { PathContour, PathNode, Scene, Shape2DNode, Vec2 } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const corner = (p: Vec2): PathNode => ({ p, kind: 'corner' });
const rect = (x0: number, y0: number, x1: number, y1: number): PathContour => ({ closed: true, nodes: [corner([x0, y0]), corner([x1, y0]), corner([x1, y1]), corner([x0, y1])] });
/** Cerchio di quattro cubiche (costante 0,5523), centro (cx, cy) e raggio r. */
const circle = (cx: number, cy: number, r: number): PathContour => {
  const k = 0.5523 * r;
  return {
    closed: true,
    nodes: [
      { p: [cx + r, cy], in: [0, -k], out: [0, k], kind: 'smooth' },
      { p: [cx, cy + r], in: [k, 0], out: [-k, 0], kind: 'smooth' },
      { p: [cx - r, cy], in: [0, k], out: [0, -k], kind: 'smooth' },
      { p: [cx, cy - r], in: [-k, 0], out: [k, 0], kind: 'smooth' },
    ],
  };
};

/** Profilo di Bézier con le misure naturali delle curve (width e depth da indicare) e il resto di `patch`. */
const pathNode = (paths: PathContour[], width: number, depth: number, patch: Partial<Shape2DNode> = {}): Shape2DNode =>
  ({ ...shape2dDefaults('path'), id: 'p', name: 'p', position: [0, 0, 0], paths, width, depth, ...patch }) as Shape2DNode;

const sceneOf = (node: Shape2DNode): Scene => ({ nodes: { [node.id]: node }, rootIds: [node.id] });
const volumeOf = (scene: Scene): number => {
  const [m] = new Evaluator(wasm).evaluate(scene).meshes;
  expect(m.status).toBe('NoError');
  return m.volume;
};

describe('Profilo di Bézier nel kernel', () => {
  it('un quadrato 20 × 20 × 10 ha volume 4000', () => {
    expect(volumeOf(sceneOf(pathNode([rect(0, 0, 20, 20)], 20, 20, { height: 10 })))).toBeCloseTo(4000, 1);
  });

  it('un cerchio di quattro cubiche è entro lo 0,5 % di πR²h', () => {
    const v = volumeOf(sceneOf(pathNode([circle(0, 0, 20)], 40, 40, { height: 10 })));
    expect(Math.abs(v / (Math.PI * 400 * 10) - 1)).toBeLessThan(0.005);
  });

  it('un contorno dentro un altro è un foro (pari-dispari)', () => {
    expect(volumeOf(sceneOf(pathNode([rect(0, 0, 20, 20), rect(5, 5, 15, 15)], 20, 20, { height: 10 })))).toBeCloseTo(3000, 1);
  });

  it('width e depth scalano il disegno attorno al centro', () => {
    const [m] = new Evaluator(wasm).evaluate(sceneOf(pathNode([rect(0, 0, 20, 20)], 40, 10, { height: 10 }))).meshes;
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(40, 3);
    expect(m.bbox.max[1] - m.bbox.min[1]).toBeCloseTo(10, 3);
    expect((m.bbox.max[0] + m.bbox.min[0]) / 2).toBeCloseTo(0, 3);
    expect(m.volume).toBeCloseTo(4000, 1);
  });

  it('senza contorni (o senza area) la forma è vuota e non è un errore', () => {
    for (const paths of [[], [{ closed: false, nodes: [corner([0, 0]), corner([0, 10])] }]]) {
      const [m] = new Evaluator(wasm).evaluate(sceneOf(pathNode(paths, 20, 20))).meshes;
      expect(m.empty).toBe(true);
      expect(m.volume).toBe(0);
    }
  });

  it('un contorno aperto in rotazione si chiude sull\'asse: un cilindro entro lo 0,5 %', () => {
    // Profilo aperto a U da (0, 0) a (10, 0), (10, 20), (0, 20): ruotato dà un cilindro di raggio 10 e altezza 20
    const open: PathContour = { closed: false, nodes: [corner([0, 0]), corner([10, 0]), corner([10, 20]), corner([0, 20])] };
    const v = volumeOf(sceneOf(pathNode([open], 10, 20, { extrusion: 'rotate' })));
    expect(Math.abs(v / (Math.PI * 100 * 20) - 1)).toBeLessThan(0.005);
  });

  it('in rotazione il raggio è la X del centro del profilo e revolveRadius non conta', () => {
    // Quadrato 10 × 10 con il centro a x = 30: toro a sezione quadrata, volume = 100 · 2π · 30
    const node = pathNode([rect(25, 0, 35, 10)], 10, 10, { extrusion: 'rotate', revolveRadius: 99 } as Partial<Shape2DNode>);
    const v = volumeOf(sceneOf(node));
    expect(Math.abs(v / (100 * 2 * Math.PI * 30) - 1)).toBeLessThan(0.005);
  });

  it('un profilo oltre l\'asse non provoca eccezioni', () => {
    // Centrato sull'asse (raggio 0) e a sinistra dell'asse (raggio negativo)
    for (const x0 of [-5, -35]) {
      const [m] = new Evaluator(wasm).evaluate(sceneOf(pathNode([rect(x0, 0, x0 + 10, 10)], 10, 10, { extrusion: 'rotate' }))).meshes;
      expect(Number.isFinite(m.volume)).toBe(true);
      expect(m.volume).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('coerenza tra kernel e codice OpenSCAD', () => {
  /** Volume del solido ottenuto rileggendo il codice senza il commento `// construct:path` (quindi come "Poligono"). */
  const reimportedVolume = (node: Shape2DNode): number => {
    const code = sceneToOpenScad(sceneOf(node));
    expect(code).toContain('// construct:path');
    const plain = code.split('\n').filter((line) => !line.includes('construct:path')).join('\n');
    const r = importScad(plain);
    const roots = r.plates[0].rootIds;
    // Nessun nodo `path` senza il commento: tutto torna come disegno SVG
    expect(Object.values(r.nodes).some((n) => n.type === 'shape2d' && n.kind === 'path')).toBe(false);
    return volumeOf({ nodes: r.nodes, rootIds: roots });
  };
  const relative = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b);

  it('lineare con torsione e offset: stesso volume del Poligono riletto dal codice', () => {
    // Un'ellisse irregolare con un foro, torta di 40° e ingrandita di 1 mm
    const node = pathNode([circle(3, -2, 12), rect(-2, -6, 6, 2)], 24, 24, { height: 8, twist: 40, offset: 1 } as Partial<Shape2DNode>);
    const kernel = volumeOf(sceneOf(node));
    expect(kernel).toBeGreaterThan(0);
    expect(relative(kernel, reimportedVolume(node))).toBeLessThanOrEqual(1e-3);
  });

  it('lineare con scala della cima e misure diverse da quelle naturali', () => {
    const node = pathNode([circle(0, 0, 10)], 30, 12, { height: 6, scaleTop: 0.5 } as Partial<Shape2DNode>);
    expect(relative(volumeOf(sceneOf(node)), reimportedVolume(node))).toBeLessThanOrEqual(1e-3);
  });

  it('rotazione con profilo a destra dell\'asse: stesso volume del Poligono riletto', () => {
    const node = pathNode([circle(30, 10, 5)], 10, 10, { extrusion: 'rotate' });
    expect(relative(volumeOf(sceneOf(node)), reimportedVolume(node))).toBeLessThanOrEqual(1e-3);
  });

  it('rotazione con contorno aperto (chiuso sull\'asse) e angolo parziale', () => {
    const open: PathContour = { closed: false, nodes: [corner([0, 0]), { p: [12, 0], out: [0, 8], kind: 'smooth' }, { p: [12, 20], in: [0, -8], kind: 'smooth' }, corner([0, 20])] };
    const node = pathNode([open], 12, 20, { extrusion: 'rotate', revolveAngle: 200 } as Partial<Shape2DNode>);
    expect(relative(volumeOf(sceneOf(node)), reimportedVolume(node))).toBeLessThanOrEqual(1e-3);
  });
});
