import type { GrayImage } from './textureMap';

/**
 * Texture di esempio generate nel codice (studio di fattibilità, non collegato all'app): immagini in scala di grigi
 * ripetibili senza cucitura (ogni onda ha un numero intero di periodi nella piastrella). Servono a test, benchmark e
 * prototipo senza file esterni; le stesse funzioni stanno nel blocco CORE di docs/prototipi/texture-immagine.html.
 */
export type SampleKind = 'knurl' | 'carbon' | 'leather' | 'bricks' | 'stone' | 'fabric' | 'waves' | 'noise';

/**
 * Le texture di esempio, nell'ordine della libreria del pannello. I mattoni (`bricks`) non ci sono più: duplicherebbero il rilievo
 * Mattoni del Pattern; restano nel codice per il prototipo e per i progetti salvati, che li leggono come pietra.
 */
export const SAMPLE_KINDS: SampleKind[] = ['knurl', 'carbon', 'leather', 'stone', 'fabric', 'waves', 'noise'];

/** Le varianti di ogni texture di esempio (la prima è quella di partenza e, per le texture che c'erano già, quella di prima). */
export const SAMPLE_VARIANTS: Record<SampleKind, string[]> = {
  knurl: ['diamond', 'straight', 'dots'],
  carbon: ['twill', 'plain', 'forged'],
  leather: ['fine', 'coarse', 'reptile'],
  bricks: ['plain'],
  stone: ['cobbles', 'slabs', 'gravel'],
  fabric: ['plain', 'basket', 'ribbed'],
  waves: ['parallel', 'concentric', 'fan'],
  noise: ['fine', 'clouds', 'grains'],
};

/** Indice di una variante dal suo nome (0 se il nome non è di questa texture). */
export const sampleVariantIndex = (kind: SampleKind, variant: string | undefined): number => Math.max(0, SAMPLE_VARIANTS[kind].indexOf(variant ?? ''));

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


/** Voronoi periodico (`n` celle per lato): distanza dal punto più vicino e dal secondo, indice della cella più vicina e posizione relativa del suo punto. */
function voronoi(u: number, v: number, n: number, seed: number, stagger = false): { f1: number; f2: number; cell: number; dy: number } {
  const px = u * n;
  const py = v * n;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let f1 = 9;
  let f2 = 9;
  let cell = 0;
  let dyNearest = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const cx = ix + di;
      const cy = iy + dj;
      // Il punto di una cella dipende dalla cella modulo n: la texture si ripete (con le file sfalsate `n` deve essere pari)
      const wx = ((cx % n) + n) % n;
      const wy = ((cy % n) + n) % n;
      const shift = stagger && wy % 2 === 1 ? 0.5 : 0;
      const dx = cx + shift + 0.15 + 0.7 * hash2(wx, wy, seed) - px;
      const dy = cy + 0.15 + 0.7 * hash2(wx, wy, seed + 18) - py;
      const d = Math.hypot(dx, dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        cell = wy * n + wx;
        dyNearest = dy;
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, cell, dy: dyNearest };
}

/** Valore pseudo casuale di una cella (indice intero) in 0..1. */
const cellRandom = (cell: number, seed: number) => hash2(cell, cell >> 7, seed);

/** Filo di un tessuto: profilo a mezza onda lungo il filo (`over` = sopra la trama, quindi più alto). */
const thread = (along: number, over: boolean) => (over ? 0.55 + 0.45 * Math.sin(Math.PI * along) : 0.2 + 0.25 * Math.sin(Math.PI * along));

/** Il filo di sopra la trama e quello di sotto occupano 0,2-1: per le trame nuove si riporta a 0-1 (il campo intero della scala di grigi). */
const fullRange = (t: number) => (t - 0.2) / 0.8;

