import { canMoveInto, parentOf, type MoveTarget } from '../../scene/store';
import type { Scene } from '../../scene/types';

/** Dove cade il nodo trascinato rispetto alla riga sotto il puntatore. */
export type DropZone = 'before' | 'after' | 'inside';

/**
 * Zona di rilascio dalla posizione verticale del puntatore nella riga (0 = bordo alto, 1 = bordo basso).
 * Un gruppo ha anche la zona centrale "dentro"; per gli altri nodi la riga si divide a metà tra prima e dopo.
 */
export function zoneAt(ratio: number, isGroup: boolean): DropZone {
  if (!isGroup) return ratio < 0.5 ? 'before' : 'after';
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'inside';
}

/**
 * Destinazione di `moveNode` per un rilascio sulla riga `overId`, oppure null se non è consentito
 * (nodo bloccato, destinazione bloccata, rilascio dentro un proprio discendente o su se stesso).
 */
export function dropTarget(scene: Scene, draggedId: string, overId: string, zone: DropZone): MoveTarget | null {
  const over = scene.nodes[overId];
  if (!over || overId === draggedId) return null;

  let target: MoveTarget;
  if (zone === 'inside' && over.type === 'group') {
    target = { parentId: overId, index: over.children.length };
  } else {
    const parentId = parentOf(scene, overId) ?? null;
    const siblings = parentId ? (scene.nodes[parentId] as { children: string[] }).children : scene.rootIds;
    const at = siblings.indexOf(overId);
    target = { parentId, index: zone === 'after' ? at + 1 : at };
  }
  return canMoveInto(scene, draggedId, target.parentId) ? target : null;
}
