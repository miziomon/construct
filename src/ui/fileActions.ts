import { getKernel } from '../kernel/client';
import { useResultStore } from '../kernel/useKernel';
import { useSceneStore } from '../scene/store';
import type { Example } from '../examples/catalog';
import { fitView } from '../viewport/cameraControl';
import { allRootIds, hasManyPlates, PLATE_GAP, platesOf } from '../scene/plates';
import { useUiStore } from './uiStore';
import { sceneFromJson, sceneToJson } from '../scene/persistence';
import { addAsset } from '../import/assets';
import { restoreAssets } from '../import/restore';
import { strToU8, zipSync } from 'fflate';
import { fontsUsed } from '../scene/fontCatalog';
import { confirmWithOption, notify, promptDialog } from './notify/notifyStore';

/** Avvia il download di un file generato in memoria. */
export function download(data: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Rilascia l'URL dopo che il browser ha avviato il download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const scene = () => useSceneStore.getState().scene;

/** STL del piatto indicato (il piatto attivo se non si dice): con più piatti il nome del file porta il piatto. */
export async function exportStl(plateId?: string): Promise<void> {
  const plate = plateId ? platesOf(scene()).find((p) => p.id === plateId) : undefined;
  const suffix = plate && hasManyPlates(scene()) ? `-${plate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
  download(await getKernel().exportStl(scene(), plateId), `construct${suffix}.stl`, 'model/stl');
}

/** 3MF con tutti i piatti, affiancati lungo X (larghezza del piano più 20 mm di distanza). */
export async function export3mf(): Promise<void> {
  download(await getKernel().export3mf(scene(), useUiStore.getState().bedSize.width + PLATE_GAP), 'construct.3mf', 'model/3mf');
}

/**
 * Codice OpenSCAD. Se la scena ha del testo il codice importa i font con `use <file.ttf>` (file accanto al codice):
 * il download diventa uno ZIP con il .scad e i font usati, pronto da aprire in OpenSCAD.
 */
export async function exportScad(): Promise<void> {
  // Il generatore OpenSCAD si scarica solo quando serve (esportazione o modale del codice)
  const { sceneToOpenScad } = await import('../codegen/openscad');
  const code = sceneToOpenScad(scene(), { plateSpacing: useUiStore.getState().bedSize.width + PLATE_GAP });
  const fonts = fontsUsed(scene());
  if (fonts.length === 0) {
    download(code, 'construct.scad', 'text/plain');
    return;
  }
  try {
    const files: Record<string, Uint8Array> = { 'construct.scad': strToU8(code) };
    for (const font of fonts) {
      const response = await fetch(font.url);
      if (!response.ok) throw new Error(`${font.label}: ${response.status}`);
      files[font.file] = new Uint8Array(await response.arrayBuffer());
    }
    download(zipSync(files), 'construct.zip', 'application/zip');
  } catch (err) {
    notify.error(err instanceof Error ? `Impossibile scaricare i font per lo ZIP: ${err.message}` : 'Impossibile creare lo ZIP con i font.');
  }
}

/** Nome predefinito del file di progetto. */
const DEFAULT_PROJECT_NAME = 'construct-progetto.json';

/**
 * File di progetto corrente. L'handle (solo Chrome ed Edge, dal selettore di file) permette a "Salva" di riscrivere lo
 * stesso file senza chiedere; il nome si propone la volta dopo anche dove l'handle non esiste.
 */
let projectHandle: ProjectFileHandle | null = null;
let projectName = DEFAULT_PROJECT_NAME;

/** Nome file valido: senza caratteri vietati e con l'estensione .json. */
function jsonFileName(name: string): string {
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return /\.json$/i.test(clean) ? clean : `${clean}.json`;
}

async function writeProject(handle: ProjectFileHandle): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(sceneToJson(scene()));
  await writable.close();
}

/**
 * Salva con nome. Dove c'è il selettore di file del browser (Chrome, Edge) si sceglie nome e cartella; altrove una
 * finestra chiede il nome e il file va nella cartella dei download.
 */
export async function saveProjectAs(): Promise<void> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: projectName,
        types: [{ description: 'Progetto Construct', accept: { 'application/json': ['.json'] } }],
      });
      await writeProject(handle);
      projectHandle = handle;
      projectName = handle.name;
      notify.info(`Salvato: ${handle.name}`);
    } catch (err) {
      // Finestra chiusa senza scegliere: non è un errore
      if (err instanceof DOMException && err.name === 'AbortError') return;
      notify.error(err instanceof Error ? `Impossibile salvare: ${err.message}` : 'Impossibile salvare il progetto.');
    }
    return;
  }
  const name = await promptDialog('Nome del file di progetto', projectName, 'Salva');
  if (name === null || name.trim() === '') return;
  projectName = jsonFileName(name);
  download(sceneToJson(scene()), projectName, 'application/json');
  notify.info(`Salvato: ${projectName}`);
}

/** Salva: riscrive il file già scelto; la prima volta (o senza file noto) chiede nome e cartella. */
export async function saveProject(): Promise<void> {
  if (!projectHandle) return saveProjectAs();
  try {
    await writeProject(projectHandle);
    notify.info(`Salvato: ${projectName}`);
  } catch {
    // Permesso negato o file spostato: si chiede di nuovo dove salvare
    projectHandle = null;
    await saveProjectAs();
  }
}

/** Carica nella scena il testo di un progetto JSON (file aperto o esempio incorporato); `name` è il nome proposto al salvataggio. */
async function loadProjectText(text: string, name: string): Promise<void> {
  const { scene, assets } = sceneFromJson(text);
  // Le mesh del progetto entrano nell'archivio locale, poi si registrano nel kernel
  for (const asset of assets) await addAsset(asset.positions, asset.indices);
  useSceneStore.getState().loadScene(await restoreAssets(scene));
  // Il nome si ricorda per il prossimo salvataggio; il file aperto non si può riscrivere (nessun handle)
  projectName = name;
  projectHandle = null;
}

/** Apre il selettore file e carica un progetto JSON; gli errori arrivano all'utente con un avviso. */
export function openProject(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await loadProjectText(await file.text(), file.name);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Impossibile aprire il file.');
    }
  };
  input.click();
}

/** Apre un modello di esempio al posto della scena (annullabile) e lo inquadra appena il kernel lo ha calcolato. */
export async function openExample(example: Example): Promise<void> {
  try {
    await loadProjectText(await example.load(), `${example.id}.json`);
  } catch (err) {
    notify.error(err instanceof Error ? `Impossibile aprire l'esempio: ${err.message}` : 'Impossibile aprire l\'esempio.');
    return;
  }
  // Il calcolo parte dopo il caricamento (effetto di useKernel): alla prima fine si inquadra tutta la scena
  const unsubscribe = useResultStore.subscribe((state, prev) => {
    if (!prev.busy || state.busy) return;
    unsubscribe();
    fitView(false);
  });
  notify.info(`Esempio aperto: ${example.title}.`);
}

/** Svuota la scena; se non è vuota chiede conferma (l'azione resta annullabile con Ctrl+Z). */
export async function newProject(): Promise<void> {
  // Con più piatti conta ogni piatto, non solo quello in vista
  const hasObjects = allRootIds(scene()).length > 0;
  // Con la scena vuota non si chiede nulla; altrimenti la casella permette di azzerare anche la timeline
  const answer = hasObjects
    ? await confirmWithOption('Svuotare la scena? Potrai annullare con Ctrl+Z.', 'Svuota', 'Svuota anche la cronologia (la timeline riparte da zero e non si potrà annullare)')
    : { ok: true, checked: false };
  if (answer.ok) {
    useSceneStore.getState().clear();
    if (answer.checked) {
      // `op` non fa parte dell'uguaglianza della cronologia: riportarlo a "Inizio" non crea un passo
      useSceneStore.temporal.getState().clear();
      useSceneStore.setState({ op: 'Inizio' });
    }
    // Un progetto nuovo non ha ancora un file
    projectHandle = null;
    projectName = DEFAULT_PROJECT_NAME;
  }
}
