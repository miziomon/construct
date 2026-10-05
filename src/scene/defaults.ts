import type { PrimitiveKind, PrimitiveNode } from './types';

/** Etichette italiane delle primitive, usate in libreria e outliner. */
export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  box: 'Scatola',
  cylinder: 'Cilindro',
  cone: 'Cono',
  sphere: 'Sfera',
  torus: 'Toro',
};

/** Numero di segmenti predefinito per le curve (TinkerCAD si ferma a 64, qui si arriva a 256). */
export const DEFAULT_SEGMENTS = 64;
export const MAX_SEGMENTS = 256;
export const MIN_SEGMENTS = 8;

export const DEFAULT_COLOR = '#4da3ff';

/** Altezza (mm) del punto più basso della primitiva rispetto al suo centro. */
export function halfHeight(p: PrimitiveNode): number {
  switch (p.kind) {
    case 'box': return p.size[2] / 2;
    case 'cylinder':
    case 'cone': return p.height / 2;
    case 'sphere': return p.radius;
    case 'torus': return p.minorRadius;
  }
}

/** Omit che si applica a ogni membro dell'unione (l'Omit standard la appiattirebbe). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Parametri geometrici iniziali di ogni primitiva (senza id, nome e posizione). */
export function primitiveDefaults(kind: PrimitiveKind): DistributiveOmit<PrimitiveNode, 'id' | 'name' | 'position'> {
  const base = { type: 'primitive' as const, rotation: [0, 0, 0] as [number, number, number], mode: 'solid' as const, color: DEFAULT_COLOR };
  switch (kind) {
    case 'box': return { ...base, kind, size: [20, 20, 20] };
    case 'cylinder': return { ...base, kind, radius: 10, height: 20, segments: DEFAULT_SEGMENTS };
    case 'cone': return { ...base, kind, radiusBottom: 10, radiusTop: 0, height: 20, segments: DEFAULT_SEGMENTS };
    case 'sphere': return { ...base, kind, radius: 10, segments: DEFAULT_SEGMENTS };
    case 'torus': return { ...base, kind, majorRadius: 12, minorRadius: 4, segments: DEFAULT_SEGMENTS };
  }
}
