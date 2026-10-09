import { useSceneStore } from '../../scene/store';
import { useArrayTool } from '../Array/arrayToolStore';
import { usePatternTool } from '../Pattern/patternToolStore';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { useMeasure } from '../Measure/measureStore';
import { useShellTool } from '../Shell/shellToolStore';
import { useSplitTool } from '../Split/splitToolStore';
import { useLayFlat } from './layFlatStore';

/** Apre Appoggia su una faccia (chiudendo gli altri strumenti); se è già aperto lo chiude. Usata da barra e tasto V. */
export function toggleLayFlat(): void {
  const layFlat = useLayFlat.getState();
  if (layFlat.active) return layFlat.cancel();
  // Un solo strumento alla volta
  useEdgeTool.getState().cancel();
  useShellTool.getState().cancel();
  useMeasure.getState().cancel();
  useArrayTool.getState().cancel();
  usePatternTool.getState().cancel();
  useSplitTool.getState().cancel();
  // I clic scelgono una faccia, quindi la selezione si azzera (come per gli altri strumenti)
  useSceneStore.getState().select([]);
  layFlat.start();
}
