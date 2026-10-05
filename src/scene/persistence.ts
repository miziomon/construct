import { get, set } from 'idb-keyval';
import type { Scene } from './types';
import { useSceneStore } from './store';

const KEY = 'webcad:scene';
const FORMAT = 'webcad-scene';

/** Controllo minimo di forma: evita di caricare file che non sono scene WebCAD. */
function isScene(value: unknown): value is Scene {
  const s = value as Scene | undefined;
  return !!s && typeof s.nodes === 'object' && Array.isArray(s.rootIds) && s.rootIds.every((id) => s.nodes[id]);
}

/** Carica l'ultima scena salvata in IndexedDB (se c'è) e attiva il salvataggio automatico. */
export async function initPersistence(): Promise<void> {
  try {
    const saved = await get<Scene>(KEY);
    if (isScene(saved)) useSceneStore.getState().loadScene(saved);
  } catch {
    // IndexedDB non disponibile (navigazione privata): si lavora senza salvataggio
    return;
  }
  // Salvataggio con debounce a ogni cambio della scena
  let timer: ReturnType<typeof setTimeout> | undefined;
  useSceneStore.subscribe((state, prev) => {
    if (state.scene === prev.scene) return;
    clearTimeout(timer);
    timer = setTimeout(() => void set(KEY, state.scene).catch(() => undefined), 400);
  });
}

/** Serializza la scena come file di progetto JSON. */
export function sceneToJson(scene: Scene): string {
  return JSON.stringify({ format: FORMAT, version: 1, scene }, null, 2);
}

/** Legge un file di progetto; lancia un errore leggibile se non è valido. */
export function sceneFromJson(text: string): Scene {
  const data = JSON.parse(text) as { format?: string; scene?: unknown };
  if (data.format !== FORMAT || !isScene(data.scene)) throw new Error('Il file non è un progetto WebCAD valido.');
  return data.scene;
}
