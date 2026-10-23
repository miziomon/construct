import { describe, expect, it } from 'vitest';
import { defaultPatternParams } from '../../scene/pattern';
import type { PatternParams, Vec3 } from '../../scene/types';
import { NODES_PER_CELL, SLOW_PREVIEW_CELLS, estimatedCells, estimatedNodes } from './patternToolStore';

const params = (size: Vec3, patch: Partial<PatternParams>): PatternParams => {
  const bounds = { min: size.map((v) => -v / 2) as Vec3, max: size.map((v) => v / 2) as Vec3 };
  return { ...defaultPatternParams(bounds, 3), ...patch };
};

describe('stima del lavoro del Pattern', () => {
  it('Legno: nodi della mappa dell\'anteprima (area / passo²) e celle equivalenti; l\'avviso compare prima del calcolo su una faccia grande', () => {
    const small = params([80, 60, 5], { kind: 'wood' });
    const big = params([300, 300, 5], { kind: 'wood' });
    // 82 × 62 mm a passo 0,8: circa 8.000 nodi, ben sotto la soglia
    expect(estimatedNodes(small)).toBeGreaterThan(7000);
    expect(estimatedNodes(small)).toBeLessThan(9000);
    expect(estimatedCells(small)).toBe(Math.ceil(estimatedNodes(small) / NODES_PER_CELL));
    expect(estimatedCells(small)).toBeLessThan(SLOW_PREVIEW_CELLS);
    // 302 × 302 mm: circa 143.000 nodi, sopra la soglia
    expect(estimatedNodes(big)).toBeGreaterThan(130_000);
    expect(estimatedCells(big)).toBeGreaterThan(SLOW_PREVIEW_CELLS);
    // Più facce: si sommano; senza venatura non c'è mappa
    const two = { ...big, faces: [big.faces[0], { ...big.faces[0], normal: [0, 0, -1] as Vec3 }] };
    expect(estimatedNodes(two)).toBeCloseTo(2 * estimatedNodes(big), -2);
    expect(estimatedNodes({ ...big, relief: { kind: 'wood', grainDepth: 0 } as PatternParams['relief'] })).toBe(0);
  });

  it('Rame battuto: calotte (al più 500 per faccia); gli altri rilievi sono leggeri; i tipi a celle come prima', () => {
    expect(estimatedCells(params([80, 60, 5], { kind: 'hammered' }))).toBeLessThan(SLOW_PREVIEW_CELLS);
    expect(estimatedCells(params([300, 300, 5], { kind: 'hammered' }))).toBe(500);
    expect(estimatedCells(params([300, 300, 5], { kind: 'brick' }))).toBe(0);
    expect(estimatedCells(params([300, 300, 5], { kind: 'studs' }))).toBe(0);
    expect(estimatedCells(params([300, 300, 5], { kind: 'voronoi', cells: 40 }))).toBe(40);
    expect(estimatedCells(params([300, 300, 5], { kind: 'hexagon' }))).toBe(60);
  });
});
