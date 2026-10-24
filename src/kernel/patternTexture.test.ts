import { beforeAll, describe, expect, it, vi } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { buildPattern } from './pattern';
import { heightSolid } from './relief';
import { faceSurface } from './textureMap';
import { sceneToOpenScad } from '../codegen/openscad';
import { addImage } from '../import/assets';
import { primitiveDefaults } from '../scene/defaults';
import { defaultPatternParams, faceFromBounds, frameRect, normalizePattern, textureOf, thicknessAlong } from '../scene/pattern';
import { sampleGrid } from '../scene/relief';
import { imageOf, sampleImage } from '../scene/textureImage';
import { makeTextureHeight } from '../scene/textureMap';
import type { GrayImage, TextureMode, TextureParams } from '../scene/textureMap';
import type { HeightGrid } from '../scene/relief';
import type { GroupNode, PatternParams, PrimitiveNode, Scene, Vec3 } from '../scene/types';

// Calcoli con mappe di altezze: sotto carico i 5 s predefiniti non bastano
vi.setConfig({ testTimeout: 60_000 });

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const SIZE: Vec3 = [80, 60, 5];
const bounds = { min: SIZE.map((v) => -v / 2) as Vec3, max: SIZE.map((v) => v / 2) as Vec3 };
const FULL = 80 * 60 * 5;

/** Texture di prova: waves, liscia, per confrontare il kernel con l'integrale della funzione di quota. */
const base: TextureParams = { tile: 20, repeat: true, rotation: 0, offset: [0, 0], invert: false, midlevel: 0.5, amplitude: 0.6, blur: 0, mode: 'groove' };

/** Pannello 80 × 60 × 5 dentro un gruppo Pattern Immagine. */
function scene(patch: Partial<PatternParams>, texture: Partial<TextureParams> = {}, size: Vec3 = SIZE): Scene {
  const cube = { ...primitiveDefaults('box'), id: 'c', name: 'Pannello', position: [0, 0, 0], size } as PrimitiveNode;
  const b = { min: size.map((v) => -v / 2) as Vec3, max: size.map((v) => v / 2) as Vec3 };
  const g: GroupNode = {
    id: 'g', name: 'Immagine', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
    pattern: { ...defaultPatternParams(b, 7), kind: 'texture', margin: 0, sample: 'waves', texture: { ...base, ...texture }, ...patch },
  };
  return { nodes: { c: cube, g }, rootIds: ['g'] };
}
const patternOf = (s: Scene) => (s.nodes.g as GroupNode).pattern as PatternParams;
const run = (s: Scene, ev = new Evaluator(wasm)) => ev.evaluate(s).meshes[0];

/** Integrale numerico di una funzione della quota sulla faccia 80 × 60 (passo 0,25 mm). */
function integral(s: Scene, f: (h: number) => number, image?: GrayImage): number {
  const p = normalizePattern(patternOf(s));
  const h = makeTextureHeight(image ?? imageOf(p)!, textureOf(p));
  const step = 0.25;
  let sum = 0;
  for (let x = -40 + step / 2; x < 40; x += step) for (let y = -30 + step / 2; y < 30; y += step) sum += f(h(x, y));
  return sum * step * step;
}

