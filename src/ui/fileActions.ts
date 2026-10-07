import { getKernel } from '../kernel/client';
import { useSceneStore } from '../scene/store';
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

export async function exportStl(): Promise<void> {
  download(await getKernel().exportStl(scene()), 'webcad.stl', 'model/stl');
}

export async function export3mf(): Promise<void> {
  download(await getKernel().export3mf(scene()), 'webcad.3mf', 'model/3mf');
}

/**
 * Codice OpenSCAD. Se la scena ha del testo il codice importa i font con `use <file.ttf>` (file accanto al codice):
 * il download diventa uno ZIP con il .scad e i font usati, pronto da aprire in OpenSCAD.
 */
export async function exportScad(): Promise<void> {
  // Il generatore OpenSCAD si scarica solo quando serve (esportazione o modale del codice)
  const { sceneToOpenScad } = await import('../codegen/openscad');
  const code = sceneToOpenScad(scene());
  const fonts = fontsUsed(scene());
  if (fonts.length === 0) {
    download(code, 'webcad.scad', 'text/plain');
    return;
  }
  try {
    const files: Record<string, Uint8Array> = { 'webcad.scad': strToU8(code) };
    for (const font of fonts) {
      const response = await fetch(font.url);
      if (!response.ok) throw new Error(`${font.label}: ${response.status}`);
      files[font.file] = new Uint8Array(await response.arrayBuffer());
    }
    download(zipSync(files), 'webcad.zip', 'application/zip');
  } catch (err) {
    notify.error(err instanceof Error ? `Impossibile scaricare i font per lo ZIP: ${err.message}` : 'Impossibile creare lo ZIP con i font.');
  }
}

/** Nome predefinito del file di progetto. */
const DEFAULT_PROJECT_NAME = 'webcad-progetto.json';

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
        types: [{ description: 'Progetto WebCAD', accept: { 'application/json': ['.json'] } }],
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

/** Apre il selettore file e carica un progetto JSON; gli errori arrivano all'utente con un avviso. */
export function openProject(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { scene, assets } = sceneFromJson(await file.text());
      // Le mesh del progetto entrano nell'archivio locale, poi si registrano nel kernel
      for (const asset of assets) await addAsset(asset.positions, asset.indices);
      useSceneStore.getState().loadScene(await restoreAssets(scene));
      // Il nome si ricorda per il prossimo salvataggio; il file aperto non si può riscrivere (nessun handle)
      projectName = file.name;
      projectHandle = null;
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Impossibile aprire il file.');
    }
  };
  input.click();
}

/** Svuota la scena; se non è vuota chiede conferma (l'azione resta annullabile con Ctrl+Z). */
export async function newProject(): Promise<void> {
  const hasObjects = scene().rootIds.length > 0;
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
