import { describe, expect, it } from 'vitest';
import { ARRAY_MAX_COPIES, arrayCopies, arrayCopyCount, circularStep, defaultArrayParams, linearStep, normalizeArray } from './arrayPattern';
import type { ArrayParams } from './types';

const params = (patch: Partial<ArrayParams> = {}): ArrayParams => ({ ...defaultArrayParams(), ...patch });
const near = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('Ripetizione: parametri', () => {
  it('i valori di partenza sono una fila di cinque copie con un po\' d\'aria tra l\'una e l\'altra', () => {
    const p = defaultArrayParams({ size: [20, 10, 5] });
    expect(p).toMatchObject({ kind: 'linear', count: 5, spacing: 'step', includeOriginal: true, rotateCopies: true, angle: 360, axis: 2 });
    // Il passo supera il lato (così le copie non si toccano) e l'asse circolare sta a sinistra dell'oggetto
    expect(p.step[0]).toBeGreaterThan(20);
    expect(p.center[0]).toBeLessThan(-10);
  });

  it('normalizeArray porta tutto dentro i limiti e al massimo 200 copie in griglia', () => {
    const n = normalizeArray(params({ count: 9999, counts: [50, 50, 50], angle: 0, axis: 7 as never, step: [Number.NaN, 1, 2] }));
    expect(n.count).toBe(ARRAY_MAX_COPIES);
    expect(n.counts[0] * n.counts[1] * n.counts[2]).toBeLessThanOrEqual(ARRAY_MAX_COPIES);
    expect(n.angle).toBe(1);
    expect(n.axis).toBe(2);
    expect(n.step).toEqual([0, 1, 2]);
    expect(normalizeArray(params({ count: 0 })).count).toBe(1);
    expect(normalizeArray(params({ counts: [2.6, 1, 1] })).counts).toEqual([3, 1, 1]);
  });
});

describe('Ripetizione: copie', () => {
  it('lineare: una copia ogni passo, la prima è l\'originale e si può escluderla', () => {
    const copies = arrayCopies(params({ count: 3, step: [10, 0, 5] }));
    expect(copies.map((c) => c.translate)).toEqual([[0, 0, 0], [10, 0, 5], [20, 0, 10]]);
    expect(arrayCopies(params({ count: 3, step: [10, 0, 5], includeOriginal: false })).map((c) => c.translate)).toEqual([[10, 0, 5], [20, 0, 10]]);
    expect(arrayCopyCount(params({ count: 3, includeOriginal: false }))).toBe(2);
  });

  it('lineare con spazio totale: il vettore va dalla prima all\'ultima copia', () => {
    const p = params({ count: 5, step: [100, 0, 0], spacing: 'total' });
    expect(linearStep(p)).toEqual([25, 0, 0]);
    expect(arrayCopies(p).at(-1)!.translate).toEqual([100, 0, 0]);
    // Con una sola copia non c'è nulla da dividere
    expect(linearStep(params({ count: 1, step: [100, 0, 0], spacing: 'total' }))).toEqual([100, 0, 0]);
  });

  it('griglia: righe, colonne e livelli (X, poi Y, poi Z), anche con passi diversi', () => {
    const copies = arrayCopies(params({ kind: 'grid', counts: [2, 3, 2], gridStep: [10, 20, 30] }));
    expect(copies).toHaveLength(12);
    expect(copies[0].translate).toEqual([0, 0, 0]);
    expect(copies.at(-1)!.translate).toEqual([10, 40, 30]);
    expect(arrayCopyCount(params({ kind: 'grid', counts: [4, 5, 1] }))).toBe(20);
  });

  it('circolare con giro completo: il passo è 360 / copie e l\'ultima non ricade sulla prima', () => {
    const p = params({ kind: 'circular', count: 4, angle: 360, axis: 2 });
    expect(circularStep(p)).toBe(90);
    expect(arrayCopies(p).map((c) => c.rotation[2])).toEqual([0, 90, 180, 270]);
  });

  it('circolare ad arco: dalla prima all\'ultima copia, sull\'asse scelto', () => {
    const p = params({ kind: 'circular', count: 4, angle: 90, axis: 0 });
    expect(circularStep(p)).toBe(30);
    expect(arrayCopies(p).map((c) => c.rotation[0])).toEqual([0, 30, 60, 90]);
    expect(circularStep(params({ kind: 'circular', count: 1, angle: 90 }))).toBe(0);
  });

  it('circolare con le copie non ruotate: si spostano di (I − R)·centro, come l\'originale lungo la circonferenza', () => {
    const copies = arrayCopies(params({ kind: 'circular', count: 4, angle: 360, axis: 2, center: [-30, 0, 0], rotateCopies: false }));
    // Passo 90°: R·(-30, 0, 0) = (0, -30, 0): spostamento = c − R·c = (-30, 30, 0)
    near(copies[1].translate, [-30, 30, 0]);
    near(copies[2].translate, [-60, 0, 0]);
    near(copies[3].translate, [-30, -30, 0]);
    expect(copies.every((c) => c.rotation.every((v) => v === 0))).toBe(true);
    // Con le copie ruotate invece resta la rotazione attorno al centro
    const turned = arrayCopies(params({ kind: 'circular', count: 4, center: [-30, 0, 0], rotateCopies: true }));
    expect(turned[1]).toMatchObject({ pivot: [-30, 0, 0], rotation: [0, 0, 90], translate: [0, 0, 0] });
  });
});
