import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useSceneStore } from '../scene/store';
import { useResultStore } from '../kernel/useKernel';
import { Bed } from './Bed';
import { SceneObject } from './SceneObject';
import './Viewport.scss';

// Asse Z verso l'alto come negli slicer: va impostato prima della creazione di camera e controlli
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export function Viewport() {
  const meshes = useResultStore((s) => s.meshes);
  const selection = useSceneStore((s) => s.selection);
  const select = useSceneStore((s) => s.select);
  const rootIds = useSceneStore((s) => s.scene.rootIds);

  // Gizmo solo con un oggetto selezionato che sta alla radice
  const gizmoId = selection.length === 1 && rootIds.includes(selection[0]) ? selection[0] : undefined;

  return (
    <div className="viewport">
      <Canvas
        // Il rendering parte solo quando serve (movimenti, modifiche): meno consumo di CPU/GPU
        frameloop="demand"
        camera={{ position: [210, -260, 190], fov: 38, near: 1, far: 6000 }}
        gl={{ antialias: true }}
        // Click nel vuoto: deseleziona
        onPointerMissed={(e) => e.button === 0 && select([])}
      >
        <color attach="background" args={['#14171c']} />
        {/* Luci semplici, senza mappe ambiente da scaricare: l'app resta utilizzabile offline */}
        <hemisphereLight args={['#ffffff', '#3a4350', 0.9]} />
        <directionalLight position={[150, -200, 300]} intensity={1.6} />
        <directionalLight position={[-200, 150, 120]} intensity={0.5} />

        <Bed />
        {meshes.map((m) => (
          <SceneObject key={m.id} mesh={m} selected={selection.includes(m.id)} showGizmo={m.id === gizmoId} />
        ))}

        <OrbitControls makeDefault target={[0, 0, 20]} enableDamping={false} maxDistance={2500} />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#ff5d5d', '#46c47a', '#4da3ff']} labelColor="#14171c" />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
