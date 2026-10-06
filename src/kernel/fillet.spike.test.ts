import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from 'manifold-3d';

/**
 * Spike per la valutazione dei raccordi (docs/valutazione-raccordi.md): non fa parte dell'app.
 * Prova che un raccordo costante tra due facce piane si ottiene con un "taglierino" booleano
 * (triangolo tra i punti di tangenza meno il cerchio), con il volume previsto dalla formula
 *   A = r² · (cot(β/2) − (π − β)/2)    per unità di lunghezza,
 * dove β è l'angolo tra le due facce misurato nel materiale (convesso) o nell'aria (concavo).
 */

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const SEGMENTS = 128;

/** Area teorica del taglierino per unità di lunghezza. */
const filletArea = (r: number, beta: number) => r * r * (1 / Math.tan(beta / 2) - (Math.PI - beta) / 2);

/** Area del cerchio poligonale a SEGMENTS lati, per confrontare con il poligono e non con il cerchio ideale. */
const polygonCircleArea = (r: number) => 0.5 * SEGMENTS * r * r * Math.sin((2 * Math.PI) / SEGMENTS);

/** Settore circolare del raccordo: area teorica sostituita con quella del cerchio poligonale (stessa differenza di sfaccettatura). */
const expectedArea = (r: number, beta: number) => {
  const kite = (r * r) / Math.tan(beta / 2); // = r · d, con d = r / tan(β/2)
  // Il settore è la frazione (π − β)/(2π) del cerchio
  return kite - polygonCircleArea(r) * ((Math.PI - beta) / (2 * Math.PI));
};

/** Sezione 2D del taglierino: triangolo apice-tangenze meno il cerchio del raccordo. L'apice è nell'origine, la bisettrice lungo +X. */
function cutterSection(r: number, beta: number): CrossSection {
  const { CrossSection } = wasm;
  const half = beta / 2;
  const d = r / Math.tan(half);
  // Vertici in senso antiorario: con l'orientamento opposto la sezione risulterebbe vuota
  const triangle: Vec2[] = [[0, 0], [d * Math.cos(half), -d * Math.sin(half)], [d * Math.cos(half), d * Math.sin(half)]];
  const tri = new CrossSection([triangle]);
  const disc = CrossSection.circle(r, SEGMENTS).translate([r / Math.sin(half), 0]);
  const cutter = tri.subtract(disc);
  tri.delete();
  disc.delete();
  return cutter;
}

/** Cuneo infinito (grande) di materiale con apice nell'origine, angolo β e bisettrice lungo +X. */
function wedgeSection(beta: number): CrossSection {
  const half = beta / 2;
  const big = 200;
  // Vertici in senso antiorario
  return new wasm.CrossSection([[[0, 0], [big * Math.cos(half), -big * Math.sin(half)], [big * Math.cos(half), big * Math.sin(half)]] as Vec2[]]);
}

const volume = (m: Manifold) => m.volume();

