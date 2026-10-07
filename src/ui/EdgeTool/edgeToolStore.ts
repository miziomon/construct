import { create } from 'zustand';
import type { NodeMesh } from '../../kernel/evaluate';
import { labelled, useSceneStore } from '../../scene/store';
import { useMeasure } from '../Measure/measureStore';
import { useLayFlat } from '../LayFlat/layFlatStore';
import { useArrayTool } from '../Array/arrayToolStore';
import { usePatternTool } from '../Pattern/patternToolStore';
import {
  buildCornerTreatment,
  buildEdgeTreatment,
  cornerData,
  defaultCornerDistance,
  defaultEdgeParams,
  edgeBetween,
  faceMap,
  type CornerGeometry,
  type CornerParams,
  type EdgeGeometry,
  type EdgeParams,
} from '../../scene/edgeTool';
import { effectiveDistance } from '../../scene/cornerProfile';
import { lastTool, lastToolNumber, rememberTool } from '../../scene/lastValues';
import { CORNER_SPHERE_SEGMENTS } from '../../scene/defaults';
import { chamferSecondDistance, EDGE_SEGMENTS, maxFilletRadius } from '../../scene/edgeProfile';
import type { Scene } from '../../scene/types';

/** Strumento Raccordo, Smusso o Smusso angolare: stato della selezione (facce o vertice), delle opzioni e dell'anteprima. */

export type ToolKind = 'fillet' | 'chamfer' | 'corner';

/** Smusso angolare: taglio piatto (Piano) o calotta arrotondata (Sferico). */
export type CornerType = 'chamfer' | 'fillet';

/** Un vertice scelto, con la mesh da cui viene (coordinate mondo). */
export interface CornerPick {
  mesh: NodeMesh;
  vertex: number;
}

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
  /** Raccordo: segmenti del cerchio intero (come $fn di OpenSCAD). */
  segments: number;

  /** Smusso angolare: vertici scelti (tutti dello stesso oggetto), vertice sotto il puntatore e geometria di ogni angolo. */
  cornerPicks: CornerPick[];
  hoverCorner: CornerPick | null;
  corners: CornerGeometry[];
  cornerType: CornerType;
  /** Distanza dal vertice lungo gli spigoli, in mm. */
  cornerDistance: number;
  /** Smusso angolare sferico: segmenti della sfera (multipli di 4). */
  cornerSegments: number;

  /** Scena prima dell'anteprima: serve a ripristinarla e a registrare un solo passo di Annulla. */
  base: Scene | null;
  /** Anteprima in scena: gruppo e taglierino creati. */
  preview: { groupId: string; edgeIds: string[] } | null;

  start: (tool: ToolKind) => void;
  cancel: () => void;
  commit: () => void;
  /** Azzera le facce scelte e toglie l'anteprima, restando nello strumento. */
  changeFaces: () => void;
  setHover: (pick: FacePick | null) => void;
  pickFace: (mesh: NodeMesh, face: number) => void;
  setHoverCorner: (pick: CornerPick | null) => void;
  /** Con `additive` (Maiusc) il vertice si aggiunge o si toglie dalla scelta; altrimenti sostituisce la scelta. L'anteprima si aggiorna subito. */
  pickCorner: (mesh: NodeMesh, vertex: number, additive?: boolean) => void;
  setOption: (
    patch: Partial<Pick<EdgeToolState, 'radius' | 'distance1' | 'distance2' | 'angle' | 'chamferMode' | 'segments' | 'cornerType' | 'cornerDistance' | 'cornerSegments'>>,
  ) => void;
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
  segments: EDGE_SEGMENTS,
  cornerPicks: [] as CornerPick[],
  hoverCorner: null,
  corners: [] as CornerGeometry[],
  cornerType: 'chamfer' as CornerType,
  cornerDistance: 2,
  cornerSegments: CORNER_SPHERE_SEGMENTS,
};

const sceneStore = useSceneStore;

/** Ultimo valore usato, portato dentro il limite della geometria scelta; senza un valore ricordato, quello predefinito. */
function remembered(last: number | undefined, limit: number, fallback: number): number {
  return last === undefined ? fallback : Math.round(Math.max(0.1, Math.min(last, limit)) * 100) / 100;
}

