import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { current } from 'immer';
import { temporal } from 'zundo';
import type { ScadImport } from '../import/scad/toScene';
import type { Binding, CornerNode, Draft, EdgeNode, GroupNode, GroupOp, MeshNode, Param, PathContour, PrimitiveKind, PrimitiveNode, Scene, SceneNode, Shape2DKind, Shape2DNode, Vec2, Vec3 } from './types';
import { notify } from '../ui/notify/notifyStore';
import { applyBindings, boundValue, formulaDeps, holdBound, nameProblem, renameInExpr, resolveParams, setPath } from './params';
import { randomColor } from './color';
import { lastShape, rememberShape } from './lastValues';
import { layFlatPatch } from './layFlat';
import { layDownStep } from './layDown';
import { DEFAULT_COLOR, PRIMITIVE_LABELS, SHAPE2D_LABELS, halfHeight, primitiveDefaults, shape2dDefaults } from './defaults';
import { isScaled } from './groupScale';
import { addImportedRoots, addPlateScene, moveRootsToPlate, plateName, platesOf, removePlateScene, renamePlateScene, switchPlateScene } from './plates';
import { composeTransform, conjugate, eulerToMatrix, matrixToEuler, normalizeMirror, round, toLocalTransform } from './math';
import type { Mirror, Transform } from './math';
import { pathNaturalSize } from './shapes2d';
import { hasBoundDimension } from './resize';
import { compensatePosition } from './pathPlacement';
import { convertToPath as convertShapeToPath } from './convertPath';

export type GizmoMode = 'select' | 'translate' | 'rotate' | 'resize' | 'extrude';

interface SceneState {
  scene: Scene;
  /** Selezione corrente: sempre id di nodi esistenti. */
  selection: string[];
  gizmoMode: GizmoMode;
  /** Nome dell'operazione che ha prodotto la scena corrente: etichetta del passo nella timeline (vedi `labelled`). */
  op: string;

  /** Aggiunge una forma 3D, appoggiata sul piatto: all'origine, o nel punto XY indicato (menu contestuale sul vuoto). */
  addPrimitive: (kind: PrimitiveKind, at?: [number, number]) => void;
  addShape2D: (kind: Shape2DKind, at?: [number, number]) => void;
  /** Aggiunge una forma Testo con il testo e il font dati (usata dalla tab Simboli), appoggiata sul piatto. */
  addText: (input: { text: string; font: string; origin?: 'symbol' | 'emoji'; label?: string; at?: [number, number] }) => void;
  /** Aggiunge un disegno SVG importato come forma 2D estrusa (contorni in mm, centrati), appoggiata sul piatto. */
  addSvg: (input: { name: string; fileName: string; contours: [number, number][][]; width: number; depth: number }) => string;
  /**
   * Aggiunge un Profilo di Bézier (forma 2D `path`) dai contorni dati, appoggiato sul piatto. I nodi si arrotondano a 4
   * decimali; larghezza e profondità sono quelle naturali delle curve. Per ora nasce solo da qui (test) e dall'import di .scad.
   */
  addPath: (input: { paths: PathContour[]; tolerance?: number; extrusion?: 'linear' | 'rotate'; height?: number; twist?: number; scaleTop?: number; revolveAngle?: number; revolveSegments?: number; at?: [number, number]; name?: string }) => string;
  /**
   * Applica il disegno della modale a un Profilo esistente in un solo passo di Annulla ("Profilo"): contorni a 4 decimali,
   * parametri di estrusione, `width × depth` = misure naturali del disegno (non scritte se qualche misura è legata a un
   * parametro: lì il disegno si scala alla misura della formula) e posizione compensata dallo spostamento del centro del
   * disegno da `before` a `after` (vedi pathPlacement.ts). Rifiuta (false) un nodo bloccato o che non è un Profilo.
   */
  commitProfile: (id: string, draft: Draft, centers: { before: Vec2; after: Vec2 }) => boolean;
  /**
   * Converte una forma 2D (cerchio, quadrato, forme poligonali, profilati, SVG) nel Profilo di Bézier equivalente, in un solo
   * passo di Annulla ("Converti in profilo"): stesso id e stesso solido, i contorni diventano nodi modificabili (vedi
   * convertPath.ts; il cerchio con più di 12 lati diventa una curva e il solido cambia di poco). Rifiuta (false, con un avviso) un nodo bloccato, il testo, un Profilo e un disegno oltre i tetti dei nodi.
   */
  convertToPath: (id: string) => boolean;
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
  /** Nasconde gli oggetti selezionati alla radice: spariscono dalla vista e dalla selezione, ma restano nel calcolo e nelle esportazioni. */
  hideSelected: () => void;
  /** Nasconde o mostra un oggetto alla radice (anche se bloccato): serve all'icona dell'elenco. */
  setHidden: (id: string, hidden: boolean) => void;
  /** Mostra tutti gli oggetti nascosti del piatto attivo. */
  showAllHidden: () => void;
  /** Abbassa gli oggetti selezionati finché il loro punto più basso tocca il piatto (minZ per id, in mm). */
  dropToBed: (minZById: Record<string, number>) => void;
  nudgeSelected: (delta: Vec3) => void;
  /** Sposta gli oggetti selezionati alla radice dei vettori dati (id → spostamento nel mondo, in mm). */
  alignSelected: (deltaById: Record<string, Vec3>) => void;
  /** Ruota un oggetto alla radice perché la faccia con questa normale (in coordinate mondo) guardi in basso, attorno a `center`. */
  layOnFace: (rootId: string, normal: Vec3, center: Vec3) => void;
  /** Sdraia: ruota di 90° le radici selezionate (vedi layDown.ts) attorno al centro del loro ingombro (id → centro). */
  layDownSelected: (centerById: Record<string, Vec3>) => void;
  /** Specchia gli oggetti selezionati alla radice rispetto al piano perpendicolare all'asse (0 = X, 1 = Y, 2 = Z) passante per `center`. */
  mirrorSelected: (axis: 0 | 1 | 2, center: Vec3) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  loadScene: (scene: Scene) => void;
  clear: () => void;

