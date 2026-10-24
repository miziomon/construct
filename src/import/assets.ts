import { del, get, set } from 'idb-keyval';
import { Unzlib, unzlibSync, zlibSync } from 'fflate';
import { MAX_IMAGE_SIDE, grayFingerprint } from '../scene/textureImage';
import type { GrayImage } from '../scene/textureMap';

/** Mesh importata, immutabile: sta fuori dallo store della scena (che ne conserva solo l'id). */
export interface MeshAsset {
  /** Impronta del contenuto: lo stesso file importato due volte condivide lo stesso asset. */
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Immagine del Pattern «Immagine», immutabile: il grigio a 8 bit già decodificato (è questo, non il file, che si salva e si
 * identifica), lato massimo 512 px. Sta in un registro a parte dalle mesh e la scena ne conserva solo l'`id` (`PatternParams.imageId`):
 * una sola copia nel progetto anche se più Pattern la usano.
 */
export interface ImageAsset {
  /** Impronta SHA-256 di dimensioni e pixel, con il prefisso `img-` (vedi `grayFingerprint`). */
  id: string;
  w: number;
  h: number;
  gray: Uint8Array;
}

const assets = new Map<string, MeshAsset>();
const images = new Map<string, ImageAsset>();
const imageIdbKey = (id: string) => `construct:image:${id}`;
const idbKey = (id: string) => `construct:asset:${id}`;
/** Chiave dell'app quando si chiamava WebCAD: si legge ancora, così le mesh importate non vanno perse. */
const legacyIdbKey = (id: string) => `webcad:asset:${id}`;

export const getAsset = (id: string): MeshAsset | undefined => assets.get(id);

/** Impronta SHA-256 (primi 16 caratteri esadecimali) di posizioni e indici. */
async function fingerprint(positions: Float32Array, indices: Uint32Array): Promise<string> {
  const bytes = new Uint8Array(positions.byteLength + indices.byteLength);
  bytes.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), 0);
  bytes.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), positions.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Registra una mesh in memoria e in IndexedDB e ne restituisce l'asset. */
export async function addAsset(positions: Float32Array, indices: Uint32Array): Promise<MeshAsset> {
  const asset: MeshAsset = { id: await fingerprint(positions, indices), positions, indices };
  assets.set(asset.id, asset);
  try {
    await set(idbKey(asset.id), { positions, indices });
  } catch {
    // IndexedDB non disponibile: l'asset resta valido solo per la sessione corrente
  }
  return asset;
}

/** Ripristina da IndexedDB gli asset indicati; restituisce quelli trovati. */
export async function loadAssets(ids: string[]): Promise<MeshAsset[]> {
  const found: MeshAsset[] = [];
  for (const id of ids) {
    let asset = assets.get(id);
    if (!asset) {
      try {
        const stored = await get<{ positions: Float32Array; indices: Uint32Array }>(idbKey(id)) ?? (await get<{ positions: Float32Array; indices: Uint32Array }>(legacyIdbKey(id)));
        if (stored) asset = { id, positions: stored.positions, indices: stored.indices };
      } catch {
        // IndexedDB non disponibile
      }
      if (asset) assets.set(id, asset);
    }
    if (asset) found.push(asset);
  }
  return found;
}

/** Dimentica un asset (memoria e IndexedDB). */
export async function removeAsset(id: string): Promise<void> {
  assets.delete(id);
  try {
    await del(idbKey(id));
  } catch {
    // niente da fare
  }
}

// --- Codifica per il file di progetto -------------------------------------------------------

/** Intestazione: numero di float e di indici (uint32 little endian), poi i dati; il tutto compresso con zlib. */
export function encodeAsset(asset: MeshAsset): string {
  const header = new Uint32Array([asset.positions.length, asset.indices.length]);
  const raw = new Uint8Array(8 + asset.positions.byteLength + asset.indices.byteLength);
  raw.set(new Uint8Array(header.buffer), 0);
  raw.set(new Uint8Array(asset.positions.buffer, asset.positions.byteOffset, asset.positions.byteLength), 8);
  raw.set(new Uint8Array(asset.indices.buffer, asset.indices.byteOffset, asset.indices.byteLength), 8 + asset.positions.byteLength);
  return toBase64(zlibSync(raw, { level: 6 }));
}

