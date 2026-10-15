import { useEffect, useMemo, useRef, useState } from 'react';
import { getKernel } from '../../kernel/client';
import type { NodeMesh } from '../../kernel/evaluate';
import { shape2dDefaults } from '../../scene/defaults';
import { pathNaturalSize } from '../../scene/shapes2d';
import { roundPaths } from '../../scene/store';
import type { Scene, Shape2DNode } from '../../scene/types';
import type { Draft } from './model';

type PathShape = Extract<Shape2DNode, { kind: 'path' }>;

/** Intervallo minimo tra l'inizio di due calcoli dell'anteprima (ms): durante un trascinamento il kernel non è sommerso. */
const MIN_INTERVAL = 100;

/** Stato dell'anteprima: in calcolo, pronta o in errore. L'ultima mesh resta visibile mentre se ne calcola una nuova. */
export interface PreviewResult {
  state: 'busy' | 'ready' | 'error';
  mesh: NodeMesh | null;
}

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
    width: size?.width ?? natural.width,
    depth: size?.depth ?? natural.depth,
  } as Shape2DNode;
  return { nodes: { preview: node }, rootIds: ['preview'] };
}

/**
 * Mesh dell'anteprima 3D, calcolata dal kernel vero (`evaluateDetached`: non tocca la scena in vista). Una sola richiesta
 * alla volta e non più di una ogni 100 ms; se nel frattempo il disegno cambia vince l'ultimo. Con `immediate` (gesto
 * concluso) l'ultima richiesta parte subito. Senza `enabled` (disegno senza contorni validi) non si calcola nulla.
 */
export function usePreviewMesh(draft: Draft, base: PathShape | null, size: { width: number; depth: number } | null, immediate: boolean, enabled: boolean): PreviewResult {
  const [result, setResult] = useState<PreviewResult>({ state: 'busy', mesh: null });
  // Stato dello scheduler: non fa ridisegnare, si legge dai timer e dalle risposte
  const run = useRef<{ alive: boolean; inflight: boolean; last: number; pending: Scene | null; timer: ReturnType<typeof setTimeout> | undefined }>({
    alive: true, inflight: false, last: 0, pending: null, timer: undefined,
  });

  const scene = useMemo(
    () => (enabled ? previewScene(draft, base, size) : null),
    // Solo ciò che cambia la forma: il resto del Draft (nulla) non esiste
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, draft.paths, draft.tolerance, draft.extrusion, draft.height, draft.twist, draft.scaleTop, draft.revolveAngle, draft.revolveSegments, base, size?.width, size?.depth],
  );

  useEffect(() => {
    const r = run.current;
    r.alive = true;
    return () => {
      r.alive = false;
      clearTimeout(r.timer);
    };
  }, []);

  useEffect(() => {
    const r = run.current;
    if (!scene) {
      r.pending = null;
      clearTimeout(r.timer);
      setResult({ state: 'ready', mesh: null });
      return;
    }
    r.pending = scene;
    setResult((prev) => (prev.state === 'busy' ? prev : { ...prev, state: 'busy' }));

    /** Pianifica l'avvio della richiesta in attesa; se una è già in volo parte alla sua risposta. */
    const schedule = (now: boolean) => {
      if (r.inflight) return;
      clearTimeout(r.timer);
      const wait = now ? 0 : Math.max(0, MIN_INTERVAL - (performance.now() - r.last));
      r.timer = setTimeout(() => {
        const next = r.pending;
        r.pending = null;
        if (!next) return;
        r.inflight = true;
        r.last = performance.now();
        getKernel()
          .evaluateDetached(next)
          .then((res) => {
            if (!r.alive) return;
            r.inflight = false;
            const mesh = res.meshes.find((m) => !m.isHole) ?? null;
            // Se è già arrivato un disegno più nuovo la mesh si mostra lo stesso (progressiva) e si resta in calcolo
            setResult({ state: r.pending ? 'busy' : 'ready', mesh });
            if (r.pending) schedule(false);
          })
          .catch(() => {
            if (!r.alive) return;
            r.inflight = false;
            setResult((prev) => ({ ...prev, state: 'error' }));
            if (r.pending) schedule(false);
          });
      }, wait);
    };
    schedule(immediate);
  }, [scene, immediate]);

  return result;
}
