import { describe, expect, it } from 'vitest';
import {
  MAX_CONTOUR_SAMPLES,
  MAX_PATH_SAMPLES,
  PATH_MAX_TOLERANCE,
  assignNodeIds,
  bboxOf,
  cubicExtrema,
  cubicPoint,
  decodePathMeta,
  encodePathMeta,
  flattenCubic,
  sampleContour,
  samplePaths,
  sanitizeConstraints,
  sanitizeParams,
  sanitizePaths,
  segmentOf,
  selfIntersections,
  signedArea,
  splitCubic,
  type Cubic,
} from './bezier';
import type { PathContour, PathNode, ProfileConstraint, Vec2 } from './types';

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

  it('un contorno che supera i tetti anche a tolleranza massima si ferma lì: stessi punti di prima, tolleranza limitata a 1 mm', () => {
    const nodes: PathNode[] = Array.from({ length: 500 }, (_, i) => node([10 * i, 0], [30, 30], [-30, -30], 'smooth'));
    const huge: PathContour = { closed: true, nodes };
    const a = samplePaths([huge], 0.05);
    // Prima la tolleranza restituita arrivava a 204,8 mm (12 raddoppi, ognuno con gli stessi punti): ora è quella davvero usata
    expect(a.tolerance).toBe(PATH_MAX_TOLERANCE);
    expect(a.capped).toBe(true);
    expect(a.contours).toEqual(samplePaths([huge], PATH_MAX_TOLERANCE).contours);
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
    expect(decodePathMeta(text.replace('"v":2', '"v":3'))).toBeNull();
    expect(decodePathMeta(text.replace('"w":10', '"w":-1'))).toBeNull();
    expect(decodePathMeta(text.replace('"closed":true', '"closed":1'))).toBeNull();
  });
});

