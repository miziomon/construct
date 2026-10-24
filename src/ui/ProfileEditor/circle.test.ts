import { describe, expect, it } from 'vitest';
import { CIRCLE_KAPPA, assignNodeIds, decodePathMeta, encodePathMeta, metaVersion, nodeIds, regenCircle, sanitizeConstraints, sanitizePaths, samplePaths } from '../../scene/bezier';
import { roundPaths } from '../../scene/store';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';
import { addCircle, addConstraint, circleDimension, circleOfPair, circleQuote, diagnose, dimLayout, dimText, dragDimension, dragFrame, idsOf, moveNodesConstrained, nodeNames, pointMap, pointsOf, setConstraintValue, settlePaths, validConstraints } from './dimensions';
import type { Applied } from './dimensions';
import { bakeScale, baseShapeContour, contourHoles, deleteNodes, moveNodes, normalizeProfile, pruneConstraints, refPoint } from './model';
import type { Draft } from './model';
import { setQuoteText } from './profileParams';

type Geo = { paths: PathContour[]; constraints?: ProfileConstraint[] };

/** Piastra 60 x 40 con id dei nodi (n1..n4). */
const plate = (): Geo => ({
  paths: [
    {
      closed: true,
      nodes: [
        { id: 'n1', p: [0, 0], kind: 'corner' },
        { id: 'n2', p: [60, 0], kind: 'corner' },
        { id: 'n3', p: [60, 40], kind: 'corner' },
        { id: 'n4', p: [0, 40], kind: 'corner' },
      ],
    },
  ],
});

const must = <T>(r: Applied<T>): T => {
  if (!r.ok) throw new Error(r.message);
  return r.draft;
};
/** Piastra con un foro di diametro `d` al centro (30, 20). */
const withHole = (d = 10): { geo: Geo; index: number; quote: string } => {
  const added = addCircle(plate(), [30, 20], d / 2, 8);
  if (typeof added === 'string') throw new Error(added);
  return { geo: added.draft, index: added.path, quote: added.quote };
};
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Area col segno del poligono campionato di un contorno. */
const area = (c: PathContour): number => {
  const pts = samplePaths([c], 0.01).contours[0].points;
  return Math.abs(pts.reduce((s, p, i) => s + (p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1]), 0) / 2);
};

