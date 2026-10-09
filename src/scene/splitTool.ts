import { produce } from 'immer';
import { round, toLocalTransform } from './math';
import type { Bounds } from './placement';
import { isLocked, newId, uniqueName } from './store';
import { isCutter, treatmentFrame, wrapInGroup } from './treatment';
import type { PrimitiveNode, Scene, SceneNode, Vec3 } from './types';

/**
 * Dividi con un piano: l'oggetto alla radice viene sostituito da due gruppi Intersezione, ciascuno con una copia
 * dell'oggetto e un cubo "Taglio" che copre un lato del piano (perpendicolare a un asse, alla quota `offset` nel
 * mondo). Le due metà restano parametriche: spostando il cubo si sposta il taglio, e il codice OpenSCAD è un
 * `intersection()` con un `cube`. Restituisce la nuova scena senza toccare quella ricevuta.
 */

/** Quanto il cubo di taglio sporge oltre l'ingombro del pezzo, per lato (mm). */
const CUTTER_MARGIN = 10;
/** Distanza minima del piano dai bordi dell'ingombro: più vicino una metà sarebbe vuota (mm). */
const MIN_SLICE = 0.1;

/** Vero se la selezione è un solo oggetto alla radice che si può dividere: solido, non bloccato, né raccordo né smusso. */
export function canSplit(scene: Scene, selection: string[]): boolean {
  const node = selection.length === 1 ? scene.nodes[selection[0]] : undefined;
  return node !== undefined && scene.rootIds.includes(node.id) && node.mode === 'solid' && !isCutter(node) && !isLocked(scene, node.id);
}

export function buildSplit(
  scene: Scene,
  targetId: string,
  axis: 0 | 1 | 2,
  offset: number,
  bounds: Bounds,
): { ok: true; scene: Scene; ids: [string, string] } | { ok: false; error: string } {
  const target = scene.nodes[targetId];
  if (!target) return { ok: false, error: 'L\'oggetto non esiste più.' };
  if (!scene.rootIds.includes(targetId)) return { ok: false, error: 'Si divide solo un oggetto alla radice.' };
  if (isLocked(scene, targetId)) return { ok: false, error: 'L\'oggetto è bloccato: sbloccalo per dividerlo.' };
  if (target.mode === 'hole') return { ok: false, error: 'Un foro non si può dividere.' };
  if (isCutter(target)) return { ok: false, error: 'Un raccordo o uno smusso non si può dividere.' };
  if (!(offset > bounds.min[axis] + MIN_SLICE && offset < bounds.max[axis] - MIN_SLICE)) return { ok: false, error: 'Il piano non taglia l\'oggetto: spostalo dentro il suo ingombro.' };

  // Il cubo di taglio copre tutto l'ingombro sugli altri assi e, sull'asse del piano, un lato del piano
  const extent = [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i] + 2 * CUTTER_MARGIN) as Vec3;
  const center = [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2) as Vec3;
  // Sistema del gruppo che prenderà il posto del pezzo (e del suo clone, che ha la stessa trasformazione)
  const { groupWorld } = treatmentFrame(scene, targetId);
  const ids: [string, string] = [newId(), newId()];

  const next = produce(scene, (draft) => {
    // Copia ricorsiva del pezzo (come Duplica): sarà la seconda metà
    const clone = (id: string): string => {
      const src = draft.nodes[id];
      const copy = JSON.parse(JSON.stringify(src)) as SceneNode;
      copy.id = newId();
      copy.locked = false;
      copy.name = uniqueName(draft, src.name.replace(/ \d+$/, ''));
      if (copy.type === 'group') copy.children = copy.children.map(clone);
      draft.nodes[copy.id] = copy;
      return copy.id;
    };
    const cloneId = clone(targetId);
    draft.rootIds.splice(draft.rootIds.indexOf(targetId) + 1, 0, cloneId);

    // Metà 1: dal lato minore del piano; metà 2: dal lato maggiore
    [targetId, cloneId].forEach((pieceId, half) => {
      const cutterId = newId();
      const cutterCenter: Vec3 = [...center];
      cutterCenter[axis] = half === 0 ? offset - extent[axis] / 2 : offset + extent[axis] / 2;
      const local = toLocalTransform(groupWorld, { position: cutterCenter, rotation: [0, 0, 0] });
      const cutter: PrimitiveNode = {
        id: cutterId,
        type: 'primitive',
        kind: 'box',
        name: uniqueName(draft, 'Taglio'),
        position: local.position.map((v) => round(v, 4)) as Vec3,
        rotation: local.rotation.map((v) => round(v, 4)) as Vec3,
        // Con il pezzo specchiato il gruppo porta lo specchio: il cubo lo annulla, così resta dov'è nel mondo
        ...(local.mirror ? { mirror: local.mirror } : {}),
        mode: 'solid',
        color: target.color,
        size: [...extent],
        cornerRadius: 0,
      };
      draft.nodes[cutterId] = cutter;
      wrapInGroup(draft, pieceId, {
        id: ids[half],
        name: uniqueName(draft, `${target.name} (${half + 1})`),
        mode: 'solid',
        color: target.color,
        op: 'intersection',
        children: [pieceId, cutterId],
      });
    });
  });
  return { ok: true, scene: next, ids };
}
