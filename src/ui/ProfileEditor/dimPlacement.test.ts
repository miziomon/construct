import { describe, expect, it } from 'vitest';
import { dimLayout, dimText, dimensionValue, dragDimension, fmtDim, pillWidthPx, placeDimension, pointMap, repositionDimensions } from './dimPlacement';
import { createDimension } from './dimensions';
import { pointInPolygon } from './model';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';

/** Pixel per mm dei test: 10, quindi 30 pixel = 3 mm. */
const PX = 10;

const poly = (pts: Vec2[]): PathContour[] => [{ closed: true, nodes: pts.map((p, i) => ({ id: `n${i + 1}`, p, kind: 'corner' as const })) }];
const rect = poly([[0, 0], [40, 0], [40, 20], [0, 20]]);
/** L: il braccio in basso 40 x 10 e quello a sinistra 10 x 40. Il lato interno è da n3 (40, 10) a n4 (10, 10). */
const ell = poly([[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]]);
/** U: due bracci alti 20 mm con un'apertura di 10 mm in alto. */
const ushape = poly([[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]]);

type Mode = 'len' | 'h' | 'v';
/** Crea le quote una dopo l'altra come fa lo strumento (ognuna vede le precedenti) con il valore che i nodi hanno. */
function createAll(paths: PathContour[], specs: [Mode, string, string][]): ProfileConstraint[] {
  const list: ProfileConstraint[] = [];
  for (const [mode, a, b] of specs) {
    const dim = createDimension(paths, mode, a, b, PX, list);
    if (typeof dim === 'string') throw new Error(dim);
    list.push({ ...dim, id: `k${list.length + 1}` });
  }
  return list;
}