/** Impostazioni (non misure) ricordate dall'ultimo uso: tipo di smusso, angolo, segmenti, tipo di smusso angolare. */
function rememberedOptions(): Partial<Pick<EdgeToolState, 'angle' | 'chamferMode' | 'segments' | 'cornerType' | 'cornerSegments'>> {
  const last = lastTool('edge');
  return {
    ...(typeof last.angle === 'number' ? { angle: last.angle } : {}),
    ...(typeof last.chamferMode === 'string' ? { chamferMode: last.chamferMode as ChamferMode } : {}),
    ...(typeof last.segments === 'number' ? { segments: last.segments } : {}),
    ...(typeof last.cornerType === 'string' ? { cornerType: last.cornerType as CornerType } : {}),
    ...(typeof last.cornerSegments === 'number' ? { cornerSegments: last.cornerSegments } : {}),
  };
}

/** Misure da applicare, secondo il tipo di smusso e i limiti delle facce. */
export function currentParams(state: EdgeToolState): EdgeParams {
  // Questa funzione serve a Raccordo e Smusso; lo smusso angolare ha le sue misure (`cornerParams`)
  const treatment = state.tool === 'chamfer' ? 'chamfer' : 'fillet';
  const g = state.geometry;
  const maxDistance = g ? g.reach : Infinity;
  const radius = Math.min(state.radius, g ? maxFilletRadius(g) : Infinity);
  const distance1 = Math.min(state.distance1, maxDistance);
  const second =
    state.chamferMode === 'equal' ? distance1 : state.chamferMode === 'two' ? state.distance2 : chamferSecondDistance(distance1, state.angle, g?.angle ?? 90);
  return { treatment, radius, distance1, distance2: Math.min(second, maxDistance), segments: state.segments };
}

/** Misure dello smusso angolare da applicare: la distanza non supera lo spigolo più corto. */
export function cornerParams(state: EdgeToolState): CornerParams {
  // Stessa distanza per tutti i vertici: non supera lo spigolo più corto tra quelli di tutti gli angoli scelti
  const distance = state.corners.length ? effectiveDistance({ distance: state.cornerDistance, lengths: state.corners.flatMap((c) => c.lengths) }) : state.cornerDistance;
  return { treatment: state.cornerType, distance, segments: state.cornerSegments };
}

