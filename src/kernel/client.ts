import * as Comlink from 'comlink';
import type { KernelApi } from './kernel.worker';

// Un solo worker per tutta l'app, creato al primo utilizzo
let kernel: Comlink.Remote<KernelApi> | undefined;

export function getKernel(): Comlink.Remote<KernelApi> {
  if (!kernel) {
    const worker = new Worker(new URL('./kernel.worker.ts', import.meta.url), { type: 'module' });
    kernel = Comlink.wrap<KernelApi>(worker);
  }
  return kernel;
}
