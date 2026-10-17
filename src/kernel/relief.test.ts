import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { BEST_ENGINE, heightSolid, reliefAddition, reliefCutter } from './relief';
import type { ReliefEngine } from './relief';
import { writeStl } from './export/stl';
import { reliefScad } from '../codegen/reliefScad';
import { reliefDefaults, sampleGrid } from '../scene/relief';
import type { ReliefKind, ReliefParams } from '../scene/relief';

let wasm: ManifoldToplevel;
let region: CrossSection;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
  // La faccia 80 × 60 mm centrata nell'origine (riferimento della faccia: faccia su z = 0)
  region = wasm.CrossSection.square([80, 60], true);
});

afterAll(() => region.delete());

/** Pannello 80 × 60 × 5 con la faccia superiore su z = 0 (il pezzo sta sotto). */
const panel = (): Manifold => {
  const box = wasm.Manifold.cube([80, 60, 5], true);
  const moved = box.translate([0, 0, -2.5]);
  box.delete();
  return moved;
};
const FULL = 80 * 60 * 5;

const SUBTRACTIVE = ['brick', 'wood', 'rust', 'hammered'] as const;

/** Mesh come stringa di numeri, per confrontare due solidi triangolo per triangolo. */
const signature = (m: Manifold) => {
  const mesh = m.getMesh();
  return `${m.numTri()}|${m.volume().toFixed(6)}|${Array.from(mesh.vertProperties.slice(0, 300)).join(',')}`;
};

