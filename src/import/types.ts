/** Mesh triangolata letta da un file, in millimetri e con vertici condivisi. */
export interface ImportedMesh {
  /** Nome per l'interfaccia (nome dell'oggetto nel file o nome del file). */
  name: string;
  /** Colore "#rrggbb" se il file lo specifica. */
  color?: string;
  /** Coordinate xyz consecutive. */
  positions: Float32Array;
  /** Indici dei triangoli (tre per ogni faccia). */
  indices: Uint32Array;
}

/** Errore di lettura con un messaggio già pronto per l'utente. */
export class ImportError extends Error {}