/** Rumore di valori periodico con `period` nodi per lato: interpolazione smussata dei valori casuali dei nodi (modulo il periodo). */
function periodicNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(0, 1, x - ix);
  const fy = smoothstep(0, 1, y - iy);
  const at = (i: number, j: number) => hash2(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = at(ix, iy);
  const b = at(ix + 1, iy);
  const c = at(ix, iy + 1);
  const d = at(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Le varianti della libreria (docs: «Variante» del Pattern Immagine). Ogni texture ha 3 varianti e la prima (indice 0) è quella
 * di prima, per le texture che già c'erano. Tutte si ripetono senza cucitura: sono funzioni periodiche di (u, v) con periodo 1.
 * Restituisce null per le combinazioni che calcola `sampleValue` (le varianti 0 delle texture originali).
 */
function variantValue(kind: SampleKind, variant: number, u: number, v: number): number | null {
  if (kind === 'knurl') {
    if (variant === 1) return 1 - tri(16 * u + 0.5); // dritta: creste parallele
    if (variant === 2) {
      // a punti: cupole in una griglia 8 x 8
      const d = Math.hypot(fract(u * 8) - 0.5, fract(v * 8) - 0.5) / 0.42;
      return d >= 1 ? 0.05 : 0.05 + 0.95 * Math.sqrt(1 - d * d);
    }
    return null;
  }
  if (kind === 'carbon') {
    if (variant === 1) {
      // tela: un filo sopra e uno sotto
      const cu = u * 8;
      const cv = v * 8;
      const over = (Math.floor(cu) + Math.floor(cv)) % 2 === 0;
      return fullRange(thread(over ? fract(cv) : fract(cu), over));
    }
    if (variant === 2) {
      // forgiato: scaglie 10 x 10 con le fibre in direzioni casuali
      const n = 10;
      const cu = u * n;
      const cv = v * n;
      const h = hash2(((Math.floor(cu) % n) + n) % n, ((Math.floor(cv) % n) + n) % n, 7);
      const x = fract(cu) - 0.5;
      const y = fract(cv) - 0.5;
      const angle = h * Math.PI;
      const stripe = 0.5 + 0.5 * Math.sin(2 * Math.PI * (4 * (x * Math.cos(angle) + y * Math.sin(angle)) + h * 5));
      const edge = smoothstep(0, 0.1, 0.5 - Math.max(Math.abs(x), Math.abs(y)));
      return (0.2 + 0.55 * stripe + 0.2 * h) * edge + 0.05 * (1 - edge);
    }
    return null;
  }
  if (kind === 'leather') {
    if (variant === 1) {
      // grossa: celle 6 x 6 con le crepe larghe
      const { f1, f2 } = voronoi(u, v, 6, 11);
      return smoothstep(0, 0.4, f2 - f1) * 0.9 + 0.1 * hash2(Math.floor(u * 24), Math.floor(v * 24), 5);
    }
    if (variant === 2) {
      // rettile: scaglie a file sfalsate (14 per lato), più chiare in alto
      const { f1, f2, dy } = voronoi(u, v, 14, 13, true);
      return smoothstep(0, 0.3, f2 - f1) * (0.45 + 0.55 * Math.min(1, Math.max(0, 0.5 - dy * 0.9))) + 0.05 * hash2(Math.floor(u * 56), Math.floor(v * 56), 9);
    }
    return null;
  }
  if (kind === 'stone') {
    if (variant === 1) {
      // lastroni: poche celle grandi, piatte, con fughe larghe e piccole differenze di quota
      const { f1, f2, cell } = voronoi(u, v, 4, 21);
      return smoothstep(0.02, 0.1, f2 - f1) * (0.75 + 0.25 * cellRandom(cell, 3)) + 0.04;
    }
    if (variant === 2) {
      // ghiaia: tanti sassolini piccoli, ognuno con la sua quota
      const { f1, f2, cell } = voronoi(u, v, 22, 31);
      return Math.sqrt(smoothstep(0, 0.4, f2 - f1)) * (0.45 + 0.55 * cellRandom(cell, 4));
    }
    // ciottoli: celle di Voronoi arrotondate (7 per lato), ognuna più o meno alta
    const { f1, f2, cell } = voronoi(u, v, 7, 17);
    return Math.pow(smoothstep(0, 0.3, f2 - f1), 0.6) * (0.7 + 0.3 * cellRandom(cell, 2));
  }
  if (kind === 'fabric') {
    if (variant === 2) {
      // costine: coste orizzontali con la grana del filo in verticale
      const rib = 0.5 + 0.5 * Math.sin(2 * Math.PI * 10 * v);
      // 32 periodi di grana per piastrella: 0,63 mm su 20 mm, sopra il passo di 0,5 mm della mappa di altezze
      const grain = 0.5 + 0.5 * Math.sin(2 * Math.PI * 32 * u);
      return 0.15 + 0.85 * rib * (0.75 + 0.25 * grain);
    }
    // tela (un filo sopra e uno sotto) e panama (blocchi 2 x 2), 16 fili per lato
    const cu = u * 16;
    const cv = v * 16;
    const i = Math.floor(cu);
    const j = Math.floor(cv);
    const over = variant === 1 ? (Math.floor(i / 2) + Math.floor(j / 2)) % 2 === 0 : (i + j) % 2 === 0;
    return fullRange(thread(over ? fract(cv) : fract(cu), over));
  }
  if (kind === 'waves') {
    if (variant === 1) return 0.5 + 0.5 * Math.cos(2 * Math.PI * 6 * Math.hypot(u - 0.5, v - 0.5)); // concentriche
    if (variant === 2) {
      // a ventaglio (seigaiha): cerchi a file sfalsate che si sovrappongono, ognuno con tre anelli; vale il cerchio della fila più alta
      const n = 5;
      const x = u * n;
      const y = v * n;
      let best = -1;
      let value = 0.5;
      for (let j = Math.floor((y - 1) / 0.5); j <= Math.floor((y + 1) / 0.5); j++) {
        for (let i = Math.floor(x - 1.5); i <= Math.ceil(x + 1); i++) {
          const d = Math.hypot(x - (i + 0.5 * (((j % 2) + 2) % 2)), y - j * 0.5);
          if (d < 1 && j > best) {
            best = j;
            value = 0.5 + 0.5 * Math.cos(2 * Math.PI * 3 * d);
          }
        }
      }
      return value;
    }
    return null;
  }
  if (kind === 'noise') {
    if (variant === 1) {
      // nuvole: rumore di valori a quattro ottave, con più contrasto
      let sum = 0;
      let total = 0;
      for (let o = 0; o < 4; o++) {
        const amp = 0.5 ** o;
        sum += amp * periodicNoise(u, v, 4 << o, 40 + o);
        total += amp;
      }
      return smoothstep(0.25, 0.75, sum / total);
    }
    if (variant === 2) {
      // granuli: sassolini sparsi su un fondo basso (griglia 24 x 24, un granulo ogni due celle circa: su una piastrella da 20 mm le celle
      // sono di 0,83 mm, sopra il passo di 0,5 mm della mappa di altezze)
      const n = 24;
      const x = u * n;
      const y = v * n;
      let value = 0.05;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const cx = Math.floor(x) + di;
          const cy = Math.floor(y) + dj;
          const wx = ((cx % n) + n) % n;
          const wy = ((cy % n) + n) % n;
          if (hash2(wx, wy, 61) < 0.5) continue;
          const radius = 0.25 + 0.3 * hash2(wx, wy, 62);
          const d = Math.hypot(cx + 0.2 + 0.6 * hash2(wx, wy, 63) - x, cy + 0.2 + 0.6 * hash2(wx, wy, 64) - y) / radius;
          if (d < 1) value = Math.max(value, 0.2 + 0.8 * Math.sqrt(1 - d * d) * (0.6 + 0.4 * hash2(wx, wy, 65)));
        }
      }
      return value;
    }
    return null;
  }
  return null;
}

