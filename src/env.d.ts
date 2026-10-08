/** Versione dell'app (da package.json), iniettata da Vite in fase di build. */
declare const __APP_VERSION__: string;

/** Ponte per i test end-to-end (presente solo nella build con --mode e2e). */
interface Window {
  __construct?: { store: typeof import('./scene/store').useSceneStore; results: typeof import('./kernel/useKernel').useResultStore };
  __r3f?: import('@react-three/fiber').RootState;
}

/** File System Access API (Chrome, Edge): non è nei tipi di TypeScript. Dove manca, si ricade sul download. */
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}
interface ProjectFileHandle {
  readonly name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<ProjectFileHandle>;
}
