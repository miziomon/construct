import { makeSample } from './textureSamples';
import type { SampleKind } from './textureSamples';
import { resizeGray, rgbaToGray } from './textureMap';
import type { GrayImage } from './textureMap';

/**
 * Immagini delle texture del Pattern «Immagine»: calcoli puri, senza accesso al registro degli asset (che sta in
 * `src/import/assets.ts` ed è dell'interfaccia). Chi ha bisogno dei pixel (kernel, generatore OpenSCAD, pannello) riceve una
 * funzione `ImageLookup` che dall'id dell'asset dà il grigio decodificato: il kernel la ricava dalle immagini registrate nel
 * worker, il codice OpenSCAD dal registro del thread principale.
 */

/** Dall'id di un'immagine caricata al suo grigio (indefinito se non è registrata). */
export type ImageLookup = (id: string) => GrayImage | undefined;

/** Lato massimo (pixel) del grigio che si salva: 512 px, circa 165-256 KB compressi per le foto (docs/studio-texture-immagine.md). */
export const MAX_IMAGE_SIDE = 512;

/** Lato (pixel) delle immagini di esempio generate nel codice: 256 px bastano, sono ripetibili senza cucitura. */
export const SAMPLE_SIZE = 256;

const samples = new Map<SampleKind, GrayImage>();

/** Immagine di una texture di esempio (generata una volta sola, deterministica). */
export function sampleImage(kind: SampleKind): GrayImage {
  let image = samples.get(kind);
  if (!image) {
    image = makeSample(kind, SAMPLE_SIZE);
    samples.set(kind, image);
  }
  return image;
}

/**
 * Da pixel RGBA (come li dà `getImageData`) al grigio da salvare: Rec. 601 su sRGB con la trasparenza composta sul bianco
 * (`rgbaToGray`), poi ridotto a `MAX_IMAGE_SIDE` pixel sul lato maggiore (`resizeGray`).
 */
export const imageToGray = (rgba: ArrayLike<number>, w: number, h: number): GrayImage => resizeGray(rgbaToGray(rgba, w, h), MAX_IMAGE_SIDE);

/**
 * Hash di riserva a 64 bit (due FNV-1a a 32 bit con moltiplicatori diversi e una miscelazione finale in stile murmur), sincrono:
 * serve quando `crypto.subtle` non c'è (contesto non sicuro, per esempio la pagina servita in HTTP su un indirizzo di rete locale).
 * Gli id dei due metodi sono diversi: un'immagine caricata in un contesto sicuro e poi in uno non sicuro non si riconosce come la
 * stessa (resta una copia in più), ma il progetto si apre e funziona (l'id è salvato nel file).
 */
export function fallbackHash(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  // Più passate di miscelazione: ogni metà dipende da tutti i bit dell'altra
  for (let pass = 0; pass < 2; pass++) {
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  }
  return [h2, h1].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Impronta (16 caratteri esadecimali) di dimensioni e pixel del grigio: SHA-256 se disponibile, altrimenti `fallbackHash`; prefisso `img-` che lo distingue dalle mesh. */
export async function grayFingerprint(img: GrayImage): Promise<string> {
  const bytes = new Uint8Array(8 + img.data.length);
  new DataView(bytes.buffer).setUint32(0, img.w);
  new DataView(bytes.buffer).setUint32(4, img.h);
  bytes.set(img.data, 8);
  if (!globalThis.crypto?.subtle) return `img-${fallbackHash(bytes)}`;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `img-${Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Larghezza di un pixel dell'immagine sulla faccia (mm): la piastrella è larga `tile` mm e l'immagine `w` pixel. */
export const pixelSize = (tile: number, img: GrayImage): number => tile / img.w;

/**
 * L'immagine di un Pattern «Immagine»: quella caricata (`imageId`, risolta da `lookup`: indefinita se non è registrata) oppure,
 * senza `imageId`, la texture di esempio `sample` (di partenza 'knurl').
 */
export function imageOf(p: { imageId?: string; sample?: SampleKind }, lookup?: ImageLookup): GrayImage | undefined {
  return p.imageId ? lookup?.(p.imageId) : sampleImage(p.sample ?? 'knurl');
}

/**
 * Gli id delle immagini caricate presenti nei Pattern di una scena (senza ripetizioni), qualunque sia il tipo del Pattern: il pannello
 * delle Proprietà non normalizza, quindi cambiando tipo da Immagine a un altro il nodo conserva `imageId` (come lo strumento, vedi
 * `normalizeKeepingGroups`) e tornando a Immagine l'immagine deve esserci anche dopo aver salvato e riaperto il progetto.
 */
export function usedImageIds(scene: { nodes: Record<string, { type: string; pattern?: { imageId?: string } }> }): string[] {
  const ids = new Set<string>();
  for (const node of Object.values(scene.nodes)) if (node.type === 'group' && node.pattern?.imageId) ids.add(node.pattern.imageId);
  return [...ids];
}
