import { useEffect, useMemo } from 'react';
import { Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { placementTargets } from '../kernel/placement';
import { useResultStore } from '../kernel/useKernel';
import { alignDeltas, mirrorBounds, mirrorPlane, shiftBounds, sideOf, unionBounds } from '../scene/placement';
import type { Bounds } from '../scene/placement';
import { useSceneStore, isLocked } from '../scene/store';
import type { Vec3 } from '../scene/types';
import { useUiStore } from '../ui/uiStore';
import { useViewportPalette } from './palette';

/** I dodici spigoli di un box come coppie di punti (per `Line` con `segments`). */
function boxEdges({ min, max }: Bounds): Vec3[] {
  const corner = (i: number): Vec3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const pairs: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  return pairs.flatMap(([a, b]) => [corner(a), corner(b)]);
}

/**
 * Anteprima di Allinea e Specchia nella vista 3D: finché il puntatore (o il focus) è su un pulsante della tendina si
 * vedono i box nella posizione finale (tratteggiati) e il piano su cui avviene l'operazione. Usa le stesse funzioni pure
 * delle azioni (src/scene/placement.ts), quindi quello che si vede è quello che succede al clic.
 */
export function PlacementPreview() {
  const preview = useUiStore((s) => s.placementPreview);
  const meshes = useResultStore((s) => s.meshes);
  const selection = useSceneStore((s) => s.selection);
  const scene = useSceneStore((s) => s.scene);
  const palette = useViewportPalette();
  const invalidate = useThree((s) => s.invalidate);

  const shapes = useMemo(() => {
    if (!preview) return null;
    const bounds = placementTargets(preview.kind);
    const ids = Object.keys(bounds);
    if (ids.length === 0) return null;
    const union = unionBounds(Object.values(bounds));
    const { axis, target } = preview;

    let boxes: Bounds[];
    let plane: number;
    if (preview.kind === 'align') {
      const deltas = alignDeltas(bounds, axis, target);
      // Gli oggetti bloccati non si spostano (ma contano per l'ingombro): il loro box resta dov'è
      boxes = ids.map((id) => (isLocked(scene, id) ? bounds[id] : shiftBounds(bounds[id], deltas[id])));
      plane = sideOf(union, axis, target);
    } else {
      plane = mirrorPlane(Object.values(bounds), axis, target);
      boxes = ids.map((id) => mirrorBounds(bounds[id], axis, plane));
    }
    // Piano: copre l'ingombro della selezione (e quello dei box finali) sugli altri due assi
    const all = unionBounds([union, ...boxes]);
    const margin = 6;
    const size = [0, 1, 2].map((i) => (i === axis ? 0.2 : Math.max(10, all.max[i] - all.min[i] + 2 * margin))) as Vec3;
    const center = [0, 1, 2].map((i) => (i === axis ? plane : (all.min[i] + all.max[i]) / 2)) as Vec3;
    return { edges: boxes.flatMap(boxEdges), size, center };
    // `selection` e `meshes` cambiano gli ingombri: serve rifare il calcolo anche se l'anteprima è la stessa
  }, [preview, meshes, selection, scene]);

  // Il rendering è "a richiesta": a ogni cambio dell'anteprima bisogna chiedere un nuovo fotogramma
  useEffect(() => {
    invalidate();
  }, [shapes, invalidate]);

  if (!shapes) return null;
  return (
    <group>
      <Line points={shapes.edges} segments color={palette.facePick} lineWidth={2} dashed dashSize={2} gapSize={1.2} depthTest={false} renderOrder={5} raycast={() => null} />
      <mesh position={shapes.center} renderOrder={4} raycast={() => null}>
        <boxGeometry args={shapes.size} />
        <meshBasicMaterial color={palette.faceHover} transparent opacity={0.22} depthWrite={false} depthTest={false} />
      </mesh>
    </group>
  );
}
