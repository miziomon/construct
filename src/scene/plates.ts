import { produce } from 'immer';
import type { Plate, Scene } from './types';

/**
 * Piatti di stampa. Un progetto ha uno o più piatti, ognuno con i suoi oggetti (es. "Piatto 1: scatola", "Piatto 2:
 * coperchio"). `scene.rootIds` è sempre l'elenco degli oggetti del **piatto attivo**: tutto il resto dell'app (vista,
 * elenco Oggetti, calcolo, codice) lavora su di lui senza saperlo. Gli altri piatti sono "parcheggiati" in `scene.plates`
 * con le loro radici; il piatto attivo vi compare con `rootIds` vuoto (la lista vera è `scene.rootIds`).
 * Una scena senza `plates` ha un solo piatto implicito. Ogni radice sta in un solo posto.
 */

/** Id del piatto implicito di una scena senza `plates`. */
export const DEFAULT_PLATE_ID = 'piatto-1';

/** Distanza (mm) tra i piatti affiancati nel codice OpenSCAD e nel 3MF: larghezza del piano più questo margine. */
export const PLATE_GAP = 20;

/** Nome predefinito del piatto numero `n` (da 1). */
export const plateName = (n: number) => `Piatto ${n}`;

/** Elenco completo dei piatti, con le radici anche per il piatto attivo (che sta in `scene.rootIds`). */
export function platesOf(scene: Scene): Plate[] {
  if (!scene.plates?.length) return [{ id: DEFAULT_PLATE_ID, name: plateName(1), rootIds: scene.rootIds }];
  const active = activePlateId(scene);
  return scene.plates.map((p) => (p.id === active ? { ...p, rootIds: scene.rootIds } : p));
}

/** Id del piatto attivo: quello indicato se esiste, altrimenti il primo. */
export function activePlateId(scene: Scene): string {
  if (!scene.plates?.length) return DEFAULT_PLATE_ID;
  return scene.plates.some((p) => p.id === scene.activePlateId) ? (scene.activePlateId as string) : scene.plates[0].id;
}

export const activePlateOf = (scene: Scene): Plate => platesOf(scene).find((p) => p.id === activePlateId(scene))!;

/** Tutte le radici di tutti i piatti. */
export const allRootIds = (scene: Scene): string[] => platesOf(scene).flatMap((p) => p.rootIds);

/** Il piatto che contiene la radice indicata. */
export const plateOfRoot = (scene: Scene, rootId: string): Plate | undefined => platesOf(scene).find((p) => p.rootIds.includes(rootId));

/** Vero se il progetto ha più di un piatto. */
export const hasManyPlates = (scene: Scene): boolean => platesOf(scene).length > 1;

/**
 * Vista della scena con un solo piatto (le sue radici come `rootIds`): per esportare o generare il codice di un piatto
 * qualsiasi. I nodi sono gli stessi.
 */
export function sceneForPlate(scene: Scene, plateId: string): Scene {
  const plate = platesOf(scene).find((p) => p.id === plateId) ?? activePlateOf(scene);
  return { nodes: scene.nodes, rootIds: plate.rootIds };
}

/** Rende esplicito l'elenco dei piatti (alla prima aggiunta di un secondo piatto). */
function materialize(draft: Scene): void {
  if (draft.plates?.length) return;
  draft.plates = [{ id: DEFAULT_PLATE_ID, name: plateName(1), rootIds: [] }];
  draft.activePlateId = DEFAULT_PLATE_ID;
}

/**
 * Mette radici già presenti in `nodes` nei piatti indicati: il primo gruppo in cima al piatto attivo, gli altri in piatti
 * nuovi in fondo (con il loro nome). Serve all'importazione di un file con più piatti.
 */
export function addImportedRoots(scene: Scene, groups: { name: string; rootIds: string[] }[], newId: () => string): Scene {
  return produce(scene, (d) => {
    if (!groups.length) return;
    d.rootIds = [...groups[0].rootIds, ...d.rootIds];
    if (groups.length < 2) return;
    materialize(d);
    for (const g of groups.slice(1)) d.plates!.push({ id: newId(), name: g.name.trim() || plateName(d.plates!.length + 1), rootIds: [...g.rootIds] });
  });
}

