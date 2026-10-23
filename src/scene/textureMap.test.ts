import { describe, expect, it } from 'vitest';
import {
  blurGray,
  grayToHeight,
  heightRange,
  makeDisplacement,
  makeTextureHeight,
  normalizeTexture,
  resizeGray,
  rgbaToGray,
  sampleGray,
  textureDefaults,
} from './textureMap';
import type { GrayImage } from './textureMap';

/** Immagine 4 x 3 asimmetrica con valori noti (riga 0 in alto): serve a fissare orientamento e interpolazione. */
const ASYM: GrayImage = {
  w: 4,
  h: 3,
  data: Uint8Array.from([
    0, 255, 255, 255, // riga alta: solo il primo pixel è nero
    255, 255, 255, 255,
    255, 255, 255, 0, // riga bassa: solo l'ultimo pixel è nero
  ]),
};

/** Gradiente orizzontale 16 x 4: da 0 a 255 lungo x. */
const RAMP: GrayImage = { w: 16, h: 4, data: Uint8Array.from({ length: 64 }, (_, k) => Math.round(((k % 16) / 15) * 255)) };

const tex = (patch = {}) => ({ ...textureDefaults(), mode: 'both' as const, midlevel: 0, amplitude: 1, ...patch });

describe('conversione a grigio', () => {
  it('usa pesi interi e non linearizza', () => {
    // rosso, verde, blu puri: 77, 150, 29 (la somma dei pesi è 256: il bianco resta 255)
    const rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255];
    const g = rgbaToGray(rgba, 5, 1);
    expect(Array.from(g.data)).toEqual([77, 149, 29, 255, 0]);
  });
  it('compone la trasparenza sul bianco', () => {
    const g = rgbaToGray([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128], 3, 1);
    expect(g.data[0]).toBe(255);
    expect(g.data[1]).toBe(0);
    expect(g.data[2]).toBe(127);
  });
});

describe('campionatore bilineare', () => {
  it('restituisce il valore esatto al centro del pixel, con la riga 0 in alto', () => {
    // il pixel (0,0) è in alto a sinistra: s = 0,125, t = 1 - 1/6
    expect(sampleGray(ASYM, 0.125, 1 - 1 / 6, false)).toBe(0);
    expect(sampleGray(ASYM, 0.375, 1 - 1 / 6, false)).toBe(1);
    // il pixel (3,2) è in basso a destra
    expect(sampleGray(ASYM, 0.875, 1 / 6, false)).toBe(0);
    expect(sampleGray(ASYM, 0.125, 1 / 6, false)).toBe(1);
  });
  it('interpola a metà tra due centri', () => {
    expect(sampleGray(ASYM, 0.25, 1 - 1 / 6, false)).toBeCloseTo(0.5, 6);
  });
  it('replica il bordo senza ripetizione e si richiude con la ripetizione', () => {
    expect(sampleGray(RAMP, 0, 0.5, false)).toBe(0);
    expect(sampleGray(RAMP, 1, 0.5, false)).toBe(1);
    // con la ripetizione, sul bordo tra la fine e l'inizio si mescolano l'ultimo e il primo pixel
    expect(sampleGray(RAMP, 0, 0.5, true)).toBeCloseTo(0.5, 6);
    expect(sampleGray(RAMP, 1, 0.5, true)).toBeCloseTo(0.5, 6);
  });
  it('è deterministico', () => {
    const run = () => Array.from({ length: 200 }, (_, k) => sampleGray(RAMP, (k * 0.0137) % 1, (k * 0.071) % 1, true));
    expect(run()).toEqual(run());
  });
});

