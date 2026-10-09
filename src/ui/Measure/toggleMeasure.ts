import { useSceneStore } from '../../scene/store';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { useShellTool } from '../Shell/shellToolStore';
import { useLayFlat } from '../LayFlat/layFlatStore';
import { useArrayTool } from '../Array/arrayToolStore';
import { usePatternTool } from '../Pattern/patternToolStore';
import { useSplitTool } from '../Split/splitToolStore';
import { useMeasure } from './measureStore';

/** Apre la Misura (chiudendo Raccordo, Smusso e Guscio); se è già aperta la chiude. Usata da barra e tasto I. */
export function toggleMeasure(): void {
  const measure = useMeasure.getState();
  if (measure.active) return measure.cancel();
  // Un solo strumento alla volta
  useEdgeTool.getState().cancel();
  useShellTool.getState().cancel();
  useLayFlat.getState().cancel();
  useArrayTool.getState().cancel();
  usePatternTool.getState().cancel();
  useSplitTool.getState().cancel();
  // Come Raccordo e Smusso: i clic scelgono punti, quindi la selezione si azzera (e la barra delle booleane sparisce)
  useSceneStore.getState().select([]);
  measure.start();
}
