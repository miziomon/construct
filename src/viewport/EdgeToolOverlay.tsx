import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { faceMap, faceTriangles } from '../scene/edgeTool';
import { useEdgeTool, type FacePick } from '../ui/EdgeTool/edgeToolStore';
import { useViewportPalette } from './palette';

/** Una faccia evidenziata: i suoi triangoli, appena sopra la superficie per non sfarfallare. */
function FaceHighlight({ pick, color }: { pick: FacePick; color: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(faceTriangles(pick.mesh, faceMap(pick.mesh), pick.face), 3));
    return g;
  }, [pick]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} renderOrder={2} raycast={() => null}>
      <meshBasicMaterial color={color} transparent opacity={0.6} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Evidenzia la faccia sotto il puntatore e le facce scelte mentre è attivo Raccordo o Smusso. */
export function EdgeToolOverlay() {
  const tool = useEdgeTool((s) => s.tool);
  const picks = useEdgeTool((s) => s.picks);
  const hover = useEdgeTool((s) => s.hover);
  const palette = useViewportPalette();
  if (!tool) return null;

  const hoverIsPicked = hover && picks.some((p) => p.mesh === hover.mesh && p.face === hover.face);
  return (
    <>
      {picks.map((p) => (
        <FaceHighlight key={`${p.mesh.id}-${p.face}`} pick={p} color={palette.facePick} />
      ))}
      {hover && !hoverIsPicked && <FaceHighlight pick={hover} color={palette.faceHover} />}
    </>
  );
}
