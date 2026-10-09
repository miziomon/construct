import { boundsByRoot } from '../kernel/placement';
import { useSceneStore } from '../scene/store';
import type { Bounds } from '../scene/placement';
import type { Vec3 } from '../scene/types';
import { useUiStore } from '../ui/uiStore';

/**
 * Viste della camera: preset (alto, fronte, lato, isometrica), Inquadra e proiezione ortografica. I calcoli sono puri
 * (usati anche dai test); il componente CameraRig dentro il Canvas registra qui le azioni, così barra, menu e
 * scorciatoie muovono la camera senza toccare React Three Fiber.
 */

export type ViewPreset = 'top' | 'front' | 'side' | 'iso';

export type Projection = 'perspective' | 'orthographic';

/** Angolo di campo verticale della camera prospettica (gradi), lo stesso del Canvas. */
export const CAMERA_FOV = 38;

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Direzione (unitaria) dal centro inquadrato verso la camera, per ogni preset. Dall'alto la direzione non è
 * esattamente verticale: con la camera allineata all'asse Z (che è "l'alto" della scena) i controlli perderebbero
 * l'orientamento, quindi si lascia un'inclinazione impercettibile verso il fronte.
 */
export const PRESET_DIRECTIONS: Record<ViewPreset, Vec3> = {
  top: normalize([0, -0.001, 1]),
  front: [0, -1, 0],
  side: [1, 0, 0],
  iso: normalize([1, -1, 0.8]),
};

export const PRESET_LABELS: Record<ViewPreset, string> = { top: 'Alto', front: 'Fronte', side: 'Lato', iso: 'Isometrica' };

/** Distanza della camera prospettica per far entrare una sfera di raggio `radius` nell'altezza della vista (con un po' di margine). */
export function fitDistance(radius: number, fovDegrees = CAMERA_FOV): number {
  return (Math.max(radius, 1) * 1.15) / Math.sin((fovDegrees * Math.PI) / 360);
}

/** Zoom della camera ortografica che mostra la stessa altezza di scena che la prospettica vede a `distance` dal centro. */
export function orthoZoom(viewportHeight: number, distance: number, fovDegrees = CAMERA_FOV): number {
  return viewportHeight / (2 * distance * Math.tan((fovDegrees * Math.PI) / 360));
}

/** Inverso di `orthoZoom`: la distanza a cui la prospettica vede la stessa altezza di scena di un'ortografica a `zoom`. */
export function distanceFromZoom(viewportHeight: number, zoom: number, fovDegrees = CAMERA_FOV): number {
  return viewportHeight / (2 * zoom * Math.tan((fovDegrees * Math.PI) / 360));
}

/** Centro e raggio della sfera che contiene l'ingombro. */
export function boundingSphere(b: Bounds): { center: Vec3; radius: number } {
  const center = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2) as Vec3;
  const radius = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
  return { center, radius };
}

/** Unione di più ingombri (null se la lista è vuota). */
function unionOf(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  return list.reduce((a, b) => ({ min: a.min.map((v, i) => Math.min(v, b.min[i])) as Vec3, max: a.max.map((v, i) => Math.max(v, b.max[i])) as Vec3 }));
}

/**
 * Cosa inquadrare: la selezione (gli oggetti alla radice selezionati, o quelli che contengono la selezione), oppure
 * tutta la scena, oppure il piatto se la scena è vuota. `rootsOf` dà gli ingombri per radice (dal kernel).
 */
export function viewBounds(input: { selection: string[]; rootIds: string[]; boundsByRoot: Record<string, Bounds>; bed: { width: number; depth: number } }, selectionOnly: boolean): Bounds {
  const { selection, rootIds, bed } = input;
  const roots = (ids: string[]) => ids.filter((id) => rootIds.includes(id) && input.boundsByRoot[id]).map((id) => input.boundsByRoot[id]);
  const selected = selectionOnly ? unionOf(roots(selection)) : null;
  const all = unionOf(roots(rootIds));
  return selected ?? all ?? { min: [-bed.width / 2, -bed.depth / 2, 0], max: [bed.width / 2, bed.depth / 2, 0] };
}

/** Azioni sulla camera, registrate dal componente dentro il Canvas. */
export interface CameraApi {
  setPreset: (preset: ViewPreset) => void;
  fit: (bounds: Bounds) => void;
}

let api: CameraApi | null = null;

/** Registra le azioni della camera (dal rig); restituisce la funzione che le toglie. */
export function registerCamera(next: CameraApi): () => void {
  api = next;
  return () => {
    if (api === next) api = null;
  };
}

/** Porta la camera su un preset, mantenendo il centro inquadrato e la distanza. */
export function setViewPreset(preset: ViewPreset): void {
  api?.setPreset(preset);
}

/** Inquadra la selezione (se c'è e `selectionOnly`), altrimenti tutta la scena, altrimenti il piatto. */
export function fitView(selectionOnly: boolean): void {
  const { scene, selection } = useSceneStore.getState();
  const bounds = viewBounds({ selection, rootIds: scene.rootIds, boundsByRoot: boundsByRoot(), bed: useUiStore.getState().bedSize }, selectionOnly);
  api?.fit(bounds);
}

/** Alterna prospettica e ortografica (il rig applica il cambio leggendo lo store). */
export function toggleProjection(): void {
  useUiStore.getState().toggleProjection();
}
