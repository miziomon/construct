import { create } from 'zustand';
import type { NodeMesh } from '../../kernel/evaluate';
import { useSceneStore } from '../../scene/store';
import { buildEdgeTreatment, defaultEdgeParams, edgeBetween, faceMap, type EdgeGeometry, type EdgeParams } from '../../scene/edgeTool';
import { chamferSecondDistance, maxFilletRadius } from '../../scene/edgeProfile';
import type { Scene } from '../../scene/types';

/** Strumento Raccordo o Smusso: stato della selezione delle facce, delle opzioni e dell'anteprima. */

export type ToolKind = 'fillet' | 'chamfer';

/** Smusso: due distanze uguali, due distanze diverse, oppure una distanza e l'angolo con la prima faccia. */
export type ChamferMode = 'equal' | 'two' | 'angle';

/** Una faccia scelta, con la mesh da cui viene (coordinate mondo). */
export interface FacePick {
  mesh: NodeMesh;
  face: number;
}

interface EdgeToolState {
  tool: ToolKind | null;
  picks: FacePick[];
  hover: FacePick | null;
  geometry: EdgeGeometry | null;
  error: string | null;

  radius: number;
  distance1: number;
  distance2: number;
  /** Smusso "distanza e angolo": angolo con la prima faccia, in gradi. */
  angle: number;
  chamferMode: ChamferMode;

  /** Scena prima dell'anteprima: serve a ripristinarla e a registrare un solo passo di Annulla. */
  base: Scene | null;
  /** Anteprima in scena: gruppo e taglierino creati. */
  preview: { groupId: string; edgeId: string } | null;

  start: (tool: ToolKind) => void;
  cancel: () => void;
  commit: () => void;
  /** Azzera le facce scelte e toglie l'anteprima, restando nello strumento. */
  changeFaces: () => void;
  setHover: (pick: FacePick | null) => void;
  pickFace: (mesh: NodeMesh, face: number) => void;
  setOption: (patch: Partial<Pick<EdgeToolState, 'radius' | 'distance1' | 'distance2' | 'angle' | 'chamferMode'>>) => void;
}

const INITIAL = {
  tool: null,
  picks: [],
  hover: null,
  geometry: null,
  error: null,
  base: null,
  preview: null,
  radius: 2,
  distance1: 2,
  distance2: 2,
  angle: 45,
  chamferMode: 'equal' as ChamferMode,
};

const sceneStore = useSceneStore;

/** Misure da applicare, secondo il tipo di smusso e i limiti delle facce. */
export function currentParams(state: EdgeToolState): EdgeParams {
  const treatment = state.tool ?? 'fillet';
  const g = state.geometry;
  const maxDistance = g ? g.reach : Infinity;
  const radius = Math.min(state.radius, g ? maxFilletRadius(g) : Infinity);
  const distance1 = Math.min(state.distance1, maxDistance);
  const second =
    state.chamferMode === 'equal' ? distance1 : state.chamferMode === 'two' ? state.distance2 : chamferSecondDistance(distance1, state.angle, g?.angle ?? 90);
  return { treatment, radius, distance1, distance2: Math.min(second, maxDistance) };
}

export const useEdgeTool = create<EdgeToolState>()((set, get) => {
  /** Crea (o ricrea) l'anteprima sulla scena di partenza. La cronologia resta in pausa finché lo strumento è aperto. */
  const rebuild = () => {
    const state = get();
    const target = state.picks[0]?.mesh.id;
    if (!state.geometry || !target) return;
    let base = state.base;
    if (!base) {
      base = sceneStore.getState().scene;
      sceneStore.temporal.getState().pause();
      set({ base });
    }
    const result = buildEdgeTreatment(base, target, state.geometry, currentParams(state));
    if (!result.ok) {
      sceneStore.setState({ scene: base });
      set({ error: result.error, preview: null });
      return;
    }
    sceneStore.setState({ scene: result.scene, selection: [] });
    set({ preview: { groupId: result.groupId, edgeId: result.edgeId }, error: null });
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

    start: (tool) => {
      if (get().tool) get().cancel();
      sceneStore.getState().select([]);
      sceneStore.getState().setGizmoMode('select');
      set({ ...INITIAL, tool });
    },

    cancel: () => {
      restore();
      set({ ...INITIAL });
    },

    commit: () => {
      const { preview, base } = get();
      if (!preview || !base) return get().cancel();
      // La cronologia è in pausa dall'anteprima: si torna alla scena di partenza e si applica il risultato in un solo passo
      const after = sceneStore.getState().scene;
      sceneStore.setState({ scene: base });
      sceneStore.temporal.getState().resume();
      sceneStore.setState({ scene: after, selection: [preview.edgeId] });
      set({ ...INITIAL });
    },

    changeFaces: () => {
      const { base } = get();
      if (base) sceneStore.setState({ scene: base, selection: [] });
      set({ picks: [], geometry: null, preview: null, error: null });
    },

    setHover: (pick) => {
      const current = get().hover;
      if (current?.mesh === pick?.mesh && current?.face === pick?.face) return;
      set({ hover: pick });
    },

    pickFace: (mesh, face) => {
      const state = get();
      if (!state.tool || state.preview || face < 0) return;
      // Una faccia già scelta si toglie con un nuovo clic
      const already = state.picks.findIndex((p) => p.mesh === mesh && p.face === face);
      if (already >= 0) {
        set({ picks: state.picks.filter((_, i) => i !== already), geometry: null, error: null });
        return;
      }
      if (state.picks.length > 0 && state.picks[0].mesh.id !== mesh.id) {
        set({ error: 'Le due superfici devono appartenere allo stesso oggetto.' });
        return;
      }
      if (state.picks.length >= 2) return;
      const picks = [...state.picks, { mesh, face }];
      set({ picks, error: null });
      if (picks.length < 2) return;

      const result = edgeBetween(mesh, faceMap(mesh), picks[0].face, picks[1].face);
      if (!result.ok) {
        // La seconda scelta non va bene: si tiene la prima e si lascia scegliere di nuovo
        set({ picks: [picks[0]], geometry: null, error: result.error });
        return;
      }
      // Misure iniziali ragionevoli per questo spigolo, poi anteprima
      const defaults = defaultEdgeParams(state.tool, result.geometry);
      set({ geometry: result.geometry, radius: defaults.radius, distance1: defaults.distance1, distance2: defaults.distance2 });
      rebuild();
    },

    setOption: (patch) => {
      set(patch);
      if (get().preview) rebuild();
    },
  };
});
