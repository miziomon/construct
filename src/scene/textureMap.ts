/**
 * Texture da immagine come mappa di spostamento (studio di fattibilità, non collegato all'app; vedi
 * docs/studio-texture-immagine.md). Calcoli puri e deterministici: un'immagine in scala di grigi a 8 bit diventa una
 * funzione di quota `h(u, v)` in mm, da campionare su una griglia (motore F, faccia piana, `sampleGrid`) oppure da
 * calcolare per ogni vertice di una mesh lungo la sua normale (motore M, stile Blender Displace / BumpMesh).
 *
 * Convenzioni:
 * - l'immagine è `w x h` pixel, riga 0 in alto (come in PNG, JPG e canvas), valori 0 (nero) a 255 (bianco);
 * - il centro del pixel (i, j) sta in s = (i + 0,5) / w e t = 1 - (j + 0,5) / h della piastrella (`t` cresce verso l'alto, come l'asse Y della faccia, perché la riga 0 è in alto);
 * - una piastrella è larga `tile` mm e alta `tile * h / w` mm (le proporzioni dell'immagine restano);
 * - il valore bianco è alto: con `invert` si scambiano.
 */

/** Immagine in scala di grigi a 8 bit, già decodificata (è questa, non il file, che si salva e si identifica con l'hash). */
export interface GrayImage {
  w: number;
  h: number;
  data: Uint8Array;
}

/** Modo di applicare la quota: solo rilievo (sopra la faccia), solo incavo (sotto) o entrambi attorno al livello medio. */
export type TextureMode = 'relief' | 'groove' | 'both';

export interface TextureParams {
  /** Larghezza della piastrella (mm). */
  tile: number;
  /** Ripetizione: se falso l'immagine compare una volta sola e fuori dalla piastrella la quota è 0. */
  repeat: boolean;
  /** Rotazione della texture (gradi, antioraria) attorno al punto di scostamento. */
  rotation: number;
  /** Scostamento dell'origine della piastrella (mm). */
  offset: [number, number];
  /** Scambia nero e bianco. */
  invert: boolean;
  /** Livello medio 0 a 1: il grigio che resta sulla faccia (Blender: Midlevel; BumpMesh: 50 % fisso). */
  midlevel: number;
  /** Ampiezza (mm): quota massima del bianco sopra il livello medio (relief e both) o del nero sotto (groove). */
  amplitude: number;
  /** Raggio della sfocatura a scatola in pixel (0 = nessuna): toglie la grana dei JPG e i gradini dei pixel grandi. */
  blur: number;
  mode: TextureMode;
}

export const textureDefaults = (): TextureParams => ({
  tile: 20,
  repeat: true,
  rotation: 0,
  offset: [0, 0],
  invert: false,
  midlevel: 0.5,
  amplitude: 0.6,
  blur: 0,
  mode: 'relief',
});

const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Limiti obbligatori: senza di essi una piastrella nulla o infinita darebbe divisioni per zero e griglie enormi. */
export function normalizeTexture(p: Partial<TextureParams>): TextureParams {
  const d = textureDefaults();
  return {
    tile: clamp(finite(p.tile ?? d.tile, d.tile), 0.5, 1000),
    repeat: p.repeat ?? d.repeat,
    rotation: finite(p.rotation ?? d.rotation, 0) % 360,
    offset: [clamp(finite(p.offset?.[0] ?? 0, 0), -10000, 10000), clamp(finite(p.offset?.[1] ?? 0, 0), -10000, 10000)],
    invert: p.invert ?? d.invert,
    midlevel: clamp(finite(p.midlevel ?? d.midlevel, d.midlevel), 0, 1),
    amplitude: clamp(finite(p.amplitude ?? d.amplitude, d.amplitude), 0, 20),
    blur: Math.round(clamp(finite(p.blur ?? d.blur, 0), 0, 20)),
    mode: p.mode === 'groove' || p.mode === 'both' ? p.mode : 'relief',
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Immagine: conversione a grigio, ridimensionamento, sfocatura
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Da RGBA a 8 bit (come lo restituisce `getImageData` o `createImageBitmap`) a scala di grigi, con una formula INTERA sui
 * valori sRGB così come sono (nessuna linearizzazione, nessun profilo colore): `Y = (77 R + 150 G + 29 B + 128) >> 8`
 * (pesi di Rec. 601 arrotondati, la somma dei pesi è 256). I pixel semitrasparenti si compongono prima sul bianco (la
 * carta), con aritmetica intera: il risultato è identico su ogni browser e su Node, purché i canali RGBA in ingresso lo siano.
 */
export function rgbaToGray(rgba: ArrayLike<number>, w: number, h: number): GrayImage {
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3];
    // Composizione sul bianco, arrotondata all'intero più vicino
    const mix = (c: number) => Math.floor((c * a + 255 * (255 - a) + 127) / 255);
    data[i] = (77 * mix(rgba[i * 4]) + 150 * mix(rgba[i * 4 + 1]) + 29 * mix(rgba[i * 4 + 2]) + 128) >> 8;
  }
  return { w, h, data };
}

