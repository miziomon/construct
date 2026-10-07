import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import type { CornerNode, EdgeNode, GroupNode, GroupOp, MeshNode, PrimitiveKind, PrimitiveNode, Scene, SceneNode, Shape2DKind, Shape2DNode, Vec3 } from './types';
import { randomColor } from './color';
import { lastShape, rememberShape } from './lastValues';
import { layFlatPatch } from './layFlat';
import { DEFAULT_COLOR, PRIMITIVE_LABELS, SHAPE2D_LABELS, halfHeight, primitiveDefaults, shape2dDefaults } from './defaults';
import { isScaled } from './groupScale';
import { composeTransform, conjugate, eulerToMatrix, matrixToEuler, normalizeMirror, round, toLocalTransform } from './math';
import type { Mirror, Transform } from './math';

export type GizmoMode = 'select' | 'translate' | 'rotate' | 'resize' | 'extrude';

interface SceneState {
  scene: Scene;
  /** Selezione corrente: sempre id di nodi esistenti. */
  selection: string[];
  gizmoMode: GizmoMode;
  /** Nome dell'operazione che ha prodotto la scena corrente: etichetta del passo nella timeline (vedi `labelled`). */
  op: string;

  addPrimitive: (kind: PrimitiveKind) => void;
  addShape2D: (kind: Shape2DKind) => void;
  /** Aggiunge una forma Testo con il testo e il font dati (usata dalla tab Simboli), appoggiata sul piatto. */
  addText: (input: { text: string; font: string; origin?: 'symbol' | 'emoji'; label?: string }) => void;
  /** Aggiunge un disegno SVG importato come forma 2D estrusa (contorni in mm, centrati), appoggiata sul piatto. */
  addSvg: (input: { name: string; fileName: string; contours: [number, number][][]; width: number; depth: number }) => string;
  /** Aggiunge una mesh importata, appoggiata sul piatto e centrata in XY. */
  addMesh: (input: { assetId: string; name: string; fileName: string; color?: string; origin: Vec3; size: Vec3; triangles: number }) => string;
  /** Aggiorna campi di un nodo (patch parziale, validata dal chiamante). */
  updateNode: (id: string, patch: Partial<PrimitiveNode> | Partial<Shape2DNode> | Partial<MeshNode> | Partial<GroupNode> | Partial<EdgeNode> | Partial<CornerNode>) => void;
  select: (ids: string[], additive?: boolean) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  /** Combina gli oggetti selezionati (in ordine di selezione) in un gruppo con l'operazione data. */
  combineSelected: (op: GroupOp) => void;
  /** Raggruppa: gli oggetti restano separati (colori propri, nessuna booleana) e si muovono insieme. */
  groupSelected: () => void;
  /** Unisce: unione booleana vera (union() in OpenSCAD). */
  unionSelected: () => void;
  /** Sposta un nodo (con il suo sottoalbero) in un altro gruppo o alla radice, mantenendo la sua posizione nel mondo. */
  moveNode: (id: string, target: MoveTarget) => boolean;
  /** Differenza: il secondo figlio diventa la base (rotazione dell'ordine dei figli). */
  cycleBase: (groupId: string) => void;
  ungroupSelected: () => void;
  toggleHoleSelected: () => void;
  toggleLockSelected: () => void;
  /** Abbassa gli oggetti selezionati finché il loro punto più basso tocca il piatto (minZ per id, in mm). */
  dropToBed: (minZById: Record<string, number>) => void;
  nudgeSelected: (delta: Vec3) => void;
  /** Sposta gli oggetti selezionati alla radice dei vettori dati (id → spostamento nel mondo, in mm). */
  alignSelected: (deltaById: Record<string, Vec3>) => void;
  /** Ruota un oggetto alla radice perché la faccia con questa normale (in coordinate mondo) guardi in basso, attorno a `center`. */
  layOnFace: (rootId: string, normal: Vec3, center: Vec3) => void;
  /** Specchia gli oggetti selezionati alla radice rispetto al piano perpendicolare all'asse (0 = X, 1 = Y, 2 = Z) passante per `center`. */
  mirrorSelected: (axis: 0 | 1 | 2, center: Vec3) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  loadScene: (scene: Scene) => void;
  clear: () => void;
}

