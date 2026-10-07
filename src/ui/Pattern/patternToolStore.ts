import { create } from 'zustand';
import type { NodeMesh } from '../../kernel/evaluate';
import { useResultStore } from '../../kernel/useKernel';
import { faceMap } from '../../scene/edgeTool';
import { defaultPatternParams, thicknessAlong } from '../../scene/pattern';
import { applyPattern, worldToLocal } from '../../scene/patternTool';
import { localBounds } from '../../scene/shell';
import { isLocked, labelled, useSceneStore, worldTransform } from '../../scene/store';
import { isCutter } from '../../scene/treatment';
import type { PatternParams, Scene, Vec3 } from '../../scene/types';

/** Faccia sotto il puntatore mentre si sceglie la faccia da cui applicare il pattern. */
export interface PatternHover {
  mesh: NodeMesh;
  face: number;
}

/**
 * Strumento Pattern: applica un disegno (Voronoi casuale, esagoni, cerchi) o un reticolo 3D all'oggetto selezionato.
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
  /** Scelta della faccia con il clic sull'oggetto in corso, e faccia sotto il puntatore. */
  picking: boolean;
  hover: PatternHover | null;

  start: () => void;
  cancel: () => void;
  commit: () => void;
  setParams: (patch: Partial<PatternParams>) => void;
  setPicking: (picking: boolean) => void;
  setHover: (hover: PatternHover | null) => void;
  /** Usa la faccia piana cliccata (della mesh in anteprima) come faccia di partenza del pattern. */
  pickFace: (mesh: NodeMesh, face: number) => void;
}

const INITIAL = { active: false, targetId: null, params: null, error: null, base: null, groupId: null, picking: false, hover: null };

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

export const usePatternTool = create<PatternToolState>()((set, get) => {
  /** Ricrea l'anteprima sulla scena di partenza, con i parametri correnti. */
  const rebuild = () => {
    const { targetId, params } = get();
    if (!targetId || !params) return;
    let base = get().base;
    if (!base) {
      // Prima anteprima: si ricorda la scena di partenza e si mette in pausa la cronologia
      base = sceneStore.getState().scene;
      sceneStore.temporal.getState().pause();
      set({ base });
    }
    const result = applyPattern(base, targetId, params);
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
      set({ ...INITIAL, active: true, targetId, params: defaultPatternParams(bounds, seed) });
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
      const { groupId, base } = get();
      if (!groupId || !base) return get().cancel();
      // La cronologia è in pausa dall'anteprima: si torna alla scena di partenza e si applica il risultato in un solo passo
      const after = sceneStore.getState().scene;
      sceneStore.setState({ scene: base });
      sceneStore.temporal.getState().resume();
      labelled('Pattern', () => sceneStore.setState({ scene: after, selection: [groupId] }));
      set({ ...INITIAL });
    },

    setParams: (patch) => {
      const { params } = get();
      if (!params) return;
      set({ params: { ...params, ...patch } });
      rebuild();
    },

    setPicking: (picking) => set({ picking, hover: null }),

    setHover: (hover) => {
      const current = get().hover;
      // Stessa faccia: niente aggiornamento (il puntatore si muove di continuo)
      if (current?.mesh === hover?.mesh && current?.face === hover?.face) return;
      set({ hover });
    },

    pickFace: (mesh, face) => {
      const { groupId, params } = get();
      const info = faceMap(mesh).faces[face];
      if (!groupId || !params || !info || !mesh.path.includes(groupId)) return;
      const world = worldTransform(sceneStore.getState().scene, groupId);
      // Normale e un punto del piano, dal mondo al sistema del gruppo
      const normal = worldToLocal(world, info.normal, false);
      const point = worldToLocal(world, info.normal.map((c) => c * info.offset) as Vec3, true);
      const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
      set({ picking: false, hover: null });
      get().setParams({
        face: { origin: point.map(round) as Vec3, normal: normal.map(round) as Vec3, thickness: round(thicknessAlong(params.bounds, normal)) },
      });
    },
  };
});