describe('cerchio parametrico: creazione e coerenza dei nodi', () => {
  it('addCircle: contorno chiuso di 4 nodi, solo il primo con id, centro con id e quota Ø con il raggio', () => {
    const { geo, index, quote } = withHole(10);
    const c = geo.paths[index];
    expect(c.closed).toBe(true);
    expect(c.nodes).toHaveLength(4);
    expect(c.nodes.map((n) => !!n.id)).toEqual([true, false, false, false]);
    expect(c.circ).toMatchObject({ p: [30, 20] });
    expect(c.circ!.id).not.toBe(c.nodes[0].id);
    const q = geo.constraints!.find((k) => k.id === quote)!;
    expect(q).toMatchObject({ t: 'dist', dia: true, v: 5, p: [c.circ!.id, c.nodes[0].id] });
    expect(circleQuote(geo, index)).toBe(q);
    // Il diametro si legge e si scrive come diametro: «Ø10», e il nome è Diametro C2 (il secondo contorno)
    expect(dimText(q, geo.paths)).toBe('Ø10');
    expect(nodeNames(geo.paths).get(c.circ!.id)).toBe('C2');
    // Con il centro quotato in x e y non c'è altro: il centro e il primo nodo sono i soli punti del cerchio
    expect(pointsOf(geo.paths).filter((p) => p.id === c.circ!.id || p.id === c.nodes[0].id)).toHaveLength(2);
    expect([...pointMap([c]).keys()]).toEqual([c.circ!.id, c.nodes[0].id]);
  });

  it('i quattro nodi stanno sul cerchio, a quarti di giro, con le maniglie a 0,5523 volte il raggio e l\'area giusta', () => {
    const { geo, index } = withHole(10);
    const c = geo.paths[index];
    for (const n of c.nodes) expect(dist(n.p, c.circ!.p)).toBeCloseTo(5, 9);
    // Il primo a destra, poi in alto, a sinistra, in basso
    expect(c.nodes.map((n) => [Math.round(n.p[0] * 1e6) / 1e6, Math.round(n.p[1] * 1e6) / 1e6])).toEqual([[35, 20], [30, 25], [25, 20], [30, 15]]);
    for (const n of c.nodes) {
      expect(Math.hypot(...(n.out as Vec2))).toBeCloseTo(5 * CIRCLE_KAPPA, 9);
      expect(n.in![0]).toBeCloseTo(-n.out![0], 12);
      expect(n.in![1]).toBeCloseTo(-n.out![1], 12);
      expect(n.kind).toBe('symmetric');
    }
    // Area del cerchio campionato: π·25 entro lo 0,2 %
    expect(area(c)).toBeGreaterThan(Math.PI * 25 * 0.998);
    expect(area(c)).toBeLessThan(Math.PI * 25 * 1.002);
    // Un foro: il contorno dentro la piastra è un foro per il kernel
    expect(contourHoles({ paths: geo.paths, tolerance: 0.05, extrusion: 'linear' })).toEqual([false, true]);
  });

  it('un cerchio troppo piccolo o con un diametro non ammesso non si crea', () => {
    expect(typeof addCircle(plate(), [0, 0], 0.01, 8)).toBe('string');
    expect(typeof addCircle(plate(), [0, 0], 0, 8)).toBe('string');
    expect(typeof addCircle(plate(), [0, 0], 1e6, 8)).toBe('string');
  });

  it('regenCircle ricalcola dal centro e dal nodo sul bordo; un contorno senza cerchio o già coerente resta lo stesso oggetto', () => {
    const { geo, index } = withHole(10);
    const c = geo.paths[index];
    expect(regenCircle(c)).toBe(c);
    const plain = geo.paths[0];
    expect(regenCircle(plain)).toBe(plain);
    // Il nodo sul bordo in alto a 45 gradi: gli altri tre ruotano con lui
    const moved = regenCircle({ ...c, nodes: c.nodes.map((n, i) => (i === 0 ? { ...n, p: [30 + 5 * Math.SQRT1_2, 20 + 5 * Math.SQRT1_2] as Vec2 } : n)) });
    for (const n of moved.nodes) expect(dist(n.p, c.circ!.p)).toBeCloseTo(5, 9);
    expect(moved.nodes[1].p[0]).toBeCloseTo(30 - 5 * Math.SQRT1_2, 9);
  });

  it('assignNodeIds non dà un id ai tre nodi derivati e nodeIds conta il centro', () => {
    const { geo, index } = withHole(10);
    const stripped = { ...geo.paths[index], nodes: geo.paths[index].nodes.map((n, i) => (i === 0 ? { ...n, id: undefined } : n)) };
    const out = assignNodeIds([...geo.paths.slice(0, index), stripped as PathContour]);
    expect(out[index].nodes.map((n) => !!n.id)).toEqual([true, false, false, false]);
    expect(nodeIds(geo.paths).has(geo.paths[index].circ!.id)).toBe(true);
  });
});