describe('spike raccordi: taglierino booleano su uno spigolo tra due facce piane', () => {
  const L = 20;

  it.each([60, 90, 120])('spigolo convesso con angolo %i°: il volume rimosso è A·L', (degrees) => {
    const beta = (degrees * Math.PI) / 180;
    const r = 3;
    const { Manifold } = wasm;
    const wedgeShape = wedgeSection(beta);
    const solid = Manifold.extrude(wedgeShape, L);
    const cutterShape = cutterSection(r, beta);
    // Il taglierino sporge di poco oltre le due facce per evitare facce coincidenti
    const cutter = Manifold.extrude(cutterShape, L);
    const result = solid.subtract(cutter);
    expect(result.status()).toBe('NoError');
    expect(result.genus()).toBe(0);
    const removed = volume(solid) - volume(result);
    expect(removed).toBeCloseTo(expectedArea(r, beta) * L, 2);
    // Il valore poligonale è vicino a quello ideale (la differenza è solo la sfaccettatura del cerchio)
    expect(Math.abs(removed - filletArea(r, beta) * L) / (filletArea(r, beta) * L)).toBeLessThan(0.01);
    [wedgeShape, cutterShape, solid, cutter, result].forEach((h) => h.delete());
  });

  it('spigolo concavo (una L): il volume aggiunto è A·L e il risultato è un solo solido', () => {
    const { Manifold, CrossSection } = wasm;
    const beta = Math.PI / 2;
    const r = 3;
    // La L è un blocco 100×100 a cui manca il quadrante dell'aria: l'aria è il cuneo di 90° con apice nell'origine
    const block = CrossSection.square([100, 100], true);
    const air = wedgeSection(beta);
    const lShape = block.subtract(air);
    const solid = Manifold.extrude(lShape, L);
    const filler = Manifold.extrude(cutterSection(r, beta), L);
    const result = solid.add(filler);
    expect(result.status()).toBe('NoError');
    expect(result.decompose()).toHaveLength(1);
    expect(volume(result) - volume(solid)).toBeCloseTo(expectedArea(r, beta) * L, 2);
    [block, air, lShape, solid, filler, result].forEach((h) => h.delete());
  });

  it('estremità non perpendicolare: il taglierino si ritaglia con trimByPlane sul piano della faccia di fondo', () => {
    const { Manifold } = wasm;
    const beta = Math.PI / 2;
    const r = 3;
    // Piano obliquo che chiude lo spigolo a z = L, inclinato di 30° rispetto alla sua perpendicolare (normale in Y e Z)
    const tilt = Math.PI / 6;
    const n: [number, number, number] = [0, Math.sin(tilt), Math.cos(tilt)];
    const offset = n[2] * L;
    // Si tiene la parte con n·p ≤ offset: trimByPlane tiene il lato verso cui punta la normale, quindi si inverte
    const keep = (m: Manifold) => m.trimByPlane([-n[0], -n[1], -n[2]], -offset);

    const wedgeShape = wedgeSection(beta);
    const solid = keep(Manifold.extrude(wedgeShape, L * 2));
    // Il taglierino parte più lungo del pezzo e si ritaglia sullo stesso piano della faccia di fondo
    const cutterShape = cutterSection(r, beta);
    const cutter = keep(Manifold.extrude(cutterShape, L * 2));
    const result = solid.subtract(cutter);
    expect(result.status()).toBe('NoError');
    // Il profilo è simmetrico in Y, quindi l'inclinazione non cambia la lunghezza media: A · L
    expect(volume(solid) - volume(result)).toBeCloseTo(expectedArea(r, beta) * L, 1);
  });

  it('spigolo di un cubo qualsiasi: il taglierino si posiziona con rotate e translate e toglie A·L', () => {
    const { Manifold } = wasm;
    const r = 3;
    const size = 20;
    const cube = Manifold.cube([size, size, size], true);
    const beta = Math.PI / 2;
    const cutterShape = cutterSection(r, beta);
    // Il taglierino va portato sullo spigolo: apice sullo spigolo e bisettrice diretta verso il centro del cubo
    const edgeCutter = (axis: 'x' | 'y' | 'z') => {
      const prism = Manifold.extrude(cutterShape, size).translate([0, 0, -size / 2]);
      // Il taglierino ha l'apice nell'origine e la bisettrice lungo +X: si porta l'apice sullo spigolo e la bisettrice verso il centro del cubo
      // Con spigolo lungo Z: apice in (10, 10, ·) e bisettrice diretta verso (-1, -1, 0)
      const base = prism.rotate([0, 0, 225]).translate([size / 2, size / 2, 0]);
      return axis === 'z' ? base : axis === 'x' ? base.rotate([0, 90, 0]).rotate([90, 0, 0]) : base.rotate([90, 0, 0]).rotate([0, 0, 90]);
    };
    // Si prova lo spigolo lungo Z; gli altri due sono rotazioni dello stesso taglierino. I tre spigoli insieme (angolo con tre raccordi) restano fuori dall'MVP
    const result = cube.subtract(edgeCutter('z'));
    expect(result.status()).toBe('NoError');
    expect(volume(cube) - volume(result)).toBeCloseTo(expectedArea(r, beta) * size, 1);
  });
});

describe('numeri riportati nel documento', () => {
  it('un raccordo su un cubo da 20 mm con r = 3 costa pochi millisecondi', () => {
    const { Manifold } = wasm;
    const beta = Math.PI / 2;
    const cube = Manifold.cube([20, 20, 20], true);
    const cutterShape = cutterSection(3, beta);
    const t0 = performance.now();
    const cutter = Manifold.extrude(cutterShape, 20).translate([0, 0, -10]).rotate([0, 0, 225]).translate([10, 10, 0]);
    const result = cube.subtract(cutter);
    const ms = performance.now() - t0;
    expect(result.status()).toBe('NoError');
    expect(ms).toBeLessThan(500);
  });
});
