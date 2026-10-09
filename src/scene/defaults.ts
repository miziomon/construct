import type { PrimitiveKind, PrimitiveNode, Shape2DKind, Shape2DNode } from './types';
import { DEFAULT_FONT } from './fontCatalog';
import { RATIO_INFO, profileExtent } from './shapes2d';

/** Etichette italiane delle primitive, usate in libreria e outliner. */
export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  box: 'Cubo',
  cylinder: 'Cilindro',
  cone: 'Cono',
  sphere: 'Sfera',
  torus: 'Toro',
  octahedron: 'Ottaedro',
  decahedron: 'Decaedro',
  dodecahedron: 'Dodecaedro',
  icosahedron: 'Icosaedro',
};

/** Numero di segmenti predefinito per le curve (TinkerCAD si ferma a 64, qui si arriva a 256). */
export const DEFAULT_SEGMENTS = 64;
export const MAX_SEGMENTS = 256;
/** Minimo dei lati per cerchio, cilindro, cono e toro: 3 = triangolo (come $fn=3 in OpenSCAD). */
export const MIN_SEGMENTS = 3;
/** La sfera di manifold è una sfera geodetica: i segmenti sono sempre multipli di 4. */
export const MIN_SPHERE_SEGMENTS = 8;

/** Scorciatoie per il numero di lati, con il nome del poligono regolare corrispondente. */
export const SEGMENT_PRESETS: { value: number; label: string; title: string }[] = [
  { value: 3, label: '3', title: 'Triangolo' },
  { value: 4, label: '4', title: 'Quadrato' },
  { value: 5, label: '5', title: 'Pentagono' },
  { value: 6, label: '6', title: 'Esagono' },
  { value: 8, label: '8', title: 'Ottagono' },
  { value: 12, label: '12', title: 'Dodecagono' },
];

/** Segmenti delle sfere agli angoli di una scatola arrotondata. */
export const CORNER_SPHERE_SEGMENTS = 24;

// Nessuna etichetta è l'inizio di un'altra: i pulsanti si trovano per titolo ("Aggiungi: <etichetta>...")
export const SHAPE2D_LABELS: Record<Shape2DKind, string> = {
  circle: 'Cerchio',
  square: 'Quadrato',
  ring: 'Anello',
  heart: 'Cuore',
  star5: 'Stella 5 punte',
  star6: 'Stella 6 punte',
  egg: 'Uovo',
  trapezoid: 'Trapezio',
  cross: 'Croce',
  drop: 'Goccia',
  crescent: 'Mezzaluna',
  text: 'Testo',
  svg: 'SVG',
  profileL: 'Profilato a L',
  profileT: 'Profilato a T',
  profileH: 'Profilato a H',
};

/**
 * Divisioni verticali di un'estrusione con torsione: una ogni 2° di rotazione.
 * Con passi più larghi la superficie si deforma (a 5° un profilo sottile 10:1 gonfia il volume del 13%).
 */
export function twistDivisions(twist: number): number {
  return twist === 0 ? 0 : Math.min(360, Math.ceil(Math.abs(twist) / 2));
}

/** Altezza iniziale dell'estrusione delle forme 2D (mm). */
export const DEFAULT_EXTRUDE_HEIGHT = 10;
/** Lunghezza iniziale dei profilati (mm). */
export const PROFILE_LENGTH = 40;

export const DEFAULT_COLOR = '#4da3ff';

/** Altezza (mm) del punto più basso della forma rispetto al suo centro. */
export function halfHeight(p: PrimitiveNode | Shape2DNode): number {
  // Estrusione rotazionale: la Y del profilo diventa l'altezza, quindi conta metà della sua profondità
  if (p.type === 'shape2d') return p.extrusion === 'rotate' ? profileExtent(p).depth / 2 : p.height / 2;
  switch (p.kind) {
    case 'box': return p.size[2] / 2;
    case 'cylinder':
    case 'cone': return p.height / 2;
    case 'sphere': return p.radiusZ ?? p.radius;
    case 'torus': return p.minorRadius;
    // I solidi dei dadi poggiano su una faccia: la metà della distanza tra facce opposte
    case 'octahedron':
    case 'decahedron':
    case 'dodecahedron':
    case 'icosahedron': return p.size / 2;
  }
}

/** Omit che si applica a ogni membro dell'unione (l'Omit standard la appiattirebbe). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Parametri geometrici iniziali di ogni primitiva (senza id, nome e posizione). */
export function primitiveDefaults(kind: PrimitiveKind): DistributiveOmit<PrimitiveNode, 'id' | 'name' | 'position'> {
  const base = { type: 'primitive' as const, rotation: [0, 0, 0] as [number, number, number], mode: 'solid' as const, color: DEFAULT_COLOR };
  switch (kind) {
    case 'box': return { ...base, kind, size: [20, 20, 20], cornerRadius: 0 };
    case 'cylinder': return { ...base, kind, radius: 10, height: 20, segments: DEFAULT_SEGMENTS };
    case 'cone': return { ...base, kind, radiusBottom: 10, radiusTop: 0, height: 20, segments: DEFAULT_SEGMENTS };
    case 'sphere': return { ...base, kind, radius: 10, segments: DEFAULT_SEGMENTS };
    case 'torus': return { ...base, kind, majorRadius: 12, minorRadius: 4, segments: DEFAULT_SEGMENTS };
    case 'octahedron':
    case 'decahedron':
    case 'dodecahedron':
    case 'icosahedron': return { ...base, kind, size: 20, cornerRadius: 0 };
  }
}

/** Parametri iniziali di una forma 2D estrusa (senza id, nome e posizione). */
export function shape2dDefaults(kind: Shape2DKind): DistributiveOmit<Shape2DNode, 'id' | 'name' | 'position'> {
  const base = {
    type: 'shape2d' as const,
    rotation: [0, 0, 0] as [number, number, number],
    mode: 'solid' as const,
    color: DEFAULT_COLOR,
    height: DEFAULT_EXTRUDE_HEIGHT,
    twist: 0,
    scaleTop: 1,
  };
  switch (kind) {
    case 'circle': return { ...base, kind, radius: 10, segments: DEFAULT_SEGMENTS, cornerRadius: 0 };
    case 'square': return { ...base, kind, width: 20, depth: 20, cornerRadius: 0 };
    case 'text': return { ...base, kind, text: 'Testo', font: DEFAULT_FONT, size: 10, height: 3 };
    // Il disegno vero lo fornisce l'importazione (`addSvg`): qui un segnaposto vuoto
    case 'svg': return { ...base, kind, contours: [], width: 20, depth: 20, fileName: '' };
    // Forme poligonali: 20 × 20 mm (tranne dove la forma ha una proporzione propria) e il parametro predefinito
    case 'egg': return { ...base, kind, width: 16, depth: 22, ratio: RATIO_INFO.egg!.default };
    case 'trapezoid': return { ...base, kind, width: 24, depth: 16, ratio: RATIO_INFO.trapezoid!.default };
    case 'heart': return { ...base, kind, width: 20, depth: 20, ratio: 0 };
    case 'drop': return { ...base, kind, width: 16, depth: 24, ratio: 0 };
    // Profilati: sezione 20 × 20 con pareti di 3 mm, più lunghi delle altre estrusioni perché sono travi
    case 'profileL':
    case 'profileT':
    case 'profileH': return { ...base, kind, width: 20, depth: 20, flange: 3, web: 3, rootRadius: 0, height: PROFILE_LENGTH };
    default: return { ...base, kind, width: 20, depth: 20, ratio: RATIO_INFO[kind]!.default };
  }
}
