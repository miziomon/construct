import { describe, expect, it } from 'vitest';
import {
  addConstraint,
  addFixed,
  addReferenceDimension,
  addSelectionConstraint,
  canApplyConstraint,
  constraintPoints,
  createAngleDimension,
  createDimension,
  diagnose,
  dimLayout,
  dimText,
  dimensionValue,
  dragFrame,
  fmtDim,
  idsOf,
  moveNodesConstrained,
  nodeNames,
  pointMap,
  pointsOf,
  quoteMismatch,
  removeConstraint,
  selectionItems,
  setConstraintValue,
  settlePaths,
  stateText,
  validConstraints,
  writeBack,
} from './dimensions';
import { measure } from './constraints';
import { deleteNodesWithConstraints, normalizeProfile } from './model';
import type { Applied } from './dimensions';
import { roundPaths } from '../../scene/store';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';

/** Rettangolo 40 x 20 con id n1..n4 (A in basso a sinistra, poi in senso antiorario). */
const rect = (): PathContour[] => [
  {
    closed: true,
    nodes: [
      { id: 'n1', p: [0, 0], kind: 'corner' },
      { id: 'n2', p: [40, 0], kind: 'corner' },
      { id: 'n3', p: [40, 20], kind: 'corner' },
      { id: 'n4', p: [0, 20], kind: 'corner' },
    ],
  },
];
type Geo = { paths: PathContour[]; constraints?: ProfileConstraint[] };
const start = (): Geo => ({ paths: rect() });
const pos = (d: Geo, id: string): Vec2 => pointMap(d.paths).get(id)!;
/** Applica un'operazione che deve riuscire e restituisce il disegno nuovo. */
const must = (r: Applied<Geo>): Geo => {
  if (!r.ok) throw new Error(r.message);
  return r.draft;
};
/** Rettangolo con orizzontali e verticali, e A fisso: manca solo la misura di larghezza e altezza. */
const squared = (): Geo => {
  let d = start();
  d = must(addFixed(d, ['n1']));
  d = must(addConstraint(d, { t: 'horizontal', p: ['n1', 'n2'] }));
  d = must(addConstraint(d, { t: 'horizontal', p: ['n4', 'n3'] }));
  d = must(addConstraint(d, { t: 'vertical', p: ['n2', 'n3'] }));
  d = must(addConstraint(d, { t: 'vertical', p: ['n1', 'n4'] }));
  return d;
};

describe('punti, nomi e diagnosi', () => {
  it('pointsOf e idsOf lavorano solo sui nodi con id', () => {
    const paths: PathContour[] = [{ closed: false, nodes: [{ id: 'n1', p: [1, 2], kind: 'corner' }, { p: [3, 4], kind: 'corner' }] }];
    expect(pointsOf(paths)).toEqual([{ id: 'n1', x: 1, y: 2 }]);
    expect(idsOf(paths, [{ path: 0, node: 0 }, { path: 0, node: 1 }, { path: 5, node: 0 }])).toEqual(['n1']);
    expect([...nodeNames(rect()).entries()]).toEqual([['n1', 'P1.1'], ['n2', 'P1.2'], ['n3', 'P1.3'], ['n4', 'P1.4']]);
  });

  it('senza vincoli la diagnosi non c\'è; con un vincolo ci sono stato e gradi di libertà', () => {
    expect(diagnose(start())).toBeNull();
    const d = must(addConstraint(start(), { t: 'horizontal', p: ['n1', 'n2'] }));
    const diag = diagnose(d)!;
    expect(diag.report.state).toBe('under');
    expect(diag.report.dof).toBe(7);
    // Tutti i nodi hanno ancora gradi di libertà
    expect([...diag.states.values()]).toEqual(['free', 'free', 'free', 'free']);
    expect(stateText(diag.report)).toEqual({ kind: 'info', text: 'Sottovincolato: 7 gradi di libertà' });
  });

  it('i vincoli che citano nodi mancanti non entrano nel risolutore', () => {
    const list: ProfileConstraint[] = [{ id: 'k1', t: 'horizontal', p: ['n1', 'n2'] }, { id: 'k2', t: 'horizontal', p: ['n1', 'n9'] }];
    expect(validConstraints(rect(), list).map((c) => c.id)).toEqual(['k1']);
    expect(validConstraints(rect(), undefined)).toEqual([]);
  });

  it('writeBack lascia gli stessi oggetti per i nodi che non si muovono e lo stesso array se nulla cambia', () => {
    const paths = rect();
    expect(writeBack(paths, pointsOf(paths))).toBe(paths);
    const moved = writeBack(paths, [{ id: 'n2', x: 50, y: -0 }]);
    expect(moved).not.toBe(paths);
    expect(moved[0].nodes[0]).toBe(paths[0].nodes[0]);
    expect(moved[0].nodes[1].p).toEqual([50, 0]);
    expect(Object.is(moved[0].nodes[1].p[1], 0)).toBe(true);
  });
});

