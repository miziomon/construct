import { getKernel } from '../kernel/client';
import { MAX_IMAGE_SIDE, imageToGray } from '../scene/textureImage';
import { addImage } from './assets';
import type { ImageAsset } from './assets';

/** File più grande di così non si apre (una foto di fotocamera sta ben sotto). */
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
/** Oltre questi pixel (circa 100 megapixel) la decodifica supererebbe la memoria di una scheda del browser. */
const MAX_IMAGE_PIXELS = 100_000_000;
/** Lato massimo a cui si disegna l'immagine prima di leggerne i pixel: oltre, si riduce già nel disegno (la riduzione finale a 512 px è `imageToGray`). */
const MAX_DECODE_SIDE = 2048;

/**
 * Decodifica PNG o JPG in pixel RGBA con `createImageBitmap` (senza conversione del colore né premoltiplicazione dell'alfa, come
 * misurato in docs/studio-texture-immagine.md) e un canvas. Una volta sola, all'importazione: da qui in poi si lavora sul grigio.
 */
async function decodeRgba(file: Blob): Promise<{ rgba: Uint8ClampedArray; w: number; h: number }> {
  if (file.size > MAX_IMAGE_FILE_BYTES) throw new Error(`Il file è troppo grande (${Math.round(file.size / 1024 / 1024)} MB): il massimo è ${MAX_IMAGE_FILE_BYTES / 1024 / 1024} MB.`);
  if (file.type && file.type !== 'image/png' && file.type !== 'image/jpeg') throw new Error('Formato non supportato: servono immagini PNG o JPG.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    throw new Error('Il file non è un\'immagine leggibile: servono immagini PNG o JPG valide.');
  }
  try {
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error(`L'immagine è troppo grande (${bitmap.width} × ${bitmap.height} pixel): riducila prima di caricarla.`);
    // Le immagini enormi si riducono già nel disegno, per non allocare centinaia di MB di pixel
    const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const context = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new Error('Il browser non permette di leggere i pixel dell\'immagine.');
    context.drawImage(bitmap, 0, 0, w, h);
    return { rgba: context.getImageData(0, 0, w, h).data, w, h };
  } finally {
    bitmap.close();
  }
}

/**
 * Importa un'immagine PNG o JPG per il Pattern «Immagine»: la decodifica, la converte in grigio (Rec. 601 su sRGB, trasparenza
 * sul bianco), la riduce a 512 px sul lato maggiore, la registra (una sola copia per contenuto, anche in IndexedDB) e la manda al
 * kernel. Lancia un errore leggibile se il file non va bene.
 */
export async function importImageFile(file: Blob): Promise<ImageAsset> {
  const { rgba, w, h } = await decodeRgba(file);
  const gray = imageToGray(rgba, w, h);
  if (gray.w > MAX_IMAGE_SIDE || gray.h > MAX_IMAGE_SIDE) throw new Error('Immagine non ridimensionabile.');
  const asset = await addImage(gray);
  await getKernel().registerImage(asset.id, asset.w, asset.h, asset.gray);
  return asset;
}
