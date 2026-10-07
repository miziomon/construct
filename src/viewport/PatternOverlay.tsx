import { useMemo } from 'react';
import { useResultStore } from '../kernel/useKernel';
import { faceMap } from '../scene/edgeTool';
import { localToWorld } from '../scene/patternTool';
import { useSceneStore, worldTransform } from '../scene/store';
import { usePatternTool } from '../ui/Pattern/patternToolStore';
import { FaceHighlight } from './EdgeToolOverlay';
import { useViewportPalette } from './palette';

/**
 * Nella vista 3D, mentre si scelgono le facce del Pattern: evidenzia le facce già scelte e quella sotto il puntatore.
 * Le facce scelte sono salvate nel sistema del gruppo: si cercano nella mesh del pezzo con stessa normale e stesso piano.
 */
export function PatternOverlay() {
  const hover = usePatternTool((s) => s.hover);
  const picking = usePatternTool((s) => s.picking);
  const faces = usePatternTool((s) => s.params?.faces);
  const targetId = usePatternTool((s) => s.targetId);
  const meshes = useResultStore((s) => s.meshes);
  const palette = useViewportPalette();

  const chosen = useMemo(() => {
    if (!picking || !faces || !targetId) return [];
    const world = worldTransform(useSceneStore.getState().scene, targetId);
    const found: { mesh: (typeof meshes)[number]; face: number }[] = [];
    for (const mesh of meshes) {
      if (mesh.empty || !mesh.path.includes(targetId)) continue;
      const map = faceMap(mesh);
      for (const f of faces) {
        const n = localToWorld(world, f.normal, false);
        const point = localToWorld(world, f.origin, true);
        const offset = n[0] * point[0] + n[1] * point[1] + n[2] * point[2];
        map.faces.forEach((info, index) => {
          const same = [0, 1, 2].every((i) => Math.abs(info.normal[i] - n[i]) < 1e-3) && Math.abs(info.offset - offset) < 1e-2;
          if (same) found.push({ mesh, face: index });
        });
      }
    }
    return found;
  }, [picking, faces, targetId, meshes]);

  return (
    <>
      {chosen.map((c) => (
        <FaceHighlight key={`${c.mesh.id}-${c.face}`} pick={c} color={palette.facePick} />
      ))}
      {picking && hover && !chosen.some((c) => c.mesh === hover.mesh && c.face === hover.face) && <FaceHighlight pick={hover} color={palette.faceHover} />}
    </>
  );
}
