// Modello dati della scena. Unità: millimetri, asse Z verso l'alto (come slicer e OpenSCAD).

export type Vec3 = [number, number, number];

/** Un oggetto "solid" aggiunge materiale, un "hole" lo sottrae dal gruppo che lo contiene. */
export type NodeMode = 'solid' | 'hole';

interface BaseNode {
  id: string;
  name: string;
  /** Posizione del centro dell'oggetto, in mm. */
  position: Vec3;
  /** Rotazioni in gradi, applicate in ordine X, poi Y, poi Z (come OpenSCAD). */
  rotation: Vec3;
  mode: NodeMode;
  /** Colore esadecimale, usato anche come materiale nel 3MF. */
  color: string;
  /** Oggetto bloccato: non si sposta, ruota, modifica, elimina o raggruppa per errore. */
  locked?: boolean;
}

export type PrimitiveKind = 'box' | 'cylinder' | 'cone' | 'sphere' | 'torus';

export type PrimitiveNode = BaseNode & { type: 'primitive' } & (
  | { kind: 'box'; size: Vec3; /** Raggio di arrotondamento di tutti gli spigoli in mm (0 o assente = spigoli vivi). */ cornerRadius?: number }
  | { kind: 'cylinder'; radius: number; height: number; segments: number }
  | { kind: 'cone'; radiusBottom: number; radiusTop: number; height: number; segments: number }
  | { kind: 'sphere'; radius: number; segments: number }
  | { kind: 'torus'; majorRadius: number; minorRadius: number; segments: number }
);

export type Shape2DKind = 'circle' | 'square';

/**
 * Forma 2D estrusa (come linear_extrude di OpenSCAD): il profilo sta sul piano XY e si estrude
 * lungo Z per `height` mm, con torsione e scala della cima opzionali.
 */
export type Shape2DNode = BaseNode & {
  type: 'shape2d';
  /** Altezza dell'estrusione in mm. */
  height: number;
  /** Torsione della cima rispetto alla base, in gradi. */
  twist: number;
  /** Fattore di scala della cima (1 = prisma, 0 = cono). */
  scaleTop: number;
} & (
  | { kind: 'circle'; radius: number; /** Numero di lati: 3 triangolo, 6 esagono, 64 quasi liscio ($fn di OpenSCAD). */ segments: number }
  | { kind: 'square'; width: number; depth: number; /** Raggio di arrotondamento degli angoli in mm (0 = vivi). */ cornerRadius: number }
);

export type GroupOp = 'union' | 'intersection' | 'difference';

export type GroupNode = BaseNode & {
  type: 'group';
  /**
   * union: somma dei solid meno gli hole; intersection: parte comune dei solid meno gli hole;
   * difference: il primo figlio meno tutti gli altri (il modo solid/hole dei figli è ignorato).
   */
  op: GroupOp;
  children: string[];
};

export type SceneNode = PrimitiveNode | Shape2DNode | GroupNode;

export interface Scene {
  nodes: Record<string, SceneNode>;
  /** Ordine di presentazione degli oggetti alla radice. */
  rootIds: string[];
}

/** Dimensioni del piatto di stampa di riferimento (mm). */
export const BED_SIZE = 256;
