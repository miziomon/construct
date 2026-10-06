import { del, get, set } from 'idb-keyval';
import { unzlibSync, zlibSync } from 'fflate';

/** Mesh importata, immutabile: sta fuori dallo store della scena (che ne conserva solo l'id). */
export interface MeshAsset {
  /** Impronta del contenuto: lo stesso file importato due volte condivide lo stesso asset. */
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
}

const assets = new Map<string, MeshAsset>();
const idbKey = (id: string) => `webcad:asset:${id}`;

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
        const stored = await get<{ positions: Float32Array; indices: Uint32Array }>(idbKey(id));
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
