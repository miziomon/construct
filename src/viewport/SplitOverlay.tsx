import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useSplitTool } from '../ui/Split/splitToolStore';
import type { Vec3 } from '../scene/types';
import { useViewportPalette } from './palette';

/** Piano di taglio di Dividi: una lastra semitrasparente che copre l'ingombro del pezzo, come il piano di Specchia. */
export function SplitOverlay() {
  const active = useSplitTool((s) => s.active);
  const axis = useSplitTool((s) => s.axis);
  const offset = useSplitTool((s) => s.offset);
  const bounds = useSplitTool((s) => s.bounds);
  const palette = useViewportPalette();
  const invalidate = useThree((s) => s.invalidate);

  // Il rendering è "a richiesta": a ogni cambio del piano bisogna chiedere un nuovo fotogramma
  useEffect(() => {
    invalidate();
  }, [active, axis, offset, bounds, invalidate]);

  if (!active || !bounds) return null;
  const margin = 6;
  const size = [0, 1, 2].map((i) => (i === axis ? 0.2 : Math.max(10, bounds.max[i] - bounds.min[i] + 2 * margin))) as Vec3;
  const center = [0, 1, 2].map((i) => (i === axis ? offset : (bounds.min[i] + bounds.max[i]) / 2)) as Vec3;
  return (
    <mesh position={center} renderOrder={4} raycast={() => null}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={palette.faceHover} transparent opacity={0.28} depthWrite={false} depthTest={false} />
    </mesh>
  );
}
