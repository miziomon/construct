import { describe, expect, it } from 'vitest';
import { cubicPoint, sampleContour, signedArea } from './bezier';
import { KAPPA, arcCubics, cubicSeg, cubicsToContour, ellipseContour, inferKind, polygonContour, regularPolygon, roundedPolygonContour } from './pathShapes';
import type { Vec2 } from './types';

/** Area del contorno campionato con tolleranza molto bassa (la curva vera, entro il campionamento). */
const area = (c: Parameters<typeof sampleContour>[0]) => Math.abs(signedArea(sampleContour(c, 0.001)));

describe('arcCubics', () => {
  it('KAPPA è la costante dei quattro quarti di cerchio', () => {
    expect(KAPPA).toBeCloseTo((4 / 3) * Math.tan(Math.PI / 8), 9);
  });

  it('un giro intero sono 4 pezzi, un quarto 1, un arco di 100° ne vuole 2', () => {
    expect(arcCubics(0, 2 * Math.PI)).toHaveLength(4);
    expect(arcCubics(0, Math.PI / 2)).toHaveLength(1);
    expect(arcCubics(0, (100 * Math.PI) / 180)).toHaveLength(2);
  });

  it('i punti stanno sulla circonferenza unitaria (errore radiale sotto 3e-4) in entrambi i versi', () => {
    for (const sweep of [Math.PI / 2, 2 * Math.PI, -1.3, 0.2, 5]) {
      for (const cubic of arcCubics(0.7, sweep)) {
        for (let k = 0; k <= 10; k++) {
          const [x, y] = cubicPoint(cubic, k / 10);
          expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(3e-4);
        }
      }
    }
  });

  it('parte da a0 e arriva a a0 + sweep', () => {
    const cubics = arcCubics(0.5, 2);
    expect(cubics[0][0][0]).toBeCloseTo(Math.cos(0.5), 9);
    expect(cubics[0][0][1]).toBeCloseTo(Math.sin(0.5), 9);
    const end = cubics[cubics.length - 1][3];
    expect(end[0]).toBeCloseTo(Math.cos(2.5), 9);
    expect(end[1]).toBeCloseTo(Math.sin(2.5), 9);
  });
});

describe('inferKind', () => {
  it('spigolo se manca una maniglia o non sono opposte', () => {
    expect(inferKind(undefined, [1, 0])).toBe('corner');
    expect(inferKind([-1, 0], undefined)).toBe('corner');
    expect(inferKind([1, 0], [1, 0])).toBe('corner');
    expect(inferKind([-1, 0], [1, 0.1])).toBe('corner');
  });

  it('liscio se opposte con lunghezze diverse, simmetrico se uguali entro l\'1%', () => {
    expect(inferKind([-1, 0], [2, 0])).toBe('smooth');
    expect(inferKind([-1, 0], [1.005, 0])).toBe('symmetric');
    expect(inferKind([-1, 0], [1.05, 0])).toBe('smooth');
  });

  it('la tolleranza sull\'angolo è di circa 1 grado', () => {
    expect(inferKind([-1, 0], [1, 0.01])).toBe('symmetric');
    expect(inferKind([-1, 0], [1, 0.05])).toBe('corner');
  });
});

describe('cubicsToContour', () => {
  it('un contorno chiuso che torna al punto iniziale non ripete il nodo e porta la maniglia in arrivo al primo', () => {
    const at = (a: number): Vec2 => [Math.cos(a), Math.sin(a)];
    const segs = arcCubics(0, 2 * Math.PI).map(cubicSeg);
    const c = cubicsToContour(at(0), segs, true)!;
    expect(c.nodes).toHaveLength(4);
    // Il primo nodo ha sia la maniglia in arrivo (dall'ultimo pezzo) sia quella in uscita
    expect(c.nodes[0].in).toBeDefined();
    expect(c.nodes[0].out).toBeDefined();
    expect(c.nodes.every((n) => n.kind === 'symmetric')).toBe(true);
  });

  it('un contorno aperto tiene il nodo finale, e un contorno chiuso che non torna al punto iniziale si chiude con una retta', () => {
    const open = cubicsToContour([0, 0], [{ to: [10, 0] }, { to: [10, 10] }], false)!;
    expect(open.closed).toBe(false);
    expect(open.nodes.map((n) => n.p)).toEqual([[0, 0], [10, 0], [10, 10]]);
    const closed = cubicsToContour([0, 0], [{ to: [10, 0] }, { to: [10, 10] }], true)!;
    expect(closed.nodes).toHaveLength(3);
  });

  it('scarta i segmenti retti senza lunghezza e restituisce null con meno di 2 nodi', () => {
    expect(cubicsToContour([0, 0], [{ to: [0, 0] }, { to: [5, 0] }], false)!.nodes).toHaveLength(2);
    expect(cubicsToContour([0, 0], [{ to: [0, 0] }], false)).toBeNull();
    expect(cubicsToContour([1, 1], [], true)).toBeNull();
  });

  it('le maniglie sono relative al nodo e una maniglia lunga zero non si scrive', () => {
    const c = cubicsToContour([0, 0], [{ c1: [0, 0], c2: [8, 5], to: [10, 5] }], false)!;
    expect(c.nodes[0].out).toBeUndefined();
    expect(c.nodes[1].in).toEqual([-2, 0]);
  });
});

