import { describe, expect, it } from 'vitest';
import {
  MAX_CONTOUR_SAMPLES,
  MAX_PATH_SAMPLES,
  bboxOf,
  cubicExtrema,
  cubicPoint,
  decodePathMeta,
  encodePathMeta,
  flattenCubic,
  sampleContour,
  samplePaths,
  sanitizePaths,
  segmentOf,
  selfIntersections,
  signedArea,
  splitCubic,
  type Cubic,
} from './bezier';
import type { PathContour, PathNode, Vec2 } from './types';

const node = (p: Vec2, out?: Vec2, inn?: Vec2, kind: PathNode['kind'] = 'corner'): PathNode => ({ p, ...(inn ? { in: inn } : {}), ...(out ? { out } : {}), kind });

/** Quarto di cerchio di raggio 50 (da (50, 0) a (0, 50)) con la costante k = 0,5523 delle maniglie. */
const K = 0.5523;
const quarter: PathContour = { closed: false, nodes: [node([50, 0], [0, 50 * K]), node([0, 50], undefined, [50 * K, 0])] };

/** Curva a S: y(t) = 180 t (1 − t)(1 − 2t), con estremi in y = ±10√3 e x monotona da 0 a 100. */
const sCurve: PathContour = { closed: false, nodes: [node([0, 0], [40, 60]), node([100, 0], undefined, [-40, -60])] };

describe('segmenti e cubiche', () => {
  it('un segmento senza maniglie è retto e un contorno chiuso torna al primo nodo', () => {
    const square: PathContour = { closed: true, nodes: [node([0, 0]), node([10, 0]), node([10, 10])] };
    expect(segmentOf(square, 0).straight).toBe(true);
    // L'ultimo segmento va dall'ultimo nodo al primo
    expect(segmentOf(square, 2).cubic[3]).toEqual([0, 0]);
    // Basta una maniglia da un lato perché il segmento sia curvo
    expect(segmentOf(quarter, 0).straight).toBe(false);
  });

  it('un segmento retto campiona solo i suoi estremi', () => {
    const line: PathContour = { closed: false, nodes: [node([0, 0]), node([30, 40])] };
    expect(sampleContour(line, 0.05)).toEqual([[0, 0], [30, 40]]);
  });

  it('splitCubic: le due metà descrivono la stessa curva', () => {
    const c = segmentOf(sCurve, 0).cubic;
    const [a, b] = splitCubic(c, 0.3);
    for (const s of [0, 0.25, 0.5, 1]) {
      const left = cubicPoint(a, s);
      const right = cubicPoint(b, s);
      const l0 = cubicPoint(c, 0.3 * s);
      const r0 = cubicPoint(c, 0.3 + 0.7 * s);
      expect(left[0]).toBeCloseTo(l0[0], 9);
      expect(left[1]).toBeCloseTo(l0[1], 9);
      expect(right[0]).toBeCloseTo(r0[0], 9);
      expect(right[1]).toBeCloseTo(r0[1], 9);
    }
  });

  it('cubicExtrema trova gli estremi in y della curva a S e nessuno in x', () => {
    const ts = cubicExtrema(segmentOf(sCurve, 0).cubic);
    expect(ts).toHaveLength(2);
    expect(ts[0]).toBeCloseTo(0.5 - Math.sqrt(12) / 12, 9);
    expect(ts[1]).toBeCloseTo(0.5 + Math.sqrt(12) / 12, 9);
  });

  it('la planarità si misura dal segmento, non dalla retta: maniglie oltre gli estremi non sono piatte', () => {
    // Controlli sulla retta P0-P3 ma fuori dal segmento: la curva fa un'andata e ritorno e non è un tratto retto
    const c: Cubic = [[0, 0], [20, 0], [-10, 0], [10, 0]];
    const out: Vec2[] = [];
    flattenCubic(c, 0.05, out);
    expect(out.length).toBeGreaterThan(1);
  });
});

