import { getKernel } from '../kernel/client';
import { useSceneStore } from '../scene/store';
import type { Vec3 } from '../scene/types';
import { notify } from '../ui/notify/notifyStore';
import { addAsset, removeAsset } from './assets';
import { parseStl } from './stl';
import { parse3mf } from './threemf';
import { ImportError, type ImportedMesh } from './types';

/** Oltre questa soglia l'editor diventa troppo lento: il file viene rifiutato con un messaggio. */
const MAX_TRIANGLES = 2_000_000;

/**
 * Spiegazione leggibile dei motivi di rifiuto del kernel. Il kernel scrive gli stati con spazi ("Not manifold")
 * o in CamelCase: si normalizzano prima del confronto.
 */
export function explain(status: string): string {
  switch (status.replace(/\s+/g, '').toLowerCase()) {
    case 'notmanifold':
    case 'notmanifoldedge':
      return 'non è un solido chiuso (la mesh ha buchi o spigoli condivisi da più di due facce)';
    case 'negativevolume':
      return 'ha le facce rivolte verso l\'interno (volume negativo)';
    case 'emptymesh':
      return 'non contiene geometria utilizzabile';
    default:
      return `la mesh non è valida (${status})`;
  }
}

/** Sposta la mesh in modo che il centro del suo ingombro sia l'origine; restituisce centro e dimensioni. */
function recenter(mesh: ImportedMesh): { origin: Vec3; size: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  const origin = [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as Vec3;
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) p[i + k] -= origin[k];
  return { origin, size: [0, 1, 2].map((k) => max[k] - min[k]) as Vec3 };
}

/** Importa una singola mesh nella scena. Restituisce true se è stata aggiunta. */
async function addImported(mesh: ImportedMesh, fileName: string): Promise<boolean> {
  if (mesh.indices.length / 3 > MAX_TRIANGLES) {
    notify.error(`"${mesh.name}" ha troppi triangoli (${(mesh.indices.length / 3).toLocaleString('it-IT')}): il limite è ${MAX_TRIANGLES.toLocaleString('it-IT')}.`);
    return false;
  }
  const { origin, size } = recenter(mesh);
  const asset = await addAsset(mesh.positions, mesh.indices);
  const check = await getKernel().registerAsset(asset.id, mesh.positions, mesh.indices);
  if (!check.ok) {
    await removeAsset(asset.id);
    notify.error(`Impossibile importare "${mesh.name}": ${explain(check.status)}.`);
    return false;
  }
  useSceneStore.getState().addMesh({ assetId: asset.id, name: mesh.name, fileName, color: mesh.color, origin, size, triangles: check.triangles });
  return true;
}

/** Importa file STL e 3MF scelti dall'utente; ogni errore diventa una notifica e non blocca gli altri file. */
export async function importFiles(files: File[]): Promise<void> {
  let added = 0;
  for (const file of files) {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const buffer = await file.arrayBuffer();
      let meshes: ImportedMesh[];
      if (ext === 'stl') meshes = parseStl(buffer, baseName);
      else if (ext === '3mf') meshes = parse3mf(buffer, baseName);
      else throw new ImportError(`Formato non supportato: ${file.name}. Usa file STL o 3MF.`);
      for (const mesh of meshes) if (await addImported(mesh, file.name)) added++;
    } catch (err) {
      notify.error(err instanceof ImportError ? err.message : `Impossibile leggere "${file.name}".`);
    }
  }
  if (added) notify.info(added === 1 ? 'Mesh importata.' : `${added} mesh importate.`);
}

/** Apre il selettore file e importa quanto scelto. */
export function pickAndImport(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.stl,.3mf';
  input.multiple = true;
  input.onchange = () => void importFiles(Array.from(input.files ?? []));
  input.click();
}
