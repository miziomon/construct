import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { sceneToOpenScad } from '../codegen/openscad';
import { shape2dDefaults } from '../scene/defaults';
import { FONTS } from '../scene/fontCatalog';
import { registerFont } from '../scene/fontOutline';
import { profileExtent } from '../scene/shapes2d';
import type { Scene, Shape2DNode } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
  const roboto = FONTS[0];
  const b = readFileSync(`src/assets/fonts/${roboto.file}`);
  registerFont(roboto.id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
});

const shape = (kind: Parameters<typeof shape2dDefaults>[0], patch: Record<string, unknown> = {}): Shape2DNode =>
  ({ ...shape2dDefaults(kind), id: 'a', name: 'a', position: [0, 0, 0], ...patch }) as Shape2DNode;

const mesh = (node: Shape2DNode) => new Evaluator(wasm).evaluate({ nodes: { a: node }, rootIds: ['a'] } as Scene).meshes[0];
const size = (m: ReturnType<typeof mesh>) => [m.bbox.max[0] - m.bbox.min[0], m.bbox.max[1] - m.bbox.min[1]];

describe('Contorno (offset 2D)', () => {
  const square = { width: 20, depth: 10, height: 5, cornerRadius: 0 };

  it('positivo con angoli vivi: ogni lato cresce di offset', () => {
    const m = mesh(shape('square', { ...square, offset: 2, offsetJoin: 'sharp' }));
    expect(m.status).toBe('NoError');
    expect(size(m)[0]).toBeCloseTo(24, 3);
    expect(size(m)[1]).toBeCloseTo(14, 3);
    expect(m.volume).toBeCloseTo(24 * 14 * 5, 2);
  });

  it('positivo con angoli arrotondati: stesso ingombro ma area minore (angoli tondi)', () => {
    const sharp = mesh(shape('square', { ...square, offset: 2, offsetJoin: 'sharp' }));
    const round = mesh(shape('square', { ...square, offset: 2 }));
    expect(size(round)[0]).toBeCloseTo(24, 3);
    expect(size(round)[1]).toBeCloseTo(14, 3);
    expect(round.volume).toBeLessThan(sharp.volume);
    // Area esatta: rettangolo 20 × 10 + 4 strisce + 4 quarti di cerchio di raggio 2 (la polilinea a 32 segmenti è appena minore)
    expect(round.volume / 5).toBeGreaterThan(20 * 10 + 2 * 2 * (20 + 10) + Math.PI * 4 - 0.5);
    expect(round.volume / 5).toBeLessThan(20 * 10 + 2 * 2 * (20 + 10) + Math.PI * 4 + 0.01);
  });

  it('negativo restringe e, se supera la metà del lato minore, il solido sparisce', () => {
    const smaller = mesh(shape('square', { ...square, offset: -2, offsetJoin: 'sharp' }));
    expect(size(smaller)[0]).toBeCloseTo(16, 3);
    expect(size(smaller)[1]).toBeCloseTo(6, 3);
    expect(mesh(shape('square', { ...square, offset: -20 })).empty).toBe(true);
  });

  it('senza offset (assente o zero) il profilo è quello di sempre', () => {
    expect(mesh(shape('square', square)).volume).toBeCloseTo(1000, 3);
    expect(mesh(shape('square', { ...square, offset: 0 })).volume).toBeCloseTo(1000, 3);
  });

  it('vale anche per il testo: un contorno positivo lo allarga', () => {
    const base = mesh(shape('text', { text: 'Ciao', size: 10, height: 3 }));
    const bold = mesh(shape('text', { text: 'Ciao', size: 10, height: 3, offset: 0.5 }));
    expect(bold.status).toBe('NoError');
    expect(size(bold)[0]).toBeCloseTo(size(base)[0] + 1, 1);
    expect(bold.volume).toBeGreaterThan(base.volume);
  });

  it('con l\'estrusione rotazionale il contorno si applica al profilo prima della rotazione', () => {
    const m = mesh(shape('circle', { radius: 5, extrusion: 'rotate', revolveRadius: 20, offset: 1 }));
    expect(m.status).toBe('NoError');
    // Il tubo ora ha raggio 6: ingombro in X = 20 + 6
    expect(m.bbox.max[0]).toBeCloseTo(26, 0);
    expect(m.bbox.max[2]).toBeCloseTo(6, 0);
  });
});

describe('Contorno nel codice OpenSCAD', () => {
  const code = (node: Shape2DNode) => sceneToOpenScad({ nodes: { a: node }, rootIds: ['a'] } as Scene);
  const square = { width: 20, depth: 10, cornerRadius: 0 };

  it('arrotondato: offset(r) subito dopo linear_extrude; vivo: offset(delta)', () => {
    expect(code(shape('square', { ...square, offset: 2 }))).toContain(['linear_extrude(height = 10, center = true, twist = 0, scale = 1, slices = 1)', 'offset(r = 2, $fn = 32)', 'square([20, 10], center = true);'].join(String.fromCharCode(10)));
    expect(code(shape('square', { ...square, offset: -1.5, offsetJoin: 'sharp' }))).toContain('offset(delta = -1.5)');
    expect(code(shape('square', square))).not.toContain('offset(');
  });

  it('nel rotazionale l\'offset sta dentro rotate_extrude, prima della traslazione e del profilo', () => {
    const out = code(shape('circle', { radius: 5, extrusion: 'rotate', revolveRadius: 20, offset: 1 }));
    const at = (s: string) => out.indexOf(s);
    expect(at('rotate_extrude(')).toBeGreaterThan(-1);
    expect(at('rotate_extrude(')).toBeLessThan(at('translate([20, 0])'));
    expect(at('translate([20, 0])')).toBeLessThan(at('offset(r = 1'));
    expect(at('offset(r = 1')).toBeLessThan(at('circle('));
  });
});

describe('ingombro del profilo con contorno', () => {
  it('cresce di 2 · offset per lato e non scende sotto zero', () => {
    const sq = shape('square', { width: 20, depth: 10 });
    expect(profileExtent(sq)).toEqual({ width: 20, depth: 10 });
    expect(profileExtent({ ...sq, offset: 2 } as Shape2DNode)).toEqual({ width: 24, depth: 14 });
    expect(profileExtent({ ...sq, offset: -8 } as Shape2DNode)).toEqual({ width: 4, depth: 0 });
  });
});
