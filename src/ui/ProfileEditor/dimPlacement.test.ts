import { describe, expect, it } from 'vitest';
import { angleLayout, arcPoints, dimLayout, dimText, dimensionValue, dragDimension, fmtDim, insideDrawing, pillWidthPx, placeDimension, pointMap, repositionDimensions } from './dimPlacement';
import { createAngleDimension, createDimension } from './dimensions';
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

  it('un foro è fuori dal disegno pieno: una quota sul suo bordo può stare dentro il foro; un contorno aperto non conta come area', () => {
    // Rettangolo 40 x 20 con un foro quadrato 12 x 12 al centro (nodi n5..n8: lato in basso da n5 a n6)
    const hole: PathContour[] = [
      ...rect,
      { closed: true, nodes: [[14, 4], [26, 4], [26, 16], [14, 16]].map((p, i) => ({ id: `n${i + 5}`, p: p as Vec2, kind: 'corner' as const })) },
    ];
    expect(insideDrawing(hole, [5, 10])).toBe(true);
    expect(insideDrawing(hole, [20, 10])).toBe(false);
    expect(insideDrawing(hole, [50, 10])).toBe(false);
    // Un contorno aperto (una C) non delimita area: il punto «dentro» non è nel disegno
    const open: PathContour[] = [{ closed: false, nodes: [[0, 0], [40, 0], [40, 20], [0, 20]].map((p, i) => ({ id: `o${i + 1}`, p: p as Vec2, kind: 'corner' as const })) }];
    expect(insideDrawing(open, [20, 10])).toBe(false);
    // La quota del lato in basso del foro: l'etichetta finisce nel vuoto del foro (sopra il lato), mai nel materiale tra il foro e il bordo
    const list = createAll(hole, [['len', 'n5', 'n6']]);
    const label = dimLayout(list[0], pointMap(hole), 0)!.label;
    expect(insideDrawing(hole, label)).toBe(false);
    expect(label[0]).toBeGreaterThan(14);
    expect(label[0]).toBeLessThan(26);
    expect(label[1]).toBeGreaterThan(4);
    expect(label[1]).toBeLessThan(16);
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

describe('quota angolare: arco, trascinamento e posizione', () => {
  /** Triangolo con l'angolo di 90 gradi in n2: n1 (0,0), n2 (40,0), n3 (40,20). */
  const tri = poly([[0, 0], [40, 0], [40, 20]]);
  const pm = pointMap(tri);
  /** L'angolo in n2 dal raggio verso n3 (su) a quello verso n1 (sinistra): +90 gradi. */
  const corner90: ProfileConstraint = { id: 'a', t: 'angle', p: ['n2', 'n3', 'n2', 'n1'], v: 90, off: 5, at: 0.5 };

  it('angleLayout: vertice, partenza, ampiezza con segno e etichetta sull\'arco alla posizione `at`', () => {
    const l = angleLayout(corner90, pm, 0)!;
    expect(l.vertex).toEqual([40, 0]);
    expect(l.start).toBeCloseTo(Math.PI / 2, 9);
    expect(l.span).toBeCloseTo(Math.PI / 2, 9);
    expect(l.radius).toBe(5);
    // A metà dell'arco: sulla bisettrice (direzione 135 gradi) a 5 mm dal vertice
    expect(l.label[0]).toBeCloseTo(40 + 5 * Math.cos((3 * Math.PI) / 4), 9);
    expect(l.label[1]).toBeCloseTo(5 * Math.sin((3 * Math.PI) / 4), 9);
    // `at` 0 e 1: gli estremi dell'arco
    expect(angleLayout({ ...corner90, at: 0 }, pm, 0)!.label[1]).toBeCloseTo(5, 9);
    expect(angleLayout({ ...corner90, at: 1 }, pm, 0)!.label[0]).toBeCloseTo(35, 9);
    // Senza `off` vale il raggio di riserva; nodi mancanti: null
    expect(angleLayout({ ...corner90, off: undefined }, pm, 7)!.radius).toBe(7);
    expect(angleLayout({ ...corner90, p: ['n2', 'zz', 'n2', 'n1'] }, pm, 7)).toBeNull();
    const arc = arcPoints(l, 4);
    expect(arc).toHaveLength(5);
    for (const q of arc) expect(Math.hypot(q[0] - 40, q[1])).toBeCloseTo(5, 9);
  });

  it('segmenti lontani: il vertice è dove si incontrano le rette; con due punti l\'angolo è dall\'asse X', () => {
    const far = new Map<string, Vec2>([['a', [0, 0]], ['b', [10, 0]], ['c', [30, 10]], ['d', [20, 0]]]);
    // Prima retta: asse X; seconda: da (30,10) a (20,0), diagonale a 45 gradi che incontra l'asse in (20, 0)
    const l = angleLayout({ id: 'k', t: 'angle', p: ['a', 'b', 'c', 'd'], v: 45, off: 3 }, far, 0)!;
    expect(l.vertex[0]).toBeCloseTo(20, 9);
    expect(l.vertex[1]).toBeCloseTo(0, 9);
    expect(l.start).toBeCloseTo(0, 9);
    // La seconda retta va da (30,10) a (20,0): direzione a 225 gradi, cioè -135 (l'angolo più breve, in senso orario)
    expect(l.span).toBeCloseTo(-(3 * Math.PI) / 4, 9);
    const axis = angleLayout({ id: 'k', t: 'angle', p: ['a', 'c'], v: 18.43, off: 2 }, far, 0)!;
    expect(axis.vertex).toEqual([0, 0]);
    expect(axis.start).toBe(0);
    expect(axis.span).toBeCloseTo(Math.atan2(10, 30), 9);
  });

  it('dragDimension: l\'etichetta passa per il puntatore (raggio e posizione sull\'arco), la linea cambia solo il raggio', () => {
    const moved = dragDimension(corner90, pm, [40 + 8 * Math.cos((5 * Math.PI) / 8), 8 * Math.sin((5 * Math.PI) / 8)], 'label');
    expect(moved.off).toBeCloseTo(8, 9);
    // 5 pi/8 = 112,5 gradi: un quarto dell'arco dalla partenza (90) a 180
    expect(moved.at).toBeCloseTo(0.25, 9);
    const label = angleLayout({ ...corner90, ...moved }, pm, 0)!.label;
    expect(label[0]).toBeCloseTo(40 + 8 * Math.cos((5 * Math.PI) / 8), 9);
    const line = dragDimension({ ...corner90, at: 0.8 }, pm, [40, 12], 'line');
    expect(line).toEqual({ off: 12, at: 0.8 });
    // Fuori dall'arco: `at` resta tra 0 e 1
    expect(dragDimension(corner90, pm, [40 + 5, 0], 'label').at).toBe(0);
    expect(dragDimension(corner90, pm, [40, -5], 'label').at).toBe(0);
    expect(dragDimension({ ...corner90, p: ['n2', 'zz', 'n2', 'n1'] }, pm, [1, 1], 'label')).toEqual({ off: 5, at: 0.5 });
  });

  it('due angoli sullo stesso vertice non si sovrappongono, e nessuna etichetta tocca i lati; ridisporre non perde le quote d\'angolo', () => {
    const quad = poly([[0, 0], [40, 0], [40, 20], [0, 20]]);
    const first = createAngleDimension(quad, ['n1', 'n2'], ['n2', 'n3'], PX) as Omit<ProfileConstraint, 'id'>;
    const k1: ProfileConstraint = { ...first, id: 'k1' };
    const second = createAngleDimension(quad, ['n1', 'n2'], ['n2', 'n3'], PX, [k1]) as Omit<ProfileConstraint, 'id'>;
    const k2: ProfileConstraint = { ...second, id: 'k2' };
    const [b1, b2] = [k1, k2].map((c) => {
      const label = angleLayout(c, pointMap(quad), 0)!.label;
      const [w, h] = [pillWidthPx(dimText(c, quad)) / PX, 18 / PX];
      return { x0: label[0] - w / 2, x1: label[0] + w / 2, y0: label[1] - h / 2, y1: label[1] + h / 2 };
    });
    const overlaps = b1.x0 < b2.x1 && b2.x0 < b1.x1 && b1.y0 < b2.y1 && b2.y0 < b1.y1;
    expect(overlaps).toBe(false);
    expect(k2.off!).toBeGreaterThan(k1.off!);
    // L'arco è dentro il rettangolo (angolo interno): nessuna etichetta incrocia un lato
    for (const b of [b1, b2]) {
      expect(b.x1).toBeLessThanOrEqual(40);
      expect(b.y0).toBeGreaterThanOrEqual(0);
    }
    const mixed: ProfileConstraint[] = [{ id: 'h', t: 'horizontal', p: ['n1', 'n2'] }, { ...k1, off: 1 }, { ...k2, off: 1 }];
    const out = repositionDimensions(quad, mixed, PX);
    expect(out[0]).toBe(mixed[0]);
    expect(out[1].off).toBeGreaterThan(1);
    expect(out[2].off).toBeGreaterThan(out[1].off!);
  });
});
