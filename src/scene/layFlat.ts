import { apply, eulerToMatrix, matrixToEuler, mul, round } from './math';
import type { Mat3 } from './math';
import type { Vec3 } from './types';

/**
 * Appoggia su una faccia: calcoli puri. La faccia scelta ha una normale uscente (in coordinate mondo): si ruota
 * l'oggetto perché quella normale punti verso il basso (-Z), così la faccia poggia sul piatto.
 */

const IDENTITY: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * Rotazione minima che porta la normale `normal` (anche non unitaria) su -Z, in coordinate mondo (formula di
 * Rodrigues). Normale già verso il basso: identità. Normale verso l'alto: mezzo giro attorno a X.
 */
export function rotationToDown(normal: Vec3): Mat3 {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length === 0) return IDENTITY;
  const [x, y, z] = normal.map((v) => v / length);
  // cos dell'angolo tra la normale e -Z
  const c = -z;
  if (c > 1 - 1e-9) return IDENTITY;
  if (c < -1 + 1e-9) return [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  // Asse di rotazione v = normale × (0, 0, -1) = (-y, x, 0); R = I + [v]× + [v]×² / (1 + c)
  const vx = -y;
  const vy = x;
  const k = 1 / (1 + c);
  return [
    [1 + k * -(vy * vy), k * vx * vy, vy],
    [k * vx * vy, 1 + k * -(vx * vx), -vx],
    [-vy, vx, 1 - k * (vx * vx + vy * vy)],
  ];
}

/**
 * Nuova posizione e rotazione di un oggetto alla radice perché la faccia con normale `normal` guardi in basso: ruota
 * attorno a `center` (di solito il centro del suo ingombro), così l'oggetto resta dov'è. L'oggetto è
 * `x' = R·D·x + p`: la rotazione Q del mondo si applica a sinistra e lo specchio D non cambia.
 */
export function layFlatPatch(node: { position: Vec3; rotation: Vec3 }, normal: Vec3, center: Vec3): { position: Vec3; rotation: Vec3 } {
  const q = rotationToDown(normal);
  const rotation = matrixToEuler(mul(q, eulerToMatrix(node.rotation))).map((v) => round(v, 4)) as Vec3;
  const offset: Vec3 = [node.position[0] - center[0], node.position[1] - center[1], node.position[2] - center[2]];
  const turned = apply(q, offset);
  return { position: [0, 1, 2].map((i) => round(center[i] + turned[i], 4)) as Vec3, rotation };
}
