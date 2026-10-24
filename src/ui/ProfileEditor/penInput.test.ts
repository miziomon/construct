import { describe, expect, it } from 'vitest';
import { diagnose, addFixed, pointMap } from './dimensions';
import { normalizeDeg, penQuotes, penTarget, polar, typed, typedPenNode } from './penInput';
import type { Draft } from './model';
import type { PenTarget } from './penInput';

describe('lettura dei campi digitati', () => {
  it('vuoto, numeri con virgola o punto e segno, e testo non valido', () => {
    expect(typed('')).toEqual({ kind: 'empty' });
    expect(typed('   ')).toEqual({ kind: 'empty' });
    expect(typed('60')).toEqual({ kind: 'number', value: 60 });
    expect(typed('12,5')).toEqual({ kind: 'number', value: 12.5 });
    expect(typed(' -45.25 ')).toEqual({ kind: 'number', value: -45.25 });
    expect(typed('+3')).toEqual({ kind: 'number', value: 3 });
    expect(typed('.5')).toEqual({ kind: 'number', value: 0.5 });
    for (const bad of ['abc', '1e3', '1,2,3', '--5', '5 mm', '10/2', '-']) expect(typed(bad)).toEqual({ kind: 'bad' });
  });

  it('normalizeDeg porta gli angoli in (-180, 180]', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(90)).toBe(90);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(270)).toBe(-90);
    expect(normalizeDeg(360)).toBe(0);
    expect(Object.is(normalizeDeg(360), 0)).toBe(true);
    expect(normalizeDeg(-270)).toBe(90);
    expect(normalizeDeg(725)).toBe(5);
  });

  it('polar: i multipli di 90 gradi sono esatti, gli altri angoli no', () => {
    expect(polar(10, 0)).toEqual([10, 0]);
    expect(polar(10, 90)).toEqual([0, 10]);
    expect(polar(10, 180)).toEqual([-10, 0]);
    expect(polar(10, 270)).toEqual([0, -10]);
    expect(polar(10, -90)).toEqual([0, -10]);
    expect(polar(10, 360)).toEqual([10, 0]);
    expect(polar(10, -180)).toEqual([-10, 0]);
    expect(polar(10, 450)).toEqual([0, 10]);
    const diag = polar(10, 45);
    expect(diag[0]).toBeCloseTo(7.0710678, 6);
    expect(diag[1]).toBeCloseTo(7.0710678, 6);
  });
});

describe('penTarget: il nodo che nasce da lunghezza e angolo digitati', () => {
  const last: [number, number] = [10, 5];

  it('entrambi digitati: il punto è esatto anche per gli angoli negativi, 0, 90, 270 e oltre', () => {
    for (const [l, a, expected] of [
      ['60', '0', [70, 5]],
      ['40', '90', [10, 45]],
      ['60', '180', [-50, 5]],
      ['40', '270', [10, -35]],
      ['40', '-90', [10, -35]],
      ['40', '360', [50, 5]],
      ['3', '-180', [7, 5]],
    ] as const) {
      const t = penTarget(last, [999, 999], l, a);
      expect(t).toMatchObject({ ok: true, typedLength: true, typedAngle: true });
      if (t.ok) expect(t.p).toEqual(expected);
    }
    const slanted = penTarget(last, null, '10', '30');
    expect(slanted.ok && slanted.p[0]).toBeCloseTo(10 + 10 * Math.cos(Math.PI / 6), 9);
    expect(slanted.ok && slanted.p[1]).toBeCloseTo(5 + 5, 9);
  });

  it('un campo vuoto segue il cursore: lunghezza libera con angolo digitato, angolo libero con lunghezza digitata', () => {
    // Cursore a (10, 25): 20 mm sopra il nodo
    const freeLength = penTarget(last, [10, 25], '', '0');
    expect(freeLength).toMatchObject({ ok: true, typedLength: false, typedAngle: true, length: 20 });
    if (freeLength.ok) expect(freeLength.p).toEqual([30, 5]);
    const freeAngle = penTarget(last, [10, 25], '7', '');
    expect(freeAngle).toMatchObject({ ok: true, typedLength: true, typedAngle: false, angle: 90 });
    if (freeAngle.ok) expect(freeAngle.p).toEqual([10, 12]);
    // Tutti e due vuoti: il segmento fino al cursore
    const both = penTarget(last, [13, 9], '', '');
    expect(both).toMatchObject({ ok: true, typedLength: false, typedAngle: false });
    if (both.ok) {
      expect(both.p[0]).toBeCloseTo(13, 9);
      expect(both.p[1]).toBeCloseTo(9, 9);
    }
    // Senza cursore: dieci millimetri a destra
    const none = penTarget(last, null, '', '');
    expect(none.ok && none.p).toEqual([20, 5]);
  });

  it('valori non validi: un messaggio che dice quale campo (lunghezza zero, negativa o enorme, angolo oltre 360, testo)', () => {
    const message = (l: string, a: string, cursor: [number, number] | null = [50, 50]) => {
      const t = penTarget(last, cursor, l, a);
      return t.ok ? null : t.message;
    };
    expect(message('0', '0')).toBe('Lunghezza: la misura deve essere maggiore di zero');
    expect(message('-5', '0')).toBe('Lunghezza: la misura deve essere maggiore di zero');
    expect(message('1000000', '0')).toBe('Lunghezza: la misura è troppo grande');
    expect(message('10', '400')).toBe('L\'angolo deve stare tra -360 e 360 gradi');
    expect(message('abc', '0')).toBe('Lunghezza non valida: scrivi un numero');
    expect(message('10', 'xx')).toBe('Angolo non valido: scrivi un numero');
    // Lunghezza libera con il cursore sul nodo: nessun segmento
    expect(message('', '0', last)).toBe('Serve una lunghezza maggiore di zero: scrivila o sposta il cursore');
    // Una lunghezza enorme ma ammessa (100000) è valida
    expect(message('100000', '0')).toBeNull();
    // Il minimo ammesso
    expect(message('0.001', '0')).toBeNull();
  });
});

