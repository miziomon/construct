import { produce } from 'immer';
import { composeTransform, round, toLocalTransform } from './math';
import type { Transform } from './math';
import { parentOf, worldTransform } from './store';
import type { CornerNode, EdgeNode, GroupNode, Scene, SceneNode, Vec3 } from './types';

/**
 * Parti comuni di Raccordo, Smusso, Smusso angolare e Guscio: ognuno sostituisce il pezzo con un gruppo
 * (Differenza, Unione o Guscio) che contiene il pezzo e, se serve, un taglierino.
 *
 * Il gruppo prende la posizione e la rotazione del pezzo, che resta all'origine del gruppo. Così il gizmo di Sposta,
 * che si ancora alla posizione del nodo alla radice, compare sull'oggetto e non nell'origine del mondo, e le
 * trasformazioni successive (Sposta, Ruota) agiscono sul gruppo come su un oggetto qualunque.
 */

const IDENTITY = { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };

/**
 * Sistema di riferimento del nuovo gruppo: il genitore del pezzo (null = radice) e la trasformazione nel mondo che il
 * gruppo avrà, cioè quella del genitore composta con quella del pezzo. Serve a portare nel sistema del gruppo la
 * geometria del taglierino, che si calcola in coordinate mondo.
 */
export function treatmentFrame(scene: Scene, targetId: string): { parentId: string | null; groupWorld: Transform } {
  const parentId = parentOf(scene, targetId) ?? null;
  // Senza genitore il sistema esterno è il mondo
  const parentWorld = parentId ? worldTransform(scene, parentId) : IDENTITY;
  return { parentId, groupWorld: composeTransform(parentWorld, scene.nodes[targetId]) };
}

/**
 * Sostituisce il pezzo con un gruppo (da chiamare dentro un `produce` di immer, su `draft`).
 * Passi: 1) il gruppo eredita posizione e rotazione del pezzo; 2) il pezzo si azzera, quindi nel mondo non si sposta;
 * 3) il gruppo prende il posto del pezzo nell'elenco in cui stava (radice o gruppo genitore).
 */
export function wrapInGroup(draft: Scene, targetId: string, group: Omit<GroupNode, 'type' | 'position' | 'rotation' | 'locked'>): void {
  const target = draft.nodes[targetId];
  const parentId = parentOf(draft, targetId) ?? null;
  const node: GroupNode = { ...group, type: 'group', position: [...target.position], rotation: [...target.rotation], ...(target.mirror ? { mirror: target.mirror } : {}) };
  target.position = [0, 0, 0];
  target.rotation = [0, 0, 0];
  // Anche lo specchio passa al gruppo: il pezzo resta com'era nel mondo
  delete target.mirror;
  draft.nodes[node.id] = node;
  const siblings = parentId ? (draft.nodes[parentId] as GroupNode).children : draft.rootIds;
  siblings[siblings.indexOf(targetId)] = node.id;
}

/** Vero per un taglierino di Raccordo, Smusso o Smusso angolare: sta sempre in un gruppo con il pezzo. */
export const isCutter = (node: SceneNode | undefined): node is EdgeNode | CornerNode => node?.type === 'edge' || node?.type === 'corner';

const isZero = (v: readonly number[]) => v.every((c) => c === 0);

/**
 * Migrazione delle scene salvate prima della 0.10.0: i gruppi di Guscio, Raccordo e Smusso stavano all'origine e la
 * posizione era sul pezzo, quindi il gizmo di Sposta compariva nell'origine del mondo. Si porta la trasformazione del
 * pezzo sul gruppo (e quella dei taglierini nel nuovo sistema del gruppo). La geometria nel mondo non cambia.
 * Idempotente: un gruppo già a posto, o che non è un trattamento, non si tocca.
 */
export function normalizeTreatmentGroups(scene: Scene): Scene {
  /** Sistema un gruppo se serve; restituisce vero se ha cambiato qualcosa. */
  const fix = (draft: Scene, group: SceneNode): boolean => {
    if (group.type !== 'group' || !isZero(group.position) || !isZero(group.rotation)) return false;
    const [baseId, ...rest] = group.children;
    const base = draft.nodes[baseId];
    // Un trattamento è un Guscio con un solo figlio, oppure una Differenza/Unione tra il pezzo e un solo taglierino
    const isTreatment = group.op === 'shell' ? rest.length === 0 : (group.op === 'difference' || group.op === 'union') && rest.length === 1 && isCutter(draft.nodes[rest[0]]);
    if (!isTreatment || !base || (isZero(base.position) && isZero(base.rotation))) return false;
    // La trasformazione del pezzo passa al gruppo e il pezzo torna all'origine
    const frame = { position: [...base.position] as Vec3, rotation: [...base.rotation] as Vec3 };
    group.position = frame.position;
    group.rotation = frame.rotation;
    base.position = [0, 0, 0];
    base.rotation = [0, 0, 0];
    // I taglierini erano nel sistema del genitore: ora stanno in quello del gruppo
    for (const id of rest) {
      const cutter = draft.nodes[id];
      const local = toLocalTransform(frame, cutter);
      cutter.position = local.position.map((v) => round(v, 4)) as Vec3;
      cutter.rotation = local.rotation.map((v) => round(v, 4)) as Vec3;
    }
    return true;
  };

  return produce(scene, (draft) => {
    // Con trattamenti annidati (smusso su uno smusso) il gruppo esterno si sistema solo dopo quello interno:
    // si ripete finché qualcosa cambia (ogni giro sposta una trasformazione di un livello, quindi termina)
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of Object.values(draft.nodes)) changed = fix(draft, node) || changed;
    }
  });
}
