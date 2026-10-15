import * as THREE from 'three';
import type { NodeMesh } from '../kernel/evaluate';

/** Geometria three.js di una mesh del kernel (posizioni e indici dei triangoli), con le normali calcolate. Chi la crea la libera con `dispose()`. */
export function meshGeometry(mesh: Pick<NodeMesh, 'positions' | 'indices'>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeVertexNormals();
  return g;
}
