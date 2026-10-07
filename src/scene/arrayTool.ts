import { produce } from 'immer';
import { normalizeArray } from './arrayPattern';
import { isLocked, newId, uniqueName } from './store';
import { isCutter, wrapInGroup } from './treatment';
import type { ArrayParams, Scene } from './types';

/**
 * Applica una Ripetizione alla scena: l'oggetto viene sostituito da un gruppo `array` che lo contiene come unico figlio
 * (le copie non sono oggetti: il kernel e il generatore OpenSCAD le ricavano da `array`, vedi src/scene/arrayPattern.ts).
 * Il gruppo prende il posto dell'oggetto nel suo elenco e la sua posizione e rotazione: l'originale non si sposta.
 * Restituisce la nuova scena senza toccare quella ricevuta.
 */
export function buildArray(
  scene: Scene,
  targetId: string,
  params: ArrayParams,
): { ok: true; scene: Scene; groupId: string } | { ok: false; error: string } {
  const target = scene.nodes[targetId];
  if (!target) return { ok: false, error: 'L\'oggetto non esiste più.' };
  if (isLocked(scene, targetId)) return { ok: false, error: 'L\'oggetto è bloccato: sbloccalo per ripeterlo.' };
  if (isCutter(target)) return { ok: false, error: 'Un raccordo o uno smusso non si può ripetere.' };

  const groupId = newId();
  const next = produce(scene, (draft) => {
    // Come per il Guscio: il gruppo prende posizione, rotazione e specchio dell'oggetto, che resta all'origine del gruppo
    wrapInGroup(draft, targetId, {
      id: groupId,
      name: uniqueName(draft, `Ripetizione: ${target.name}`),
      mode: target.mode,
      color: target.color,
      op: 'array',
      children: [targetId],
      array: normalizeArray(params),
    });
  });
  return { ok: true, scene: next, groupId };
}
