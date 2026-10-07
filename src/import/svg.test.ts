// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { parseSvg } from './svg';
import { ImportError } from './types';
import { Evaluator } from '../kernel/evaluate';
import { shape2dDefaults } from '../scene/defaults';
import { sceneToOpenScad } from '../codegen/openscad';
import type { Scene, Shape2DNode } from '../scene/types';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Quadrato 40 × 20 con un foro quadrato 10 × 10 (regola pari-dispari), in unità utente. */
const SQUARE_WITH_HOLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path fill-rule="evenodd" d="M10 10 H50 V30 H10 Z M20 15 H30 V25 H20 Z" />
</svg>`;

describe('parseSvg', () => {
  it('legge un tracciato con foro: ingombro, centratura e due contorni', () => {
    const svg = parseSvg(SQUARE_WITH_HOLE, 'prova');
    expect(svg.name).toBe('prova');
    expect(svg.width).toBeCloseTo(40, 3);
    expect(svg.depth).toBeCloseTo(20, 3);
    expect(svg.contours).toHaveLength(2);
    // Centrato nell'origine
    const xs = svg.contours.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-20, 3);
    expect(Math.max(...xs)).toBeCloseTo(20, 3);
  });

  it('ribalta l asse Y: ciò che sta in alto nel disegno resta in alto nella scena', () => {
    const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 H10 V10 H0 Z M0 0 L5 -20 L10 0 Z"/></svg>', 'punta');
    const tip = svg.contours.flat().reduce((best, p) => (p[1] > best[1] ? p : best));
    // Il punto a y = -20 nell'SVG (più in alto) è quello con la Y maggiore
    expect(tip[0]).toBeCloseTo(0, 0);
    expect(tip[1]).toBeGreaterThan(0);
  });

  it('converte le unità fisiche dichiarate con il viewBox in millimetri', () => {
    const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10cm" height="10cm" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="5"/></svg>', 'cm');
    // 10 unità utente = 10 cm = 100 mm
    expect(svg.width).toBeCloseTo(100, 3);
    expect(svg.depth).toBeCloseTo(50, 3);
  });

  it('ignora i tracciati senza riempimento', () => {
    const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="black" d="M0 0 H100 V100 Z"/><path d="M0 0 H10 V10 Z"/></svg>', 'misto');
    expect(svg.width).toBeCloseTo(10, 3);
  });

  it('rifiuta i file che non sono SVG o che non hanno aree riempite', () => {
    expect(() => parseSvg('questo non è xml <<<', 'rotto')).toThrow(ImportError);
    expect(() => parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><path fill="none" d="M0 0 H10 V10 Z"/></svg>', 'vuoto')).toThrow(ImportError);
  });
});

describe('forma SVG nel kernel e nel codice', () => {
  const sceneFrom = (width: number, depth: number): Scene => {
    const svg = parseSvg(SQUARE_WITH_HOLE, 'prova');
    const node = { ...shape2dDefaults('svg'), id: 's', name: 'prova', position: [0, 0, 0], contours: svg.contours, width, depth, fileName: 'prova.svg', height: 2 } as Shape2DNode;
    return { nodes: { s: node }, rootIds: ['s'] };
  };

  it('estrude il disegno con il foro: volume = (area − foro) × altezza', () => {
    const [m] = new Evaluator(wasm).evaluate(sceneFrom(40, 20)).meshes;
    expect(m.status).toBe('NoError');
    // Foro 10 × 10: (800 − 100) × 2
    expect(m.volume).toBeCloseTo((40 * 20 - 10 * 10) * 2, 1);
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(40, 2);
  });

  it('larghezza e profondità scalano il disegno', () => {
    const [m] = new Evaluator(wasm).evaluate(sceneFrom(80, 20)).meshes;
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(80, 2);
    // Il foro si allarga con il disegno (20 × 10): (1600 − 200) × 2
    expect(m.volume).toBeCloseTo((80 * 20 - 20 * 10) * 2, 1);
  });

  it('genera polygon() con paths per il foro', () => {
    const code = sceneToOpenScad(sceneFrom(40, 20));
    expect(code).toContain('polygon(points = [');
    expect(code).toContain('paths = [[0, 1, 2, 3], [4, 5, 6, 7]]');
  });
});