  /** Inserisce nel progetto gli oggetti letti da un file OpenSCAD (un solo passo di Annulla). Restituisce quante radici ha aggiunto. */
  importScad: (imported: ScadImport, label: string) => number;
  /** Aggiunge un piatto vuoto e lo rende attivo (un passo di Annulla). Restituisce l'id del nuovo piatto. */
  addPlate: () => string;
  /** Rende attivo un piatto. Non è un passo di Annulla: cambia solo cosa si vede (la selezione si azzera). */
  switchPlate: (id: string) => void;
  renamePlate: (id: string, name: string) => void;
  /** Elimina un piatto con i suoi oggetti (l'ultimo non si elimina). */
  removePlate: (id: string) => void;
  /** Sposta gli oggetti selezionati (alla radice, non bloccati) in un altro piatto. */
  moveSelectionToPlate: (plateId: string) => void;

  /** Aggiunge un parametro di progetto (un passo di Annulla). Restituisce l'id. */
  addParam: (name: string, expr: string) => string;
  /** Cambia nome, formula o nota di un parametro e ricalcola i campi legati. Un nome non valido o già usato si rifiuta (false). */
  updateParam: (id: string, patch: Partial<Pick<Param, 'name' | 'expr' | 'note'>>) => boolean;
  /** Elimina un parametro: i campi che lo usavano restano con il valore che avevano, senza formula. */
  removeParam: (id: string) => void;
  /** Ignora un avviso di stampabilità (si ricorda nel progetto); `restoreWarning` lo rimette, `restoreAllWarnings` rimette tutti. */
  ignoreWarning: (id: string) => void;
  restoreWarning: (id: string) => void;
  restoreAllWarnings: () => void;
  /** Lega un campo numerico di un nodo a una formula (o la scioglie con null). Un solo passo di Annulla. */
  bindField: (id: string, path: string, binding: Binding | null) => void;
}

/** Nome base del gruppo creato da ogni operazione. */
const GROUP_LABELS: Record<GroupOp, string> = { group: 'Gruppo', union: 'Unione', intersection: 'Intersezione', difference: 'Differenza', shell: 'Guscio', hull: 'Inviluppo convesso', minkowski: 'Minkowski', array: 'Ripetizione', pattern: 'Pattern' };

/** Altezza iniziale dell'estrusione di un SVG importato (mm). */
const SVG_EXTRUDE_HEIGHT = 2;

/** Contorni di un Profilo con le coordinate a 4 decimali (come il codice OpenSCAD); `|| 0` toglie il -0. */
export function roundPaths(paths: PathContour[]): PathContour[] {
  const r4 = ([x, y]: Vec2): Vec2 => [round(x, 4) || 0, round(y, 4) || 0];
  return paths.map((c) => ({
    closed: c.closed,
    nodes: c.nodes.map((n) => ({ p: r4(n.p), ...(n.in ? { in: r4(n.in) } : {}), ...(n.out ? { out: r4(n.out) } : {}), kind: n.kind })),
  }));
}

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

