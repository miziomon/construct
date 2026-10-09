import { useSceneStore } from '../../scene/store';
import { useArrayTool } from '../Array/arrayToolStore';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { useLayFlat } from '../LayFlat/layFlatStore';
import { useMeasure } from '../Measure/measureStore';
import { usePatternTool } from '../Pattern/patternToolStore';
import { useShellTool } from '../Shell/shellToolStore';
import { canSplit, useSplitTool } from './splitToolStore';

/** Apre Dividi sulla selezione (chiudendo gli altri strumenti); se è già aperto lo annulla. Usata da barra e Maiusc+S. */
export function toggleSplit(): void {
  const split = useSplitTool.getState();
  if (split.active) return split.cancel();
  const { scene, selection } = useSceneStore.getState();
  if (!canSplit(scene, selection)) return;
  // Un solo strumento alla volta
  useEdgeTool.getState().cancel();
  useShellTool.getState().cancel();
  useMeasure.getState().cancel();
  useLayFlat.getState().cancel();
  useArrayTool.getState().cancel();
  usePatternTool.getState().cancel();
  split.start();
}
