import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { BEST_ENGINE, heightSolid, reliefAddition, reliefCutter, studsInRegion } from './relief';
import type { ReliefEngine } from './relief';
import { writeStl } from './export/stl';
import { reliefScad } from '../codegen/reliefScad';
import { reliefDefaults, rustDepth, rustMaxDepth, sampleGrid, studCenters } from '../scene/relief';
import type { ReliefKind, ReliefParams, RustParams, StudParams } from '../scene/relief';

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
    const solid = heightSolid(wasm, grid, -1, 'below');
    expect(solid.status()).toBe('NoError');
    // Altezza tra il piano (-1) e la superficie (0,5) = 1,5 mm su 10 × 5 mm
    expect(solid.volume()).toBeCloseTo(10 * 5 * 1.5, 3);
    solid.delete();
  });

  it('con il materiale sopra la superficie il solido è valido e di volume positivo', () => {
    const grid = sampleGrid({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 0.5, (x, y) => 0.1 * Math.sin(x) * Math.cos(y));
    const solid = heightSolid(wasm, grid, 2, 'above');
    expect(solid.status()).toBe('NoError');
    expect(solid.volume()).toBeGreaterThan(10 * 5 * 1.8);
    solid.delete();
  });

  it.each([0.8, 0.5])("superficie rugosa a passo %s: pareti verso l'esterno, nessun triangolo degenere, volume pari all'integrale", (step) => {
    const rect = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
    const grid = sampleGrid(rect, step, rustDepth(rect, reliefDefaults('rust') as RustParams));
    for (const [side, planeZ] of [['below', -2], ['above', 3]] as const) {
      const solid = heightSolid(wasm, grid, planeZ, side);
      expect(solid.status()).toBe('NoError');
      // Volume atteso: integrale della superficie lineare a tratti (area x quota media dei tre vertici) rispetto al piano
      let expected = 0;
      const h = (i: number, j: number) => grid.z[j * grid.nx + i];
      for (let j = 0; j < grid.ny - 1; j++) {
        for (let i = 0; i < grid.nx - 1; i++) {
          const area = (grid.dx * grid.dy) / 2;
          expected += area * ((h(i, j) + h(i + 1, j) + h(i + 1, j + 1)) / 3 + (h(i, j) + h(i + 1, j + 1) + h(i, j + 1)) / 3);
        }
      }
      expected = side === 'below' ? expected - planeZ * 80 * 60 : planeZ * 80 * 60 - expected;
      expect(solid.volume()).toBeCloseTo(expected, 1);
      // Ogni triangolo ha area non nulla e quelli su un lato verticale hanno la normale verso l'esterno
      const mesh = solid.getMesh();
      const pos = (v: number) => [mesh.vertProperties[v * mesh.numProp], mesh.vertProperties[v * mesh.numProp + 1], mesh.vertProperties[v * mesh.numProp + 2]];
      const x1 = grid.x0 + (grid.nx - 1) * grid.dx;
      const y1 = grid.y0 + (grid.ny - 1) * grid.dy;
      for (let t = 0; t < mesh.triVerts.length; t += 3) {
        const [a, b, c] = [pos(mesh.triVerts[t]), pos(mesh.triVerts[t + 1]), pos(mesh.triVerts[t + 2])];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        expect(Math.hypot(...n)).toBeGreaterThan(1e-9);
        const on = (axis: number, value: number) => [a, b, c].every((q) => Math.abs(q[axis] - value) < 1e-3);
        if (on(0, grid.x0)) expect(n[0]).toBeLessThan(0);
        if (on(0, x1)) expect(n[0]).toBeGreaterThan(0);
        if (on(1, grid.y0)) expect(n[1]).toBeLessThan(0);
        if (on(1, y1)) expect(n[1]).toBeGreaterThan(0);
      }
      solid.delete();
    }
  });
});