/** Rettangolo (mm) dell'etichetta di una quota. */
const labelOf = (c: ProfileConstraint, paths: PathContour[]) => {
  const l = dimLayout(c, pointMap(paths), 0)!.label;
  const [w, h] = [pillWidthPx(dimText(c, paths)) / PX, 18 / PX];
  return { x0: l[0] - w / 2, x1: l[0] + w / 2, y0: l[1] - h / 2, y1: l[1] + h / 2, c: l };
};
const overlap = (a: ReturnType<typeof labelOf>, b: ReturnType<typeof labelOf>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** Il rettangolo dell'etichetta sta fuori dal rettangolo 0..40 x 0..20. */
const outsideRect = (b: ReturnType<typeof labelOf>) => b.x1 <= 0 || b.x0 >= 40 || b.y1 <= 0 || b.y0 >= 20;

describe('testi e geometria della quota', () => {
  it('numeri con la virgola, quote di riferimento tra parentesi e valore letto dal disegno', () => {
    expect(fmtDim(12.3456)).toBe('12,35');
    const ref: ProfileConstraint = { id: 'r', t: 'dist', p: ['n1', 'n3'], ref: true };
    expect(dimensionValue(ref, rect)).toBeCloseTo(Math.hypot(40, 20), 9);
    expect(dimText(ref, rect)).toBe('(44,72)');
    // Le distanze in X e Y si mostrano sempre positive, anche se i nodi sono in ordine inverso
    expect(dimText({ id: 'r', t: 'distX', p: ['n2', 'n1'], s: 1, ref: true }, rect)).toBe('(40)');
    expect(dimText({ id: 'r', t: 'dist', p: ['n1', 'n2'], v: 40 }, rect)).toBe('40');
  });

  it('dimLayout: la linea orizzontale sta a `off` dalla quota Y a metà tra i nodi, quella verticale dalla X a metà', () => {
    const pm = new Map<string, Vec2>([['a', [0, 0]], ['b', [10, 6]]]);
    const x = dimLayout({ id: 'k', t: 'distX', p: ['a', 'b'], v: 10, off: 2 }, pm, 0)!;
    expect([x.a2, x.b2]).toEqual([[0, 5], [10, 5]]);
    // Anche tra i due nodi (negativo abbastanza): la linea può stare in mezzo
    expect(dimLayout({ id: 'k', t: 'distX', p: ['a', 'b'], v: 10, off: -3 }, pm, 0)!.a2).toEqual([0, 0]);
    const y = dimLayout({ id: 'k', t: 'distY', p: ['a', 'b'], v: 6, off: -1 }, pm, 0)!;
    expect([y.a2, y.b2]).toEqual([[4, 0], [4, 6]]);
  });
});

describe('disposizione automatica delle quote', () => {
  it('sul rettangolo: quattro quote in sequenza, tutte fuori dal disegno e senza sovrapporsi', () => {
    const list = createAll(rect, [['len', 'n1', 'n2'], ['len', 'n2', 'n3'], ['len', 'n3', 'n4'], ['len', 'n4', 'n1']]);
    const boxes = list.map((c) => labelOf(c, rect));
    boxes.forEach((b) => expect(outsideRect(b)).toBe(true));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    // Ognuna sta dalla parte esterna del suo lato: sotto, a destra, sopra, a sinistra
    expect(boxes[0].c[1]).toBeLessThan(0);
    expect(boxes[1].c[0]).toBeGreaterThan(40);
    expect(boxes[2].c[1]).toBeGreaterThan(20);
    expect(boxes[3].c[0]).toBeLessThan(0);
    // La prima è alla distanza iniziale: 30 pixel = 3 mm
    expect(Math.abs(list[0].off!)).toBeCloseTo(3, 9);
  });

  it('due quote sullo stesso lato (allineata e orizzontale) non si sovrappongono: la seconda si allontana', () => {
    const list = createAll(rect, [['len', 'n1', 'n2'], ['h', 'n1', 'n2'], ['h', 'n1', 'n2']]);
    const boxes = list.map((c) => labelOf(c, rect));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    boxes.forEach((b) => expect(outsideRect(b)).toBe(true));
    // Le stesse quote sullo stesso segmento: ognuna più lontana della precedente (stessa parte, scostamenti crescenti in valore assoluto)
    const offs = list.map((c) => Math.abs(c.off!));
    expect(offs[1]).toBeGreaterThan(offs[0]);
    expect(offs[2]).toBeGreaterThan(offs[1]);
  });

  it('una quota lunga e una corta con etichette larghe: nessuna sovrapposizione anche con molte quote sullo stesso lato', () => {
    const list = createAll(rect, [['len', 'n1', 'n2'], ['h', 'n1', 'n2'], ['len', 'n1', 'n2'], ['h', 'n2', 'n1']]);
    const boxes = list.map((c) => labelOf(c, rect));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
  });

  it('lato interno di una L: il baricentro suggerisce di scendere dentro il braccio, ma l\'etichetta va fuori dal disegno', () => {
    const [dim] = createAll(ell, [['len', 'n3', 'n4']]);
    const label = dimLayout(dim, pointMap(ell), 0)!.label;
    const polygon = ell[0].nodes.map((n) => n.p);
    expect(pointInPolygon(polygon, label)).toBe(false);
    // Sta sopra il lato (y > 10): sotto c'è il braccio in basso, alto 10 mm
    expect(label[1]).toBeGreaterThan(10);
  });

  it('apertura di una U: la quota orizzontale tra le punte dei bracci sta sopra, fuori dal disegno', () => {
    const [dim] = createAll(ushape, [['h', 'n7', 'n4']]);
    const layout = dimLayout(dim, pointMap(ushape), 0)!;
    expect(layout.label[1]).toBeGreaterThan(30);
    expect(pointInPolygon(ushape[0].nodes.map((n) => n.p), layout.label)).toBe(false);
    // Anche la quota dell'apertura interna (da n6 a n5, in fondo alla U) non cade dentro il materiale
    const inner = createAll(ushape, [['h', 'n6', 'n5']])[0];
    const innerLabel = dimLayout(inner, pointMap(ushape), 0)!.label;
    expect(pointInPolygon(ushape[0].nodes.map((n) => n.p), innerLabel)).toBe(false);
  });

  it('quota dove non c\'è posto fuori: resta alla distanza iniziale (non si blocca)', () => {
    // Un solo nodo ripetuto non ha lati: p mancanti danno off 0
    expect(placeDimension(rect, [], { t: 'dist', p: ['n1', 'x'] }, PX)).toEqual({ off: 0, at: 0.5 });
  });

  it('repositionDimensions ridispone tutte le quote di lunghezza una dopo l\'altra, lascia le altre voci e dà lo stesso risultato se si ripete', () => {
    const base = createAll(rect, [['len', 'n1', 'n2'], ['len', 'n2', 'n3'], ['h', 'n1', 'n2']]);
    // Tutte sulla stessa distanza e al centro, ammucchiate
    const messy: ProfileConstraint[] = [
      ...base.map((c) => ({ ...c, off: -3, at: 0.5 })),
      { id: 'kH', t: 'horizontal', p: ['n1', 'n2'] },
      { id: 'kR', t: 'dist', p: ['n1', 'n3'], ref: true },
    ];
    const out = repositionDimensions(rect, messy, PX);
    expect(out.find((c) => c.id === 'kH')).toBe(messy.find((c) => c.id === 'kH'));
    const dims = out.filter((c) => c.t !== 'horizontal');
    const boxes = dims.map((c) => labelOf(c, rect));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    expect(out.map((c) => c.id)).toEqual(messy.map((c) => c.id));
    expect(repositionDimensions(rect, out, PX)).toEqual(out);
  });
});

describe('trascinamento della quota', () => {
  const pm = pointMap(rect);

  it('allineata: l\'etichetta trascinata in un punto ci resta; la linea cambia solo `off` e tiene `at`', () => {
    const c: ProfileConstraint = { id: 'k', t: 'dist', p: ['n1', 'n2'], v: 40, off: -3, at: 0.5 };
    const moved = dragDimension(c, pm, [10, -8], 'label');
    expect(moved.at).toBeCloseTo(0.25, 9);
    // normale a sinistra di A→B (verso l'alto): sotto il segmento, quindi negativa
    expect(moved.off).toBeCloseTo(-8, 9);
    const label = dimLayout({ ...c, ...moved }, pm, 0)!.label;
    expect(label[0]).toBeCloseTo(10, 9);
    expect(label[1]).toBeCloseTo(-8, 9);
    const line = dragDimension({ ...c, at: 0.8 }, pm, [10, -8], 'line');
    expect(line).toEqual({ off: -8, at: 0.8 });
  });

  it('orizzontale e verticale: lo stesso, nelle coordinate degli assi', () => {
    const x: ProfileConstraint = { id: 'k', t: 'distX', p: ['n1', 'n2'], v: 40, s: 1, off: -3, at: 0.5 };
    const mx = dragDimension(x, pm, [30, 25], 'label');
    expect(mx.at).toBeCloseTo(0.75, 9);
    expect(mx.off).toBeCloseTo(25, 9);
    expect(dimLayout({ ...x, ...mx }, pm, 0)!.label).toEqual([30, 25]);
    const y: ProfileConstraint = { id: 'k', t: 'distY', p: ['n2', 'n3'], v: 20, s: 1, off: 3, at: 0.5 };
    const my = dragDimension(y, pm, [55, 5], 'label');
    expect(my.at).toBeCloseTo(0.25, 9);
    expect(my.off).toBeCloseTo(15, 9);
    expect(dimLayout({ ...y, ...my }, pm, 0)!.label[0]).toBeCloseTo(55, 9);
  });

  it('`at` resta tra 0 e 1 anche trascinando oltre gli estremi; nodi mancanti non cambiano nulla', () => {
    const c: ProfileConstraint = { id: 'k', t: 'dist', p: ['n1', 'n2'], v: 40, off: -3, at: 0.5 };
    expect(dragDimension(c, pm, [-50, 0], 'label').at).toBe(0);
    expect(dragDimension(c, pm, [90, 0], 'label').at).toBe(1);
    expect(dragDimension({ ...c, p: ['n1', 'zz'] }, pm, [5, 5], 'label')).toEqual({ off: -3, at: 0.5 });
  });
});
