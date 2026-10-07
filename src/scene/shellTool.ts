import { produce } from 'immer';
import { isLocked, newId, uniqueName } from './store';
import { isCutter, wrapInGroup } from './treatment';
import { cavityOf } from './shell';
import type { Scene, ShellParams } from './types';

/**
 * Applica il Guscio alla scena: il solido viene sostituito da un gruppo `shell` che lo contiene come unico figlio
 * (il kernel e il generatore OpenSCAD ricavano la cavità da `shell`, vedi src/scene/shell.ts). Il gruppo prende il posto
 * del solido nel suo elenco (radice o gruppo) e la sua posizione e rotazione: il solido non si sposta.
 * Restituisce la nuova scena senza toccare quella ricevuta.
 */
export function buildShell(
  scene: Scene,
  targetId: string,
  shell: ShellParams,
): { ok: true; scene: Scene; groupId: string } | { ok: false; error: string } {
  const target = scene.nodes[targetId];
  if (!target) return { ok: false, error: 'L\'oggetto non esiste più.' };
  if (isLocked(scene, targetId)) return { ok: false, error: 'L\'oggetto è bloccato: sbloccalo per svuotarlo.' };
  if (target.mode === 'hole') return { ok: false, error: 'Un foro non si può svuotare.' };
  if (isCutter(target)) return { ok: false, error: 'Un raccordo o uno smusso non si può svuotare.' };

  // Prima di toccare la scena si verifica che le pareti entrino nel solido (messaggio già pronto per l'utente)
  const cavity = cavityOf(scene, target, shell);
  if (cavity.kind === 'error') return { ok: false, error: cavity.error };

  const groupId = newId();
  const next = produce(scene, (draft) => {
    // Il gruppo prende il posto del solido e la sua posizione e rotazione (vedi treatment.ts): il solido resta
    // all'origine del gruppo e nel mondo non si sposta, mentre il gizmo di Sposta compare sull'oggetto
    wrapInGroup(draft, targetId, {
      id: groupId,
      name: uniqueName(draft, `Guscio: ${target.name}`),
      mode: target.mode,
      color: target.color,
      op: 'shell',
      children: [targetId],
      shell,
    });
  });
  return { ok: true, scene: next, groupId };
}
