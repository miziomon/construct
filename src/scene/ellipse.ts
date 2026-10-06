import type { PrimitiveNode, Shape2DNode, Vec3 } from './types';

/** Sotto questa soglia due raggi si considerano uguali (forma tonda). */
const SAME = 1e-9;

/** Raggio minimo accettato: evita scale nulle. */
const MIN_RADIUS = 0.01;

/**
 * Fattori di scala [1, y, z] da applicare dopo aver costruito la forma con il raggio X, per ottenere
 * un'ellisse o un ellissoide. Restituisce null se la forma è proporzionale (nessun raggio per asse impostato
 * o uguale a quello X). Usata da kernel e generatore OpenSCAD, così i due restano coerenti.
 */
export function stretchFactors(p: PrimitiveNode | Shape2DNode): Vec3 | null {
  let factors: Vec3 | null = null;

  if (p.type === 'shape2d') {
    if (p.kind === 'circle' && p.radiusY !== undefined) factors = [1, Math.max(MIN_RADIUS, p.radiusY) / Math.max(MIN_RADIUS, p.radius), 1];
  } else if (p.kind === 'cylinder') {
    if (p.radiusY !== undefined) factors = [1, Math.max(MIN_RADIUS, p.radiusY) / Math.max(MIN_RADIUS, p.radius), 1];
  } else if (p.kind === 'cone') {
    // L'estremità più larga ha raggio Y = radiusY: l'altra segue lo stesso rapporto
    const wide = Math.max(p.radiusBottom, p.radiusTop);
    if (p.radiusY !== undefined && wide > 0) factors = [1, Math.max(MIN_RADIUS, p.radiusY) / wide, 1];
  } else if (p.kind === 'sphere') {
    if (p.radiusY !== undefined || p.radiusZ !== undefined) {
      const r = Math.max(MIN_RADIUS, p.radius);
      factors = [1, Math.max(MIN_RADIUS, p.radiusY ?? p.radius) / r, Math.max(MIN_RADIUS, p.radiusZ ?? p.radius) / r];
    }
  }

  if (!factors || factors.every((f) => Math.abs(f - 1) < SAME)) return null;
  return factors;
}
