/**
 * Dichiarazione minima di opentype.js (la versione 2 non include i tipi): solo ciò che serve a src/scene/fontOutline.ts.
 */
declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export interface Glyph {
    /** Posizione del glifo nel font: 0 è il glifo "non definito" (carattere assente). */
    index: number;
    advanceWidth?: number;
    /** Contorno del glifo in pixel, con l'asse Y verso il basso. */
    getPath(x: number, y: number, fontSize: number): { commands: PathCommand[] };
  }
  export interface Font {
    unitsPerEm: number;
    /** Tabella dei nomi: `windows.fontFamily.en` è la famiglia, `windows.fontSubfamily.en` lo stile. */
    names: { windows?: Record<string, Record<string, string>> };
    charToGlyph(char: string): Glyph;
    /** Crenatura tra due glifi, in unità del font. */
    getKerningValue(left: Glyph, right: Glyph): number;
  }
  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}
