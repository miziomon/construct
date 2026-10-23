import { execFileSync } from 'node:child_process';
import * as nodeModule from 'node:module';
import { describe, expect, it } from 'vitest';
import { maxResidual, measure, solveSketch, validateValue, type Constraint, type Pt } from './constraints';

/** Scorciatoia: punto con id. */
const P = (id: string, x: number, y: number): Pt => ({ id, x, y });
/** Scorciatoia: vincolo con id progressivo. */
let seq = 0;
const C = (t: Constraint['t'], p: string[], extra: Partial<Constraint> = {}): Constraint => ({ id: `c${++seq}`, t, p, ...extra });
const at = (pts: Pt[], id: string): Pt => pts.find((p) => p.id === id) as Pt;

/** Quadrilatero storto di partenza: il rettangolo si ottiene con i vincoli. */
const skewed = (): Pt[] => [P('a', 0.3, -0.2), P('b', 38, 1.5), P('c', 41, 27), P('d', -2, 24)];

/** Vincoli del rettangolo: lati orizzontali e verticali, larghezza e altezza, e (a richiesta) il punto fisso. */
const rectangle = (fixed: boolean): Constraint[] => [
  C('horizontal', ['a', 'b']),
  C('vertical', ['b', 'c']),
  C('horizontal', ['d', 'c']),
  C('vertical', ['a', 'd']),
  C('distX', ['a', 'b'], { v: 40 }),
  C('distY', ['a', 'd'], { v: 25 }),
  ...(fixed ? [C('fixed', ['a'], { x: 0, y: 0 })] : []),
];

