import { useSceneStore } from '../../scene/store';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { useLayFlat } from '../LayFlat/layFlatStore';
import { useMeasure } from '../Measure/measureStore';
import { usePatternTool } from '../Pattern/patternToolStore';
import { useShellTool } from '../Shell/shellToolStore';
import { canArray, useArrayTool } from './arrayToolStore';

/** Apre la Serie sulla selezione (chiudendo gli altri strumenti); se è già aperta la annulla. Usata da barra e tasto O. */
export function toggleArray(): void {
  const array = useArrayTool.getState();
  if (array.active) return array.cancel();
  const { scene, selection } = useSceneStore.getState();
  if (!canArray(scene, selection)) return;
  // Un solo strumento alla volta
  useEdgeTool.getState().cancel();
  useShellTool.getState().cancel();
  useMeasure.getState().cancel();
  useLayFlat.getState().cancel();
  usePatternTool.getState().cancel();
  array.start();
}
