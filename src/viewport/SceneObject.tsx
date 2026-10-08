import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementRef } from 'react';
import { Edges, TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { NodeMesh } from '../kernel/evaluate';
import { useSceneStore } from '../scene/store';
import { useViewportPalette } from './palette';
import { round } from '../scene/math';
import { halfHeight } from '../scene/defaults';
import { applyScale } from '../scene/resize';
import { resizeGroup } from '../scene/groupScale';
import { localBounds } from '../scene/shell';
import { cornerAt, faceMap } from '../scene/edgeTool';
import { useEdgeTool } from '../ui/EdgeTool/edgeToolStore';
import { useMeasure } from '../ui/Measure/measureStore';
import { useLayFlat } from '../ui/LayFlat/layFlatStore';
import { usePatternTool } from '../ui/Pattern/patternToolStore';
import { layOnFaceAndDrop } from '../kernel/placement';
import { notify } from '../ui/notify/notifyStore';
import { useUiStore } from '../ui/uiStore';
import { getCommandContext } from '../ui/commands';
import { snapToMesh } from '../scene/snap';
import type { Vec3 } from '../scene/types';
import type { Transform } from '../scene/math';

/** Raggio di aggancio dello strumento Misura, in pixel dello schermo. */
const MEASURE_SNAP_PIXELS = 12;

interface Props {
  /** Oggetto alla radice della scena. */
  rootId: string;
  /** Mesh dell'oggetto: una sola, oppure una per figlio se è un Raggruppa. */
  meshes: NodeMesh[];
  /** Nodi selezionati: una parte si evidenzia se la selezione incontra lei o uno dei suoi antenati. */
  selection: string[];
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

interface PartProps {
  mesh: NodeMesh;
  selected: boolean;
  locked: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>, mesh: NodeMesh) => void;
  onDoubleClick: (e: ThreeEvent<MouseEvent>, mesh: NodeMesh) => void;
  onContextMenu: (e: ThreeEvent<MouseEvent>, mesh: NodeMesh) => void;
}

/** Una mesh dell'oggetto, nel suo colore, con il contorno di selezione. */
function Part({ mesh, selected, locked, onPointerDown, onDoubleClick, onContextMenu }: PartProps) {
  const palette = useViewportPalette();
  // Geometria da buffer; "flatShading" sul materiale evita lo smussamento degli spigoli
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Con Raccordo o Smusso attivi i clic scelgono le facce al posto di selezionare l'oggetto
  const edgeTool = useEdgeTool((s) => s.tool);
  // Con la Misura attiva i clic scelgono i punti da misurare, e non selezionano nemmeno
  const measuring = useMeasure((s) => s.active);
  const canvasHeight = useThree((s) => s.size.height);
  /** Punto agganciato sotto il puntatore (vertice, spigolo o superficie) con la tolleranza in mm di MEASURE_SNAP_PIXELS pixel. */
  const snapAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (e.faceIndex == null) return null;
    const camera = e.camera;
    // Millimetri per pixel alla distanza del punto colpito (prospettica) o in generale (ortografica)
    const perPixel = camera instanceof THREE.PerspectiveCamera
      ? (2 * e.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / canvasHeight
      : camera instanceof THREE.OrthographicCamera
        ? (camera.top - camera.bottom) / camera.zoom / canvasHeight
        : 0;
    return snapToMesh(mesh, e.faceIndex, [e.point.x, e.point.y, e.point.z], perPixel * MEASURE_SNAP_PIXELS);
  };
  // Qualunque strumento modale attivo toglie la selezione dai clic sugli oggetti
  // Appoggia su una faccia: i clic scelgono la faccia da portare sul piatto
  const layFlat = useLayFlat((s) => s.active);
  // Pattern: i clic scelgono la faccia da cui parte il disegno (solo dopo "Scegli faccia")
  const patternPicking = usePatternTool((s) => s.picking);
  const tool = edgeTool ?? (measuring ? 'measure' : layFlat ? 'layflat' : patternPicking ? 'pattern' : null);
  const choosing = useEdgeTool((s) => s.tool !== null && s.preview === null);
  const measure = useMeasure.getState();
  const { setHover, pickFace, setHoverCorner, pickCorner } = useEdgeTool.getState();
  /** Faccia sotto il puntatore (indice del triangolo colpito, tradotto nella faccia piana a cui appartiene). */
  const faceAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.faceIndex == null ? -1 : faceMap(mesh).triFace[e.faceIndex]);
  /**
   * Smusso angolare: vertice d'angolo più vicino al punto colpito, tra quelli della faccia sotto il puntatore
   * (indice del vertice nella mesh, oppure -1).
   */
  const cornerUnder = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const face = faceAt(e);
    return face < 0 ? -1 : cornerAt(mesh, faceMap(mesh), face, [e.point.x, e.point.y, e.point.z]);
  };

  return (
    <mesh
      geometry={geometry}
      onPointerDown={tool ? undefined : (e) => onPointerDown(e, mesh)}
      onDoubleClick={tool ? undefined : (e) => onDoubleClick(e, mesh)}
      onContextMenu={tool ? undefined : (e) => onContextMenu(e, mesh)}
      onPointerMove={
        layFlat
          ? (e) => {
              e.stopPropagation();
              const face = faceAt(e);
              useLayFlat.getState().setHover(face >= 0 ? { mesh, face } : null);
            }
          : patternPicking
          ? (e) => {
              e.stopPropagation();
              const face = faceAt(e);
              usePatternTool.getState().setHover(face >= 0 ? { mesh, face } : null);
            }
          : measuring
          ? (e) => {
              e.stopPropagation();
              measure.setHover(snapAt(e));
            }
          : choosing
          ? (e) => {
              e.stopPropagation();
              if (tool === 'corner') {
                // Con lo smusso angolare si evidenzia il vertice, non la faccia
                const vertex = cornerUnder(e);
                setHoverCorner(vertex >= 0 ? { mesh, vertex } : null);
                return;
              }
              const face = faceAt(e);
              setHover(face >= 0 ? { mesh, face } : null);
            }
          : undefined
      }
      onPointerOut={layFlat ? () => useLayFlat.getState().setHover(null) : patternPicking ? () => usePatternTool.getState().setHover(null) : measuring ? () => measure.setHover(null) : edgeTool ? () => (edgeTool === 'corner' ? setHoverCorner(null) : setHover(null)) : undefined}
      onClick={
        layFlat
          ? (e) => {
              // Un trascinamento (rotazione della vista) non è una scelta
              if (e.delta > 3) return;
              e.stopPropagation();
              const face = faceAt(e);
              if (face < 0) return;
              if (!layOnFaceAndDrop(mesh, face)) notify.error('L\'oggetto è bloccato: sbloccalo per appoggiarlo su una faccia.');
              useLayFlat.getState().cancel();
            }
          : patternPicking
          ? (e) => {
              // Un trascinamento (rotazione della vista) non è una scelta
              if (e.delta > 3) return;
              e.stopPropagation();
              const face = faceAt(e);
              if (face >= 0) usePatternTool.getState().pickFace(mesh, face);
            }
          : measuring
          ? (e) => {
              // Un trascinamento (rotazione della vista) non è una scelta
              if (e.delta > 3) return;
              e.stopPropagation();
              const snap = snapAt(e);
              if (snap) measure.pick(snap);
            }
          : choosing
          ? (e) => {
              // Un trascinamento (rotazione della vista) non è una scelta
              if (e.delta > 3) return;
              e.stopPropagation();
              if (tool === 'corner') pickCorner(mesh, cornerUnder(e), e.shiftKey);
              else pickFace(mesh, faceAt(e));
            }
          : undefined
      }
    >
      <meshStandardMaterial
        color={mesh.isHole ? '#ff4d4d' : mesh.color}
        flatShading
        roughness={0.55}
        metalness={0.05}
        transparent={mesh.isHole}
        opacity={mesh.isHole ? 0.45 : 1}
        depthWrite={!mesh.isHole}
      />
      {selected && <Edges threshold={20} color={locked ? palette.selectionLocked : palette.selection} />}
    </mesh>
  );
}

