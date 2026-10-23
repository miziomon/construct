import { describe, expect, it } from 'vitest';
import {
  addConstraint,
  addFixed,
  addSelectionConstraint,
  canApplyConstraint,
  createDimension,
  diagnose,
  dimLayout,
  dimensionValue,
  dragFrame,
  idsOf,
  moveNodesConstrained,
  nodeNames,
  pointMap,
  pointsOf,
  removeConstraint,
  setConstraintValue,
  settlePaths,
  stateText,
  validConstraints,
  writeBack,
} from './dimensions';
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
    // La diagonale di un rettangolo 60 x 30 non può valere 10
    const r = addConstraint(d, { t: 'dist', p: ['n1', 'n3'], v: 10 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/^Quota in conflitto con /);
    expect(r.message).toMatch(/non applicato$/);
    expect(r.ids.length).toBeGreaterThan(0);
    // Chi chiama tiene il disegno di prima (la funzione non lo modifica)
    expect(d.constraints).toHaveLength(7);
  });

  it('un vincolo che il disegno già impone (ridondante) non si applica', () => {
    const d = squared();
    const r = addConstraint(d, { t: 'horizontal', p: ['n1', 'n2'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/ridondante/);
    const q = addConstraint(must(addConstraint(d, { t: 'dist', p: ['n1', 'n2'], v: 40 })), { t: 'distX', p: ['n1', 'n2'], v: 40, s: 1 });
    expect(q.ok).toBe(false);
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
    if (!c.ok) expect(c.message).toMatch(/^Vincolo in conflitto con Lunghezza P1\.1-P1\.2/);
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
    expect(canApplyConstraint('horizontal', 2)).toBe(true);
    expect(canApplyConstraint('vertical', 1)).toBe(false);
    expect(canApplyConstraint('coincident', 3)).toBe(false);
    expect(canApplyConstraint('fixed', 1)).toBe(true);
    expect(canApplyConstraint('fixed', 0)).toBe(false);
    expect(addSelectionConstraint(start(), 'horizontal', ['n1']).ok).toBe(false);
    expect(addSelectionConstraint(start(), 'vertical', ['n1', 'n1']).ok).toBe(false);
    expect(addSelectionConstraint(start(), 'fixed', []).ok).toBe(false);
    const ok = must(addSelectionConstraint(start(), 'coincident', ['n1', 'n2']));
    expect(pos(ok, 'n1')[0]).toBeCloseTo(pos(ok, 'n2')[0], 6);
    expect(pos(ok, 'n1')[1]).toBeCloseTo(pos(ok, 'n2')[1], 6);
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
    const again = addSelectionConstraint(d, 'horizontal', ['n1', 'n2']);
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