describe('quota', () => {
  it('relief, groove e both partono dal livello medio', () => {
    const base = { midlevel: 0.5, amplitude: 2 };
    expect(grayToHeight(1, { ...base, mode: 'relief' })).toBeCloseTo(2);
    expect(grayToHeight(0.25, { ...base, mode: 'relief' })).toBe(0);
    expect(grayToHeight(0, { ...base, mode: 'groove' })).toBeCloseTo(-2);
    expect(grayToHeight(0.75, { ...base, mode: 'groove' })).toBe(0);
    expect(grayToHeight(1, { ...base, mode: 'both' })).toBeCloseTo(1);
    expect(grayToHeight(0, { ...base, mode: 'both' })).toBeCloseTo(-1);
    expect(heightRange({ ...base, mode: 'both' })).toEqual([-1, 1]);
  });
  it('con livello medio agli estremi non divide per zero', () => {
    expect(grayToHeight(1, { mode: 'relief', midlevel: 1, amplitude: 1 })).toBe(0);
    expect(grayToHeight(0, { mode: 'groove', midlevel: 0, amplitude: 1 })).toBe(0);
  });
  it('limita i parametri e sostituisce i valori non finiti', () => {
    const p = normalizeTexture({ tile: NaN, amplitude: Infinity, midlevel: 7, blur: -3, rotation: 725 });
    expect(p.tile).toBe(20);
    expect(p.midlevel).toBe(1);
    expect(p.blur).toBe(0);
    expect(p.rotation).toBe(5);
    expect(normalizeTexture({ tile: 0 }).tile).toBe(0.5);
  });
});

describe('funzione di quota h(u, v)', () => {
  const h = makeTextureHeight(RAMP, tex({ tile: 16, midlevel: 0 }));
  it('segue il gradiente nei centri dei pixel ed è definita ai bordi', () => {
    // il pixel i ha il centro in u = i + 0,5 (16 mm, 16 pixel: 1 mm per pixel)
    expect(h(0.5, 1)).toBeCloseTo(0, 6);
    expect(h(15.5, 1)).toBeCloseTo(1, 6);
    expect(h(8.5, 1)).toBeCloseTo(8 / 15, 2);
    expect(Number.isFinite(h(0, 1))).toBe(true);
    expect(h(0, 1)).toBeCloseTo(0.5, 6);
  });
  it('si ripete ogni tile mm (anche in v) e senza ripetizione fuori vale 0', () => {
    for (const [u, v] of [[0.3, 0.2], [7.7, 1.1], [13.2, 3.5]]) {
      expect(h(u + 16, v)).toBeCloseTo(h(u, v), 9);
      expect(h(u - 32, v)).toBeCloseTo(h(u, v), 9);
      // l'altezza della piastrella è 16 * 4 / 16 = 4 mm
      expect(h(u, v + 4)).toBeCloseTo(h(u, v), 9);
    }
    const once = makeTextureHeight(RAMP, tex({ tile: 16, repeat: false }));
    expect(once(-1, 1)).toBe(0);
    expect(once(17, 1)).toBe(0);
    expect(once(8, 5)).toBe(0);
    expect(once(15.5, 1)).toBeCloseTo(1, 6);
  });
  it("l'inversione scambia nero e bianco", () => {
    const inv = makeTextureHeight(RAMP, tex({ tile: 16, invert: true }));
    for (const u of [0.5, 4.5, 9.5, 15.5]) expect(inv(u, 1)).toBeCloseTo(1 - h(u, 1), 6);
  });
  it('la rotazione di 90 gradi scambia gli assi', () => {
    const sq: GrayImage = { w: 16, h: 16, data: Uint8Array.from({ length: 256 }, (_, k) => Math.round(((k % 16) / 15) * 255)) };
    const a = makeTextureHeight(sq, tex({ tile: 16, rotation: 0 }));
    const b = makeTextureHeight(sq, tex({ tile: 16, rotation: 90 }));
    // (u, v) nella texture ruotata di 90 gradi antiorari equivale a (v, -u) in quella dritta
    for (const [u, v] of [[3.2, 5.1], [10.4, 2.2], [7.5, 9.5]]) expect(b(u, v)).toBeCloseTo(a(v, -u), 6);
  });
  it('lo scostamento sposta la piastrella', () => {
    const moved = makeTextureHeight(RAMP, tex({ tile: 16, offset: [3, 1] }));
    for (const [u, v] of [[0.7, 0.3], [5.5, 2.5]]) expect(moved(u + 3, v + 1)).toBeCloseTo(h(u, v), 9);
  });
  it('è deterministico anche con la sfocatura', () => {
    const blurred = makeTextureHeight(ASYM, tex({ tile: 4, blur: 1 }));
    const samples = () => Array.from({ length: 100 }, (_, k) => blurred(k * 0.173, k * 0.311));
    expect(samples()).toEqual(samples());
  });
});