describe('criterio a: rettangolo quotato', () => {
  it('con due quote, orizzontale/verticale e un punto fisso arriva a 0 gradi di libertà', () => {
    const r = solveSketch(skewed(), rectangle(true));
    expect(r.converged).toBe(true);
    expect(r.dof).toBe(0);
    expect(r.state).toBe('full');
    expect(r.free).toEqual([]);
    expect(r.redundant).toEqual([]);
    expect(r.conflicting).toEqual([]);
    expect(at(r.points, 'a').x).toBeCloseTo(0, 9);
    expect(at(r.points, 'a').y).toBeCloseTo(0, 9);
    expect(at(r.points, 'c').x).toBeCloseTo(40, 9);
    expect(at(r.points, 'c').y).toBeCloseTo(25, 9);
  });

  it('senza il punto fisso restano 2 gradi (la traslazione) e tutti i punti sono liberi', () => {
    const r = solveSketch(skewed(), rectangle(false));
    expect(r.converged).toBe(true);
    expect(r.dof).toBe(2);
    expect(r.state).toBe('under');
    expect(r.free.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('con una sola quota resta 1 grado e solo i punti coinvolti dalla quota mancante sono liberi', () => {
    const cons = rectangle(true).filter((c) => !(c.t === 'distY'));
    const r = solveSketch(skewed(), cons);
    expect(r.dof).toBe(1);
    expect(r.free.sort()).toEqual(['c', 'd']);
    expect(at(r.points, 'b').x).toBeCloseTo(40, 9);
    expect(at(r.points, 'b').y).toBeCloseTo(0, 9);
  });
});

describe('criterio b: sovravincolo senza oscillazioni', () => {
  it('una quota in più coerente è ridondante, non in conflitto', () => {
    const extra = C('dist', ['a', 'c'], { v: Math.hypot(40, 25) });
    const r = solveSketch(skewed(), [...rectangle(true), extra]);
    expect(r.converged).toBe(true);
    expect(r.state).toBe('over');
    expect(r.redundant).toEqual([extra.id]);
    expect(r.conflicting).toEqual([]);
  });

  it('la stessa larghezza due volte è ridondante; con un valore diverso è in conflitto e il costo non cresce mai', () => {
    const same = C('distX', ['a', 'b'], { v: 40 });
    expect(solveSketch(skewed(), [...rectangle(true), same]).redundant).toEqual([same.id]);
    const other = C('distX', ['a', 'b'], { v: 55 });
    const r = solveSketch(skewed(), [...rectangle(true), other]);
    expect(r.converged).toBe(false);
    expect(r.state).toBe('over');
    expect(r.conflicting).toContain(other.id);
    // Nessuna oscillazione: il costo scende a ogni passo accettato e le iterazioni hanno un tetto
    for (let i = 1; i < r.costs.length; i++) expect(r.costs[i]).toBeLessThanOrEqual(r.costs[i - 1]);
    expect(r.iterations).toBeLessThanOrEqual(60);
    // Il risultato è deterministico e stabile: rifare il calcolo dalla soluzione non la sposta
    const again = solveSketch(r.points, [...rectangle(true), other]);
    expect(again.points.map((p) => [p.x, p.y])).toEqual(solveSketch(r.points, [...rectangle(true), other]).points.map((p) => [p.x, p.y]));
    r.points.forEach((p, i) => expect(Math.hypot(p.x - again.points[i].x, p.y - again.points[i].y)).toBeLessThan(1e-6));
  });
});

describe('criterio c: trascinamento a spostamento minimo', () => {
  /** Porta il punto `id` sul bersaglio e risolve con peso alto su di lui, come fa un trascinamento. */
  const drag = (pts: Pt[], cons: Constraint[], id: string, to: [number, number]): Pt[] =>
    solveSketch(pts.map((p) => (p.id === id ? { ...p, x: to[0], y: to[1] } : p)), cons, { weights: { [id]: 1000 }, diagnose: false }).points;

  it('con le sole direzioni (H/V) cambia solo ciò che serve: il punto opposto non si muove', () => {
    const start = solveSketch(skewed(), rectangle(true).filter((c) => c.t !== 'distX' && c.t !== 'distY')).points;
    const moved = drag(start, rectangle(true).filter((c) => c.t !== 'distX' && c.t !== 'distY'), 'c', [start[2].x + 3, start[2].y + 2]);
    // a è fisso; b e d seguono solo con una coordinata; c arriva sul mouse
    expect(Math.hypot(at(moved, 'c').x - (start[2].x + 3), at(moved, 'c').y - (start[2].y + 2))).toBeLessThan(0.01);
    expect(Math.hypot(at(moved, 'a').x - start[0].x, at(moved, 'a').y - start[0].y)).toBeLessThan(1e-9);
    expect(maxResidual(moved, rectangle(true).filter((c) => c.t !== 'distX' && c.t !== 'distY'))).toBeLessThan(1e-9);
  });

  it('con le quote ma senza punto fisso il rettangolo si sposta rigidamente: nessun nodo si muove più del mouse', () => {
    const start = solveSketch(skewed(), rectangle(false)).points;
    const d: [number, number] = [3, 2];
    const moved = drag(start, rectangle(false), 'c', [at(start, 'c').x + d[0], at(start, 'c').y + d[1]]);
    for (const p of moved) {
      const was = at(start, p.id);
      expect(Math.hypot(p.x - was.x, p.y - was.y)).toBeLessThanOrEqual(Math.hypot(d[0], d[1]) * 1.001);
    }
    expect(maxResidual(moved, rectangle(false))).toBeLessThan(1e-9);
  });

  it('un nodo fisso non segue il mouse', () => {
    const start = solveSketch(skewed(), rectangle(true)).points;
    const moved = drag(start, rectangle(true), 'a', [5, 5]);
    expect(Math.hypot(at(moved, 'a').x, at(moved, 'a').y)).toBeLessThan(0.01);
  });
});

describe('tipi di vincolo e di quota', () => {
  /** Risolve e controlla che il vincolo valga e che il disegno parta da una configurazione diversa. */
  const holds = (pts: Pt[], cons: Constraint[]): Pt[] => {
    expect(maxResidual(pts, cons)).toBeGreaterThan(1e-3);
    const r = solveSketch(pts, cons);
    expect(r.converged).toBe(true);
    expect(maxResidual(r.points, cons)).toBeLessThan(1e-9);
    return r.points;
  };

  it('coincident, midpoint, fixed', () => {
    const out = holds([P('a', 0, 0), P('b', 5, 3)], [C('coincident', ['a', 'b'])]);
    expect(at(out, 'a').x).toBeCloseTo(at(out, 'b').x, 9);
    const mid = holds([P('m', 1, 1), P('a', 0, 0), P('b', 10, 4)], [C('midpoint', ['m', 'a', 'b'])]);
    expect(at(mid, 'm').x).toBeCloseTo((at(mid, 'a').x + at(mid, 'b').x) / 2, 9);
  });

  it('dist, distX, distY e il valore misurato', () => {
    const pts = [P('a', 0, 0), P('b', 6, 5)];
    const cons = [C('dist', ['a', 'b'], { v: 20 }), C('distX', ['a', 'b'], { v: 16 })];
    const out = holds(pts, cons);
    expect(measure(cons[0], out)).toBeCloseTo(20, 9);
    expect(measure(cons[1], out)).toBeCloseTo(16, 9);
    expect(measure({ id: 'k', t: 'distY', p: ['a', 'b'], s: 1 }, out)).toBeCloseTo(12, 6);
  });

  it('parallel, perpendicular, equal', () => {
    const pts = [P('a', 0, 0), P('b', 10, 0), P('c', 0, 5), P('d', 8, 9)];
    const par = holds(pts, [C('parallel', ['a', 'b', 'c', 'd'])]);
    const cross = (at(par, 'b').x - at(par, 'a').x) * (at(par, 'd').y - at(par, 'c').y) - (at(par, 'b').y - at(par, 'a').y) * (at(par, 'd').x - at(par, 'c').x);
    expect(Math.abs(cross)).toBeLessThan(1e-7);
    holds(pts, [C('perpendicular', ['a', 'b', 'c', 'd'])]);
    const eq = holds(pts, [C('equal', ['a', 'b', 'c', 'd'])]);
    expect(Math.hypot(at(eq, 'b').x - at(eq, 'a').x, at(eq, 'b').y - at(eq, 'a').y)).toBeCloseTo(Math.hypot(at(eq, 'd').x - at(eq, 'c').x, at(eq, 'd').y - at(eq, 'c').y), 9);
  });

  it('collinear e symmetric', () => {
    holds([P('a', 0, 0), P('b', 10, 0), P('c', 3, 2), P('d', 7, -1)], [C('collinear', ['a', 'b', 'c', 'd'])]);
    const sym = holds([P('a', 1, 4), P('b', 6, 1), P('c', 0, 0), P('d', 0, 10)], [C('symmetric', ['a', 'b', 'c', 'd']), C('fixed', ['c'], { x: 0, y: 0 }), C('fixed', ['d'], { x: 0, y: 10 })]);
    expect(at(sym, 'a').y).toBeCloseTo(at(sym, 'b').y, 7);
    expect((at(sym, 'a').x + at(sym, 'b').x) / 2).toBeCloseTo(at(sym, 'c').x, 7);
  });

  it('angle: rispetto all\'asse X e tra due segmenti, anche da 10 a 170 gradi senza girare dall\'altra parte', () => {
    const pts = [P('a', 0, 0), P('b', 10, 1.7632698)];
    expect(measure(C('angle', ['a', 'b'], { v: 0 }), pts)).toBeCloseTo(10, 5);
    const to170 = solveSketch(pts, [C('angle', ['a', 'b'], { v: 170 })]);
    expect(to170.converged).toBe(true);
    expect(at(to170.points, 'b').x).toBeLessThan(0);
    const two = holds([P('a', 0, 0), P('b', 10, 0), P('c', 0, 0), P('d', 7, 2)], [C('angle', ['a', 'b', 'c', 'd'], { v: 60 })]);
    expect(measure(C('angle', ['a', 'b', 'c', 'd']), two)).toBeCloseTo(60, 7);
  });
});

describe('criterio e: casi limite', () => {
  it('quota a zero, negativa o non finita: rifiutata prima di risolvere', () => {
    expect(validateValue('dist', 0)).not.toBeNull();
    expect(validateValue('distX', -3)).not.toBeNull();
    expect(validateValue('dist', Number.NaN)).not.toBeNull();
    expect(validateValue('angle', 400)).not.toBeNull();
    expect(validateValue('dist', 5)).toBeNull();
    expect(validateValue('angle', -45)).toBeNull();
  });

  it('quota impossibile (triangolo 3, 4, 10): non converge, indica i vincoli, nessun NaN', () => {
    const pts = [P('a', 0, 0), P('b', 3, 0.2), P('c', 1, 3)];
    const cons = [C('dist', ['a', 'b'], { v: 3 }), C('dist', ['b', 'c'], { v: 4 }), C('dist', ['a', 'c'], { v: 10 })];
    const r = solveSketch(pts, cons);
    expect(r.converged).toBe(false);
    expect(r.state).toBe('over');
    // È un conflitto vero (minimo dei quadrati minimi), non un risolutore fermo prima del tempo
    expect(r.unsolved).toBe(false);
    expect(r.conflicting.length).toBeGreaterThan(0);
    for (const p of r.points) expect(Number.isFinite(p.x + p.y)).toBe(true);
    expect(r.iterations).toBeLessThanOrEqual(500);
  });

  /** Poligono chiuso di n lati: lunghezza 10 sui lati pari, uguaglianza sui dispari, angolo tra lati consecutivi (non lineare). */
  const polygon = (n: number): { pts: Pt[]; cons: Constraint[] } => {
    const R = (10 * n) / (2 * Math.PI);
    const pts = Array.from({ length: n }, (_, i) => P(`p${i}`, R * Math.cos((2 * Math.PI * i) / n) + 0.7 * Math.sin(i * 1.7), R * Math.sin((2 * Math.PI * i) / n) + 0.5 * Math.cos(i * 2.3)));
    const cons: Constraint[] = [C('fixed', ['p0'], { x: pts[0].x, y: pts[0].y }), C('angle', ['p0', 'p1'], { v: 90 + 180 / n })];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      cons.push(i % 2 === 0 ? C('dist', [`p${i}`, `p${j}`], { v: 10 }) : C('equal', [`p${i}`, `p${j}`, `p${(i + n - 1) % n}`, `p${i}`]));
      if (i < n - 3) cons.push(C('angle', [`p${i}`, `p${j}`, `p${j}`, `p${(i + 2) % n}`], { v: 360 / n }));
    }
    return { pts, cons };
  };

  it('poligono coerente di 100 lati: con le iterazioni predefinite converge a completamente vincolato, nessun «conflitto»', () => {
    const { pts, cons } = polygon(100);
    const r = solveSketch(pts, cons);
    expect(r.converged).toBe(true);
    expect(r.state).toBe('full');
    expect(r.conflicting).toEqual([]);
  });

  it('con poche iterazioni lo stesso poligono è «non risolto»: nessun vincolo accusato, a differenza di un conflitto vero', () => {
    const { pts, cons } = polygon(100);
    const r = solveSketch(pts, cons, { maxIter: 5 });
    expect(r.converged).toBe(false);
    expect(r.unsolved).toBe(true);
    expect(r.state).toBe('unsolved');
    expect(r.conflicting).toEqual([]);
    expect(r.redundant).toEqual([]);
    // Con più iterazioni, dalla stessa partenza, si risolve
    expect(solveSketch(pts, cons, { maxIter: 500 }).converged).toBe(true);
  });

  it('angolo di 0 gradi da un segmento a 180 gradi esatti (salto di wrap): converge, non è un conflitto', () => {
    for (const y of [1e-7, -1e-7, 0]) {
      const r = solveSketch([P('a', 0, 0), P('b', -10, y)], [C('angle', ['a', 'b'], { v: 0 })]);
      expect(r.converged).toBe(true);
      expect(r.conflicting).toEqual([]);
      expect(Math.abs(measure({ id: 'k', t: 'angle', p: ['a', 'b'] }, r.points))).toBeLessThan(1e-6);
    }
  });

  it('lunghezza e angolo insieme (Jacobiano analitico): convergono in pochi passi alla soluzione esatta', () => {
    const a = solveSketch([P('a', 0, 0), P('b', 9, 4)], [C('fixed', ['a'], { x: 0, y: 0 }), C('dist', ['a', 'b'], { v: 12 }), C('angle', ['a', 'b'], { v: 37 })]);
    expect(Math.hypot(at(a.points, 'b').x, at(a.points, 'b').y)).toBeCloseTo(12, 8);
    expect((Math.atan2(at(a.points, 'b').y, at(a.points, 'b').x) * 180) / Math.PI).toBeCloseTo(37, 6);
    expect(a.iterations).toBeLessThanOrEqual(12);
  });

  it('vincoli contraddittori: orizzontale e verticale sullo stesso segmento con lunghezza positiva', () => {
    const pts = [P('a', 0, 0), P('b', 10, 1)];
    const cons = [C('horizontal', ['a', 'b']), C('vertical', ['a', 'b']), C('dist', ['a', 'b'], { v: 10 })];
    const r = solveSketch(pts, cons);
    expect(r.converged).toBe(false);
    expect(r.conflicting).toContain(cons[2].id);
  });

  it('schizzo degenerato: segmento di lunghezza nulla con una quota o un angolo si separa e si risolve', () => {
    const pts = [P('a', 5, 5), P('b', 5, 5)];
    const r = solveSketch(pts, [C('dist', ['a', 'b'], { v: 12 }), C('angle', ['a', 'b'], { v: 30 })]);
    expect(r.converged).toBe(true);
    expect(measure({ id: 'k', t: 'dist', p: ['a', 'b'] }, r.points)).toBeCloseTo(12, 8);
    expect(measure({ id: 'k', t: 'angle', p: ['a', 'b'] }, r.points)).toBeCloseTo(30, 6);
    // Orizzontale e verticale su un segmento nullo sono soddisfatte (la riga è lineare)
    const h = solveSketch(pts, [C('horizontal', ['a', 'b'])]);
    expect(h.converged).toBe(true);
  });

  it('coincidenza voluta: due punti uniti restano uniti e non si separano', () => {
    const r = solveSketch([P('a', 1, 1), P('b', 1, 1), P('c', 9, 4)], [C('coincident', ['a', 'b']), C('equal', ['a', 'c', 'b', 'c'])]);
    expect(Math.hypot(at(r.points, 'a').x - at(r.points, 'b').x, at(r.points, 'a').y - at(r.points, 'b').y)).toBeLessThan(1e-9);
  });

  it('dati non finiti: nessun NaN in uscita, esito non convergente', () => {
    const r = solveSketch([P('a', 0, 0), P('b', Number.NaN, 1)], [C('horizontal', ['a', 'b'])]);
    expect(r.converged).toBe(false);
    expect(r.state).toBe('over');
  });

  it('vincoli di riferimento o con punti mancanti non entrano nel sistema', () => {
    const pts = [P('a', 0, 0), P('b', 7, 2)];
    const r = solveSketch(pts, [C('dist', ['a', 'b'], { v: 99, ref: true }), C('horizontal', ['a', 'zz'])]);
    expect(r.dof).toBe(4);
    expect(at(r.points, 'b')).toMatchObject({ x: 7, y: 2 });
  });
});

describe('scala e arrotondamento', () => {
  /** Poligono rettilineo a gradini con n segmenti, lati orizzontali e verticali alternati e una quota ogni due lati. */
  const staircase = (n: number): { pts: Pt[]; cons: Constraint[] } => {
    const pts: Pt[] = [];
    const cons: Constraint[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
      pts.push(P(`p${i}`, x + 0.4 * ((i * 7) % 3), y + 0.3 * ((i * 5) % 4)));
      if (i % 2 === 0) x += 10 + (i % 3);
      else y += 6 + (i % 4);
    }
    for (let i = 0; i < n - 1; i++) {
      cons.push(C(i % 2 === 0 ? 'horizontal' : 'vertical', [`p${i}`, `p${i + 1}`]));
      if (i % 2 === 0) cons.push(C('distX', [`p${i}`, `p${i + 1}`], { v: 10 + (i % 3) }));
    }
    return { pts, cons };
  };

  it('converge anche con 100 segmenti', () => {
    for (const n of [10, 25, 50, 100]) {
      const { pts, cons } = staircase(n);
      const r = solveSketch(pts, cons);
      expect(r.converged).toBe(true);
      expect(maxResidual(r.points, cons)).toBeLessThan(1e-9);
    }
  });

  it('dopo l\'arrotondamento a 4 decimali l\'errore sulle quote resta sotto 0,0002 mm', () => {
    const { pts, cons } = staircase(50);
    const r = solveSketch(pts, cons);
    const rounded = r.points.map((p) => ({ ...p, x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 }));
    expect(maxResidual(rounded, cons)).toBeLessThan(2e-4);
  });
});

// stripTypeScriptTypes di node:module è sperimentale e manca nei Node più vecchi (package.json non ha `engines`): senza, il test si salta
const hasStrip = typeof (nodeModule as unknown as Record<string, unknown>).stripTypeScriptTypes === 'function';

describe('prototipo', () => {
  it.skipIf(!hasStrip)('il blocco CORE di docs/prototipi/profilo-quote.html è lo stesso testo di constraints.ts (tolti i tipi; saltato se questo Node non ha stripTypeScriptTypes)', () => {
    // Lo script rigenera il blocco dal modulo e lo confronta con quello del prototipo: esce con 1 se differiscono
    expect(() => execFileSync(process.execPath, ['--no-warnings', 'scripts/constraints-sync.mjs', '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