describe('regione vuota e parametri estremi', () => {
  it.each(['brick', 'wood', 'rust', 'hammered', 'studs'] as ReliefKind[])('%s: regione vuota, nessun solido e nessun blocco', (kind) => {
    const square = wasm.CrossSection.square([20, 20], true);
    const empty = square.subtract(square);
    const params = reliefDefaults(kind);
    const engines: ReliefEngine[] = kind === 'wood' ? ['csg', 'heightmap', 'hybrid'] : ['csg', 'heightmap'];
    for (const engine of engines) {
      const result = kind === 'studs' ? reliefAddition(wasm, empty, params, { engine }) : reliefCutter(wasm, empty, params, { engine });
      expect(result).toBeNull();
    }
    [square, empty].forEach((m) => m.delete());
  });

  it.each(['brick', 'wood', 'hammered', 'rust'] as const)('%s con misure a zero: i cicli finiscono (valgono i minimi) e il solido resta valido', (kind) => {
    const bad = { brickW: 0, brickH: 0, mortar: 0, depth: 0, plankW: 0, plankL: 0, gap: 0, gapDepth: 0, size: 0, baseDepth: 0, craterDensity: 1e9 };
    const cutter = reliefCutter(wasm, region, { ...reliefDefaults(kind), ...bad } as ReliefParams, { step: 0.8 })!;
    expect(cutter.status()).toBe('NoError');
    cutter.delete();
  }, 60_000);

  it('borchie con passo e raggio a zero: valgono i minimi e il solido resta valido', () => {
    const studs = reliefAddition(wasm, region, { ...reliefDefaults('studs'), pitch: 0, radius: 0, height: 0 } as ReliefParams)!;
    expect(studs.status()).toBe('NoError');
    studs.delete();
  });

  it("il motore 'hybrid' esiste solo per il legno: per le altre texture è un errore chiaro", () => {
    expect(() => reliefCutter(wasm, region, reliefDefaults('brick'), { engine: 'hybrid' })).toThrow(/hybrid/);
    expect(() => reliefAddition(wasm, region, reliefDefaults('studs'), { engine: 'hybrid' })).toThrow(/hybrid/);
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

  it('le borchie non intere nella regione (margine) vengono scartate, mai tagliate a metà', () => {
    const rect = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
    // Regione ridotta di un margine di 5 mm: restano le borchie la cui base sta tutta nella regione
    const inner = region.offset(-5, 'Miter', 2, 8);
    const kept = studsInRegion(inner, rect, params as StudParams);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(studCenters(rect, params as StudParams).length);
    for (const [x, y] of kept) {
      expect(Math.abs(x) + 2.5).toBeLessThanOrEqual(35 + 1e-6);
      expect(Math.abs(y) + 2.5).toBeLessThanOrEqual(25 + 1e-6);
    }
    const addition = reliefAddition(wasm, inner, params, { rect })!;
    const box = addition.boundingBox();
    expect(box.max[0]).toBeLessThanOrEqual(35 + 1e-6);
    expect(box.min[0]).toBeGreaterThanOrEqual(-35 - 1e-6);
    expect(box.max[1]).toBeLessThanOrEqual(25 + 1e-6);
    // Ogni borchia rimasta è intera: il volume è un multiplo di quello della singola borchia
    const single = reliefAddition(wasm, wasm.CrossSection.square([6, 6], true), params)!;
    expect(addition.volume()).toBeCloseTo(single.volume() * kept.length, 1);
    [inner, addition, single].forEach((m) => m.delete());
  });

  it('con la faccia rettangolare senza margine le borchie sono tutte quelle della griglia (kernel e OpenSCAD coincidono)', () => {
    const rect = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
    expect(studsInRegion(region, rect, params as StudParams)).toEqual(studCenters(rect, params as StudParams));
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

describe('ruggine con ruvidità alta', () => {
  it('il prisma di ritaglio comprende tutta la profondità possibile (grana fine compresa): il fondo non si appiattisce', () => {
    const params = { ...(reliefDefaults('rust') as RustParams), roughness: 8 };
    // Il vecchio limite (base + ruvidità + cratere + 1 mm) non basta più: la grana fine da sola vale 0,4 volte la ruvidità
    expect(rustMaxDepth(params)).toBeGreaterThan(params.baseDepth + params.roughness + params.craterDepth + 1);
    const rect = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
    const depth = rustDepth(rect, params);
    const grid = sampleGrid(rect, 0.8, (x, y) => 0.02 - depth(x, y));
    // Nessun campione scende sotto il limite e il taglio arriva esattamente fino al punto più profondo
    expect(Math.min(...grid.z)).toBeGreaterThanOrEqual(0.02 - rustMaxDepth(params));
    const cutter = reliefCutter(wasm, region, params, { engine: 'heightmap', step: 0.8 })!;
    expect(cutter.boundingBox().min[2]).toBeCloseTo(Math.min(...grid.z), 2);
    cutter.delete();
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

  it('le quote della mappa sono centesimi interi e il polyhedron usa le pareti verticali', () => {
    const map = reliefScad(rect, reliefDefaults('rust'), 'heightmap', 0.8);
    expect(map).toMatch(/zmap = \[\n\s+\[-?\d+,/);
    expect(map).toContain('zmap[j][i] / 100');
    expect(map).toContain('per = concat(');
  });

  it('borchie: griglia centrata con due cicli, elenco dei centri se scelti dal chiamante, nessun errore senza borchie', () => {
    const studs = reliefDefaults('studs');
    expect(reliefScad(rect, studs, 'csg')).toMatch(/for \(i = \[0 : 6\], j = \[0 : 4\]\)/);
    expect(reliefScad(rect, studs, 'csg', 0.5, [[0, 0], [12, 0]])).toContain('studs = [');
    const none = { minX: 0, minY: 0, maxX: 3, maxY: 3 };
    expect(reliefScad(none, studs, 'csg')).toContain('module relief() {}');
    expect(reliefScad(none, studs, 'heightmap')).toContain('module relief() {}');
  });

  it("il motore 'hybrid' per una texture diversa dal legno è un errore", () => {
    expect(() => reliefScad(rect, reliefDefaults('rust'), 'hybrid')).toThrow(/hybrid/);
  });

  it("quando il passo non divide il lato l'ultimo nodo della mappa cade esattamente sul bordo (nessuna lamella)", () => {
    const code = reliefScad(rect, reliefDefaults('rust'), 'heightmap', 0.7);
    const value = (name: string) => Number(new RegExp(`${name} = ([-\\d.e]+);`).exec(code)![1]);
    // x0 + (nx - 1) * dx = bordo destro; y0 + (ny - 1) * dy = bordo alto (coordinate scritte con la precisione piena)
    expect(value('x0') + (value('nx') - 1) * value('dx')).toBeCloseTo(rect.maxX, 10);
    expect(value('y0') + (value('ny') - 1) * value('dy')).toBeCloseTo(rect.maxY, 10);
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

// Scrive nella cartella data i file .scad dei casi (motore e texture) e i volumi attesi del kernel (expected.json), per la
// verifica con OpenSCAD (`node scripts/relief-openscad-check.mjs <cartella>`), solo a richiesta:
//   $env:RELIEF_SCAD_DIR='C:\temp\relief'; npx vitest run src/kernel/relief.test.ts -t "verifica OpenSCAD"
describe.skipIf(!process.env.RELIEF_SCAD_DIR)('file per la verifica OpenSCAD', () => {
  it('scrive i .scad e i volumi attesi', () => {
    const dir = process.env.RELIEF_SCAD_DIR!;
    mkdirSync(dir, { recursive: true });
    const rect = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
    // L'ultimo valore è il passo della mappa (0,5 se manca); 0,7 non divide i lati: prova l'aggancio dell'ultimo nodo al bordo
    const cases: [ReliefKind, ReliefEngine, number?][] = [
      ['brick', 'csg'], ['brick', 'heightmap'], ['wood', 'csg'], ['wood', 'hybrid'], ['wood', 'heightmap'],
      ['rust', 'csg'], ['rust', 'heightmap'], ['hammered', 'csg'], ['hammered', 'heightmap'], ['studs', 'csg'], ['studs', 'heightmap'],
      ['rust', 'heightmap', 0.7], ['studs', 'heightmap', 0.7],
    ];
    const expected: Record<string, number> = {};
    for (const [kind, engine, step = 0.5] of cases) {
      const name = step === 0.5 ? `${kind}_${engine}` : `${kind}_${engine}_${step}`;
      const params = reliefDefaults(kind);
      const additive = kind === 'studs';
      const base = wasm.Manifold.cube([80, 60, 5], true);
      const panelSolid = base.translate([0, 0, -2.5]);
      base.delete();
      const tool = additive ? reliefAddition(wasm, region, params, { engine, step })! : reliefCutter(wasm, region, params, { engine, step })!;
      const result = additive ? panelSolid.add(tool) : panelSolid.subtract(tool);
      expected[name] = result.volume();
      // Il pezzo in OpenSCAD è lo stesso pannello (faccia su z = 0), poi unione (borchie) o differenza
      const scad = `${reliefScad(rect, params, engine, step)}\n${additive ? 'union' : 'difference'}() {\n  translate([-40, -30, -5]) cube([80, 60, 5]);\n  relief();\n}\n`;
      writeFileSync(`${dir}/${name}.scad`, scad);
      [panelSolid, tool, result].forEach((m) => m.delete());
    }
    writeFileSync(`${dir}/expected.json`, JSON.stringify(expected, null, 1));
  });
});