/** Valore 0..1 della texture nel punto (u, v) della piastrella (u e v in 0..1, v verso l'alto); `variant` è l'indice in `SAMPLE_VARIANTS` (0 se manca). */
export function sampleValue(kind: SampleKind, rawU: number, rawV: number, variant = 0): number {
  // Funzione periodica di periodo 1 (come una piastrella ripetuta): fuori da 0..1 si torna dentro; dentro 0..1 `fract` non cambia nulla
  const u = fract(rawU);
  const v = fract(rawV);
  const alt = variantValue(kind, variant, u, v);
  if (alt !== null) return alt;
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
export function makeSample(kind: SampleKind, size: number, variant = 0): GrayImage {
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) data[j * size + i] = Math.round(Math.min(1, Math.max(0, sampleValue(kind, (i + 0.5) / size, 1 - (j + 0.5) / size, variant))) * 255);
  }
  return { w: size, h: size, data };
}

/** SVG di prova (stemma: anello e stella, 100 x 100 unità): usato per confrontare la strada vettoriale con la rasterizzazione. */
export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <path fill-rule="evenodd" d="M50 4 A46 46 0 1 1 49.99 4 Z M50 12 A38 38 0 1 0 50.01 12 Z"/>
  <polygon points="50,22 58,42 80,42 62,55 69,76 50,63 31,76 38,55 20,42 42,42"/>
</svg>`;
