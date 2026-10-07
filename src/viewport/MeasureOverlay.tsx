import { Html, Line } from '@react-three/drei';
import { measure } from '../scene/snap';
import type { Snap, SnapKind } from '../scene/snap';
import { formatMm } from '../scene/format';
import { useMeasure } from '../ui/Measure/measureStore';
import { useViewportPalette } from './palette';

/** Colore del marcatore per tipo di punto agganciato: si capisce a colpo d'occhio a cosa ci si è agganciati. */
const SNAP_COLORS: Record<SnapKind, string> = { vertex: '#ff9f1a', midpoint: '#22c1c3', edge: '#46c47a', face: '#4da3ff' };

/** Marcatore sempre visibile (anche dietro la superficie) che non intercetta i clic. */
function Marker({ snap, opacity = 1 }: { snap: Snap; opacity?: number }) {
  return (
    <mesh position={snap.point} renderOrder={4} raycast={() => null}>
      <sphereGeometry args={[1.5, 16, 12]} />
      <meshBasicMaterial color={SNAP_COLORS[snap.kind]} transparent opacity={opacity} depthTest={false} />
    </mesh>
  );
}

/**
 * Misura nella vista 3D: i punti scelti, il punto agganciato sotto il puntatore e, tra partenza e arrivo (o tra
 * partenza e puntatore, mentre si sceglie), la linea con la distanza in mm.
 */
export function MeasureOverlay() {
  const active = useMeasure((s) => s.active);
  const points = useMeasure((s) => s.points);
  const hover = useMeasure((s) => s.hover);
  const palette = useViewportPalette();
  if (!active) return null;

  // Con un solo punto scelto la linea segue il puntatore (anteprima); con due è la misura definitiva
  const end = points[1] ?? (points.length === 1 ? hover : null);
  const start = points[0];
  const mid = start && end ? ([0, 1, 2].map((i) => (start.point[i] + end.point[i]) / 2) as [number, number, number]) : null;

  return (
    <group>
      {points.map((p, i) => (
        <Marker key={i} snap={p} />
      ))}
      {hover && points.length < 2 && <Marker snap={hover} opacity={0.75} />}
      {start && end && mid && (
        <>
          <Line points={[start.point, end.point]} color={palette.selection} lineWidth={2} depthTest={false} renderOrder={4} raycast={() => null} />
          <Html position={mid} center style={{ pointerEvents: 'none' }}>
            <span className="measure-label">{formatMm(measure(start.point, end.point).distance)}</span>
          </Html>
        </>
      )}
    </group>
  );
}
