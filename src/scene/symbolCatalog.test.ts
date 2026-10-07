import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { FONTS, fontInfo } from './fontCatalog';
import { hasFont, registerFont, textContours } from './fontOutline';
import { SYMBOLS, SYMBOL_GROUPS } from './symbolCatalog';

beforeAll(() => {
  for (const f of FONTS.filter((x) => x.category === 'Simboli')) {
    const b = readFileSync(`src/assets/fonts/${f.file}`);
    registerFont(f.id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  }
});

describe('catalogo dei simboli', () => {
  it('ha un buon numero di simboli, senza ripetizioni, raggruppati', () => {
    expect(SYMBOLS.length).toBeGreaterThan(100);
    expect(new Set(SYMBOLS.map((s) => s.char)).size).toBe(SYMBOLS.length);
    expect(SYMBOL_GROUPS.every((g) => g.symbols.length > 0)).toBe(true);
  });

  it('ogni simbolo è un solo carattere e usa un font di simboli del catalogo', () => {
    for (const s of SYMBOLS) {
      expect([...s.char], s.name).toHaveLength(1);
      expect(fontInfo(s.font).id, s.name).toBe(s.font);
      expect(fontInfo(s.font).category).toBe('Simboli');
    }
  });

  it('ogni simbolo ha davvero un glifo nel suo font: nessuna forma Testo esce vuota', () => {
    const empty = SYMBOLS.filter((s) => {
      expect(hasFont(s.font)).toBe(true);
      return textContours({ text: s.char, font: s.font, size: 10 }).length === 0;
    });
    expect(empty.map((s) => s.char)).toEqual([]);
  });
});