describe('Pattern Immagine nel kernel', () => {
  it('incavo: toglie il volume atteso (quota meno FLOOR) e il pezzo resta un solo solido valido', () => {
    const s = scene({});
    const m = run(s);
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeLessThan(FULL);
    expect(m.bbox.max[2]).toBeCloseTo(2.5, 3);
    // La mappa taglia FLOOR (0,02 mm) meno della profondità, e niente dove questa sta sotto FLOOR
    const expected = integral(s, (h) => Math.max(0, -h - 0.02));
    expect((FULL - m.volume) / expected).toBeGreaterThan(0.97);
    expect((FULL - m.volume) / expected).toBeLessThan(1.03);
    const piece = wasm.Manifold.cube(SIZE, true);
    const result = buildPattern(wasm, piece, normalizePattern(patternOf(s)));
    expect(result.decompose().length).toBe(1);
    [piece, result].forEach((x) => x.delete());
  });

  it('rilievo: il solido cresce dell\'ampiezza e il volume aggiunto è l\'integrale della quota', () => {
    const s = scene({}, { mode: 'relief' });
    const m = run(s);
    expect(m.status).toBe('NoError');
    expect(m.volume).toBeGreaterThan(FULL);
    expect(m.bbox.max[2]).toBeCloseTo(2.5 + 0.6, 1);
    expect(m.bbox.min[2]).toBeCloseTo(-2.5, 3);
    const expected = integral(s, (h) => (h >= 0.02 ? h : 0));
    expect((m.volume - FULL) / expected).toBeGreaterThan(0.97);
    expect((m.volume - FULL) / expected).toBeLessThan(1.03);
  });

  it('entrambi: si scava e si aggiunge attorno al livello medio, il volume cambia della quota con segno', () => {
    const s = scene({}, { mode: 'both' });
    const m = run(s);
    expect(m.status).toBe('NoError');
    expect(m.bbox.max[2]).toBeGreaterThan(2.5);
    const signed = integral(s, (h) => h);
    expect(m.volume - FULL).toBeCloseTo(signed, -0.5);
    expect(Math.abs(m.volume - FULL - signed)).toBeLessThan(0.03 * Math.abs(integral(s, (h) => Math.abs(h))));
  });

  it('immagine caricata: i pixel scuri scavano, i chiari restano; senza registrazione il pezzo resta com\'è, con la registrazione cambia (cache)', async () => {
    // Scacchiera 8 × 8: metà dei pixel neri (incavo), metà bianchi (a livello)
    const checker: GrayImage = { w: 8, h: 8, data: Uint8Array.from({ length: 64 }, (_, i) => (((i % 8) + (i >> 3)) % 2 ? 255 : 0)) };
    const asset = await addImage(checker);
    const s = scene({ imageId: asset.id, sample: undefined }, { tile: 16, amplitude: 1, midlevel: 0.5 });
    const ev = new Evaluator(wasm);
    expect(run(s, ev).volume).toBeCloseTo(FULL, 3);
    ev.registerImage(asset.id, { w: checker.w, h: checker.h, data: checker.data });
    const m = run(s, ev);
    expect(m.status).toBe('NoError');
    // Come l'integrale della quota dell'immagine (interpolazione bilineare tra i pixel: i bordi neri e bianchi sfumano)
    const expected = integral(s, (h) => Math.max(0, -h - 0.02), checker);
    expect(expected).toBeGreaterThan(300);
    expect((FULL - m.volume) / expected).toBeGreaterThan(0.95);
    expect((FULL - m.volume) / expected).toBeLessThan(1.05);
  });

  it('inversione, scostamento e ripetizione cambiano il risultato; il margine lascia la cornice intatta', () => {
    const plain = run(scene({}));
    // 'waves' è simmetrica rispetto al livello medio: per l'inversione serve una texture che non lo sia
    expect(run(scene({ sample: 'bricks' }, { invert: true })).volume).not.toBeCloseTo(run(scene({ sample: 'bricks' })).volume, 2);
    // Con la ripetizione lo scostamento di una piastrella intera non cambia il volume: senza, sposta l'immagine unica fuori dal centro
    expect(run(scene({}, { repeat: false, offset: [30, 20] })).volume).not.toBeCloseTo(run(scene({}, { repeat: false })).volume, 2);
    // Senza ripetizione l'immagine compare una volta sola (piastrella di 20 mm su una faccia di 80 × 60)
    expect(FULL - run(scene({}, { repeat: false })).volume).toBeLessThan(0.2 * (FULL - plain.volume));
    const framed = run(scene({ margin: 10 }));
    expect(framed.status).toBe('NoError');
    expect(framed.volume).toBeGreaterThan(plain.volume);
    expect(run(scene({ margin: 100 })).volume).toBeCloseTo(FULL, 3);
  });

  it('ampiezza 0 o livello medio agli estremi: nessun cambiamento e nessun errore', () => {
    expect(run(scene({}, { amplitude: 0 })).volume).toBeCloseTo(FULL, 3);
    expect(run(scene({}, { mode: 'relief', midlevel: 1 })).volume).toBeCloseTo(FULL, 3);
    expect(run(scene({}, { mode: 'groove', midlevel: 0 })).volume).toBeCloseTo(FULL, 3);
  });

  it('più facce (cima e fondo): una texture per faccia', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    const one = run(scene({}));
    const two = run(scene({ faces }));
    expect(two.status).toBe('NoError');
    expect(FULL - two.volume).toBeGreaterThan(1.8 * (FULL - one.volume));
    const relief = run(scene({ faces }, { mode: 'relief' }));
    expect(relief.bbox.min[2]).toBeLessThan(-2.5 - 0.3);
    expect(relief.bbox.max[2]).toBeGreaterThan(2.5 + 0.3);
  });

  it('anteprima semplificata: volume vicino a quello finale', () => {
    for (const mode of ['groove', 'relief', 'both'] as TextureMode[]) {
      const full = run(scene({}, { mode }));
      const preview = run(scene({ preview: true }, { mode }));
      expect(preview.status).toBe('NoError');
      expect(Math.abs(preview.volume - full.volume)).toBeLessThan(0.15 * Math.abs(full.volume - FULL) + 1);
    }
  });

  it('depth e sides del Pattern non contano; è deterministico', () => {
    expect(run(scene({ depth: 2, sides: 'both' })).volume).toBeCloseTo(run(scene({})).volume, 6);
    expect(run(scene({})).volume).toBe(run(scene({})).volume);
  });

  it('profondità limitata come gli altri rilievi: un incavo enorme su un pannello di 2 mm non lo attraversa', () => {
    const thin: Vec3 = [80, 60, 2];
    const tb = { min: thin.map((v) => -v / 2) as Vec3, max: thin.map((v) => v / 2) as Vec3 };
    const piece = wasm.Manifold.cube(thin, true);
    for (const mode of ['groove', 'both'] as TextureMode[]) {
      const params = normalizePattern({ ...defaultPatternParams(tb, 7), kind: 'texture', margin: 0, sample: 'noise', faces: [faceFromBounds(tb, 'z+'), faceFromBounds(tb, 'z-')], texture: { ...base, mode, amplitude: 20, tile: 10 } });
      const result = buildPattern(wasm, piece, params);
      const middle = result.slice(0);
      expect(middle.area()).toBeCloseTo(4800, 3);
      middle.delete();
      result.delete();
    }
    piece.delete();
  });
});

