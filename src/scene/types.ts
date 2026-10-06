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

/** Solidi dei dadi: ottaedro (d8), decaedro (d10, trapezoedro pentagonale), dodecaedro (d12), icosaedro (d20). */
export type PolyhedronKind = 'octahedron' | 'decahedron' | 'dodecahedron' | 'icosahedron';

export type PrimitiveKind = 'box' | 'cylinder' | 'cone' | 'sphere' | 'torus' | PolyhedronKind;

export type PrimitiveNode = BaseNode & { type: 'primitive' } & (
  | { kind: 'box'; size: Vec3; /** Raggio di arrotondamento di tutti gli spigoli in mm (0 o assente = spigoli vivi). */ cornerRadius?: number }
  | { kind: PolyhedronKind; /** Distanza tra due facce opposte in mm (la misura dei dadi). */ size: number; /** Raggio di arrotondamento di spigoli e vertici in mm (0 = vivi). */ cornerRadius: number }
  | { kind: 'cylinder'; radius: number; /** Raggio lungo Y in mm (assente = uguale a `radius`: cilindro tondo). */ radiusY?: number; height: number; segments: number }
  | {
      kind: 'cone';
      radiusBottom: number;
      radiusTop: number;
      /** Raggio lungo Y dell'estremità più larga in mm; l'altra mantiene lo stesso rapporto Y/X (assente = cono tondo). */
      radiusY?: number;
      height: number;
      segments: number;
    }
  | { kind: 'sphere'; radius: number; /** Raggi lungo Y e Z in mm (assenti = uguali a `radius`: sfera tonda). */ radiusY?: number; radiusZ?: number; segments: number }
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
  | {
      kind: 'circle';
      radius: number;
      /** Numero di lati: 3 triangolo, 6 esagono, 64 quasi liscio ($fn di OpenSCAD). */
      segments: number;
      /** Raggio di arrotondamento degli angoli del poligono in mm (0 o assente = angoli vivi). */
      cornerRadius?: number;
      /** Raggio lungo Y in mm (assente = uguale a `radius`: cerchio o poligono regolare). */
      radiusY?: number;
    }
  | { kind: 'square'; width: number; depth: number; /** Raggio di arrotondamento degli angoli in mm (0 = vivi). */ cornerRadius: number }
);

/** Mesh importata da un file STL o 3MF. La geometria sta in un asset (vedi src/import/assets.ts). */
export type MeshNode = BaseNode & {
  type: 'mesh';
  assetId: string;
  /** Nome del file di origine, per il codice OpenSCAD e per l'interfaccia. */
  fileName: string;
  /** Centro dell'ingombro nel file originale: la geometria dell'asset è stata ricentrata in questo punto. */
  origin: Vec3;
  /** Fattore di scala uniforme (1 = dimensioni del file). */
  scale: number;
  triangles: number;
};

/**
 * 'group' è il Raggruppa: concetto solo dell'app, gli oggetti restano separati (colori e codice propri) e si muovono insieme.
 * Le altre sono operazioni booleane vere, anche nel codice OpenSCAD.
 */
export type GroupOp = 'group' | 'union' | 'intersection' | 'difference';

export type GroupNode = BaseNode & {
  type: 'group';
  /**
   * union: somma dei solid meno gli hole; intersection: parte comune dei solid meno gli hole;
   * difference: il primo figlio meno tutti gli altri (il modo solid/hole dei figli è ignorato).
   */
  op: GroupOp;
  children: string[];
};

/** Piano di chiusura di un taglierino: si tiene la parte con normale·p ≤ offset, nel sistema locale del taglierino. */
export interface EndPlane {
  normal: Vec3;
  offset: number;
}

/**
 * Taglierino di un raccordo o di uno smusso: prisma che segue uno spigolo tra due facce piane. Nel suo sistema locale
 * l'asse Z corre lungo lo spigolo (da 0 a `length`), l'asse X lungo la bisettrice verso l'interno dell'angolo tra le facce
 * e l'apice del profilo sta nell'origine. Sta sempre in un gruppo con il pezzo: Differenza se lo spigolo è convesso
 * (toglie materiale), Unione se è concavo (ne aggiunge).
 */
export type EdgeNode = BaseNode & {
  type: 'edge';
  treatment: 'fillet' | 'chamfer';
  /** Spigolo convesso (il taglierino toglie) o concavo (aggiunge). */
  convex: boolean;
  /** Apertura tra le due facce in gradi: nel materiale se convesso, nell'aria se concavo. */
  angle: number;
  /** Lunghezza dello spigolo in mm. */
  length: number;
  /** Raggio del raccordo in mm. */
  radius: number;
  /** Smusso: distanza lungo la prima faccia in mm. */
  distance1: number;
  /** Smusso: distanza lungo la seconda faccia in mm. */
  distance2: number;
  /** Larghezza minima delle due facce, perpendicolare allo spigolo: limite massimo delle misure. */
  reach: number;
  /** Piani che chiudono le due estremità (null = perpendicolari allo spigolo, a Z = 0 e Z = length). */
  ends: [EndPlane | null, EndPlane | null];
};

export type SceneNode = PrimitiveNode | Shape2DNode | MeshNode | GroupNode | EdgeNode;

export interface Scene {
  nodes: Record<string, SceneNode>;
  /** Ordine di presentazione degli oggetti alla radice. */
  rootIds: string[];
}

/** Dimensioni del piatto di stampa di riferimento (mm). */
export const BED_SIZE = 256;
