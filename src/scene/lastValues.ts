import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FONTS } from './fontCatalog';
import { migrateLocalKey, STORAGE } from '../storageMigration';

/**
 * Ultimi valori inseriti dall'utente su una forma o su un pannello di dettaglio (raggio dello smusso, distanza dello
 * smusso angolare, dimensioni di un cubo, ...): le forme e gli strumenti nuovi partono da lì. Si salvano in
 * localStorage (chiave `construct:last`) e non fanno parte della scena né della cronologia di Annulla.
 *
 * Il contenuto di localStorage non è fidato: ogni valore passa da `isValid` sia quando si salva sia quando si legge,
 * quindi un valore rovinato o di un'altra versione viene scartato invece di rompere la creazione di una forma.
 */

export type Remembered = Record<string, number | number[] | string>;

/** Campi ricordati per tipo di forma (chiave = `kind`). Solo misure: mai nome, colore, posizione, rotazione o testo. */
const SHAPE_FIELDS: Record<string, readonly string[]> = {
  box: ['size', 'cornerRadius'],
  cylinder: ['radius', 'height', 'segments'],
  cone: ['radiusBottom', 'radiusTop', 'height', 'segments'],
  sphere: ['radius', 'segments'],
  torus: ['majorRadius', 'minorRadius', 'segments'],
  octahedron: ['size', 'cornerRadius'],
  decahedron: ['size', 'cornerRadius'],
  dodecahedron: ['size', 'cornerRadius'],
  icosahedron: ['size', 'cornerRadius'],
  circle: ['radius', 'segments', 'cornerRadius', 'height', 'twist', 'scaleTop'],
  square: ['width', 'depth', 'cornerRadius', 'height', 'twist', 'scaleTop'],
  ring: ['width', 'depth', 'ratio', 'height', 'twist', 'scaleTop'],
  heart: ['width', 'depth', 'height', 'twist', 'scaleTop'],
  star5: ['width', 'depth', 'ratio', 'height', 'twist', 'scaleTop'],
  star6: ['width', 'depth', 'ratio', 'height', 'twist', 'scaleTop'],
  egg: ['width', 'depth', 'ratio', 'height', 'twist', 'scaleTop'],
  trapezoid: ['width', 'depth', 'ratio', 'height', 'twist', 'scaleTop'],
  cross: ['width', 'depth', 'ratio', 'height', 'twist', 'scaleTop'],
  drop: ['width', 'depth', 'height', 'twist', 'scaleTop'],
  crescent: ['width', 'depth', 'ratio', 'height', 'twist', 'scaleTop'],
  text: ['font', 'size', 'height', 'twist', 'scaleTop'],
};

/** Campi ricordati degli strumenti: Raccordo/Smusso/Smusso angolare (`edge`) e Guscio (`shell`). */
const TOOL_FIELDS = {
  edge: ['radius', 'distance1', 'distance2', 'angle', 'chamferMode', 'segments', 'cornerType', 'cornerDistance', 'cornerSegments'],
  shell: ['wall', 'bottom'],
} as const;

export type RememberedTool = keyof typeof TOOL_FIELDS;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const between = (v: unknown, min: number, max: number): boolean => finite(v) && v >= min && v <= max;

/** Un valore è accettabile per il campo: tipo giusto e dentro limiti larghi (i limiti veri li applicano slider e kernel). */
function isValid(field: string, value: unknown): boolean {
  switch (field) {
    case 'size':
      // Cubo: tre misure; dadi e testo: una sola
      return Array.isArray(value) ? value.length === 3 && value.every((v) => between(v, 0.01, 5000)) : between(value, 0.01, 5000);
    case 'segments':
      return Number.isInteger(value) && between(value, 3, 256);
    case 'cornerSegments':
      return Number.isInteger(value) && between(value, 8, 256) && (value as number) % 4 === 0;
    case 'cornerRadius':
    case 'bottom':
      return between(value, 0, 5000);
    case 'twist':
      return between(value, -3600, 3600);
    case 'scaleTop':
      return between(value, 0, 100);
    case 'ratio':
      return between(value, 0, 2);
    case 'angle':
      return between(value, 1, 179);
    case 'font':
      return typeof value === 'string' && FONTS.some((f) => f.id === value);
    case 'chamferMode':
      return value === 'equal' || value === 'two' || value === 'angle';
    case 'cornerType':
      return value === 'chamfer' || value === 'fillet';
    default:
      // Dimensioni (raggi, larghezza, altezza, distanze, spessori): positive
      return between(value, 0.01, 5000);
  }
}

