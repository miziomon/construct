import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import type { GroupNode, GroupOp, MeshNode, PrimitiveKind, PrimitiveNode, Scene, SceneNode, Shape2DKind, Shape2DNode, Vec3 } from './types';
import { DEFAULT_COLOR, PRIMITIVE_LABELS, SHAPE2D_LABELS, halfHeight, primitiveDefaults, shape2dDefaults } from './defaults';
import { composeTransform, round } from './math';

export type GizmoMode = 'select' | 'translate' | 'rotate' | 'resize' | 'extrude';

interface SceneState {
  scene: Scene;
  /** Selezione corrente: sempre id di nodi esistenti. */
  selection: string[];
  gizmoMode: GizmoMode;

  addPrimitive: (kind: PrimitiveKind) => void;
  addShape2D: (kind: Shape2DKind) => void;
  /** Aggiunge una mesh importata, appoggiata sul piatto e centrata in XY. */
  addMesh: (input: { assetId: string; name: string; fileName: string; color?: string; origin: Vec3; size: Vec3; triangles: number }) => string;
  /** Aggiorna campi di un nodo (patch parziale, validata dal chiamante). */
  updateNode: (id: string, patch: Partial<PrimitiveNode> | Partial<Shape2DNode> | Partial<MeshNode> | Partial<GroupNode>) => void;
  select: (ids: string[], additive?: boolean) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  /** Combina gli oggetti selezionati (in ordine di selezione) in un gruppo con l'operazione data. */
  combineSelected: (op: GroupOp) => void;
  groupSelected: () => void;
  /** Differenza: il secondo figlio diventa la base (rotazione dell'ordine dei figli). */
  cycleBase: (groupId: string) => void;
  ungroupSelected: () => void;
  toggleHoleSelected: () => void;
  toggleLockSelected: () => void;
  /** Abbassa gli oggetti selezionati finché il loro punto più basso tocca il piatto (minZ per id, in mm). */
  dropToBed: (minZById: Record<string, number>) => void;
  nudgeSelected: (delta: Vec3) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  loadScene: (scene: Scene) => void;
  clear: () => void;
}

/** Nome base del gruppo creato da ogni operazione. */
const GROUP_LABELS: Record<GroupOp, string> = { union: 'Unione', intersection: 'Intersezione', difference: 'Differenza' };

export const emptyScene = (): Scene => ({ nodes: {}, rootIds: [] });

const newId = () => crypto.randomUUID().slice(0, 8);

