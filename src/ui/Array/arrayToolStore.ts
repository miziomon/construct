import { create } from 'zustand';
import { useResultStore } from '../../kernel/useKernel';
import { defaultArrayParams } from '../../scene/arrayPattern';
import { buildArray } from '../../scene/arrayTool';
import { localBounds } from '../../scene/shell';
import { isLocked, labelled, useSceneStore, worldTransform } from '../../scene/store';
import { isCutter } from '../../scene/treatment';
import type { ArrayParams, Scene } from '../../scene/types';

/**
 * Strumento Serie (Ripetizione): ripete l'oggetto selezionato in fila, in griglia o in cerchio. Stesso schema del Guscio:
 * mentre il pannello è aperto la cronologia è in pausa e l'anteprima vive nella scena (il gruppo vero); OK registra un
 * solo passo di Annulla.
 */
interface ArrayToolState {
  active: boolean;
  /** Oggetto da ripetere. */
  targetId: string | null;
  params: ArrayParams;
  /** Motivo per cui la serie non è applicabile. */
  error: string | null;
  /** Scena prima dell'anteprima: serve a ripristinarla e a registrare un solo passo di Annulla. */
  base: Scene | null;
  /** Gruppo Ripetizione creato dall'anteprima. */
  groupId: string | null;

  start: () => void;
  cancel: () => void;
  commit: () => void;
  setParams: (patch: Partial<ArrayParams>) => void;
}

const INITIAL = { active: false, targetId: null, params: defaultArrayParams(), error: null, base: null, groupId: null };

const sceneStore = useSceneStore;

/** Vero se la selezione è un solo oggetto che si può ripetere: non bloccato e non un raccordo o uno smusso. */
export function canArray(scene: Scene, selection: string[]): boolean {
  const node = selection.length === 1 ? scene.nodes[selection[0]] : undefined;
  return node !== undefined && !isCutter(node) && !isLocked(scene, node.id);
}

export const useArrayTool = create<ArrayToolState>()((set, get) => {
  /** Ricrea l'anteprima sulla scena di partenza, con i parametri correnti. */
  const rebuild = () => {
    const { targetId, params } = get();
    if (!targetId) return;
    let base = get().base;
    if (!base) {
      // Prima anteprima: si ricorda la scena di partenza e si mette in pausa la cronologia
      base = sceneStore.getState().scene;
      sceneStore.temporal.getState().pause();
      set({ base });
    }
    const result = buildArray(base, targetId, params);
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
      if (!targetId || !canArray(scene, selection)) return;

      // Misure dell'oggetto dal calcolo del kernel (nel suo sistema locale): servono a scegliere passo e raggio di partenza
      const meshes = useResultStore.getState().meshes.filter((m) => !m.empty && m.path.includes(targetId));
      const bounds = meshes.length ? localBounds(meshes, worldTransform(scene, targetId)) : null;
      const size = bounds ? ([0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]) as [number, number, number]) : undefined;

      set({ ...INITIAL, active: true, targetId, params: defaultArrayParams(size ? { size } : undefined) });
      rebuild();
    },

    cancel: () => {
      const { targetId } = get();
      restore();
      // Il gruppo dell'anteprima non esiste più: la selezione torna all'oggetto di partenza
      if (targetId && get().base) sceneStore.setState({ selection: [targetId] });
      set({ ...INITIAL });
    },

    commit: () => {
      const { groupId, base } = get();
      if (!groupId || !base) return get().cancel();
      // La cronologia è in pausa dall'anteprima: si torna alla scena di partenza e si applica il risultato in un solo passo
      const after = sceneStore.getState().scene;
      sceneStore.setState({ scene: base });
      sceneStore.temporal.getState().resume();
      labelled('Ripetizione', () => sceneStore.setState({ scene: after, selection: [groupId] }));
      set({ ...INITIAL });
    },

    setParams: (patch) => {
      set({ params: { ...get().params, ...patch } });
      rebuild();
    },
  };
});
