import { describe, expect, it } from 'vitest';
import { RATIO_INFO, pathContours, pathNaturalBox, pathNaturalSize, pathRadius, revolveParams, shapeContours, svgNaturalSize, svgScalePercent, type PolygonKind, type PolygonShape } from './shapes2d';
import { halfHeight, shape2dDefaults } from './defaults';
import type { PathContour, PathNode, Shape2DNode, Vec2 } from './types';

const KINDS = Object.keys(RATIO_INFO) as PolygonKind[];

const shape = (kind: PolygonKind, width = 20, depth = 20, ratio = RATIO_INFO[kind]?.default ?? 0): PolygonShape =>
  ({ type: 'shape2d', kind, width, depth, ratio, height: 10, twist: 0, scaleTop: 1 }) as unknown as PolygonShape;

const bounds = (contours: [number, number][][]) => {
  const all = contours.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

/** Area con segno di un contorno (positiva se antiorario). */
const area = (c: [number, number][]) => c.reduce((sum, [x, y], i) => sum + (x * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * y), 0) / 2;

/** Area di una forma: esterno meno i fori. */
const totalArea = (contours: [number, number][][]) => contours.reduce((sum, c) => sum + area(c), 0);

describe('forme 2D poligonali', () => {
  it.each(KINDS)('%s: ingombro width × depth, centrato nell\'origine, contorni validi', (kind) => {
    const contours = shapeContours(shape(kind, 30, 18));
    const b = bounds(contours);
    expect(b.maxX - b.minX).toBeCloseTo(30, 2);
    expect(b.maxY - b.minY).toBeCloseTo(18, 2);
    expect((b.maxX + b.minX) / 2).toBeCloseTo(0, 2);
    expect((b.maxY + b.minY) / 2).toBeCloseTo(0, 2);
    for (const c of contours) {
      expect(c.length).toBeGreaterThanOrEqual(3);
      expect(Math.abs(area(c))).toBeGreaterThan(1);
    }
    // Il primo contorno è l'esterno, antiorario; un eventuale foro è orario
    expect(area(contours[0])).toBeGreaterThan(0);
    contours.slice(1).forEach((hole) => expect(area(hole)).toBeLessThan(0));
  });

  it('anello: area = esterno meno foro, foro in un secondo contorno', () => {
    const contours = shapeContours(shape('ring', 40, 40, 0.5));
    expect(contours).toHaveLength(2);
    // Poligono a 64 lati: area ≈ π r² (con piccola perdita)
    expect(totalArea(contours)).toBeCloseTo(Math.PI * (20 ** 2 - 10 ** 2), -1);
    const hole = bounds([contours[1]]);
    expect(hole.maxX - hole.minX).toBeCloseTo(20, 1);
  });

  it('stella a 5 punte: area della formula e una punta verso l\'alto', () => {
    const [c] = shapeContours(shape('star5', 20, 20, 0.4));
    expect(c).toHaveLength(10);
    // La punta più alta sta sull'asse Y
    const top = c.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(top[0]).toBeCloseTo(0, 3);
    // Normalizzata a 20 × 20 (la stella è più larga che alta, quindi si schiaccia): l'area resta quella del poligono
    expect(totalArea([c])).toBeGreaterThan(40);
  });

  it('stella a 6 punte: simmetrica rispetto a X e Y, 12 vertici', () => {
    const [c] = shapeContours(shape('star6', 20, 20, 0.5));
    expect(c).toHaveLength(12);
    for (const [x, y] of c) {
      expect(c.some(([qx, qy]) => Math.abs(qx + x) < 1e-3 && Math.abs(qy - y) < 1e-3), `specchio di ${x},${y}`).toBe(true);
    }
  });

  it('croce: area = due barre meno l\'incrocio, esatta', () => {
    const [c] = shapeContours(shape('cross', 30, 30, 0.2));
    // Spessore = 0,2 × 30 = 6: 2 × (30 × 6) − 6 × 6
    expect(totalArea([c])).toBeCloseTo(2 * 30 * 6 - 36, 3);
    expect(c).toHaveLength(12);
  });

  it('trapezio: base larga, cima ratio × base, area esatta', () => {
    const [c] = shapeContours(shape('trapezoid', 24, 16, 0.5));
    expect(totalArea([c])).toBeCloseTo(((24 + 12) / 2) * 16, 3);
    const top = c.filter((p) => p[1] > 0);
    expect(Math.max(...top.map((p) => p[0])) - Math.min(...top.map((p) => p[0]))).toBeCloseTo(12, 3);
  });

  it('cuore, goccia, uovo: simmetrici rispetto all\'asse Y (la punta in alto per goccia e uovo)', () => {
    for (const kind of ['heart', 'drop', 'egg'] as const) {
      const [c] = shapeContours(shape(kind, 20, 24));
      for (const [x, y] of c) {
        expect(c.some(([qx, qy]) => Math.abs(qx + x) < 0.05 && Math.abs(qy - y) < 0.05), `${kind}: specchio di ${x},${y}`).toBe(true);
      }
    }
    // La goccia è più larga in basso che in alto; l'uovo anche
    for (const kind of ['drop', 'egg'] as const) {
      const [c] = shapeContours(shape(kind, 20, 24));
      const widthAt = (lo: number, hi: number) => {
        const xs = c.filter((p) => p[1] >= lo && p[1] <= hi).map((p) => p[0]);
        return Math.max(...xs) - Math.min(...xs);
      };
      expect(widthAt(-12, -4), kind).toBeGreaterThan(widthAt(4, 12));
    }
  });

  it('mezzaluna: più piccola del cerchio esterno, un solo contorno, ingombro a destra vuoto', () => {
    const [c] = shapeContours(shape('crescent', 20, 20, 0.45));
    expect(totalArea([c])).toBeGreaterThan(20);
    expect(totalArea([c])).toBeLessThan(Math.PI * 100);
    // Il lato destro è scavato: il punto (+9, 0) non è dentro la forma (nessun vertice ci passa vicino)
    const nearRight = c.filter((p) => Math.abs(p[1]) < 1 && p[0] > 0);
    expect(nearRight.every((p) => p[0] < 8)).toBe(true);
  });
});

describe('SVG importato: dimensione naturale e scala', () => {
  const contours: [number, number][][] = [[[-20, -10], [20, -10], [20, 10], [-20, 10]]];

  it('la dimensione naturale è quella dei contorni letti dal file', () => {
    expect(svgNaturalSize({ contours })).toEqual({ width: 40, depth: 20 });
    expect(svgNaturalSize({ contours: [] })).toEqual({ width: 0, depth: 0 });
  });

  it('la scala è la larghezza attuale in percentuale di quella del file', () => {
    expect(svgScalePercent({ contours, width: 40 })).toBe(100);
    expect(svgScalePercent({ contours, width: 80 })).toBe(200);
    expect(svgScalePercent({ contours, width: 10 })).toBe(25);
    // Senza contorni non c'è nulla da scalare
    expect(svgScalePercent({ contours: [], width: 10 })).toBe(100);
  });
});

describe('Profilo di Bézier: riquadro, scala e chiusura sull\'asse', () => {
  const corner = (p: Vec2, out?: Vec2, inn?: Vec2): PathNode => ({ p, ...(inn ? { in: inn } : {}), ...(out ? { out } : {}), kind: 'corner' });
  /** Contorno aperto a U a destra dell'asse: da (25, 0) a (35, 0), (35, 20), (25, 20). Riquadro naturale 10 × 20, centro (30, 10). */
  const U: PathContour[] = [{ closed: false, nodes: [corner([25, 0]), corner([35, 0]), corner([35, 20]), corner([25, 20])] }];
  type PathNodeShape = Extract<Shape2DNode, { kind: 'path' }>;
  const path = (patch: Partial<PathNodeShape> = {}) => ({ ...shape2dDefaults('path'), id: 'p', name: 'p', position: [0, 0, 0], paths: U, width: 10, depth: 20, ...patch }) as PathNodeShape;

  it('il riquadro è width × depth centrato nell\'origine, anche a una misura diversa da quella naturale', () => {
    for (const [w, d] of [[10, 20], [20, 40], [7, 3]]) {
      const b = bounds(pathContours(path({ width: w, depth: d })));
      expect(b.maxX - b.minX).toBeCloseTo(w, 3);
      expect(b.maxY - b.minY).toBeCloseTo(d, 3);
      expect((b.maxX + b.minX) / 2).toBeCloseTo(0, 3);
      expect((b.maxY + b.minY) / 2).toBeCloseTo(0, 3);
    }
  });

  it('il riquadro naturale non dipende dalla tolleranza e un cerchio di quattro cubiche è esatto (D2)', () => {
    const k = 0.5523 * 10;
    const circle: PathContour[] = [{ closed: true, nodes: [
      { p: [10, 0], in: [0, -k], out: [0, k], kind: 'smooth' },
      { p: [0, 10], in: [k, 0], out: [-k, 0], kind: 'smooth' },
      { p: [-10, 0], in: [0, k], out: [0, -k], kind: 'smooth' },
      { p: [0, -10], in: [-k, 0], out: [k, 0], kind: 'smooth' },
    ] }];
    expect(pathNaturalSize({ paths: circle })).toEqual({ width: 20, depth: 20 });
    for (const tolerance of [0.001, 1]) {
      const b = bounds(pathContours(path({ paths: circle, width: 20, depth: 20, tolerance })));
      expect(b.maxX - b.minX).toBeCloseTo(20, 3);
      expect(b.maxY - b.minY).toBeCloseTo(20, 3);
    }
  });

  it('in lineare un contorno aperto resta com\'è (si chiude da solo con un segmento retto)', () => {
    const [c] = pathContours(path());
    expect(c).toHaveLength(4);
  });

  it('in rotazione un contorno aperto si chiude sull\'asse, a x = −raggio', () => {
    const node = path({ extrusion: 'rotate' });
    expect(pathRadius(node)).toBe(30);
    const [c] = pathContours(node);
    // Dopo la centratura il profilo sta tra −5 e 5 e l'asse a −30: gli ultimi due punti sono sull'asse
    expect(c.slice(-2)).toEqual([[-30, 10], [-30, -10]]);
    expect(c).toHaveLength(6);
  });

  it('passare da Lineare a Rotazionale non cambia misure naturali, raggio e scala (D1)', () => {
    const linear = path({ width: 20 });
    const rotary = path({ width: 20, extrusion: 'rotate' });
    expect(pathNaturalSize(linear)).toEqual(pathNaturalSize(rotary));
    expect(pathRadius(linear)).toBe(pathRadius(rotary));
    // I punti delle curve sono gli stessi: la rotazione aggiunge solo i due punti sull'asse
    expect(pathContours(rotary)[0].slice(0, 4)).toEqual(pathContours(linear)[0]);
    // Il raggio non segue la scala: scalare attorno al centro lo lascia dov'è
    expect(pathRadius(path({ width: 40, depth: 80, extrusion: 'rotate' }))).toBe(30);
  });

  it('un contorno già sull\'asse non ripete i punti', () => {
    const onAxis = path({ extrusion: 'rotate', paths: [{ closed: false, nodes: [corner([0, 0]), corner([10, 0]), corner([10, 20]), corner([0, 20])] }], width: 10, depth: 20 });
    const [c] = pathContours(onAxis);
    expect(c).toHaveLength(4);
  });

  it('revolveParams ignora revolveRadius e non limita il raggio a zero', () => {
    expect(revolveParams({ ...path({ extrusion: 'rotate' }), revolveRadius: 99 }).radius).toBe(30);
    const left = path({ paths: [{ closed: false, nodes: [corner([-35, 0]), corner([-25, 0]), corner([-25, 20])] }] });
    expect(revolveParams({ ...left, extrusion: 'rotate' }).radius).toBe(-30);
  });

  it('un disegno senza area non produce contorni', () => {
    // Una linea verticale non ha larghezza; tre punti allineati non hanno area
    expect(pathContours(path({ paths: [{ closed: false, nodes: [corner([0, 0]), corner([0, 10])] }] }))).toEqual([]);
    expect(pathContours(path({ paths: [{ closed: true, nodes: [corner([0, 0]), corner([5, 5]), corner([10, 10])] }] }))).toEqual([]);
    expect(pathContours(path({ paths: [] }))).toEqual([]);
    expect(pathNaturalBox({ paths: [] })).toBeNull();
    expect(pathNaturalSize({ paths: [] })).toEqual({ width: 0, depth: 0 });
  });

  it('un contorno dentro un altro resta un contorno a sé (il foro lo decide il riempimento pari-dispari)', () => {
    const square = (a: number, b: number): PathContour => ({ closed: true, nodes: [corner([a, a]), corner([b, a]), corner([b, b]), corner([a, b])] });
    expect(pathContours(path({ paths: [square(0, 20), square(5, 15)], width: 20, depth: 20 }))).toHaveLength(2);
  });

  it('un disegno con centinaia di migliaia di punti campionati non lancia eccezioni', () => {
    // 100 contorni da 500 nodi con cubiche piene di estremi: oltre i tetti, la tolleranza raddoppia e restano molti punti
    const paths: PathContour[] = Array.from({ length: 100 }, (_, k) => ({ closed: true, nodes: Array.from({ length: 500 }, (_, i) => ({ p: [i * 0.01, 50 * k] as Vec2, out: [10, 20] as Vec2, in: [10, -5] as Vec2, kind: 'corner' as const })) }));
    expect(() => pathContours(path({ paths, width: 100, depth: 100 }))).not.toThrow();
  }, 20000);

  it('valori iniziali e metà altezza, in lineare e in rotazione', () => {
    expect(shape2dDefaults('path')).toMatchObject({ kind: 'path', paths: [], tolerance: 0.05, width: 20, depth: 20 });
    expect(halfHeight(path({ height: 12 }))).toBe(6);
    // In rotazione la Y del profilo diventa l'altezza: conta metà della profondità
    expect(halfHeight(path({ extrusion: 'rotate', depth: 20 }))).toBe(10);
  });
});