describe('Pattern Immagine: «entrambi» su una faccia sola', () => {
  it("su un pannello di 2 mm la pelle non esce dalla faccia opposta (il piano di base sta 0,4 mm sotto l'incavo più profondo)", () => {
    const thin: Vec3 = [80, 60, 2];
    const tb = { min: thin.map((v) => -v / 2) as Vec3, max: thin.map((v) => v / 2) as Vec3 };
    const piece = wasm.Manifold.cube(thin, true);
    for (const midlevel of [0.5, 0.2, 0.9]) {
      const params = normalizePattern({ ...defaultPatternParams(tb, 7), kind: 'texture', margin: 0, sample: 'noise', faces: [faceFromBounds(tb, 'z+')], texture: { ...base, mode: 'both', amplitude: 20, tile: 10, midlevel } });
      const result = buildPattern(wasm, piece, params);
      expect(result.status()).toBe('NoError');
      // L'ingombro in basso resta quello del pannello e vicino al fondo il taglio ha l'area intera
      expect(result.boundingBox().min[2]).toBeCloseTo(-1, 3);
      const nearBottom = result.slice(-0.95);
      expect(nearBottom.area()).toBeCloseTo(4800, 3);
      nearBottom.delete();
      result.delete();
    }
    piece.delete();
  });
});

