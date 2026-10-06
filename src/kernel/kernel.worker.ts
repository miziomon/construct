/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { Evaluator, toMesh, type AssetCheck, type EvalResult } from './evaluate';
import { writeStl } from './export/stl';
import { write3mf } from './export/threemf';
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
    const result = ev.evaluate(scene);
    const transfer = result.meshes.flatMap((m) => [m.positions.buffer, m.indices.buffer]);
    return Comlink.transfer(result, transfer);
  },

  /** STL binario con l'unione di tutti i solid alla radice. */
  async exportStl(scene: Scene): Promise<Uint8Array<ArrayBuffer>> {
    const ev = await getEvaluator();
    const union = ev.unionOfSolids(scene);
    try {
      const mesh = toMesh({ id: 'all', color: '#fff', mode: 'solid' } as never, union);
      const bytes = writeStl(mesh.positions, mesh.indices);
      return Comlink.transfer(bytes, [bytes.buffer]);
    } finally {
      union.delete();
    }
  },

  /** 3MF con un oggetto per ogni solid alla radice (un colore ciascuno). */
  async export3mf(scene: Scene): Promise<Uint8Array<ArrayBuffer>> {
    const ev = await getEvaluator();
    const { meshes } = ev.evaluate(scene);
    const parts = meshes
      .filter((m) => !m.isHole && !m.empty)
      .map((m) => ({ name: scene.nodes[m.id].name, color: m.color, positions: m.positions, indices: m.indices }));
    const bytes = write3mf(parts);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
};

export type KernelApi = typeof api;
Comlink.expose(api);
