import { useResultStore } from './useKernel';
import { useSceneStore } from '../scene/store';

/** Appoggia sul piatto gli oggetti selezionati, usando l'ingombro calcolato dal kernel. */
export function dropSelectionToBed(): void {
  // Un Raggruppa ha una mesh per figlio: il suo punto più basso è il minimo tra tutte le sue mesh
  const minZ: Record<string, number> = {};
  for (const m of useResultStore.getState().meshes) {
    if (m.empty) continue;
    minZ[m.rootId] = Math.min(minZ[m.rootId] ?? Infinity, m.bbox.min[2]);
  }
  useSceneStore.getState().dropToBed(minZ);
}