describe('quote dei valori digitati e nodo che nasce', () => {
  const ok = (last: [number, number], l: string, a: string): Extract<PenTarget, { ok: true }> => {
    const t = penTarget(last, [999, 999], l, a);
    if (!t.ok) throw new Error(t.message);
    return t;
  };
  /** Un contorno aperto con un solo nodo (la Penna ha fatto il primo clic). */
  const start = (): Draft => ({ paths: [{ closed: false, nodes: [{ p: [0, 0], kind: 'corner' }] }], tolerance: 0.05, extrusion: 'linear', height: 5, twist: 0, scaleTop: 1, revolveAngle: 360, revolveSegments: 64 });
  const step = (d: Draft, l: string, a: string): { draft: Draft; closing: boolean } => {
    const nodes = d.paths[0].nodes;
    const r = typedPenNode(d, 0, ok(nodes[nodes.length - 1].p, l, a), 10);
    if ('error' in r) throw new Error(r.error);
    return r;
  };

  it('penQuotes: la distanza se la lunghezza era scritta, l\'angolo (normalizzato) se era scritto l\'angolo, niente per i campi vuoti', () => {
    expect(penQuotes('a', 'b', ok([0, 0], '60', '0'))).toEqual([{ t: 'dist', p: ['a', 'b'], v: 60 }, { t: 'angle', p: ['a', 'b'], v: 0 }]);
    expect(penQuotes('a', 'b', ok([0, 0], '40', '270'))).toEqual([{ t: 'dist', p: ['a', 'b'], v: 40 }, { t: 'angle', p: ['a', 'b'], v: -90 }]);
    expect(penQuotes('a', 'b', penTarget([0, 0], [3, 4], '', '30') as Extract<PenTarget, { ok: true }>)).toEqual([{ t: 'angle', p: ['a', 'b'], v: 30 }]);
    expect(penQuotes('a', 'b', penTarget([0, 0], [3, 4], '7', '') as Extract<PenTarget, { ok: true }>)).toEqual([{ t: 'dist', p: ['a', 'b'], v: 7 }]);
    expect(penQuotes('a', 'b', penTarget([0, 0], [3, 4], '', '') as Extract<PenTarget, { ok: true }>)).toEqual([]);
  });

  it('un segmento digitato: il nodo nasce esatto, con gli id, e le quote sono posizionate fuori dal disegno', () => {
    const { draft, closing } = step(start(), '60', '0');
    expect(closing).toBe(false);
    expect(draft.paths[0].nodes.map((n) => n.p)).toEqual([[0, 0], [60, 0]]);
    expect(draft.paths[0].nodes.every((n) => n.id)).toBe(true);
    expect(draft.constraints!.map((c) => [c.t, c.v])).toEqual([['dist', 60], ['angle', 0]]);
    // Posizionate: la distanza ha uno scostamento, l'angolo un raggio, e nessuna è di riferimento
    for (const c of draft.constraints!) {
      expect(c.off).toBeDefined();
      expect(c.at).toBe(0.5);
      expect(c.ref).toBeUndefined();
    }
  });

  it('solo la lunghezza o solo l\'angolo: una quota sola; un campo vuoto non crea nulla', () => {
    const onlyLength = typedPenNode(start(), 0, penTarget([0, 0], [3, 4], '5', '') as Extract<PenTarget, { ok: true }>, 10);
    expect('draft' in onlyLength && onlyLength.draft.constraints!.map((c) => c.t)).toEqual(['dist']);
    const onlyAngle = typedPenNode(start(), 0, penTarget([0, 0], [3, 4], '', '90') as Extract<PenTarget, { ok: true }>, 10);
    expect('draft' in onlyAngle && onlyAngle.draft.constraints!.map((c) => c.t)).toEqual(['angle']);
    const neither = typedPenNode(start(), 0, penTarget([0, 0], [3, 4], '', '') as Extract<PenTarget, { ok: true }>, 10);
    expect('draft' in neither && neither.draft.constraints).toBeUndefined();
  });

  it('un rettangolo digitato 60 a 0°, 40 a 90°, 60 a 180°, 40 a 270°: i nodi esatti, il quarto lato chiude il contorno e le sue quote sono di riferimento', () => {
    let d = start();
    d = step(d, '60', '0').draft;
    d = step(d, '40', '90').draft;
    d = step(d, '60', '180').draft;
    const last = step(d, '40', '270');
    expect(last.closing).toBe(true);
    d = last.draft;
    expect(d.paths[0].closed).toBe(true);
    expect(d.paths[0].nodes.map((n) => n.p)).toEqual([[0, 0], [60, 0], [60, 40], [0, 40]]);
    // Tre lati con distanza e angolo; il quarto è già implicato (la forma si chiude da sola): le sue due quote sono di riferimento
    const quotes = d.constraints!;
    expect(quotes).toHaveLength(8);
    expect(quotes.filter((c) => c.ref)).toHaveLength(2);
    expect(quotes.filter((c) => !c.ref).map((c) => [c.t, c.v])).toEqual([['dist', 60], ['angle', 0], ['dist', 40], ['angle', 90], ['dist', 60], ['angle', 180]]);
    // Il quarto lato misura 40 e va a -90 gradi (270 normalizzato), tra parentesi
    expect(quotes.filter((c) => c.ref).map((c) => c.t)).toEqual(['dist', 'angle']);
    // Nessun conflitto né ridondanza: sottovincolato solo per la posizione (2 gradi di libertà); con il primo nodo fisso, completamente vincolato
    expect(diagnose(d)!.report).toMatchObject({ state: 'under', dof: 2 });
    const anchored = addFixed(d, ['n1']);
    expect(anchored.ok).toBe(true);
    if (anchored.ok) expect(diagnose(anchored.draft)!.report).toMatchObject({ state: 'full', dof: 0 });
  });

  it('con i vincoli automatici: la lunghezza digitata con angolo libero deduce orizzontale o verticale, senza duplicare la quota digitata', () => {
    // Il cursore a (50, 1,5): 1,7 gradi dall'orizzontale. Lunghezza 60 digitata, angolo dal cursore
    const target = penTarget([0, 0], [50, 1.5], '60', '');
    if (!target.ok) throw new Error(target.message);
    const plain = typedPenNode(start(), 0, target, 10, false);
    expect('draft' in plain && plain.draft.constraints!.map((c) => c.t)).toEqual(['dist']);
    const inferred = typedPenNode(start(), 0, target, 10, true);
    if ('error' in inferred) throw new Error(inferred.error);
    expect(inferred.draft.constraints!.map((c) => c.t)).toEqual(['dist', 'horizontal']);
    // Il vincolo orizzontale ha portato il nodo sull'asse, la distanza resta 60
    const [a, b] = inferred.draft.paths[0].nodes;
    expect(b.p[1]).toBeCloseTo(a.p[1], 6);
    expect(Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1])).toBeCloseTo(60, 6);
  });

  it("con l'angolo digitato la direzione non si deduce (la quota dell'angolo c'è già)", () => {
    const r = typedPenNode(start(), 0, ok([0, 0], '60', '1'), 10, true);
    if ('error' in r) throw new Error(r.error);
    // Un segmento a 1 grado: niente orizzontale, solo la distanza e l'angolo digitati
    expect(r.draft.constraints!.map((c) => c.t)).toEqual(['dist', 'angle']);
    const exact = typedPenNode(start(), 0, ok([0, 0], '60', '0'), 10, true);
    expect('draft' in exact && exact.draft.constraints!.map((c) => c.t)).toEqual(['dist', 'angle']);
  });

  /** Un nodo digitato con i vincoli automatici accesi: i campi vuoti seguono il cursore, anche per chiudere il contorno. */
  const follow = (d: Draft, cursor: [number, number], length = ''): Extract<ReturnType<typeof typedPenNode>, { draft: Draft }> => {
    const nodes = d.paths[0].nodes;
    const target = penTarget(nodes[nodes.length - 1].p, cursor, length, '');
    if (!target.ok) throw new Error(target.message);
    const r = typedPenNode(d, 0, target, 10, true);
    if ('error' in r) throw new Error(r.error);
    return r;
  };

  it("con i vincoli automatici il lato di chiusura deduce orizzontale o perpendicolare, senza duplicare ciò che c'è già", () => {
    // Triangolo: (0,0), (20,20), (40,0). Il secondo lato è perpendicolare al primo (dedotto), la chiusura è orizzontale
    let d = start();
    d = follow(d, [20, 20]).draft;
    d = follow(d, [40, 0]).draft;
    expect(d.constraints!.map((c) => c.t)).toEqual(['perpendicular']);
    const closed = follow(d, [0, 0]);
    expect(closed.closing).toBe(true);
    expect(closed.draft.paths[0].closed).toBe(true);
    expect(closed.draft.constraints!.map((c) => c.t)).toEqual(['perpendicular', 'horizontal']);
    // La stessa chiusura senza i vincoli automatici non porta nulla
    const nodes = d.paths[0].nodes;
    const target = penTarget(nodes[2].p, [0, 0], '', '');
    if (!target.ok) throw new Error(target.message);
    const plain = typedPenNode(d, 0, target, 10, false);
    expect('draft' in plain && plain.draft.constraints!.map((c) => c.t)).toEqual(['perpendicular']);
    // Con la lunghezza digitata (28,28) la chiusura chiude il triangolo e il perpendicolare sarebbe ridondante: non si aggiunge due volte
    const typedClose = follow(start(), [40, 0], '40');
    const second = follow(typedClose.draft, [20, 20], String(Math.hypot(20, 20)));
    const typedLast = follow(second.draft, [0, 0], String(Math.hypot(20, 20)));
    expect(typedLast.draft.constraints!.filter((c) => c.t === 'perpendicular')).toHaveLength(0);
    expect(typedLast.draft.constraints!.filter((c) => c.t === 'dist' && !c.ref)).toHaveLength(3);
  });

  it('angoli negativi, 0°, 90°, 270° e lunghezze piccole o enormi danno punti esatti', () => {
    for (const [l, a, expected] of [['10', '-90', [0, -10]], ['100000', '0', [100000, 0]], ['0.001', '180', [-0.001, 0]], ['25', '360', [25, 0]]] as const) {
      const r = typedPenNode(start(), 0, ok([0, 0], l, a), 10);
      expect('draft' in r && r.draft.paths[0].nodes[1].p).toEqual(expected);
    }
    // Con un angolo oltre 180 il punto è giusto e la quota angolare è normalizzata
    const r = typedPenNode(start(), 0, ok([0, 0], '10', '270'), 10);
    expect('draft' in r && r.draft.constraints!.find((c) => c.t === 'angle')!.v).toBe(-90);
  });

  it('segmenti successivi: la distanza dal nodo precedente, e il nodo scelto è l\'ultimo (o il primo se il contorno si chiude)', () => {
    let d = start();
    const first = typedPenNode(d, 0, ok([0, 0], '30', '90'), 10);
    if ('error' in first) throw new Error(first.error);
    expect(first.selection).toEqual({ path: 0, node: 1 });
    d = first.draft;
    const second = typedPenNode(d, 0, ok([0, 30], '30', '0'), 10);
    if ('error' in second) throw new Error(second.error);
    expect(second.selection).toEqual({ path: 0, node: 2 });
    const ids = second.draft.paths[0].nodes.map((n) => n.id);
    expect(second.draft.constraints!.at(-2)).toMatchObject({ t: 'dist', p: [ids[1], ids[2]], v: 30 });
    // Un contorno senza nodi, o chiuso, non si continua
    expect(typedPenNode({ ...d, paths: [] }, 0, ok([0, 0], '1', '0'), 10)).toEqual({ error: 'Non c\'è un contorno aperto da continuare' });
    expect(typedPenNode({ ...d, paths: [{ ...d.paths[0], closed: true }] }, 0, ok([0, 0], '1', '0'), 10)).toHaveProperty('error');
    // Al limite dei nodi per contorno: un messaggio, non un'eccezione
    const full: Draft = { ...d, paths: [{ closed: false, nodes: Array.from({ length: 500 }, (_, i) => ({ p: [i, 0] as [number, number], kind: 'corner' as const })) }] };
    expect(typedPenNode(full, 0, ok([499, 0], '1', '0'), 10)).toHaveProperty('error', 'Limite raggiunto: al massimo 500 nodi per contorno e 100 contorni. Termina il contorno (Invio) o chiudilo');
    expect(pointMap(second.draft.paths).size).toBe(3);
  });
});
