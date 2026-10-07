import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { isLocked, useSceneStore } from '../scene/store';
import { useResultStore } from '../kernel/useKernel';
import { Bed } from './Bed';
import { useViewportPalette } from './palette';
import { SceneObject } from './SceneObject';
import { SelectionActions } from '../ui/SelectionActions/SelectionActions';
import { useEdgeTool } from '../ui/EdgeTool/edgeToolStore';
import { EdgeToolOverlay } from './EdgeToolOverlay';
import { GhostOperands } from './GhostOperands';
import { useShellTool } from '../ui/Shell/shellToolStore';
import { lazyLoad } from '../ui/lazyLoad';
import { useMeasure } from '../ui/Measure/measureStore';
import { MeasureOverlay } from './MeasureOverlay';
import { LayFlatOverlay } from './LayFlatOverlay';
import { useLayFlat } from '../ui/LayFlat/layFlatStore';
import { useArrayTool } from '../ui/Array/arrayToolStore';
import { usePatternTool } from '../ui/Pattern/patternToolStore';
import { PatternOverlay } from './PatternOverlay';
import { PlacementPreview } from './PlacementPreview';
import './Viewport.scss';

// I pannelli degli strumenti si scaricano alla prima attivazione (restano fuori dal caricamento iniziale)
const EdgeToolPanel = lazyLoad(() => import('../ui/EdgeTool/EdgeToolPanel').then((m) => ({ default: m.EdgeToolPanel })));
const CornerPanel = lazyLoad(() => import('../ui/EdgeTool/CornerPanel').then((m) => ({ default: m.CornerPanel })));
const ShellPanel = lazyLoad(() => import('../ui/Shell/ShellPanel').then((m) => ({ default: m.ShellPanel })));
const MeasurePanel = lazyLoad(() => import('../ui/Measure/MeasurePanel').then((m) => ({ default: m.MeasurePanel })));
const ArrayPanel = lazyLoad(() => import('../ui/Array/ArrayPanel').then((m) => ({ default: m.ArrayPanel })));
const PatternPanel = lazyLoad(() => import('../ui/Pattern/PatternPanel').then((m) => ({ default: m.PatternPanel })));
const LayFlatPanel = lazyLoad(() => import('../ui/LayFlat/LayFlatPanel').then((m) => ({ default: m.LayFlatPanel })));

// Asse Z verso l'alto come negli slicer: va impostato prima della creazione di camera e controlli
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/** Solo nella build dei test end-to-end: espone camera e scena per calcolare dove cliccare. */
function E2EBridge() {
  const state = useThree();
  useEffect(() => {
    window.__r3f = state;
  });
  return null;
}

export function Viewport() {
  const meshes = useResultStore((s) => s.meshes);
  const selection = useSceneStore((s) => s.selection);
  const select = useSceneStore((s) => s.select);
  const rootIds = useSceneStore((s) => s.scene.rootIds);
  const scene = useSceneStore((s) => s.scene);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);
  const palette = useViewportPalette();
  // Le mesh si raggruppano per oggetto alla radice: un Raggruppa ha una mesh per figlio, ma un solo gizmo
  const meshesByRoot = useMemo(() => {
    const map = new Map<string, typeof meshes>();
    for (const m of meshes) map.set(m.rootId, [...(map.get(m.rootId) ?? []), m]);
    return map;
  }, [meshes]);

  // Gizmo solo fuori dalla modalità Seleziona, con un oggetto selezionato, alla radice e non bloccato
  const edgeTool = useEdgeTool((s) => s.tool);
  const edgeToolActive = edgeTool !== null;
  // Anche con il Guscio aperto il gizmo sparisce: l'oggetto in anteprima non va spostato
  const shellToolActive = useShellTool((s) => s.active);
  // Anche con la Misura aperta: i clic scelgono punti, non oggetti, e il gizmo non serve
  const measureActive = useMeasure((s) => s.active);
  // Idem con Appoggia su una faccia: i clic scelgono una faccia, non oggetti
  const layFlatActive = useLayFlat((s) => s.active);
  // Con la Serie aperta l'oggetto in anteprima non va spostato col gizmo né deselezionato con un clic nel vuoto
  const arrayActive = useArrayTool((s) => s.active);
  // Idem con il Pattern: l'oggetto in anteprima non va spostato né deselezionato
  const patternActive = usePatternTool((s) => s.active);
  const gizmoId =
    !edgeToolActive && !shellToolActive && !measureActive && !layFlatActive && !arrayActive && !patternActive && gizmoMode !== 'select' && selection.length === 1 && rootIds.includes(selection[0]) && !isLocked(scene, selection[0]) ? selection[0] : undefined;

  return (
    <div className="viewport">
      <SelectionActions />
      {/* Un pannello per volta e solo da attivo: il suo codice si scarica alla prima attivazione dello strumento */}
      <Suspense fallback={null}>
        {edgeTool === 'corner' ? <CornerPanel /> : edgeTool ? <EdgeToolPanel /> : null}
        {shellToolActive && <ShellPanel />}
        {measureActive && <MeasurePanel />}
        {layFlatActive && <LayFlatPanel />}
        {arrayActive && <ArrayPanel />}
        {patternActive && <PatternPanel />}
      </Suspense>
      <Canvas
        // Il rendering parte solo quando serve (movimenti, modifiche): meno consumo di CPU/GPU
        frameloop="demand"
        camera={{ position: [210, -260, 190], fov: 38, near: 1, far: 6000 }}
        gl={{ antialias: true }}
        // Click nel vuoto: deseleziona
        // (con Raccordo o Smusso attivi un clic nel vuoto non deve toccare la selezione)
        onPointerMissed={(e) => e.button === 0 && !edgeToolActive && !shellToolActive && !measureActive && !layFlatActive && !arrayActive && !patternActive && select([])}
      >
        <color attach="background" args={[palette.background]} />
        {/* Luci semplici, senza mappe ambiente da scaricare: l'app resta utilizzabile offline */}
        <hemisphereLight args={[palette.skyLight, palette.groundLight, 0.9]} />
        <directionalLight position={[150, -200, 300]} intensity={1.6} />
        <directionalLight position={[-200, 150, 120]} intensity={0.5} />

        {import.meta.env.MODE === 'e2e' && <E2EBridge />}
        <Bed />
        <EdgeToolOverlay />
        <MeasureOverlay />
        <LayFlatOverlay />
        <PatternOverlay />
        <PlacementPreview />
        {[...meshesByRoot].map(([rootId, parts]) => (
          <SceneObject key={rootId} rootId={rootId} meshes={parts} selection={selection} locked={isLocked(scene, rootId)} showGizmo={rootId === gizmoId} />
        ))}

        <GhostOperands />

        <OrbitControls makeDefault target={[0, 0, 20]} enableDamping={false} maxDistance={2500} />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#ff5d5d', '#46c47a', '#4da3ff']} labelColor={palette.axisLabel} />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
