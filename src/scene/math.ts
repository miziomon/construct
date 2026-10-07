import type { Vec3 } from './types';

// Piccole utilità di algebra 3x3 (solo rotazioni) per ricomporre le trasformazioni quando si separa un gruppo.
export type Mat3 = [Vec3, Vec3, Vec3];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Matrice di rotazione R = Rz * Ry * Rx: prima X, poi Y, poi Z (stessa convenzione di OpenSCAD e manifold). */
export function eulerToMatrix([x, y, z]: Vec3): Mat3 {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rad(x)), Math.sin(rad(x)), Math.cos(rad(y)), Math.sin(rad(y)), Math.cos(rad(z)), Math.sin(rad(z))];
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

/** Inverso di eulerToMatrix (gradi). Nel gimbal lock (|sin y| = 1) la rotazione X viene azzerata. */
export function matrixToEuler(m: Mat3): Vec3 {
  const sy = -m[2][0];
  const y = Math.asin(Math.max(-1, Math.min(1, sy)));
  if (Math.abs(sy) > 0.999999) return [0, deg(y), deg(Math.atan2(-m[0][1], m[1][1]))];
  return [deg(Math.atan2(m[2][1], m[2][2])), deg(y), deg(Math.atan2(m[1][0], m[0][0]))];
}

/** Prodotto di due matrici 3x3. */
export function mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r;
}

/** Matrice per vettore. */
export function apply(m: Mat3, v: Vec3): Vec3 {
  return [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec3;
}

/**
 * Specchio per asse (X, Y, Z) di un nodo: si applica nel sistema locale, prima della rotazione. Un nodo è quindi
 * x_genitore = R · D · x + p, con D = diag(±1). `undefined` (campo assente) vale "nessuno specchio".
 */
export type Mirror = [boolean, boolean, boolean];

/** Trasformazione di un nodo: posizione, rotazione ed eventuale specchio. */
export interface Transform {
  position: Vec3;
  rotation: Vec3;
  mirror?: Mirror;
}

/** Diagonale di D: -1 sugli assi specchiati, 1 sugli altri. */
const signs = (m?: Mirror): Vec3 => [m?.[0] ? -1 : 1, m?.[1] ? -1 : 1, m?.[2] ? -1 : 1];

/** Specchio senza assi attivi equivale a nessuno specchio: si omette il campo per tenere pulite le scene salvate. */
export const normalizeMirror = (m?: Mirror): Mirror | undefined => (m?.some(Boolean) ? [m[0], m[1], m[2]] : undefined);

/** Combina due specchi (XOR per asse): specchiare due volte lo stesso asse lo annulla. */
export const xorMirror = (a?: Mirror, b?: Mirror): Mirror | undefined => normalizeMirror([!!a?.[0] !== !!b?.[0], !!a?.[1] !== !!b?.[1], !!a?.[2] !== !!b?.[2]]);

/** D · R · D: la rotazione vista nel sistema specchiato (resta una rotazione, perché det(D)² = 1). */
export function conjugate(m: Mat3, d: Vec3): Mat3 {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => d[i] * m[i][j] * d[j])) as Mat3;
}

/** Specchia una rotazione (gradi) attraverso gli assi indicati: D · R · D, in gradi. */
export const mirrorEuler = (rotation: Vec3, mirror?: Mirror): Vec3 => matrixToEuler(conjugate(eulerToMatrix(rotation), signs(mirror)));

/** Trasformazione figlio nel sistema del genitore, ricomposta nel sistema esterno: world = parent * child. */
export function composeTransform(parent: Transform, child: Transform): Transform {
  const pm = eulerToMatrix(parent.rotation);
  const dp = signs(parent.mirror);
  // posizione = Rp · Dp · pc + pp
  const p = apply(pm, [child.position[0] * dp[0], child.position[1] * dp[1], child.position[2] * dp[2]]);
  // Rp · Dp · Rc · Dc = (Rp · Dp·Rc·Dp) · (Dp · Dc)
  const mirror = xorMirror(parent.mirror, child.mirror);
  return {
    position: [p[0] + parent.position[0], p[1] + parent.position[1], p[2] + parent.position[2]],
    rotation: matrixToEuler(mul(pm, conjugate(eulerToMatrix(child.rotation), dp))),
    // Il campo c'è solo se serve: senza specchi il risultato è quello di sempre
    ...(mirror ? { mirror } : {}),
  };
}

/** Matrice trasposta (per le rotazioni coincide con l'inversa). */
/** Matrice trasposta (per le rotazioni è l'inversa). */
export const transpose = (m: Mat3): Mat3 => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]) as Mat3;

/**
 * Inverso di composeTransform: trasformazione nel sistema del genitore di un oggetto che nel mondo
 * (o nel sistema esterno al genitore) ha la trasformazione `world`. local = inverso(parent) * world.
 */
export function toLocalTransform(parent: Transform, world: Transform): Transform {
  const inv = transpose(eulerToMatrix(parent.rotation));
  const dp = signs(parent.mirror);
  const delta: Vec3 = [world.position[0] - parent.position[0], world.position[1] - parent.position[1], world.position[2] - parent.position[2]];
  const rotated = apply(inv, delta);
  const mirror = xorMirror(parent.mirror, world.mirror);
  return {
    // posizione = Dp · Rp⁻¹ · (pw − pp)
    position: [rotated[0] * dp[0], rotated[1] * dp[1], rotated[2] * dp[2]],
    // Dp · Rp⁻¹ · Rw · Dw = (Dp·(Rp⁻¹ Rw)·Dp) · (Dp · Dw)
    rotation: matrixToEuler(conjugate(mul(inv, eulerToMatrix(world.rotation)), dp)),
    ...(mirror ? { mirror } : {}),
  };
}

/** Arrotonda a n decimali eliminando il rumore numerico (es. 1e-15) senza produrre -0. */
export function round(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f + 0;
}
