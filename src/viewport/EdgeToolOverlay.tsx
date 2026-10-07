import { useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { cornerAt, faceMap, faceTriangles, vertexPosition } from '../scene/edgeTool';
import type { NodeMesh } from '../kernel/evaluate';
import { useEdgeTool, type CornerPick, type FacePick } from '../ui/EdgeTool/edgeToolStore';
import { useViewportPalette } from './palette';

/** Una faccia evidenziata: i suoi triangoli, appena sopra la superficie per non sfarfallare. */
export function FaceHighlight({ pick, color }: { pick: FacePick; color: string }) {
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

/** Vertice evidenziato con una piccola sfera, sempre visibile (anche dietro la superficie). */
function VertexMarker({ pick, color }: { pick: CornerPick; color: string }) {
  const position = vertexPosition(pick.mesh, pick.vertex);
  return (
    <mesh position={position} renderOrder={3} raycast={() => null}>
      <sphereGeometry args={[1.4, 16, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
    </mesh>
  );
}

/**
 * Smusso angolare con l'anteprima aperta: a video c'è la mesh già tagliata, ma i vertici si scelgono sulla mesh di
 * partenza (gli indici della mesh tagliata sono diversi). Questa copia invisibile della mesh di partenza riceve i clic
 * e il passaggio del puntatore al posto delle parti visibili, così l'anteprima si aggiorna a ogni scelta.
 */
function CornerPickProxy({ mesh }: { mesh: NodeMesh }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { setHoverCorner, pickCorner } = useEdgeTool.getState();
  /** Vertice più vicino al punto colpito, tra quelli della faccia sotto il puntatore (-1 se non c'è). */
  const cornerUnder = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const face = e.faceIndex == null ? -1 : faceMap(mesh).triFace[e.faceIndex];
    return face < 0 ? -1 : cornerAt(mesh, faceMap(mesh), face, [e.point.x, e.point.y, e.point.z]);
  };
  return (
    <mesh
      geometry={geometry}
      onPointerMove={(e) => {
        e.stopPropagation();
        const vertex = cornerUnder(e);
        setHoverCorner(vertex >= 0 ? { mesh, vertex } : null);
      }}
      onPointerOut={() => setHoverCorner(null)}
      onClick={(e) => {
        // Un trascinamento (rotazione della vista) non è una scelta
        if (e.delta > 3) return;
        e.stopPropagation();
        pickCorner(mesh, cornerUnder(e), e.shiftKey);
      }}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  );
}

/** Evidenzia la faccia sotto il puntatore e le facce scelte mentre è attivo Raccordo o Smusso. */
export function EdgeToolOverlay() {
  const tool = useEdgeTool((s) => s.tool);
  const picks = useEdgeTool((s) => s.picks);
  const hover = useEdgeTool((s) => s.hover);
  const cornerPicks = useEdgeTool((s) => s.cornerPicks);
  const hoverCorner = useEdgeTool((s) => s.hoverCorner);
  const previewing = useEdgeTool((s) => s.preview !== null);
  const palette = useViewportPalette();
  if (!tool) return null;

  // Smusso angolare: si evidenziano i vertici (quello scelto e quello sotto il puntatore), non le facce
  if (tool === 'corner') {
    const hoverIsPicked = hoverCorner && cornerPicks.some((p) => p.mesh === hoverCorner.mesh && p.vertex === hoverCorner.vertex);
    return (
      <>
        {previewing && cornerPicks.length > 0 && <CornerPickProxy mesh={cornerPicks[0].mesh} />}
        {cornerPicks.map((p) => (
          <VertexMarker key={`${p.mesh.id}-${p.vertex}`} pick={p} color={palette.facePick} />
        ))}
        {hoverCorner && !hoverIsPicked && <VertexMarker pick={hoverCorner} color={palette.faceHover} />}
      </>
    );
  }

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