describe('campionamento', () => {
  it('quarto di cerchio R = 50: errore entro la tolleranza e vertici sulla curva', () => {
    const points = sampleContour(quarter, 0.05);
    expect(points[0]).toEqual([50, 0]);
    expect(points[points.length - 1]).toEqual([0, 50]);
    // Vertici sul cerchio (la costante k = 0,5523 approssima il cerchio entro 0,03 mm)
    for (const [x, y] of points) expect(Math.abs(Math.hypot(x, y) - 50)).toBeLessThan(0.05);
    // La corda tra due vertici consecutivi sta dentro il cerchio di non più della tolleranza
    for (let i = 1; i < points.length; i++) {
      const mid = [(points[i][0] + points[i - 1][0]) / 2, (points[i][1] + points[i - 1][1]) / 2];
      expect(50 - Math.hypot(mid[0], mid[1])).toBeLessThanOrEqual(0.05);
    }
  });

  it('con una tolleranza più larga si campionano meno punti', () => {
    expect(sampleContour(quarter, 0.5).length).toBeLessThan(sampleContour(quarter, 0.05).length);
  });

  it('il riquadro della curva a S è quello analitico a qualunque tolleranza (D2)', () => {
    const h = 10 * Math.sqrt(3);
    for (const tol of [0.001, 0.05, 1]) {
      const box = bboxOf([sampleContour(sCurve, tol)])!;
      expect(box.minX).toBeCloseTo(0, 9);
      expect(box.maxX).toBeCloseTo(100, 9);
      expect(box.minY).toBeCloseTo(-h, 9);
      expect(box.maxY).toBeCloseTo(h, 9);
    }
  });

  it('un contorno chiuso non ripete il primo punto in fondo', () => {
    const closed: PathContour = { closed: true, nodes: [node([0, 0], [0, 10], [0, -10]), node([20, 0], [0, -10], [0, 10])] };
    const points = sampleContour(closed, 0.05);
    expect(points[0]).toEqual([0, 0]);
    expect(points[points.length - 1]).not.toEqual([0, 0]);
  });

  it('oltre il tetto di punti la tolleranza raddoppia e il risultato è deterministico', () => {
    // 200 curve ampie a tolleranza minima: molto oltre i 2000 punti per contorno
    const nodes: PathNode[] = Array.from({ length: 200 }, (_, i) => node([i * 40, (i % 2) * 90], [20, 60], [-20, -60], 'smooth'));
    const wavy: PathContour = { closed: false, nodes };
    const a = samplePaths([wavy], 0.001);
    const b = samplePaths([wavy], 0.001);
    expect(a.capped).toBe(true);
    expect(a.tolerance).toBeGreaterThan(0.001);
    expect(a.contours[0].points.length).toBeLessThanOrEqual(MAX_CONTOUR_SAMPLES);
    expect(a.contours.reduce((s, c) => s + c.points.length, 0)).toBeLessThanOrEqual(MAX_PATH_SAMPLES);
    expect(b).toEqual(a);
    // Senza superare i tetti non si tocca la tolleranza
    expect(samplePaths([quarter], 0.05)).toMatchObject({ capped: false, tolerance: 0.05 });
  });

  it('un contorno lecito ma enorme non perde segmenti: ogni nodo resta tra i punti (D2) anche se si supera il tetto', () => {
    // 500 nodi con cubiche che hanno estremi in x e in y: servono oltre 2000 punti a qualunque tolleranza
    const nodes: PathNode[] = Array.from({ length: 500 }, (_, i) => node([10 * i, 0], [30, 30], [-30, -30], 'smooth'));
    const huge: PathContour = { closed: true, nodes };
    const { contours, capped } = samplePaths([huge], 0.05);
    expect(capped).toBe(true);
    const points = new Set(contours[0].points.map(([x, y]) => `${x},${y}`));
    for (const n of nodes) expect(points.has(`${n.p[0]},${n.p[1]}`)).toBe(true);
  });

  it('la tolleranza resta nei limiti consentiti', () => {
    expect(samplePaths([quarter], 0).tolerance).toBe(0.001);
    expect(samplePaths([quarter], 50).tolerance).toBe(1);
  });
});