/** Riduce l'immagine (media sull'area di ogni pixel di arrivo) in modo che il lato maggiore non superi `maxSide`; se già piccola, la restituisce. */
export function resizeGray(img: GrayImage, maxSide: number): GrayImage {
  const k = Math.max(img.w, img.h) / maxSide;
  if (!(k > 1)) return img;
  const w = Math.max(1, Math.round(img.w / k));
  const h = Math.max(1, Math.round(img.h / k));
  const data = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    // Righe e colonne di partenza coperte dal pixel di arrivo (almeno una)
    const y0 = Math.floor((j * img.h) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * img.h) / h));
    for (let i = 0; i < w; i++) {
      const x0 = Math.floor((i * img.w) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * img.w) / w));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += img.data[y * img.w + x];
      data[j * w + i] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { w, h, data };
}

/** Sfocatura a scatola separabile di raggio `radius` pixel; con `wrap` i bordi si richiudono (texture ripetuta), altrimenti si replicano. */
export function blurGray(img: GrayImage, radius: number, wrap: boolean): GrayImage {
  const r = Math.round(radius);
  if (r <= 0) return img;
  const { w, h } = img;
  const idx = (k: number, n: number) => (wrap ? ((k % n) + n) % n : Math.min(n - 1, Math.max(0, k)));
  const tmp = new Float32Array(w * h);
  const out = new Uint8Array(w * h);
  const norm = 2 * r + 1;
  // Prima le righe...
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += img.data[j * w + idx(i + k, w)];
      tmp[j * w + i] = s / norm;
    }
  }
  // ...poi le colonne
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[idx(j + k, h) * w + i];
      out[j * w + i] = Math.round(s / norm);
    }
  }
  return { w, h, data: out };
}

/** Valore dell'immagine (0 a 1) in coordinate di piastrella (s, t), interpolazione bilineare; `wrap` ripete l'immagine, altrimenti i bordi si replicano. */
export function sampleGray(img: GrayImage, s: number, t: number, wrap: boolean): number {
  const { w, h, data } = img;
  // Il centro del pixel (i, j) sta in ((i + 0,5) / w, 1 - (j + 0,5) / h): riga 0 in alto, t verso l'alto
  const px = s * w - 0.5;
  const py = (1 - t) * h - 0.5;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const col = (k: number) => (wrap ? ((k % w) + w) % w : Math.min(w - 1, Math.max(0, k)));
  const row = (k: number) => (wrap ? ((k % h) + h) % h : Math.min(h - 1, Math.max(0, k)));
  const a = data[row(iy) * w + col(ix)];
  const b = data[row(iy) * w + col(ix + 1)];
  const c = data[row(iy + 1) * w + col(ix)];
  const d = data[row(iy + 1) * w + col(ix + 1)];
  return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) / 255;
}

// ---------------------------------------------------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------------------------------------------------

/** Dal grigio normalizzato (0 a 1, già invertito se serve) alla quota in mm secondo il modo; il livello medio resta a quota 0. */
export function grayToHeight(v: number, p: Pick<TextureParams, 'mode' | 'midlevel' | 'amplitude'>): number {
  const m = p.midlevel;
  if (p.mode === 'both') return (v - m) * p.amplitude;
  // Solo rilievo: da 0 al bianco, ciò che sta sotto il livello medio resta sulla faccia
  if (p.mode === 'relief') return m >= 1 ? 0 : (Math.max(0, v - m) / (1 - m)) * p.amplitude;
  // Solo incavo: da 0 al nero, ciò che sta sopra il livello medio resta sulla faccia
  return m <= 0 ? 0 : 0 - (Math.max(0, m - v) / m) * p.amplitude;
}

/** Quota minima e massima possibili (mm) del modo scelto: servono a dimensionare i solidi e il piano di chiusura. */
export function heightRange(p: Pick<TextureParams, 'mode' | 'midlevel' | 'amplitude'>): [number, number] {
  const lo = Math.min(grayToHeight(0, p), grayToHeight(1, p));
  const hi = Math.max(grayToHeight(0, p), grayToHeight(1, p));
  return [Math.min(0, lo), Math.max(0, hi)];
}

/**
 * Funzione di quota `h(u, v)` (mm) di un'immagine, con scala, rotazione, scostamento, ripetizione, inversione, livello
 * medio, ampiezza e sfocatura. Fuori dalla piastrella (senza ripetizione) vale 0. La sfocatura si calcola una volta sola, qui.
 */
