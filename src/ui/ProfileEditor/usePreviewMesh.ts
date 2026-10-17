import { useEffect, useMemo, useRef, useState } from 'react';
import { getKernel } from '../../kernel/client';
import { shape2dDefaults } from '../../scene/defaults';
import { pathNaturalSize } from '../../scene/shapes2d';
import { roundPaths } from '../../scene/store';
import type { Scene, Shape2DNode } from '../../scene/types';
import type { Draft } from './model';
import { createPreviewScheduler, type PreviewResult, type PreviewScheduler } from './previewScheduler';

export type { PreviewResult };

type PathShape = Extract<Shape2DNode, { kind: 'path' }>;

/**
 * Mini-scena dell'anteprima: il solo nodo del Profilo, a posizione e rotazione nulle, con i parametri del disegno. Ha gli
 * stessi contorni arrotondati e le stesse misure che l'OK scrive nella scena (`commitProfile`), così la mesh
 * dell'anteprima è quella che poi compare. `base` è il nodo esistente (colore, contorno 2D...), `size` le misure da tenere
 * se sono legate a un parametro (altrimenti sono quelle naturali del disegno).
 */
export function previewScene(draft: Draft, base: PathShape | null, size: { width: number; depth: number } | null): Scene {
  const paths = roundPaths(draft.paths.filter((c) => c.nodes.length >= 2));
  const natural = pathNaturalSize({ paths });
  // Del nodo esistente si tengono solo le proprietà che disegnano: niente specchio, formule, blocco o nascondi
  const { mirror, exprs, locked, hidden, ...kept } = (base ?? { ...shape2dDefaults('path'), id: 'preview', name: 'Anteprima', position: [0, 0, 0] }) as PathShape;
  const node = {
    ...kept,
    id: 'preview',
    name: 'Anteprima',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    mode: 'solid',
    paths,
    tolerance: draft.tolerance,
    extrusion: draft.extrusion,
    height: draft.height,
    twist: draft.twist,
    scaleTop: draft.scaleTop,
    revolveAngle: draft.revolveAngle,
    revolveSegments: draft.revolveSegments,
    // La sagoma della modale (assente = cerchio): non quella del nodo esistente
    plan: draft.plan,
    width: size?.width ?? natural.width,
    depth: size?.depth ?? natural.depth,
  } as Shape2DNode;
  return { nodes: { preview: node }, rootIds: ['preview'] };
}

/**
 * Mesh dell'anteprima 3D, calcolata dal kernel vero (`evaluateDetached`: non tocca la scena in vista). La logica di
 * una richiesta alla volta e del ritmo dei calcoli sta in `previewScheduler`. Con `immediate` (gesto concluso)
 * l'ultima richiesta parte subito. Senza `enabled` (disegno senza contorni validi) non si calcola nulla.
 */
export function usePreviewMesh(draft: Draft, base: PathShape | null, size: { width: number; depth: number } | null, immediate: boolean, enabled: boolean): PreviewResult {
  const [result, setResult] = useState<PreviewResult>({ state: 'busy', mesh: null });
  const scheduler = useRef<PreviewScheduler | null>(null);

  const scene = useMemo(
    () => (enabled ? previewScene(draft, base, size) : null),
    // Solo ciò che cambia la forma: il resto del Draft (nulla) non esiste
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, draft.paths, draft.tolerance, draft.extrusion, draft.height, draft.twist, draft.scaleTop, draft.revolveAngle, draft.revolveSegments, draft.plan, base, size?.width, size?.depth],
  );

  useEffect(() => {
    const created = createPreviewScheduler({ evaluate: (next) => getKernel().evaluateDetached(next), onChange: setResult });
    scheduler.current = created;
    return () => {
      created.dispose();
      scheduler.current = null;
    };
  }, []);

  useEffect(() => {
    scheduler.current?.update(scene, immediate);
  }, [scene, immediate]);

  return result;
}