describe('cerchio parametrico: quote, vincoli e trascinamento', () => {
  it('lo stato è sottovincolato di due gradi (il centro); con il centro quotato in x e y è completamente vincolato', () => {
    const { geo, index } = withHole(10);
    // 8 gradi di libertà della piastra (nessun vincolo) e 2 del centro del cerchio (raggio quotato)
    expect(diagnose(geo)!.report).toMatchObject({ state: 'under', dof: 10 });
    const holeOnly: Geo = { paths: [geo.paths[index]], constraints: geo.constraints };
    expect(diagnose(holeOnly)!.report).toMatchObject({ state: 'under', dof: 2 });
    // Il centro è un punto come gli altri: Fisso (con la sua posizione) vale due gradi
    const c = geo.paths[index];
    const fixed: Geo = { ...geo, constraints: [...geo.constraints!, { id: 'k9', t: 'fixed', p: [c.circ!.id], x: 30, y: 20 }] };
    expect(diagnose({ paths: [c], constraints: [fixed.constraints![0], fixed.constraints![1]] })!.report).toMatchObject({ state: 'full', dof: 0 });
    expect(diagnose(fixed)!.report).toMatchObject({ state: 'under', dof: 8 });
    // Il vincolo implicito del nodo sul bordo non si salva mai
    expect(validConstraints(fixed.paths, fixed.constraints).filter((k) => k.id.startsWith('h-'))).toHaveLength(1);
    expect(fixed.constraints!.some((k) => k.id.startsWith('h-'))).toBe(false);
  });

  it('cambiare la quota Ø cambia il raggio: i quattro nodi si ricalcolano e il centro resta', () => {
    const { geo, index, quote } = withHole(10);
    const out = must(setConstraintValue(geo, quote, 4));
    const c = out.paths[index];
    for (const n of c.nodes) expect(dist(n.p, c.circ!.p)).toBeCloseTo(4, 6);
    expect(c.circ!.p[0]).toBeCloseTo(30, 6);
    expect(area(c)).toBeGreaterThan(Math.PI * 16 * 0.998);
    // Dal testo: il diametro 12 vale raggio 6, e il messaggio di un valore non ammesso parla di misura
    const text = must(setQuoteText(geo, quote, '12'));
    expect(text.constraints!.find((k) => k.id === quote)!.v).toBe(6);
    expect(dimText(text.constraints!.find((k) => k.id === quote)!, text.paths)).toBe('Ø12');
    expect(setQuoteText(geo, quote, '0')).toMatchObject({ ok: false });
  });

  it('trascinare il centro sposta il cerchio intero (stesso raggio, stessa quota) anche con vincoli, e il nodo sul bordo ne cambia il raggio solo senza la quota', () => {
    const { geo, index, quote } = withHole(10);
    const centerRef = { path: index, node: 4 };
    expect(refPoint(geo.paths, centerRef)).toEqual([30, 20]);
    const frame = dragFrame(geo.paths, geo.constraints, [{ ref: centerRef, to: [40, 10] }], false);
    expect(frame.paths).not.toBeNull();
    const c = frame.paths![index];
    expect(c.circ!.p[0]).toBeCloseTo(40, 5);
    expect(c.circ!.p[1]).toBeCloseTo(10, 5);
    for (const n of c.nodes) expect(dist(n.p, c.circ!.p)).toBeCloseTo(5, 5);
    // Con le frecce (uno spostamento di un vettore) è lo stesso
    const arrow = moveNodesConstrained(geo.paths, geo.constraints, [{ path: index, node: 4 }], [3, -2]);
    expect(arrow[index].circ!.p[0]).toBeCloseTo(33, 5);
    expect(arrow[index].circ!.p[1]).toBeCloseTo(18, 5);
    // Un nodo derivato (senza id) trascina anche lui il cerchio intero
    const viaNode = moveNodesConstrained(geo.paths, geo.constraints, [{ path: index, node: 2 }], [1, 1]);
    expect(viaNode[index].circ!.p[0]).toBeCloseTo(31, 5);
    // Senza la quota Ø il nodo sul bordo cambia il raggio
    const free = { ...geo, constraints: geo.constraints!.filter((k) => k.id !== quote) };
    const wider = dragFrame(free.paths, free.constraints, [{ ref: { path: index, node: 0 }, to: [38, 20] }], false);
    expect(dist(wider.paths![index].nodes[0].p, wider.paths![index].circ!.p)).toBeCloseTo(8, 5);
    for (const n of wider.paths![index].nodes) expect(dist(n.p, wider.paths![index].circ!.p)).toBeCloseTo(8, 5);
    // Con la quota il nodo sul bordo non riesce a cambiare il raggio: resta com'era (o torna dopo la risoluzione)
    const held = dragFrame(geo.paths, geo.constraints, [{ ref: { path: index, node: 0 }, to: [38, 20] }], true);
    const settled = settlePaths(held.paths ?? geo.paths, geo.constraints);
    expect(dist(settled[index].nodes[0].p, settled[index].circ!.p)).toBeCloseTo(5, 4);
  });

  it('moveNodes (senza vincoli): il centro o un nodo derivato spostano il cerchio intero, il solo nodo sul bordo cambia il raggio', () => {
    const { geo, index } = withHole(10);
    const whole = moveNodes(geo.paths, [{ path: index, node: 4 }], [2, 3]);
    expect(whole[index].circ!.p).toEqual([32, 23]);
    expect(whole[index].nodes[0].p).toEqual([37, 23]);
    const derived = moveNodes(geo.paths, [{ path: index, node: 1 }], [2, 3]);
    expect(derived[index].circ!.p).toEqual([32, 23]);
    const first = moveNodes(geo.paths, [{ path: index, node: 0 }], [3, 0]);
    expect(first[index].circ!.p).toEqual([30, 20]);
    expect(dist(first[index].nodes[2].p, [30, 20])).toBeCloseTo(8, 9);
    // Tutti i nodi scelti (clic sulla curva): si sposta intero
    const all = moveNodes(geo.paths, [0, 1, 2, 3].map((node) => ({ path: index, node })), [1, 0]);
    expect(all[index].circ!.p).toEqual([31, 20]);
    expect(all[index].nodes[0].p).toEqual([36, 20]);
  });

  it('cancellare un nodo del cerchio, o il suo centro, elimina il cerchio intero e la sua quota', () => {
    const { geo, index } = withHole(10);
    for (const node of [0, 2, 4]) {
      const paths = deleteNodes(geo.paths, [{ path: index, node }]);
      expect(paths).toHaveLength(1);
    }
    const pruned = pruneConstraints({ ...geo, paths: deleteNodes(geo.paths, [{ path: index, node: 1 }]) });
    expect(pruned.constraints).toBeUndefined();
  });

  it('idsOf: il centro ha l\'indice dopo l\'ultimo nodo; i nodi derivati non hanno id', () => {
    const { geo, index } = withHole(10);
    const c = geo.paths[index];
    expect(idsOf(geo.paths, [{ path: index, node: 4 }, { path: index, node: 0 }, { path: index, node: 1 }])).toEqual([c.circ!.id, c.nodes[0].id]);
    expect(circleOfPair(geo.paths, c.nodes[0].id!, c.circ!.id)).toBe(index);
    expect(circleOfPair(geo.paths, 'n1', c.circ!.id)).toBe(-1);
  });

  it('circleDimension: la quota Ø di un cerchio che non l\'ha (cancellata), con il diametro che ha adesso', () => {
    const { geo, index, quote } = withHole(10);
    const none = { ...geo, constraints: geo.constraints!.filter((k) => k.id !== quote) };
    const dim = circleDimension(none.paths, index, 8, []);
    expect(dim).toMatchObject({ t: 'dist', dia: true, v: 5 });
    expect(circleDimension(none.paths, 0, 8, [])).toBe('Il diametro si assegna a un cerchio');
  });

  it('una quota di distanza dal centro a un nodo della piastra funziona come per i nodi (posizione del foro)', () => {
    const { geo, index } = withHole(10);
    const c = geo.paths[index];
    const fixed: Geo = { ...geo, constraints: [...geo.constraints!, { id: 'k9', t: 'fixed', p: ['n1'], x: 0, y: 0 }] };
    // Il centro a 25 mm in x e a 12 in y dal nodo fisso n1: il cerchio si sposta (il raggio non cambia)
    const a = must(addConstraint(fixed, { t: 'distX', p: ['n1', c.circ!.id], s: 1, v: 25 }));
    const out = must(addConstraint(a, { t: 'distY', p: ['n1', c.circ!.id], s: 1, v: 12 }));
    expect(out.paths[index].circ!.p[0]).toBeCloseTo(25, 5);
    expect(out.paths[index].circ!.p[1]).toBeCloseTo(12, 5);
    expect(out.paths[index].nodes[0].p[0]).toBeCloseTo(30, 5);
    // I 6 gradi che restano sono quelli della piastra con n1 fisso: il foro è completamente vincolato
    expect(diagnose(out)!.report).toMatchObject({ state: 'under', dof: 6 });
    expect(diagnose({ paths: [out.paths[index]], constraints: [{ id: 'kk', t: 'fixed', p: [c.circ!.id], x: 25, y: 12 }, out.constraints![0]] })!.report).toMatchObject({ state: 'full', dof: 0 });
  });
});

