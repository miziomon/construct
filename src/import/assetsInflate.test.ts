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

  it('input vuoto o troncato: errore, senza eccezioni grezze di lettura', () => {
    expect(() => decodeImage('img-e', '')).toThrow();
    const encoded = encodeImage({ id: 'img-t', w: 4, h: 4, gray: new Uint8Array(16) });
    expect(decodeImage('img-t', encoded).w).toBe(4);
    expect(() => decodeImage('img-t', encoded.slice(0, 8))).toThrow();
  });
});
