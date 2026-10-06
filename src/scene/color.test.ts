import { describe, expect, it } from 'vitest';
import { hslToHex, randomColor } from './color';

/** Tinta (gradi) di un colore "#rrggbb". */
function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const distance = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
};

describe('hslToHex', () => {
  it('converte i colori primari', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff');
  });
});

describe('randomColor', () => {
  it('restituisce sempre un colore esadecimale a sei cifre', () => {
    for (let i = 0; i < 50; i++) expect(randomColor()).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('due colori consecutivi hanno tinte lontane almeno 40 gradi', () => {
    let prev = randomColor();
    for (let i = 0; i < 100; i++) {
      const next = randomColor();
      expect(distance(hueOf(prev), hueOf(next))).toBeGreaterThanOrEqual(39);
      prev = next;
    }
  });
});