export function decodeAsset(id: string, base64: string): MeshAsset {
  const raw = unzlibSync(fromBase64(base64));
  // Copia in un buffer allineato: gli array tipizzati richiedono offset multipli di 4
  const aligned = raw.slice().buffer;
  const [nPos, nIdx] = new Uint32Array(aligned, 0, 2);
  return {
    id,
    positions: new Float32Array(aligned, 8, nPos),
    indices: new Uint32Array(aligned, 8 + nPos * 4, nIdx),
  };
}

/** Base64 a blocchi: String.fromCharCode con un array enorme supererebbe i limiti dello stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- Immagini -------------------------------------------------------------------------------

/** Il grigio di un'immagine registrata (nel formato dei calcoli puri), indefinito se non c'è. */
export function getImage(id: string): GrayImage | undefined {
  const asset = images.get(id);
  return asset ? { w: asset.w, h: asset.h, data: asset.gray } : undefined;
}

/** Registra un'immagine in memoria e in IndexedDB; la stessa immagine caricata due volte condivide lo stesso asset. */
export async function addImage(gray: GrayImage): Promise<ImageAsset> {
  const id = await grayFingerprint(gray);
  const existing = images.get(id);
  if (existing) return existing;
  const asset: ImageAsset = { id, w: gray.w, h: gray.h, gray: gray.data };
  images.set(id, asset);
  try {
    await set(imageIdbKey(id), { w: asset.w, h: asset.h, gray: asset.gray });
  } catch {
    // IndexedDB non disponibile: l'immagine resta valida solo per la sessione corrente
  }
  return asset;
}

/** Ripristina da IndexedDB le immagini indicate; restituisce quelle trovate. */
export async function loadImages(ids: string[]): Promise<ImageAsset[]> {
  const found: ImageAsset[] = [];
  for (const id of ids) {
    let asset = images.get(id);
    if (!asset) {
      try {
        const stored = await get<{ w: number; h: number; gray: Uint8Array }>(imageIdbKey(id));
        if (stored) asset = { id, w: stored.w, h: stored.h, gray: stored.gray };
      } catch {
        // IndexedDB non disponibile
      }
      if (asset) images.set(id, asset);
    }
    if (asset) found.push(asset);
  }
  return found;
}

/** Codifica per il file di progetto: intestazione (larghezza e altezza, uint32 little endian) e grigio, compressi con zlib e in base64. */
export function encodeImage(asset: ImageAsset): string {
  const raw = new Uint8Array(8 + asset.gray.length);
  raw.set(new Uint8Array(new Uint32Array([asset.w, asset.h]).buffer), 0);
  raw.set(asset.gray, 8);
  return toBase64(zlibSync(raw, { level: 6 }));
}

export function decodeImage(id: string, base64: string): ImageAsset {
  // Un file di progetto non è fidato: si decomprime a flusso con un tetto (intestazione più un grigio di `MAX_IMAGE_SIDE` pixel di
  // lato), così un dato corrotto o malevolo non alloca gigabyte
  const limit = 8 + MAX_IMAGE_SIDE * MAX_IMAGE_SIDE;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflate = new Unzlib((chunk) => {
    total += chunk.length;
    if (total > limit) throw new Error('Immagine del progetto non valida: più grande di 512 pixel di lato.');
    chunks.push(chunk);
  });
  inflate.push(fromBase64(base64), true);
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.length;
  }
  if (raw.length < 8) throw new Error('Immagine del progetto non valida.');
  const [w, h] = new Uint32Array(raw.slice(0, 8).buffer);
  if (!(w > 0 && h > 0) || w > MAX_IMAGE_SIDE || h > MAX_IMAGE_SIDE || raw.length !== 8 + w * h) throw new Error('Immagine del progetto non valida.');
  return { id, w, h, gray: raw.slice(8) };
}