/** Nome base del gruppo creato da ogni operazione. */
const GROUP_LABELS: Record<GroupOp, string> = { group: 'Gruppo', union: 'Unione', intersection: 'Intersezione', difference: 'Differenza', shell: 'Guscio', hull: 'Inviluppo convesso', array: 'Ripetizione', pattern: 'Pattern' };

/** Altezza iniziale dell'estrusione di un SVG importato (mm). */
const SVG_EXTRUDE_HEIGHT = 2;

export const emptyScene = (): Scene => ({ nodes: {}, rootIds: [] });

export const newId = () => crypto.randomUUID().slice(0, 8);

/** Nome progressivo unico per etichetta, es. "Cubo 2". */
export function uniqueName(scene: Scene, base: string): string {
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

/** True per il Raggruppa (gruppo solo dell'app, senza operazione booleana). */
export const isAppGroup = (node: SceneNode | undefined): node is GroupNode => node?.type === 'group' && node.op === 'group';

/** Dove inserire un nodo spostato: `parentId` null = radice; `index` è la posizione tra i fratelli. */
export interface MoveTarget {
  parentId: string | null;
  index: number;
}

/** Trasformazione di un nodo nel mondo: composizione delle trasformazioni di tutti gli antenati. */
export function worldTransform(scene: Scene, id: string): Transform {
  const chain: SceneNode[] = [];
  for (let cur: string | undefined = id; cur; cur = parentOf(scene, cur)) chain.unshift(scene.nodes[cur]);
  let world: Transform = { position: [0, 0, 0], rotation: [0, 0, 0] };
  for (const node of chain) world = composeTransform(world, node);
  return world;
}

/** Vero se qualche antenato del nodo è un gruppo ridimensionato. */
function inScaledGroup(scene: Scene, id: string): boolean {
  for (let cur = parentOf(scene, id); cur; cur = parentOf(scene, cur)) {
    const g = scene.nodes[cur];
    if (g?.type === 'group' && isScaled(g)) return true;
  }
  return false;
}

/**
 * Un nodo si può spostare in un gruppo (o alla radice se `parentId` è null) se né lui né la destinazione sono bloccati
 * e la destinazione è un gruppo che non coincide con il nodo né con un suo discendente.
 */
export function canMoveInto(scene: Scene, id: string, parentId: string | null): boolean {
  if (!scene.nodes[id] || isLocked(scene, id)) return false;
  // La scala di un gruppo ridimensionato non si compone nelle trasformazioni dei figli: spostare un nodo da o dentro un
  // gruppo ridimensionato lo farebbe saltare (prima si riporta la scala al 100%)
  if (inScaledGroup(scene, id)) return false;
  if (parentId === null) return true;
  const parent = scene.nodes[parentId];
  if (parent?.type !== 'group' || isLocked(scene, parentId)) return false;
  // Un Guscio svuota un solo solido: non accetta altri figli
  if (parent.op === 'shell' || parent.op === 'array' || parent.op === 'pattern') return false;
  if (isScaled(parent) || inScaledGroup(scene, parentId)) return false;
  return parentId !== id && !descendants(scene, id).includes(parentId);
}

/** Etichetta di una modifica generica: il verbo dipende dai campi toccati. */
function updateLabel(name: string | undefined, patch: object): string {
  const keys = Object.keys(patch);
  const verb = keys.includes('groupScale') ? 'Ridimensiona' : keys.includes('position') ? 'Sposta' : keys.includes('rotation') ? 'Ruota' : keys.includes('name') ? 'Rinomina' : keys.includes('color') ? 'Colore' : 'Modifica';
  return name ? `${verb} ${name}` : verb;
}

/** Campi che si possono cambiare anche su un oggetto bloccato. */
const ALWAYS_EDITABLE = new Set(['name', 'color', 'locked']);

/** Imposta lo specchio del nodo; senza assi attivi il campo sparisce, così le scene non specchiate restano com'erano. */
function setMirror(node: SceneNode, mirror?: Mirror): void {
  const m = normalizeMirror(mirror);
  if (m) node.mirror = m;
  else delete node.mirror;
}

/** Nodi selezionati che stanno alla radice della scena (solo questi si possono muovere, duplicare, raggruppare). */
function selectedRoots(scene: Scene, selection: string[]): string[] {
  return selection.filter((id) => scene.rootIds.includes(id));
}

/** Etichetta dell'operazione in corso: la legge il listener in fondo al file quando la scena cambia. */
let pendingOp: string | null = null;

/** Esegue `fn` dando un nome all'operazione: se la scena cambia, il nuovo stato porta quell'etichetta (timeline). */
export function labelled(op: string, fn: () => void): void {
  // Con la cronologia in pausa (anteprime, correzioni silenziose) lo stato non diventa un passo: niente etichetta
  pendingOp = useSceneStore.temporal.getState().isTracking ? op : null;
  try {
    fn();
  } finally {
    pendingOp = null;
  }
}

/** Come `set` dello store, ma con il nome dell'operazione. */
const act = (op: string, recipe: (s: SceneState) => void): void => labelled(op, () => useSceneStore.setState(recipe));

export const useSceneStore = create<SceneState>()(
  temporal(
    immer((set, get) => ({
      scene: emptyScene(),
      selection: [],
      gizmoMode: 'select',
      op: 'Inizio',

      addPrimitive: (kind) =>
        act(`Aggiungi ${PRIMITIVE_LABELS[kind]}`, (s) => {
          const id = newId();
          const node = {
            ...primitiveDefaults(kind),
            // Le misure dell'ultima forma dello stesso tipo modificata dall'utente (vedi lastValues.ts)
            ...lastShape(kind),
            id,
            name: uniqueName(s.scene, PRIMITIVE_LABELS[kind]),
            position: [0, 0, 0] as Vec3,
          } as PrimitiveNode;
          // Appoggia la forma sul piatto: il punto più basso a Z = 0
          node.position = [0, 0, halfHeight(node)];
          // Ogni forma nuova ha un colore diverso e compare in cima all'elenco degli oggetti
          node.color = randomColor();
          s.scene.nodes[id] = node;
          s.scene.rootIds.unshift(id);
          s.selection = [id];
        }),

      addShape2D: (kind) =>
        act(`Aggiungi ${SHAPE2D_LABELS[kind]}`, (s) => {
          const id = newId();
          const node = {
            ...shape2dDefaults(kind),
            ...lastShape(kind),
            id,
            name: uniqueName(s.scene, SHAPE2D_LABELS[kind]),
            position: [0, 0, 0] as Vec3,
          } as Shape2DNode;
          // L'estrusione è centrata: la base tocca il piatto con Z = altezza / 2
          node.position = [0, 0, halfHeight(node)];
          node.color = randomColor();
          s.scene.nodes[id] = node;
          s.scene.rootIds.unshift(id);
          s.selection = [id];
        }),

      addSvg: (input) => {
        const id = newId();
        act(`Importa ${input.name}`, (s) => {
          const { name, ...drawing } = input;
          // Uno spessore iniziale basso: un disegno piano è di solito una sagoma da estrudere poco
          const node = { ...shape2dDefaults('svg'), ...drawing, id, name: uniqueName(s.scene, name), position: [0, 0, 0] as Vec3, height: SVG_EXTRUDE_HEIGHT, lockRatio: true } as Shape2DNode;
          node.position = [0, 0, halfHeight(node)];
          node.color = randomColor();
          s.scene.nodes[id] = node;
          s.scene.rootIds.unshift(id);
          s.selection = [id];
        });
        return id;
      },

      addText: ({ text, font, origin, label }) => {
        // Un simbolo o un'emoji non si chiama "Testo": il nome dice cos'è (es. "Simbolo: Stella piena", "Emoji 😂")
        const baseName = origin === 'symbol' ? `Simbolo: ${label ?? text}` : origin === 'emoji' ? `Emoji ${text}` : SHAPE2D_LABELS.text;
        act(origin === 'symbol' ? 'Aggiungi simbolo' : origin === 'emoji' ? 'Aggiungi emoji' : `Aggiungi ${SHAPE2D_LABELS.text}`, (s) => {
          const id = newId();
          const node = {
            ...shape2dDefaults('text'),
            ...lastShape('text'),
            text,
            font,
            ...(origin ? { origin } : {}),
            id,
            name: uniqueName(s.scene, baseName),
            position: [0, 0, 0] as Vec3,
          } as Shape2DNode;
          node.position = [0, 0, halfHeight(node)];
          node.color = randomColor();
          s.scene.nodes[id] = node;
          s.scene.rootIds.unshift(id);
          s.selection = [id];
        });
      },

      addMesh: (input) => {
        const id = newId();
        act(`Importa ${input.name}`, (s) => {
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
            // Le mesh senza colore proprio (STL) ricevono un colore casuale come le altre forme
            color: input.color ?? randomColor(),
          };
          s.scene.nodes[id] = node;
          s.scene.rootIds.unshift(id);
          s.selection = [id];
        });
        return id;
      },

      updateNode: (id, patch) => {
        const before = get().scene.nodes[id];
        act(updateLabel(before?.name, patch), (s) => {
          const node = s.scene.nodes[id];
          if (!node) return;
          // Su un oggetto bloccato passano solo nome, colore e il blocco stesso
          if (isLocked(s.scene, id) && Object.keys(patch).some((k) => !ALWAYS_EDITABLE.has(k))) return;
          Object.assign(node, patch);
        });
        // Le misure inserite diventano il punto di partenza delle prossime forme dello stesso tipo
        if (before && (before.type === 'primitive' || before.type === 'shape2d') && !isLocked(get().scene, id)) rememberShape(before.kind, patch);
      },

      select: (ids, additive = false) =>
        set((s) => {
          const valid = ids.filter((id) => s.scene.nodes[id]);
          s.selection = additive ? [...new Set([...s.selection, ...valid])] : valid;
        }),

      removeSelected: () =>
        act('Elimina', (s) => {
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
        act('Duplica', (s) => {
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
            copies.push(cid);
          }
          // Le copie stanno in cima, nello stesso ordine degli originali
          s.scene.rootIds.unshift(...copies);
          if (copies.length) s.selection = copies;
        }),

      /**
       * RAGGRUPPA (op 'group') e UNISCI (op 'union'): crea un gruppo che contiene gli oggetti selezionati alla radice.
       * Passi: 1) si scelgono i soli oggetti alla radice e non bloccati (servono almeno due); 2) il gruppo nasce al
       * centroide dei figli e le posizioni dei figli diventano relative a lui, così nel mondo nulla si sposta;
       * 3) il gruppo prende il posto del primo figlio nell'elenco della radice e diventa la selezione.
       * La differenza tra i due è solo `op`: il kernel e il codice OpenSCAD fanno il resto (vedi evaluate.ts).
       */
      combineSelected: (op) =>
        act(GROUP_LABELS[op], (s) => {
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
          // I fori hanno senso solo come differenza tra oggetti: in un Raggruppa diventano solidi
          if (op === 'group') for (const n of nodes) n.mode = 'solid';
          s.scene.nodes[group.id] = group;
          // Il gruppo prende il posto del primo figlio nell'ordine delle radici
          const first = Math.min(...ids.map((id) => s.scene.rootIds.indexOf(id)));
          s.scene.rootIds = s.scene.rootIds.filter((id) => !ids.includes(id));
          s.scene.rootIds.splice(first, 0, group.id);
          s.selection = [group.id];
        }),

      groupSelected: () => get().combineSelected('group'),

      unionSelected: () => get().combineSelected('union'),

      moveNode: (id, target) => {
        if (!canMoveInto(get().scene, id, target.parentId)) return false;
        act('Sposta nella gerarchia', (s) => {
          const node = s.scene.nodes[id];
          // Posizione nel mondo prima dello spostamento, da riportare nel sistema della nuova destinazione
          const world = worldTransform(s.scene, id);
          const oldParentId = parentOf(s.scene, id);
          const siblings = (parentId: string | null | undefined) => {
            if (!parentId) return s.scene.rootIds;
            return (s.scene.nodes[parentId] as GroupNode).children;
          };

          const from = siblings(oldParentId);
          const fromIndex = from.indexOf(id);
          from.splice(fromIndex, 1);
          const to = siblings(target.parentId);
          // Spostando verso il basso nello stesso elenco, la rimozione ha già fatto scalare gli indici
          let index = Math.max(0, Math.min(target.index, to.length));
          if ((oldParentId ?? null) === target.parentId && fromIndex < target.index) index = Math.max(0, Math.min(target.index - 1, to.length));
          to.splice(index, 0, id);

          // Nuova trasformazione locale, per non spostare l'oggetto nel mondo
          const parentWorld: Transform = target.parentId ? worldTransform(s.scene, target.parentId) : { position: [0, 0, 0], rotation: [0, 0, 0] };
          const local = toLocalTransform(parentWorld, world);
          node.position = local.position.map((v) => round(v)) as Vec3;
          node.rotation = local.rotation.map((v) => round(v)) as Vec3;
          setMirror(node, local.mirror);
          // In un Raggruppa un foro diventa un solido
          if (isAppGroup(s.scene.nodes[target.parentId ?? '']) && node.mode === 'hole') node.mode = 'solid';

          // Il vecchio gruppo, se è rimasto vuoto, sparisce (a cascata verso l'alto)
          for (let cur = oldParentId; cur; ) {
            const g = s.scene.nodes[cur];
            if (g?.type !== 'group' || g.children.length > 0) break;
            const up = parentOf(s.scene, cur);
            siblings(up).splice(siblings(up).indexOf(cur), 1);
            delete s.scene.nodes[cur];
            s.selection = s.selection.filter((x) => x !== cur);
            cur = up;
          }
        });
        return true;
      },

      cycleBase: (groupId) =>
        act('Scambia base', (s) => {
          const g = s.scene.nodes[groupId];
          if (g?.type !== 'group' || isLocked(s.scene, groupId) || g.children.length < 2) return;
          g.children.push(g.children.shift()!);
        }),

      /**
       * SEPARA: dissolve i gruppi selezionati alla radice (Raggruppa, Unione, Differenza, Intersezione, Guscio,
       * Raccordo e Smusso). I figli tornano alla radice al posto del gruppo, con la trasformazione del gruppo
       * ricomposta nella propria (nel mondo non si spostano). Le operazioni booleane si perdono: restano i pezzi.
       */
      ungroupSelected: () =>
        act('Separa', (s) => {
          const released: string[] = [];
          for (const id of selectedRoots(s.scene, s.selection)) {
            const g = s.scene.nodes[id];
            // Un gruppo ridimensionato resta com'è: i figli non possono assorbirne la scala
            if (g.type !== 'group' || isLocked(s.scene, id) || isScaled(g)) continue;
            // Ricompone la trasformazione del gruppo su ogni figlio per non spostarlo nel mondo
            for (const cid of g.children) {
              const child = s.scene.nodes[cid];
              const w = composeTransform(g, child);
              child.position = w.position.map((v) => round(v)) as Vec3;
              child.rotation = w.rotation.map((v) => round(v)) as Vec3;
              setMirror(child, w.mirror);
              released.push(cid);
            }
            const at = s.scene.rootIds.indexOf(id);
            s.scene.rootIds.splice(at, 1, ...g.children);
            delete s.scene.nodes[id];
          }
          if (released.length) s.selection = released;
        }),

      toggleHoleSelected: () =>
        act('Solido/Foro', (s) => {
          for (const id of s.selection) {
            const n = s.scene.nodes[id];
            // I fori hanno effetto solo dentro le booleane: i figli diretti di un Raggruppa restano solidi
            if (n && !isLocked(s.scene, id) && !isAppGroup(s.scene.nodes[parentOf(s.scene, id) ?? ''])) n.mode = n.mode === 'solid' ? 'hole' : 'solid';
          }
        }),

      toggleLockSelected: () =>
        act('Blocca/Sblocca', (s) => {
          // Se almeno uno è sbloccato li blocca tutti, altrimenti li sblocca tutti
          const lockAll = s.selection.some((id) => !s.scene.nodes[id]?.locked);
          for (const id of s.selection) {
            const n = s.scene.nodes[id];
            if (n) n.locked = lockAll;
          }
        }),

      dropToBed: (minZById) =>
        act('Appoggia sul piatto', (s) => {
          for (const id of selectedRoots(s.scene, s.selection)) {
            const minZ = minZById[id];
            if (minZ === undefined || isLocked(s.scene, id)) continue;
            const n = s.scene.nodes[id];
            n.position = [n.position[0], n.position[1], round(n.position[2] - minZ)];
          }
        }),

      nudgeSelected: (delta) =>
        act('Sposta', (s) => {
          for (const id of selectedRoots(s.scene, s.selection)) {
            if (isLocked(s.scene, id)) continue;
            const n = s.scene.nodes[id];
            n.position = [n.position[0] + delta[0], n.position[1] + delta[1], n.position[2] + delta[2]];
          }
        }),

      alignSelected: (deltaById) =>
        act('Allinea', (s) => {
          for (const id of selectedRoots(s.scene, s.selection)) {
            const d = deltaById[id];
            if (!d || isLocked(s.scene, id)) continue;
            const n = s.scene.nodes[id];
            n.position = [round(n.position[0] + d[0]), round(n.position[1] + d[1]), round(n.position[2] + d[2])];
          }
        }),

      layOnFace: (rootId, normal, center) =>
        act('Appoggia su faccia', (s) => {
          const node = s.scene.nodes[rootId];
          if (!node || !s.scene.rootIds.includes(rootId) || isLocked(s.scene, rootId)) return;
          const next = layFlatPatch(node, normal, center);
          node.position = next.position;
          node.rotation = next.rotation;
        }),

      mirrorSelected: (axis, center) =>
        act(`Specchia ${'XYZ'[axis]}`, (s) => {
          // S = riflessione sul piano: -1 sull'asse scelto
          const refl: Vec3 = [1, 1, 1];
          refl[axis] = -1;
          for (const id of selectedRoots(s.scene, s.selection)) {
            if (isLocked(s.scene, id)) continue;
            const n = s.scene.nodes[id];
            // x' = S(R·D·x + p − c) + c = (S·R·S)·(S·D)·x + S(p − c) + c
            n.position = n.position.map((v, i) => round(refl[i] * (v - center[i]) + center[i])) as Vec3;
            n.rotation = matrixToEuler(conjugate(eulerToMatrix(n.rotation), refl)).map((v) => round(v)) as Vec3;
            const m: Mirror = [...(n.mirror ?? [false, false, false])];
            m[axis] = !m[axis];
            setMirror(n, m);
          }
        }),

      setGizmoMode: (mode) =>
        set((s) => {
          s.gizmoMode = mode;
        }),

      loadScene: (scene) =>
        act('Apri progetto', (s) => {
          s.scene = scene;
          s.selection = [];
        }),

      clear: () =>
        act('Nuovo progetto', (s) => {
          s.scene = emptyScene();
          s.selection = [];
        }),
    })),
    {
      // Nella cronologia di undo/redo entrano la scena e il nome dell'operazione: selezione e gizmo no
      partialize: (s) => ({ scene: s.scene, op: s.op }),
      // Immer mantiene lo stesso riferimento se la scena non cambia: selezione e gizmo non creano voci di cronologia
      equality: (a, b) => a.scene === b.scene,
      limit: 100,
    },
  ),
);

// Il nome dell'operazione si assegna dopo che la cronologia ha salvato lo stato precedente (con la sua etichetta):
// così ogni stato passato porta il nome dell'operazione che lo ha prodotto. Il cambio di `op` da solo non crea passi
// (l'uguaglianza della cronologia guarda la sola scena)
useSceneStore.subscribe((state, prev) => {
  if (pendingOp !== null && state.scene !== prev.scene && state.op !== pendingOp) {
    const op = pendingOp;
    pendingOp = null;
    useSceneStore.setState({ op });
  }
});
