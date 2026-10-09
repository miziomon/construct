import { apply, eulerToMatrix, matrixToEuler, mul, round } from './math';
import type { Mat3 } from './math';
import { rotationToDown } from './layFlat';
import type { Vec3 } from './types';

/**
 * Sdraia: calcoli puri. Un oggetto in piedi (asse Z locale verticale, come un profilato appena creato) si sdraia
 * con la lunghezza lungo X; una seconda volta gira di 90° attorno a Z e si mette lungo Y; la terza volta torna in
 * piedi. Chi chiama lo riappoggia poi sul piatto (queueDropToBed).
 */

/** Rotazione di 90° attorno all'asse Y del mondo: porta +Z su +X. */
const ROT_Y: Mat3 = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]];
/** Rotazione di 90° attorno all'asse Z del mondo: porta +X su +Y. */
const ROT_Z: Mat3 = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];

/** Direzione nel mondo dell'asse Z locale dell'oggetto. */
const localUp = (rotation: Vec3): Vec3 => apply(eulerToMatrix(rotation), [0, 0, 1]);

/** Passo del ciclo in cui si trova l'oggetto: in piedi, lungo X, oppure altro (lungo Y o inclinato). */
export function layDownState(rotation: Vec3): 'upright' | 'alongX' | 'other' {
  const dz = localUp(rotation);
  if (Math.abs(dz[2]) > 0.9) return 'upright';
  if (Math.abs(dz[0]) > 0.9) return 'alongX';
  return 'other';
}

/**
 * Nuova posizione e rotazione per il prossimo passo del ciclo, ruotando attorno a `center` (il centro dell'ingombro),
 * così l'oggetto resta dov'è. Come in layFlatPatch la rotazione del mondo si applica a sinistra.
 */
export function layDownStep(node: { position: Vec3; rotation: Vec3 }, center: Vec3): { position: Vec3; rotation: Vec3 } {
  const state = layDownState(node.rotation);
  // In piedi: si sdraia lungo X; lungo X: gira lungo Y; altrimenti si rimette in piedi (l'asse Z locale torna su +Z)
  const dz = localUp(node.rotation);
  const q: Mat3 = state === 'upright' ? ROT_Y : state === 'alongX' ? ROT_Z : rotationToDown([-dz[0], -dz[1], -dz[2]]);
  const rotation = matrixToEuler(mul(q, eulerToMatrix(node.rotation))).map((v) => round(v, 4)) as Vec3;
  const offset: Vec3 = [node.position[0] - center[0], node.position[1] - center[1], node.position[2] - center[2]];
  const turned = apply(q, offset);
  return { position: [0, 1, 2].map((i) => round(center[i] + turned[i], 4)) as Vec3, rotation };
}
