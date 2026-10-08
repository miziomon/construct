import { get, set } from 'idb-keyval';
import type { Scene } from './types';
import { useSceneStore } from './store';
import { normalizeTreatmentGroups } from './treatment';
import { platesAreValid } from './plates';
import { decodeAsset, encodeAsset, getAsset, type MeshAsset } from '../import/assets';
import { restoreAssets } from '../import/restore';
import { notify } from '../ui/notify/notifyStore';
import { useUiStore } from '../ui/uiStore';

const KEY = 'construct:scene';
/** Chiave e formato dell'app quando si chiamava WebCAD: si leggono ancora, così nessun progetto va perso. */
const LEGACY_KEY = 'webcad:scene';
const FORMAT = 'construct-scene';
const LEGACY_FORMAT = 'webcad-scene';
/** Versione 2: il progetto include le mesh importate; 4: i piatti (`plates`). Le versioni precedenti si leggono ancora (un piatto solo). */
const VERSION = 4;

/** Vero durante la pulizia dei dati: la scena non deve essere riscritta mentre si cancella. */
let autosaveSuspended = false;
export const suspendAutosave = () => {
  autosaveSuspended = true;
};

/** Controllo minimo di forma: evita di caricare file che non sono scene Construct. */
function isScene(value: unknown): value is Scene {
  const s = value as Scene | undefined;
  return !!s && typeof s.nodes === 'object' && Array.isArray(s.rootIds) && s.rootIds.every((id) => s.nodes[id]) && platesAreValid(s);
}

/**
 * Carica l'ultima scena salvata in IndexedDB (se c'è, anche con la chiave del vecchio nome) e attiva il salvataggio
 * automatico. Restituisce true se ha ripristinato una scena.
 */
export async function initPersistence(): Promise<boolean> {
  let saved: Scene | undefined;
  try {
    saved = (await get<Scene>(KEY)) ?? (await get<Scene>(LEGACY_KEY));
  } catch {
    // IndexedDB non disponibile (navigazione privata): si lavora senza salvataggio
    return false;
  }
  let restored = false;
  if (isScene(saved)) {
    try {
      // Le mesh importate si recuperano e si registrano nel kernel prima di mostrare la scena
      useSceneStore.getState().loadScene(await restoreAssets(normalizeTreatmentGroups(saved)));
      // La scena ripristinata è il punto di partenza della timeline, non un'operazione da annullare
      useSceneStore.temporal.getState().clear();
      restored = true;
    } catch {
      notify.error('Impossibile ripristinare la scena salvata.');
    }
  }
  // Salvataggio con debounce a ogni cambio della scena
  let timer: ReturnType<typeof setTimeout> | undefined;
  useSceneStore.subscribe((state, prev) => {
    if (state.scene === prev.scene) return;
    clearTimeout(timer);
    // Con il salvataggio automatico spento (Impostazioni) la scena resta solo nel progetto salvato a mano
    if (autosaveSuspended || !useUiStore.getState().autosave) return;
    timer = setTimeout(() => void set(KEY, state.scene).catch(() => undefined), 400);
  });
  return restored;
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
    throw new Error('Il file non è un progetto Construct valido.');
  }
  if ((data.format !== FORMAT && data.format !== LEGACY_FORMAT) || !isScene(data.scene)) throw new Error('Il file non è un progetto Construct valido.');
  if ((data.version ?? 1) > VERSION) throw new Error('Il progetto è stato salvato da una versione più recente di Construct.');
  const assets = Object.entries(data.assets ?? {}).map(([id, encoded]) => decodeAsset(id, encoded));
  // Le scene di versioni precedenti hanno i gruppi dei trattamenti all'origine: si portano sul pezzo
  return { scene: normalizeTreatmentGroups(data.scene), assets };
}
