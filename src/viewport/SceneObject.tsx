import { useEffect, useMemo, useRef, useState } from 'react';
import { Edges, TransformControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { NodeMesh } from '../kernel/evaluate';
import { useSceneStore } from '../scene/store';
import { useViewportPalette } from './palette';
import { round } from '../scene/math';
import { halfHeight } from '../scene/defaults';
import { applyScale } from '../scene/resize';
import type { Vec3 } from '../scene/types';

const SNAP_MOVE = 1; // mm
const SNAP_ROTATE = THREE.MathUtils.degToRad(15);

interface Props {
  mesh: NodeMesh;
  selected: boolean;
  /** Oggetto bloccato: il contorno di selezione diventa giallo. */
  locked: boolean;
  /** Il gizmo si mostra solo con un singolo oggetto selezionato. */
  showGizmo: boolean;
}

/** Costruisce la matrice di un nodo da posizione e rotazione (ordine ZYX = prima X, poi Y, poi Z). */
function nodeMatrix(position: Vec3, rotation: Vec3): THREE.Matrix4 {
  const euler = new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as [number, number, number], 'ZYX');
  return new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(euler), new THREE.Vector3(1, 1, 1));
}

/**
 * Un oggetto alla radice della scena. La mesh arriva già in coordinate mondo dal kernel:
 * durante il trascinamento del gizmo si applica solo una matrice di spostamento al gruppo
 * (anteprima istantanea), e al rilascio la nuova posizione va nello store e il kernel ricalcola.
 */
