import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ChevronDown, ChevronUp, Maximize, Maximize2, Minimize2 } from 'lucide-react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { NodeMesh } from '../../kernel/evaluate';
import { boundingSphere, CAMERA_FOV, fitDistance, PRESET_DIRECTIONS } from '../../viewport/cameraControl';
import { LIGHTS } from '../../viewport/lights';
import { meshGeometry } from '../../viewport/meshGeometry';
import { useViewportPalette } from '../../viewport/palette';
import type { PreviewResult } from './usePreviewMesh';

/** Come si mostra l'anteprima: a dimensione normale, ingrandita (la sidebar mostra solo lei) o compressa (solo l'intestazione). */
export type PreviewMode = 'normal' | 'large' | 'collapsed';

interface Props extends PreviewResult {
  mode: PreviewMode;
  onMode: (mode: PreviewMode) => void;
  /** Ogni valore nuovo riporta la camera sull'inquadratura iniziale (pulsante Adatta). */
  fitSignal: number;
  onFit: () => void;
}

/** La mesh del solido (Z verso l'alto, come nella vista principale) con lo stesso materiale degli oggetti della scena. */
function PreviewSolid({ mesh }: { mesh: NodeMesh }) {
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => meshGeometry(mesh), [mesh]);
  useEffect(() => {
    // Il rendering è a richiesta: una mesh nuova chiede un frame
    invalidate();
    return () => geometry.dispose();
  }, [geometry, invalidate]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={mesh.color} flatShading roughness={0.55} metalness={0.05} />
    </mesh>
  );
}

/**
 * Porta la camera sull'inquadratura iniziale (isometrica) alla prima mesh, a ogni pressione di Adatta e quando l'area
 * cambia dimensione (Ingrandisci, Riduci, finestra); non si muove mentre si modifica il disegno.
 */
function FitCamera({ mesh, fitSignal }: { mesh: NodeMesh | null; fitSignal: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const { width, height } = useThree((s) => s.size);
  const hasMesh = mesh !== null;
  // L'ingombro si legge quando serve (all'arrivo della prima mesh e su Adatta), non a ogni modifica del disegno
  const bbox = mesh?.bbox;

  useEffect(() => {
    if (!hasMesh || !bbox || !controls) return;
    const { center, radius } = boundingSphere(bbox);
    const direction = new THREE.Vector3(...PRESET_DIRECTIONS.iso);
    // Distanza per far entrare la sfera sia nell'altezza sia nella larghezza dell'area (una colonna stretta e alta è limitata dalla larghezza)
    const horizontalFov = (2 * Math.atan(Math.tan((CAMERA_FOV * Math.PI) / 360) * (width / Math.max(height, 1))) * 180) / Math.PI;
    const distance = Math.max(fitDistance(radius), fitDistance(radius, horizontalFov));
    camera.position.set(center[0], center[1], center[2]).addScaledVector(direction, distance);
    controls.target.set(center[0], center[1], center[2]);
    controls.update();
    invalidate();
    // Solo la prima mesh, Adatta e il ridimensionamento: con le modifiche del disegno la camera resta dov'è
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMesh, fitSignal, controls, width, height]);
  return null;
}

/**
 * Anteprima 3D del Profilo: un secondo Canvas (a richiesta, con orbita) alimentato dalla mesh del kernel. Il pulsante
 * Comprimi smonta il Canvas, Ingrandisci porta l'anteprima a tutta la colonna. Allo smontaggio R3F rilascia da sé il contesto
 * WebGL (`forceContextLoss`: la modale si apre e si chiude spesso e i browser ne ammettono pochi); un secondo rilascio
 * esplicito darebbe l'avviso "context already lost" (l'e2e delle dieci aperture lo verifica).
 */
export function ProfilePreview({ mesh, state, mode, onMode, fitSignal, onFit }: Props) {
  const palette = useViewportPalette();
  const triangles = mesh ? mesh.indices.length / 3 : 0;
  const large = mode === 'large';

  return (
    <section className={`profile-editor__preview profile-editor__preview--${mode}`} aria-label="Anteprima 3D" data-state={state} data-triangles={triangles} data-volume={mesh ? mesh.volume : 0}>
      <header className="profile-editor__preview-head">
        <h3 className="profile-editor__section-title">Anteprima 3D</h3>
        <span className={`profile-editor__spinner${state === 'busy' ? ' profile-editor__spinner--on' : ''}`} role="status" aria-label={state === 'busy' ? 'Calcolo in corso' : state === 'error' ? 'Errore nel calcolo' : 'Anteprima pronta'} />
        <div className="profile-editor__preview-buttons">
          <button type="button" aria-label="Adatta l'anteprima" title="Adatta: riporta la vista sul solido" disabled={mode === 'collapsed'} onClick={onFit}>
            <Maximize size={14} />
          </button>
          <button type="button" aria-label={large ? 'Riduci l\'anteprima' : 'Ingrandisci l\'anteprima'} title={large ? 'Riduci: torna alla dimensione normale' : 'Ingrandisci: l\'anteprima occupa tutta la colonna'} onClick={() => onMode(large ? 'normal' : 'large')}>
            {large ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" aria-label={mode === 'collapsed' ? 'Mostra l\'anteprima' : 'Comprimi l\'anteprima'} title={mode === 'collapsed' ? 'Mostra l\'anteprima' : 'Comprimi: più spazio al disegno'} onClick={() => onMode(mode === 'collapsed' ? 'normal' : 'collapsed')}>
            {mode === 'collapsed' ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </header>
      {mode !== 'collapsed' && (
        <div className="profile-editor__preview-view">
          <Canvas frameloop="demand" camera={{ position: [60, -60, 50], up: [0, 0, 1], fov: CAMERA_FOV, near: 0.1, far: 1e6 }} gl={{ antialias: true }}>
            <color attach="background" args={[palette.background]} />
            <hemisphereLight args={[palette.skyLight, palette.groundLight, LIGHTS.hemisphere]} />
            <directionalLight position={LIGHTS.key.position} intensity={LIGHTS.key.intensity} />
            <directionalLight position={LIGHTS.fill.position} intensity={LIGHTS.fill.intensity} />
            {mesh && <PreviewSolid mesh={mesh} />}
            <OrbitControls makeDefault enableDamping={false} />
            <FitCamera mesh={mesh} fitSignal={fitSignal} />
          </Canvas>
          {!mesh && state !== 'busy' && <div className="profile-editor__preview-empty">Nessun solido da mostrare</div>}
          {state === 'error' && <div className="profile-editor__preview-empty">Calcolo non riuscito</div>}
        </div>
      )}
    </section>
  );
}