/** Aggiunge un piatto vuoto in fondo (non lo rende attivo). */
export function addPlateScene(scene: Scene, id: string, name?: string): Scene {
  return produce(scene, (d) => {
    materialize(d);
    const taken = new Set(d.plates!.map((p) => p.name));
    let n = d.plates!.length + 1;
    while (!name && taken.has(plateName(n))) n++;
    d.plates!.push({ id, name: name?.trim() || plateName(n), rootIds: [] });
  });
}

/** Rende attivo un piatto: le radici dell'attuale vengono parcheggiate e quelle del nuovo diventano `rootIds`. */
export function switchPlateScene(scene: Scene, id: string): Scene {
  if (!scene.plates?.length || id === activePlateId(scene) || !scene.plates.some((p) => p.id === id)) return scene;
  return produce(scene, (d) => {
    const from = d.plates!.find((p) => p.id === activePlateId(scene))!;
    const to = d.plates!.find((p) => p.id === id)!;
    from.rootIds = [...scene.rootIds];
    d.rootIds = [...to.rootIds];
    to.rootIds = [];
    d.activePlateId = id;
  });
}

/** Cambia il nome di un piatto (un nome vuoto non cambia nulla). */
export function renamePlateScene(scene: Scene, id: string, name: string): Scene {
  const clean = name.trim();
  if (!clean || !scene.plates?.some((p) => p.id === id)) return scene;
  return produce(scene, (d) => {
    d.plates!.find((p) => p.id === id)!.name = clean;
  });
}

/** Tutti i nodi di un sottoalbero (radice inclusa). */
function subtree(scene: Scene, id: string): string[] {
  const node = scene.nodes[id];
  if (!node) return [];
  return [id, ...(node.type === 'group' ? node.children.flatMap((c) => subtree(scene, c)) : [])];
}

/** Elimina un piatto con tutti i suoi oggetti. L'ultimo piatto rimasto non si elimina. */
export function removePlateScene(scene: Scene, id: string): Scene {
  const plates = platesOf(scene);
  if (plates.length < 2 || !plates.some((p) => p.id === id)) return scene;
  // Se è quello attivo si passa prima a un altro, così `rootIds` resta valido
  let base = scene;
  if (id === activePlateId(scene)) {
    const next = plates.find((p) => p.id !== id)!;
    base = switchPlateScene(scene, next.id);
  }
  return produce(base, (d) => {
    const doomed = new Set(base.plates!.find((p) => p.id === id)!.rootIds.flatMap((r) => subtree(base, r)));
    for (const n of doomed) delete d.nodes[n];
    d.plates = d.plates!.filter((p) => p.id !== id);
  });
}

/** Sposta radici del piatto attivo in un altro piatto (in cima al suo elenco). */
export function moveRootsToPlate(scene: Scene, rootIds: string[], targetId: string): Scene {
  const movable = rootIds.filter((r) => scene.rootIds.includes(r));
  if (!movable.length || targetId === activePlateId(scene) || !scene.plates?.some((p) => p.id === targetId)) return scene;
  return produce(scene, (d) => {
    d.rootIds = d.rootIds.filter((r) => !movable.includes(r));
    const target = d.plates!.find((p) => p.id === targetId)!;
    target.rootIds = [...movable, ...target.rootIds];
  });
}

/**
 * Controllo di coerenza dei piatti di una scena caricata: i piatti hanno id e nome, il piatto attivo esiste, ogni
 * radice esiste e sta in un solo posto. Una scena senza `plates` è sempre valida.
 */
export function platesAreValid(scene: Scene): boolean {
  if (scene.plates === undefined) return true;
  if (!Array.isArray(scene.plates) || scene.plates.length === 0) return false;
  const ids = new Set<string>();
  const seen = new Set<string>(scene.rootIds);
  if (seen.size !== scene.rootIds.length) return false;
  for (const p of scene.plates) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.rootIds) || ids.has(p.id)) return false;
    ids.add(p.id);
    for (const r of p.rootIds) {
      if (!scene.nodes[r] || seen.has(r)) return false;
      seen.add(r);
    }
  }
  return scene.activePlateId === undefined || ids.has(scene.activePlateId);
}
