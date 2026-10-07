import { apply, eulerToMatrix, round } from './math';
import type { ArrayParams, Vec3 } from './types';

/**
 * Ripetizione (serie di copie): calcoli puri condivisi da kernel, generatore OpenSCAD, pannello e test. Una Ripetizione è
 * un gruppo con un solo figlio (l'originale) e questi parametri: le copie non esistono come oggetti ma si calcolano
 * da qui, così si modificano i parametri e non le singole copie.
 */

/** Numero massimo di copie (originale compreso): più copie rallentano l'unione e non servono a un piatto da 256 mm. */
export const ARRAY_MAX_COPIES = 200;

/** Misura dell'oggetto nel sistema del gruppo (centrato sull'origine del gruppo) per scegliere valori di partenza sensati. */
export interface ObjectSize {
  /** Lati dell'ingombro in X, Y, Z (mm). */
  size: Vec3;
}

/** Parametri di partenza per un oggetto di questa misura: cinque copie in fila lungo X con un po' d'aria tra l'una e l'altra. */
export function defaultArrayParams(object?: ObjectSize): ArrayParams {
  const [sx, sy, sz] = object?.size ?? [20, 20, 20];
  const gap = (side: number) => Math.max(1, round(side + Math.max(2, side * 0.25), 1));
  return {
    kind: 'linear',
    count: 5,
    step: [gap(sx), 0, 0],
    spacing: 'step',
    counts: [3, 3, 1],
    gridStep: [gap(sx), gap(sy), gap(sz)],
    axis: 2,
    angle: 360,
    // Asse di rotazione a sinistra dell'oggetto, a metà tra le sue copie e una distanza pari a una volta e mezzo il lato
    center: [-round(sx / 2 + Math.max(10, sx), 1), 0, 0],
    rotateCopies: true,
    includeOriginal: true,
  };
}

/** Parametri con valori entro i limiti: interi per i conteggi, al massimo `ARRAY_MAX_COPIES` copie, angolo tra 1° e 360°. */
export function normalizeArray(p: ArrayParams): ArrayParams {
  const int = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
  const finite = (v: Vec3): Vec3 => v.map((x) => (Number.isFinite(x) ? x : 0)) as Vec3;
  // Griglia: il prodotto dei tre conteggi non supera il massimo (si riduce prima Z, poi Y, poi X)
  const counts = p.counts.map((c) => int(c, 1, ARRAY_MAX_COPIES)) as Vec3;
  for (const axis of [2, 1, 0]) {
    while (counts[0] * counts[1] * counts[2] > ARRAY_MAX_COPIES && counts[axis] > 1) counts[axis]--;
  }
  return {
    ...p,
    count: int(p.count, 1, ARRAY_MAX_COPIES),
    step: finite(p.step),
    gridStep: finite(p.gridStep),
    counts,
    angle: Math.min(360, Math.max(1, Number.isFinite(p.angle) ? p.angle : 360)),
    center: finite(p.center),
    axis: p.axis === 0 || p.axis === 1 ? p.axis : 2,
  };
}

/** Passo effettivo di una serie lineare: `step` è il passo tra due copie oppure lo spazio dalla prima all'ultima. */
export function linearStep(p: ArrayParams): Vec3 {
  if (p.spacing === 'total' && p.count > 1) return p.step.map((v) => v / (p.count - 1)) as Vec3;
  return p.step;
}

/** Angolo tra due copie di una serie circolare: giro completo diviso le copie; un arco, dalla prima all'ultima copia. */
export function circularStep(p: ArrayParams): number {
  if (p.angle >= 360) return 360 / Math.max(1, p.count);
  return p.count > 1 ? p.angle / (p.count - 1) : 0;
}

/** Quante copie produce la serie (originale compreso se `includeOriginal`). */
export function arrayCopyCount(p: ArrayParams): number {
  const n = normalizeArray(p);
  if (n.kind === 'grid') return n.counts[0] * n.counts[1] * n.counts[2];
  return n.includeOriginal ? n.count : Math.max(0, n.count - 1);
}

/**
 * Trasformazione di una copia nel sistema del gruppo: `x' = pivot + R(rotation)·(x − pivot) + translate`. Le serie lineari
 * e a griglia traslano; la circolare ruota attorno al pivot, oppure (copie non ruotate) trasla di `(I − R)·pivot`, che è
 * lo spostamento dell'originale lungo la stessa circonferenza.
 */
export interface CopyTransform {
  translate: Vec3;
  pivot: Vec3;
  /** Rotazioni in gradi X, Y, Z (qui una sola non nulla: l'asse della serie circolare). */
  rotation: Vec3;
}

/** Tutte le copie della serie, nell'ordine di creazione (la prima è l'originale se `includeOriginal`). */
export function arrayCopies(params: ArrayParams): CopyTransform[] {
  const p = normalizeArray(params);
  const none: Vec3 = [0, 0, 0];
  if (p.kind === 'grid') {
    const out: CopyTransform[] = [];
    for (let i = 0; i < p.counts[0]; i++)
      for (let j = 0; j < p.counts[1]; j++)
        for (let k = 0; k < p.counts[2]; k++) out.push({ translate: [i * p.gridStep[0], j * p.gridStep[1], k * p.gridStep[2]], pivot: none, rotation: none });
    return out;
  }
  const first = p.includeOriginal ? 0 : 1;
  const out: CopyTransform[] = [];
  if (p.kind === 'linear') {
    const d = linearStep(p);
    for (let i = first; i < p.count; i++) out.push({ translate: [i * d[0], i * d[1], i * d[2]], pivot: none, rotation: none });
    return out;
  }
  const step = circularStep(p);
  for (let i = first; i < p.count; i++) {
    const rotation: Vec3 = [0, 0, 0];
    rotation[p.axis] = i * step;
    if (p.rotateCopies) out.push({ translate: none, pivot: p.center, rotation });
    else {
      // L'oggetto percorre la circonferenza senza ruotare su se stesso: (I − R)·c
      const turned = apply(eulerToMatrix(rotation), p.center);
      out.push({ translate: [p.center[0] - turned[0], p.center[1] - turned[1], p.center[2] - turned[2]], pivot: none, rotation: none });
    }
  }
  return out;
}

/** Vero se la trasformazione non sposta nulla. */
export const isIdentityCopy = (t: CopyTransform) => t.translate.every((v) => v === 0) && t.rotation.every((v) => v === 0);