describe('Pattern Immagine su una faccia inclinata', () => {
  const pyramid = (patch: Partial<PatternParams>, texture: Partial<TextureParams> = {}): Scene => {
    const cone = { ...primitiveDefaults('cone'), id: 'c', name: 'Piramide', position: [0, 0, 0], radiusBottom: 20, radiusTop: 0, height: 20, segments: 4 } as PrimitiveNode;
    const pb = { min: [-20, -20, -10] as Vec3, max: [20, 20, 10] as Vec3 };
    const normal: Vec3 = [1, 1, 1].map((v) => v / Math.sqrt(3)) as Vec3;
    const face = { origin: [10 / 3, 10 / 3, 10 / 3] as Vec3, normal, thickness: thicknessAlong(pb, normal) };
    const g: GroupNode = {
      id: 'g', name: 'Immagine', type: 'group', op: 'pattern', children: ['c'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff',
      pattern: { ...defaultPatternParams(pb, 7), kind: 'texture', margin: 0, faces: [face], sample: 'waves', texture: { ...base, ...texture }, ...patch },
    };
    return { nodes: { c: cone, g }, rootIds: ['g'] };
  };
  const PYRAMID = (800 * 20) / 3;
  const FACE_AREA = 0.5 * Math.hypot(400, 400, 400);

  it.each(['groove', 'relief', 'both'] as TextureMode[])('%s: il rilievo sta dentro la faccia e la sagoma non cambia oltre l\'ampiezza', (mode) => {
    const m = run(pyramid({}, { mode, amplitude: 0.5 }));
    expect(m.status).toBe('NoError');
    const delta = m.volume - PYRAMID;
    if (mode === 'groove') expect(delta).toBeLessThan(0);
    if (mode === 'relief') expect(delta).toBeGreaterThan(0);
    expect(Math.abs(delta)).toBeLessThan(FACE_AREA * 0.5 * 1.1);
    expect(m.bbox.min[0]).toBeCloseTo(-20, 2);
  });

  it('il codice OpenSCAD della faccia inclinata ruota nel riferimento della faccia', () => {
    const code = sceneToOpenScad(pyramid({}), { images: () => undefined });
    expect(code).toContain('projection(cut = true)');
    expect(code).not.toContain('rotate([0, 0, 0]) intersection()');
  });
});

describe('Pattern Immagine nel codice OpenSCAD', () => {
  const mapOf = (code: string, id = ''): HeightGrid => {
    const num = (name: string) => Number(new RegExp(`${name}${id} = (-?[\\d.e-]+);`).exec(code)![1]);
    const list = new RegExp(`zmap${id} = \\[\\n([\\s\\S]*?)\\n\\s*\\];`).exec(code)![1].trim().split('\n');
    const rows = list.map((line) => (line.match(/-?\d+/g) ?? []).map(Number));
    const nx = num('nx');
    const ny = num('ny');
    expect([rows.length, rows[0].length]).toEqual([ny, nx]);
    const z = new Float32Array(nx * ny);
    rows.forEach((row, j) => row.forEach((v, i) => (z[j * nx + i] = v / 100)));
    return { nx, ny, x0: num('x0'), y0: num('y0'), dx: num('dx'), dy: num('dy'), z };
  };

  it('nessun module né function; incavo: difference() con la mappa ritagliata sulla regione', () => {
    const code = sceneToOpenScad(scene({}));
    expect(code).not.toMatch(/\bmodule\s+\w+\s*\(/);
    expect(code).not.toMatch(/\bfunction\s+\w+\s*\(/);
    expect(code).toContain('difference() {');
    expect(code).not.toContain('union() {');
    expect(code).toContain('zmap = [');
    expect(code).toContain('polyhedron(pts, faces, convexity = 10);');
    expect(code).toContain('intersection() {');
    expect(code).toContain('projection(cut = true)');
  });

  it('rilievo: union() con la pelle; entrambi: union() di una difference() che toglie la colonna e della pelle', () => {
    const relief = sceneToOpenScad(scene({}, { mode: 'relief' }));
    expect(relief).toContain('union() {');
    expect(relief).not.toContain('difference() {');
    const both = sceneToOpenScad(scene({}, { mode: 'both' }));
    expect(both).toContain('union() {');
    expect(both).toContain('difference() {');
    // La colonna è il solo prisma della regione (nessuna mappa), la pelle un'intersezione con la mappa
    expect(both.match(/intersection\(\) \{/g)).toHaveLength(1);
    expect(both.match(/linear_extrude\(height = /g)).toHaveLength(2);
  });

  it('la mappa del codice è la griglia del kernel: stessi nodi e stesse quote, stesso volume del solido entro 0,01 mm³', () => {
    for (const mode of ['groove', 'relief', 'both'] as TextureMode[]) {
      const s = scene({}, { mode });
      const p = normalizePattern(patternOf(s));
      const surface = faceSurface(sampleImage('waves'), textureOf(p), frameRect(p, p.faces[0]), 0.5, 0.2)!;
      const parsed = mapOf(sceneToOpenScad(s));
      expect([parsed.nx, parsed.ny]).toEqual([surface.grid.nx, surface.grid.ny]);
      parsed.z.forEach((v, k) => expect(v).toBeCloseTo(surface.grid.z[k], 6));
      expect(parsed.x0).toBeCloseTo(surface.grid.x0, 9);
      expect(parsed.dx).toBeCloseTo(surface.grid.dx, 9);
      const fromText = heightSolid(wasm, parsed, surface.planeZ, surface.side);
      const fromKernel = heightSolid(wasm, surface.grid, surface.planeZ, surface.side);
      expect(Math.abs(fromText.volume() - fromKernel.volume())).toBeLessThan(0.01);
      [fromText, fromKernel].forEach((x) => x.delete());
    }
    // La griglia di sampleGrid è quella stessa funzione: stesso passo
    const rect = { minX: -41, maxX: 41, minY: -31, maxY: 31 };
    expect(sampleGrid(rect, 0.5, () => 0).nx).toBe(165);
  });

  it('con più facce i dati hanno nomi distinti; senza l\'immagine esce un commento e nessuna mappa', async () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    const code = sceneToOpenScad(scene({ faces }, { mode: 'relief' }));
    for (const name of ['zmap_1 = [', 'zmap_2 = [', 'polyhedron(pts_1, faces_1', 'polyhedron(pts_2, faces_2']) expect(code).toContain(name);
    expect(code.match(/intersection\(\) \{/g)).toHaveLength(2);
    // Immagine caricata non registrata: nessun pixel, nessuna mappa
    const missing = sceneToOpenScad(scene({ imageId: 'img-0000000000000000', sample: undefined }), { images: () => undefined });
    expect(missing).toContain('// Immagine non disponibile');
    expect(missing).not.toContain('zmap');
    // Registrata nel registro del thread principale (funzione di ricerca di partenza)
    const asset = await addImage({ w: 4, h: 4, data: Uint8Array.from({ length: 16 }, (_, i) => (i % 2 ? 0 : 255)) });
    const found = sceneToOpenScad(scene({ imageId: asset.id, sample: undefined }, { tile: 8 }));
    expect(found).toContain('zmap = [');
  });

  it('i Mattoni, le Borchie, il Rame, il Legno e i tipi a celle non cambiano', () => {
    expect(sceneToOpenScad(scene({ kind: 'brick' }))).toContain('for (r = [0 :');
    expect(sceneToOpenScad(scene({ kind: 'studs' }))).toContain('union() {');
    expect(sceneToOpenScad(scene({ kind: 'hammered' }))).toContain('dents = [');
    expect(sceneToOpenScad(scene({ kind: 'wood' }))).toContain('planks = [');
    expect(sceneToOpenScad(scene({ kind: 'hexagon', size: 20, rounding: 0 }))).toContain('cells = [');
  });
});
