import opentype from 'opentype.js';
import type { Font, PathCommand } from 'opentype.js';
import { SYMBOL_FONTS } from './fontCatalog';

/**
 * Contorni del testo per la forma Testo: lettura dei font TTF con opentype.js e appiattimento delle curve in poligoni
 * (CrossSection di manifold). Lo usano solo il kernel e i test, così la libreria resta fuori dal bundle principale.
 * I font si registrano prima di valutare la scena (`registerFont`): il kernel è sincrono.
 */

type Vec2 = [number, number];

const fonts = new Map<string, Font>();

/** Registra un font dai byte del file TTF. */
export function registerFont(id: string, data: ArrayBuffer): void {
  fonts.set(id, opentype.parse(data));
}

export const hasFont = (id: string) => fonts.has(id);

/** Nome di famiglia e stile come li dichiara il file (tabella dei nomi), per verificare il catalogo. */
export function fontNames(data: ArrayBuffer): { family: string; style: string } {
  const names = opentype.parse(data).names.windows;
  return { family: names?.fontFamily?.en ?? '', style: names?.fontSubfamily?.en ?? '' };
}

/**
 * OpenSCAD usa un corpo del font di `size × 100/72`: con lo stesso calcolo la dimensione del testo coincide con quella
 * di `text(size = ...)` (le maiuscole risultano alte circa `size`).
 */
const EM_PER_SIZE = 100 / 72;

/** Passi con cui si appiattiscono le curve (quadratiche dei TrueType, cubiche dei font OpenType/CFF). */
const QUADRATIC_STEPS = 8;
const CUBIC_STEPS = 12;

/** Appiattisce i comandi di un contorno di glifo (asse Y verso il basso) in poligoni. */
function flatten(commands: PathCommand[], out: Vec2[][]): void {
  let current: Vec2[] = [];
  let [x, y] = [0, 0];
  const close = () => {
    // Un contorno deve avere almeno tre punti; quelli ripetuti di fila si scartano
    const clean = current.filter((p, i) => i === 0 || p[0] !== current[i - 1][0] || p[1] !== current[i - 1][1]);
    if (clean.length > 2) out.push(clean);
    current = [];
  };
  for (const c of commands) {
    if (c.type === 'M') {
      close();
      [x, y] = [c.x!, c.y!];
      current.push([x, y]);
    } else if (c.type === 'L') {
      [x, y] = [c.x!, c.y!];
      current.push([x, y]);
    } else if (c.type === 'Q') {
      for (let i = 1; i <= QUADRATIC_STEPS; i++) {
        const t = i / QUADRATIC_STEPS;
        const u = 1 - t;
        current.push([u * u * x + 2 * u * t * c.x1! + t * t * c.x!, u * u * y + 2 * u * t * c.y1! + t * t * c.y!]);
      }
      [x, y] = [c.x!, c.y!];
    } else if (c.type === 'C') {
      for (let i = 1; i <= CUBIC_STEPS; i++) {
        const t = i / CUBIC_STEPS;
        const u = 1 - t;
        current.push([
          u ** 3 * x + 3 * u * u * t * c.x1! + 3 * u * t * t * c.x2! + t ** 3 * c.x!,
          u ** 3 * y + 3 * u * u * t * c.y1! + 3 * u * t * t * c.y2! + t ** 3 * c.y!,
        ]);
      }
      [x, y] = [c.x!, c.y!];
    } else {
      close();
    }
  }
  close();
}

/** Glifo di `char` nel font, oppure in un font di simboli registrato se il font non lo contiene (spazi esclusi). */
function glyphFor(font: Font, char: string): { glyph: ReturnType<Font['charToGlyph']>; owner: Font } {
  const glyph = font.charToGlyph(char);
  if (glyph.index !== 0 || /\s/.test(char)) return { glyph, owner: font };
  for (const symbols of SYMBOL_FONTS) {
    const fallback = fonts.get(symbols.id);
    const g = fallback?.charToGlyph(char);
    if (fallback && g && g.index !== 0) return { glyph: g, owner: fallback };
  }
  return { glyph, owner: font };
}

/**
 * Contorni del testo in mm, nel piano XY con Y verso l'alto. Centratura come `halign = "center", valign = "center"` di
 * OpenSCAD: in orizzontale sull'avanzamento totale della stringa, in verticale sul centro dell'ingombro dei glifi.
 * I glifi si dispongono a mano (avanzamento e crenatura): così non servono le tabelle di sostituzione dei font, che
 * opentype.js non legge tutte. Va usata con la regola di riempimento `NonZero` (i buchi di "O" o "A" sono contorni orari).
 */
export function textContours(node: { text: string; font: string; size: number }): Vec2[][] {
  const font = fonts.get(node.font);
  if (!font) throw new Error(`Font "${node.font}" non caricato.`);
  const em = Math.max(0.01, node.size) * EM_PER_SIZE;

  const contours: Vec2[][] = [];
  let pen = 0;
  let previous: ReturnType<Font['charToGlyph']> | null = null;
  let previousFont: Font | null = null;
  for (const char of node.text) {
    // Selettore di variante (U+FE0F) e legatura ZWJ (U+200D) non hanno glifo: un'emoji incollata con il selettore
    // dà un solo glifo, senza avanzamento in più
    const code = char.codePointAt(0);
    if (code === 0xfe0f || code === 0x200d) continue;
    // Il carattere che il font non ha (glifo 0) si prende da un font di simboli, se ce l'ha
    const { glyph, owner } = glyphFor(font, char);
    // La scala dipende dal corpo del font che ha fornito il glifo
    const scale = em / owner.unitsPerEm;
    if (previous && previousFont === owner) pen += owner.getKerningValue(previous, glyph) * scale;
    flatten(glyph.getPath(pen, 0, em).commands, contours);
    pen += (glyph.advanceWidth ?? 0) * scale;
    previous = glyph;
    previousFont = owner;
  }
  if (contours.length === 0) return [];

  // Asse Y verso l'alto e centro: orizzontale sull'avanzamento, verticale sull'ingombro
  const ys = contours.flatMap((c) => c.map((p) => -p[1]));
  const dy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return contours.map((c) => c.map(([px, py]): Vec2 => [round(px - pen / 2), round(-py - dy)]));
}
