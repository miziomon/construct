import { Grid, Line } from '@react-three/drei';
import { BED_SIZE } from '../scene/types';
import { useUiStore } from '../ui/uiStore';
import { useViewportPalette } from './palette';

const HALF = BED_SIZE / 2;

/**
 * Piatto di stampa 256 × 256 mm sul piano XY, con griglia da 10 mm e linee principali ogni 50 mm.
 * Tre stati (tasto P): completo, senza la superficie piena (restano griglia e bordo), nascosto.
 */
export function Bed() {
  const mode = useUiStore((s) => s.bedMode);
  const palette = useViewportPalette();
  if (mode === 'none') return null;

  return (
    <group name="bed">
      {/* Superficie del piatto, leggermente sotto lo zero per non sovrapporsi alla griglia */}
      {mode === 'full' && (
        <mesh name="bed-plate" position={[0, 0, -0.05]} receiveShadow>
          <planeGeometry args={[BED_SIZE, BED_SIZE]} />
          <meshStandardMaterial color={palette.bedPlate} roughness={1} />
        </mesh>
      )}
      {/* Drei disegna la griglia sul piano XZ: la ruotiamo sul piano XY (Z verso l'alto) */}
      <Grid
        name="bed-grid"
        args={[BED_SIZE, BED_SIZE]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0.02]}
        cellSize={10}
        cellThickness={0.6}
        cellColor={palette.gridCell}
        sectionSize={50}
        sectionThickness={1.1}
        sectionColor={palette.gridSection}
        fadeDistance={900}
        infiniteGrid={false}
      />
      <Line
        name="bed-border"
        // Il primo punto è ripetuto in fondo per chiudere il perimetro
        points={[[-HALF, -HALF, 0.03], [HALF, -HALF, 0.03], [HALF, HALF, 0.03], [-HALF, HALF, 0.03], [-HALF, -HALF, 0.03]]}
        color={palette.bedBorder}
        lineWidth={1.5}
      />
    </group>
  );
}