describe('forme', () => {
  it('regularPolygon: n vertici sul raggio, il primo all\'angolo indicato', () => {
    const v = regularPolygon(5, 10, Math.PI / 2, [3, 4]);
    expect(v).toHaveLength(5);
    expect(v[0][0]).toBeCloseTo(3, 9);
    expect(v[0][1]).toBeCloseTo(14, 9);
    for (const [x, y] of v) expect(Math.hypot(x - 3, y - 4)).toBeCloseTo(10, 9);
  });

  it('polygonContour: solo spigoli, chiuso', () => {
    const c = polygonContour([[0, 0], [4, 0], [4, 3]]);
    expect(c.closed).toBe(true);
    expect(c.nodes.every((n) => n.kind === 'corner' && !n.in && !n.out)).toBe(true);
  });

  it('ellipseContour: 4 nodi simmetrici e area π·rx·ry (entro 0,05%)', () => {
    const e = ellipseContour(5, -2, 30, 12);
    expect(e.nodes).toHaveLength(4);
    expect(e.nodes.every((n) => n.kind === 'symmetric')).toBe(true);
    // I quattro nodi sono sugli assi dell'ellisse (a meno del rumore di cos e sin)
    const [xs, ys] = [e.nodes.map((n) => n.p[0]), e.nodes.map((n) => n.p[1])];
    expect(Math.max(...xs)).toBeCloseTo(35, 9);
    expect(Math.min(...xs)).toBeCloseTo(-25, 9);
    expect(Math.max(...ys)).toBeCloseTo(10, 9);
    expect(Math.min(...ys)).toBeCloseTo(-14, 9);
    expect(area(e) / (Math.PI * 30 * 12)).toBeCloseTo(1, 3);
  });

  it('roundedPolygonContour: un quadrato con raccordo r ha 8 nodi e area L² − (4 − π) r²', () => {
    const r = 3;
    const h = 10 - r;
    const c = roundedPolygonContour([[h, -h], [h, h], [-h, h], [-h, -h]] as Vec2[], r);
    expect(c.nodes).toHaveLength(8);
    expect(c.nodes.every((n) => n.kind === 'corner')).toBe(true);
    // Il lato del quadrato finale è 20: i lati dritti sono a distanza 10 dal centro
    const xs = c.nodes.map((n) => n.p[0]);
    expect(Math.max(...xs)).toBeCloseTo(10, 9);
    expect(Math.min(...xs)).toBeCloseTo(-10, 9);
    expect(area(c)).toBeCloseTo(400 - (4 - Math.PI) * r * r, 1);
  });

  it('roundedPolygonContour con raccordo nullo è il poligono; esagono: area del poligono ridotto + perimetro·r + π r²', () => {
    const hex = regularPolygon(6, 10);
    expect(roundedPolygonContour(hex, 0).nodes).toHaveLength(6);
    const r = 2;
    const c = roundedPolygonContour(hex, r);
    // 6 archi di 60 gradi: un pezzo ciascuno, quindi 12 nodi
    expect(c.nodes).toHaveLength(12);
    const side = 10;
    const hexArea = (3 * Math.sqrt(3) * side * side) / 2;
    expect(area(c)).toBeCloseTo(hexArea + 6 * side * r + Math.PI * r * r, 0);
  });
});
