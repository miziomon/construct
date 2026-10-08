/** Area di stampa (X × Y in mm) condivisa da una o più stampanti. */
export interface BedPreset {
  width: number;
  depth: number;
  /** Stampanti con questa area, con la marca: "Bambu Lab A1 mini". */
  printers: string[];
}

/**
 * Aree di stampa delle stampanti più diffuse, una voce per misura (le stampanti con la stessa area stanno insieme,
 * anche di marche diverse), dalla più piccola alla più grande.
 */
export const BED_PRESETS: BedPreset[] = [
  { width: 180, depth: 180, printers: ['Bambu Lab A1 mini', 'Prusa MINI+'] },
  { width: 220, depth: 220, printers: ['Creality Ender-3 V3', 'Creality K1'] },
  { width: 250, depth: 210, printers: ['Prusa MK4S', 'Prusa MK3S+'] },
  { width: 250, depth: 220, printers: ['Prusa CORE One'] },
  { width: 256, depth: 256, printers: ['Bambu Lab A1', 'Bambu Lab P1S', 'Bambu Lab P1P', 'Bambu Lab X1C'] },
  { width: 300, depth: 300, printers: ['Creality K1 Max'] },
  { width: 350, depth: 320, printers: ['Bambu Lab H2D'] },
  { width: 350, depth: 350, printers: ['Creality K2 Plus'] },
  { width: 360, depth: 360, printers: ['Prusa XL'] },
];

/** Etichetta di una voce della tendina: la misura per prima, poi le stampanti ("256 × 256 mm · Bambu Lab A1, ..."). */
export const presetLabel = (p: BedPreset): string => `${p.width} × ${p.depth} mm · ${p.printers.join(', ')}`;

/** Il preset con queste misure, se c'è. */
export const findPreset = (width: number, depth: number): BedPreset | undefined => BED_PRESETS.find((p) => p.width === width && p.depth === depth);
