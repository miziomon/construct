import { describe, expect, it } from 'vitest';
import { defaultPatternParams, normalizePattern, patternRelief } from '../../scene/pattern';
import type { PatternParams, Vec3 } from '../../scene/types';
import { NODES_PER_CELL, SLOW_PREVIEW_CELLS, estimatedCells, estimatedNodes, usePatternTool } from './patternToolStore';

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

describe('strumento Pattern: i gruppi di campi si conservano cambiando tipo', () => {
  const start = (patch: Partial<PatternParams>) => usePatternTool.setState({ active: true, targetId: null, picking: false, params: normalizePattern(params([80, 60, 5], patch)) });
  const current = () => usePatternTool.getState().params!;

  it("Immagine: l'immagine caricata e la texture tornano dopo un tipo a celle; il Pattern salvato (normalizzato) non li porta", () => {
    start({ kind: 'texture', imageId: 'img-abc', sample: undefined, texture: { tile: 33, repeat: false, rotation: 10, offset: [1, 2], invert: true, midlevel: 0.3, amplitude: 0.9, blur: 2, mode: 'both' } });
    usePatternTool.getState().setParams({ kind: 'hexagon' });
    expect(current().kind).toBe('hexagon');
    expect(current().imageId).toBe('img-abc');
    // Quello che si salva e finisce nella chiave di cache non ha i campi dell'altro gruppo
    expect(normalizePattern(current())).not.toHaveProperty('texture');
    expect(normalizePattern(current()).imageId).toBeUndefined();
    usePatternTool.getState().setParams({ kind: 'texture' });
    expect(current().imageId).toBe('img-abc');
    expect(current().texture).toMatchObject({ tile: 33, repeat: false, mode: 'both', invert: true });
    // Un rilievo, poi di nuovo l'Immagine: ancora lì
    usePatternTool.getState().setParams({ kind: 'brick' });
    expect(current().imageId).toBe('img-abc');
    usePatternTool.getState().setParams({ kind: 'texture' });
    expect(current().texture!.tile).toBe(33);
  });

  it("Rilievo: disegno e misure tornano dopo un tipo a celle o dopo l'Immagine", () => {
    start({ kind: 'brick', design: 'basket', relief: { kind: 'brick', brickW: 30, brickH: 10, mortar: 2, depth: 1, design: 'basket' } });
    usePatternTool.getState().setParams({ kind: 'voronoi' });
    expect(current().design).toBe('basket');
    usePatternTool.getState().setParams({ kind: 'texture' });
    expect(current().design).toBe('basket');
    usePatternTool.getState().setParams({ kind: 'brick' });
    expect(current().design).toBe('basket');
    expect(patternRelief(current()).relief).toMatchObject({ brickW: 30, brickH: 10, mortar: 2, depth: 1 });
    // Una modifica del tipo corrente prevale sul valore conservato
    usePatternTool.getState().setParams({ design: 'herringbone' });
    expect(current().design).toBe('herringbone');
  });

  it('le altre modifiche (margine) non perdono i campi dei gruppi', () => {
    start({ kind: 'texture', imageId: 'img-xyz', sample: undefined });
    usePatternTool.getState().setParams({ kind: 'diamond' });
    usePatternTool.getState().setParams({ margin: 3 });
    expect(current().imageId).toBe('img-xyz');
    expect(current().margin).toBe(3);
  });
});
