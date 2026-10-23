import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { applyTextureFace, displaceSolid, selfOverlapVolume, svgReliefSolid, svgTileCenters, textureCacheKey } from './textureMap';
import { FLOOR } from './relief';
import { sampleGrid } from '../scene/relief';
import type { HeightGrid } from '../scene/relief';
import { makeDisplacement, makeTextureHeight, textureDefaults } from '../scene/textureMap';
import { SAMPLE_SVG, makeSample } from '../scene/textureSamples';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const RECT = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
const img = makeSample('knurl', 128);

/** Media di max(z, 0) su un triangolo con z lineare (vertici a, b, c): formule esatte per i tre casi di segno. */
function meanPositive(a: number, b: number, c: number): number {
  const [lo, mid, hi] = [a, b, c].sort((x, y) => x - y);
  if (lo >= 0) return (a + b + c) / 3;
  if (hi <= 0) return 0;
  // Un solo vertice positivo: hi^3 / (3 (hi - lo)(hi - mid)); due positivi: media di z più la parte negativa mancante
  if (mid <= 0) return hi ** 3 / (3 * (hi - lo) * (hi - mid || 1e-12));
  return (a + b + c) / 3 + (-lo) ** 3 / (3 * (hi - lo) * (mid - lo));
}

/** Integrale di max(z, 0), di max(-z, 0) o di z sulla superficie della griglia, con la triangolazione di `heightSolid`. */
function gridIntegral(grid: HeightGrid, part: 'positive' | 'negative' | 'signed'): number {
  const { nx, ny, dx, dy, z } = grid;
  let sum = 0;
  const f = (a: number, b: number, c: number) => (part === 'positive' ? meanPositive(a, b, c) : part === 'negative' ? meanPositive(-a, -b, -c) : (a + b + c) / 3);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const [z00, z10, z11, z01] = [z[j * nx + i], z[j * nx + i + 1], z[(j + 1) * nx + i + 1], z[(j + 1) * nx + i]];
      sum += dx * dy * 0.5 * (f(z00, z10, z11) + f(z00, z11, z01));
    }
  }
  return sum;
}

const panel = () => wasm.Manifold.cube([80, 60, 5], true).translate([0, 0, -2.5]);

describe('motore F (faccia piana)', () => {
  for (const mode of ['relief', 'groove', 'both'] as const) {
    it(`modo ${mode}: solido valido e volume uguale all'integrale della quota`, () => {
      const params = { ...textureDefaults(), tile: 10, amplitude: 0.6, mode };
      const region = wasm.CrossSection.square([80, 60], true);
      const base = panel();
      const result = applyTextureFace(wasm, base, region, img, params, { step: 0.5 });
      expect(result.status()).toBe('NoError');
      expect(result.volume()).toBeGreaterThan(0);
      expect(result.decompose().length).toBe(1);
      // Volume atteso: la griglia della stessa funzione, integrata esattamente sulle stesse facce
      const h = makeTextureHeight(img, params);
      const delta = result.volume() - base.volume();
      let expected: number;
      if (mode === 'relief') expected = gridIntegral(sampleGrid(RECT, 0.5, (x, y) => (h(x, y) < FLOOR ? -FLOOR : h(x, y))), 'positive');
      else if (mode === 'groove') expected = -gridIntegral(sampleGrid(RECT, 0.5, (x, y) => FLOOR + h(x, y)), 'negative');
      else expected = gridIntegral(sampleGrid(RECT, 0.5, h), 'signed');
      expect(Math.abs(delta - expected)).toBeLessThan(Math.max(2, Math.abs(expected) * 0.002));
    });
  }

  it("il rilievo non supera la faccia di più dell'ampiezza e l'incavo non la supera affatto", () => {
    const region = wasm.CrossSection.square([80, 60], true);
    const base = panel();
    const relief = applyTextureFace(wasm, base, region, img, { ...textureDefaults(), tile: 10, amplitude: 0.6, mode: 'relief' }, { step: 0.5 });
    const top = relief.boundingBox().max[2];
    expect(top).toBeGreaterThan(0.2);
    expect(top).toBeLessThanOrEqual(0.6 + 1e-6);
    const groove = applyTextureFace(wasm, base, region, img, { ...textureDefaults(), tile: 10, amplitude: 0.6, mode: 'groove' }, { step: 0.5 });
    expect(groove.boundingBox().max[2]).toBeLessThanOrEqual(1e-6);
  });

  it('ritaglia sulla regione: la cornice del margine resta intatta', () => {
    const region = wasm.CrossSection.square([60, 40], true);
    const base = panel();
    const result = applyTextureFace(wasm, base, region, img, { ...textureDefaults(), tile: 10, amplitude: 0.6, mode: 'relief' }, { step: 0.5, rect: RECT });
    expect(result.status()).toBe('NoError');
    // sopra la faccia c'è solo il rilievo dentro la regione (60 x 40)
    const above = result.intersect(wasm.Manifold.cube([200, 200, 2], false).translate([-100, -100, 0.001]));
    const box = above.boundingBox();
    expect(box.min[0]).toBeGreaterThanOrEqual(-30 - 1e-6);
    expect(box.max[0]).toBeLessThanOrEqual(30 + 1e-6);
    expect(box.max[1]).toBeLessThanOrEqual(20 + 1e-6);
  });

  it('con ampiezza zero, regione vuota o livello medio estremo restituisce una copia del pezzo', () => {
    const base = panel();
    const region = wasm.CrossSection.square([80, 60], true);
    const zero = applyTextureFace(wasm, base, region, img, { amplitude: 0 }, { step: 0.5 });
    expect(zero.volume()).toBeCloseTo(base.volume(), 6);
    const empty = applyTextureFace(wasm, base, wasm.CrossSection.square([0, 0]), img, { amplitude: 1 });
    expect(empty.volume()).toBeCloseTo(base.volume(), 6);
    const flat = applyTextureFace(wasm, base, region, img, { amplitude: 1, midlevel: 1, mode: 'relief' });
    expect(flat.volume()).toBeCloseTo(base.volume(), 6);
  });

  it('il passo cambia i triangoli ma non rompe il solido (0,8 / 0,5 / 0,3 mm)', () => {
    const region = wasm.CrossSection.square([80, 60], true);
    const base = panel();
    const tris = [0.8, 0.5, 0.3].map((step) => {
      const r = applyTextureFace(wasm, base, region, img, { ...textureDefaults(), tile: 10, mode: 'both' }, { step });
      expect(r.status()).toBe('NoError');
      return r.numTri();
    });
    expect(tris[0]).toBeLessThan(tris[1]);
    expect(tris[1]).toBeLessThan(tris[2]);
  });
});

