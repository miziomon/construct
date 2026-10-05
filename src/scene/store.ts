import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import type { GroupNode, PrimitiveKind, PrimitiveNode, Scene, SceneNode, Vec3 } from './types';
import { DEFAULT_COLOR, PRIMITIVE_LABELS, halfHeight, primitiveDefaults } from './defaults';
import { composeTransform, round } from './math';

export type GizmoMode = 'translate' | 'rotate';

interface SceneState {
  scene: Scene;
  /** Selezione corrente: sempre id di nodi esistenti. */
  selection: string[];
  gizmoMode: GizmoMode;

  addPrimitive: (kind: PrimitiveKind) => void;
  /** Aggiorna campi di un nodo (patch parziale, validata dal chiamante). */
  updateNode: (id: string, patch: Partial<PrimitiveNode> | Partial<GroupNode>) => void;
  select: (ids: string[], additive?: boolean) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  toggleHoleSelected: () => void;
  nudgeSelected: (delta: Vec3) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  loadScene: (scene: Scene) => void;
  clear: () => void;
}

export const emptyScene = (): Scene => ({ nodes: {}, rootIds: [] });

const newId = () => crypto.randomUUID().slice(0, 8);

/** Nome progressivo unico per etichetta, es. "Scatola 2". */
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

/** Nodi selezionati che stanno alla radice della scena (solo questi si possono muovere, duplicare, raggruppare). */
function selectedRoots(scene: Scene, selection: string[]): string[] {
  return selection.filter((id) => scene.rootIds.includes(id));
}

export const useSceneStore = create<SceneState>()(
  temporal(
    immer((set) => ({
      scene: emptyScene(),
      selection: [],
      gizmoMode: 'translate',

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

      updateNode: (id, patch) =>
        set((s) => {
          const node = s.scene.nodes[id];
          if (node) Object.assign(node, patch);
        }),

      select: (ids, additive = false) =>
        set((s) => {
          const valid = ids.filter((id) => s.scene.nodes[id]);
          s.selection = additive ? [...new Set([...s.selection, ...valid])] : valid;
        }),

      removeSelected: () =>
        set((s) => {
          // Elimina i nodi selezionati e i loro discendenti, poi pulisce i riferimenti
          const doomed = new Set(s.selection.flatMap((id) => [id, ...descendants(s.scene, id)]));
          for (const id of doomed) delete s.scene.nodes[id];
          s.scene.rootIds = s.scene.rootIds.filter((id) => !doomed.has(id));
          for (const n of Object.values(s.scene.nodes)) {
            if (n.type === 'group') n.children = n.children.filter((c) => !doomed.has(c));
          }
          s.selection = [];
        }),

      duplicateSelected: () =>
        set((s) => {
          const copies: string[] = [];
          // Copia ricorsiva: i gruppi duplicano anche i figli
          const clone = (id: string): string => {
            const src = s.scene.nodes[id];
            const copy = JSON.parse(JSON.stringify(src)) as SceneNode;
            copy.id = newId();
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

      groupSelected: () =>
        set((s) => {
          const ids = selectedRoots(s.scene, s.selection);
          if (ids.length < 2) return;
          const nodes = ids.map((id) => s.scene.nodes[id]);
          // Il gruppo nasce al centroide dei figli, con rotazione nulla: le posizioni nel mondo non cambiano
          const c = [0, 1, 2].map((i) => round(nodes.reduce((a, n) => a + n.position[i], 0) / nodes.length)) as Vec3;
          for (const n of nodes) n.position = [round(n.position[0] - c[0]), round(n.position[1] - c[1]), round(n.position[2] - c[2])];
          const group: GroupNode = {
            id: newId(),
            type: 'group',
            name: uniqueName(s.scene, 'Gruppo'),
            position: c,
            rotation: [0, 0, 0],
            mode: 'solid',
            color: DEFAULT_COLOR,
            op: 'union',
            children: ids,
          };
          s.scene.nodes[group.id] = group;
          // Il gruppo prende il posto del primo figlio nell'ordine delle radici
          const first = Math.min(...ids.map((id) => s.scene.rootIds.indexOf(id)));
          s.scene.rootIds = s.scene.rootIds.filter((id) => !ids.includes(id));
          s.scene.rootIds.splice(first, 0, group.id);
          s.selection = [group.id];
        }),

      ungroupSelected: () =>
        set((s) => {
          const released: string[] = [];
          for (const id of selectedRoots(s.scene, s.selection)) {
            const g = s.scene.nodes[id];
            if (g.type !== 'group') continue;
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
            if (n) n.mode = n.mode === 'solid' ? 'hole' : 'solid';
          }
        }),

      nudgeSelected: (delta) =>
        set((s) => {
          for (const id of selectedRoots(s.scene, s.selection)) {
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
