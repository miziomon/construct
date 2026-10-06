import { useResultStore } from './useKernel';
import { useSceneStore } from '../scene/store';

/** Appoggia sul piatto gli oggetti selezionati, usando l'ingombro calcolato dal kernel. */
export function dropSelectionToBed(): void {
  const minZ: Record<string, number> = {};
  for (const m of useResultStore.getState().meshes) if (!m.empty) minZ[m.id] = m.bbox.min[2];
  useSceneStore.getState().dropToBed(minZ);
}
