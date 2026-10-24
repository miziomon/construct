import { describe, expect, it, vi } from 'vitest';
import { zlibSync } from 'fflate';

/**
 * La decompressione di un'immagine del progetto non deve allocare più del tetto: si registrano le dimensioni dei blocchi che
 * `Unzlib` consegna (fflate decomprime tutto l'input di un `push` prima di chiamare `ondata`).
 */
const chunkSizes = vi.hoisted(() => [] as number[]);
vi.mock('fflate', async (original) => {
  const real = await original<typeof import('fflate')>();
  class SpyUnzlib extends real.Unzlib {
    constructor(callback: (chunk: Uint8Array, final: boolean) => void) {
      super((chunk, final) => {
        chunkSizes.push(chunk.length);
        callback(chunk, final);
      });
    }
  }
  return { ...real, Unzlib: SpyUnzlib };
});

const { decodeImage, encodeImage } = await import('./assets');

const toBase64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

describe('decodeImage: memoria limitata', () => {
  it('una bomba da 64 MB di zeri si ferma al primo blocco oltre il tetto: nessun blocco enorme, e pochi MB in tutto', () => {
    chunkSizes.length = 0;
    const raw = new Uint8Array(8 + 64 * 1024 * 1024);
    new Uint32Array(raw.buffer, 0, 2).set([512, 512]);
    const compressed = zlibSync(raw, { level: 9 });
    expect(compressed.length).toBeLessThan(200_000);
    expect(() => decodeImage('img-bomb', toBase64(compressed))).toThrow(/non valida/);
    // Con fette di 1 KB di input ogni blocco sta sotto 2 MB (rapporto massimo di deflate 1032:1) e si smette subito dopo il tetto
    expect(Math.max(...chunkSizes)).toBeLessThan(2 * 1024 * 1024);
    expect(chunkSizes.reduce((a, b) => a + b, 0)).toBeLessThan(8 * 1024 * 1024);
  });

  it("un'immagine vera (512 × 512, anche compressa a pochi KB) si decodifica identica con lo stesso metodo", () => {
    const gray = Uint8Array.from({ length: 512 * 512 }, (_, i) => (i * 7) % 251);
    const back = decodeImage('img-ok', encodeImage({ id: 'img-ok', w: 512, h: 512, gray }));
    expect(Array.from(back.gray)).toEqual(Array.from(gray));
    const flat = decodeImage('img-flat', encodeImage({ id: 'img-flat', w: 512, h: 512, gray: new Uint8Array(512 * 512) }));
    expect([flat.w, flat.h]).toEqual([512, 512]);
  });

  it('dati non validi: sempre il messaggio generico, mai gli errori grezzi di fflate o di atob', () => {
    const generic = /^Immagine del progetto non valida\.$/;
    const gray = Uint8Array.from({ length: 64 * 64 }, (_, i) => (i * 31) % 256);
    const zlib = zlibSync(Uint8Array.from([...new Uint8Array(new Uint32Array([64, 64]).buffer), ...gray]), { level: 6 });
    expect(zlib.length).toBeGreaterThan(100);
    const encode = (bytes: Uint8Array) => toBase64(bytes);
    const cases: [string, string][] = [
      ['zlib troncato a metà', encode(zlib.subarray(0, zlib.length >> 1))],
      ['zlib senza l\'ultimo byte', encode(zlib.subarray(0, zlib.length - 1))],
      ['zlib senza il controllo Adler-32', encode(zlib.subarray(0, zlib.length - 4))],
      ['zlib con il solo inizio', encode(zlib.subarray(0, 3))],
      ['zlib con intestazione sbagliata', encode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]))],
      ['spazzatura (byte casuali validi in base64)', encode(Uint8Array.from({ length: 300 }, (_, i) => (i * 97 + 13) % 256))],
      ['input vuoto', ''],
      ['base64 non valido (carattere)', 'non è base64!!'],
      ['base64 non valido (lunghezza)', 'AAAAA'],
      ['solo spazi', '    '],
    ];
    for (const [what, input] of cases) {
      let message = '';
      try {
        decodeImage('img-x', input);
      } catch (e) {
        message = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
      }
      expect(message, what).toMatch(/^Error: Immagine del progetto non valida\.$/);
      expect(message, what).toMatch(new RegExp(`^Error: ${generic.source.slice(1, -1)}$`));
    }
    // Con dati validi nessun errore
    expect(decodeImage('img-v', encode(zlib)).w).toBe(64);
  });

  it('il tetto di memoria dà il suo messaggio preciso (non quello generico)', () => {
    const raw = new Uint8Array(8 + 8 * 1024 * 1024);
    new Uint32Array(raw.buffer, 0, 2).set([512, 512]);
    expect(() => decodeImage('img-big', toBase64(zlibSync(raw, { level: 9 })))).toThrow(/più grande di 512 pixel di lato/);
  });

  it('intestazione e lunghezza incoerenti: messaggio generico', () => {
    expect(() => decodeImage('img-i', encodeImage({ id: 'img-i', w: 8, h: 8, gray: new Uint8Array(16) }))).toThrow(/^Immagine del progetto non valida\.$/);
    expect(() => decodeImage('img-z', encodeImage({ id: 'img-z', w: 0, h: 0, gray: new Uint8Array(0) }))).toThrow(/^Immagine del progetto non valida\.$/);
  });
});
