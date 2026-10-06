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
  | { kind: 'box'; size: Vec3 }
  | { kind: 'cylinder'; radius: number; height: number; segments: number }
  | { kind: 'cone'; radiusBottom: number; radiusTop: number; height: number; segments: number }
  | { kind: 'sphere'; radius: number; segments: number }
  | { kind: 'torus'; majorRadius: number; minorRadius: number; segments: number }
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

export type SceneNode = PrimitiveNode | GroupNode;

export interface Scene {
  nodes: Record<string, SceneNode>;
  /** Ordine di presentazione degli oggetti alla radice. */
  rootIds: string[];
}

/** Dimensioni del piatto di stampa di riferimento (mm). */
export const BED_SIZE = 256;
