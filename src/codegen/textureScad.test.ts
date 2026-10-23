import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import sharp from 'sharp';
import { Window } from 'happy-dom';
import { meshScad, svgReliefScad, textureFaceScad, textureSurfaceScad } from './textureScad';
import { applyTextureFace, displaceSolid, svgReliefSolid } from '../kernel/textureMap';
import { clipToRegion, heightSolid, prism } from '../kernel/relief';
import { sampleGrid } from '../scene/relief';
import { heightRange, makeTextureHeight, normalizeTexture, textureDefaults } from '../scene/textureMap';
import { SAMPLE_SVG, makeSample } from '../scene/textureSamples';
import { svgContours } from '../scene/shapes2d';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const RECT = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
const img = makeSample('knurl', 128);
const PIECE = 'translate([-40, -30, -5]) cube([80, 60, 5]);';

describe('codice OpenSCAD delle texture da immagine', () => {
  it('motore F: zmap in centesimi interi e combinazione secondo il modo', () => {
    for (const mode of ['relief', 'groove', 'both'] as const) {
      const code = textureFaceScad(RECT, img, { ...textureDefaults(), tile: 10, mode }, 0.8, PIECE);
      expect(code).toContain('zmap = [');
      expect(code).toContain('polyhedron(pts, faces');
      expect(code).toContain(mode === 'groove' ? 'difference()' : 'union()');
      // quote intere: nessun decimale dentro zmap
      const zmap = code.slice(code.indexOf('zmap = ['), code.indexOf('];', code.indexOf('zmap = [')));
      expect(zmap).not.toMatch(/\d\.\d/);
    }
    // ampiezza zero: modulo vuoto
    expect(textureFaceScad(RECT, img, { amplitude: 0 }, 0.8)).toContain('module relief() {}');
  });

  it('modo entrambi con clip: la colonna tolta dal pezzo è ritagliata sulla regione', () => {
    const clip = 'translate([0, 0, -10]) cylinder(h = 20, r = 20, $fn = 96);';
    const code = textureFaceScad({ minX: -20, minY: -20, maxX: 20, maxY: 20 }, img, { ...textureDefaults(), mode: 'both' }, 0.8, PIECE, clip);
    expect(code).toContain('module relief() intersection() { relief_raw();');
    // la colonna da togliere è l'intersezione del cubo con il clip, dentro la difference del pezzo
    const after = code.slice(code.indexOf('difference() {'));
    expect(after).toContain('intersection() {');
    expect(after.indexOf('cube(')).toBeLessThan(after.indexOf('cylinder('));
    // senza clip la colonna è il solo cubo
    expect(textureFaceScad(RECT, img, { ...textureDefaults(), mode: 'both' }, 0.8, PIECE).split('intersection()').length).toBe(1);
    expect(textureSurfaceScad(RECT, img, textureDefaults(), 0.8, 'x.png', PIECE, clip).code).toContain('cylinder(h = 20, r = 20');
  });

  it('motore F con surface(): il PNG ha la griglia del kernel e la scala porta 0..100 in mm', () => {
    const { code, png, scaleZ } = textureSurfaceScad(RECT, img, { ...textureDefaults(), tile: 10, mode: 'relief' }, 0.5, 'tex.png', PIECE);
    expect(code).toContain('surface(file = "tex.png"');
    expect([png.w, png.h]).toEqual([163, 123]);
    expect(Math.max(...png.data)).toBeLessThanOrEqual(255);
    expect(scaleZ).toBeGreaterThan(0);
  });

  it('motore M: polyhedron con facce rovesciate (orarie)', () => {
    const code = meshScad([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
    expect(code).toContain('faces = [[0,2,1]]');
  });

  it('SVG vettoriale: poche centinaia di byte per tutta la faccia', () => {
    const code = svgReliefScad(RECT, { contours: [[[0, 0], [5, 0], [5, 5]]], pitch: [12, 12], height: 0.6, repeat: true });
    expect(code).toContain('polygon(points = svg_points');
    expect(code.length).toBeLessThan(2500);
  });
});

// Verifica con OpenSCAD (come relief.test.ts): scrive .scad, PNG e i volumi attesi del kernel in una cartella.
//   $env:TEXTURE_SCAD_DIR='C:\temp\texture'; npx vitest run src/codegen/textureScad.test.ts -t "verifica OpenSCAD"
//   node scripts/relief-openscad-check.mjs C:\temp\texture
describe.skipIf(!process.env.TEXTURE_SCAD_DIR)('file per la verifica OpenSCAD', { timeout: 300_000 }, () => {
  it('scrive i .scad, i PNG e i volumi attesi', async () => {
    const dir = process.env.TEXTURE_SCAD_DIR!;
    mkdirSync(dir, { recursive: true });
    const expected: Record<string, number> = {};
    const region = wasm.CrossSection.square([80, 60], true);
    const panel = () => wasm.Manifold.cube([80, 60, 5], true).translate([0, 0, -2.5]);
    const tex = { ...textureDefaults(), tile: 10, amplitude: 0.6 };

    // Motore F: zmap e surface() per i tre modi, passo 0,5 mm
    for (const mode of ['relief', 'groove', 'both'] as const) {
      const params = { ...tex, mode };
      expected[`F_zmap_${mode}`] = applyTextureFace(wasm, panel(), region, img, params, { step: 0.5 }).volume();
      writeFileSync(`${dir}/F_zmap_${mode}.scad`, textureFaceScad(RECT, img, params, 0.5, PIECE) + '\n');
      const s = textureSurfaceScad(RECT, img, params, 0.5, `F_surface_${mode}.png`, PIECE);
      // Volume atteso del file con surface(): la "pelle" del kernel sulla stessa griglia (stessa quota ovunque, senza le convenzioni di
      // FLOOR di rilievo e incavo). Cambiano solo la quantizzazione a 8 bit e la triangolazione (a ventaglio, con un nodo al centro di ogni cella)
      const h = makeTextureHeight(img, normalizeTexture(params));
      const [lo, hi] = heightRange(normalizeTexture(params));
      const skin = clipToRegion(wasm, heightSolid(wasm, sampleGrid(RECT, 0.5, h), lo - 0.6, 'below'), region, lo - 0.6, hi + 1);
      expected[`F_surface_${mode}`] = panel().subtract(prism(wasm, region, lo - 0.4, hi + 1)).add(skin!).volume();
      writeFileSync(`${dir}/F_surface_${mode}.scad`, s.code + '\n');
      await sharp(Buffer.from(s.png.data), { raw: { width: s.png.w, height: s.png.h, channels: 1 } }).png().toFile(`${dir}/F_surface_${mode}.png`);
    }

    // Motore F su un cilindro (regione circolare, ritaglio con un cilindro): il kernel usa la sezione appena sotto la faccia
    {
      const cylinder = wasm.Manifold.cylinder(20, 15, 15, 96, false).translate([0, 0, -20]);
      const circle = cylinder.slice(-0.01);
      const params = { ...tex, mode: 'both' as const };
      const bounds = circle.bounds();
      const rect = { minX: bounds.min[0], minY: bounds.min[1], maxX: bounds.max[0], maxY: bounds.max[1] };
      expected.F_cilindro_both = applyTextureFace(wasm, cylinder, circle, img, params, { step: 0.5 }).volume();
      writeFileSync(`${dir}/F_cilindro_both.scad`, textureFaceScad(rect, img, params, 0.5, 'translate([0, 0, -20]) cylinder(h = 20, r = 15, $fn = 96);', 'translate([0, 0, -10]) cylinder(h = 20, r = 15, $fn = 96);') + '\n');
    }

    // Regione circolare (r = 20) dentro il pannello 80 x 60, che resta più grande: il kernel ritaglia colonna e rilievo sulla regione, il codice OpenSCAD con `clip`
    {
      const circle = wasm.CrossSection.circle(20, 96);
      const bounds = circle.bounds();
      const rect = { minX: bounds.min[0], minY: bounds.min[1], maxX: bounds.max[0], maxY: bounds.max[1] };
      const clip = 'translate([0, 0, -10]) cylinder(h = 20, r = 20, $fn = 96);';
      for (const mode of ['both', 'relief', 'groove'] as const) {
        const params = { ...tex, mode };
        expected[`F_cerchio_${mode}`] = applyTextureFace(wasm, panel(), circle, img, params, { step: 0.5 }).volume();
        writeFileSync(`${dir}/F_cerchio_${mode}.scad`, textureFaceScad(rect, img, params, 0.5, PIECE, clip) + '\n');
      }
      // surface() con la stessa regione: il kernel ha la pelle (stessa quota ovunque) sulla stessa griglia
      const h = makeTextureHeight(img, normalizeTexture({ ...tex, mode: 'both' }));
      const [lo, hi] = heightRange(normalizeTexture({ ...tex, mode: 'both' }));
      const skin = clipToRegion(wasm, heightSolid(wasm, sampleGrid(rect, 0.5, h), lo - 0.6, 'below'), circle, lo - 0.6, hi + 1);
      expected.F_cerchio_surface_both = panel().subtract(prism(wasm, circle, lo - 0.4, hi + 1)).add(skin!).volume();
      const s = textureSurfaceScad(rect, img, { ...tex, mode: 'both' }, 0.5, 'F_cerchio_surface_both.png', PIECE, clip);
      writeFileSync(`${dir}/F_cerchio_surface_both.scad`, s.code + '\n');
      await sharp(Buffer.from(s.png.data), { raw: { width: s.png.w, height: s.png.h, channels: 1 } }).png().toFile(`${dir}/F_cerchio_surface_both.png`);
    }

    // Motore M: cubo, pannello e cilindro, normali medie con spigoli fermi, ampiezza 0,6 mm, lato 0,8 mm
    const solids: Record<string, () => ReturnType<typeof panel>> = {
      cubo: () => wasm.Manifold.cube([30, 30, 30], true),
      pannello: () => wasm.Manifold.cube([80, 60, 5], true),
      cilindro: () => wasm.Manifold.cylinder(40, 15, 15, 96, true),
    };
    for (const [name, make] of Object.entries(solids)) {
      const { solid } = displaceSolid(wasm, make(), img, { ...tex, mode: 'both' }, { kind: name === 'cilindro' ? 'cylindrical' : 'triplanar', radius: 15 }, { edge: 0.8, fadeSharp: true });
      const mesh = solid!.getMesh();
      // Il polyhedron ha le coordinate a tre decimali: il volume atteso è quello della mesh arrotondata allo stesso modo
      const pos = Array.from(mesh.vertProperties).map((v) => Math.round(v * 1000) / 1000);
      const rounded = new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: Float32Array.from(pos), triVerts: mesh.triVerts }));
      expected[`M_${name}`] = rounded.volume();
      writeFileSync(`${dir}/M_${name}.scad`, meshScad(mesh.vertProperties, mesh.triVerts) + '\n');
    }

    // SVG vettoriale: l'SVG di prova, 16 x 16 mm per piastrella con passo 20 mm, rilievo di 0,6 mm
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = new Window().DOMParser;
    const { parseSvg } = await import('../import/svg');
    const svg = parseSvg(SAMPLE_SVG, 'stemma');
    const contours = svgContours({ contours: svg.contours, width: 16, depth: 16 });
    for (const height of [0.6, -0.6]) {
      const opts = { contours, pitch: [20, 20] as [number, number], height, repeat: true };
      const tool = svgReliefSolid(wasm, region, opts, RECT)!;
      const result = height > 0 ? panel().add(tool) : panel().subtract(tool);
      expected[`SVG_${height > 0 ? 'rilievo' : 'incavo'}`] = result.volume();
      writeFileSync(`${dir}/SVG_${height > 0 ? 'rilievo' : 'incavo'}.scad`, `${svgReliefScad(RECT, opts)}\n${height > 0 ? 'union' : 'difference'}() {\n  ${PIECE}\n  relief();\n}\n`);
    }
    writeFileSync(`${dir}/expected.json`, JSON.stringify(expected, null, 1));
  });
});