/**
 * Un oggetto alla radice della scena. Le mesh arrivano già in coordinate mondo dal kernel:
 * durante il trascinamento del gizmo si applica solo una matrice di spostamento al gruppo
 * (anteprima istantanea), e al rilascio la nuova posizione va nello store e il kernel ricalcola.
 * Un Raggruppa ha una mesh per figlio ma un solo gizmo, che le muove tutte insieme.
 */
export function SceneObject({ rootId, meshes, selection, locked, showGizmo }: Props) {
  const node = useSceneStore((s) => s.scene.nodes[rootId]);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);
  const select = useSceneStore((s) => s.select);
  const setGizmoMode = useSceneStore((s) => s.setGizmoMode);
  const updateNode = useSceneStore((s) => s.updateNode);
  // Passi di aggancio del gizmo (Impostazioni)
  const snapMove = useUiStore((s) => s.snapMove);
  const snapRotate = useUiStore((s) => s.snapRotate);

  const wrapper = useRef<THREE.Group>(null);
  // Il proxy è in uno state (ref callback) perché il gizmo deve montarsi dopo che l'oggetto esiste
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null);
  const startMatrix = useRef(new THREE.Matrix4());
  const [shift, setShift] = useState(false);
  // Gizmo di trascinamento (callback ref in uno state: si configura appena esiste)
  const [controls, setControls] = useState<ElementRef<typeof TransformControls> | null>(null);

  // In Sposta restano le frecce X, Y, Z e il quadrato del piano XY: la maniglia centrale libera e i piani XZ e YZ
  // (che muoverebbero anche in Z) si tolgono dal gizmo, così lo Z cambia solo trascinando espressamente la freccia Z
  useEffect(() => {
    if (!controls) return;
    // three-stdlib non espone i gruppi di maniglie (sono privati): si accede per nome e si rimuovono una volta sola
    const inner = (controls as unknown as { gizmo: { gizmo: Record<string, THREE.Object3D>; picker: Record<string, THREE.Object3D> } }).gizmo;
    for (const group of [inner.gizmo.translate, inner.picker.translate]) {
      group.children.filter((h) => ['XYZ', 'XZ', 'YZ'].includes(h.name)).forEach((h) => group.remove(h));
    }
  }, [controls]);

  // Quando arrivano le mesh ricalcolate, l'eventuale spostamento di anteprima non serve più
  useEffect(() => {
    const w = wrapper.current;
    if (w) {
      w.matrix.identity();
      w.matrixWorldNeedsUpdate = true;
    }
  }, [meshes]);

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

  const onPointerDown = (e: ThreeEvent<PointerEvent>, mesh: NodeMesh) => {
    // Solo il tasto sinistro seleziona; con Shift si aggiunge alla selezione.
    // Un clic seleziona l'oggetto intero (il gruppo), Alt+clic la singola parte
    if (e.button !== 0) return;
    e.stopPropagation();
    select([e.altKey ? mesh.id : mesh.path[0]], e.shiftKey);
  };

  /**
   * Doppio clic: l'oggetto è già selezionato dal primo clic del doppio clic (due pointerdown),
   * quindi basta passare alla modalità Sposta (W) per mostrare il gizmo di spostamento.
   */
  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    setGizmoMode('translate');
  };

  /**
   * Tasto destro su un oggetto: lo seleziona (se non lo è già, così una selezione multipla resta) e apre il menu dei
   * comandi applicabili. Un trascinamento con il tasto destro è il movimento della vista e non apre nulla.
   */
  const onContextMenu = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 3) return;
    e.stopPropagation();
    // Con uno strumento a pannello aperto l'oggetto è in anteprima: niente menu
    const c = getCommandContext();
    if (c.edgeTool || c.shellActive || c.measureActive || c.layFlatActive || c.arrayActive || c.patternActive) return;
    if (!selection.includes(rootId)) select([rootId]);
    useUiStore.getState().setContextMenu({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };

  const scaling = gizmoMode === 'resize' || gizmoMode === 'extrude';
  // Le forme con misure proprie si ridimensionano con le loro misure; un gruppo di qualsiasi tipo con una scala per asse
  // (solo in Ridimensiona); le mesh importate no. Estrudi solo le forme 2D
  // Estrudi (T) agisce sull'altezza delle forme 2D: un'estrusione rotazionale non ha un'altezza da trascinare
  const resizable =
    ((node.type === 'primitive' || node.type === 'shape2d') && (gizmoMode !== 'extrude' || (node.type === 'shape2d' && node.extrusion !== 'rotate'))) ||
    (node.type === 'group' && gizmoMode === 'resize');

  /** Ingombro del gruppo nel suo sistema locale (già scalato): il centro della base è il punto fisso del ridimensionamento. */
  const groupBox = () => localBounds(meshes.filter((m) => !m.empty), node as Transform);

  /** Scala letta dal gizmo; in modalità Estrudi conta solo l'asse Z (il cubetto centrale non deve allargare il profilo). */
  const currentScale = (p: THREE.Object3D): Vec3 => (gizmoMode === 'extrude' ? [1, 1, p.scale.z] : [p.scale.x, p.scale.y, p.scale.z]);

  /** Anteprima del trascinamento: matrice = corrente * inversa(iniziale). */
  const onChange = () => {
    const p = proxy;
    const w = wrapper.current;
    if (!p || !w) return;
    if (scaling && node.type === 'group') {
      // Gruppo: la scala sta attorno al centro della base dell'ingombro (nel sistema R del gruppo, con lo specchio applicato)
      const [sx, sy, sz] = currentScale(p);
      const box = groupBox();
      if (![...box.min, ...box.max].every(Number.isFinite)) return;
      const sign = (axis: number) => (node.mirror?.[axis] ? -1 : 1);
      const pivot = new THREE.Vector3(((box.min[0] + box.max[0]) / 2) * sign(0), ((box.min[1] + box.max[1]) / 2) * sign(1), box.min[2] * sign(2));
      const base = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
      const local = base.clone().multiply(new THREE.Matrix4().makeScale(sx, sy, sz)).multiply(base.clone().invert());
      const world = nodeMatrix(node.position, node.rotation);
      w.matrix.copy(world).multiply(local).multiply(world.clone().invert());
      w.matrixWorldNeedsUpdate = true;
      return;
    }
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
    if (scaling && node.type === 'group') {
      // Un gruppo si ridimensiona nell'insieme: scala per asse e nuova posizione (il centro della base resta fermo)
      const scale = currentScale(p);
      p.scale.set(1, 1, 1);
      if (scale.every((v) => v === 1)) return;
      const result = resizeGroup(node, groupBox(), scale, shift ? 0.01 : 0.5);
      updateNode(rootId, { groupScale: result.scale, position: result.position } as never);
      return;
    }
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
      updateNode(rootId, { ...patch, position } as never);
      return;
    }
    const euler = new THREE.Euler().setFromQuaternion(p.quaternion, 'ZYX');
    updateNode(rootId, {
      position: p.position.toArray().map((v) => round(v, 3)) as Vec3,
      rotation: [euler.x, euler.y, euler.z].map((v) => round(THREE.MathUtils.radToDeg(v), 3)) as Vec3,
    });
  };

  return (
    <>
      <group ref={wrapper} matrixAutoUpdate={false}>
        {meshes.map((mesh) => (
          <Part key={mesh.id} mesh={mesh} locked={locked} selected={selection.some((id) => mesh.path.includes(id))} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu} />
        ))}
      </group>

      {/* Oggetto invisibile nella posizione del nodo: è lui che il gizmo muove */}
      <object3D
        ref={setProxy}
        position={node.position}
        rotation={new THREE.Euler(...(node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]), 'ZYX')}
      />
      {showGizmo && proxy && gizmoMode !== 'select' && (!scaling || resizable) && (
        <TransformControls
          ref={setControls}
          object={proxy}
          mode={scaling ? 'scale' : gizmoMode}
          // In modalità Estrudi resta solo l'asse Z (l'altezza dell'estrusione)
          showX={gizmoMode !== 'extrude'}
          showY={gizmoMode !== 'extrude'}
          size={0.8}
          translationSnap={shift ? null : snapMove}
          rotationSnap={shift ? null : THREE.MathUtils.degToRad(snapRotate)}
          onMouseDown={() => {
            startMatrix.current.copy(nodeMatrix(node.position, node.rotation));
            // Durante il trascinamento le quote nella vista si nascondono
            useUiStore.getState().setGizmoDragging(true);
          }}
          onObjectChange={onChange}
          onMouseUp={() => {
            try {
              onCommit();
            } finally {
              useUiStore.getState().setGizmoDragging(false);
            }
          }}
        />
      )}
    </>
  );
}