describe('chiave di cache', () => {
  it("dipende dall'impronta e dai parametri, non dai pixel", () => {
    const a = textureCacheKey('abc123', { tile: 10 });
    expect(a).toBe(textureCacheKey('abc123', { tile: 10 }));
    expect(a).not.toBe(textureCacheKey('abc124', { tile: 10 }));
    expect(a).not.toBe(textureCacheKey('abc123', { tile: 11 }));
    expect(a.length).toBeLessThan(300);
  });
});

/** Solidi di prova del motore M. */
const solids: Record<string, () => Manifold> = {
  pannello: () => wasm.Manifold.cube([80, 60, 5], true),
  cilindro: () => wasm.Manifold.cylinder(40, 15, 15, 96, true),
  cubo: () => wasm.Manifold.cube([30, 30, 30], true),
  // Profilo a L: ha uno spigolo concavo
  L: () => wasm.Manifold.cube([40, 40, 10], true).add(wasm.Manifold.cube([10, 40, 40], true).translate([-15, 0, 15])),
};
const make = (name: string): Manifold => solids[name]();
const TEX = { ...textureDefaults(), tile: 10, amplitude: 0.6, mode: 'both' as const };

describe('motore M (mesh intera)', () => {
  for (const name of Object.keys(solids)) {
    it(`${name}: triplanare con spigoli fermi, solido valido senza triangoli rovesciati né sovrapposizioni`, () => {
      const s = make(name);
      const { solid, stats } = displaceSolid(wasm, s, img, TEX, { kind: 'triplanar', radius: 15 }, { edge: 0.8, normals: 'smooth', fadeSharp: true });
      expect(solid).not.toBeNull();
      expect(stats.status).toBe('NoError');
      expect(stats.volume).toBeGreaterThan(0);
      expect(stats.triangles).toBeGreaterThan(s.numTri());
      expect(stats.flipped).toBe(0);
      expect(Math.abs(selfOverlapVolume(solid!))).toBeLessThan(0.1);
      // Con gli spigoli fermi l'ingombro resta quello del pezzo, a meno della quota massima sulle facce (0,3 mm)
      const b0 = s.boundingBox();
      const b1 = solid!.boundingBox();
      for (let k = 0; k < 3; k++) {
        expect(b1.min[k]).toBeGreaterThanOrEqual(b0.min[k] - 0.31);
        expect(b1.max[k]).toBeLessThanOrEqual(b0.max[k] + 0.31);
      }
    });
  }

  it("cubo: il volume cambia come l'integrale della quota sulle sei facce", () => {
    const s = make('cubo');
    const { stats } = displaceSolid(wasm, s, img, TEX, { kind: 'triplanar' }, { edge: 0.8, normals: 'smooth', fadeSharp: true });
    // Su una faccia d'asse la triplanare coincide con la planare: integrale della quota su 30 x 30 mm (media a 300 x 300 punti), sei facce
    const d = makeDisplacement(img, TEX, { kind: 'triplanar' });
    let sum = 0;
    const n = 300;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) sum += d(-15 + ((i + 0.5) * 30) / n, -15 + ((j + 0.5) * 30) / n, 15, 0, 0, 1);
    const expected = 6 * ((sum * 900) / (n * n));
    // Tolleranza: la mesh campiona la quota ai vertici (0,8 mm) e le fasce accanto agli spigoli restano a zero
    expect(Math.abs(stats.volume - stats.volumeBefore - expected)).toBeLessThan(Math.abs(expected) * 0.08);
  });

  it("senza fadeSharp gli spigoli si arrotondano: il vertice dell'angolo del cubo esce dall'ingombro", () => {
    const s = make('cubo');
    const out = displaceSolid(wasm, s, makeSample('noise', 64), { ...TEX, mode: 'relief', amplitude: 1 }, { kind: 'planar', axis: 2 }, { edge: 2, normals: 'smooth', fadeSharp: false });
    // Il vertice si sposta lungo la normale media (diagonale): l'ingombro supera i 15 mm dello spigolo
    expect(out.solid!.boundingBox().max[0]).toBeGreaterThan(15.05);
    expect(out.stats.status).toBe('NoError');
  });

  it('con le normali separate per faccia le facce si staccano: manifold rifiuta la mesh aperta', () => {
    const s = make('cubo');
    const { solid, stats } = displaceSolid(wasm, s, img, TEX, { kind: 'triplanar' }, { edge: 2, normals: 'split' });
    expect(solid).toBeNull();
    expect(stats.status).toMatch(/manifold/i);
  });

  it('il tetto dei triangoli allarga il lato del raffinamento', () => {
    const s = make('pannello');
    const { solid, stats } = displaceSolid(wasm, s, img, TEX, { kind: 'planar' }, { edge: 0.05, maxTriangles: 20000, fadeSharp: true });
    expect(stats.edgeUsed).toBeGreaterThan(0.05);
    expect(stats.refinedTriangles).toBeLessThan(40000);
    expect(solid!.status()).toBe('NoError');
  });

  it('cilindro con proiezione cilindrica: valido e deterministico', () => {
    const run = () => displaceSolid(wasm, make('cilindro'), img, TEX, { kind: 'cylindrical', axis: 2, radius: 15 }, { edge: 0.8, fadeSharp: true }).stats;
    const a = run();
    const b = run();
    expect(a.status).toBe('NoError');
    expect(a.flipped).toBe(0);
    expect(a.volume).toBe(b.volume);
    expect(a.triangles).toBe(b.triangles);
  });
});