/** Un nodo è nascosto se lo è lui o uno dei gruppi che lo contengono. */
export function isHidden(scene: Scene, id: string): boolean {
  for (let cur: string | undefined = id; cur; cur = parentOf(scene, cur)) {
    if (scene.nodes[cur]?.hidden) return true;
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

/** Istante dell'ultimo avviso sui campi legati: un trascinamento chiama updateNode decine di volte, l'avviso è uno solo. */
let lastHeldNotice = 0;

/** Avvisa (al massimo ogni 3 secondi) che un campo legato a un parametro non è stato modificato. */
function noteHeld(name?: string): void {
  const now = Date.now();
  if (now - lastHeldNotice < 3000) return;
  lastHeldNotice = now;
  notify.info(`«${name ?? 'Oggetto'}»: i campi legati a un parametro non cambiano. Doppio clic sul nome del campo per scegliere un altro parametro o toglierlo`);
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

      addPrimitive: (kind, at) =>
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
          node.position = [at?.[0] ?? 0, at?.[1] ?? 0, halfHeight(node)];
          // Ogni forma nuova ha un colore diverso e compare in cima all'elenco degli oggetti
          node.color = randomColor();
          s.scene.nodes[id] = node;
          s.scene.rootIds.unshift(id);
          s.selection = [id];
        }),

      addShape2D: (kind, at) =>
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
          node.position = [at?.[0] ?? 0, at?.[1] ?? 0, halfHeight(node)];
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

      addPath: (input) => {
        const id = newId();
        act('Aggiungi Profilo', (s) => {
          const { paths, at, name, ...params } = input;
          const rounded = roundPaths(paths);
          const size = pathNaturalSize({ paths: rounded });
          const node = {
            ...shape2dDefaults('path'),
            ...params,
            paths: rounded,
            width: size.width,
            depth: size.depth,
            id,
            name: uniqueName(s.scene, name ?? SHAPE2D_LABELS.path),
            position: [0, 0, 0] as Vec3,
            lockRatio: true,
          } as Shape2DNode;
          // L'estrusione è centrata: la base tocca il piatto con Z = altezza / 2
          node.position = [at?.[0] ?? 0, at?.[1] ?? 0, halfHeight(node)];
          node.color = randomColor();
          s.scene.nodes[id] = node;
          s.scene.rootIds.unshift(id);
          s.selection = [id];
        });
        return id;
      },

      commitProfile: (id, draft, centers) => {
        const node = get().scene.nodes[id];
        // Solo un Profilo, e non bloccato (nemmeno da un gruppo che lo contiene)
        if (node?.type !== 'shape2d' || node.kind !== 'path' || isLocked(get().scene, id)) return false;
        let held = false;
        act('Profilo', (s) => {
          const target = s.scene.nodes[id] as Shape2DNode;
          const rounded = roundPaths(draft.paths);
          const size = pathNaturalSize({ paths: rounded });
          const patch: Record<string, unknown> = {
            paths: rounded,
            tolerance: draft.tolerance,
            extrusion: draft.extrusion,
            height: draft.height,
            twist: draft.twist,
            scaleTop: draft.scaleTop,
            revolveAngle: draft.revolveAngle,
            revolveSegments: draft.revolveSegments,
            // Il centro del disegno è cambiato: il nodo si sposta perché le parti invariate restino dove sono
            position: compensatePosition(target, draft.extrusion, centers.before, centers.after),
          };
          // Con una misura legata a un parametro il disegno si scala alla misura della formula: larghezza e profondità non si toccano
          if (!hasBoundDimension(target)) Object.assign(patch, { width: size.width, depth: size.depth });
          // I campi legati (altezza, posizione...) tengono il valore della formula, come per ogni altra modifica
          const kept = holdBound(target, patch);
          held = kept.held;
          Object.assign(target, kept.patch);
        });
        // Come in updateNode: se un campo legato doveva cambiare, l'utente lo sa invece di vederlo restare com'era
        if (held) noteHeld(node.name);
        return true;
      },

      convertToPath: (id) => {
        const node = get().scene.nodes[id];
        if (node?.type !== 'shape2d') return false;
        if (isLocked(get().scene, id)) {
          notify.error(`«${node.name}» è bloccato: sbloccalo per convertirlo in Profilo`);
          return false;
        }
        const result = convertShapeToPath(node);
        if (typeof result === 'string') {
          notify.error(result);
          return false;
        }
        // Un solo passo: il nodo cambia forma ma resta lo stesso oggetto (id, posizione nella scena, selezione)
        act('Converti in profilo', (s) => {
          s.scene.nodes[id] = result.node;
        });
        // Il cerchio con molti lati diventa una curva: il solido cambia di poco, l'utente lo sa
        if (result.approximate) notify.info(`«${node.name}»: il cerchio con ${Math.round((node as { segments: number }).segments)} lati diventa una curva e il solido cambia di poco`);
        // I legami che il Profilo non può tenere (raggio, lati...) si perdono: l'utente lo sa
        if (result.dropped.length) notify.info(`«${node.name}»: ${result.dropped.length === 1 ? `il legame di ${result.dropped[0]} al parametro si perde` : `i legami di ${result.dropped.join(', ')} ai parametri si perdono`}`);
        return true;
      },

      addText: ({ text, font, origin, label, at }) => {
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
          node.position = [at?.[0] ?? 0, at?.[1] ?? 0, halfHeight(node)];
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
        let held = false;
        act(updateLabel(before?.name, patch), (s) => {
          const node = s.scene.nodes[id];
          if (!node) return;
          // Su un oggetto bloccato passano solo nome, colore e il blocco stesso
          if (isLocked(s.scene, id) && Object.keys(patch).some((k) => !ALWAYS_EDITABLE.has(k))) return;
          // I campi legati a un parametro non cambiano (gizmo, quote, ridimensionamento): per toglierli dalla formula si
          // usa il selettore dei parametri
          const kept = holdBound(node, patch);
          if (kept.held) held = true;
          Object.assign(node, kept.patch);
        });
        if (held) noteHeld(before?.name);
        // Le misure inserite diventano il punto di partenza delle prossime forme dello stesso tipo
        if (before && (before.type === 'primitive' || before.type === 'shape2d') && !isLocked(get().scene, id)) rememberShape(before.kind, patch);
      },

      select: (ids, additive = false) =>
        set((s) => {
          // Gli oggetti nascosti non si selezionano da nessun percorso (vista, elenco, menu)
          const valid = ids.filter((id) => s.scene.nodes[id] && !isHidden(s.scene, id));
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
          // La copia resta nelle stesse coordinate dell'originale: si sposta poi dove serve
          for (const id of selectedRoots(s.scene, s.selection)) copies.push(clone(id));
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

      hideSelected: () =>
        act('Nascondi', (s) => {
          // Solo le radici: un figlio fa parte della mesh del suo gruppo e non si può nascondere da solo
          const ids = selectedRoots(s.scene, s.selection);
          for (const id of ids) s.scene.nodes[id].hidden = true;
          s.selection = s.selection.filter((id) => !isHidden(s.scene, id));
        }),

      setHidden: (id, hidden) =>
        act(hidden ? 'Nascondi' : 'Mostra', (s) => {
          if (!s.scene.rootIds.includes(id)) return;
          const node = s.scene.nodes[id];
          if (hidden) {
            node.hidden = true;
            s.selection = s.selection.filter((x) => !isHidden(s.scene, x));
          } else delete node.hidden;
        }),

      showAllHidden: () =>
        act('Mostra tutti', (s) => {
          for (const id of s.scene.rootIds) delete s.scene.nodes[id].hidden;
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

      layDownSelected: (centerById) =>
        act('Sdraia', (s) => {
          for (const id of selectedRoots(s.scene, s.selection)) {
            const center = centerById[id];
            if (!center || isLocked(s.scene, id)) continue;
            const n = s.scene.nodes[id];
            const next = layDownStep(n, center);
            n.position = next.position;
            n.rotation = next.rotation;
          }
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

      importScad: (imported, label) => {
        const roots = imported.plates.reduce((n, p) => n + p.rootIds.length, 0);
        if (!roots) return 0;
        act(`Importa ${label}`, (s) => {
          // I nomi restano unici nel progetto: i figli vengono prima dei gruppi, come sono stati creati
          for (const node of Object.values(imported.nodes)) s.scene.nodes[node.id] = { ...node, name: uniqueName(s.scene, node.name) };
          s.scene = addImportedRoots(current(s.scene), imported.plates, newId);
          s.selection = imported.plates[0].rootIds;
        });
        return roots;
      },

      addPlate: () => {
        const id = newId();
        act('Aggiungi piatto', (s) => {
          s.scene = switchPlateScene(addPlateScene(current(s.scene), id), id);
          s.selection = [];
        });
        return id;
      },

      switchPlate: (id) => {
        // Senza un passo di cronologia: cambiare piatto non modifica il progetto. Lo stato resta coerente (contiene il
        // piatto attivo), quindi annullando un passo fatto su un altro piatto si torna a vederlo
        const temporal = useSceneStore.temporal.getState();
        temporal.pause();
        try {
          useSceneStore.setState((s) => {
            s.scene = switchPlateScene(current(s.scene), id);
            s.selection = [];
          });
        } finally {
          temporal.resume();
        }
      },

      renamePlate: (id, name) =>
        act('Rinomina piatto', (s) => {
          s.scene = renamePlateScene(current(s.scene), id, name);
        }),

      removePlate: (id) =>
        act('Elimina piatto', (s) => {
          const base = current(s.scene);
          const next = removePlateScene(base, id);
          if (next === base) return;
          s.scene = next;
          s.selection = s.selection.filter((n) => next.nodes[n]);
        }),

      moveSelectionToPlate: (plateId) => {
        const name = platesOf(get().scene).find((p) => p.id === plateId)?.name ?? plateName(1);
        act(`Sposta nel ${name}`, (s) => {
          const ids = selectedRoots(s.scene, s.selection).filter((id) => !isLocked(s.scene, id));
          if (!ids.length) return;
          s.scene = moveRootsToPlate(current(s.scene), ids, plateId);
          s.selection = [];
        });
      },

      addParam: (name, expr) => {
        const id = newId();
        act('Aggiungi parametro', (s) => {
          s.scene.params = [...(s.scene.params ?? []), { id, name, expr }];
        });
        return id;
      },

      updateParam: (id, patch) => {
        const param = get().scene.params?.find((p) => p.id === id);
        if (!param) return false;
        const rename = patch.name !== undefined && patch.name !== param.name;
        // Il nome deve essere una variabile OpenSCAD valida e non già usata da un altro parametro
        if (rename && (nameProblem(patch.name!) || get().scene.params!.some((p) => p.name === patch.name))) return false;
        act(`Modifica parametro ${param.name}`, (s) => {
          const target = s.scene.params!.find((p) => p.id === id)!;
          // Rinominare aggiorna tutte le formule che usavano il vecchio nome
          if (rename) {
            for (const p of s.scene.params!) p.expr = renameInExpr(p.expr, param.name, patch.name!);
            for (const node of Object.values(s.scene.nodes)) for (const b of Object.values(node.exprs ?? {})) b.expr = renameInExpr(b.expr, param.name, patch.name!);
          }
          Object.assign(target, patch);
          if (target.note === '') delete target.note;
          applyBindings(s.scene);
        });
        return true;
      },

      removeParam: (id) =>
        act('Elimina parametro', (s) => {
          const target = s.scene.params?.find((p) => p.id === id);
          if (!target) return;
          // I valori si calcolano prima di togliere il parametro: i suoi dipendenti li conservano come numeri
          const { values } = resolveParams(current(s.scene).params);
          const uses = (text: string) => formulaDeps(text).includes(target.name);
          for (const node of Object.values(s.scene.nodes)) {
            for (const [path, b] of Object.entries(node.exprs ?? {})) if (uses(b.expr)) delete node.exprs![path];
            if (node.exprs && Object.keys(node.exprs).length === 0) delete node.exprs;
          }
          for (const p of s.scene.params!) if (p !== target && uses(p.expr) && p.name in values) p.expr = String(round(values[p.name], 4));
          s.scene.params = s.scene.params!.filter((p) => p.id !== id);
          if (s.scene.params.length === 0) delete s.scene.params;
          applyBindings(s.scene);
        }),

      ignoreWarning: (id) =>
        act('Ignora avviso', (s) => {
          if (s.scene.ignoredWarnings?.includes(id)) return;
          s.scene.ignoredWarnings = [...(s.scene.ignoredWarnings ?? []), id];
        }),

      restoreWarning: (id) =>
        act('Ripristina avviso', (s) => {
          if (!s.scene.ignoredWarnings?.includes(id)) return;
          const rest = s.scene.ignoredWarnings.filter((w) => w !== id);
          if (rest.length) s.scene.ignoredWarnings = rest;
          else delete s.scene.ignoredWarnings;
        }),

      restoreAllWarnings: () =>
        act('Ripristina gli avvisi', (s) => {
          delete s.scene.ignoredWarnings;
        }),

      bindField: (id, path, binding) => {
        const before = get().scene.nodes[id];
        if (!before || isLocked(get().scene, id)) return;
        act(`Modifica ${before.name}`, (s) => {
          const node = s.scene.nodes[id];
          if (!binding) {
            if (node.exprs) delete node.exprs[path];
            if (node.exprs && Object.keys(node.exprs).length === 0) delete node.exprs;
            return;
          }
          const result = boundValue(binding, resolveParams(current(s.scene).params).values);
          // Il campo deve esistere e la formula essere valida: chi chiama l'ha già controllata, qui si ricontrolla
          if (!result.ok || !setPath(node, path, result.value)) return;
          node.exprs = { ...node.exprs, [path]: binding };
        });
      },
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
