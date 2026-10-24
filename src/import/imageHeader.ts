/**
 * Riconoscimento di PNG e JPG dai primi byte del file, con le dimensioni lette dall'intestazione: serve a rifiutare un'immagine
 * troppo grande PRIMA di decodificarla (`createImageBitmap` allocherebbe tutti i pixel) e a riconoscere il formato dal
 * contenuto e non dal tipo dichiarato dal browser (`file.type`, che dipende dall'estensione). Calcoli puri, senza API del browser.
 */

/** Oltre questi pixel (100 megapixel) la decodifica supererebbe la memoria di una scheda del browser. */
export const MAX_IMAGE_PIXELS = 100_000_000;

/** Byte iniziali da leggere per l'intestazione: bastano per il PNG; il JPEG ha l'intestazione dopo i segmenti (EXIF, profili...) che possono pesare centinaia di KB. */
export const HEADER_BYTES = 2 * 1024 * 1024;

export interface ImageHeader {
  format: 'png' | 'jpeg';
  w: number;
  h: number;
}

/** Messaggio di formato non riconosciuto (GIF, WebP, BMP, AVIF...). */
export const unsupportedFormat = () => new Error('Formato non supportato: servono immagini PNG, JPG o SVG.');

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((b, i) => bytes[i] === b);

/** Testo ASCII dei primi byte (per il blocco IHDR del PNG). */
const ascii = (bytes: Uint8Array, n: number) => String.fromCharCode(...bytes.subarray(0, n));

/** Dimensioni di un PNG: la firma di 8 byte, poi il blocco IHDR (lunghezza 13) con larghezza e altezza a 32 bit big endian (byte 16-23). */
function pngSize(bytes: Uint8Array): { w: number; h: number } {
  if (bytes.length < 24 || !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || ascii(bytes.subarray(12), 4) !== 'IHDR') throw new Error('Il file PNG è danneggiato: intestazione non valida.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

/**
 * Dimensioni di un JPEG: si scorrono i segmenti dopo FF D8 fino al primo marcatore SOF (C0-CF esclusi C4 = DHT, C8 = JPG e
 * CC = DAC, che non descrivono il fotogramma); altezza e larghezza sono due interi a 16 bit big endian dopo lunghezza e precisione.
 */
function jpegSize(bytes: Uint8Array): { w: number; h: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('Il file JPG è danneggiato: segmento non valido.');
    // Byte di riempimento FF prima del marcatore
    while (bytes[i + 1] === 0xff) i++;
    // Il file finisce nei byte di riempimento: manca il marcatore (o la sua lunghezza)
    if (i + 4 > bytes.length) break;
    const marker = bytes[i + 1];
    // Marcatori senza lunghezza: SOI, TEM, RSTn, EOI
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xd9) {
      i += 2;
      continue;
    }
    // Inizio della scansione: il fotogramma doveva essere già comparso
    if (marker === 0xda) break;
    const length = view.getUint16(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > bytes.length) break;
      return { h: view.getUint16(i + 5), w: view.getUint16(i + 7) };
    }
    if (length < 2) throw new Error('Il file JPG è danneggiato: segmento non valido.');
    i += 2 + length;
  }
  throw new Error('Il file JPG è danneggiato: dimensioni non trovate.');
}

/** Rifiuta le dimensioni nulle o oltre `MAX_IMAGE_PIXELS` (prodotto in virgola mobile: 50.000 × 50.000 non deve traboccare). */
export function assertImageSize(w: number, h: number): void {
  if (!(w > 0 && h > 0)) throw new Error('Il file non contiene un\'immagine: le dimensioni sono zero.');
  if (w * h > MAX_IMAGE_PIXELS) throw new Error(`L'immagine è troppo grande (${w} × ${h} pixel): il massimo è ${MAX_IMAGE_PIXELS / 1_000_000} megapixel, riducila prima di caricarla.`);
}

/**
 * Formato e dimensioni di un file dai suoi primi byte (`HEADER_BYTES`): PNG (`89 50 4E 47`) e JPEG (`FF D8 FF`). Altri formati
 * (GIF, WebP, BMP, AVIF...) danno «Formato non supportato» (l'SVG lo riconosce l'importatore dal testo, vedi `looksLikeSvg`); un'immagine
 * oltre il limite dei pixel un errore, senza decodificarla.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader {
  let header: ImageHeader;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) header = { format: 'png', ...pngSize(bytes) };
  else if (startsWith(bytes, [0xff, 0xd8, 0xff])) header = { format: 'jpeg', ...jpegSize(bytes) };
  else throw unsupportedFormat();
  assertImageSize(header.w, header.h);
  return header;
}
