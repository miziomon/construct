import { create } from 'zustand';
import { getKernel } from '../../kernel/client';
import type { NodeMesh } from '../../kernel/evaluate';
import { useResultStore } from '../../kernel/useKernel';
import { faceMap } from '../../scene/edgeTool';
import type { Transform } from '../../scene/math';
import { defaultPatternParams, hasPlanarFace, normalizePattern, thicknessAlong } from '../../scene/pattern';
import { applyPattern, worldToLocal } from '../../scene/patternTool';
import { localBounds } from '../../scene/shell';
import { isLocked, labelled, parentOf, useSceneStore, worldTransform } from '../../scene/store';
import { isCutter } from '../../scene/treatment';
import type { GroupNode, PatternFace, PatternParams, Scene, Vec3 } from '../../scene/types';

/** Faccia sotto il puntatore mentre si scelgono le facce da cui applicare il pattern. */
export interface PatternHover {
  mesh: NodeMesh;
  face: number;
}

/** Oltre questa durata del calcolo (ms) l'anteprima è lenta e si avvisa; con le celle × facce sopra la stima si avvisa prima. */
export const SLOW_PREVIEW_MS = 700;
export const SLOW_PREVIEW_CELLS = 300;

/**
 * Strumento Pattern: applica un disegno (Voronoi casuale, esagoni, cerchi, rombi, triangoli) all'oggetto selezionato.
 * Stesso schema di Guscio e Serie: con il pannello aperto la cronologia è in pausa e l'anteprima vive nella scena (il
 * gruppo vero); OK registra un solo passo di Annulla.
 */
interface PatternToolState {
  active: boolean;
  /** Oggetto a cui applicare il pattern. */
  targetId: string | null;
  params: PatternParams | null;
  error: string | null;
  /** Scena prima dell'anteprima. */
  base: Scene | null;
  /** Gruppo Pattern creato dall'anteprima. */
  groupId: string | null;
  /** Scelta della faccia con un clic sull'oggetto in corso (la vista mostra il pezzo intero), e faccia sotto il puntatore. */
  picking: boolean;
  hover: PatternHover | null;
  /** Anteprima con meno segmenti: più veloce, e identica nel risultato definitivo. */
  simplified: boolean;

  start: () => void;
  cancel: () => void;
  commit: () => void;
  setParams: (patch: Partial<PatternParams>) => void;
  setPicking: (picking: boolean) => void;
  setSimplified: (simplified: boolean) => void;
  setHover: (hover: PatternHover | null) => void;
  /** Sceglie come faccia del pattern la faccia piana cliccata (anche inclinata): sostituisce la precedente e chiude la scelta. */
  pickFace: (mesh: NodeMesh, face: number) => void;
}

const INITIAL = { active: false, targetId: null, params: null, error: null, base: null, groupId: null, picking: false, hover: null, simplified: false };

const sceneStore = useSceneStore;

/** Vero se la selezione è un solo oggetto a cui si può applicare un pattern: non bloccato e non un raccordo o uno smusso. */
export function canPattern(scene: Scene, selection: string[]): boolean {
  const node = selection.length === 1 ? scene.nodes[selection[0]] : undefined;
  return node !== undefined && !isCutter(node) && !isLocked(scene, node.id);
}

/** Ingombro dell'oggetto nel suo sistema locale (dal calcolo del kernel), o null se non c'è ancora una mesh. */
export function localBoundsOf(scene: Scene, id: string): { min: Vec3; max: Vec3 } | null {
  const meshes = useResultStore.getState().meshes.filter((m) => !m.empty && m.path.includes(id));
  return meshes.length ? localBounds(meshes, worldTransform(scene, id)) : null;
}

/**
 * Regione del taglio per queste facce: 'face' (contorno della faccia reale) se su ogni faccia scelta una delle mesh del
 * pezzo ha davvero una faccia piana su quel piano, altrimenti 'silhouette' (la faccia viene dall'ingombro: sfera, cilindro
 * sdraiato...). `world` è la trasformazione del pezzo nel mondo, dove stanno le mesh.
 */