/** I soli campi ammessi e validi di `source`. */
function filter(fields: readonly string[], source: unknown): Remembered {
  const out: Remembered = {};
  if (!source || typeof source !== 'object') return out;
  for (const field of fields) {
    const value = (source as Record<string, unknown>)[field];
    if (value !== undefined && isValid(field, value)) out[field] = Array.isArray(value) ? [...value] : (value as number | string);
  }
  return out;
}

interface LastState {
  shapes: Record<string, Remembered>;
  tools: Record<RememberedTool, Remembered>;
}

// I valori ricordati con il vecchio nome dell'app passano alla chiave nuova prima che lo store li legga
migrateLocalKey(STORAGE.last.legacy, STORAGE.last.now);

export const useLastValues = create<LastState>()(
  persist(() => ({ shapes: {}, tools: { edge: {}, shell: {} } }) as LastState, {
    name: STORAGE.last.now,
    version: 1,
    // Solo i dati noti, e validi: il localStorage può contenere di tutto
    merge: (saved, current) => {
      const s = (saved ?? {}) as Partial<LastState>;
      const shapes: Record<string, Remembered> = {};
      for (const [kind, fields] of Object.entries(SHAPE_FIELDS)) shapes[kind] = filter(fields, s.shapes?.[kind]);
      return {
        ...current,
        shapes,
        tools: { edge: filter(TOOL_FIELDS.edge, s.tools?.edge), shell: filter(TOOL_FIELDS.shell, s.tools?.shell) },
      };
    },
  }),
);

/** Ricorda i campi di `patch` che sono misure della forma `kind` (gli altri, come la posizione, si ignorano). */
export function rememberShape(kind: string, patch: object): void {
  const fields = SHAPE_FIELDS[kind];
  if (!fields) return;
  const picked = filter(fields, patch);
  if (Object.keys(picked).length === 0) return;
  useLastValues.setState((s) => ({ shapes: { ...s.shapes, [kind]: { ...s.shapes[kind], ...picked } } }));
}

/** Ultimi valori validi della forma `kind`, da applicare sopra i valori predefiniti. */
export function lastShape(kind: string): Remembered {
  const fields = SHAPE_FIELDS[kind];
  const out = fields ? filter(fields, useLastValues.getState().shapes[kind]) : {};
  // `size` è tre misure solo per il cubo: un valore dell'altra forma (localStorage manomesso) romperebbe la forma nuova
  if ('size' in out && Array.isArray(out.size) !== (kind === 'box')) delete out.size;
  return out;
}

/** Ricorda i campi di `patch` che sono impostazioni dello strumento. */
export function rememberTool(tool: RememberedTool, patch: object): void {
  const picked = filter(TOOL_FIELDS[tool], patch);
  if (Object.keys(picked).length === 0) return;
  useLastValues.setState((s) => ({ tools: { ...s.tools, [tool]: { ...s.tools[tool], ...picked } } }));
}

/** Ultime impostazioni valide dello strumento. */
export function lastTool(tool: RememberedTool): Remembered {
  return filter(TOOL_FIELDS[tool], useLastValues.getState().tools[tool]);
}

/** Numero ricordato di uno strumento, oppure undefined. */
export function lastToolNumber(tool: RememberedTool, field: string): number | undefined {
  const v = lastTool(tool)[field];
  return typeof v === 'number' ? v : undefined;
}
