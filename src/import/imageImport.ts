import { getKernel } from '../kernel/client';
import { MAX_IMAGE_SIDE, imageToGray } from '../scene/textureImage';
import { addImage } from './assets';
import { HEADER_BYTES, readImageHeader, unsupportedFormat } from './imageHeader';
import { prepareSvgFile, rasterizeSvg } from './svgImage';
import type { ImageAsset } from './assets';

/** File più grande di così non si apre (una foto di fotocamera sta ben sotto). */
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
/** Lato massimo a cui si disegna l'immagine prima di leggerne i pixel: oltre, si riduce già nel disegno (la riduzione finale a 512 px è `imageToGray`). */
const MAX_DECODE_SIDE = 2048;

/**
 * Decodifica PNG o JPG in pixel RGBA con `createImageBitmap` (senza conversione del colore né premoltiplicazione dell'alfa, come
 * misurato in docs/studio-texture-immagine.md) e un canvas. Una volta sola, all'importazione: da qui in poi si lavora sul grigio.
 */
async function decodeRgba(file: Blob): Promise<{ rgba: Uint8ClampedArray; w: number; h: number }> {
  if (file.size > MAX_IMAGE_FILE_BYTES) throw new Error(`Il file è troppo grande (${Math.round(file.size / 1024 / 1024)} MB): il massimo è ${MAX_IMAGE_FILE_BYTES / 1024 / 1024} MB.`);
  // Formato e dimensioni dai primi byte, PRIMA di decodificare: `createImageBitmap` allocherebbe tutti i pixel di un'immagine enorme
  // (e il tipo dichiarato dal browser dipende dall'estensione, non dal contenuto)
  readImageHeader(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    throw new Error('Il file non è un\'immagine leggibile: servono immagini PNG o JPG valide.');
  }
  try {
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

/** Primi byte di un PNG (`89 50 4E 47`) o di un JPEG (`FF D8 FF`). */
const isRaster = (b: Uint8Array) => (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff);

/**
 * Pixel RGBA di un file immagine, dal contenuto: PNG o JPG (intestazione e limiti, poi `createImageBitmap`) oppure SVG (rasterizzato a
 * 512 px nel thread principale, senza script né risorse esterne: vedi `svgImage.ts`). Altri formati: «Formato non supportato».
 */
async function decodeAny(file: Blob): Promise<{ rgba: Uint8ClampedArray; w: number; h: number }> {
  const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  if (isRaster(head)) return decodeRgba(file);
  // SVG: dal contenuto (dopo BOM, XML, commenti e DOCTYPE comincia con <svg), non dall'estensione né dal tipo dichiarato. Il file sta per
  // intero nei primi byte letti (HEADER_BYTES = MAX_SVG_BYTES); un SVG con entità si rifiuta con il suo messaggio, non come formato ignoto
  const prepared = prepareSvgFile(head, file.size);
  if (prepared) return rasterizeSvg(prepared.svg, prepared.w, prepared.h);
  throw unsupportedFormat();
}

/**
 * Importa un'immagine PNG, JPG o SVG per il Pattern «Immagine»: la decodifica (o rasterizza), la converte in grigio (Rec. 601 su sRGB,
 * trasparenza sul bianco), la riduce a 512 px sul lato maggiore, la registra (una sola copia per contenuto, anche in IndexedDB) e la
 * manda al kernel. Lancia un errore leggibile se il file non va bene.
 */
export async function importImageFile(file: Blob): Promise<ImageAsset> {
  const { rgba, w, h } = await decodeAny(file);
  const gray = imageToGray(rgba, w, h);
  if (gray.w > MAX_IMAGE_SIDE || gray.h > MAX_IMAGE_SIDE) throw new Error('Immagine non ridimensionabile.');
  const asset = await addImage(gray);
  await getKernel().registerImage(asset.id, asset.w, asset.h, asset.gray);
  return asset;
}
