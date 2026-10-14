import { decodePathMeta } from '../../scene/bezier';
import { pathContours, pathRadius } from '../../scene/shapes2d';
import type { PathContour } from '../../scene/types';
import type { Mat } from './evaluate';

/** Scarto massimo (mm) tra i punti scritti nel codice e quelli ricalcolati dal commento: l'import arrotonda a 3 decimali. */
const POINT_TOLERANCE = 1e-3;
/** Scarto massimo della matrice del profilo da una semplice traslazione. */
const MATRIX_TOLERANCE = 1e-6;

/** Un profilo di Bézier riconosciuto nel codice, già validato. */
export interface RestoredPath {
  paths: PathContour[];
  tolerance: number;
  width: number;
  depth: number;
}

/**
 * Riconosce un `polygon()` scritto da Construct a partire dal commento `// construct:path` che lo precede. Il commento non
 * è fidato (il file può essere modificato a mano): si decodifica e si valida, poi si ricalcolano i contorni e si confrontano
 * con i punti davvero scritti (prima di qualunque matrice). Se c'è la minima differenza, il file è stato cambiato e il
 * poligono resta un Poligono qualsiasi. Restituisce null in ogni caso dubbio, mai un'eccezione.
 *
 * `rotate` è presente per i profili dentro `rotate_extrude`: il profilo deve essere solo spostato del raggio del disegno,
 * senza rotazioni né scale, perché il raggio di un Profilo non si può impostare.
 */
export function restorePath(meta: string | undefined, polygon: { points: [number, number][]; paths?: number[][] }, rotate?: { profile: Mat }): RestoredPath | null {
  if (meta === undefined) return null;
  const decoded = decodePathMeta(meta);
  if (!decoded) return null;
  // Contorni che Construct scriverebbe oggi con questi dati
  const expected = pathContours({ ...decoded, extrusion: rotate ? 'rotate' : 'linear' });
  // Contorni letti dal codice: i `paths` di polygon(), oppure tutti i punti in ordine
  const written = (polygon.paths ?? [polygon.points.map((_, i) => i)]).map((indices) => indices.map((i) => polygon.points[i]));
  if (expected.length !== written.length) return null;
  for (let c = 0; c < expected.length; c++) {
    if (expected[c].length !== written[c].length) return null;
    for (let i = 0; i < expected[c].length; i++) {
      if (Math.abs(expected[c][i][0] - written[c][i][0]) > POINT_TOLERANCE || Math.abs(expected[c][i][1] - written[c][i][1]) > POINT_TOLERANCE) return null;
    }
  }
  if (rotate) {
    // translate([raggio, 0]) e nient'altro: matrice 3 × 4 per righe (x, y, z), con la traslazione nell'ultima colonna
    const m = rotate.profile;
    const near = (i: number, value: number) => Math.abs(m[i] - value) <= MATRIX_TOLERANCE;
    const pure = [0, 5, 10].every((i) => near(i, 1)) && [1, 2, 4, 6, 8, 9, 7, 11].every((i) => near(i, 0));
    if (!pure || !near(3, pathRadius(decoded))) return null;
  }
  return decoded;
}