export function regionFor(meshes: NodeMesh[], faces: PatternFace[], world: Transform): 'face' | 'silhouette' {
  const meshFaces = meshes.flatMap((m) => faceMap(m).faces);
  return faces.every((face) => hasPlanarFace(meshFaces, face, world)) ? 'face' : 'silhouette';
}

/**
 * Radice che contiene il gruppo se tra la radice e il gruppo ci sono solo Raggruppa (il kernel produce una mesh per ogni
 * figlio solo attraverso di loro), altrimenti null: il pezzo di un Pattern dentro una booleana o un altro Pattern non ha una
 * mesh propria e «Aggiorna all'ingombro» non può misurarlo.
 */
export function refreshRoot(scene: Scene, groupId: string): string | null {
  let root = groupId;
  for (let up = parentOf(scene, root); up; up = parentOf(scene, root)) {
    const parent = scene.nodes[up];
    if (parent.type !== 'group' || parent.op !== 'group') return null;
    root = up;
  }
  return root;
}

/**
 * Nuovo ingombro e nuova regione di un Pattern già applicato. Il gruppo mostra il pezzo forato, quindi il pezzo intero si
 * ricava valutando una copia della scena dove il gruppo è un semplice Raggruppa; null se il pezzo non produce mesh.
 */
export async function refreshedPattern(scene: Scene, groupId: string): Promise<Pick<PatternParams, 'bounds' | 'region'> | null> {
  const group = scene.nodes[groupId] as GroupNode | undefined;
  const pattern = group?.pattern;
  if (!group || !pattern) return null;
  const { pattern: _removed, ...plain } = group;
  const root = refreshRoot(scene, groupId);
  if (!root) return null;
  // Basta la radice che contiene il gruppo: le mesh degli altri oggetti non servono
  const { meshes: all } = await getKernel().evaluateDetached({ ...scene, rootIds: [root], nodes: { ...scene.nodes, [groupId]: { ...plain, op: 'group' } } });
  const target = group.children[0];
  const meshes = all.filter((m) => !m.empty && m.path.includes(target));
  if (!meshes.length) return null;
  const world = worldTransform(scene, target);
  return { bounds: localBounds(meshes, world), region: regionFor(meshes, pattern.faces, world) };
}

/** Stima del lavoro: celle del Voronoi (o 60 per le griglie, in media) per il numero di facce. */
export function estimatedCells(p: PatternParams): number {
  // Il rilievo non ha celle: il suo calcolo è leggero e non deve far comparire l'avviso delle celle
  if (p.kind === 'brick') return 0;
  return (p.kind === 'voronoi' ? p.cells : 60) * p.faces.length;
}