describe('SVG vettoriale', () => {
  // Quadrato 10 x 10 con un foro 4 x 4 (riempimento pari-dispari), già in mm e centrato
  const contours: [number, number][][] = [
    [[-5, -5], [5, -5], [5, 5], [-5, 5]],
    [[-2, -2], [-2, 2], [2, 2], [2, -2]],
  ];

  it('i centri delle copie coprono il rettangolo, una sola senza ripetizione', () => {
    expect(svgTileCenters(RECT, { pitch: [12, 12], repeat: false })).toEqual([[0, 0]]);
    const centers = svgTileCenters(RECT, { pitch: [12, 12], repeat: true });
    expect(centers).toContainEqual([0, 0]);
    expect(centers.length).toBeGreaterThanOrEqual((80 / 12) * (60 / 12));
  });

  it('rilievo: volume vicino a (area - foro) * quota per le copie dentro la regione', () => {
    const region = wasm.CrossSection.square([80, 60], true);
    const solid = svgReliefSolid(wasm, region, { contours, pitch: [12, 12], height: 0.6, repeat: true }, RECT)!;
    expect(solid.status()).toBe('NoError');
    const full = (100 - 16) * (0.6 + 0.2);
    expect(solid.volume()).toBeGreaterThan(full * 6 * 4);
    expect(solid.volume()).toBeLessThan(full * 9 * 7);
    const joined = panel().add(solid);
    expect(joined.status()).toBe('NoError');
  });

  it('incavo: sottrae il disegno sotto la faccia', () => {
    const region = wasm.CrossSection.square([80, 60], true);
    const base = panel();
    const cutter = svgReliefSolid(wasm, region, { contours, pitch: [80, 80], height: -0.6, repeat: false }, RECT)!;
    const out = base.subtract(cutter);
    expect(base.volume() - out.volume()).toBeCloseTo((100 - 16) * 0.6, 3);
  });

  it('altezza nulla o regione vuota non producono nulla', () => {
    const region = wasm.CrossSection.square([80, 60], true);
    expect(svgReliefSolid(wasm, region, { contours, pitch: [12, 12], height: 0, repeat: true }, RECT)).toBeNull();
    expect(svgReliefSolid(wasm, wasm.CrossSection.square([0, 0]), { contours, pitch: [12, 12], height: 1, repeat: true }, RECT)).toBeNull();
  });

  it("l'SVG di prova contiene anello e stella", () => {
    expect(SAMPLE_SVG).toContain('<polygon');
    expect(SAMPLE_SVG).toContain('evenodd');
  });
});
