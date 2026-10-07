import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONTS, FONT_CATEGORIES, fontInfo, fontsUsed, scadFontName } from './fontCatalog';
import { fontNames } from './fontOutline';

const bytes = (file: string) => {
  const b = readFileSync(`src/assets/fonts/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Vero se la tabella (tag di 4 lettere) compare nella directory delle tabelle del TTF. */
function hasFontTable(data: ArrayBuffer, tag: string): boolean {
  const view = new DataView(data);
  const count = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3)) === tag) return true;
  }
  return false;
}

describe('catalogo dei font', () => {
  it('sono venti di testo e quattro di simboli, con id e file unici', () => {
    expect(FONTS.filter((f) => f.category !== 'Simboli')).toHaveLength(20);
    expect(FONTS.filter((f) => f.category === 'Simboli')).toHaveLength(4);
    expect(new Set(FONTS.map((f) => f.id)).size).toBe(FONTS.length);
    expect(new Set(FONTS.map((f) => f.file)).size).toBe(FONTS.length);
  });

  it('i gruppi del menu coprono tutti i font di testo', () => {
    for (const f of FONTS.filter((x) => x.category !== 'Simboli')) expect(FONT_CATEGORIES).toContain(f.category);
  });

  it.each(FONTS)('$label: il file è un TTF e famiglia e stile coincidono con quelli dichiarati', (f) => {
    const data = bytes(f.file);
    // Intestazione TrueType (0x00010000) o OpenType (OTTO)
    expect([0x00010000, 0x4f54544f]).toContain(new DataView(data).getUint32(0));
    expect(fontNames(data)).toEqual({ family: f.family, style: f.style });
    // Font statico: opentype.js legge solo l'istanza predefinita dei font variabili (non il grassetto)
    expect(hasFontTable(data, 'fvar')).toBe(false);
    expect(scadFontName(f)).toBe(`${f.family}:style=${f.style}`);
  });

  it('fontInfo ripiega sul primo font se l\'id non esiste, fontsUsed elenca solo quelli usati', () => {
    expect(fontInfo('non-esiste').id).toBe(FONTS[0].id);
    const scene = {
      nodes: {
        a: { type: 'shape2d', kind: 'text', font: 'pacifico' },
        b: { type: 'shape2d', kind: 'text', font: 'pacifico' },
        c: { type: 'shape2d', kind: 'text', font: 'anton' },
        d: { type: 'shape2d', kind: 'circle' },
        e: { type: 'primitive', kind: 'box' },
      },
    };
    expect(fontsUsed(scene).map((f) => f.id)).toEqual(['anton', 'pacifico']);
    expect(fontsUsed({ nodes: {} })).toEqual([]);
  });
});
