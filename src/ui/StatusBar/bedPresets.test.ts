import { describe, expect, it } from 'vitest';
import { BED_PRESETS, findPreset, presetLabel } from './bedPresets';
import { BED_LIMITS, DEFAULT_BED } from '../uiStore';

describe('preset del piano di stampa', () => {
  it('ogni area sta nei limiti del piano', () => {
    for (const p of BED_PRESETS) {
      for (const side of [p.width, p.depth]) {
        expect(side).toBeGreaterThanOrEqual(BED_LIMITS.min);
        expect(side).toBeLessThanOrEqual(BED_LIMITS.max);
      }
    }
  });

  it('una sola voce per misura, dalla più piccola alla più grande, e ogni voce ha stampanti', () => {
    const keys = BED_PRESETS.map((p) => `${p.width}x${p.depth}`);
    expect(new Set(keys).size).toBe(keys.length);
    const areas = BED_PRESETS.map((p) => p.width * p.depth);
    expect(areas).toEqual([...areas].sort((a, b) => a - b));
    for (const p of BED_PRESETS) expect(p.printers.length).toBeGreaterThan(0);
  });

  it('le stampanti Bambu Lab richieste ci sono, e il piano predefinito è tra i preset', () => {
    const all = BED_PRESETS.flatMap((p) => p.printers).join(' | ');
    for (const model of ['A1 mini', 'Bambu Lab A1', 'P1S', 'H2D']) expect(all).toContain(model);
    expect(findPreset(DEFAULT_BED.width, DEFAULT_BED.depth)).toBeDefined();
  });

  it('l\'etichetta comincia dalla misura, poi elenca le stampanti', () => {
    const label = presetLabel(findPreset(256, 256)!);
    expect(label.startsWith('256 × 256 mm · ')).toBe(true);
    expect(label).toContain('Bambu Lab A1, Bambu Lab P1S');
  });

  it('findPreset non trova misure personalizzate', () => {
    expect(findPreset(300, 180)).toBeUndefined();
  });
});
