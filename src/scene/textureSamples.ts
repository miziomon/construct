import type { GrayImage } from './textureMap';

/**
 * Texture di esempio generate nel codice (studio di fattibilità, non collegato all'app): immagini in scala di grigi
 * ripetibili senza cucitura (ogni onda ha un numero intero di periodi nella piastrella). Servono a test, benchmark e
 * prototipo senza file esterni; le stesse funzioni stanno nel blocco CORE di docs/prototipi/texture-immagine.html.
 */
export type SampleKind = 'knurl' | 'carbon' | 'leather' | 'bricks' | 'waves' | 'noise';

/** Le texture di esempio, nell'ordine della libreria del pannello. */
export const SAMPLE_KINDS: SampleKind[] = ['knurl', 'carbon', 'leather', 'bricks', 'waves', 'noise'];

/** Hash intero 2D (nessuna tabella, stesso risultato ovunque) in 0..1. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fract = (v: number) => v - Math.floor(v);
const tri = (v: number) => Math.abs(fract(v) - 0.5) * 2;
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Valore 0..1 della texture nel punto (u, v) della piastrella (u e v in 0..1, v verso l'alto). */
export function sampleValue(kind: SampleKind, u: number, v: number): number {
  if (kind === 'knurl') {
    // Zigrinatura a rombi: piramidi a base quadrata ruotate di 45 gradi (8 per lato)
    return 1 - Math.max(tri(4 * (u + v)), tri(4 * (u - v)));
  }
  if (kind === 'carbon') {
    // Tessuto a saia 2 x 2: cella 8 x 8 per piastrella, il filo sopra ha un profilo a mezza onda
    const cu = u * 8;
    const cv = v * 8;
    const i = Math.floor(cu);
    const j = Math.floor(cv);
    const horizontalOver = (i + j) % 4 < 2;
    const along = horizontalOver ? fract(cv) : fract(cu);
    return horizontalOver ? 0.55 + 0.45 * Math.sin(Math.PI * along) : 0.2 + 0.25 * Math.sin(Math.PI * along);
  }
  if (kind === 'leather') {
    // Pelle: celle di Voronoi (12 x 12 per piastrella, punti sfalsati dal seme) con le crepe tra le celle
    const n = 12;
    const px = u * n;
    const py = v * n;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    let f1 = 9;
    let f2 = 9;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const cx = ix + di;
        const cy = iy + dj;
        // Il punto della cella dipende dalla cella modulo n: la texture si ripete
        const wx = ((cx % n) + n) % n;
        const wy = ((cy % n) + n) % n;
        const dx = cx + 0.15 + 0.7 * hash2(wx, wy, 11) - px;
        const dy = cy + 0.15 + 0.7 * hash2(wx, wy, 29) - py;
        const d = Math.hypot(dx, dy);
        if (d < f1) [f1, f2] = [d, f1];
        else if (d < f2) f2 = d;
      }
    }
    return smoothstep(0, 0.35, f2 - f1) * 0.85 + 0.15 * hash2(Math.floor(px * 4), Math.floor(py * 4), 5);
  }
  if (kind === 'bricks') {
    // 4 file di 2 mattoni, file dispari sfalsate di mezzo mattone, fughe scure
    const row = Math.floor(v * 4);
    const x = fract(u * 2 + (row % 2) * 0.5);
    const y = fract(v * 4);
    const inBrick = x > 0.06 && x < 0.94 && y > 0.1 && y < 0.9;
    return inBrick ? 0.8 + 0.2 * hash2(Math.floor(u * 2 + (row % 2) * 0.5), row, 3) : 0.05;
  }
  if (kind === 'waves') {
    // Onde: tre periodi in u, deformate da due periodi in v
    return 0.5 + 0.5 * Math.sin(2 * Math.PI * (3 * u + 0.35 * Math.sin(2 * Math.PI * 2 * v)));
  }
  // Rumore: valori casuali per pixel (il caso peggiore per la compressione)
  return hash2(Math.floor(u * 4096), Math.floor(v * 4096), 1);
}

/** Immagine `size` x `size` della texture; il centro del pixel (i, j) vale `sampleValue((i + 0,5) / size, 1 - (j + 0,5) / size)`. */
export function makeSample(kind: SampleKind, size: number): GrayImage {
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) data[j * size + i] = Math.round(Math.min(1, Math.max(0, sampleValue(kind, (i + 0.5) / size, 1 - (j + 0.5) / size))) * 255);
  }
  return { w: size, h: size, data };
}

/** SVG di prova (stemma: anello e stella, 100 x 100 unità): usato per confrontare la strada vettoriale con la rasterizzazione. */
export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <path fill-rule="evenodd" d="M50 4 A46 46 0 1 1 49.99 4 Z M50 12 A38 38 0 1 0 50.01 12 Z"/>
  <polygon points="50,22 58,42 80,42 62,55 69,76 50,63 31,76 38,55 20,42 42,42"/>
</svg>`;
