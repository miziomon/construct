/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { Evaluator, toMesh, type AssetCheck, type EvalResult, type NodeMesh } from './evaluate';
import { writeStl } from './export/stl';
import { write3mf } from './export/threemf';
import { ensureFonts } from './fontLoader';
import { platesOf, sceneForPlate } from '../scene/plates';
import type { Scene } from '../scene/types';

// Il WASM viene caricato una sola volta, alla prima richiesta
let evaluatorPromise: Promise<Evaluator> | undefined;
const getEvaluator = () =>
  (evaluatorPromise ??= Module({ locateFile: () => wasmUrl }).then((wasm) => {
    wasm.setup();
    return new Evaluator(wasm);
  }));

const api = {
  /** Valida e registra una mesh importata (i buffer vengono copiati: il thread principale conserva gli originali). */
  async registerAsset(id: string, positions: Float32Array, indices: Uint32Array): Promise<AssetCheck> {
    return (await getEvaluator()).registerAsset(id, positions, indices);
  },

  /** Calcola le mesh di tutti gli oggetti alla radice. I buffer tornano al thread principale senza copia. */
  async evaluate(scene: Scene): Promise<EvalResult> {
    const ev = await getEvaluator();
    await ensureFonts(scene);
    const result = ev.evaluate(scene);
    const transfer = result.meshes.flatMap((m) => [m.positions.buffer, m.indices.buffer]);
    return Comlink.transfer(result, transfer);
  },

  /** Operandi "fantasma" (come # di OpenSCAD) degli oggetti indicati. */
  async ghosts(scene: Scene, rootIds: string[]): Promise<NodeMesh[]> {
    const ev = await getEvaluator();
    await ensureFonts(scene);
    const meshes = ev.ghosts(scene, rootIds);
    return Comlink.transfer(meshes, meshes.flatMap((m) => [m.positions.buffer, m.indices.buffer]));
  },

  /** STL binario con l'unione di tutti i solid alla radice del piatto indicato (il piatto attivo se non si dice). */
  async exportStl(scene: Scene, plateId?: string): Promise<Uint8Array<ArrayBuffer>> {
    const ev = await getEvaluator();
    await ensureFonts(scene);
    const union = ev.unionOfSolids(plateId ? sceneForPlate(scene, plateId) : scene);
    try {
      const mesh = toMesh({ id: 'all', color: '#fff', mode: 'solid' } as never, union);
      const bytes = writeStl(mesh.positions, mesh.indices);
      return Comlink.transfer(bytes, [bytes.buffer]);
    } finally {
      union.delete();
    }
  },

  /**
   * 3MF con un oggetto per ogni solid alla radice (un colore ciascuno), di **tutti i piatti**. Con più piatti ognuno è
   * spostato lungo X di `indice × spacing` mm, così gli slicer li mostrano affiancati, e i nomi portano il piatto.
   */
  async export3mf(scene: Scene, spacing = 0): Promise<Uint8Array<ArrayBuffer>> {
    const ev = await getEvaluator();
    await ensureFonts(scene);
    const plates = platesOf(scene);
    // Si valutano una sola volta le radici di tutti i piatti: la cache del kernel non viene svuotata a ogni piatto
    const { meshes } = ev.evaluate({ nodes: scene.nodes, rootIds: plates.flatMap((p) => p.rootIds) });
    const plateIndex = new Map(plates.flatMap((p, i) => p.rootIds.map((r) => [r, i] as const)));
    const parts = meshes
      .filter((m) => !m.isHole && !m.empty)
      .map((m) => {
        const i = plateIndex.get(m.rootId) ?? 0;
        const name = scene.nodes[m.id].name;
        return {
          name: plates.length > 1 ? `${plates[i].name} – ${name}` : name,
          color: m.color,
          positions: m.positions,
          indices: m.indices,
          ...(plates.length > 1 && i > 0 ? { offset: [i * spacing, 0, 0] as [number, number, number] } : {}),
        };
      });
    const bytes = write3mf(parts);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
};

export type KernelApi = typeof api;
Comlink.expose(api);
