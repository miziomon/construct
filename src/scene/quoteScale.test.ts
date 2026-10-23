import { describe, expect, it } from 'vitest';
import { pathScaleFactors, quoteScaleWarning } from './quoteScale';
import { shape2dDefaults } from './defaults';
import type { ProfileConstraint, Shape2DNode } from './types';

type PathShape = Extract<Shape2DNode, { kind: 'path' }>;

const rect = { closed: true, nodes: [{ p: [0, 0] as [number, number], kind: 'corner' as const }, { p: [40, 0] as [number, number], kind: 'corner' as const }, { p: [40, 20] as [number, number], kind: 'corner' as const }, { p: [0, 20] as [number, number], kind: 'corner' as const }] };
const make = (patch: Partial<PathShape> = {}): PathShape => ({ ...shape2dDefaults('path'), id: 'p', name: 'Profilo', position: [0, 0, 0], paths: [rect], width: 40, depth: 20, ...patch }) as PathShape;
const dist: ProfileConstraint = { id: 'k1', t: 'dist', p: ['n1', 'n2'], v: 40 };

describe('ridimensionamento di un Profilo con quote', () => {
  it('i fattori sono quelli di larghezza e profondità rispetto alle misure naturali dei nodi; alla misura naturale non ce n\'è', () => {
    expect(pathScaleFactors(make())).toBeNull();
    expect(pathScaleFactors(make({ width: 80, depth: 30 }))).toEqual({ sx: 2, sy: 1.5 });
    expect(pathScaleFactors(make({ width: 40.0001 }))).toBeNull();
    // Una linea (profondità naturale nulla) non si può scalare: nessun fattore
    const line = { closed: false, nodes: [{ p: [0, 0] as [number, number], kind: 'corner' as const }, { p: [40, 0] as [number, number], kind: 'corner' as const }] };
    expect(pathScaleFactors(make({ paths: [line], depth: 5 }))).toBeNull();
  });

  it('l\'avviso dice i fattori e il valore della prima quota pilotante che non si aggiorna', () => {
    const scaled = make({ width: 80, depth: 40, constraints: [{ id: 'k0', t: 'horizontal', p: ['n1', 'n2'] }, { ...dist, id: 'r', v: 99, ref: true }, dist] });
    expect(quoteScaleWarning(scaled, 'Il profilo')).toBe('Il profilo: ridimensionato ×2 in X e ×2 in Y. Le quote non si aggiornano: 40 mm resta il valore salvato');
    expect(quoteScaleWarning(make({ width: 60, depth: 20, constraints: [dist] }), '«Staffa»')).toContain('×1,5 in X e ×1 in Y');
    expect(quoteScaleWarning(make({ width: 60, depth: 20, constraints: [{ id: 'a', t: 'angle', p: ['n1', 'n2'], v: 30 }] }), 'x')).toContain('30° resta');
  });

  it('nessun avviso senza quote pilotanti o senza ridimensionamento', () => {
    expect(quoteScaleWarning(make({ width: 80 }), 'x')).toBeNull();
    expect(quoteScaleWarning(make({ width: 80, constraints: [{ id: 'k', t: 'horizontal', p: ['n1', 'n2'] }] }), 'x')).toBeNull();
    expect(quoteScaleWarning(make({ width: 80, constraints: [{ ...dist, ref: true }] }), 'x')).toBeNull();
    expect(quoteScaleWarning(make({ constraints: [dist] }), 'x')).toBeNull();
  });
});
