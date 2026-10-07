import { describe, expect, it } from 'vitest';
import { mulberry32, polygonCentroid, randomPoints, randomVoronoi, relax, voronoiCells } from './voronoi';
import type { Rect, Vec2 } from './voronoi';

const rect: Rect = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
const area = (rect: Rect) => (rect.maxX - rect.minX) * (rect.maxY - rect.minY);

/** Punto dentro un poligono convesso (stesso verso dei lati). */
const inside = (poly: Vec2[], p: Vec2) => poly.every((a, i) => {
  const b = poly[(i + 1) % poly.length];
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
});

describe('generatore casuale', () => {
  it('è riproducibile con lo stesso seme e diverso con un altro', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = (g: () => number) => Array.from({ length: 5 }, g);
    expect(seq(a)).toEqual(seq(b));
    expect(seq(mulberry32(43))).not.toEqual(seq(mulberry32(42)));
    expect(seq(mulberry32(1)).every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('randomPoints dà sempre il numero richiesto, dentro il rettangolo, e rispetta la distanza minima quando può', () => {
    const points = randomPoints(40, rect, 5, 8);
    expect(points).toHaveLength(40);
    expect(points.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 60)).toBe(true);
    const closest = Math.min(...points.flatMap((p, i) => points.slice(i + 1).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
    expect(closest).toBeGreaterThanOrEqual(8 - 1e-9);
    // Se la distanza chiesta è impossibile i punti sono comunque tutti
    expect(randomPoints(200, rect, 5, 50)).toHaveLength(200);
  });
});

describe('Voronoi 2D', () => {
  it('le celle riempiono il rettangolo senza sovrapporsi e contengono il loro punto', () => {
    const points = randomPoints(60, rect, 11, 0);
    const cells = voronoiCells(points, rect);
    expect(cells).toHaveLength(60);
    const total = cells.reduce((s, c) => s + Math.abs(polygonCentroid(c).area), 0);
    expect(total).toBeCloseTo(area(rect), 4);
    cells.forEach((c, i) => expect(inside(c, points[i])).toBe(true));
  });

  it('con un solo punto la cella è tutto il rettangolo', () => {
    const [cell] = voronoiCells([[30, 20]], rect);
    expect(Math.abs(polygonCentroid(cell).area)).toBeCloseTo(area(rect), 6);
  });

  it('il rilassamento di Lloyd rende le celle più uniformi', () => {
    const points = randomPoints(50, rect, 3, 0);
    const spread = (pts: Vec2[]) => {
      const areas = voronoiCells(pts, rect).map((c) => Math.abs(polygonCentroid(c).area));
      const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
      return Math.sqrt(areas.reduce((s, a) => s + (a - mean) ** 2, 0) / areas.length) / mean;
    };
    expect(spread(relax(points, rect, 4))).toBeLessThan(spread(points));
  });

  it('randomVoronoi è deterministico, cambia con il seme e con la regolarità', () => {
    const a = randomVoronoi(30, rect, 9, 40);
    expect(randomVoronoi(30, rect, 9, 40)).toEqual(a);
    expect(randomVoronoi(30, rect, 10, 40)).not.toEqual(a);
    expect(randomVoronoi(30, rect, 9, 90)).not.toEqual(a);
    expect(a).toHaveLength(30);
  });
});
