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

/** Impronta SHA-256 (16 caratteri esadecimali) di dimensioni e pixel del grigio, con il prefisso `img-` che lo distingue dalle mesh. */
export async function grayFingerprint(img: GrayImage): Promise<string> {
  const bytes = new Uint8Array(8 + img.data.length);
  new DataView(bytes.buffer).setUint32(0, img.w);
  new DataView(bytes.buffer).setUint32(4, img.h);
  bytes.set(img.data, 8);
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

/** Gli id delle immagini caricate usate dai Pattern «Immagine» di una scena (senza ripetizioni). */
export function usedImageIds(scene: { nodes: Record<string, { type: string; pattern?: { kind: string; imageId?: string } }> }): string[] {
  const ids = new Set<string>();
  for (const node of Object.values(scene.nodes)) if (node.type === 'group' && node.pattern?.kind === 'texture' && node.pattern.imageId) ids.add(node.pattern.imageId);
  return [...ids];
}