describe('creazione di una quota di lunghezza', () => {
  it('allineata: il valore è la distanza, la linea sta dalla parte opposta al centro del disegno, a 30 pixel', () => {
    // 10 pixel per mm: 3 mm di scostamento
    const bottom = createDimension(rect(), 'len', 'n1', 'n2', 10) as ProfileConstraint;
    expect(bottom).toMatchObject({ t: 'dist', p: ['n1', 'n2'], v: 40, at: 0.5 });
    // Normale a sinistra di A→B (verso l'alto) e il segmento sta sotto il centro: la quota va sotto, negativa
    expect(bottom.off).toBeCloseTo(-3, 9);
    // Lo stesso segmento preso al contrario ha la normale opposta, ma la linea sta sempre sotto
    const reverse = createDimension(rect(), 'len', 'n2', 'n1', 10) as ProfileConstraint;
    expect(reverse.off).toBeCloseTo(3, 9);
    const top = createDimension(rect(), 'len', 'n3', 'n4', 10) as ProfileConstraint;
    expect(top.v).toBe(40);
    // Il lato alto (da C a D, verso sinistra) ha la normale verso il basso: la quota va sopra, quindi negativa
    expect(top.off).toBeCloseTo(-3, 9);
  });

  it('orizzontale e verticale: valore assoluto, segno nel verso, linea fuori dal disegno', () => {
    const w = createDimension(rect(), 'h', 'n2', 'n1', 10) as ProfileConstraint;
    expect(w).toMatchObject({ t: 'distX', v: 40, s: -1, off: -3 });
    const top = createDimension(rect(), 'h', 'n4', 'n3', 10) as ProfileConstraint;
    expect(top.off).toBeCloseTo(3, 9);
    const h = createDimension(rect(), 'v', 'n3', 'n2', 10) as ProfileConstraint;
    expect(h).toMatchObject({ t: 'distY', v: 20, s: -1 });
    expect(h.off).toBeCloseTo(3, 9);
    expect((createDimension(rect(), 'v', 'n1', 'n4', 10) as ProfileConstraint).off).toBeCloseTo(-3, 9);
  });

  it('due nodi uguali o sullo stesso asse: un messaggio, non una quota', () => {
    expect(createDimension(rect(), 'len', 'n1', 'n1', 10)).toBe('Scegli due nodi diversi');
    expect(createDimension(rect(), 'len', 'n1', 'n9', 10)).toBe('Scegli due nodi diversi');
    expect(createDimension(rect(), 'h', 'n2', 'n3', 10)).toBe('I due nodi hanno la stessa x: prima separali');
    expect(createDimension(rect(), 'v', 'n1', 'n2', 10)).toBe('I due nodi hanno la stessa y: prima separali');
    const same: PathContour[] = [{ closed: false, nodes: [{ id: 'a', p: [1, 1], kind: 'corner' }, { id: 'b', p: [1, 1], kind: 'corner' }] }];
    expect(createDimension(same, 'len', 'a', 'b', 10)).toMatch(/stesso punto/);
  });

  it('dimLayout: linee di richiamo e di quota per i tre tipi, etichetta lungo la linea', () => {
    const pm = pointMap(rect());
    const dist = dimLayout({ id: 'k', t: 'dist', p: ['n1', 'n2'], v: 40, off: -3, at: 0.25 }, pm, 0)!;
    expect(dist.a2[0]).toBeCloseTo(0, 9);
    expect(dist.a2[1]).toBeCloseTo(-3, 9);
    expect(dist.b2[0]).toBeCloseTo(40, 9);
    expect(dist.label[0]).toBeCloseTo(10, 9);
    const x = dimLayout({ id: 'k', t: 'distX', p: ['n1', 'n2'], v: 40, off: -3 }, pm, 0)!;
    expect([x.a2, x.b2, x.label]).toEqual([[0, -3], [40, -3], [20, -3]]);
    const xTop = dimLayout({ id: 'k', t: 'distX', p: ['n4', 'n3'], v: 40, off: 3 }, pm, 0)!;
    expect(xTop.a2).toEqual([0, 23]);
    const y = dimLayout({ id: 'k', t: 'distY', p: ['n2', 'n3'], v: 20, off: 3 }, pm, 0)!;
    expect([y.a2, y.b2]).toEqual([[43, 0], [43, 20]]);
    const yLeft = dimLayout({ id: 'k', t: 'distY', p: ['n1', 'n4'], v: 20, off: -3 }, pm, 0)!;
    expect(yLeft.a2).toEqual([-3, 0]);
    // Senza `off` vale quello di riserva; un nodo mancante dà null
    expect(dimLayout({ id: 'k', t: 'distX', p: ['n1', 'n2'], v: 40 }, pm, -5)!.a2).toEqual([0, -5]);
    expect(dimLayout({ id: 'k', t: 'distX', p: ['n1', 'n9'], v: 40 }, pm, 0)).toBeNull();
  });
});

