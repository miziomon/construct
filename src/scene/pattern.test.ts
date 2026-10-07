import { describe, expect, it } from 'vitest';
import { apply, eulerToMatrix } from './math';
import { localToWorld, worldToLocal } from './patternTool';
import { FACE_DIRECTIONS, defaultPatternParams, faceFrame, faceFromBounds, frameRect, normalizePattern, patternCells, PATTERN_MAX_CELLS, sameFace, thicknessAlong } from './pattern';
import { PATTERN_ALGORITHM } from './voronoi';
import type { PatternParams, Vec3 } from './types';

const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
const params = (patch: Partial<PatternParams> = {}): PatternParams => ({ ...defaultPatternParams(bounds, 7), ...patch });
const near = (a: readonly number[], b: readonly number[], digits = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('facce e riferimento', () => {
  it('faceFromBounds: la faccia al centro del lato scelto, con lo spessore lungo l\'asse', () => {
    expect(faceFromBounds(bounds, 'z+')).toEqual({ origin: [0, 0, 2.5], normal: [0, 0, 1], thickness: 5 });
    expect(faceFromBounds(bounds, 'x-')).toEqual({ origin: [-40, 0, 0], normal: [-1, 0, 0], thickness: 80 });
    expect(faceFromBounds(bounds, 'y+').normal).toEqual([0, 1, 0]);
  });

  it('thicknessAlong dà lo spessore anche per una normale obliqua', () => {
    expect(thicknessAlong(bounds, [0, 0, 1])).toBe(5);
    expect(thicknessAlong(bounds, [1, 0, 0])).toBe(80);
    const diag = Math.SQRT1_2;
    expect(thicknessAlong(bounds, [diag, diag, 0])).toBeCloseTo((80 + 60) * diag, 6);
  });

  it('il riferimento della faccia porta la normale su +Z per tutte le direzioni e per una normale obliqua', () => {
    const faces = [...FACE_DIRECTIONS.map((d) => faceFromBounds(bounds, d)), { origin: [1, 2, 3] as Vec3, normal: [1, 2, -3] as Vec3, thickness: 4 }];
    for (const face of faces) {
      const frame = faceFrame(face);
      const n = Math.hypot(...face.normal);
      near(apply(frame.matrix, face.normal.map((v) => v / n) as Vec3), [0, 0, 1]);
      // Gli angoli di Q e della sua inversa si annullano a vicenda
      expect(frame.euler).toHaveLength(3);
    }
  });

  it('frameRect contiene l\'ingombro nel riferimento della faccia', () => {
    const rect = frameRect(params());
    expect(rect.maxX - rect.minX).toBeGreaterThanOrEqual(80);
    expect(rect.maxY - rect.minY).toBeGreaterThanOrEqual(60);
    // Una faccia laterale ha un rettangolo diverso (60 × 5 al posto di 80 × 60)
    const side = frameRect(params({ faces: [faceFromBounds(bounds, 'x+')] }));
    expect(Math.min(side.maxX - side.minX, side.maxY - side.minY)).toBeLessThan(10);
  });
});

describe('parametri', () => {
  it('i valori di partenza sono sensati per un pannello 80 × 60', () => {
    const p = defaultPatternParams(bounds, 123);
    expect(p).toMatchObject({ algorithm: PATTERN_ALGORITHM, kind: 'voronoi', mode: 'holes', seed: 123, depth: 0, sides: 'one' });
    expect(p.cells).toBeGreaterThanOrEqual(8);
    expect(p.cells).toBeLessThanOrEqual(80);
    expect(p.margin).toBeGreaterThanOrEqual(2);
    expect(p.wall).toBeGreaterThan(0.8);
  });

  it('normalizePattern porta tutto dentro i limiti', () => {
    const n = normalizePattern(params({ cells: 99999, regularity: 400, size: 0, wall: -3, rounding: -1, margin: -5, depth: -2, seed: -4, faces: [{ origin: [0, 0, 0], normal: [0, 0, 0], thickness: -1 }] }));
    expect(n.cells).toBe(PATTERN_MAX_CELLS);
    expect(n.regularity).toBe(100);
    expect(n.size).toBeGreaterThanOrEqual(2);
    expect(n.wall).toBeGreaterThan(0);
    expect([n.rounding, n.margin, n.depth, n.seed]).toEqual([0, 0, 0, 0]);
    expect(n.faces).toHaveLength(1);
    expect(n.faces[0].normal).toEqual([0, 0, 1]);
    expect(n.faces[0].thickness).toBeGreaterThan(0);
  });
});

describe('celle del pattern', () => {
  const rect = { minX: 0, minY: 0, maxX: 100, maxY: 60 };

  it('esagoni: celle a sei lati che coprono il rettangolo, con il passo dato', () => {
    const cells = patternCells(params({ kind: 'hexagon', size: 12 }), rect);
    expect(cells.every((c) => c.length === 6)).toBe(true);
    // Area di un esagono con apotema 6: 2·√3·6² ≈ 124,7; circa 100·60 / 124,7 ≈ 48 celle più il bordo
    expect(cells.length).toBeGreaterThan(48);
    expect(cells.length).toBeLessThan(120);
    // Ogni punto del rettangolo cade in almeno una cella: lo si verifica sul centro
    const cx = 50;
    const cy = 30;
    const contains = (poly: [number, number][]) => poly.every((a, i) => {
      const b = poly[(i + 1) % poly.length];
      return (b[0] - a[0]) * (cy - a[1]) - (b[1] - a[1]) * (cx - a[0]) >= -1e-6;
    });
    expect(cells.some(contains)).toBe(true);
  });

  it('cerchi: poligoni a 32 lati e rotazione della griglia', () => {
    const cells = patternCells(params({ kind: 'circle', size: 10 }), rect);
    expect(cells.every((c) => c.length === 32)).toBe(true);
    const turned = patternCells(params({ kind: 'circle', size: 10, angle: 30 }), rect);
    expect(turned).not.toEqual(cells);
  });

  it('il passo si allarga se servirebbero troppe celle', () => {
    const cells = patternCells(params({ kind: 'hexagon', size: 2 }), { minX: 0, minY: 0, maxX: 500, maxY: 500 });
    expect(cells.length).toBeLessThan(2500);
  });

  it('Voronoi: tante celle quante richieste, riproducibili con il seme', () => {
    const p = params({ kind: 'voronoi', cells: 25, seed: 5 });
    const a = patternCells(p, rect);
    expect(a).toHaveLength(25);
    expect(patternCells(p, rect)).toEqual(a);
    expect(patternCells({ ...p, seed: 6 }, rect)).not.toEqual(a);
    // Ogni faccia ha il suo disegno: l'indice cambia il seme
    expect(patternCells(p, rect, 1)).not.toEqual(a);
  });
});

describe('rombi, triangoli e più facce', () => {
  const rect = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
  const area = (poly: [number, number][]) => Math.abs(poly.reduce((sum, a, i) => { const b = poly[(i + 1) % poly.length]; return sum + (a[0] * b[1] - b[0] * a[1]); }, 0) / 2);

  it('rombi: quattro lati, area mezzo passo al quadrato, e coprono il rettangolo', () => {
    const cells = patternCells(params({ kind: 'diamond', size: 10 }), rect);
    expect(cells.every((c) => c.length === 4)).toBe(true);
    expect(area(cells[0])).toBeCloseTo(50, 3);
    // Con celle che si toccano, la somma delle aree di quelle che toccano il rettangolo lo copre almeno tutto
    expect(cells.reduce((s, c) => s + area(c), 0)).toBeGreaterThanOrEqual(100 * 60);
  });

  it('triangoli: equilateri con lato uguale al passo, punta su e punta giù alternati', () => {
    const cells = patternCells(params({ kind: 'triangle', size: 12 }), rect);
    expect(cells.every((c) => c.length === 3)).toBe(true);
    expect(area(cells[0])).toBeCloseTo((Math.sqrt(3) / 4) * 144, 2);
    expect(cells.reduce((s, c) => s + area(c), 0)).toBeGreaterThanOrEqual(100 * 60);
    // Rotazione di 30 gradi: altre posizioni
    expect(patternCells(params({ kind: 'triangle', size: 12, angle: 30 }), rect)).not.toEqual(cells);
  });

  it('normalizePattern converte i progetti della 0.20.0: face diventa faces e il reticolo diventa Voronoi', () => {
    const old = { ...params(), kind: 'lattice', face: faceFromBounds(bounds, 'x+') } as unknown as PatternParams;
    delete (old as { faces?: unknown }).faces;
    const n = normalizePattern(old);
    expect(n.kind).toBe('voronoi');
    expect(n.faces).toEqual([faceFromBounds(bounds, 'x+')]);
    expect(n.face).toBeUndefined();
  });

  it('le facce uguali non si ripetono e sameFace confronta normale e piano', () => {
    const top = faceFromBounds(bounds, 'z+');
    expect(normalizePattern(params({ faces: [top, { ...top }, faceFromBounds(bounds, 'z-')] })).faces).toHaveLength(2);
    expect(sameFace(top, faceFromBounds(bounds, 'z-'))).toBe(false);
    expect(sameFace(top, { ...top, origin: [5, -3, 2.5] })).toBe(true);
  });
});

describe('dal mondo al gruppo', () => {
  it('worldToLocal inverte posizione, rotazione e specchio del gruppo', () => {
    const world = { position: [10, 20, 30] as Vec3, rotation: [0, 0, 90] as Vec3, mirror: [true, false, false] as [boolean, boolean, boolean] };
    // Un punto locale portato nel mondo (x = R·D·x_local + p) e poi di nuovo nel locale
    const local: Vec3 = [3, -4, 5];
    const d: Vec3 = [-local[0], local[1], local[2]];
    const rotated = apply(eulerToMatrix(world.rotation), d);
    near(worldToLocal(world, rotated.map((v, i) => v + world.position[i]) as Vec3, true), local);
    // Una direzione non risente della traslazione
    near(worldToLocal(world, rotated, false), local);
    // E il percorso inverso
    near(localToWorld(world, local, true), rotated.map((v, i) => v + world.position[i]));
    near(localToWorld(world, local, false), rotated);
  });
});
