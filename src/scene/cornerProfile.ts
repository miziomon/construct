import { CORNER_SPHERE_SEGMENTS } from './defaults';
import type { CornerNode, Vec3 } from './types';

/**
 * Taglierino di uno smusso angolare, nel sistema locale del nodo (il vertice è l'origine). Funzioni pure, condivise da
 * kernel e generatore OpenSCAD così non divergono.
 *
 * Piano: involucro convesso del vertice e dei punti a distanza `d` lungo ogni spigolo (per un cubo è un tetraedro).
 * Sferico: lo stesso involucro meno una sfera tangente agli spigoli in quei punti (per un cubo è la calotta di un angolo
 * arrotondato): resta il materiale dentro la sfera.
 */

/** Quanto il vertice del taglierino sporge oltre il solido (mm): evita facce complanari con le facce del pezzo. */
export const CORNER_OVERSHOOT = 0.01;

/** Distanza minima accettata. */
export const MIN_CORNER_SIZE = 0.01;

type Source = Pick<CornerNode, 'treatment' | 'directions' | 'lengths' | 'distance' | 'segments'>;

export interface CornerCutter {
  /** Punti dell'involucro convesso: vertice (spostato verso l'esterno) e un punto per spigolo. */
  points: Vec3[];
  /** Solo sferico: sfera da sottrarre all'involucro. */
  sphere?: { center: Vec3; radius: number; segments: number };
}

/** Distanza effettiva: non oltre lo spigolo più corto (il taglio non deve uscire dal pezzo). */
export const effectiveDistance = (p: Pick<CornerNode, 'distance' | 'lengths'>): number => Math.max(MIN_CORNER_SIZE, Math.min(p.distance, ...p.lengths));

/** Risolve il sistema 3×3 `m · x = b` con la regola di Cramer; null se la matrice è singolare. */
function solve3(m: number[][], b: number[]): Vec3 | null {
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  // Si sostituisce a turno ogni colonna con il termine noto
  return [0, 1, 2].map((col) => det(m.map((row, r) => row.map((v, c) => (c === col ? b[r] : v)))) / d) as Vec3;
}

/**
 * Centro e raggio della sfera tangente agli spigoli nei punti a distanza `d`: per ogni spigolo il raggio verso il punto di
 * tangenza è perpendicolare allo spigolo, cioè u·C = u·P = d. Con più di tre spigoli il sistema è sovradeterminato e si
 * risolve ai minimi quadrati. Il raggio è il più grande tra le distanze dai punti, così nessuno resta fuori dalla sfera.
 */
export function cornerSphere(directions: Vec3[], d: number): { center: Vec3; radius: number } | null {
  // Equazioni normali: (Σ u uᵀ) C = d Σ u
  const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) => directions.reduce((sum, u) => sum + u[r] * u[c], 0)));
  const b = [0, 1, 2].map((r) => d * directions.reduce((sum, u) => sum + u[r], 0));
  const center = solve3(m, b);
  if (!center) return null;
  const radius = Math.max(...directions.map((u) => Math.hypot(center[0] - d * u[0], center[1] - d * u[1], center[2] - d * u[2])));
  return { center, radius };
}

export function cornerCutter(p: Source): CornerCutter {
  const d = effectiveDistance(p);
  // Punti sugli spigoli, a distanza d dal vertice (che è l'origine)
  const edgePoints = p.directions.map((u) => [d * u[0], d * u[1], d * u[2]] as Vec3);
  // Il vertice si sposta un poco verso l'esterno, nella direzione opposta alla somma degli spigoli
  const sum = p.directions.reduce((s, u) => [s[0] + u[0], s[1] + u[1], s[2] + u[2]] as Vec3, [0, 0, 0] as Vec3);
  const size = Math.hypot(...sum) || 1;
  const apex = sum.map((c) => (-c / size) * CORNER_OVERSHOOT) as Vec3;
  const points = [apex, ...edgePoints];
  if (p.treatment === 'chamfer') return { points };

  const sphere = cornerSphere(p.directions, d);
  // Con spigoli degeneri (tutti in un piano) la sfera non esiste: si ripiega sul taglio piano
  if (!sphere) return { points };
  return { points, sphere: { ...sphere, segments: Math.max(8, Math.round((p.segments ?? CORNER_SPHERE_SEGMENTS) / 4) * 4) } };
}