describe('aggiunta di vincoli e quote', () => {
  it('orizzontale: porta i due nodi alla stessa y con il minimo spostamento (si muovono tutti e due)', () => {
    let d = start();
    d = { ...d, paths: writeBack(d.paths, [{ id: 'n2', x: 40, y: 4 }]) };
    const r = addConstraint(d, { t: 'horizontal', p: ['n1', 'n2'] });
    expect(r.ok).toBe(true);
    const out = must(r);
    expect(pos(out, 'n1')[1]).toBeCloseTo(pos(out, 'n2')[1], 6);
    expect(out.constraints).toHaveLength(1);
    expect(out.constraints![0].id).toBe('k1');
  });

  it('un rettangolo vincolato e quotato è completamente vincolato e i nodi hanno le misure digitate', () => {
    let d = squared();
    expect(diagnose(d)!.report.state).toBe('under');
    const width = createDimension(d.paths, 'len', 'n1', 'n2', 10) as ProfileConstraint;
    d = must(addConstraint(d, { ...width, v: 60 }));
    const height = createDimension(d.paths, 'len', 'n2', 'n3', 10) as ProfileConstraint;
    d = must(addConstraint(d, { ...height, v: 30 }));
    // A è fisso: resta nell'origine a meno del rumore del risolutore (i punti si arrotondano a 4 decimali al salvataggio)
    expect(pos(d, 'n1')[0]).toBeCloseTo(0, 6);
    expect(pos(d, 'n1')[1]).toBeCloseTo(0, 6);
    for (const [id, [x, y]] of [['n2', [60, 0]], ['n3', [60, 30]], ['n4', [0, 30]]] as const) {
      expect(pos(d, id)[0]).toBeCloseTo(x, 6);
      expect(pos(d, id)[1]).toBeCloseTo(y, 6);
    }
    const diag = diagnose(d)!;
    expect(diag.report.state).toBe('full');
    expect(diag.report.dof).toBe(0);
    expect([...diag.states.values()].every((s) => s === 'def')).toBe(true);
    expect(stateText(diag.report).text).toBe('Completamente vincolato: 0 gradi di libertà');
    // Gli id dei vincoli proseguono senza ripetersi
    expect(new Set(d.constraints!.map((c) => c.id)).size).toBe(d.constraints!.length);
  });

  it('una quota in conflitto non si applica: il disegno è com\'era e il messaggio nomina i vincoli', () => {
    let d = squared();
    d = must(addConstraint(d, { t: 'dist', p: ['n1', 'n2'], v: 60 }));
    d = must(addConstraint(d, { t: 'dist', p: ['n2', 'n3'], v: 30 }));
    const before = JSON.stringify(pointsOf(d.paths));
    // La diagonale di un rettangolo 60 x 30 non può valere 10
    const r = addConstraint(d, { t: 'dist', p: ['n1', 'n3'], v: 10 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/^Quota in conflitto con .* non applicato$/);
    expect(r.reason).toBe('conflict');
    expect(r.ids.length).toBeGreaterThan(0);
    // Il disegno di prima non è stato toccato: stessi vincoli e stesse posizioni dei nodi
    expect(d.constraints).toHaveLength(7);
    expect(JSON.stringify(pointsOf(d.paths))).toBe(before);
  });

  it('un vincolo che il disegno già impone (ridondante) non si applica', () => {
    const d = squared();
    const r = addConstraint(d, { t: 'horizontal', p: ['n1', 'n2'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/ridondante/);
      expect(r.reason).toBe('redundant');
    }
    const q = addConstraint(must(addConstraint(d, { t: 'dist', p: ['n1', 'n2'], v: 40 })), { t: 'distX', p: ['n1', 'n2'], v: 40, s: 1 });
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.reason).toBe('redundant');
  });

  it('un vincolo in conflitto con un altro: due nodi coincidenti non possono avere una distanza', () => {
    const d = must(addConstraint(start(), { t: 'coincident', p: ['n1', 'n2'] }));
    const r = addConstraint(d, { t: 'dist', p: ['n1', 'n2'], v: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/^Quota in conflitto con Coincidente P1\.1-P1\.2/);
      expect(r.ids).toEqual(['k1']);
    }
    // Il caso inverso: una distanza e poi la coincidenza
    const q = must(addConstraint(start(), { t: 'dist', p: ['n1', 'n2'], v: 5 }));
    const c = addConstraint(q, { t: 'coincident', p: ['n1', 'n2'] });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.message).toMatch(/^Vincolo in conflitto con Distanza P1\.1-P1\.2/);
  });

  it('Fisso: tiene i nodi dove sono, salta quelli già fissi, rifiuta se non resta nulla da fissare', () => {
    const d = must(addFixed(start(), ['n1', 'n2']));
    expect(d.constraints!.map((c) => [c.t, c.p[0], c.x, c.y])).toEqual([['fixed', 'n1', 0, 0], ['fixed', 'n2', 40, 0]]);
    const more = must(addFixed(d, ['n2', 'n3']));
    expect(more.constraints!.map((c) => c.p[0])).toEqual(['n1', 'n2', 'n3']);
    const again = addFixed(more, ['n1', 'n2', 'n3']);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toBe('I nodi scelti sono già fissi');
  });

  it('con due nodi fissi una quota tra loro con un altro valore è in conflitto: non si applica', () => {
    const d = must(addFixed(start(), ['n1', 'n2']));
    const r = addConstraint(d, { t: 'dist', p: ['n1', 'n2'], v: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^Quota in conflitto con Fisso P1\.1/);
  });

  it('addSelectionConstraint e canApplyConstraint: due nodi diversi, o almeno uno per Fisso', () => {
    const nodes = (...ids: string[]) => ({ nodes: ids, segments: [] as [string, string][], all: ids });
    expect(canApplyConstraint('horizontal', nodes('n1', 'n2'))).toBe(true);
    expect(canApplyConstraint('vertical', nodes('n1'))).toBe(false);
    expect(canApplyConstraint('coincident', nodes('n1', 'n2', 'n3'))).toBe(false);
    expect(canApplyConstraint('fixed', nodes('n1'))).toBe(true);
    expect(canApplyConstraint('fixed', nodes())).toBe(false);
    expect(addSelectionConstraint(start(), 'horizontal', nodes('n1')).ok).toBe(false);
    expect(addSelectionConstraint(start(), 'fixed', nodes()).ok).toBe(false);
    const ok = must(addSelectionConstraint(start(), 'coincident', nodes('n1', 'n2')));
    expect(pos(ok, 'n1')[0]).toBeCloseTo(pos(ok, 'n2')[0], 6);
    expect(pos(ok, 'n1')[1]).toBeCloseTo(pos(ok, 'n2')[1], 6);
  });
});

describe('quote che non corrispondono al disegno', () => {
  it('un rettangolo largo 80 con la quota 40 ha uno scarto di 40 mm; un disegno risolto e arrotondato a 4 decimali no', () => {
    const wide = rect();
    const scaled: Geo = { paths: [{ ...wide[0], nodes: wide[0].nodes.map((n) => ({ ...n, p: [n.p[0] * 2, n.p[1] * 2] as Vec2 })) }], constraints: [{ id: 'k1', t: 'dist', p: ['n1', 'n2'], v: 40 }] };
    expect(quoteMismatch(scaled)).toBeCloseTo(40, 6);
    // Senza vincoli, o con i vincoli validi, nessuno scarto; i vincoli con nodi mancanti non contano
    expect(quoteMismatch(start())).toBeNull();
    expect(quoteMismatch({ paths: scaled.paths, constraints: [{ id: 'k', t: 'dist', p: ['n1', 'zz'], v: 5 }] })).toBeNull();
    let d = squared();
    d = must(addConstraint(d, { t: 'dist', p: ['n1', 'n2'], v: 12.3456789 }));
    d = must(addConstraint(d, { t: 'dist', p: ['n2', 'n3'], v: 7.7777777 }));
    expect(quoteMismatch(d)).toBeNull();
    expect(quoteMismatch({ paths: roundPaths(d.paths), constraints: d.constraints })).toBeNull();
    // Il disegno ridimensionato e salvato (nodi doppi, quote uguali) si segnala anche a quote rispettate prima
    const saved: Geo = { paths: roundPaths(scaled.paths), constraints: scaled.constraints };
    expect(quoteMismatch(saved)).toBeGreaterThan(30);
  });

  it('anche i vincoli geometrici contano: un orizzontale con i nodi a quote diverse', () => {
    const d: Geo = { paths: writeBack(rect(), [{ id: 'n2', x: 40, y: 3 }]), constraints: [{ id: 'k1', t: 'horizontal', p: ['n1', 'n2'] }] };
    expect(quoteMismatch(d)).toBeCloseTo(3, 9);
  });
});

describe('quota di riferimento', () => {
  const full = (): Geo => {
    let d = squared();
    d = must(addConstraint(d, { t: 'dist', p: ['n1', 'n2'], v: 40 }));
    return must(addConstraint(d, { t: 'dist', p: ['n2', 'n3'], v: 20 }));
  };

  it('una quota ridondante o in conflitto si può aggiungere come riferimento: misura attuale, nessun movimento, nessun vincolo in più per il risolutore', () => {
    const d = full();
    // Esatta (ridondante) e sbagliata (in conflitto): in tutti e due i casi il rifiuto dice perché, e il riferimento è sempre possibile
    const cases: [Omit<ProfileConstraint, 'id'>, string][] = [[{ t: 'distX', p: ['n1', 'n2'], s: 1, v: 40 }, 'redundant'], [{ t: 'dist', p: ['n1', 'n3'], v: 10 }, 'conflict']];
    for (const [dim, reason] of cases) {
      const r = addConstraint(d, dim);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    }
    const out = addReferenceDimension(d, { t: 'dist', p: ['n1', 'n3'], v: 10 })!;
    const ref = out.constraints!.at(-1)!;
    expect(ref).toMatchObject({ t: 'dist', p: ['n1', 'n3'], ref: true });
    // Il valore è la misura attuale (la diagonale 44,72), non il 10 digitato
    expect(ref.v).toBeCloseTo(Math.hypot(40, 20), 9);
    expect(dimText(ref, out.paths)).toBe('(44,72)');
    expect(out.paths).toBe(d.paths);
    expect(out.constraints).toHaveLength(d.constraints!.length + 1);
    // Non vincola: il disegno resta completamente vincolato, senza conflitti né ridondanze
    const diag = diagnose(out)!;
    expect(diag.report.state).toBe('full');
    expect(diag.bad.size).toBe(0);
    // Segue il disegno: cambiando la larghezza la misura di riferimento cambia, e non si può modificare
    const wider = must(setConstraintValue(out, out.constraints!.find((c) => c.t === 'dist' && c.p[1] === 'n2')!.id, 80));
    expect(dimText(wider.constraints!.find((c) => c.id === ref.id)!, wider.paths)).toBe(`(${fmtDim(Math.hypot(80, 20))})`);
    expect(setConstraintValue(out, ref.id, 5)).toMatchObject({ ok: false, message: 'Questa quota non ha un valore da cambiare' });
  });

  it('si costruisce sul disegno corrente: il lavoro fatto dopo il rifiuto non si perde; senza i nodi della quota non si aggiunge', () => {
    const rejected = full();
    const offer = { t: 'dist' as const, p: ['n1', 'n3'], v: 10 };
    // Dopo il rifiuto l'utente ha trascinato una quota (off, at) e spostato la larghezza: il riferimento va sul disegno di adesso
    const worked = must(setConstraintValue({ ...rejected, constraints: rejected.constraints!.map((c) => (c.id === 'k6' ? { ...c, off: -9, at: 0.7 } : c)) }, 'k6', 80));
    const out = addReferenceDimension(worked, offer)!;
    expect(out.paths).toBe(worked.paths);
    expect(out.constraints!.find((c) => c.id === 'k6')).toMatchObject({ v: 80, off: -9, at: 0.7 });
    expect(out.constraints).toHaveLength(worked.constraints!.length + 1);
    expect(dimensionValue(out.constraints!.at(-1)!, out.paths)).toBeCloseTo(Math.hypot(80, 20), 9);
    // Se un nodo è stato cancellato nel frattempo, niente
    const without = deleteNodesWithConstraints(worked, [{ path: 0, node: 2 }]);
    expect(addReferenceDimension(without, offer)).toBeNull();
  });

  it('l\'id della quota di riferimento è nuovo e la posizione (off, at) della proposta si conserva', () => {
    const d = full();
    const out = addReferenceDimension(d, { t: 'distX', p: ['n1', 'n2'], s: 1, v: 40, off: -4, at: 0.3 })!;
    const ref = out.constraints!.at(-1)!;
    expect(d.constraints!.some((c) => c.id === ref.id)).toBe(false);
    expect(ref).toMatchObject({ ref: true, off: -4, at: 0.3 });
  });
});

describe('modifica ed eliminazione', () => {
  const quoted = (): Geo => {
    let d = squared();
    d = must(addConstraint(d, { t: 'dist', p: ['n1', 'n2'], v: 40 }));
    return must(addConstraint(d, { t: 'dist', p: ['n2', 'n3'], v: 20 }));
  };
  const widthId = (d: Geo) => d.constraints!.find((c) => c.t === 'dist' && c.p[1] === 'n2')!.id;

  it('cambiare il valore di una quota sposta i nodi: un solo risultato risolto', () => {
    const d = quoted();
    const out = must(setConstraintValue(d, widthId(d), 80));
    expect(pos(out, 'n2')[0]).toBeCloseTo(80, 6);
    expect(pos(out, 'n3')[0]).toBeCloseTo(80, 6);
    expect(pos(out, 'n4')[0]).toBeCloseTo(0, 6);
    expect(out.constraints!.find((c) => c.id === widthId(d))!.v).toBe(80);
    // Il valore si salva esatto, anche con molti decimali
    const exact = must(setConstraintValue(d, widthId(d), 12.3456789));
    expect(exact.constraints!.find((c) => c.id === widthId(d))!.v).toBe(12.3456789);
    expect(dimensionValue(exact.constraints!.find((c) => c.id === widthId(d))!, exact.paths)).toBe(12.3456789);
  });

  it('un valore non ammesso o non raggiungibile non si applica', () => {
    const d = quoted();
    for (const bad of [0, -5, NaN, 1e9]) {
      const r = setConstraintValue(d, widthId(d), bad);
      expect(r.ok).toBe(false);
    }
    expect(setConstraintValue(d, widthId(d), 0)).toMatchObject({ message: 'La misura deve essere maggiore di zero' });
    const nope = setConstraintValue(quoted(), 'k99', 5);
    expect(nope).toMatchObject({ ok: false, message: 'Questa quota non ha un valore da cambiare' });
  });

  it('un vincolo geometrico non ha un valore da cambiare', () => {
    const d = quoted();
    const h = d.constraints!.find((c) => c.t === 'horizontal')!;
    expect(setConstraintValue(d, h.id, 5).ok).toBe(false);
  });

  it('removeConstraint toglie solo quel vincolo, senza muovere i nodi, e senza vincoli il campo non c\'è', () => {
    const d = quoted();
    const out = removeConstraint(d, widthId(d));
    expect(out.constraints).toHaveLength(d.constraints!.length - 1);
    expect(out.paths).toBe(d.paths);
    let left = start();
    left = must(addConstraint(left, { t: 'horizontal', p: ['n1', 'n2'] }));
    const none = removeConstraint(left, left.constraints![0].id);
    expect('constraints' in none).toBe(false);
    // Un id che non esiste non cambia nulla
    expect(removeConstraint(d, 'k99').constraints).toHaveLength(d.constraints!.length);
  });

  it('eliminare un nodo toglie i vincoli che lo citano, gli altri restano', () => {
    const d = quoted();
    const out = deleteNodesWithConstraints(d, [{ path: 0, node: 2 }]);
    expect(out.paths[0].nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n4']);
    // Restano i vincoli che non citano n3
    expect(out.constraints!.every((c) => !c.p.includes('n3'))).toBe(true);
    expect(out.constraints!.length).toBeLessThan(d.constraints!.length);
    expect(out.constraints!.length).toBeGreaterThan(0);
  });

  it('i nodi senza id si normalizzano prima di citarli: normalizeProfile dà gli id e poi si può quotare', () => {
    const bare: Geo = { paths: [{ closed: true, nodes: [{ p: [0, 0], kind: 'corner' }, { p: [40, 0], kind: 'corner' }, { p: [40, 20], kind: 'corner' }] }] };
    const base = normalizeProfile(bare);
    const ids = idsOf(base.paths, [{ path: 0, node: 0 }, { path: 0, node: 1 }]);
    expect(ids).toEqual(['n1', 'n2']);
    const out = must(addConstraint(base, { t: 'horizontal', p: ids }));
    expect(out.constraints).toHaveLength(1);
  });
});

describe('trascinamento', () => {
  /** Rettangolo che resta un rettangolo (orizzontali e verticali), senza nodi fissi. */
  const free = (): Geo => {
    let d = start();
    d = must(addConstraint(d, { t: 'horizontal', p: ['n1', 'n2'] }));
    d = must(addConstraint(d, { t: 'horizontal', p: ['n4', 'n3'] }));
    d = must(addConstraint(d, { t: 'vertical', p: ['n2', 'n3'] }));
    return must(addConstraint(d, { t: 'vertical', p: ['n1', 'n4'] }));
  };

  it('senza vincoli i nodi vanno dove dice il mouse', () => {
    const d = start();
    const r = dragFrame(d.paths, undefined, [{ ref: { path: 0, node: 2 }, to: [50, 30] }], false);
    expect(r.paths![0].nodes[2].p).toEqual([50, 30]);
    expect(r.paths![0].nodes[1].p).toEqual([40, 0]);
    expect(r.soft).toBe(false);
  });

  it('con vincoli il nodo segue il mouse e gli altri si adattano (tentativo rigido)', () => {
    const d = free();
    const r = dragFrame(d.paths, d.constraints, [{ ref: { path: 0, node: 2 }, to: [50, 30] }], false);
    expect(r.soft).toBe(false);
    const out = r.paths!;
    expect(out[0].nodes[2].p[0]).toBeCloseTo(50, 5);
    expect(out[0].nodes[2].p[1]).toBeCloseTo(30, 5);
    // B segue in X, D segue in Y: il rettangolo resta un rettangolo
    expect(out[0].nodes[1].p[0]).toBeCloseTo(50, 5);
    expect(out[0].nodes[3].p[1]).toBeCloseTo(30, 5);
    expect(out[0].nodes[1].p[1]).toBeCloseTo(0, 5);
  });

  it('un nodo fisso non si muove: il tentativo rigido fallisce e si passa al morbido (il nodo resta indietro)', () => {
    const d = must(addFixed(free(), ['n3']));
    const r = dragFrame(d.paths, d.constraints, [{ ref: { path: 0, node: 2 }, to: [50, 30] }], false);
    expect(r.soft).toBe(true);
    // Il fotogramma si può comunque risolvere (morbido) oppure saltare: in nessun caso il nodo fisso arriva sul mouse
    if (r.paths) expect(r.paths[0].nodes[2].p[0]).toBeCloseTo(40, 3);
  });

  it('settlePaths porta il disegno alla precisione piena e senza vincoli non tocca nulla', () => {
    const d = free();
    const off = writeBack(d.paths, [{ id: 'n3', x: 40.0003, y: 20 }]);
    const settled = settlePaths(off, d.constraints);
    expect(settled[0].nodes[2].p[0]).toBeCloseTo(settled[0].nodes[1].p[0], 8);
    const plain = start().paths;
    expect(settlePaths(plain, undefined)).toBe(plain);
  });

  it('moveNodesConstrained: senza vincoli è lo spostamento libero; con vincoli i nodi legati seguono', () => {
    const plain = start();
    expect(moveNodesConstrained(plain.paths, undefined, [{ path: 0, node: 2 }], [5, 5])[0].nodes[2].p).toEqual([45, 25]);
    const d = free();
    const out = moveNodesConstrained(d.paths, d.constraints, [{ path: 0, node: 2 }], [5, 5]);
    expect(out[0].nodes[1].p[0]).toBeCloseTo(45, 6);
    expect(out[0].nodes[3].p[1]).toBeCloseTo(25, 6);
    // Con una quota che lo impedisce il nodo resta indietro o il disegno non si muove: mai in violazione della quota
    const q = must(addConstraint(must(addFixed(free(), ['n1'])), { t: 'dist', p: ['n1', 'n2'], v: 40 }));
    const stuck = moveNodesConstrained(q.paths, q.constraints, [{ path: 0, node: 1 }], [10, 0]);
    expect(Math.hypot(stuck[0].nodes[1].p[0] - stuck[0].nodes[0].p[0], stuck[0].nodes[1].p[1] - stuck[0].nodes[0].p[1])).toBeCloseTo(40, 4);
  });
});

/**
 * Gli scenari di e2e/profile-quote.spec.ts sugli stessi dati, senza il browser: i testi che i test e2e aspettano nel piede e
 * negli avvisi devono uscire da queste funzioni (i test e2e non si possono lanciare da qui).
 */
describe('scenari dei test e2e della Quota', () => {
  const SQUARED: ProfileConstraint[] = [
    { id: 'k1', t: 'fixed', p: ['n1'], x: 0, y: 0 },
    { id: 'k2', t: 'horizontal', p: ['n1', 'n2'] },
    { id: 'k3', t: 'horizontal', p: ['n4', 'n3'] },
    { id: 'k4', t: 'vertical', p: ['n2', 'n3'] },
    { id: 'k5', t: 'vertical', p: ['n1', 'n4'] },
  ];
  const FULL: ProfileConstraint[] = [...SQUARED, { id: 'k6', t: 'dist', p: ['n1', 'n2'], v: 40 }, { id: 'k7', t: 'dist', p: ['n2', 'n3'], v: 20 }];
  const text = (d: Geo) => stateText(diagnose(d)!.report).text;
  /** Quota di lunghezza allineata come la crea lo strumento (a 11 pixel per mm) con il valore digitato. */
  const quote = (d: Geo, a: string, b: string, value: number): Applied<Geo> => addConstraint(d, { ...(createDimension(d.paths, 'len', a, b, 11) as ProfileConstraint), v: value });

  it('test 1: aperto SQUARED ha due gradi di libertà, con la larghezza ne ha uno, con l\'altezza è completamente vincolato', () => {
    let d: Geo = { paths: rect(), constraints: SQUARED };
    expect(text(d)).toBe('Sottovincolato: 2 gradi di libertà');
    d = must(quote(d, 'n1', 'n2', 60));
    expect(d.constraints).toHaveLength(6);
    expect(text(d)).toBe('Sottovincolato: 1 grado di libertà');
    d = must(quote(d, 'n2', 'n3', 30));
    expect(d.constraints).toHaveLength(7);
    expect(text(d)).toBe('Completamente vincolato: 0 gradi di libertà');
    const expected = [[0, 0], [60, 0], [60, 30], [0, 30]];
    d.paths[0].nodes.forEach((n, i) => {
      expect(n.p[0]).toBeCloseTo(expected[i][0], 3);
      expect(n.p[1]).toBeCloseTo(expected[i][1], 3);
    });
    expect(d.constraints!.filter((c) => c.t === 'dist').map((c) => c.v)).toEqual([60, 30]);
  });

  it('test 2: con FULL (40 x 20) la diagonale a 10 è in conflitto, e un secondo Orizzontale tra n1 e n2 è ridondante', () => {
    const d: Geo = { paths: rect(), constraints: FULL };
    expect(text(d)).toBe('Completamente vincolato: 0 gradi di libertà');
    const diagonal = quote(d, 'n1', 'n3', 10);
    expect(diagonal.ok).toBe(false);
    if (!diagonal.ok) expect(diagonal.message).toMatch(/^Quota in conflitto con /);
    const again = addSelectionConstraint(d, 'horizontal', { nodes: ['n1', 'n2'], segments: [], all: ['n1', 'n2'] });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toMatch(/^Vincolo ridondante/);
    // Il disegno di partenza non è stato toccato
    expect(d.constraints).toHaveLength(7);
  });

  it('test 3: SQUARED con la larghezza 40 e poi l\'altezza 25 è completamente vincolato, anche dopo l\'arrotondamento a 4 decimali del salvataggio', () => {
    let d: Geo = { paths: rect(), constraints: [...SQUARED, { id: 'k6', t: 'dist', p: ['n1', 'n2'], v: 40 }] };
    d = must(quote(d, 'n2', 'n3', 25));
    expect(text(d)).toBe('Completamente vincolato: 0 gradi di libertà');
    // Salvato (4 decimali) e riaperto: la diagnosi legge lo stesso stato, senza risolvere
    const saved: Geo = { paths: roundPaths(d.paths), constraints: d.constraints };
    expect(text(saved)).toBe('Completamente vincolato: 0 gradi di libertà');
    expect(diagnose(saved)!.report.conflicting).toEqual([]);
    expect(saved.paths[0].nodes[2].p[1]).toBeCloseTo(25, 6);
  });
});

describe('vincoli dalla selezione (nodi e segmenti)', () => {
  /** Trapezio: base in basso n1-n2, lato alto n3-n4 inclinato, lati n2-n3 e n4-n1. */
  const trapezoid = (): Geo => ({
    paths: [
      {
        closed: true,
        nodes: [
          { id: 'n1', p: [0, 0], kind: 'corner' },
          { id: 'n2', p: [40, 0], kind: 'corner' },
          { id: 'n3', p: [30, 20], kind: 'corner' },
          { id: 'n4', p: [0, 15], kind: 'corner' },
        ],
      },
    ],
  });
  /** Elementi scelti: indici dei nodi e dei segmenti (il segmento i va dal nodo i al successivo). */
  const pick = (d: Geo, nodes: number[], segments: number[] = []) => selectionItems(d.paths, nodes.map((node) => ({ path: 0, node })), segments.map((segment) => ({ path: 0, segment })));
  const cross = (d: Geo, a: string, b: string, c: string, e: string) => {
    const [pa, pb, pc, pe] = [pos(d, a), pos(d, b), pos(d, c), pos(d, e)];
    return (pb[0] - pa[0]) * (pe[1] - pc[1]) - (pb[1] - pa[1]) * (pe[0] - pc[0]);
  };

  it('selectionItems: un segmento vale se i suoi due nodi sono scelti e i suoi estremi non contano come nodi sciolti', () => {
    const d = trapezoid();
    expect(pick(d, [0, 1], [0])).toEqual({ nodes: [], segments: [['n1', 'n2']], all: ['n1', 'n2'] });
    // Due nodi scelti uno a uno: sciolti
    expect(pick(d, [0, 1])).toEqual({ nodes: ['n1', 'n2'], segments: [], all: ['n1', 'n2'] });
    // Un segmento il cui nodo non è più scelto non vale; un nodo in più resta sciolto
    expect(pick(d, [0], [0])).toEqual({ nodes: ['n1'], segments: [], all: ['n1'] });
    expect(pick(d, [0, 1, 2], [0])).toEqual({ nodes: ['n3'], segments: [['n1', 'n2']], all: ['n1', 'n2', 'n3'] });
    // L'ultimo segmento di un contorno chiuso torna al primo nodo; lo stesso segmento due volte conta una volta
    expect(pick(d, [3, 0], [3, 3]).segments).toEqual([['n4', 'n1']]);
    // I nodi senza id non si contano
    const bare: Geo = { paths: [{ closed: false, nodes: [{ p: [0, 0], kind: 'corner' }, { id: 'n2', p: [1, 0], kind: 'corner' }] }] };
    expect(selectionItems(bare.paths, [{ path: 0, node: 0 }, { path: 0, node: 1 }], [])).toEqual({ nodes: ['n2'], segments: [], all: ['n2'] });
  });

  it('constraintPoints: i punti nell\'ordine del risolutore, e null se la selezione non basta o non è compatibile', () => {
    const d = trapezoid();
    const seg = (i: number) => pick(d, [i, (i + 1) % 4], [i]);
    const two = pick(d, [0, 1], [0]);
    expect(constraintPoints('horizontal', seg(0))).toEqual(['n1', 'n2']);
    expect(constraintPoints('vertical', pick(d, [2, 3]))).toEqual(['n3', 'n4']);
    expect(constraintPoints('coincident', pick(d, [0, 2]))).toEqual(['n1', 'n3']);
    expect(constraintPoints('coincident', two)).toBeNull();
    expect(constraintPoints('fixed', pick(d, [0, 1, 2]))).toEqual(['n1', 'n2', 'n3']);
    expect(constraintPoints('fixed', pick(d, []))).toBeNull();
    // Due segmenti (lontani o adiacenti): parallelo, perpendicolare, uguale, collineare
    const bottomAndTop = pick(d, [0, 1, 2, 3], [0, 2]);
    for (const type of ['parallel', 'perpendicular', 'equal', 'collinear'] as const) expect(constraintPoints(type, bottomAndTop)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(constraintPoints('parallel', pick(d, [0, 1, 2], [0, 1]))).toEqual(['n1', 'n2', 'n2', 'n3']);
    expect(constraintPoints('parallel', seg(0))).toBeNull();
    expect(constraintPoints('parallel', pick(d, [0, 1, 2, 3], [0]))).toBeNull();
    // Punto medio: un nodo e un segmento; simmetrico: due nodi e un segmento (l'asse)
    expect(constraintPoints('midpoint', pick(d, [0, 1, 2], [0]))).toEqual(['n3', 'n1', 'n2']);
    expect(constraintPoints('midpoint', seg(0))).toBeNull();
    expect(constraintPoints('symmetric', pick(d, [0, 1, 2, 3], [0]))).toEqual(['n3', 'n4', 'n1', 'n2']);
    expect(constraintPoints('symmetric', pick(d, [0, 1, 2], [0]))).toBeNull();
    // Orizzontale con due segmenti o con un segmento e un nodo non vale
    expect(constraintPoints('horizontal', bottomAndTop)).toBeNull();
    expect(constraintPoints('horizontal', pick(d, [0, 1, 2], [0]))).toBeNull();
    expect(canApplyConstraint('midpoint', pick(d, [0, 1, 2], [0]))).toBe(true);
    expect(canApplyConstraint('midpoint', pick(d, []))).toBe(false);
  });

  it('parallelo: il lato alto diventa parallelo alla base (con la base orizzontale, orizzontale anch\'esso)', () => {
    let d = must(addConstraint(trapezoid(), { t: 'horizontal', p: ['n1', 'n2'] }));
    d = must(addSelectionConstraint(d, 'parallel', pick(d, [0, 1, 2, 3], [0, 2])));
    expect(d.constraints!.at(-1)).toMatchObject({ t: 'parallel', p: ['n1', 'n2', 'n3', 'n4'] });
    expect(cross(d, 'n1', 'n2', 'n3', 'n4')).toBeCloseTo(0, 6);
    expect(pos(d, 'n3')[1]).toBeCloseTo(pos(d, 'n4')[1], 6);
  });

  it('perpendicolare: due lati adiacenti (nodo in comune) a 90 gradi', () => {
    const d = must(addSelectionConstraint(trapezoid(), 'perpendicular', pick(trapezoid(), [0, 1, 2], [0, 1])));
    const [a, b, c] = [pos(d, 'n1'), pos(d, 'n2'), pos(d, 'n3')];
    expect((a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1])).toBeCloseTo(0, 5);
  });

  it('uguale e collineare: stessa lunghezza, stessa retta', () => {
    const t = trapezoid();
    const equal = must(addSelectionConstraint(t, 'equal', pick(t, [0, 1, 2, 3], [0, 2])));
    const len = (d: Geo, a: string, b: string) => Math.hypot(pos(d, a)[0] - pos(d, b)[0], pos(d, a)[1] - pos(d, b)[1]);
    expect(len(equal, 'n1', 'n2')).toBeCloseTo(len(equal, 'n3', 'n4'), 6);
    const collinear = must(addSelectionConstraint(t, 'collinear', pick(t, [0, 1, 2, 3], [0, 2])));
    expect(cross(collinear, 'n1', 'n2', 'n3', 'n4')).toBeCloseTo(0, 5);
    expect(cross(collinear, 'n1', 'n2', 'n1', 'n3')).toBeCloseTo(0, 5);
  });

  it('punto medio e simmetrico: il nodo a metà del segmento, due nodi speculari rispetto all\'asse', () => {
    const t = trapezoid();
    const mid = must(addSelectionConstraint(t, 'midpoint', pick(t, [0, 1, 2], [0])));
    const [a, b, m] = [pos(mid, 'n1'), pos(mid, 'n2'), pos(mid, 'n3')];
    expect(m[0]).toBeCloseTo((a[0] + b[0]) / 2, 6);
    expect(m[1]).toBeCloseTo((a[1] + b[1]) / 2, 6);
    // Simmetrici rispetto alla base: il segmento tra i due è perpendicolare all'asse e il suo punto medio sta sull'asse
    const sym = must(addSelectionConstraint(t, 'symmetric', pick(t, [0, 1, 2, 3], [0])));
    const [s1, s2, p3, p4] = [pos(sym, 'n1'), pos(sym, 'n2'), pos(sym, 'n3'), pos(sym, 'n4')];
    expect((p3[0] - p4[0]) * (s2[0] - s1[0]) + (p3[1] - p4[1]) * (s2[1] - s1[1])).toBeCloseTo(0, 5);
    const centre = [(p3[0] + p4[0]) / 2, (p3[1] + p4[1]) / 2];
    expect((centre[0] - s1[0]) * (s2[1] - s1[1]) - (centre[1] - s1[1]) * (s2[0] - s1[0])).toBeCloseTo(0, 5);
  });

  it('conflitti e ridondanze con i nuovi vincoli: rifiutati con il motivo, il disegno di partenza intatto', () => {
    // Due lati opposti di un rettangolo con orizzontali: parallelo è già implicato (ridondante)
    const rectangle = squared();
    const redundant = addSelectionConstraint(rectangle, 'parallel', selectionItems(rectangle.paths, [0, 1, 2, 3].map((node) => ({ path: 0, node })), [{ path: 0, segment: 0 }, { path: 0, segment: 2 }]));
    expect(redundant.ok).toBe(false);
    if (!redundant.ok) expect(redundant.reason).toBe('redundant');
    // Perpendicolare tra base e lato destro, entrambi già orizzontale e verticale: ridondante
    const perp = addSelectionConstraint(rectangle, 'perpendicular', selectionItems(rectangle.paths, [0, 1, 2].map((node) => ({ path: 0, node })), [{ path: 0, segment: 0 }, { path: 0, segment: 1 }]));
    expect(perp.ok).toBe(false);
    // Uguale con due quote diverse: in conflitto
    let d = must(addConstraint(rectangle, { t: 'dist', p: ['n1', 'n2'], v: 40 }));
    d = must(addConstraint(d, { t: 'dist', p: ['n2', 'n3'], v: 20 }));
    const conflict = addSelectionConstraint(d, 'equal', selectionItems(d.paths, [0, 1, 2].map((node) => ({ path: 0, node })), [{ path: 0, segment: 0 }, { path: 0, segment: 1 }]));
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.reason).toBe('conflict');
      expect(conflict.message).toMatch(/^Vincolo in conflitto con .* non applicato$/);
    }
    // Selezione incompatibile: il messaggio dice che cosa serve
    const wrong = addSelectionConstraint(rectangle, 'symmetric', selectionItems(rectangle.paths, [{ path: 0, node: 0 }], []));
    expect(wrong).toMatchObject({ ok: false, reason: 'invalid' });
    if (!wrong.ok) expect(wrong.message).toBe('Simmetrico: scegli due nodi e un segmento (Alt+clic) che fa da asse');
    // Lo stesso segmento due volte non è una coppia
    const same = addSelectionConstraint(rectangle, 'parallel', { nodes: [], segments: [['n1', 'n2'], ['n2', 'n1']], all: ['n1', 'n2'] });
    expect(same).toMatchObject({ ok: false, message: 'Parallelo: scegli due segmenti diversi' });
  });
});