describe('id dei nodi, raccordo, vincoli e parametri (formato v:2)', () => {
  /** Triangolo con id `n1`, `n2`, `n3`. */
  const tri = (): PathContour[] => [{ closed: true, nodes: [{ id: 'n1', ...node([0, 0]) }, { id: 'n2', ...node([10, 0]), r: 2 }, { id: 'n3', ...node([10, 10]) }] }];
  const dist = (id: string, a: string, b: string, v: number): ProfileConstraint => ({ id, t: 'dist', p: [a, b], v });

  it('sanitizePaths conserva id e r validi e scarta quelli rovinati o ripetuti (anche tra contorni)', () => {
    expect(sanitizePaths(tri())).toStrictEqual(tri());
    const dirty = [
      { closed: true, nodes: [{ id: 'a', ...node([0, 0]), r: -1 }, { id: 'a', ...node([1, 0]), r: 'x' }, { id: 'b c', ...node([1, 1]), r: 0 }] },
      { closed: false, nodes: [{ id: 'a', ...node([5, 5]) }, { id: 5, ...node([6, 6]), r: Infinity }] },
    ];
    const clean = sanitizePaths(dirty)!;
    // Il primo id vale; i ripetuti, i malformati e quelli non stringa spariscono; un r non valido o nullo sparisce
    expect(clean[0].nodes.map((n) => n.id)).toEqual(['a', undefined, undefined]);
    expect(clean[1].nodes.map((n) => n.id)).toEqual([undefined, undefined]);
    expect(clean.flatMap((c) => c.nodes).some((n) => 'r' in n)).toBe(false);
  });

  it('assignNodeIds assegna solo gli id mancanti con un contatore che riparte dopo il più alto, senza riusare id presi', () => {
    const paths: PathContour[] = [{ closed: true, nodes: [node([0, 0]), { id: 'n7', ...node([1, 0]) }, node([1, 1])] }, { closed: false, nodes: [{ id: 'n8', ...node([5, 5]) }, node([6, 6])] }];
    const out = assignNodeIds(paths);
    expect(out[0].nodes.map((n) => n.id)).toEqual(['n9', 'n7', 'n10']);
    expect(out[1].nodes.map((n) => n.id)).toEqual(['n8', 'n11']);
    // Non modifica l'input e, con tutti gli id presenti, restituisce lo stesso riferimento
    expect(paths[0].nodes[0].id).toBeUndefined();
    expect(assignNodeIds(out)).toBe(out);
    // Senza id parte da n1; un id non numerico non confonde il contatore
    expect(assignNodeIds([{ closed: false, nodes: [node([0, 0]), { id: 'foo', ...node([1, 1]) }] }])[0].nodes.map((n) => n.id)).toEqual(['n1', 'foo']);
  });

  it('sanitizeConstraints scarta tipo ignoto, punti sbagliati o inesistenti, valori non finiti e id ripetuti', () => {
    const good = [dist('k1', 'n1', 'n2', 10), { id: 'k2', t: 'horizontal', p: ['n1', 'n2'] }, { id: 'k3', t: 'fixed', p: ['n3'], x: 1, y: 2 }, { id: 'k4', t: 'angle', p: ['n1', 'n2', 'n2', 'n3'], v: 45, ref: true, off: -3, at: 0.25 }];
    expect(sanitizeConstraints(good, tri())).toStrictEqual(good);
    const bad = [
      { id: 'a', t: 'magia', p: ['n1', 'n2'] },
      { id: 'b', t: 'dist', p: ['n1', 'n9'], v: 5 },
      { id: 'c', t: 'dist', p: ['n1'], v: 5 },
      { id: 'd', t: 'dist', p: ['n1', 'n2'], v: NaN },
      { id: 'e', t: 'dist', p: ['n1', 'n2'] },
      { id: 'f', t: 'dist', p: ['n1', 'n2'], v: -4 },
      { id: 'g', t: 'fixed', p: ['n1'], x: 1 },
      { id: 'k1', t: 'vertical', p: ['n1', 'n3'] },
      { id: 'h h', t: 'vertical', p: ['n1', 'n3'] },
      { t: 'vertical', p: ['n1', 'n3'] },
      { id: 'i', t: 'horizontal', p: ['n1', 5] },
      { id: 'j', t: 'parallel', p: ['n1', 'n2', 'n3'] },
      'stringa',
      null,
    ];
    expect(sanitizeConstraints([good[0], ...bad], tri())).toStrictEqual([good[0]]);
    // Campi facoltativi non validi: il campo si perde, il vincolo resta. Una quota di riferimento può non avere v
    expect(sanitizeConstraints([{ id: 'a', t: 'dist', p: ['n1', 'n2'], v: 3, off: Infinity, at: 7, s: 2, extra: 1 }, { id: 'b', t: 'dist', p: ['n1', 'n2'], ref: true }], tri())).toStrictEqual([
      { id: 'a', t: 'dist', p: ['n1', 'n2'], v: 3 },
      { id: 'b', t: 'dist', p: ['n1', 'n2'], ref: true },
    ]);
    expect(sanitizeConstraints('no', tri())).toEqual([]);
    expect(sanitizeConstraints(good, [])).toEqual([]);
  });

  it('sanitizeParams tiene numeri finiti e brevi espressioni, scarta nomi cattivi e il prototipo', () => {
    expect(sanitizeParams({ w: 10, h: 'w * 2' })).toStrictEqual({ w: 10, h: 'w * 2' });
    const out = sanitizeParams(JSON.parse('{"__proto__": 1, "constructor": 2, "1x": 3, "ok": 4, "nan": null, "big": 1e300, "long": "' + 'x'.repeat(201) + '"}'))!;
    expect(out).toStrictEqual({ ok: 4 });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(sanitizeParams({})).toBeUndefined();
    expect(sanitizeParams([1, 2])).toBeUndefined();
    expect(sanitizeParams('x')).toBeUndefined();
  });

  it('andata e ritorno v:2 con id, r, vincoli e parametri; senza vincoli né parametri i campi k e q non ci sono', () => {
    const meta = { paths: tri(), tolerance: 0.05, width: 10, depth: 10, constraints: [dist('k1', 'n1', 'n2', 10)], params: { w: 10 } };
    const text = encodePathMeta(meta);
    expect(text).not.toContain('\n');
    expect(JSON.parse(text)).toMatchObject({ v: 2, k: meta.constraints, q: meta.params });
    expect(decodePathMeta(text)).toStrictEqual(meta);
    const plain = encodePathMeta({ paths: tri(), tolerance: 0.05, width: 10, depth: 10 });
    expect(Object.keys(JSON.parse(plain))).toEqual(['v', 'w', 'd', 't', 'paths']);
    expect(decodePathMeta(plain)).toStrictEqual({ paths: tri(), tolerance: 0.05, width: 10, depth: 10 });
  });

  it('un commento v:1 si legge ancora (senza vincoli, anche se ne contiene) e uno v:2 con vincoli rovinati si legge senza di essi', () => {
    const plainPaths = [{ closed: true, nodes: [node([0, 0]), node([10, 0]), node([10, 10])] }];
    const v1 = JSON.stringify({ v: 1, w: 10, d: 10, t: 0.05, paths: plainPaths, k: [dist('k1', 'n1', 'n2', 1)] });
    expect(decodePathMeta(v1)).toStrictEqual({ paths: plainPaths, tolerance: 0.05, width: 10, depth: 10 });
    const v2 = JSON.stringify({ v: 2, w: 10, d: 10, t: 0.05, paths: tri(), k: [dist('k1', 'n1', 'n9', 1), dist('k2', 'n1', 'n2', 5)], q: { w: NaN } });
    expect(decodePathMeta(v2)).toStrictEqual({ paths: tri(), tolerance: 0.05, width: 10, depth: 10, constraints: [dist('k2', 'n1', 'n2', 5)] });
    expect(decodePathMeta(JSON.stringify({ v: 3, w: 10, d: 10, t: 0.05, paths: tri() }))).toBeNull();
  });
});
