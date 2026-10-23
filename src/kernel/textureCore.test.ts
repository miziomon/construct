import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { applyTextureFace, displaceSolid, faceSurface } from './textureMap';
import { writeStl } from './export/stl';
import { meshScad, textureFaceScad, textureSurfaceScad } from '../codegen/textureScad';
import { makeDisplacement, makeTextureHeight, resizeGray, rgbaToGray, blurGray } from '../scene/textureMap';
import { makeSample } from '../scene/textureSamples';
import type { SampleKind } from '../scene/textureSamples';

/**
 * Le funzioni del prototipo docs/prototipi/texture-immagine.html (blocco CORE) sono quelle dei sorgenti TypeScript: il blocco si
 * estrae dall'HTML, si esegue in Node e si confrontano i risultati con quelli delle funzioni TypeScript, bit per bit.
 */
const html = readFileSync(resolve('docs/prototipi/texture-immagine.html'), 'utf8').replace(/\r\n/g, '\n');
const core = html.slice(html.indexOf('\n', html.indexOf('/* CORE-BEGIN')) + 1, html.indexOf('/* CORE-END */'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = Record<string, any>;
const api = new Function(
  `${core}\nreturn { makeSample, rgbaToGray, resizeGray, blurGray, makeTextureHeight, makeDisplacement, applyTextureFace, displaceSolid, textureFaceScad, textureSurfaceScad, meshScad, writeStl, faceSurface };`,
)() as Api;

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const KINDS: SampleKind[] = ['knurl', 'carbon', 'leather', 'bricks', 'waves', 'noise'];
const TEX = { tile: 12, repeat: true, rotation: 17, offset: [1.5, -2] as [number, number], invert: true, midlevel: 0.4, amplitude: 0.7, blur: 1, mode: 'both' as const };
const RECT = { minX: -40, minY: -30, maxX: 40, maxY: 30 };

describe('blocco CORE del prototipo', () => {
  it("è aggiornato rispetto ai sorgenti (node scripts/texture-core.mjs write)", async () => {
    const script = (await import(/* @vite-ignore */ pathToFileURL(resolve('scripts/texture-core.mjs')).href)) as { buildCore: () => Promise<string> };
    const fresh = await script.buildCore();
    expect(core.trim()).toBe(fresh.trim());
  });

  it('texture di esempio, conversione a grigio, riduzione e sfocatura: stessi byte', () => {
    for (const kind of KINDS) expect(api.makeSample(kind, 64).data).toEqual(makeSample(kind, 64).data);
    const rgba = Uint8Array.from({ length: 4 * 100 }, (_, k) => (k * 37) % 256);
    expect(api.rgbaToGray(rgba, 10, 10).data).toEqual(rgbaToGray(rgba, 10, 10).data);
    const img = makeSample('leather', 64);
    expect(api.resizeGray(img, 30).data).toEqual(resizeGray(img, 30).data);
    expect(api.blurGray(img, 2, true).data).toEqual(blurGray(img, 2, true).data);
  });

  it('quota e spostamento: stessi valori per ogni proiezione', () => {
    const img = makeSample('carbon', 64);
    const h1 = api.makeTextureHeight(img, TEX);
    const h2 = makeTextureHeight(img, TEX);
    for (let k = 0; k < 200; k++) expect(h1(k * 0.37 - 20, k * 0.19 - 10)).toBe(h2(k * 0.37 - 20, k * 0.19 - 10));
    for (const kind of ['planar', 'triplanar', 'cylindrical'] as const) {
      const d1 = api.makeDisplacement(img, TEX, { kind, axis: 1, radius: 11 });
      const d2 = makeDisplacement(img, TEX, { kind, axis: 1, radius: 11 });
      for (let k = 0; k < 100; k++) {
        const [x, y, z] = [k * 0.3 - 15, 7 - k * 0.11, k * 0.07];
        expect(d1(x, y, z, 0.6, 0.64, 0.48)).toBe(d2(x, y, z, 0.6, 0.64, 0.48));
      }
    }
  });

  it('motore F: stesso solido e stesso codice OpenSCAD', () => {
    const img = makeSample('leather', 128);
    for (const mode of ['relief', 'groove', 'both'] as const) {
      const params = { ...TEX, mode, blur: 0, rotation: 0 };
      const region = wasm.CrossSection.square([80, 60], true);
      const piece = wasm.Manifold.cube([80, 60, 5], true).translate([0, 0, -2.5]);
      const a = api.applyTextureFace(wasm, piece, region, img, params, { step: 0.8 });
      const b = applyTextureFace(wasm, piece, region, img, params, { step: 0.8 });
      expect(a.volume()).toBe(b.volume());
      expect(a.numTri()).toBe(b.numTri());
      expect(api.textureFaceScad(RECT, img, params, 0.8, 'cube(1);')).toBe(textureFaceScad(RECT, img, params, 0.8, 'cube(1);'));
      expect(api.faceSurface(img, params, RECT, 0.8).op).toBe(faceSurface(img, params, RECT, 0.8)!.op);
    }
    const s1 = api.textureSurfaceScad(RECT, img, TEX, 0.8, 'x.png');
    const s2 = textureSurfaceScad(RECT, img, TEX, 0.8, 'x.png');
    expect(s1.code).toBe(s2.code);
    expect(s1.png.data).toEqual(s2.png.data);
  });

  it('motore M: stesse statistiche, stessa mesh, stesso STL', () => {
    const img = makeSample('knurl', 128);
    const cube = wasm.Manifold.cube([30, 30, 30], true);
    const opts = { edge: 1, normals: 'smooth' as const, fadeSharp: true };
    const a = api.displaceSolid(wasm, cube, img, { ...TEX, rotation: 0 }, { kind: 'triplanar' }, opts);
    const b = displaceSolid(wasm, cube, img, { ...TEX, rotation: 0 }, { kind: 'triplanar' }, opts);
    for (const key of ['status', 'triangles', 'volume', 'flipped', 'sharpVertices', 'edgeUsed']) expect(a.stats[key]).toBe((b.stats as unknown as Record<string, unknown>)[key]);
    const ma = a.solid.getMesh();
    const mb = b.solid!.getMesh();
    expect(ma.vertProperties).toEqual(mb.vertProperties);
    expect(api.meshScad(ma.vertProperties, ma.triVerts)).toBe(meshScad(mb.vertProperties, mb.triVerts));
    expect(api.writeStl(ma.vertProperties, ma.triVerts)).toEqual(writeStl(mb.vertProperties, mb.triVerts));
  });
});
