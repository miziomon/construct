import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Grid, Line } from '@react-three/drei';
import { useUiStore } from '../ui/uiStore';
import { useViewportPalette } from './palette';

/**
 * Piatto di stampa (256 × 256 mm di default, modificabile dalla barra di stato) sul piano XY, con griglia da 10 mm e linee principali ogni 50 mm.
 * Tre stati (tasto P): completo, senza la superficie piena (restano griglia e bordo), nascosto.
 */
export function Bed() {
  const mode = useUiStore((s) => s.bedMode);
  const { width, depth } = useUiStore((s) => s.bedSize);
  // In ortografica la camera può stare molto lontana senza che la vista cambi: la griglia non deve dissolversi
  const orthographic = useUiStore((s) => s.projection === 'orthographic');
  const halfX = width / 2;
  const halfY = depth / 2;
  const palette = useViewportPalette();
  const invalidate = useThree((s) => s.invalidate);

  // Il rendering è "a richiesta": togliere un oggetto dalla scena non richiede un nuovo frame (R3F non lo fa per
  // gli oggetti rimossi), quindi il piatto resta montato e cambia solo la visibilità, e si chiede comunque un frame.
  useEffect(() => invalidate(), [mode, width, depth, orthographic, invalidate]);

  return (
    <group name="bed" visible={mode !== 'none'}>
      {/* Superficie del piatto, leggermente sotto lo zero per non sovrapporsi alla griglia */}
      <mesh name="bed-plate" visible={mode === 'full'} position={[0, 0, -0.05]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={palette.bedPlate} roughness={1} />
      </mesh>
      {/* Drei disegna la griglia sul piano XZ: la ruotiamo sul piano XY (Z verso l'alto) */}
      <Grid
        name="bed-grid"
        args={[width, depth]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0.02]}
        cellSize={10}
        cellThickness={0.6}
        cellColor={palette.gridCell}
        sectionSize={50}
        sectionThickness={1.1}
        sectionColor={palette.gridSection}
        fadeDistance={orthographic ? 100000 : 900}
        infiniteGrid={false}
      />
      <Line
        name="bed-border"
        // Il primo punto è ripetuto in fondo per chiudere il perimetro
        points={[[-halfX, -halfY, 0.03], [halfX, -halfY, 0.03], [halfX, halfY, 0.03], [-halfX, halfY, 0.03], [-halfX, -halfY, 0.03]]}
        color={palette.bedBorder}
        lineWidth={1.5}
      />
    </group>
  );
}
