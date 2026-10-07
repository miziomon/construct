import { produce } from 'immer';
import { apply, eulerToMatrix, transpose } from './math';
import type { Transform } from './math';
import { normalizePattern } from './pattern';
import { isLocked, newId, uniqueName } from './store';
import { isCutter, wrapInGroup } from './treatment';
import type { PatternParams, Scene, Vec3 } from './types';

/** Etichetta del gruppo, in italiano, per tipo di pattern. */
const KIND_NAMES: Record<PatternParams['kind'], string> = { voronoi: 'Voronoi', hexagon: 'Esagoni', circle: 'Cerchi', diamond: 'Rombi', triangle: 'Triangoli' };

/**
 * Applica un Pattern alla scena: l'oggetto viene sostituito da un gruppo `pattern` che lo contiene come unico figlio
 * (le celle non sono oggetti: kernel e codice OpenSCAD le ricavano da `pattern`, vedi src/scene/pattern.ts).
 * Come per Guscio e Ripetizione il gruppo prende posizione, rotazione e specchio dell'oggetto, che resta all'origine.
 */
export function applyPattern(
  scene: Scene,
  targetId: string,
  params: PatternParams,
): { ok: true; scene: Scene; groupId: string } | { ok: false; error: string } {
  const target = scene.nodes[targetId];
  if (!target) return { ok: false, error: 'L\'oggetto non esiste più.' };
  if (isLocked(scene, targetId)) return { ok: false, error: 'L\'oggetto è bloccato: sbloccalo per applicare un pattern.' };
  if (isCutter(target)) return { ok: false, error: 'Un raccordo o uno smusso non si può forare.' };

  const groupId = newId();
  // L'anteprima semplificata vale solo durante lo strumento: nel gruppo definitivo non c'è
  const { preview, ...normalized } = normalizePattern(params);
  const next = produce(scene, (draft) => {
    wrapInGroup(draft, targetId, {
      id: groupId,
      name: uniqueName(draft, `Pattern ${KIND_NAMES[normalized.kind]}: ${target.name}`),
      mode: target.mode,
      color: target.color,
      op: 'pattern',
      children: [targetId],
      pattern: { ...normalized, ...(preview ? { preview } : {}) },
    });
  });
  return { ok: true, scene: next, groupId };
}

/**
 * Dal mondo al sistema del gruppo: `local = D · Rᵀ · (v − posizione)` per un punto, senza traslazione per una direzione
 * (D = specchio del gruppo). Serve a tradurre la faccia scelta con il clic nelle coordinate dei parametri.
 */
export function worldToLocal(world: Transform, v: Vec3, isPoint: boolean): Vec3 {
  const d: Vec3 = isPoint ? [v[0] - world.position[0], v[1] - world.position[1], v[2] - world.position[2]] : v;
  const local = apply(transpose(eulerToMatrix(world.rotation)), d);
  return local.map((x, axis) => (world.mirror?.[axis] ? -x : x)) as Vec3;
}

/** Inverso di `worldToLocal`: dal sistema del gruppo al mondo (`mondo = R · D · v + posizione` per un punto). */
export function localToWorld(world: Transform, v: Vec3, isPoint: boolean): Vec3 {
  const mirrored = v.map((x, axis) => (world.mirror?.[axis] ? -x : x)) as Vec3;
  const rotated = apply(eulerToMatrix(world.rotation), mirrored);
  return isPoint ? (rotated.map((x, i) => x + world.position[i]) as Vec3) : rotated;
}
