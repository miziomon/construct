import { useResultStore } from './useKernel';
import { faceMap } from '../scene/edgeTool';
import type { NodeMesh } from './evaluate';
import { useSceneStore, parentOf, isLocked } from '../scene/store';
import { round } from '../scene/math';
import { alignDeltas, mirrorPlane } from '../scene/placement';
import type { AlignTarget, Bounds } from '../scene/placement';
import type { GroupOp, Vec3 } from '../scene/types';

export type { AlignTarget, Bounds };

/** Ingombro nel mondo di ogni oggetto alla radice, dalle mesh calcolate dal kernel. */
export function boundsByRoot(): Record<string, Bounds> {
  // Un Raggruppa ha una mesh per figlio: il suo ingombro è l'unione di tutte le sue mesh
  const result: Record<string, Bounds> = {};
  for (const m of useResultStore.getState().meshes) {
    if (m.empty) continue;
    const b = result[m.rootId];
    result[m.rootId] = b
      ? { min: b.min.map((v, i) => Math.min(v, m.bbox.min[i])) as Vec3, max: b.max.map((v, i) => Math.max(v, m.bbox.max[i])) as Vec3 }
      : { min: [...m.bbox.min], max: [...m.bbox.max] };
  }
  return result;
}

/** Punto più basso (Z) di ogni oggetto alla radice, dall'ingombro calcolato dal kernel. */
function lowestZByRoot(): Record<string, number> {
  return Object.fromEntries(Object.entries(boundsByRoot()).map(([id, b]) => [id, b.min[2]]));
}

/**
 * Ingombri degli oggetti su cui agisce Allinea (`align`: tutti i selezionati alla radice, anche i bloccati, che contano
 * per l'ingombro ma non si spostano) o Specchia (`mirror`: solo i non bloccati). Vuoto se la selezione non basta.
 */
export function placementTargets(kind: 'align' | 'mirror'): Record<string, Bounds> {
  const { scene, selection } = useSceneStore.getState();
  const all = boundsByRoot();
  const ids = selection.filter((id) => scene.rootIds.includes(id) && all[id] && (kind === 'align' || !isLocked(scene, id)));
  if (ids.length < (kind === 'align' ? 2 : 1)) return {};
  return Object.fromEntries(ids.map((id) => [id, all[id]]));
}

/** Specchia gli oggetti selezionati rispetto al piano perpendicolare all'asse, passante per il lato scelto della selezione. */
export function mirrorSelection(axis: 0 | 1 | 2, target: AlignTarget = 'center'): void {
  const bounds = placementTargets('mirror');
  if (Object.keys(bounds).length === 0) return;
  // Del centro conta solo la coordinata sull'asse: lo specchio non tocca le altre
  const center: Vec3 = [0, 0, 0];
  center[axis] = mirrorPlane(Object.values(bounds), axis, target);
  useSceneStore.getState().mirrorSelected(axis, center);
}

/**
 * Allinea gli oggetti selezionati lungo un asse (0 = X, 1 = Y, 2 = Z) al minimo, al centro o al massimo
 * dell'ingombro complessivo della selezione. Gli oggetti bloccati contano per l'ingombro ma non si spostano.
 */
export function alignSelection(axis: 0 | 1 | 2, target: AlignTarget): void {
  const bounds = placementTargets('align');
  if (Object.keys(bounds).length === 0) return;
  useSceneStore.getState().alignSelected(alignDeltas(bounds, axis, target));
}

/** Appoggia sul piatto gli oggetti selezionati, usando l'ingombro calcolato dal kernel. */
export function dropSelectionToBed(): void {
  useSceneStore.getState().dropToBed(lowestZByRoot());
}

/**
 * Riallineamenti in attesa: id della radice → quota Z che il suo punto più basso deve avere (0 = sul piatto).
 * Si applicano quando il kernel ha ricalcolato la scena (`applyPlacement`), perché l'ingombro nuovo si conosce solo allora.
 */
const pending = new Map<string, number>();

/** Chiede di appoggiare sul piatto le radici indicate non appena il kernel ha il nuovo ingombro. */
export function queueDropToBed(rootIds: string[]): void {
  for (const id of rootIds) pending.set(id, 0);
}

/**
 * Chiede di mantenere ferma la base dell'oggetto di cui si sta per modificare un nodo (misure, rotazione): chi sta sul
 * piatto ci resta, chi è impilato conserva la quota. La quota è quella di adesso, prima della modifica; se c'è già una
 * richiesta in coda (ad esempio durante il trascinamento di uno slider) si tiene la prima.
 */
export function queueKeepBase(nodeId: string): void {
  const scene = useSceneStore.getState().scene;
  // Dal nodo si risale fino alla radice
  let rootId = nodeId;
  for (let up = parentOf(scene, rootId); up; up = parentOf(scene, rootId)) rootId = up;
  if (pending.has(rootId)) return;
  const z = lowestZByRoot()[rootId];
  if (z !== undefined) pending.set(rootId, z);
}

/**
 * Applica i riallineamenti in attesa. Ritorna true se ha modificato la scena. La cronologia di Annulla non registra la
 * correzione (se era attiva): resta un solo passo per l'azione dell'utente.
 */
export function applyPlacement(): boolean {
  if (pending.size === 0) return false;
  const minZ = lowestZByRoot();
  const store = useSceneStore.getState();
  const history = useSceneStore.temporal.getState();
  const tracking = history.isTracking;
  if (tracking) history.pause();
  let changed = false;
  for (const [id, target] of pending) {
    const node = store.scene.nodes[id];
    const z = minZ[id];
    // Oggetto sparito, vuoto o non ancora ricalcolato: niente da fare
    if (!node || z === undefined) continue;
    const delta = target - z;
    if (Math.abs(delta) < 1e-6) continue;
    store.updateNode(id, { position: [node.position[0], node.position[1], round(node.position[2] + delta)] });
    changed = true;
  }
  pending.clear();
  if (tracking) history.resume();
  return changed;
}

/** Unione, differenza, intersezione o Raggruppa della selezione; il risultato si appoggia sul piatto. */
export function combineToBed(op: GroupOp): void {
  const before = useSceneStore.getState().scene.nodes;
  useSceneStore.getState().combineSelected(op);
  const { scene, selection } = useSceneStore.getState();
  const created = selection.length === 1 ? scene.nodes[selection[0]] : undefined;
  // Solo se il gruppo è davvero nato ora (con meno di due oggetti la selezione resta com'era)
  if (created?.type === 'group' && created.op === op && !before[created.id]) queueDropToBed([created.id]);
}

/**
 * Appoggia su una faccia: ruota l'oggetto alla radice a cui appartiene la mesh perché la faccia scelta (indice di
 * `faceMap`) guardi in basso, attorno al centro del suo ingombro, e lo appoggia sul piatto quando il kernel ha il
 * nuovo ingombro. Restituisce false se l'oggetto è bloccato o la faccia non esiste.
 */
export function layOnFaceAndDrop(mesh: NodeMesh, face: number): boolean {
  const store = useSceneStore.getState();
  const rootId = mesh.rootId;
  const info = faceMap(mesh).faces[face];
  const bounds = boundsByRoot()[rootId];
  if (!info || !bounds || isLocked(store.scene, rootId)) return false;
  const center = [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2) as Vec3;
  store.layOnFace(rootId, info.normal, center);
  queueDropToBed([rootId]);
  return true;
}
