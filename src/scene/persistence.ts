import { get, set } from 'idb-keyval';
import type { Scene } from './types';
import { useSceneStore } from './store';
import { decodeAsset, encodeAsset, getAsset, type MeshAsset } from '../import/assets';
import { restoreAssets } from '../import/restore';
import { notify } from '../ui/notify/notifyStore';

const KEY = 'webcad:scene';
const FORMAT = 'webcad-scene';
/** Versione 2: il progetto include le mesh importate. Le versioni 1 (senza mesh) si leggono ancora. */
const VERSION = 3;

/** Controllo minimo di forma: evita di caricare file che non sono scene WebCAD. */
function isScene(value: unknown): value is Scene {
  const s = value as Scene | undefined;
  return !!s && typeof s.nodes === 'object' && Array.isArray(s.rootIds) && s.rootIds.every((id) => s.nodes[id]);
}

/** Carica l'ultima scena salvata in IndexedDB (se c'è) e attiva il salvataggio automatico. */
export async function initPersistence(): Promise<void> {
  let saved: Scene | undefined;
  try {
    saved = await get<Scene>(KEY);
  } catch {
    // IndexedDB non disponibile (navigazione privata): si lavora senza salvataggio
    return;
  }
  if (isScene(saved)) {
    try {
      // Le mesh importate si recuperano e si registrano nel kernel prima di mostrare la scena
      useSceneStore.getState().loadScene(await restoreAssets(saved));
    } catch {
      notify.error('Impossibile ripristinare la scena salvata.');
    }
  }
  // Salvataggio con debounce a ogni cambio della scena
  let timer: ReturnType<typeof setTimeout> | undefined;
  useSceneStore.subscribe((state, prev) => {
    if (state.scene === prev.scene) return;
    clearTimeout(timer);
    timer = setTimeout(() => void set(KEY, state.scene).catch(() => undefined), 400);
  });
}

/** Serializza la scena come file di progetto JSON, con le mesh importate in forma compressa. */
export function sceneToJson(scene: Scene): string {
  const assets: Record<string, string> = {};
  for (const node of Object.values(scene.nodes)) {
    const asset = node.type === 'mesh' ? getAsset(node.assetId) : undefined;
    if (asset && !assets[asset.id]) assets[asset.id] = encodeAsset(asset);
  }
  return JSON.stringify({ format: FORMAT, version: VERSION, scene, assets }, null, 2);
}

/** Legge un file di progetto; lancia un errore leggibile se non è valido. */
export function sceneFromJson(text: string): { scene: Scene; assets: MeshAsset[] } {
  let data: { format?: string; version?: number; scene?: unknown; assets?: Record<string, string> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Il file non è un progetto WebCAD valido.');
  }
  if (data.format !== FORMAT || !isScene(data.scene)) throw new Error('Il file non è un progetto WebCAD valido.');
  if ((data.version ?? 1) > VERSION) throw new Error('Il progetto è stato salvato da una versione più recente di WebCAD.');
  const assets = Object.entries(data.assets ?? {}).map(([id, encoded]) => decodeAsset(id, encoded));
  return { scene: data.scene, assets };
}