describe('ridimensionamento e sfocatura', () => {
  it('riduce il lato maggiore mantenendo la media e non ingrandisce', () => {
    const big: GrayImage = { w: 8, h: 4, data: Uint8Array.from({ length: 32 }, (_, k) => (k % 2 ? 200 : 100)) };
    const small = resizeGray(big, 4);
    expect([small.w, small.h]).toEqual([4, 2]);
    expect(Array.from(small.data).every((v) => v === 150)).toBe(true);
    expect(resizeGray(big, 100)).toBe(big);
  });
  it("la sfocatura conserva la media di un'immagine ripetuta e lascia piatta quella piatta", () => {
    const mean = (g: GrayImage) => g.data.reduce((s, v) => s + v, 0) / g.data.length;
    expect(mean(blurGray(ASYM, 1, true))).toBeCloseTo(mean(ASYM), 0);
    const flat: GrayImage = { w: 5, h: 5, data: new Uint8Array(25).fill(77) };
    expect(blurGray(flat, 2, false).data.every((v) => v === 77)).toBe(true);
  });
});

describe('proiezioni', () => {
  // Strisce verticali: la quota dipende solo dal punto
  const stripes: GrayImage = { w: 8, h: 8, data: Uint8Array.from({ length: 64 }, (_, k) => ((k % 8) < 4 ? 255 : 0)) };
  const t = tex({ tile: 8, midlevel: 0, mode: 'relief' as const, amplitude: 1 });

  it('planare: dipende solo dalle coordinate sul piano', () => {
    const d = makeDisplacement(stripes, t, { kind: 'planar', axis: 2 });
    expect(d(1, 2, 0, 0, 0, 1)).toBeCloseTo(d(1, 2, 50, 0, 0, 1), 9);
    const dx = makeDisplacement(stripes, t, { kind: 'planar', axis: 0 });
    // asse X: u = y, v = z
    expect(dx(99, 1, 2, 1, 0, 0)).toBeCloseTo(d(1, 2, 0, 0, 0, 1), 9);
  });
  it("triplanare: su una normale d'asse coincide con la planare, in diagonale i pesi sommano 1", () => {
    const tri = makeDisplacement(stripes, t, { kind: 'triplanar', blend: 4 });
    const pz = makeDisplacement(stripes, t, { kind: 'planar', axis: 2 });
    expect(tri(1.3, 2.2, 3, 0, 0, 1)).toBeCloseTo(pz(1.3, 2.2, 3, 0, 0, 1), 9);
    // con tutte le proiezioni uguali a 1 (immagine bianca) il risultato è 1 per qualunque normale
    const white: GrayImage = { w: 2, h: 2, data: new Uint8Array(4).fill(255) };
    const triWhite = makeDisplacement(white, t, { kind: 'triplanar' });
    const n = 1 / Math.sqrt(3);
    expect(triWhite(0.5, 0.5, 0.5, n, n, n)).toBeCloseTo(1, 9);
  });
  it('cilindrica: il giro si chiude senza cucitura (un numero intero di piastrelle)', () => {
    const cyl = makeDisplacement(stripes, t, { kind: 'cylindrical', axis: 2, radius: 10 });
    // raggio 10, tile 8: 2 pi R / 8 = 7,85, quindi 8 piastrelle; theta = +-pi è lo stesso punto
    const at = (th: number, z: number) => cyl(10 * Math.cos(th), 10 * Math.sin(th), z, Math.cos(th), Math.sin(th), 0);
    for (const z of [0.7, 3.1, 5.5]) {
      expect(at(Math.PI - 1e-9, z)).toBeCloseTo(at(-Math.PI + 1e-9, z), 4);
      expect(at(0.4, z)).toBeCloseTo(at(0.4 + (2 * Math.PI) / 8, z), 6);
    }
  });
  it('cilindrica: i tappi passano alla proiezione planare', () => {
    const cyl = makeDisplacement(stripes, t, { kind: 'cylindrical', axis: 2, radius: 10, capAngle: 25 });
    const pz = makeDisplacement(stripes, t, { kind: 'planar', axis: 2 });
    expect(cyl(1.1, 2.2, 5, 0, 0, 1)).toBeCloseTo(pz(1.1, 2.2, 5, 0, 0, 1), 9);
  });
});
