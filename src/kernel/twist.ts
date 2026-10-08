import type { Vec2 } from 'manifold-3d';

/**
 * Estrusione con torsione: ogni lato del profilo diventa una striscia di quadrilateri che si torcono, e manifold li
 * spezza in due triangoli. Su un lato lungo (un profilo sottile, 120 × 5 mm) la striscia è molto storta e il solido
 * esce gonfio o svuotato fino al 14% a seconda del verso della torsione. Spezzando i lati in tratti corti ogni
 * quadrilatero è quasi piano e l'errore scende sotto l'1% (OpenSCAD fa lo stesso, con molti più triangoli).
 */

/** Tratto massimo di un lato: l'altezza di uno strato, ma mai meno di mezzo millimetro. */
export const twistPieceLength = (height: number, divisions: number): number => Math.max(0.5, height / Math.max(1, divisions));

/** Vertici al massimo, per non rallentare profili complessi (testo, SVG): punti del profilo × strati. */
const MAX_SOLID_POINTS = 400_000;

/**
 * Spezza ogni lato dei contorni in tratti non più lunghi di `piece` mm (se serve, più lunghi, per restare entro il
 * limite di vertici). I vertici originali restano e ne vengono aggiunti di intermedi, sulla stessa retta.
 */
export function subdivideContours(contours: Vec2[][], piece: number, layers: number): Vec2[][] {
  const edgeLength = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const total = contours.reduce((sum, c) => sum + c.reduce((s, p, i) => s + edgeLength(p, c[(i + 1) % c.length]), 0), 0);
  // Con il limite di vertici il tratto cresce: punti ammessi per strato = limite / strati
  const budget = Math.max(1, Math.floor(MAX_SOLID_POINTS / Math.max(1, layers)));
  const step = Math.max(piece, total / budget);
  return contours.map((contour) =>
    contour.flatMap((p, i) => {
      const q = contour[(i + 1) % contour.length];
      const parts = Math.max(1, Math.ceil(edgeLength(p, q) / step));
      // Il primo punto del lato e quelli intermedi: l'ultimo è il primo del lato seguente
      return Array.from({ length: parts }, (_, k) => [p[0] + ((q[0] - p[0]) * k) / parts, p[1] + ((q[1] - p[1]) * k) / parts] as Vec2);
    }),
  );
}