describe('cerchio parametrico: persistenza', () => {
  it('andata e ritorno nel commento: il cerchio e la quota Ø restano, la versione è 2', () => {
    const { geo } = withHole(10);
    const draft = { ...geo, tolerance: 0.05 } as Draft & Geo;
    expect(metaVersion({ paths: geo.paths })).toBe(2);
    const text = encodePathMeta({ paths: geo.paths, tolerance: 0.05, width: 60, depth: 40, constraints: geo.constraints });
    const back = decodePathMeta(text)!;
    expect(back.paths[1].circ).toEqual(geo.paths[1].circ);
    expect(back.paths[1].nodes.map((n) => !!n.id)).toEqual([true, false, false, false]);
    expect(back.constraints).toEqual(geo.constraints);
    expect(back.constraints![0]).toMatchObject({ dia: true });
    expect(draft.paths).toHaveLength(2);
  });

  it('sanitizePaths: un cerchio non valido (non chiuso, non di 4 nodi, id doppio, centro non finito) perde il cerchio e resta un contorno normale', () => {
    const { geo } = withHole(10);
    const good = JSON.parse(JSON.stringify(geo.paths));
    expect(sanitizePaths(good)![1].circ).toEqual(geo.paths[1].circ);
    const bad = (patch: (c: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(geo.paths));
      patch(copy[1]);
      return sanitizePaths(copy)![1];
    };
    expect(bad((c) => { c.closed = false; }).circ).toBeUndefined();
    expect(bad((c) => { (c.nodes as unknown[]).pop(); }).circ).toBeUndefined();
    expect(bad((c) => { (c.circ as { id: string }).id = 'n1'; }).circ).toBeUndefined();
    expect(bad((c) => { (c.circ as { p: unknown }).p = [Number.NaN, 0]; }).circ).toBeUndefined();
    expect(bad((c) => { (c.circ as { id: string }).id = 'a b'; }).circ).toBeUndefined();
    expect(bad((c) => { c.circ = 5; }).circ).toBeUndefined();
    // Gli id dei nodi derivati (scritti a mano) si scartano
    const withIds = bad((c) => { (c.nodes as { id?: string }[])[2].id = 'zz'; });
    expect(withIds.nodes[2].id).toBeUndefined();
  });

  it('sanitizeConstraints: dia solo su una distanza pilotante, expr solo su quote pilotanti e non troppo lunga', () => {
    const { geo } = withHole(10);
    const [centerId, nodeId] = [geo.paths[1].circ!.id, geo.paths[1].nodes[0].id as string];
    const clean = sanitizeConstraints(
      [
        { id: 'k1', t: 'dist', p: [centerId, nodeId], v: 5, dia: true, expr: 'foro/2' },
        { id: 'k2', t: 'dist', p: ['n1', 'n2'], v: 5, dia: true, ref: true, expr: 'x' },
        { id: 'k3', t: 'horizontal', p: ['n1', 'n2'], dia: true, expr: 'x' },
        { id: 'k4', t: 'distX', p: ['n1', 'n2'], v: 5, expr: 'x'.repeat(201) },
        { id: 'k5', t: 'distX', p: ['n1', 'n2'], v: 5, expr: '' },
      ],
      geo.paths,
    );
    expect(clean.find((c) => c.id === 'k1')).toMatchObject({ dia: true, expr: 'foro/2' });
    expect(clean.find((c) => c.id === 'k2')).not.toHaveProperty('dia');
    expect(clean.find((c) => c.id === 'k2')).not.toHaveProperty('expr');
    expect(clean.find((c) => c.id === 'k3')).not.toHaveProperty('dia');
    expect(clean.find((c) => c.id === 'k4')).not.toHaveProperty('expr');
    expect(clean.find((c) => c.id === 'k5')).not.toHaveProperty('expr');
  });

  it('roundPaths arrotonda anche il centro; bakeScale scala il centro e il cerchio resta un cerchio', () => {
    const { geo, index } = withHole(10);
    const shifted = { ...geo.paths[index], circ: { ...geo.paths[index].circ!, p: [30.123456789, 20.987654321] as Vec2 } };
    expect(roundPaths([shifted])[0].circ!.p).toEqual([30.1235, 20.9877]);
    const scaled = bakeScale(geo.paths, 2, 2, 0, 0)[index];
    expect(scaled.circ!.p).toEqual([60, 40]);
    for (const n of scaled.nodes) expect(dist(n.p, scaled.circ!.p)).toBeCloseTo(10, 9);
    // Scala non uniforme: sempre un cerchio, di raggio quello del nodo sul bordo
    const flat = bakeScale(geo.paths, 2, 1, 0, 0)[index];
    for (const n of flat.nodes) expect(dist(n.p, flat.circ!.p)).toBeCloseTo(dist(flat.nodes[0].p, flat.circ!.p), 9);
  });

  it('normalizeProfile non dà id ai nodi derivati e mantiene la quota Ø', () => {
    const { geo, quote } = withHole(10);
    const out = normalizeProfile(geo);
    expect(out.paths[1].nodes.map((n) => !!n.id)).toEqual([true, false, false, false]);
    expect(out.constraints!.some((c) => c.id === quote)).toBe(true);
  });
});