/** Nome progressivo unico per etichetta, es. "Cubo 2". */
function uniqueName(scene: Scene, base: string): string {
  const used = new Set(Object.values(scene.nodes).map((n) => n.name));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** Tutti gli id discendenti di un nodo (inclusi gruppi annidati). */
export function descendants(scene: Scene, id: string): string[] {
  const node = scene.nodes[id];
  if (!node || node.type !== 'group') return [];
  return node.children.flatMap((c) => [c, ...descendants(scene, c)]);
}

/** Id del gruppo che contiene il nodo, se esiste. */
export function parentOf(scene: Scene, id: string): string | undefined {
  return Object.values(scene.nodes).find((n) => n.type === 'group' && n.children.includes(id))?.id;
}

/** Un nodo è bloccato se lo è lui o uno dei gruppi che lo contengono. */
export function isLocked(scene: Scene, id: string): boolean {
  for (let cur: string | undefined = id; cur; cur = parentOf(scene, cur)) {
    if (scene.nodes[cur]?.locked) return true;
  }
  return false;
}

/** Campi che si possono cambiare anche su un oggetto bloccato. */
const ALWAYS_EDITABLE = new Set(['name', 'color', 'locked']);

/** Nodi selezionati che stanno alla radice della scena (solo questi si possono muovere, duplicare, raggruppare). */
function selectedRoots(scene: Scene, selection: string[]): string[] {
  return selection.filter((id) => scene.rootIds.includes(id));
}

export const useSceneStore = create<SceneState>()(
  temporal(
    immer((set, get) => ({
      scene: emptyScene(),
      selection: [],
      gizmoMode: 'select',

      addPrimitive: (kind) =>
        set((s) => {
          const id = newId();
          const node = {
            ...primitiveDefaults(kind),
            id,
            name: uniqueName(s.scene, PRIMITIVE_LABELS[kind]),
            position: [0, 0, 0] as Vec3,
          } as PrimitiveNode;
          // Appoggia la forma sul piatto: il punto più basso a Z = 0
          node.position = [0, 0, halfHeight(node)];
          s.scene.nodes[id] = node;
          s.scene.rootIds.push(id);
          s.selection = [id];
        }),

      addShape2D: (kind) =>
        set((s) => {
          const id = newId();
          const node = {
            ...shape2dDefaults(kind),
            id,
            name: uniqueName(s.scene, SHAPE2D_LABELS[kind]),
            position: [0, 0, 0] as Vec3,
          } as Shape2DNode;
          // L'estrusione è centrata: la base tocca il piatto con Z = altezza / 2
          node.position = [0, 0, halfHeight(node)];
          s.scene.nodes[id] = node;
          s.scene.rootIds.push(id);
          s.selection = [id];
        }),

      addMesh: (input) => {
        const id = newId();
        set((s) => {
          const node: MeshNode = {
            type: 'mesh',
            id,
            name: uniqueName(s.scene, input.name),
            fileName: input.fileName,
            assetId: input.assetId,
            origin: input.origin,
            triangles: input.triangles,
            scale: 1,
            // La geometria è ricentrata sull'origine: la base tocca il piatto con Z = metà altezza
            position: [0, 0, input.size[2] / 2],
            rotation: [0, 0, 0],
            mode: 'solid',
            color: input.color ?? DEFAULT_COLOR,
          };
          s.scene.nodes[id] = node;
          s.scene.rootIds.push(id);
          s.selection = [id];
        });
        return id;
      },

      updateNode: (id, patch) =>
        set((s) => {
          const node = s.scene.nodes[id];
          if (!node) return;
          // Su un oggetto bloccato passano solo nome, colore e il blocco stesso
          if (isLocked(s.scene, id) && Object.keys(patch).some((k) => !ALWAYS_EDITABLE.has(k))) return;
          Object.assign(node, patch);
        }),

      select: (ids, additive = false) =>
        set((s) => {
          const valid = ids.filter((id) => s.scene.nodes[id]);
          s.selection = additive ? [...new Set([...s.selection, ...valid])] : valid;
        }),

      removeSelected: () =>
        set((s) => {
          // Elimina i nodi selezionati e i loro discendenti, poi pulisce i riferimenti
          const removable = s.selection.filter((id) => !isLocked(s.scene, id));
          const doomed = new Set(removable.flatMap((id) => [id, ...descendants(s.scene, id)]));
          for (const id of doomed) delete s.scene.nodes[id];
          s.scene.rootIds = s.scene.rootIds.filter((id) => !doomed.has(id));
          for (const n of Object.values(s.scene.nodes)) {
            if (n.type === 'group') n.children = n.children.filter((c) => !doomed.has(c));
          }
          s.selection = s.selection.filter((id) => !doomed.has(id));
        }),

      duplicateSelected: () =>
        set((s) => {
          const copies: string[] = [];
          // Copia ricorsiva: i gruppi duplicano anche i figli
          const clone = (id: string): string => {
            const src = s.scene.nodes[id];
            const copy = JSON.parse(JSON.stringify(src)) as SceneNode;
            copy.id = newId();
            copy.locked = false;
            copy.name = uniqueName(s.scene, src.name.replace(/ \d+$/, ''));
            if (copy.type === 'group') copy.children = copy.children.map(clone);
            s.scene.nodes[copy.id] = copy;
            return copy.id;
          };
          for (const id of selectedRoots(s.scene, s.selection)) {
            const cid = clone(id);
            const c = s.scene.nodes[cid];
            // Sfalsa la copia di 10 mm in X e Y per renderla visibile
            c.position = [c.position[0] + 10, c.position[1] + 10, c.position[2]];
            s.scene.rootIds.push(cid);
            copies.push(cid);
          }
          if (copies.length) s.selection = copies;
        }),

      combineSelected: (op) =>
        set((s) => {
          const ids = selectedRoots(s.scene, s.selection).filter((id) => !isLocked(s.scene, id));
          if (ids.length < 2) return;
          const nodes = ids.map((id) => s.scene.nodes[id]);
          // Il gruppo nasce al centroide dei figli, con rotazione nulla: le posizioni nel mondo non cambiano
          const c = [0, 1, 2].map((i) => round(nodes.reduce((a, n) => a + n.position[i], 0) / nodes.length)) as Vec3;
          for (const n of nodes) n.position = [round(n.position[0] - c[0]), round(n.position[1] - c[1]), round(n.position[2] - c[2])];
          const group: GroupNode = {
            id: newId(),
            type: 'group',
            name: uniqueName(s.scene, GROUP_LABELS[op]),
            position: c,
            rotation: [0, 0, 0],
            mode: 'solid',
            color: DEFAULT_COLOR,
            op,
            children: ids,
          };
          s.scene.nodes[group.id] = group;
          // Il gruppo prende il posto del primo figlio nell'ordine delle radici
          const first = Math.min(...ids.map((id) => s.scene.rootIds.indexOf(id)));
          s.scene.rootIds = s.scene.rootIds.filter((id) => !ids.includes(id));
          s.scene.rootIds.splice(first, 0, group.id);
          s.selection = [group.id];
        }),

      // Raggruppa = unione: stessa logica di combineSelected
      groupSelected: () => get().combineSelected('union'),

      cycleBase: (groupId) =>
        set((s) => {
          const g = s.scene.nodes[groupId];
          if (g?.type !== 'group' || isLocked(s.scene, groupId) || g.children.length < 2) return;
          g.children.push(g.children.shift()!);
        }),

      ungroupSelected: () =>
        set((s) => {
          const released: string[] = [];
          for (const id of selectedRoots(s.scene, s.selection)) {
            const g = s.scene.nodes[id];
            if (g.type !== 'group' || isLocked(s.scene, id)) continue;
            // Ricompone la trasformazione del gruppo su ogni figlio per non spostarlo nel mondo
            for (const cid of g.children) {
              const child = s.scene.nodes[cid];
              const w = composeTransform(g, child);
              child.position = w.position.map((v) => round(v)) as Vec3;
              child.rotation = w.rotation.map((v) => round(v)) as Vec3;
              released.push(cid);
            }
            const at = s.scene.rootIds.indexOf(id);
            s.scene.rootIds.splice(at, 1, ...g.children);
            delete s.scene.nodes[id];
          }
          if (released.length) s.selection = released;
        }),

      toggleHoleSelected: () =>
        set((s) => {
          for (const id of s.selection) {
            const n = s.scene.nodes[id];
            if (n && !isLocked(s.scene, id)) n.mode = n.mode === 'solid' ? 'hole' : 'solid';
          }
        }),

      toggleLockSelected: () =>
        set((s) => {
          // Se almeno uno è sbloccato li blocca tutti, altrimenti li sblocca tutti
          const lockAll = s.selection.some((id) => !s.scene.nodes[id]?.locked);
          for (const id of s.selection) {
            const n = s.scene.nodes[id];
            if (n) n.locked = lockAll;
          }
        }),

      dropToBed: (minZById) =>
        set((s) => {
          for (const id of selectedRoots(s.scene, s.selection)) {
            const minZ = minZById[id];
            if (minZ === undefined || isLocked(s.scene, id)) continue;
            const n = s.scene.nodes[id];
            n.position = [n.position[0], n.position[1], round(n.position[2] - minZ)];
          }
        }),

      nudgeSelected: (delta) =>
        set((s) => {
          for (const id of selectedRoots(s.scene, s.selection)) {
            if (isLocked(s.scene, id)) continue;
            const n = s.scene.nodes[id];
            n.position = [n.position[0] + delta[0], n.position[1] + delta[1], n.position[2] + delta[2]];
          }
        }),

      setGizmoMode: (mode) =>
        set((s) => {
          s.gizmoMode = mode;
        }),

      loadScene: (scene) =>
        set((s) => {
          s.scene = scene;
          s.selection = [];
        }),

      clear: () =>
        set((s) => {
          s.scene = emptyScene();
          s.selection = [];
        }),
    })),
    {
      // Nella cronologia di undo/redo entra solo la scena: selezione e gizmo no
      partialize: (s) => ({ scene: s.scene }),
      // Immer mantiene lo stesso riferimento se la scena non cambia: selezione e gizmo non creano voci di cronologia
      equality: (a, b) => a.scene === b.scene,
      limit: 100,
    },
  ),
);
