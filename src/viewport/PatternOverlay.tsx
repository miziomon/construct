import { usePatternTool } from '../ui/Pattern/patternToolStore';
import { FaceHighlight } from './EdgeToolOverlay';
import { useViewportPalette } from './palette';

/** Evidenzia nella vista 3D la faccia sotto il puntatore mentre si sceglie la faccia del Pattern. */
export function PatternOverlay() {
  const hover = usePatternTool((s) => s.hover);
  const palette = useViewportPalette();
  if (!hover) return null;
  return <FaceHighlight pick={hover} color={palette.facePick} />;
}
