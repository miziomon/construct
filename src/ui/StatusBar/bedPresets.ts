/** Modelli di una marca che hanno la stessa area di stampa. */
export interface PrinterBrand {
  brand: string;
  models: string[];
}

/** Area di stampa (X × Y in mm) condivisa da una o più stampanti, anche di marche diverse. */
export interface BedPreset {
  width: number;
  depth: number;
  printers: PrinterBrand[];
}

/**
 * Aree di stampa delle stampanti più diffuse, una voce per misura (le stampanti con la stessa area stanno insieme),
 * dalla più piccola alla più grande.
 */
export const BED_PRESETS: BedPreset[] = [
  { width: 180, depth: 180, printers: [{ brand: 'Bambu Lab', models: ['A1 mini'] }, { brand: 'Prusa', models: ['MINI+'] }] },
  { width: 210, depth: 210, printers: [{ brand: 'Anycubic', models: ['i3 Mega'] }] },
  { width: 220, depth: 220, printers: [{ brand: 'Creality', models: ['Ender-3 V3', 'K1'] }, { brand: 'Anycubic', models: ['Kobra 2', 'Kobra 2 Pro', 'Kobra 2 Neo'] }] },
  { width: 225, depth: 225, printers: [{ brand: 'Elegoo', models: ['Neptune 3 Pro', 'Neptune 4', 'Neptune 4 Pro'] }] },
  { width: 250, depth: 210, printers: [{ brand: 'Prusa', models: ['MK4S', 'MK3S+'] }] },
  { width: 250, depth: 220, printers: [{ brand: 'Prusa', models: ['CORE One'] }] },
  { width: 250, depth: 250, printers: [{ brand: 'Anycubic', models: ['Kobra 3', 'Kobra S1'] }] },
  { width: 255, depth: 255, printers: [{ brand: 'Anycubic', models: ['Kobra 3 V2'] }] },
  { width: 256, depth: 256, printers: [{ brand: 'Bambu Lab', models: ['A1', 'P1S', 'P1P', 'X1C'] }, { brand: 'Elegoo', models: ['Centauri Carbon'] }] },
  { width: 300, depth: 300, printers: [{ brand: 'Creality', models: ['K1 Max'] }] },
  { width: 305, depth: 305, printers: [{ brand: 'Anycubic', models: ['Kobra 2 Plus'] }] },
  { width: 320, depth: 320, printers: [{ brand: 'Elegoo', models: ['Neptune 4 Plus'] }] },
  { width: 350, depth: 320, printers: [{ brand: 'Bambu Lab', models: ['H2D'] }] },
  { width: 350, depth: 350, printers: [{ brand: 'Creality', models: ['K2 Plus'] }] },
  { width: 360, depth: 360, printers: [{ brand: 'Prusa', models: ['XL'] }] },
  { width: 420, depth: 420, printers: [{ brand: 'Anycubic', models: ['Kobra 2 Max', 'Kobra 3 Max'] }, { brand: 'Elegoo', models: ['Neptune 3 Max', 'Neptune 4 Max'] }] },
];

/** Stampanti di una voce: la marca una volta sola, poi i modelli ("Bambu Lab: A1, P1S, P1P, X1C"); marche diverse si separano con " · ". */
export const printersLabel = (p: BedPreset): string => p.printers.map((b) => `${b.brand}: ${b.models.join(', ')}`).join(' · ');

/** Etichetta di una voce della tendina: la misura per prima, poi le stampanti ("256 × 256 mm · Bambu Lab: A1, P1S, ..."). */
export const presetLabel = (p: BedPreset): string => `${p.width} × ${p.depth} mm · ${printersLabel(p)}`;

/** Il preset con queste misure, se c'è. */
export const findPreset = (width: number, depth: number): BedPreset | undefined => BED_PRESETS.find((p) => p.width === width && p.depth === depth);
