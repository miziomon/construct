/** Versione dell'app (da package.json), iniettata da Vite in fase di build. */
declare const __APP_VERSION__: string;

/** Ponte per i test end-to-end (presente solo nella build con --mode e2e). */
interface Window {
  __webcad?: { store: typeof import('./scene/store').useSceneStore; results: typeof import('./kernel/useKernel').useResultStore };
  __r3f?: import('@react-three/fiber').RootState;
}
