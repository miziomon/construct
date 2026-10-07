import { apply, eulerToMatrix, round } from './math';
import type { GroupNode, Vec3 } from './types';

/**
 * Ridimensionamento di un gruppo di qualsiasi tipo (Raggruppa, booleane, Guscio, Ripetizione, Pattern): il gruppo non ha
 * misure proprie, quindi porta una scala per asse (`groupScale`) applicata a tutto il suo contenuto, nel suo sistema locale
 * e prima di specchio, rotazione e traslazione: x_genitore = R · D · S · x + p. Kernel e codice OpenSCAD la applicano
 * allo stesso modo (`scale([sx, sy, sz])`, il più interno dei modificatori).
 */

/** Scala minima di un asse: sotto, il solido diventerebbe degenere. */
const MIN_SCALE = 0.001;
/** Misura minima del gruppo (mm) lungo un asse dopo il ridimensionamento. */
const MIN_SIZE = 0.1;

/** Scala del gruppo; (1, 1, 1) se non è mai stato ridimensionato. */
export const scaleOf = (group: Pick<GroupNode, 'groupScale'>): Vec3 => group.groupScale ?? [1, 1, 1];

/** Vero se la scala cambia qualcosa. */
export const isScaled = (group: Pick<GroupNode, 'groupScale'>): boolean => scaleOf(group).some((v) => v !== 1);

/** Scala senza valori assurdi (zero, negativi, non numeri): si riporta al minimo; a (1, 1, 1) il campo si omette. */
export function normalizeScale(scale: Vec3): Vec3 | undefined {
  const clean = scale.map((v) => (Number.isFinite(v) ? Math.max(MIN_SCALE, round(v, 4)) : 1)) as Vec3;
  return clean.every((v) => v === 1) ? undefined : clean;
}

/** Ingombro del gruppo nel suo sistema locale (già scalato): serve a capire quanto è grande e dove sta la base. */
export interface LocalBox {
  min: Vec3;
  max: Vec3;
}

/**
 * Risultato di un ridimensionamento fatto trascinando il gizmo.
 * `factor` è il fattore per asse letto dal gizmo (rispetto alla misura di partenza), `step` il passo di arrotondamento
 * delle misure finali in mm (0,5 di norma, 0,01 con Maiusc). Il punto fisso è il centro della base dell'ingombro:
 * gli assi X e Y crescono da entrambi i lati, la base resta dov'è. Un asse con fattore 1 non cambia.
 * Restituisce la nuova scala e la nuova posizione del gruppo (il centro della base non si sposta nel mondo).
 */
export function resizeGroup(
  group: Pick<GroupNode, 'groupScale' | 'position' | 'rotation' | 'mirror'>,
  box: LocalBox,
  factor: Vec3,
  step = 0.5,
): { scale: Vec3 | undefined; position: Vec3 } {
  const before = scaleOf(group);
  // Un gruppo vuoto (ingombro infinito o assente) non ha niente da ridimensionare
  if (![...box.min, ...box.max].every(Number.isFinite)) return { scale: group.groupScale, position: group.position };
  const size = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
  // Nuova misura arrotondata al passo; la scala si ricava dal rapporto con la misura attuale
  const next = [0, 1, 2].map((i) => {
    if (factor[i] === 1 || size[i] <= 0) return before[i];
    const snapped = Math.max(MIN_SIZE, round(Math.round((size[i] * factor[i]) / step) * step, 3));
    return Math.max(MIN_SCALE, before[i] * (snapped / size[i]));
  }) as Vec3;
  const scale = normalizeScale(next);
  const after = scaleOf({ groupScale: scale });

  // Punto fisso (centro della base) nel sistema locale non scalato: c = S0⁻¹ · pivot
  const pivot: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2]];
  const unscaled = pivot.map((v, i) => v / before[i]) as Vec3;
  // p' = p + R · D · (S0 − S1) · c, così R · D · S · c + p non cambia
  const delta = unscaled.map((v, i) => (before[i] - after[i]) * v) as Vec3;
  const d = delta.map((v, i) => (group.mirror?.[i] ? -v : v)) as Vec3;
  const moved = apply(eulerToMatrix(group.rotation), d);
  return { scale, position: group.position.map((v, i) => round(v + moved[i], 3)) as Vec3 };
}

/** Scala del gruppo aggiornata a mano (campo percentuale): stessa base e stesso punto fisso del gizmo. */
export function setGroupScale(
  group: Pick<GroupNode, 'groupScale' | 'position' | 'rotation' | 'mirror'>,
  box: LocalBox,
  scale: Vec3,
): { scale: Vec3 | undefined; position: Vec3 } {
  const before = scaleOf(group);
  const factor = scale.map((v, i) => v / before[i]) as Vec3;
  // Con la scala richiesta esatta (senza arrotondare le misure): si usa un passo minuscolo
  return resizeGroup(group, box, factor, 1e-6);
}