describe('quota angolare', () => {
  /** Triangolo con l'angolo in n2 di 90 gradi: n1 (0,0), n2 (40,0), n3 (40,20). */
  const corner = (): Geo => ({ paths: [{ closed: true, nodes: [{ id: 'n1', p: [0, 0], kind: 'corner' }, { id: 'n2', p: [40, 0], kind: 'corner' }, { id: 'n3', p: [40, 20], kind: 'corner' }] }] });
  const angleOf = (d: Geo, c: ProfileConstraint) => measure(c, pointsOf(d.paths));

  it('createAngleDimension: due segmenti con un nodo in comune danno i due raggi dal vertice, sempre con l\'angolo positivo', () => {
    const d = corner();
    const dim = createAngleDimension(d.paths, ['n1', 'n2'], ['n2', 'n3'], 10) as Omit<ProfileConstraint, 'id'>;
    expect(dim.t).toBe('angle');
    expect(dim.v).toBeCloseTo(90, 9);
    // Da n2 verso n3 (su) a n2 verso n1 (sinistra) è antiorario, +90
    expect(dim.p).toEqual(['n2', 'n3', 'n2', 'n1']);
    expect(dim.at).toBe(0.5);
    expect(dim.off).toBeGreaterThan(0);
    // Scegliere i segmenti nell'altro ordine dà la stessa quota
    const other = createAngleDimension(d.paths, ['n2', 'n3'], ['n1', 'n2'], 10) as Omit<ProfileConstraint, 'id'>;
    expect(other.p).toEqual(dim.p);
    expect(other.v).toBeCloseTo(90, 9);
  });

  it('segmenti paralleli o uguali: un messaggio, non una quota', () => {
    const d = corner();
    const flat: Geo = { paths: [{ closed: false, nodes: [{ id: 'a', p: [0, 0], kind: 'corner' }, { id: 'b', p: [10, 0], kind: 'corner' }, { id: 'c', p: [0, 5], kind: 'corner' }, { id: 'e', p: [10, 5], kind: 'corner' }] }] };
    expect(createAngleDimension(flat.paths, ['a', 'b'], ['c', 'e'], 10)).toBe('I due segmenti sono paralleli: usa il vincolo Parallelo');
    expect(createAngleDimension(d.paths, ['n1', 'n2'], ['n2', 'n1'], 10)).toBe('Scegli due segmenti diversi');
    expect(createAngleDimension(d.paths, ['n1', 'n2'], ['zz', 'n3'], 10)).toBe('Scegli due segmenti');
  });

  it('segmenti lontani: l\'angolo è quello tra le due rette; il valore digitato porta i nodi all\'angolo', () => {
    const d: Geo = { paths: [{ closed: false, nodes: [{ id: 'a', p: [0, 0], kind: 'corner' }, { id: 'b', p: [10, 0], kind: 'corner' }, { id: 'c', p: [20, 0], kind: 'corner' }, { id: 'e', p: [30, 10], kind: 'corner' }] }] };
    const dim = createAngleDimension(d.paths, ['a', 'b'], ['c', 'e'], 10) as Omit<ProfileConstraint, 'id'>;
    expect(dim.v).toBeCloseTo(45, 9);
    const fixedStart = must(addFixed(d, ['a', 'b', 'c']));
    const out = must(addConstraint(fixedStart, { ...dim, v: 60 }));
    expect(angleOf(out, out.constraints!.at(-1)!)).toBeCloseTo(60, 5);
    expect(diagnose(out)!.report.state).toBe('under');
  });

  it('da 10 a 170 gradi (e il contrario) si risolve senza spostare i nodi di decine di mm: prima si ruota il segmento', () => {
    const d: Geo = { paths: [{ closed: false, nodes: [{ id: 'a', p: [0, 0], kind: 'corner' }, { id: 'b', p: [30, 0], kind: 'corner' }, { id: 'c', p: [30 - 30 * Math.cos(Math.PI / 18), 30 * Math.sin(Math.PI / 18)], kind: 'corner' }] }] };
    const dim = createAngleDimension(d.paths, ['a', 'b'], ['b', 'c'], 10) as Omit<ProfileConstraint, 'id'>;
    const base = must(addFixed(d, ['a', 'b']));
    const added = must(addConstraint(base, { ...dim, v: 170 }));
    const con = added.constraints!.at(-1)!;
    expect(angleOf(added, con)).toBeCloseTo(170, 5);
    // La lunghezza dei segmenti non cambia (solo c gira attorno a b)
    expect(Math.hypot(pos(added, 'c')[0] - 30, pos(added, 'c')[1])).toBeCloseTo(30, 4);
    const back = must(setConstraintValue(added, con.id, 10));
    expect(angleOf(back, back.constraints!.at(-1)!)).toBeCloseTo(10, 5);
  });

  it('il valore si valida con validateValue; una quota di riferimento mostra l\'angolo misurato tra parentesi e non vincola', () => {
    const d = must(addConstraint(corner(), { ...(createAngleDimension(corner().paths, ['n1', 'n2'], ['n2', 'n3'], 10) as ProfileConstraint), v: 90 }));
    const id = d.constraints![0].id;
    expect(setConstraintValue(d, id, 400)).toMatchObject({ ok: false, message: 'L\'angolo deve stare tra -360 e 360 gradi', reason: 'invalid' });
    expect(setConstraintValue(d, id, NaN).ok).toBe(false);
    // L'angolo già imposto non si può aggiungere due volte: ridondante, e allora si offre il riferimento
    const dup = addConstraint(d, { ...(createAngleDimension(d.paths, ['n1', 'n2'], ['n2', 'n3'], 10) as ProfileConstraint), v: 90 });
    expect(dup.ok).toBe(false);
    const ref = addReferenceDimension(d, { t: 'angle', p: ['n2', 'n3', 'n2', 'n1'], v: 33 })!;
    const con = ref.constraints!.at(-1)!;
    expect(con.ref).toBe(true);
    expect(dimText(con, ref.paths)).toBe('(90°)');
    expect(ref.paths).toBe(d.paths);
  });

  it('angolo con due punti: rispetto all\'asse X', () => {
    const d: Geo = { paths: [{ closed: false, nodes: [{ id: 'a', p: [0, 0], kind: 'corner' }, { id: 'b', p: [10, 10], kind: 'corner' }] }] };
    const fixedA = must(addFixed(d, ['a']));
    const out = must(addConstraint(fixedA, { t: 'angle', p: ['a', 'b'], v: 30 }));
    expect(angleOf(out, out.constraints!.at(-1)!)).toBeCloseTo(30, 5);
    expect(Math.hypot(pos(out, 'b')[0], pos(out, 'b')[1])).toBeCloseTo(Math.hypot(10, 10), 4);
  });
});
