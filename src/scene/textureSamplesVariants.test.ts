import { describe, expect, it } from 'vitest';
import { SAMPLE_KINDS, SAMPLE_VARIANTS, makeSample, sampleValue, sampleVariantIndex } from './textureSamples';
import type { SampleKind } from './textureSamples';
import type { GrayImage } from './textureMap';

const SIZE = 128;
const combos = SAMPLE_KINDS.flatMap((kind) => SAMPLE_VARIANTS[kind].map((name, variant) => ({ kind, name, variant })));

const stats = (img: GrayImage) => {
  const n = img.data.length;
  const mean = img.data.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(img.data.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { mean, std, min: Math.min(...img.data), max: Math.max(...img.data) };
};

describe('libreria di texture: tre varianti per texture', () => {
  it('ogni texture ha tre varianti con nomi distinti; la libreria non ha più i mattoni (duplicano il rilievo Mattoni)', () => {
    expect(SAMPLE_KINDS).toEqual(['knurl', 'carbon', 'leather', 'stone', 'fabric', 'waves', 'noise']);
    for (const kind of SAMPLE_KINDS) {
      expect(SAMPLE_VARIANTS[kind]).toHaveLength(3);
      expect(new Set(SAMPLE_VARIANTS[kind]).size).toBe(3);
    }
    expect(SAMPLE_KINDS).not.toContain('bricks');
    expect(combos).toHaveLength(21);
    // Il nome della variante dà l'indice; uno sconosciuto o assente la prima
    expect(sampleVariantIndex('knurl', 'dots')).toBe(2);
    expect(sampleVariantIndex('knurl', 'nonesiste')).toBe(0);
    expect(sampleVariantIndex('knurl', undefined)).toBe(0);
    expect(sampleVariantIndex('stone', 'dots')).toBe(0);
  });

  it.each(combos)('$kind / $name: immagine $kind quadrata, deterministica, non uniforme, con quasi tutto il campo 0-255', ({ kind, variant }) => {
    const a = makeSample(kind, SIZE, variant);
    expect([a.w, a.h, a.data.length]).toEqual([SIZE, SIZE, SIZE * SIZE]);
    expect(Array.from(makeSample(kind, SIZE, variant).data)).toEqual(Array.from(a.data));
    const { std, min, max } = stats(a);
    // Non uniforme: deviazione standard di almeno 25 livelli su 255
    expect(std).toBeGreaterThan(25);
    // Range quasi pieno (la saia originale non scende sotto 51: il filo sotto la trama sta a 0,2)
    expect(min).toBeLessThan(70);
    expect(max).toBeGreaterThan(215);
  });

  it.each(combos)('$kind / $name: si ripete senza cucitura (il pixel oltre il bordo è il primo della piastrella seguente)', ({ kind, variant }) => {
    const img = makeSample(kind, SIZE, variant);
    for (const j of [0, 17, 63, 100, SIZE - 1]) {
      const v = 1 - (j + 0.5) / SIZE;
      // Il pixel che verrebbe dopo l'ultimo della riga, campionato oltre il bordo, vale come il primo (e prima del primo come l'ultimo)
      expect(Math.round(Math.min(1, Math.max(0, sampleValue(kind, (SIZE + 0.5) / SIZE, v, variant))) * 255)).toBe(img.data[j * SIZE]);
      expect(Math.round(Math.min(1, Math.max(0, sampleValue(kind, -0.5 / SIZE, v, variant))) * 255)).toBe(img.data[j * SIZE + SIZE - 1]);
      // Lo stesso in verticale (la riga 0 è l'alto, v = 1)
      const u = (j + 0.5) / SIZE;
      expect(Math.round(Math.min(1, Math.max(0, sampleValue(kind, u, 1 + 0.5 / SIZE, variant))) * 255)).toBe(img.data[(SIZE - 1) * SIZE + j]);
    }
  });

  it.each(combos)('$kind / $name: periodica di periodo 1 (u + 1 e v + 1 danno lo stesso valore)', ({ kind, variant }) => {
    for (const [u, v] of [[0.13, 0.71], [0.5, 0.5], [0.97, 0.02], [0.3333, 0.8]]) {
      expect(sampleValue(kind, u + 1, v, variant)).toBeCloseTo(sampleValue(kind, u, v, variant), 6);
      expect(sampleValue(kind, u, v + 1, variant)).toBeCloseTo(sampleValue(kind, u, v, variant), 6);
    }
  });

  it('le tre varianti di una texture sono immagini diverse (e nessuna è la stessa di un\'altra texture)', () => {
    const seen = new Set<string>();
    for (const { kind, variant } of combos) seen.add(Array.from(makeSample(kind, 32, variant).data).join(','));
    expect(seen.size).toBe(combos.length);
  });

  it('la variante 0 delle texture che c\'erano già è quella di prima (progetti salvati invariati)', () => {
    const tri = (v: number) => Math.abs(v - Math.floor(v) - 0.5) * 2;
    for (const [u, v] of [[0.1, 0.2], [0.37, 0.81], [0.6, 0.45]]) {
      expect(sampleValue('knurl', u, v)).toBeCloseTo(1 - Math.max(tri(4 * (u + v)), tri(4 * (u - v))), 12);
      expect(sampleValue('knurl', u, v, 0)).toBe(sampleValue('knurl', u, v));
      expect(sampleValue('waves', u, v)).toBeCloseTo(0.5 + 0.5 * Math.sin(2 * Math.PI * (3 * u + 0.35 * Math.sin(2 * Math.PI * 2 * v))), 12);
    }
    // Una variante fuori elenco vale come la prima
    for (const kind of ['knurl', 'carbon', 'leather', 'waves', 'noise'] as SampleKind[]) expect(sampleValue(kind, 0.31, 0.62, 7)).toBe(sampleValue(kind, 0.31, 0.62, 0));
  });

  it('i mattoni restano nel codice (prototipo e vecchi progetti)', () => {
    const bricks = makeSample('bricks', 64);
    expect(stats(bricks).std).toBeGreaterThan(25);
  });
});
