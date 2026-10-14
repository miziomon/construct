import { apply, eulerToMatrix, round } from './math';
import type { Mirror } from './math';
import type { Vec2, Vec3 } from './types';

/**
 * Compensazione della posizione di un Profilo quando si modifica il disegno. L'origine del nodo corrisponde al centro del
 * riquadro naturale delle curve (vedi `pathNaturalBox`): se la modifica sposta quel centro, tutto il disegno
 * scivolerebbe nella scena. Spostando il nodo dello stesso vettore, nel suo sistema ruotato e specchiato, le parti che non
 * sono cambiate restano ferme.
 */

/** Il tipo di estrusione che decide quali componenti del vettore contano. */
export type PlacementMode = 'linear' | 'rotate';

/**
 * Nuova posizione del nodo (nel sistema del genitore) dopo che il centro del disegno è passato da `before` a `after`.
 * Nel sistema locale lo spostamento è [Δx, Δy, 0] in lineare; in rotazione la X del disegno è il raggio, che si adegua da
 * sé, e conta solo la Y, che è la quota Z: [0, 0, Δy]. Il vettore passa poi dalla rotazione e dallo specchio del nodo
 * (x_genitore = R · D · x_locale + p, come `composeTransform`): uno specchio su un asse inverte il segno di quella componente.
 */
export function compensatePosition(node: { position: Vec3; rotation: Vec3; mirror?: Mirror }, mode: PlacementMode, before: Vec2, after: Vec2): Vec3 {
  const [dx, dy] = [after[0] - before[0], after[1] - before[1]];
  const local: Vec3 = mode === 'rotate' ? [0, 0, dy] : [dx, dy, 0];
  // D: -1 sugli assi specchiati
  const mirrored: Vec3 = [node.mirror?.[0] ? -local[0] : local[0], node.mirror?.[1] ? -local[1] : local[1], node.mirror?.[2] ? -local[2] : local[2]];
  const shift = apply(eulerToMatrix(node.rotation), mirrored);
  return [round(node.position[0] + shift[0]), round(node.position[1] + shift[1]), round(node.position[2] + shift[2])];
}