export const usePatternTool = create<PatternToolState>()((set, get) => {
  /** Ricrea l'anteprima sulla scena di partenza, con i parametri correnti (non durante la scelta delle facce). */
  const rebuild = () => {
    const { targetId, params, picking, simplified } = get();
    if (!targetId || !params || picking) return;
    let base = get().base;
    if (!base) {
      // Prima anteprima: si ricorda la scena di partenza e si mette in pausa la cronologia
      base = sceneStore.getState().scene;
      sceneStore.temporal.getState().pause();
      set({ base });
    }
    const result = applyPattern(base, targetId, { ...params, preview: simplified });
    if (!result.ok) {
      sceneStore.setState({ scene: base });
      set({ error: result.error, groupId: null });
      return;
    }
    sceneStore.setState({ scene: result.scene, selection: [result.groupId] });
    set({ groupId: result.groupId, error: null });
  };

  /** Rimette la scena com'era prima dell'anteprima e riattiva la cronologia. */
  const restore = () => {
    const { base } = get();
    if (!base) return;
    sceneStore.setState({ scene: base });
    sceneStore.temporal.getState().resume();
  };

  return {
    ...INITIAL,

    start: () => {
      if (get().active) get().cancel();
      const { scene, selection } = sceneStore.getState();
      const targetId = selection.length === 1 ? selection[0] : null;
      if (!targetId || !canPattern(scene, selection)) return;
      const bounds = localBoundsOf(scene, targetId);
      if (!bounds) return;
      // Seme casuale: ogni apertura propone un disegno diverso, che resta riproducibile dal seme
      const seed = Math.floor(Math.random() * 100000);
      const defaults = defaultPatternParams(bounds, seed);
      // La faccia di partenza (+Z dell'ingombro): se è una faccia vera si forano solo i suoi punti (uno smusso accanto non si fora)
      const meshes = useResultStore.getState().meshes.filter((m) => !m.empty && m.path.includes(targetId));
      const region = regionFor(meshes, defaults.faces, worldTransform(scene, targetId));
      set({ ...INITIAL, active: true, targetId, params: { ...defaults, region } });
      rebuild();
    },

    cancel: () => {
      const { targetId, base } = get();
      restore();
      // Il gruppo dell'anteprima non esiste più: la selezione torna all'oggetto di partenza
      if (targetId && base) sceneStore.setState({ selection: [targetId] });
      set({ ...INITIAL });
    },

    commit: () => {
      const { groupId, base, params, targetId, picking } = get();
      if (!groupId || !base || !params || !targetId || picking) return get().cancel();
      // Il risultato definitivo è sempre a qualità piena, anche se l'anteprima era semplificata
      const final = applyPattern(base, targetId, { ...params, preview: false });
      if (!final.ok) return get().cancel();
      // La cronologia è in pausa dall'anteprima: si torna alla scena di partenza e si applica il risultato in un solo passo
      sceneStore.setState({ scene: base });
      sceneStore.temporal.getState().resume();
      labelled('Pattern', () => sceneStore.setState({ scene: final.scene, selection: [final.groupId] }));
      set({ ...INITIAL });
    },

    setParams: (patch) => {
      const { params } = get();
      if (!params) return;
      set({ params: normalizePattern({ ...params, ...patch }) });
      rebuild();
    },

    setPicking: (picking) => {
      const { targetId, base } = get();
      if (!get().active || !targetId || !base) return;
      set({ picking, hover: null });
      if (picking) {
        // Durante la scelta la vista mostra il pezzo intero: si cliccano le sue facce, non le pareti delle celle
        sceneStore.setState({ scene: base, selection: [targetId] });
      } else {
        rebuild();
      }
    },

    setSimplified: (simplified) => {
      set({ simplified });
      rebuild();
    },

    setHover: (hover) => {
      const current = get().hover;
      // Stessa faccia: niente aggiornamento (il puntatore si muove di continuo)
      if (current?.mesh === hover?.mesh && current?.face === hover?.face) return;
      set({ hover });
    },

    pickFace: (mesh, face) => {
      const { params, targetId, base } = get();
      const info = faceMap(mesh).faces[face];
      if (!params || !info || !targetId || !base || !mesh.path.includes(targetId)) return;
      if (!info.planar) {
        set({ error: 'Scegli una faccia piana.' });
        return;
      }
      const world = worldTransform(base, targetId);
      // Normale e un punto del piano, dal mondo al sistema del gruppo
      const normal = worldToLocal(world, info.normal, false);
      const point = worldToLocal(world, info.normal.map((c) => c * info.offset) as Vec3, true);
      const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
      const picked: PatternFace = { origin: point.map(round) as Vec3, normal: normal.map(round) as Vec3, thickness: round(thicknessAlong(params.bounds, normal)) };
      // La faccia scelta sostituisce le precedenti: per forare altre facce si applica di nuovo il Pattern
      set({ params: normalizePattern({ ...params, faces: [picked], region: 'face' }), picking: false, hover: null, error: null });
      rebuild();
    },
  };
});