describe('cerchio parametrico: gesti e quota sul disegno', () => {
  it('baseShapeContour con lo strumento Cerchio: un cerchio di centro e raggio dati, nullo se il raggio è zero', () => {
    const c = baseShapeContour({ tool: 'circle', center: [5, 5], to: [8, 9], shift: false, sides: 6 })!;
    expect(c.circ!.p).toEqual([5, 5]);
    expect(dist(c.nodes[0].p, [5, 5])).toBeCloseTo(5, 9);
    expect(baseShapeContour({ tool: 'circle', center: [5, 5], to: [5, 5], shift: false, sides: 6 })).toBeNull();
  });

  it('il nodo sul bordo portato in diagonale cambia solo il raggio: il centro non si muove, nemmeno dopo la risoluzione', () => {
    const { geo, index, quote } = withHole(10);
    const free = { ...geo, constraints: geo.constraints!.filter((k) => k.id !== quote) };
    // Senza vincoli (spostamento libero)
    const moved = moveNodes(free.paths, [{ path: index, node: 0 }], [3, 4]);
    expect(moved[index].circ!.p).toEqual([30, 20]);
    expect(dist(moved[index].nodes[0].p, [30, 20])).toBeCloseTo(dist([35 + 3, 20 + 4], [30, 20]), 9);
    expect(moved[index].nodes[0].p[1]).toBeCloseTo(20, 9);
    // Con la risoluzione (il rilascio): il centro resta
    const settled = settlePaths(moved, free.constraints);
    expect(settled[index].circ!.p[0]).toBeCloseTo(30, 6);
    expect(settled[index].circ!.p[1]).toBeCloseTo(20, 6);
    // Con i vincoli (un trascinamento): lo stesso
    const frame = dragFrame(free.paths, [{ id: 'k9', t: 'fixed', p: ['n1'], x: 0, y: 0 }], [{ ref: { path: index, node: 0 }, to: [38, 24] }], false);
    expect(frame.paths![index].circ!.p).toEqual([30, 20]);
    expect(dist(frame.paths![index].nodes[0].p, [30, 20])).toBeCloseTo(Math.hypot(8, 4), 5);
  });

  it('la quota Ø sta sopra il cerchio: le linee di richiamo sfiorano i due lati e la linea di quota è orizzontale a un raggio più il margine', () => {
    const { geo, index, quote } = withHole(10);
    const q = geo.constraints!.find((k) => k.id === quote)!;
    const pm = pointMap(geo.paths);
    const layout = dimLayout(q, pm, 0)!;
    expect(layout.a).toEqual([25, 20]);
    expect(layout.b).toEqual([35, 20]);
    expect(layout.a2[1]).toBeGreaterThan(25);
    expect(layout.a2[1]).toBeCloseTo(layout.b2[1], 9);
    expect(layout.label[0]).toBeCloseTo(30, 9);
    // Trascinando la linea più su di 4 mm, la distanza (off) cresce di 4
    const moved = dragDimension(q, pm, [30, layout.a2[1] + 4], 'line');
    expect(moved.off).toBeCloseTo((q.off ?? 0) + 4, 6);
    expect(index).toBe(1);
  });
});
