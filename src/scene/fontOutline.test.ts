import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { FONTS } from './fontCatalog';
import { hasFont, registerFont, textContours } from './fontOutline';

beforeAll(() => {
  for (const f of FONTS) {
    const b = readFileSync(`src/assets/fonts/${f.file}`);
    registerFont(f.id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  }
});

const text = (t: string, font = 'roboto-bold', size = 10) => textContours({ text: t, font, size });
const bounds = (contours: [number, number][][]) => {
  const all = contours.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};
const area = (c: [number, number][]) => c.reduce((sum, [x, y], i) => sum + (x * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * y), 0) / 2;

describe('contorni del testo', () => {
  it('tutti i font del catalogo si caricano e danno contorni per una parola', () => {
    for (const f of FONTS.filter((x) => x.category !== 'Simboli')) {
      expect(hasFont(f.id)).toBe(true);
      const contours = text('Ciao 123', f.id);
      expect(contours.length, f.label).toBeGreaterThan(5);
      expect(contours.every((c) => c.length > 2)).toBe(true);
    }
  });

  it('un carattere che il font non ha si prende dai font di simboli', () => {
    // La stella non esiste in Roboto: senza ripiego non ci sarebbe nessun contorno
    expect(text('★').length).toBeGreaterThan(0);
    // Le lettere continuano a uscire dal font scelto e la stella si affianca senza sovrapporsi
    const both = bounds(text('A★'));
    const onlyA = bounds(text('A'));
    expect(both.maxX).toBeGreaterThan(onlyA.maxX);
  });

  it("la spaziatura moltiplica l'avanzamento: a 2 il testo è più largo e resta centrato", () => {
    const normal = bounds(textContours({ text: 'HHH', font: 'roboto-bold', size: 10 }));
    const wide = bounds(textContours({ text: 'HHH', font: 'roboto-bold', size: 10, spacing: 2 }));
    expect(wide.maxX - wide.minX).toBeGreaterThan((normal.maxX - normal.minX) * 1.5);
    // Come in OpenSCAD il centro è quello dell'avanzamento totale: la parte visibile resta a sinistra dell'origine
    expect(wide.minX).toBeLessThan(0);
    // spacing = 1 equivale a non indicarlo
    expect(textContours({ text: 'HHH', font: 'roboto-bold', size: 10, spacing: 1 })).toEqual(text('HHH'));
  });

  it('la "O" ha un contorno esterno e un foro di verso opposto, la "I" un solo contorno', () => {
    const o = text('O');
    expect(o).toHaveLength(2);
    expect(Math.sign(area(o[0]))).not.toBe(Math.sign(area(o[1])));
    expect(text('I')).toHaveLength(1);
  });

  it('la dimensione è quella di OpenSCAD: maiuscole alte circa size', () => {
    const b = bounds(text('H', 'roboto-bold', 10));
    // Roboto: altezza delle maiuscole 0,711 em, em = size × 100/72 → 9,88 mm
    expect(b.maxY - b.minY).toBeGreaterThan(9.5);
    expect(b.maxY - b.minY).toBeLessThan(10.3);
  });

  it('è centrato: verticalmente sull\'ingombro, orizzontalmente sull\'avanzamento', () => {
    const b = bounds(text('Hi'));
    expect((b.maxY + b.minY) / 2).toBeCloseTo(0, 3);
    // L'ingombro orizzontale è quasi simmetrico (i margini dei glifi sono piccoli)
    expect(Math.abs((b.maxX + b.minX) / 2)).toBeLessThan(1);
  });

  it('la crenatura accosta le coppie come AV', () => {
    const together = bounds(text('AV'));
    const a = bounds(text('A'));
    const v = bounds(text('V'));
    expect(together.maxX - together.minX).toBeLessThan(a.maxX - a.minX + (v.maxX - v.minX));
  });

  it('testo vuoto: nessun contorno, senza errori; spazi e testo lungo funzionano', () => {
    expect(text('')).toEqual([]);
    expect(text('   ')).toEqual([]);
    expect(text('Una frase abbastanza lunga da verificare che non si rompa nulla').length).toBeGreaterThan(30);
  });

  it('un font non registrato dà un errore comprensibile', () => {
    expect(() => text('A', 'non-esiste')).toThrow(/non caricato/);
  });

  it('dimensione e font cambiano l\'ingombro', () => {
    const small = bounds(text('Ciao', 'roboto-bold', 5));
    const big = bounds(text('Ciao', 'roboto-bold', 20));
    expect((big.maxX - big.minX) / (small.maxX - small.minX)).toBeCloseTo(4, 1);
    const condensed = bounds(text('Ciao', 'bebas-neue', 10));
    const regular = bounds(text('Ciao', 'roboto-bold', 10));
    expect(condensed.maxX - condensed.minX).not.toBeCloseTo(regular.maxX - regular.minX, 0);
  });
});