describe('geometria dei contorni', () => {
  it('area con segno: positiva se antiorario', () => {
    expect(signedArea([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(100);
    expect(signedArea([[0, 0], [0, 10], [10, 10], [10, 0]])).toBe(-100);
  });

  it('selfIntersections: l otto ha un incrocio, il quadrato nessuno, i vertici condivisi non contano', () => {
    const eight: Vec2[] = [[0, 0], [10, 10], [10, 0], [0, 10]];
    expect(selfIntersections([eight])).toEqual([[5, 5]]);
    expect(selfIntersections([[[0, 0], [10, 0], [10, 10], [0, 10]]])).toHaveLength(0);
    // Due quadrati che si toccano solo in un vertice
    expect(selfIntersections([[[0, 0], [10, 0], [10, 10], [0, 10]], [[10, 10], [20, 10], [20, 20], [10, 20]]])).toHaveLength(0);
  });

  it('selfIntersections: due contorni che si attraversano si segnalano e il limite si rispetta', () => {
    const a: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const b: Vec2[] = [[5, 5], [15, 5], [15, 15], [5, 15]];
    expect(selfIntersections([a, b])).toHaveLength(2);
    expect(selfIntersections([a, b], 1)).toHaveLength(1);
  });
});

describe('dati non fidati', () => {
  const valid = () => [{ closed: true, nodes: [node([0, 0]), node([10, 0], [1, 2], [-1, -2], 'smooth'), node([10, 10])] }];

  it('un disegno valido passa e ne esce una copia pulita', () => {
    const input = valid();
    const clean = sanitizePaths(input);
    expect(clean).toStrictEqual(input);
    expect(clean![0]).not.toBe(input[0]);
    // Le maniglie assenti non diventano undefined
    expect(Object.keys(clean![0].nodes[0])).toEqual(['p', 'kind']);
  });

  it('scarta tutto se c è un NaN, un nodo di troppo, un tipo ignoto o un numero enorme', () => {
    expect(sanitizePaths([{ closed: true, nodes: [node([NaN, 0]), node([1, 1])] }])).toBeNull();
    expect(sanitizePaths([{ closed: false, nodes: Array.from({ length: 501 }, (_, i) => node([i, 0])) }])).toBeNull();
    expect(sanitizePaths([{ closed: false, nodes: Array.from({ length: 500 }, (_, i) => node([i, 0])) }])).not.toBeNull();
    expect(sanitizePaths([{ closed: false, nodes: [{ p: [0, 0], kind: 'strano' }, node([1, 1])] }])).toBeNull();
    expect(sanitizePaths([{ closed: false, nodes: [node([1e6, 0]), node([1, 1])] }])).toBeNull();
    expect(sanitizePaths([{ closed: false, nodes: [node([0, 0])] }])).toBeNull();
    expect(sanitizePaths([{ closed: 'sì', nodes: [node([0, 0]), node([1, 1])] }])).toBeNull();
    expect(sanitizePaths('non è un elenco')).toBeNull();
    expect(sanitizePaths(Array.from({ length: 101 }, () => ({ closed: false, nodes: [node([0, 0]), node([1, 1])] })))).toBeNull();
  });

  it('i campi in più si scartano e il -0 diventa 0', () => {
    const clean = sanitizePaths([{ closed: false, extra: 1, nodes: [{ p: [-0, 1], kind: 'corner', evil: 'x' }, node([1, 1])] }]);
    expect(clean).toStrictEqual([{ closed: false, nodes: [{ p: [0, 1], kind: 'corner' }, node([1, 1])] }]);
    expect(Object.is(clean![0].nodes[0].p[0], 0)).toBe(true);
  });

  it('encodePathMeta e decodePathMeta: stessi dati, su una sola riga', () => {
    const meta = { paths: valid(), tolerance: 0.05, width: 12.3456, depth: 7 };
    const text = encodePathMeta(meta);
    expect(text).not.toContain('\n');
    expect(decodePathMeta(text)).toStrictEqual(meta);
  });

  it('decodePathMeta limita la tolleranza ai valori consentiti', () => {
    const text = encodePathMeta({ paths: valid(), tolerance: 0.05, width: 10, depth: 10 });
    expect(decodePathMeta(text.replace('"t":0.05', '"t":100000'))!.tolerance).toBe(1);
    expect(decodePathMeta(text.replace('"t":0.05', '"t":1e-9'))!.tolerance).toBe(0.001);
    expect(decodePathMeta(text)!.tolerance).toBe(0.05);
  });

  it('decodePathMeta rifiuta JSON rovinato, versione ignota e misure non valide', () => {
    const meta = { paths: valid(), tolerance: 0.05, width: 10, depth: 10 };
    const text = encodePathMeta(meta);
    expect(decodePathMeta(text.slice(0, -3))).toBeNull();
    expect(decodePathMeta('42')).toBeNull();
    expect(decodePathMeta(text.replace('"v":1', '"v":2'))).toBeNull();
    expect(decodePathMeta(text.replace('"w":10', '"w":-1'))).toBeNull();
    expect(decodePathMeta(text.replace('"closed":true', '"closed":1'))).toBeNull();
  });
});
