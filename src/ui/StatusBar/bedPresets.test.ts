import { describe, expect, it } from 'vitest';
import { BED_BRANDS } from './bedPresets';
import { BED_LIMITS, DEFAULT_BED } from '../uiStore';

const all = BED_BRANDS.flatMap((b) => b.presets);

describe('preset del piano di stampa', () => {
  it('ogni area sta nei limiti del piano', () => {
    for (const p of all) {
      for (const side of [p.width, p.depth]) {
        expect(side).toBeGreaterThanOrEqual(BED_LIMITS.min);
        expect(side).toBeLessThanOrEqual(BED_LIMITS.max);
      }
    }
  });

  it('non ci sono aree ripetute, nemmeno tra marche diverse', () => {
    const keys = all.map((p) => `${p.width}x${p.depth}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('comprende le stampanti Bambu Lab richieste e il piano predefinito', () => {
    const bambu = BED_BRANDS.find((b) => b.brand === 'Bambu Lab')!;
    const names = bambu.presets.map((p) => p.models).join(' / ');
    for (const model of ['A1 mini', 'A1', 'P1S', 'H2D']) expect(names).toContain(model);
    expect(all.some((p) => p.width === DEFAULT_BED.width && p.depth === DEFAULT_BED.depth)).toBe(true);
  });
});
