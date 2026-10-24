import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_PIXELS, assertImageSize, readImageHeader } from './imageHeader';

/** Intestazione PNG sintetica: firma, blocco IHDR con larghezza e altezza (pochi byte, nessun pixel). */
function png(w: number, h: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, w);
  view.setUint32(20, h);
  bytes.set([8, 2, 0, 0, 0], 24);
  return bytes;
}

/** Segmento JPEG: marcatore, lunghezza (compresa) e contenuto. */
const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
/** Segmento SOF: precisione 8, altezza, larghezza, una componente. */
const sof = (marker: number, w: number, h: number) => segment(marker, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]);
const jpeg = (...segments: number[][]) => Uint8Array.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0, 2]);

describe('intestazione di PNG e JPEG', () => {
  it('PNG: dimensioni dal blocco IHDR (byte 16-23), anche enormi: bastano pochi byte per rifiutarlo senza decodificarlo', () => {
    expect(readImageHeader(png(640, 480))).toEqual({ format: 'png', w: 640, h: 480 });
    // Esattamente 100 megapixel: ammesso; uno di più: rifiutato
    expect(readImageHeader(png(10_000, 10_000)).w).toBe(10_000);
    expect(() => readImageHeader(png(10_001, 10_000))).toThrow(/troppo grande/);
    // 50.000 × 50.000 (2,5 miliardi di pixel) in 33 byte
    const bomb = png(50_000, 50_000);
    expect(bomb.length).toBe(33);
    expect(() => readImageHeader(bomb)).toThrow(/troppo grande \(50000 × 50000 pixel\).*100 megapixel/);
    // Larghezza e altezza a 32 bit senza segno: non devono diventare negative
    expect(() => readImageHeader(png(0xffffffff, 0xffffffff))).toThrow(/troppo grande/);
  });

  it('PNG: firma o IHDR sbagliati, troncato, dimensioni nulle', () => {
    expect(() => readImageHeader(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))).toThrow(/danneggiato/);
    const noIhdr = png(10, 10);
    noIhdr[13] = 0x00;
    expect(() => readImageHeader(noIhdr)).toThrow(/danneggiato/);
    expect(() => readImageHeader(png(0, 10))).toThrow(/dimensioni sono zero/);
    expect(() => readImageHeader(png(10, 0))).toThrow(/dimensioni sono zero/);
  });

  it('JPEG: si scorrono i segmenti fino al SOF (C0-CF esclusi C4, C8, CC), qualunque sia il tipo', () => {
    const app = segment(0xe1, new Array(300).fill(7));
    const dht = segment(0xc4, [0, 1, 2, 3, 4, 5]);
    expect(readImageHeader(jpeg(app, sof(0xc0, 800, 600)))).toEqual({ format: 'jpeg', w: 800, h: 600 });
    // SOF2 (progressivo) e SOF9 (aritmetico) sono fotogrammi come gli altri
    expect(readImageHeader(jpeg(app, sof(0xc2, 1024, 768)))).toMatchObject({ w: 1024, h: 768 });
    expect(readImageHeader(jpeg(sof(0xc9, 33, 44)))).toMatchObject({ w: 33, h: 44 });
    // DHT (C4), JPG (C8) e DAC (CC) non sono fotogrammi: si saltano e si trova il SOF vero
    expect(readImageHeader(jpeg(dht, segment(0xc8, [1, 2]), segment(0xcc, [3, 4]), sof(0xc1, 50, 60)))).toMatchObject({ w: 50, h: 60 });
    // Byte di riempimento FF prima del marcatore
    const padded = Uint8Array.from([0xff, 0xd8, 0xff, 0xff, 0xff, 0xe0, 0, 4, 0, 0, ...sof(0xc0, 12, 34), 0xff, 0xda, 0, 2]);
    expect(readImageHeader(padded)).toMatchObject({ w: 12, h: 34 });
  });

  it('JPEG enorme: rifiutato dall\'intestazione, senza decodificare', () => {
    expect(() => readImageHeader(jpeg(sof(0xc0, 20_000, 20_000)))).toThrow(/troppo grande \(20000 × 20000 pixel\)/);
    expect(readImageHeader(jpeg(sof(0xc0, 10_000, 10_000)))).toMatchObject({ w: 10_000, h: 10_000 });
  });

  it('JPEG che finisce nei byte di riempimento FF: «danneggiato», non un errore grezzo di lettura', () => {
    for (const bytes of [[0xff, 0xd8, 0xff, 0xff, 0xff], [0xff, 0xd8, 0xff, 0xff, 0xff, 0xff, 0xff], [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xff, 0xff]]) {
      let error: unknown;
      try {
        readImageHeader(Uint8Array.from(bytes));
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(RangeError);
      expect((error as Error).message).toMatch(/danneggiato/);
    }
  });

  it('JPEG senza SOF, troncato o con segmenti sbagliati: errore chiaro', () => {
    expect(() => readImageHeader(jpeg(segment(0xe0, [1, 2, 3])))).toThrow(/danneggiato/);
    expect(() => readImageHeader(Uint8Array.from([0xff, 0xd8, 0xff]))).toThrow(/danneggiato/);
    expect(() => readImageHeader(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0, 0]))).toThrow(/danneggiato/);
    expect(() => readImageHeader(Uint8Array.from([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0]))).toThrow(/danneggiato|Formato/);
  });

  it('il formato si riconosce dai primi byte: GIF, WebP, BMP, AVIF e testo sono «Formato non supportato» (l\'SVG lo riconosce l\'importatore dal testo)', () => {
    const text = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
    const others: [string, Uint8Array][] = [
      ['GIF', text('GIF89a\x01\x00\x01\x00')],
      ['WebP', text('RIFF\x00\x00\x00\x00WEBPVP8 ')],
      ['BMP', text('BM\x00\x00\x00\x00\x00\x00')],
      ['AVIF', Uint8Array.from([0, 0, 0, 0x1c, ...text('ftypavif')])],
      ['testo', text('questo non è un PNG')],
      ['SVG (non è un raster)', text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ['vuoto', new Uint8Array(0)],
    ];
    for (const [, bytes] of others) expect(() => readImageHeader(bytes)).toThrow(/^Formato non supportato: servono immagini PNG, JPG o SVG\.$/);
  });

  it('assertImageSize: i limiti, in virgola mobile (nessun traboccamento a 32 bit)', () => {
    expect(() => assertImageSize(1, 1)).not.toThrow();
    expect(() => assertImageSize(MAX_IMAGE_PIXELS, 1)).not.toThrow();
    expect(() => assertImageSize(MAX_IMAGE_PIXELS + 1, 1)).toThrow();
    expect(() => assertImageSize(65_536, 65_536)).toThrow(/troppo grande/);
    expect(() => assertImageSize(Number.NaN, 5)).toThrow();
  });
});
