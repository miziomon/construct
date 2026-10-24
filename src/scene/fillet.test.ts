import { describe, expect, it } from 'vitest';
import { expandFillets, filletInfo, sampleContour, samplePaths, signedArea } from './bezier';
import { pathContours, pathNaturalBox } from './shapes2d';
import { shape2dDefaults } from './defaults';
import type { PathContour, PathNode, Shape2DNode, Vec2 } from './types';

const corner = (p: Vec2, r?: number): PathNode => ({ p, kind: 'corner', ...(r ? { r } : {}) });
/** Quadrato 40 x 40 (antiorario); `radii` = raggio dei quattro spigoli. */
const square = (radii: number[] = [0, 0, 0, 0]): PathContour => ({ closed: true, nodes: [corner([0, 0], radii[0]), corner([40, 0], radii[1]), corner([40, 40], radii[2]), corner([0, 40], radii[3])] });
const area = (c: PathContour) => Math.abs(signedArea(sampleContour(c, 0.001)));
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('raggio di raccordo per nodo: espansione in un arco tangente', () => {
  it('uno spigolo a 90 gradi: i punti di tangenza sono a r dallo spigolo, l\'arco ha raggio r e centro sulla bisettrice', () => {
    const out = expandFillets(square([0, 0, 5, 0]));
    // Un nodo diventa i due estremi dell'arco (un quarto di giro è una cubica sola): 4 - 1 + 2 nodi
    expect(out.nodes).toHaveLength(5);
    expect(out.nodes[2].p).toEqual([40, 35]);
    expect(out.nodes[3].p).toEqual([35, 40]);
    // I segmenti da e verso l'arco sono retti: nessuna maniglia sui nodi vicini e solo il lato dell'arco sugli estremi
    expect(out.nodes[1].out).toBeUndefined();
    expect(out.nodes[2].in).toBeUndefined();
    expect(out.nodes[3].out).toBeUndefined();
    expect(out.nodes[4].in).toBeUndefined();
    // Punti campionati dell'arco: tutti a 5 mm dal centro (35, 35)
    const arc = sampleContour(square([0, 0, 5, 0]), 0.001).filter((p) => p[0] > 35.001 && p[1] > 35.001);
    expect(arc.length).toBeGreaterThan(3);
    for (const p of arc) expect(dist(p, [35, 35])).toBeCloseTo(5, 2);
  });

  it('l\'area del quadrato perde (1 - π/4) r² per ogni spigolo raccordato', () => {
    expect(area(square())).toBeCloseTo(1600, 6);
    expect(area(square([0, 0, 5, 0]))).toBeCloseTo(1600 - (1 - Math.PI / 4) * 25, 1);
    expect(area(square([3, 3, 3, 3]))).toBeCloseTo(1600 - 4 * (1 - Math.PI / 4) * 9, 1);
  });

  it('un angolo acuto: l\'arco supera il quarto di giro (più cubiche) e resta circolare; la lunghezza è r (π - φ)', () => {
    // Triangolo isoscele con lo spigolo in cima di circa 28 gradi
    const tri: PathContour = { closed: true, nodes: [corner([-10, 0]), corner([10, 0]), corner([0, 40], 4)] };
    const phi = 2 * Math.atan(10 / 40);
    const out = expandFillets(tri);
    // Sweep di circa 152 gradi: due cubiche, tre nodi d'arco
    expect(out.nodes).toHaveLength(2 + 3);
    const t = 4 / Math.tan(phi / 2);
    const centre: Vec2 = [0, 40 - 4 / Math.sin(phi / 2)];
    const points = sampleContour(tri, 0.001);
    const onArc = points.filter((p) => p[1] > 40 - t * Math.cos(phi / 2) - 1e-6 && p[1] < 40);
    expect(onArc.length).toBeGreaterThan(5);
    for (const p of onArc) expect(dist(p, centre)).toBeCloseTo(4, 2);
    // Lunghezza dell'arco: somma dei tratti tra i punti campionati
    let length = 0;
    for (let i = 1; i < onArc.length; i++) length += dist(onArc[i - 1], onArc[i]);
    expect(length).toBeGreaterThan(4 * (Math.PI - phi) * 0.99);
    expect(length).toBeLessThanOrEqual(4 * (Math.PI - phi) * 1.0001);
  });

  it('un raggio troppo grande si riduce: la tangenza non supera il segmento (la metà se il vicino è raccordato)', () => {
    // Tutti e quattro i raccordati con r molto grande: ognuno ne usa la metà, quindi il quadrato diventa un cerchio di raggio 20
    expect(Math.abs(area(square([100, 100, 100, 100])) - Math.PI * 400)).toBeLessThan(0.5);
    // Uno solo: può arrivare al lato intero (r = 40, un quarto di cerchio da un lato all'altro)
    expect(filletInfo(square([100, 0, 0, 0]), 0).rmax).toBeCloseTo(40, 9);
    expect(filletInfo(square([100, 100, 0, 0]), 0).rmax).toBeCloseTo(20, 9);
    expect(area(square([100, 0, 0, 0]))).toBeCloseTo(1600 - (1 - Math.PI / 4) * 1600, 0);
  });

  it('contorno chiuso: anche il nodo 0 e l\'ultimo si raccordano (il segmento di chiusura); aperto: gli estremi no', () => {
    expect(expandFillets(square([5, 0, 0, 0])).nodes).toHaveLength(5);
    expect(expandFillets(square([0, 0, 0, 5])).nodes).toHaveLength(5);
    const open: PathContour = { closed: false, nodes: [corner([0, 0], 5), corner([40, 0], 5), corner([40, 40], 5)] };
    const out = expandFillets(open);
    // Solo il nodo di mezzo si raccorda (3 - 1 + 2 nodi); i due estremi restano dove sono
    expect(out.nodes).toHaveLength(4);
    expect(out.nodes[0].p).toEqual([0, 0]);
    expect(out.nodes[3].p).toEqual([40, 40]);
    expect(filletInfo(open, 0).eligible).toBe(false);
    expect(filletInfo(open, 2).eligible).toBe(false);
    expect(filletInfo(open, 1).eligible).toBe(true);
  });

  it('con maniglie, con un segmento curvo vicino, non spigolo o allineato il raggio non ha effetto e l\'interfaccia dice perché', () => {
    const same = (c: PathContour) => expect(expandFillets(c).nodes).toEqual(c.nodes);
    // Segmento curvo dopo il nodo precedente
    const curved: PathContour = { closed: true, nodes: [corner([0, 0]), { p: [40, 0], out: [5, 5], kind: 'corner' }, corner([40, 40], 5), corner([0, 40])] };
    same(curved);
    expect(filletInfo(curved, 2)).toMatchObject({ eligible: false, reason: 'Il raccordo vale tra due segmenti retti' });
    // Nodo con maniglia
    const handled: PathContour = { closed: true, nodes: [corner([0, 0]), corner([40, 0]), { p: [40, 40], in: [0, -5], kind: 'corner', r: 5 }, corner([0, 40])] };
    same(handled);
    expect(filletInfo(handled, 2).reason).toMatch(/senza maniglie/);
    // Nodo liscio
    const smooth: PathContour = { closed: true, nodes: [corner([0, 0]), corner([40, 0]), { p: [40, 40], kind: 'smooth', r: 5 }, corner([0, 40])] };
    same(smooth);
    // Tre nodi allineati
    const flat: PathContour = { closed: false, nodes: [corner([0, 0]), corner([20, 0], 5), corner([40, 0])] };
    same(flat);
    expect(filletInfo(flat, 1)).toMatchObject({ eligible: false });
    // Raggio nullo o assente: stesso contorno
    same(square());
    expect(filletInfo(square(), 9).eligible).toBe(false);
  });

  it('i nodi di controllo non cambiano: l\'espansione non tocca il contorno di partenza', () => {
    const c = square([0, 0, 5, 0]);
    const before = JSON.stringify(c);
    expandFillets(c);
    expect(JSON.stringify(c)).toBe(before);
    expect(c.nodes[2]).toMatchObject({ p: [40, 40], r: 5 });
  });

  it('kernel e codice: il riquadro e i contorni campionati di un Profilo con raggio sono quelli dell\'espansione', () => {
    const node = { ...shape2dDefaults('path'), id: 'p', name: 'Profilo', position: [0, 0, 0], paths: [square([5, 5, 5, 5])], width: 40, depth: 40 } as Extract<Shape2DNode, { kind: 'path' }>;
    const [contour] = pathContours(node);
    const sampled = samplePaths(node.paths, node.tolerance).contours[0].points;
    expect(contour).toHaveLength(sampled.length);
    contour.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(sampled[i][0] - 20, 3);
      expect(p[1]).toBeCloseTo(sampled[i][1] - 20, 3);
    });
    // Il raccordo toglie angolo ma non lunghezza ai lati: il riquadro resta 40 x 40
    expect(pathNaturalBox(node)).toMatchObject({ width: 40, depth: 40 });
    // Meno area, quindi meno volume di un quadrato senza raggio
    const shoelace = (pts: Vec2[]) => Math.abs(pts.reduce((a, p, i) => a + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2);
    expect(shoelace(contour)).toBeCloseTo(1600 - 4 * (1 - Math.PI / 4) * 25, 0);
  });
});