describe('mappa di altezze', () => {
  it('chiude un solido valido con volume pari al prisma sotto la superficie', () => {
    const grid = sampleGrid({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 1, () => 0.5);
    const solid = heightSolid(wasm, grid, -1);
    expect(solid.status()).toBe('NoError');
    // Altezza tra il piano (-1) e la superficie (0,5) = 1,5 mm su 10 × 5 mm
    expect(solid.volume()).toBeCloseTo(10 * 5 * 1.5, 3);
    solid.delete();
  });

  it('con il piano sopra la superficie il solido è comunque valido e di volume positivo', () => {
    const grid = sampleGrid({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 0.5, (x, y) => 0.1 * Math.sin(x) * Math.cos(y));
    const solid = heightSolid(wasm, grid, 2);
    expect(solid.status()).toBe('NoError');
    expect(solid.volume()).toBeGreaterThan(10 * 5 * 1.8);
    solid.delete();
  });
});

describe.each(SUBTRACTIVE)('texture sottrattiva: %s', (kind) => {
  const params = reliefDefaults(kind);
  const engines: ReliefEngine[] = kind === 'wood' ? ['csg', 'heightmap', 'hybrid'] : ['csg', 'heightmap'];

  it.each(engines)('motore %s: taglio valido, tolto dal pannello fa calare il volume', (engine) => {
    const cutter = reliefCutter(wasm, region, params, { engine, step: 0.8 });
    expect(cutter).not.toBeNull();
    expect(cutter!.status()).toBe('NoError');
    expect(cutter!.volume()).toBeGreaterThan(0);
    const piece = panel();
    const result = piece.subtract(cutter!);
    expect(result.status()).toBe('NoError');
    // Il pezzo resta un solo solido chiuso, con meno volume ma non svuotato
    expect(result.volume()).toBeLessThan(FULL);
    expect(result.volume()).toBeGreaterThan(FULL * 0.8);
    expect(result.decompose().length).toBe(1);
    // L'ingombro nel piano non cambia
    expect(result.boundingBox().max[0]).toBeCloseTo(40, 3);
    [cutter!, piece, result].forEach((m) => m.delete());
  });

  it('è deterministico: stesso seme, stessa geometria', () => {
    const a = reliefCutter(wasm, region, params, { step: 0.8 })!;
    const b = reliefCutter(wasm, region, params, { step: 0.8 })!;
    expect(signature(a)).toBe(signature(b));
    [a, b].forEach((m) => m.delete());
  });
});

describe('seme diverso, geometria diversa', () => {
  it.each(['wood', 'rust', 'hammered'] as const)('%s', (kind) => {
    const base = reliefDefaults(kind);
    const other = { ...base, seed: 2 } as ReliefParams;
    const a = reliefCutter(wasm, region, base, { step: 0.8 })!;
    const b = reliefCutter(wasm, region, other, { step: 0.8 })!;
    expect(signature(a)).not.toBe(signature(b));
    [a, b].forEach((m) => m.delete());
  });
});

describe('borchie (additive)', () => {
  const params = reliefDefaults('studs');

  it.each(['csg', 'heightmap'] as const)('motore %s: unite al pannello ne aumentano il volume e restano un solo solido', (engine) => {
    const addition = reliefAddition(wasm, region, params, { engine, step: 0.4 });
    expect(addition).not.toBeNull();
    expect(addition!.status()).toBe('NoError');
    const piece = panel();
    const result = piece.add(addition!);
    expect(result.status()).toBe('NoError');
    expect(result.volume()).toBeGreaterThan(FULL);
    // 35 borchie a calotta (raggio 2,5, altezza 1,5): volume di una calotta = pi h (3 r² + h²) / 6
    const cap = (Math.PI * 1.5 * (3 * 2.5 ** 2 + 1.5 ** 2)) / 6;
    expect(result.volume() - FULL).toBeGreaterThan(35 * cap * 0.9);
    expect(result.volume() - FULL).toBeLessThan(35 * cap * 1.1);
    expect(result.decompose().length).toBe(1);
    expect(result.boundingBox().max[2]).toBeCloseTo(1.5, 1);
    [addition!, piece, result].forEach((m) => m.delete());
  });

  it('borchie cilindriche con smusso: altezza piena e volume maggiore della calotta', () => {
    const cyl = { ...params, shape: 'chamfered' as const };
    const addition = reliefAddition(wasm, region, cyl)!;
    expect(addition.status()).toBe('NoError');
    expect(addition.boundingBox().max[2]).toBeCloseTo(1.5, 3);
    const dome = reliefAddition(wasm, region, params)!;
    expect(addition.volume()).toBeGreaterThan(dome.volume());
    [addition, dome].forEach((m) => m.delete());
  });

  it('le borchie fuori dalla regione (margine) vengono ritagliate', () => {
    const small = wasm.CrossSection.square([30, 30], true);
    const addition = reliefAddition(wasm, small, params)!;
    const box = addition.boundingBox();
    expect(box.max[0]).toBeLessThanOrEqual(15 + 1e-6);
    expect(box.min[0]).toBeGreaterThanOrEqual(-15 - 1e-6);
    [small, addition].forEach((m) => m.delete());
  });

  it('usare la funzione sbagliata dà errore', () => {
    expect(() => reliefCutter(wasm, region, params)).toThrow();
    expect(() => reliefAddition(wasm, region, reliefDefaults('brick'))).toThrow();
  });
});

describe('ancoraggio al rettangolo della faccia', () => {
  it('con `rect` il disegno non si sposta quando la regione si riduce (mattoni)', () => {
    const rect = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
    const small = wasm.CrossSection.square([40, 30], true);
    // Stesso rettangolo, regione piccola: il taglio coincide con quello della regione intera ristretto alla zona centrale
    const full = reliefCutter(wasm, region, reliefDefaults('brick'), { rect })!;
    const clipped = reliefCutter(wasm, small, reliefDefaults('brick'), { rect })!;
    const zone = wasm.Manifold.cube([40, 30, 10], true);
    const expected = full.intersect(zone);
    expect(clipped.volume()).toBeCloseTo(expected.volume(), 3);
    [small, full, clipped, zone, expected].forEach((m) => m.delete());
  });
});

describe('regione ridotta', () => {
  it('il taglio resta dentro la regione (cornice intatta)', () => {
    const inner = region.offset(-5, 'Miter', 2, 8);
    const cutter = reliefCutter(wasm, inner, reliefDefaults('rust'), { step: 0.8 })!;
    const box = cutter.boundingBox();
    expect(box.max[0]).toBeLessThanOrEqual(35 + 1e-6);
    expect(box.max[1]).toBeLessThanOrEqual(25 + 1e-6);
    [inner, cutter].forEach((m) => m.delete());
  });
});

describe('codice OpenSCAD', () => {
  const rect = { minX: -40, minY: -30, maxX: 40, maxY: 30 };

  it('il CSG dei mattoni è parametrico e brevissimo, la mappa di altezze scrive tutti i punti', () => {
    const csg = reliefScad(rect, reliefDefaults('brick'), 'csg');
    expect(csg).toContain('linear_extrude');
    expect(csg.length).toBeLessThan(1000);
    const map = reliefScad(rect, reliefDefaults('brick'), 'heightmap', 0.8);
    expect(map).toContain('polyhedron(pts, faces');
    // Una riga di zmap per ogni fila di punti: 60 mm a passo 0,8 mm danno 76 intervalli e 76 file
    expect(map.match(/^ +\[(?:[-\d.]+,){10,}/gm)?.length).toBe(Math.ceil(60 / 0.8) + 1);
    expect(map.length).toBeGreaterThan(20 * csg.length);
  });

  it('con lo stesso seme il codice è identico', () => {
    const p = reliefDefaults('hammered');
    expect(reliefScad(rect, p, 'csg')).toBe(reliefScad(rect, p, 'csg'));
    expect(reliefScad(rect, { ...p, seed: 2 } as ReliefParams, 'csg')).not.toBe(reliefScad(rect, p, 'csg'));
  });
});

// Genera gli STL di esempio di docs/studio-rilievo/ (pannelli 40 x 30 x 4 mm con la faccia su z = 0), solo a richiesta:
//   RELIEF_SAMPLES=1 npx vitest run src/kernel/relief.test.ts -t esempi
describe.skipIf(!process.env.RELIEF_SAMPLES)('esempi per il documento', () => {
  it.each(['brick', 'wood', 'rust', 'studs', 'hammered'] as ReliefKind[])('%s', (kind) => {
    mkdirSync('docs/studio-rilievo', { recursive: true });
    const face = wasm.CrossSection.square([40, 30], true);
    const base = wasm.Manifold.cube([40, 30, 4], true);
    const panelSolid = base.translate([0, 0, -2]);
    base.delete();
    const params = reliefDefaults(kind);
    const options = { engine: BEST_ENGINE[kind], step: 0.4 };
    const tool = kind === 'studs' ? reliefAddition(wasm, face, params, options)! : reliefCutter(wasm, face, params, options)!;
    const result = kind === 'studs' ? panelSolid.add(tool) : panelSolid.subtract(tool);
    const mesh = result.getMesh();
    writeFileSync(`docs/studio-rilievo/${kind}.stl`, writeStl(new Float32Array(mesh.vertProperties), new Uint32Array(mesh.triVerts)));
    [face, panelSolid, tool, result].forEach((m) => m.delete());
  });
});
