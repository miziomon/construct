import { getKernel } from '../kernel/client';
import { useSceneStore } from '../scene/store';
import { sceneFromJson, sceneToJson } from '../scene/persistence';
import { addAsset } from '../import/assets';
import { restoreAssets } from '../import/restore';
import { sceneToOpenScad } from '../codegen/openscad';
import { confirmDialog, notify } from './notify/notifyStore';

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

export function exportScad(): void {
  download(sceneToOpenScad(scene()), 'webcad.scad', 'text/plain');
}

export function saveProject(): void {
  download(sceneToJson(scene()), 'webcad-progetto.json', 'application/json');
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
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Impossibile aprire il file.');
    }
  };
  input.click();
}

/** Svuota la scena; se non è vuota chiede conferma (l'azione resta annullabile con Ctrl+Z). */
export async function newProject(): Promise<void> {
  const hasObjects = scene().rootIds.length > 0;
  if (!hasObjects || (await confirmDialog('Svuotare la scena? Potrai annullare con Ctrl+Z.', 'Svuota'))) useSceneStore.getState().clear();
}
