import { get, set } from 'idb-keyval';
import type { Scene } from './types';
import { useSceneStore } from './store';
import { normalizeTreatmentGroups } from './treatment';
import { migrateLegacyShapes } from './legacyShapes';
import { platesAreValid } from './plates';
import { decodeAsset, decodeImage, encodeAsset, encodeImage, getAsset, getImage, type ImageAsset, type MeshAsset } from '../import/assets';
import { usedImageIds } from './textureImage';
import { restoreAssets } from '../import/restore';
import { notify } from '../ui/notify/notifyStore';
import { useUiStore } from '../ui/uiStore';

const KEY = 'construct:scene';
/**
 * Versione del formato con cui è stata scritta la scena salvata. Sta in una chiave a parte, così le build vecchie (che
 * non la leggono e scrivono solo la scena) continuano a funzionare come prima.
 */
const VERSION_KEY = 'construct:scene-version';
/** Chiave e formato dell'app quando si chiamava WebCAD: si leggono ancora, così nessun progetto va perso. */
const LEGACY_KEY = 'webcad:scene';
const FORMAT = 'construct-scene';
const LEGACY_FORMAT = 'webcad-scene';
/** Versione 2: il progetto include le mesh importate; 4: i piatti (`plates`); 5: parametri e formule (`params`, `exprs`); 6: la forma Stella con `points` al posto di star5 e star6; 7: il Dado con `faces` al posto di Ottaedro, Decaedro, Dodecaedro e Icosaedro; 8: il Pattern «Immagine» (`kind: 'texture'`) e le immagini nel progetto (asset `img-...`, grigio compresso). Una build più vecchia non lo aprirebbe (e non lo sovrascrive): senza questa versione leggerebbe il Pattern come Voronoi. Le versioni precedenti si leggono ancora. */
const VERSION = 8;

/** Vero durante la pulizia dei dati: la scena non deve essere riscritta mentre si cancella. */
let autosaveSuspended = false;
export const suspendAutosave = () => {
  autosaveSuspended = true;
};

/** I parametri, se ci sono, sono un elenco di {id, name, expr} di testi. */
const paramsAreValid = (s: Scene) => s.params === undefined || (Array.isArray(s.params) && s.params.every((p) => typeof p?.id === 'string' && typeof p.name === 'string' && typeof p.expr === 'string'));

/** Controllo minimo di forma: evita di caricare file che non sono scene Construct. */
function isScene(value: unknown): value is Scene {
  const s = value as Scene | undefined;
  return !!s && typeof s.nodes === 'object' && Array.isArray(s.rootIds) && s.rootIds.every((id) => s.nodes[id]) && platesAreValid(s) && paramsAreValid(s) && (s.ignoredWarnings === undefined || (Array.isArray(s.ignoredWarnings) && s.ignoredWarnings.every((w) => typeof w === 'string')));
}

/**
 * Carica l'ultima scena salvata in IndexedDB (se c'è, anche con la chiave del vecchio nome) e attiva il salvataggio
 * automatico. Restituisce true se ha ripristinato una scena.
 */
export async function initPersistence(): Promise<boolean> {
  let saved: Scene | undefined;
  let savedVersion: unknown;
  try {
    saved = (await get<Scene>(KEY)) ?? (await get<Scene>(LEGACY_KEY));
    savedVersion = await get(VERSION_KEY);
  } catch {
    // IndexedDB non disponibile (navigazione privata): si lavora senza salvataggio
    return false;
  }
  // Salvata da una versione più recente (una PWA vecchia rimasta in cache): non si apre, e non si sovrascrive con la
  // scena di questa versione, che perderebbe ciò che la versione nuova sa scrivere
  if (typeof savedVersion === 'number' && savedVersion > VERSION) {
    suspendAutosave();
    notify.error('Il progetto salvato in questo browser è di una versione più recente di Construct: non è stato aperto e il salvataggio automatico è sospeso. Ricarica la pagina per aggiornare l\'app.');
    return false;
  }
  let restored = false;
  if (isScene(saved)) {
    try {
      // Le mesh importate si recuperano e si registrano nel kernel prima di mostrare la scena
      useSceneStore.getState().loadScene(await restoreAssets(migrateLegacyShapes(normalizeTreatmentGroups(saved))));
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
    // La versione si scrive prima della scena: così non esiste una scena nuova con una versione vecchia (una build più
    // vecchia la leggerebbe senza accorgersene); l'inverso, scena vecchia con versione nuova, non fa danni
    timer = setTimeout(() => void set(VERSION_KEY, VERSION).then(() => set(KEY, state.scene)).catch(() => undefined), 400);
  });
  return restored;
}

/** Serializza la scena come file di progetto JSON, con le mesh importate e le immagini dei Pattern in forma compressa (una copia per immagine). */
export function sceneToJson(scene: Scene): string {
  const assets: Record<string, string> = {};
  for (const node of Object.values(scene.nodes)) {
    const asset = node.type === 'mesh' ? getAsset(node.assetId) : undefined;
    if (asset && !assets[asset.id]) assets[asset.id] = encodeAsset(asset);
  }
  for (const id of usedImageIds(scene)) {
    const image = getImage(id);
    if (image && !assets[id]) assets[id] = encodeImage({ id, w: image.w, h: image.h, gray: image.data });
  }
  return JSON.stringify({ format: FORMAT, version: VERSION, scene, assets }, null, 2);
}

/** Legge un file di progetto; lancia un errore leggibile se non è valido. */
export function sceneFromJson(text: string): { scene: Scene; assets: MeshAsset[]; images: ImageAsset[] } {
  let data: { format?: string; version?: number; scene?: unknown; assets?: Record<string, string> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Il file non è un progetto Construct valido.');
  }
  if ((data.format !== FORMAT && data.format !== LEGACY_FORMAT) || !isScene(data.scene)) throw new Error('Il file non è un progetto Construct valido.');
  if ((data.version ?? 1) > VERSION) throw new Error('Il progetto è stato salvato da una versione più recente di Construct.');
  // Mesh e immagini stanno nello stesso elenco: le immagini hanno l'id che comincia con `img-`
  const entries = Object.entries(data.assets ?? {});
  const assets = entries.filter(([id]) => !id.startsWith('img-')).map(([id, encoded]) => decodeAsset(id, encoded));
  const images = entries.filter(([id]) => id.startsWith('img-')).map(([id, encoded]) => decodeImage(id, encoded));
  // Le scene di versioni precedenti hanno i gruppi dei trattamenti all'origine (si portano sul pezzo) le stelle a 5 o 6 punte (diventano Stella) e i quattro solidi dei dadi (diventano Dado)
  return { scene: migrateLegacyShapes(normalizeTreatmentGroups(data.scene)), assets, images };
}
