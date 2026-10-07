import { useSceneStore } from '../../scene/store';
import { useArrayTool } from '../Array/arrayToolStore';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { useLayFlat } from '../LayFlat/layFlatStore';
import { useMeasure } from '../Measure/measureStore';
import { useShellTool } from '../Shell/shellToolStore';
import { canPattern, usePatternTool } from './patternToolStore';

/** Apre il Pattern sulla selezione (chiudendo gli altri strumenti); se è già aperto lo annulla. Usata da barra e tasto Z. */
export function togglePattern(): void {
  const pattern = usePatternTool.getState();
  if (pattern.active) return pattern.cancel();
  const { scene, selection } = useSceneStore.getState();
  if (!canPattern(scene, selection)) return;
  // Un solo strumento alla volta
  useEdgeTool.getState().cancel();
  useShellTool.getState().cancel();
  useMeasure.getState().cancel();
  useLayFlat.getState().cancel();
  useArrayTool.getState().cancel();
  pattern.start();
}
