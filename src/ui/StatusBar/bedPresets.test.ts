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
    const all = BED_PRESETS.flatMap((p) => p.printers.flatMap((b) => b.models.map((m) => `${b.brand} ${m}`))).join(' | ');
    for (const model of ['Bambu Lab A1 mini', 'Bambu Lab A1', 'Bambu Lab P1S', 'Bambu Lab P1P', 'Bambu Lab X1C', 'Bambu Lab H2D']) expect(all).toContain(model);
    expect(findPreset(DEFAULT_BED.width, DEFAULT_BED.depth)).toBeDefined();
  });

  it('l\'etichetta comincia dalla misura e nomina la marca una volta sola', () => {
    expect(presetLabel(findPreset(256, 256)!)).toBe('256 × 256 mm · Bambu Lab: A1, P1S, P1P, X1C · Elegoo: Centauri Carbon');
    // Marche diverse sulla stessa misura: ognuna con i suoi modelli
    expect(presetLabel(findPreset(180, 180)!)).toBe('180 × 180 mm · Bambu Lab: A1 mini · Prusa: MINI+');
    for (const p of BED_PRESETS) expect(presetLabel(p).split('Bambu Lab').length).toBeLessThanOrEqual(2);
  });

  it('le stampanti Anycubic ed Elegoo richieste ci sono, ognuna con la sua area', () => {
    const presetOf = (brand: string, model: string) => BED_PRESETS.find((p) => p.printers.some((b) => b.brand === brand && b.models.includes(model)));
    for (const [brand, model, side] of [
      ['Anycubic', 'Kobra 3', 250], ['Anycubic', 'Kobra S1', 250], ['Anycubic', 'Kobra 3 V2', 255], ['Anycubic', 'Kobra 2 Max', 420], ['Anycubic', 'Kobra 3 Max', 420],
      ['Elegoo', 'Centauri Carbon', 256], ['Elegoo', 'Neptune 4', 225], ['Elegoo', 'Neptune 4 Pro', 225], ['Elegoo', 'Neptune 3 Max', 420], ['Elegoo', 'Neptune 4 Max', 420],
    ] as const) {
      expect(presetOf(brand, model), `${brand} ${model}`).toMatchObject({ width: side, depth: side });
    }
  });

  it('findPreset non trova misure personalizzate', () => {
    expect(findPreset(300, 180)).toBeUndefined();
  });
});
