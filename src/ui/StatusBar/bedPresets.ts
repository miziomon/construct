/** Piano di stampa di una stampante nota: i modelli con la stessa area stanno nella stessa voce. */
export interface BedPreset {
  /** Nomi dei modelli che condividono questa area, separati da "/". */
  models: string;
  width: number;
  depth: number;
}

export interface BedBrand {
  brand: string;
  presets: BedPreset[];
}

/**
 * Aree di stampa (X × Y in mm) delle stampanti più diffuse. Un'area già presente in un'altra marca non si ripete
 * (la Prusa MINI+ è 180 × 180 come la Bambu Lab A1 mini).
 */
export const BED_BRANDS: BedBrand[] = [
  {
    brand: 'Bambu Lab',
    presets: [
      { models: 'A1 mini', width: 180, depth: 180 },
      { models: 'A1 / P1S / P1P / X1C', width: 256, depth: 256 },
      { models: 'H2D', width: 350, depth: 320 },
    ],
  },
  {
    brand: 'Prusa',
    presets: [
      { models: 'MK4S', width: 250, depth: 210 },
      { models: 'CORE One', width: 250, depth: 220 },
      { models: 'XL', width: 360, depth: 360 },
    ],
  },
  {
    brand: 'Creality',
    presets: [
      { models: 'Ender-3 V3 / K1', width: 220, depth: 220 },
      { models: 'K1 Max', width: 300, depth: 300 },
      { models: 'K2 Plus', width: 350, depth: 350 },
    ],
  },
];
