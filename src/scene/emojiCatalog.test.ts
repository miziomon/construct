import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMOJI_FONT, EMOJI_GROUPS, EMOJIS } from './emojiCatalog';
import { EMOJI_SOURCE } from './emojiSource';
import { fontInfo } from './fontCatalog';
import { registerFont, textContours } from './fontOutline';

/** Glifo base di una voce dell'elenco: senza selettore di variante (U+FE0F) e, nelle sequenze ZWJ (U+200D), solo il primo elemento. */
const base = (item: string) => item.split(String.fromCharCode(0x200d))[0].split(String.fromCharCode(0xfe0f)).join('');

const sourceItems = EMOJI_SOURCE.split(',');
const sourceUnique = [...new Set(sourceItems.map(base))];

beforeAll(() => {
  const f = fontInfo(EMOJI_FONT);
  const b = readFileSync(`src/assets/fonts/${f.file}`);
  registerFont(f.id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
});

describe('catalogo delle emoji', () => {
  it('contiene tutte le emoji dell\'elenco fornito, ridotte al glifo base e senza ripetizioni', () => {
    // Nessuna dimenticata e nessuna in più
    expect(sourceUnique.filter((e) => !EMOJIS.includes(e))).toEqual([]);
    expect(EMOJIS.filter((e) => !sourceUnique.includes(e))).toEqual([]);
    expect(EMOJIS).toHaveLength(sourceUnique.length);
    expect(new Set(EMOJIS).size).toBe(EMOJIS.length);
  });

  it('l\'elenco di partenza ha le dimensioni attese (457 voci, 413 uniche)', () => {
    expect(sourceItems).toHaveLength(457);
    expect(sourceUnique).toHaveLength(413);
  });

  it('ogni emoji è un solo carattere, senza selettore di variante né ZWJ', () => {
    for (const e of EMOJIS) {
      expect([...e], e).toHaveLength(1);
      expect([0xfe0f, 0x200d]).not.toContain(e.codePointAt(0));
    }
  });

  it('le categorie hanno un titolo e nessuna è vuota', () => {
    expect(EMOJI_GROUPS.length).toBeGreaterThan(5);
    expect(new Set(EMOJI_GROUPS.map((g) => g.title)).size).toBe(EMOJI_GROUPS.length);
    expect(EMOJI_GROUPS.every((g) => g.emoji.length > 0)).toBe(true);
  });

  it('ogni emoji ha un contorno nel font: nessuna forma Testo esce vuota', () => {
    const empty = EMOJIS.filter((e) => textContours({ text: e, font: EMOJI_FONT, size: 10 }).length === 0);
    expect(empty).toEqual([]);
  });

  it('un\'emoji con selettore di variante dà lo stesso contorno di quella base', () => {
    const plain = textContours({ text: '❤', font: EMOJI_FONT, size: 10 });
    const withSelector = textContours({ text: '❤' + String.fromCharCode(0xfe0f), font: EMOJI_FONT, size: 10 });
    expect(withSelector).toEqual(plain);
  });
});