export const useEdgeTool = create<EdgeToolState>()((set, get) => {
  /** Crea (o ricrea) l'anteprima sulla scena di partenza. La cronologia resta in pausa finché lo strumento è aperto. */
  const rebuild = () => {
    const state = get();
    // Smusso angolare: il pezzo è quello del vertice scelto; Raccordo e Smusso: quello delle facce scelte
    const isCorner = state.tool === 'corner';
    const target = isCorner ? state.cornerPicks[0]?.mesh.id : state.picks[0]?.mesh.id;
    // Tolti tutti i vertici scelti si torna alla scena di partenza, senza anteprima
    if (isCorner && state.corners.length === 0 && state.base) {
      sceneStore.setState({ scene: state.base, selection: [] });
      set({ preview: null });
      return;
    }
    if (!target || (isCorner ? state.corners.length === 0 : !state.geometry)) return;
    let base = state.base;
    if (!base) {
      base = sceneStore.getState().scene;
      sceneStore.temporal.getState().pause();
      set({ base });
    }
    const result = isCorner ? buildCornerTreatment(base, target, state.corners, cornerParams(state)) : buildEdgeTreatment(base, target, state.geometry!, currentParams(state));
    if (!result.ok) {
      sceneStore.setState({ scene: base });
      set({ error: result.error, preview: null });
      return;
    }
    sceneStore.setState({ scene: result.scene, selection: [] });
    set({ preview: { groupId: result.groupId, edgeIds: result.edgeIds }, error: null });
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
      // Un solo strumento alla volta: la Misura aperta si chiude
      useMeasure.getState().cancel();
      useLayFlat.getState().cancel();
      useArrayTool.getState().cancel();
      usePatternTool.getState().cancel();
      sceneStore.getState().select([]);
      sceneStore.getState().setGizmoMode('select');
      set({ ...INITIAL, ...rememberedOptions(), tool });
    },

    cancel: () => {
      restore();
      set({ ...INITIAL });
    },

    commit: () => {
      const { preview, base, tool, cornerType } = get();
      if (!preview || !base) return get().cancel();
      // La cronologia è in pausa dall'anteprima: si torna alla scena di partenza e si applica il risultato in un solo passo
      const after = sceneStore.getState().scene;
      sceneStore.setState({ scene: base });
      sceneStore.temporal.getState().resume();
      const label = tool === 'corner' ? (cornerType === 'fillet' ? 'Raccordo angolare' : 'Smusso angolare') : tool === 'fillet' ? 'Raccordo' : 'Smusso';
      labelled(label, () => sceneStore.setState({ scene: after, selection: preview.edgeIds }));
      set({ ...INITIAL });
    },

    changeFaces: () => {
      const { base } = get();
      if (base) sceneStore.setState({ scene: base, selection: [] });
      set({ picks: [], geometry: null, cornerPicks: [], corners: [], preview: null, error: null });
    },

    setHover: (pick) => {
      const current = get().hover;
      if (current?.mesh === pick?.mesh && current?.face === pick?.face) return;
      set({ hover: pick });
    },

    pickFace: (mesh, face) => {
      const state = get();
      if (!state.tool || state.tool === 'corner' || state.preview || face < 0) return;
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
      // Le misure usate l'ultima volta, se ci sono, dentro i limiti di questo spigolo
      set({
        geometry: result.geometry,
        radius: remembered(lastToolNumber('edge', 'radius'), maxFilletRadius(result.geometry), defaults.radius),
        distance1: remembered(lastToolNumber('edge', 'distance1'), result.geometry.reach, defaults.distance1),
        distance2: remembered(lastToolNumber('edge', 'distance2'), result.geometry.reach, defaults.distance2),
      });
      rebuild();
    },

    setHoverCorner: (pick) => {
      const current = get().hoverCorner;
      if (current?.mesh === pick?.mesh && current?.vertex === pick?.vertex) return;
      set({ hoverCorner: pick });
    },

    pickCorner: (mesh, vertex, additive = false) => {
      const state = get();
      // I vertici si scelgono sempre sulla mesh di partenza (anche con l'anteprima aperta: vedi CornerPickProxy)
      if (state.tool !== 'corner' || vertex < 0) return;
      // Con Maiusc un vertice già scelto si toglie
      if (additive) {
        const at = state.cornerPicks.findIndex((p) => p.mesh.id === mesh.id && p.vertex === vertex);
        if (at >= 0) {
          set({ cornerPicks: state.cornerPicks.filter((_, i) => i !== at), corners: state.corners.filter((_, i) => i !== at), error: null });
          rebuild();
          return;
        }
        if (state.cornerPicks.length > 0 && state.cornerPicks[0].mesh.id !== mesh.id) {
          set({ error: 'Tutti i vertici devono appartenere allo stesso oggetto.' });
          return;
        }
      }
      // Dati dell'angolo: spigoli, convessità, superfici piane. Un errore lascia scegliere di nuovo
      const result = cornerData(mesh, faceMap(mesh), vertex);
      if (!result.ok) {
        set(additive ? { error: result.error } : { error: result.error, cornerPicks: [], corners: [] });
        return;
      }
      const cornerPicks = additive ? [...state.cornerPicks, { mesh, vertex }] : [{ mesh, vertex }];
      const corners = additive ? [...state.corners, result.geometry] : [result.geometry];
      // Distanza iniziale ragionevole per l'angolo più stretto tra quelli scelti
      const shortest = Math.min(...corners.flatMap((c) => c.lengths));
      set({
        cornerPicks,
        corners,
        // L'ultima distanza usata, se c'è, non oltre lo spigolo più corto
        cornerDistance: remembered(lastToolNumber('edge', 'cornerDistance'), shortest, Math.min(...corners.map(defaultCornerDistance))),
        error: null,
      });
      rebuild();
    },

    setOption: (patch) => {
      set(patch);
      // Quello che l'utente imposta nel pannello è il punto di partenza della prossima volta
      rememberTool('edge', patch);
      if (get().preview) rebuild();
    },
  };
});
