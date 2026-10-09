import { useSceneStore } from '../../scene/store';
import { platesOf } from '../../scene/plates';
import { useArrayTool } from '../Array/arrayToolStore';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { useLayFlat } from '../LayFlat/layFlatStore';
import { useMeasure } from '../Measure/measureStore';
import { usePatternTool } from '../Pattern/patternToolStore';
import { useShellTool } from '../Shell/shellToolStore';
import { useSplitTool } from '../Split/splitToolStore';
import { confirmDialog } from '../notify/notifyStore';

/**
 * Chiude gli strumenti a pannello aperti (Raccordo e Smussi, Guscio, Serie, Pattern, Misura, Appoggia): lavorano su
 * un'anteprima dell'oggetto selezionato e mettono in pausa la cronologia, quindi non si può cambiare piatto con uno aperto.
 */
export function closeTools(): void {
  useEdgeTool.getState().cancel();
  useShellTool.getState().cancel();
  useArrayTool.getState().cancel();
  usePatternTool.getState().cancel();
  useMeasure.getState().cancel();
  useLayFlat.getState().cancel();
  useSplitTool.getState().cancel();
}

/** Rende attivo un piatto (chiude prima gli strumenti aperti). */
export function activatePlate(id: string): void {
  if (platesOf(useSceneStore.getState().scene).every((p) => p.id !== id)) return;
  closeTools();
  useSceneStore.getState().switchPlate(id);
}

/** Aggiunge un piatto vuoto e lo rende attivo. */
export function createPlate(): string {
  closeTools();
  return useSceneStore.getState().addPlate();
}

/** Sposta gli oggetti selezionati in un altro piatto. */
export function moveSelectionToPlate(plateId: string): void {
  closeTools();
  useSceneStore.getState().moveSelectionToPlate(plateId);
}

/** Elimina un piatto; se contiene oggetti chiede conferma, perché spariscono con lui. */
export async function deletePlate(id: string): Promise<void> {
  const plate = platesOf(useSceneStore.getState().scene).find((p) => p.id === id);
  if (!plate || platesOf(useSceneStore.getState().scene).length < 2) return;
  if (plate.rootIds.length > 0) {
    const ok = await confirmDialog(`Eliminare "${plate.name}" con ${plate.rootIds.length === 1 ? 'il suo oggetto' : `i suoi ${plate.rootIds.length} oggetti`}? Si può annullare con Ctrl+Z.`, 'Elimina');
    if (!ok) return;
  }
  closeTools();
  useSceneStore.getState().removePlate(id);
}
