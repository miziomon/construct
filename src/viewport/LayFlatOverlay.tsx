import { useLayFlat } from '../ui/LayFlat/layFlatStore';
import { FaceHighlight } from './EdgeToolOverlay';
import { useViewportPalette } from './palette';

/** Evidenzia nella vista 3D la faccia sotto il puntatore mentre Appoggia su una faccia è aperto. */
export function LayFlatOverlay() {
  const hover = useLayFlat((s) => s.hover);
  const palette = useViewportPalette();
  if (!hover) return null;
  return <FaceHighlight pick={hover} color={palette.facePick} />;
}
