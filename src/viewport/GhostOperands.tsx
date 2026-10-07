import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getKernel } from '../kernel/client';
import type { NodeMesh } from '../kernel/evaluate';
import { parentOf, useSceneStore } from '../scene/store';
import { useUiStore } from '../ui/uiStore';

/** Una mesh fantasma: rosso traslucido, senza contorno e senza intercettare i clic. */
function GhostPart({ mesh }: { mesh: NodeMesh }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={() => null} renderOrder={1}>
      <meshStandardMaterial color="#ff4d4d" flatShading transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Modalità # di OpenSCAD: gli operandi che le booleane dell'oggetto selezionato sottraggono o intersecano
 * (e i suoi fori) si disegnano in trasparenza sopra il risultato, per vedere come lavora l'operazione.
 */
export function GhostOperands() {
  const active = useUiStore((s) => s.ghostOps);
  const scene = useSceneStore((s) => s.scene);
  const selection = useSceneStore((s) => s.selection);
  const invalidate = useThree((s) => s.invalidate);
  const [meshes, setMeshes] = useState<NodeMesh[]>([]);

  // Radici degli oggetti selezionati (anche se è selezionato un nodo dentro un gruppo)
  const roots = useMemo(() => {
    const ids = new Set<string>();
    for (const id of selection) {
      let root = id;
      for (let up = parentOf(scene, root); up; up = parentOf(scene, root)) root = up;
      ids.add(root);
    }
    return [...ids];
  }, [scene, selection]);

  useEffect(() => {
    if (!active || roots.length === 0) {
      setMeshes([]);
      invalidate();
      return;
    }
    // Se la scena cambia prima della risposta, il risultato vecchio si scarta
    let stale = false;
    getKernel()
      .ghosts(scene, roots)
      .then((result) => {
        if (stale) return;
        setMeshes(result);
        invalidate();
      })
      .catch(() => !stale && setMeshes([]));
    return () => {
      stale = true;
    };
  }, [active, scene, roots, invalidate]);

  return (
    <>
      {meshes.map((m) => (
        <GhostPart key={`${m.rootId}/${m.path.join('/')}`} mesh={m} />
      ))}
    </>
  );
}