export function SceneObject({ mesh, selected, locked, showGizmo }: Props) {
  const node = useSceneStore((s) => s.scene.nodes[mesh.id]);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);
  const palette = useViewportPalette();
  const select = useSceneStore((s) => s.select);
  const updateNode = useSceneStore((s) => s.updateNode);

  const wrapper = useRef<THREE.Group>(null);
  // Il proxy è in uno state (ref callback) perché il gizmo deve montarsi dopo che l'oggetto esiste
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null);
  const startMatrix = useRef(new THREE.Matrix4());
  const [shift, setShift] = useState(false);

  // Geometria da buffer; "flatShading" sul materiale evita lo smussamento degli spigoli
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Quando arriva la mesh ricalcolata, l'eventuale spostamento di anteprima non serve più
  useEffect(() => {
    const w = wrapper.current;
    if (w) {
      w.matrix.identity();
      w.matrixWorldNeedsUpdate = true;
    }
  }, [mesh]);

  // Shift disattiva lo snap durante il trascinamento
  useEffect(() => {
    const set = (e: KeyboardEvent) => setShift(e.shiftKey);
    window.addEventListener('keydown', set);
    window.addEventListener('keyup', set);
    return () => {
      window.removeEventListener('keydown', set);
      window.removeEventListener('keyup', set);
    };
  }, []);

  if (!node) return null;

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Solo il tasto sinistro seleziona; con Shift si aggiunge alla selezione
    if (e.button !== 0) return;
    e.stopPropagation();
    select([mesh.id], e.shiftKey);
  };

  const scaling = gizmoMode === 'resize' || gizmoMode === 'extrude';
  // Solo forme con misure proprie si ridimensionano (non gruppi né mesh); Estrudi solo le forme 2D
  const resizable = (node.type === 'primitive' || node.type === 'shape2d') && (gizmoMode !== 'extrude' || node.type === 'shape2d');

  /** Scala letta dal gizmo; in modalità Estrudi conta solo l'asse Z (il cubetto centrale non deve allargare il profilo). */
  const currentScale = (p: THREE.Object3D): Vec3 => (gizmoMode === 'extrude' ? [1, 1, p.scale.z] : [p.scale.x, p.scale.y, p.scale.z]);

  /** Anteprima del trascinamento: matrice = corrente * inversa(iniziale). */
  const onChange = () => {
    const p = proxy;
    const w = wrapper.current;
    if (!p || !w) return;
    if (scaling && (node.type === 'primitive' || node.type === 'shape2d')) {
      // Scala attorno al centro della base (punto più basso, a -hz in locale): la base resta ferma
      const [sx, sy, sz] = currentScale(p);
      const base = new THREE.Matrix4().makeTranslation(0, 0, -halfHeight(node));
      const local = base.clone().multiply(new THREE.Matrix4().makeScale(sx, sy, sz)).multiply(base.clone().invert());
      const world = nodeMatrix(node.position, node.rotation);
      w.matrix.copy(world).multiply(local).multiply(world.clone().invert());
      w.matrixWorldNeedsUpdate = true;
      return;
    }
    p.updateMatrix();
    w.matrix.copy(p.matrix).multiply(startMatrix.current.clone().invert());
    w.matrixWorldNeedsUpdate = true;
  };

  /** Al rilascio salva posizione e rotazione (arrotondate) nello store. */
  const onCommit = () => {
    const p = proxy;
    if (!p) return;
    if (scaling) {
      if (node.type !== 'primitive' && node.type !== 'shape2d') return;
      const scale = currentScale(p);
      p.scale.set(1, 1, 1);
      if (scale.every((v) => v === 1)) return;
      // La scala diventa misure vere (Maiusc: passo fine di 0,01 mm invece di 0,5 mm)
      const patch = applyScale(node, scale, shift ? 0.01 : 0.5);
      // La base resta ferma: il centro si sposta lungo lo Z locale della differenza di mezza altezza
      const dz = halfHeight({ ...node, ...patch } as typeof node) - halfHeight(node);
      const shift3 = new THREE.Vector3(0, 0, dz).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(nodeMatrix(node.position, node.rotation)));
      const position = node.position.map((v, i) => round(v + shift3.getComponent(i), 3)) as Vec3;
      updateNode(mesh.id, { ...patch, position } as never);
      return;
    }
    const euler = new THREE.Euler().setFromQuaternion(p.quaternion, 'ZYX');
    updateNode(mesh.id, {
      position: p.position.toArray().map((v) => round(v, 3)) as Vec3,
      rotation: [euler.x, euler.y, euler.z].map((v) => round(THREE.MathUtils.radToDeg(v), 3)) as Vec3,
    });
  };

  const color = mesh.isHole ? '#ff4d4d' : mesh.color;

  return (
    <>
      <group ref={wrapper} matrixAutoUpdate={false}>
        <mesh geometry={geometry} onPointerDown={onPointerDown}>
          <meshStandardMaterial
            color={color}
            flatShading
            roughness={0.55}
            metalness={0.05}
            transparent={mesh.isHole}
            opacity={mesh.isHole ? 0.45 : 1}
            depthWrite={!mesh.isHole}
          />
          {selected && <Edges threshold={20} color={locked ? palette.selectionLocked : palette.selection} />}
        </mesh>
      </group>

      {/* Oggetto invisibile nella posizione del nodo: è lui che il gizmo muove */}
      <object3D
        ref={setProxy}
        position={node.position}
        rotation={new THREE.Euler(...(node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]), 'ZYX')}
      />
      {showGizmo && proxy && gizmoMode !== 'select' && (!scaling || resizable) && (
        <TransformControls
          object={proxy}
          mode={scaling ? 'scale' : gizmoMode}
          // In modalità Estrudi resta solo l'asse Z (l'altezza dell'estrusione)
          showX={gizmoMode !== 'extrude'}
          showY={gizmoMode !== 'extrude'}
          size={0.8}
          translationSnap={shift ? null : SNAP_MOVE}
          rotationSnap={shift ? null : SNAP_ROTATE}
          onMouseDown={() => startMatrix.current.copy(nodeMatrix(node.position, node.rotation))}
          onObjectChange={onChange}
          onMouseUp={onCommit}
        />
      )}
    </>
  );
}
