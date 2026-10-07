import { describe, expect, it } from 'vitest';
import { alignDeltas, mirrorBounds, mirrorPlane, shiftBounds, sideOf, unionBounds } from './placement';
import type { Bounds } from './placement';

const box = (x0: number, x1: number): Bounds => ({ min: [x0, 0, 0], max: [x1, 10, 10] });

describe('calcoli di Allinea e Specchia', () => {
  const a = box(0, 10);
  const b = box(30, 60);

  it('unisce gli ingombri e dà il lato scelto', () => {
    const all = unionBounds([a, b]);
    expect(all).toEqual({ min: [0, 0, 0], max: [60, 10, 10] });
    expect(sideOf(all, 0, 'min')).toBe(0);
    expect(sideOf(all, 0, 'center')).toBe(30);
    expect(sideOf(all, 0, 'max')).toBe(60);
  });

  it('Allinea porta ogni oggetto sul lato scelto dell\'ingombro complessivo', () => {
    expect(alignDeltas({ a, b }, 0, 'min')).toEqual({ a: [0, 0, 0], b: [-30, 0, 0] });
    expect(alignDeltas({ a, b }, 0, 'max')).toEqual({ a: [50, 0, 0], b: [0, 0, 0] });
    // Al centro: i centri (5 e 45) vanno entrambi a 30
    expect(alignDeltas({ a, b }, 0, 'center')).toEqual({ a: [25, 0, 0], b: [-15, 0, 0] });
  });

  it('dopo Allinea gli ingombri spostati coincidono sul lato scelto', () => {
    const deltas = alignDeltas({ a, b }, 0, 'max');
    expect(shiftBounds(a, deltas.a).max[0]).toBe(shiftBounds(b, deltas.b).max[0]);
  });

  it('il piano di specchio passa dal lato scelto e il box riflesso sta dall\'altra parte', () => {
    expect(mirrorPlane([a, b], 0, 'min')).toBe(0);
    expect(mirrorPlane([a, b], 0, 'center')).toBe(30);
    expect(mirrorPlane([a, b], 0, 'max')).toBe(60);
    // Sul bordo sinistro (x = 0): b (30..60) finisce a -60..-30
    expect(mirrorBounds(b, 0, 0)).toEqual({ min: [-60, 0, 0], max: [-30, 10, 10] });
    // Sul centro, a (0..10) si riflette in 50..60
    expect(mirrorBounds(a, 0, 30)).toEqual({ min: [50, 0, 0], max: [60, 10, 10] });
  });

  it('specchiare due volte con lo stesso piano riporta l\'ingombro com\'era', () => {
    expect(mirrorBounds(mirrorBounds(b, 1, 3), 1, 3)).toEqual(b);
  });
});
