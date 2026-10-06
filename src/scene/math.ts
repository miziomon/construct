import type { Vec3 } from './types';

// Piccole utilità di algebra 3x3 (solo rotazioni) per ricomporre le trasformazioni quando si separa un gruppo.
type Mat3 = [Vec3, Vec3, Vec3];

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

function mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r;
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec3;
}

/** Trasformazione figlio nel sistema del genitore, ricomposta nel sistema esterno: world = parent * child. */
export function composeTransform(parent: { position: Vec3; rotation: Vec3 }, child: { position: Vec3; rotation: Vec3 }) {
  const pm = eulerToMatrix(parent.rotation);
  const p = apply(pm, child.position);
  return {
    position: [p[0] + parent.position[0], p[1] + parent.position[1], p[2] + parent.position[2]] as Vec3,
    rotation: matrixToEuler(mul(pm, eulerToMatrix(child.rotation))),
  };
}

/** Matrice trasposta (per le rotazioni coincide con l'inversa). */
const transpose = (m: Mat3): Mat3 => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]) as Mat3;

/**
 * Inverso di composeTransform: trasformazione nel sistema del genitore di un oggetto che nel mondo
 * (o nel sistema esterno al genitore) ha la trasformazione `world`. local = inverso(parent) * world.
 */
export function toLocalTransform(parent: { position: Vec3; rotation: Vec3 }, world: { position: Vec3; rotation: Vec3 }) {
  const inv = transpose(eulerToMatrix(parent.rotation));
  const delta: Vec3 = [world.position[0] - parent.position[0], world.position[1] - parent.position[1], world.position[2] - parent.position[2]];
  return {
    position: apply(inv, delta),
    rotation: matrixToEuler(mul(inv, eulerToMatrix(world.rotation))),
  };
}

/** Arrotonda a n decimali eliminando il rumore numerico (es. 1e-15) senza produrre -0. */
export function round(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f + 0;
}
