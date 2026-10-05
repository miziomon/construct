import { create } from 'zustand';
import { useSceneStore } from '../scene/store';
import { getKernel } from './client';
import type { NodeMesh } from './evaluate';

interface ResultState {
  /** Mesh calcolate per gli oggetti alla radice, in coordinate mondo. */
  meshes: NodeMesh[];
  /** Durata dell'ultimo calcolo (ms). */
  ms: number;
  busy: boolean;
  error?: string;
}

export const useResultStore = create<ResultState>(() => ({ meshes: [], ms: 0, busy: false }));

/**
 * Collega la scena al kernel: a ogni modifica ricalcola le mesh nel worker.
 * Se arrivano nuove modifiche durante un calcolo, ne parte uno solo, con l'ultima scena (niente coda).
 */
export function startKernelSync(): void {
  let running = false;
  let dirty = false;

  const run = async () => {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    useResultStore.setState({ busy: true });
    try {
      do {
        dirty = false;
        const result = await getKernel().evaluate(useSceneStore.getState().scene);
        // Se nel frattempo la scena è cambiata, il risultato è già vecchio: si salta l'aggiornamento
        if (!dirty) useResultStore.setState({ meshes: result.meshes, ms: result.ms, error: undefined });
      } while (dirty);
    } catch (err) {
      useResultStore.setState({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
      useResultStore.setState({ busy: false });
    }
  };

  useSceneStore.subscribe((state, prev) => {
    if (state.scene !== prev.scene) void run();
  });
  void run();
}
