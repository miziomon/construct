import { produce } from 'immer';
import { getKernel } from '../kernel/client';
import type { Scene } from '../scene/types';
import { notify } from '../ui/notify/notifyStore';
import { loadAssets } from './assets';

/** Rimuove i nodi indicati e i riferimenti ai loro id (radici e figli dei gruppi). */
function prune(scene: Scene, doomed: Set<string>): Scene {
  return produce(scene, (draft) => {
    for (const id of doomed) delete draft.nodes[id];
    draft.rootIds = draft.rootIds.filter((id) => !doomed.has(id));
    // Anche i piatti parcheggiati: nessuna radice deve restare senza nodo
    for (const plate of draft.plates ?? []) plate.rootIds = plate.rootIds.filter((id) => !doomed.has(id));
    for (const n of Object.values(draft.nodes)) {
      if (n.type === 'group') n.children = n.children.filter((c) => !doomed.has(c));
    }
  });
}

/**
 * Prepara le mesh importate di una scena appena caricata: le recupera dall'archivio locale e le registra nel kernel.
 * I nodi la cui mesh manca o non è valida vengono tolti dalla scena, con un avviso.
 */
export async function restoreAssets(scene: Scene): Promise<Scene> {
  const meshNodes = Object.values(scene.nodes).filter((n) => n.type === 'mesh');
  if (!meshNodes.length) return scene;

  const found = await loadAssets([...new Set(meshNodes.map((n) => n.assetId))]);
  const usable = new Set<string>();
  for (const asset of found) {
    const check = await getKernel().registerAsset(asset.id, asset.positions, asset.indices);
    if (check.ok) usable.add(asset.id);
  }

  const doomed = new Set(meshNodes.filter((n) => !usable.has(n.assetId)).map((n) => n.id));
  if (!doomed.size) return scene;
  notify.error(`${doomed.size === 1 ? 'Una mesh importata non è più disponibile' : `${doomed.size} mesh importate non sono più disponibili`} e è stata rimossa dalla scena: reimporta il file originale.`);
  return prune(scene, doomed);
}
