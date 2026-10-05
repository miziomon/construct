import { Grid, Line } from '@react-three/drei';
import { BED_SIZE } from '../scene/types';

const HALF = BED_SIZE / 2;

/** Piatto di stampa 256 × 256 mm sul piano XY, con griglia da 10 mm e linee principali ogni 50 mm. */
export function Bed() {
  return (
    <group>
      {/* Superficie del piatto, leggermente sotto lo zero per non sovrapporsi alla griglia */}
      <mesh position={[0, 0, -0.05]} receiveShadow>
        <planeGeometry args={[BED_SIZE, BED_SIZE]} />
        <meshStandardMaterial color="#1d232b" roughness={1} />
      </mesh>
      {/* Drei disegna la griglia sul piano XZ: la ruotiamo sul piano XY (Z verso l'alto) */}
      <Grid
        args={[BED_SIZE, BED_SIZE]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0.02]}
        cellSize={10}
        cellThickness={0.6}
        cellColor="#2f3945"
        sectionSize={50}
        sectionThickness={1.1}
        sectionColor="#44546a"
        fadeDistance={900}
        infiniteGrid={false}
      />
      <Line
        // Il primo punto è ripetuto in fondo per chiudere il perimetro
        points={[[-HALF, -HALF, 0.03], [HALF, -HALF, 0.03], [HALF, HALF, 0.03], [-HALF, HALF, 0.03], [-HALF, -HALF, 0.03]]}
        color="#4da3ff"
        lineWidth={1.5}
      />
    </group>
  );
}