export function makeTextureHeight(img: GrayImage, params: Partial<TextureParams>): (u: number, v: number) => number {
  const p = normalizeTexture(params);
  const source = blurGray(img, p.blur, p.repeat);
  const tileW = p.tile;
  const tileH = (p.tile * img.h) / img.w;
  const cos = Math.cos((p.rotation * Math.PI) / 180);
  const sin = Math.sin((p.rotation * Math.PI) / 180);
  return (u, v) => {
    // Dal riferimento della faccia a quello della texture: si toglie lo scostamento e si ruota di -rotazione
    const du = u - p.offset[0];
    const dv = v - p.offset[1];
    const tu = du * cos + dv * sin;
    const tv = -du * sin + dv * cos;
    const s = tu / tileW;
    const t = tv / tileH;
    if (!p.repeat && (s < 0 || s > 1 || t < 0 || t > 1)) return 0;
    const g = sampleGray(source, s, t, p.repeat);
    return grayToHeight(p.invert ? 1 - g : g, p);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Proiezioni per le mesh (motore M)
// ---------------------------------------------------------------------------------------------------------------------

export type ProjectionKind = 'planar' | 'triplanar' | 'cylindrical';

export interface Projection {
  kind: ProjectionKind;
  /** Asse: della proiezione planare (la direzione di vista) e del cilindro. 0 = X, 1 = Y, 2 = Z. */
  axis: 0 | 1 | 2;
  /** Cilindrica: raggio di riferimento (mm), da cui si ricava quante piastrelle fanno il giro (intero, senza cucitura). */
  radius: number;
  /** Triplanare: potenza dei pesi |n|^blend (più alta = fusioni più strette tra le tre proiezioni). */
  blend: number;
  /** Cilindrica: sotto questo angolo dall'asse (gradi) le facce piane dei tappi usano la proiezione planare. */
  capAngle: number;
}

export const projectionDefaults = (): Projection => ({ kind: 'triplanar', axis: 2, radius: 10, blend: 4, capAngle: 25 });

/** Coordinate (u, v) in mm di un punto per la proiezione planare lungo `axis`: Z guarda dall'alto (u = x, v = y), X (u = y, v = z), Y (u = x, v = z). */
function planarUv(axis: 0 | 1 | 2, x: number, y: number, z: number): [number, number] {
  return axis === 2 ? [x, y] : axis === 0 ? [y, z] : [x, z];
}

/**
 * Spostamento (mm) di un punto della superficie lungo la sua normale: `(x, y, z)` posizione e `(nx, ny, nz)` normale
 * unitaria. Planare: una sola proiezione. Triplanare: tre proiezioni (una per asse) mescolate con i pesi |n|^blend, che
 * sommano 1. Cilindrica: u è l'arco (in mm, con un numero intero di piastrelle sul giro) e v la quota lungo l'asse;
 * le facce quasi perpendicolari all'asse (i tappi) passano gradualmente alla proiezione planare.
 */
export function makeDisplacement(img: GrayImage, params: Partial<TextureParams>, projection: Partial<Projection> = {}): (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number {
  const proj = { ...projectionDefaults(), ...projection };
  const tex = normalizeTexture(params);
  const h = makeTextureHeight(img, tex);
  const planar = (axis: 0 | 1 | 2, x: number, y: number, z: number) => h(...planarUv(axis, x, y, z));
  if (proj.kind === 'planar') return (x, y, z) => planar(proj.axis, x, y, z);

  if (proj.kind === 'triplanar') {
    return (x, y, z, nx, ny, nz) => {
      const w0 = Math.abs(nx) ** proj.blend;
      const w1 = Math.abs(ny) ** proj.blend;
      const w2 = Math.abs(nz) ** proj.blend;
      const sum = w0 + w1 + w2;
      if (!(sum > 0)) return 0;
      // Le proiezioni con peso trascurabile non si calcolano
      let out = 0;
      if (w0 / sum > 1e-4) out += (w0 / sum) * planar(0, x, y, z);
      if (w1 / sum > 1e-4) out += (w1 / sum) * planar(1, x, y, z);
      if (w2 / sum > 1e-4) out += (w2 / sum) * planar(2, x, y, z);
      return out;
    };
  }

  // Cilindrica: piastrelle sul giro = intero più vicino a 2 pi R / tile (almeno 1), così la texture si chiude senza cucitura
  const tiles = Math.max(1, Math.round((2 * Math.PI * Math.max(proj.radius, 0.01)) / tex.tile));
  const arc = tiles * tex.tile;
  const a = proj.axis;
  const cosCap = Math.cos((proj.capAngle * Math.PI) / 180);
  return (x, y, z, nx, ny, nz) => {
    const p3 = [x, y, z];
    const n3 = [nx, ny, nz];
    const c1 = p3[(a + 1) % 3];
    const c2 = p3[(a + 2) % 3];
    const theta = Math.atan2(c2, c1);
    const side = h((theta / (2 * Math.PI)) * arc, p3[a]);
    // Fascia di passaggio tra fianco e tappo: 0 sul fianco, 1 sul tappo, ampia 0,2 in |n_asse|
    const cap = clamp((Math.abs(n3[a]) - (cosCap - 0.1)) / 0.2, 0, 1);
    return cap <= 0 ? side : cap >= 1 ? planar(a, x, y, z) : (1 - cap) * side + cap * planar(a, x, y, z);
  };
}
