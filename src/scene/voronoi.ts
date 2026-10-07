/**
 * Voronoi 2D casuale e riproducibile (funzioni pure, senza dipendenze). Il generatore dei numeri casuali e l'ordine delle
 * operazioni sono fissi (`PATTERN_ALGORITHM`): a parità di seme e parametri il disegno è sempre lo stesso, anche nei
 * progetti salvati e nel codice OpenSCAD.
 */

export type Vec2 = [number, number];

/** Rettangolo in cui si costruiscono le celle. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Versione dell'algoritmo casuale: se cambia, i vecchi progetti darebbero un disegno diverso (vedi `PatternParams.algorithm`). */
export const PATTERN_ALGORITHM = 1;

/** Generatore pseudo-casuale mulberry32: numeri tra 0 (compreso) e 1 (escluso) dal seme dato. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rectArea = (r: Rect) => (r.maxX - r.minX) * (r.maxY - r.minY);

/**
 * `count` punti casuali nel rettangolo. `minDistance` (mm, 0 = nessun limite) è la distanza minima desiderata tra due
 * punti (campionamento a dardi): se dopo molti tentativi non entra più nulla, il punto si accetta lo stesso, quindi il
 * numero di punti è sempre `count`.
 */
export function randomPoints(count: number, rect: Rect, seed: number, minDistance = 0): Vec2[] {
  const random = mulberry32(seed);
  const points: Vec2[] = [];
  const min2 = minDistance * minDistance;
  for (let i = 0; i < count; i++) {
    let candidate: Vec2 = [0, 0];
    for (let attempt = 0; attempt < 30; attempt++) {
      candidate = [rect.minX + random() * (rect.maxX - rect.minX), rect.minY + random() * (rect.maxY - rect.minY)];
      if (min2 === 0 || points.every((p) => (p[0] - candidate[0]) ** 2 + (p[1] - candidate[1]) ** 2 >= min2)) break;
    }
    points.push(candidate);
  }
  return points;
}

/** Ritaglia il poligono tenendo i punti con `(p − mid)·dir ≤ 0` (Sutherland–Hodgman su un solo semipiano). */
function clipHalfPlane(poly: Vec2[], mid: Vec2, dir: Vec2): Vec2[] {
  const side = (p: Vec2) => (p[0] - mid[0]) * dir[0] + (p[1] - mid[1]) * dir[1];
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) out.push(a);
    // Il lato attraversa la retta: si aggiunge il punto di intersezione
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * Celle di Voronoi dei punti, ritagliate sul rettangolo (una per punto, nello stesso ordine). Ogni cella parte dal
 * rettangolo e si ritaglia con il piano di mezzeria dei punti vicini, dal più vicino al più lontano, fermandosi quando i
 * punti restanti sono troppo lontani per toccarla: per qualche centinaio di punti costa pochi millisecondi.
 */
export function voronoiCells(points: Vec2[], rect: Rect): Vec2[][] {
  const corners: Vec2[] = [[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.maxX, rect.maxY], [rect.minX, rect.maxY]];
  return points.map((p, i) => {
    let poly = corners;
    // Gli altri punti per distanza crescente da p
    const others = points
      .map((q, j) => ({ j, d2: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d2 - b.d2 || a.j - b.j);
    let reach2 = Infinity;
    for (const { j, d2 } of others) {
      // Un punto a distanza d agisce solo se la cella arriva fino a d/2: oltre il doppio del raggio della cella non conta
      if (d2 / 4 > reach2) break;
      const q = points[j];
      poly = clipHalfPlane(poly, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], [q[0] - p[0], q[1] - p[1]]);
      if (poly.length < 3) return [];
      reach2 = Math.max(...poly.map((v) => (v[0] - p[0]) ** 2 + (v[1] - p[1]) ** 2));
    }
    return poly;
  });
}

/** Area e baricentro di un poligono semplice. */
export function polygonCentroid(poly: Vec2[]): { area: number; centroid: Vec2 } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-12) return { area: 0, centroid: poly[0] ?? [0, 0] };
  return { area: a / 2, centroid: [cx / (3 * a), cy / (3 * a)] };
}

/** Rilassamento di Lloyd: ogni punto si sposta nel baricentro della sua cella, `iterations` volte (celle più uniformi). */
export function relax(points: Vec2[], rect: Rect, iterations: number): Vec2[] {
  let current = points;
  for (let k = 0; k < iterations; k++) {
    const cells = voronoiCells(current, rect);
    current = current.map((p, i) => (cells[i].length >= 3 ? polygonCentroid(cells[i]).centroid : p));
  }
  return current;
}

/**
 * Le celle di un Voronoi casuale: `count` punti con il seme, regolarità 0–100 % (0 = casuale puro; più alta = punti più
 * distanziati e più rilassamenti di Lloyd, quindi celle più uniformi). Restituisce poligoni sul rettangolo.
 */
export function randomVoronoi(count: number, rect: Rect, seed: number, regularity: number): Vec2[][] {
  const r = Math.min(100, Math.max(0, regularity)) / 100;
  // Distanza minima tra i punti: frazione del lato medio di una cella (fino a 0,8 · √(area/celle))
  const minDistance = 0.8 * r * Math.sqrt(rectArea(rect) / Math.max(1, count));
  const points = relax(randomPoints(count, rect, seed, minDistance), rect, Math.round(r * 4));
  return voronoiCells(points, rect).filter((c) => c.length >= 3);
}
