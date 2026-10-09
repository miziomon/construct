import { create } from 'zustand';
import { boundsByRoot } from '../../kernel/placement';
import { round } from '../../scene/math';
import type { Bounds } from '../../scene/placement';
import { buildSplit, canSplit } from '../../scene/splitTool';
import { labelled, useSceneStore } from '../../scene/store';
import type { Scene } from '../../scene/types';

/**
 * Strumento Dividi: taglia l'oggetto selezionato in due con un piano perpendicolare a un asse. Stesso schema del
 * Guscio: mentre il pannello è aperto la cronologia è in pausa e l'anteprima (le due metà) vive nella scena; OK
 * registra un solo passo di Annulla, Esc rimette tutto com'era.
 */

export type SplitAxis = 0 | 1 | 2;

interface SplitToolState {
  active: boolean;
  /** Oggetto da dividere. */
  targetId: string | null;
  /** Asse perpendicolare al piano (0 = X, 1 = Y, 2 = Z). */
  axis: SplitAxis;
  /** Quota del piano lungo l'asse, nel mondo (mm). */
  offset: number;
  /** Ingombro del pezzo nel mondo, dal kernel: limiti dello slider e misura del cubo di taglio. */
  bounds: Bounds | null;
  /** Motivo per cui il taglio non si applica (piano fuori dal pezzo). */
  error: string | null;
  /** Scena prima dell'anteprima: serve a ripristinarla e a registrare un solo passo di Annulla. */
  base: Scene | null;
  /** Le due metà create dall'anteprima. */
  ids: [string, string] | null;

  start: () => void;
  cancel: () => void;
  commit: () => void;
  setOption: (patch: Partial<Pick<SplitToolState, 'axis' | 'offset'>>) => void;
}

const INITIAL = { active: false, targetId: null, axis: 0 as SplitAxis, offset: 0, bounds: null, error: null, base: null, ids: null };

const sceneStore = useSceneStore;

// Lo store non importa gli altri strumenti (che importano lui per annullarlo): l'apertura sta in toggleSplit.ts
export { canSplit };

/** Quota centrale dell'ingombro lungo l'asse. */
const middle = (bounds: Bounds, axis: SplitAxis) => round((bounds.min[axis] + bounds.max[axis]) / 2, 2);

export const useSplitTool = create<SplitToolState>()((set, get) => {
  /** Ricrea l'anteprima sulla scena di partenza, con asse e quota correnti. */
  const rebuild = () => {
    const { targetId, axis, offset, bounds } = get();
    if (!targetId || !bounds) return;
    let base = get().base;
    if (!base) {
      // Prima anteprima: si ricorda la scena di partenza e si mette in pausa la cronologia
      base = sceneStore.getState().scene;
      sceneStore.temporal.getState().pause();
      set({ base });
    }
    const result = buildSplit(base, targetId, axis, offset, bounds);
    if (!result.ok) {
      sceneStore.setState({ scene: base, selection: [targetId] });
      set({ error: result.error, ids: null });
      return;
    }
    sceneStore.setState({ scene: result.scene, selection: [...result.ids] });
    set({ ids: result.ids, error: null });
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
      if (!targetId || !scene.nodes[targetId]) return;
      const bounds = boundsByRoot()[targetId];
      if (!bounds) return;
      // Si parte dal piano a metà dell'ingombro lungo X
      set({ ...INITIAL, active: true, targetId, bounds, axis: 0, offset: middle(bounds, 0) });
      rebuild();
    },

    cancel: () => {
      const { targetId } = get();
      restore();
      // Le metà dell'anteprima non esistono più: la selezione torna al pezzo di partenza
      if (targetId) sceneStore.setState({ selection: [targetId] });
      set({ ...INITIAL });
    },

    commit: () => {
      const { ids, base } = get();
      if (!ids || !base) return get().cancel();
      // La cronologia è in pausa dall'anteprima: si torna alla scena di partenza e si applica il risultato in un solo passo
      const after = sceneStore.getState().scene;
      sceneStore.setState({ scene: base });
      sceneStore.temporal.getState().resume();
      labelled('Dividi', () => sceneStore.setState({ scene: after, selection: [...ids] }));
      set({ ...INITIAL });
    },

    setOption: (patch) => {
      const { bounds, axis } = get();
      // Cambiando asse il piano torna a metà dell'ingombro su quell'asse
      const next = patch.axis !== undefined && patch.axis !== axis && bounds ? { ...patch, offset: middle(bounds, patch.axis) } : patch;
      set(next);
      rebuild();
    },
  };
});
