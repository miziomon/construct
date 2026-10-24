import { describe, expect, it } from 'vitest';
import { INFER_TOLERANCE_DEG, applyInferred, directionKind, inferClosingConstraints, inferNodeConstraints, inferShapeConstraints } from './infer';
import { addFixed, pointMap } from './dimensions';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';

const path = (pts: Vec2[], prefix = 'n', closed = false): PathContour => ({ closed, nodes: pts.map((p, i) => ({ id: `${prefix}${i + 1}`, p, kind: 'corner' as const })) });
const at = (deg: number, length = 10): Vec2 => [length * Math.cos((deg * Math.PI) / 180), length * Math.sin((deg * Math.PI) / 180)];
const last = (c: PathContour): NonNullable<unknown> => ({ path: 0, node: c.nodes.length - 1 });

describe('direzione orizzontale o verticale entro la tolleranza', () => {
  it('la soglia è 3 gradi: poco dentro sì, poco fuori no, in tutte e due le direzioni e per le rette rovesciate', () => {
    expect(INFER_TOLERANCE_DEG).toBe(3);
    expect(directionKind([0, 0], at(0), 3)).toBe('horizontal');
    expect(directionKind([0, 0], at(2.9), 3)).toBe('horizontal');
    expect(directionKind([0, 0], at(3.1), 3)).toBeNull();
    expect(directionKind([0, 0], at(180))).toBe('horizontal');
    expect(directionKind([0, 0], at(-177.5))).toBe('horizontal');
    expect(directionKind([0, 0], at(90))).toBe('vertical');
    expect(directionKind([0, 0], at(87.5))).toBe('vertical');
    expect(directionKind([0, 0], at(86.9))).toBeNull();
    expect(directionKind([0, 0], at(-92.9))).toBe('vertical');
    expect(directionKind([0, 0], at(45))).toBeNull();
    // Un segmento lungo zero non ha direzione; una tolleranza diversa cambia la soglia
    expect(directionKind([1, 1], [1, 1])).toBeNull();
    expect(directionKind([0, 0], at(10), 12)).toBe('horizontal');
    expect(directionKind([0, 0], at(10), 0.5)).toBeNull();
  });
});

describe('vincoli suggeriti dal nodo appena disegnato', () => {
  it('quasi orizzontale: Orizzontale; quasi verticale: Verticale; diagonale: niente', () => {
    expect(inferNodeConstraints([path([[0, 0], at(1.5, 30)])], { path: 0, node: 1 })).toEqual([{ t: 'horizontal', p: ['n1', 'n2'] }]);
    expect(inferNodeConstraints([path([[0, 0], at(92, 30)])], { path: 0, node: 1 })).toEqual([{ t: 'vertical', p: ['n1', 'n2'] }]);
    expect(inferNodeConstraints([path([[0, 0], at(35, 30)])], { path: 0, node: 1 })).toEqual([]);
  });

  it('perpendicolare al segmento precedente entro la tolleranza, ma non per un angolo qualunque né per una prosecuzione', () => {
    const base: Vec2[] = [[0, 0], at(35, 20)];
    const from = base[1];
    const turned = (deg: number): PathContour => path([...base, [from[0] + at(deg, 15)[0], from[1] + at(deg, 15)[1]]]);
    expect(inferNodeConstraints([turned(35 + 90)], { path: 0, node: 2 })).toEqual([{ t: 'perpendicular', p: ['n1', 'n2', 'n2', 'n3'] }]);
    expect(inferNodeConstraints([turned(35 - 88)], { path: 0, node: 2 })).toEqual([{ t: 'perpendicular', p: ['n1', 'n2', 'n2', 'n3'] }]);
    expect(inferNodeConstraints([turned(35 + 94)], { path: 0, node: 2 })).toEqual([]);
    expect(inferNodeConstraints([turned(35)], { path: 0, node: 2 })).toEqual([]);
    expect(inferNodeConstraints([turned(35 + 60)], { path: 0, node: 2 })).toEqual([]);
    // Se il nuovo segmento è già orizzontale, vale quello (e non anche la perpendicolare)
    const vertical = path([[0, 0], [0, 20], [30, 20.5]]);
    expect(inferNodeConstraints([vertical], { path: 0, node: 2 })).toEqual([{ t: 'horizontal', p: ['n2', 'n3'] }]);
  });

  it('il primo punto di un contorno e un nodo senza id non danno nulla', () => {
    expect(inferNodeConstraints([path([[0, 0]])], { path: 0, node: 0 })).toEqual([]);
    const bare: PathContour = { closed: false, nodes: [{ p: [0, 0], kind: 'corner' }, { p: [10, 0], kind: 'corner' }] };
    expect(inferNodeConstraints([bare], { path: 0, node: 1 })).toEqual([]);
    expect(inferNodeConstraints([], { path: 3, node: 0 })).toEqual([]);
  });

  it('un nodo che cade su un altro è Coincidente (di un altro contorno o dello stesso), ma non con il nodo che lo precede', () => {
    const square = path([[0, 0], [40, 0], [40, 40], [0, 40]], 's', true);
    const drawn = path([[10, 10], [40, 40]], 'n');
    // Il nuovo nodo n2 (40, 40) sta sul nodo s3 del quadrato; il segmento n1-n2 è a 45 gradi
    expect(inferNodeConstraints([square, drawn], { path: 1, node: 1 })).toEqual([{ t: 'coincident', p: ['n2', 's3'] }]);
    // Orizzontale e coincidente insieme
    const flat = path([[10, 40], [40, 40]], 'n');
    expect(inferNodeConstraints([square, flat], { path: 1, node: 1 })).toEqual([{ t: 'horizontal', p: ['n1', 'n2'] }, { t: 'coincident', p: ['n2', 's3'] }]);
    // Sullo stesso punto del nodo precedente: segmento lungo zero, niente
    expect(inferNodeConstraints([path([[5, 5], [5, 5]])], { path: 0, node: 1 })).toEqual([]);
    // Nello stesso contorno: il terzo nodo sul primo
    const loop = path([[0, 0], [30, 5], [0, 0]]);
    expect(inferNodeConstraints([loop], { path: 0, node: 2 }).map((c) => c.t)).toContain('coincident');
  });

  it('la forma base: rettangolo con i lati orizzontali e verticali, un quadrato ruotato o un esagono no (solo i lati esatti)', () => {
    const rect = path([[0, 0], [40, 0], [40, 20], [0, 20]], 'n', true);
    expect(inferShapeConstraints([rect], 0)).toEqual([
      { t: 'horizontal', p: ['n1', 'n2'] },
      { t: 'vertical', p: ['n2', 'n3'] },
      { t: 'horizontal', p: ['n3', 'n4'] },
      { t: 'vertical', p: ['n4', 'n1'] },
    ]);
    const diamond = path([[20, 0], [40, 20], [20, 40], [0, 20]], 'n', true);
    expect(inferShapeConstraints([diamond], 0)).toEqual([]);
    // Un lato quasi orizzontale (2 gradi) non è esatto: nessun vincolo per una forma base
    const slightly = path([[0, 0], at(2, 40), [40, 20], [0, 20]], 'n', true);
    expect(inferShapeConstraints([slightly], 0).map((c) => c.p.join('-'))).not.toContain('n1-n2');
    expect(inferShapeConstraints([rect], 5)).toEqual([]);
  });
});

describe('applyInferred: i candidati si aggiungono se non vanno in conflitto', () => {
  const draw = (): { paths: PathContour[]; constraints?: ProfileConstraint[] } => ({ paths: [path([[0, 0], at(1.5, 40)])] });

  it('un segmento quasi orizzontale diventa orizzontale: il risolutore porta i nodi alla stessa y e il vincolo è nell\'elenco', () => {
    const d = draw();
    const out = applyInferred(d, inferNodeConstraints(d.paths, { path: 0, node: 1 }));
    expect(out).not.toBe(d);
    expect(out.constraints).toHaveLength(1);
    expect(out.constraints![0]).toMatchObject({ t: 'horizontal', p: ['n1', 'n2'] });
    const pm = pointMap(out.paths);
    expect(pm.get('n1')![1]).toBeCloseTo(pm.get('n2')![1], 6);
    // La lunghezza resta più o meno la stessa (il risolutore sposta poco)
    expect(Math.abs(Math.hypot(pm.get('n2')![0] - pm.get('n1')![0], pm.get('n2')![1] - pm.get('n1')![1]) - 40)).toBeLessThan(0.5);
  });

  it('niente duplicati: ripetere l\'inferenza sullo stesso disegno non aggiunge nulla e restituisce lo stesso oggetto', () => {
    const d = draw();
    const once = applyInferred(d, inferNodeConstraints(d.paths, { path: 0, node: 1 }));
    const twice = applyInferred(once, inferNodeConstraints(once.paths, { path: 0, node: 1 }));
    expect(twice).toBe(once);
    expect(twice.constraints).toHaveLength(1);
  });

  it('un vincolo dedotto in conflitto con quelli che ci sono (nodi fissi) non si aggiunge; gli altri candidati sì', () => {
    // Due nodi fissi con una differenza di y: l'orizzontale è impossibile
    const fixed = addFixed(draw(), ['n1', 'n2']);
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    const out = applyInferred(fixed.draft, [{ t: 'horizontal', p: ['n1', 'n2'] }]);
    expect(out).toBe(fixed.draft);
    // Un candidato valido dopo uno in conflitto si aggiunge comunque
    const mixed = applyInferred(fixed.draft, [{ t: 'horizontal', p: ['n1', 'n2'] }, { t: 'distX', p: ['n1', 'n2'], v: 40, s: 1 }]);
    expect(mixed.constraints!.map((c) => c.t)).not.toContain('horizontal');
    // Nessun candidato: lo stesso oggetto
    const d = draw();
    expect(applyInferred(d, [])).toBe(d);
    // Il coincidente di due nodi nello stesso punto si aggiunge
    const twoPlaces: { paths: PathContour[]; constraints?: ProfileConstraint[] } = { paths: [path([[0, 0], [20, 0], [20, 0]])] };
    const coincident = applyInferred(twoPlaces, [{ t: 'coincident', p: ['n2', 'n3'] }]);
    expect(coincident.constraints).toHaveLength(1);
    expect(last(twoPlaces.paths[0])).toEqual({ path: 0, node: 2 });
  });
});

describe('segmenti curvi e lato di chiusura', () => {
  /** Un contorno con maniglie sul nodo indicato (uscita `out` e/o entrata `in`). */
  const curve = (c: PathContour, at: number, handles: { in?: Vec2; out?: Vec2 }): PathContour => ({ ...c, nodes: c.nodes.map((n, i) => (i === at ? { ...n, ...handles } : n)) });

  it('un segmento curvo (maniglia in uscita dal precedente o in entrata nel nuovo) non dà né orizzontale né verticale', () => {
    const flat = path([[0, 0], [30, 0.5]]);
    expect(inferNodeConstraints([flat], { path: 0, node: 1 })).toEqual([{ t: 'horizontal', p: ['n1', 'n2'] }]);
    expect(inferNodeConstraints([curve(flat, 0, { out: [5, 5] })], { path: 0, node: 1 })).toEqual([]);
    expect(inferNodeConstraints([curve(flat, 1, { in: [-5, 5] })], { path: 0, node: 1 })).toEqual([]);
    // Una maniglia nulla non è una curva
    expect(inferNodeConstraints([curve(flat, 0, { out: [0, 0] })], { path: 0, node: 1 })).toEqual([{ t: 'horizontal', p: ['n1', 'n2'] }]);
  });

  it('il perpendicolare non si deduce se il segmento precedente è curvo', () => {
    const corner = path([[0, 0], [20, 0], [20, 15]]);
    expect(inferNodeConstraints([corner], { path: 0, node: 2 })).toEqual([{ t: 'vertical', p: ['n2', 'n3'] }]);
    const slanted = path([[0, 0], at(35, 20), [at(35, 20)[0] + at(125, 15)[0], at(35, 20)[1] + at(125, 15)[1]]]);
    expect(inferNodeConstraints([slanted], { path: 0, node: 2 })).toEqual([{ t: 'perpendicular', p: ['n1', 'n2', 'n2', 'n3'] }]);
    expect(inferNodeConstraints([curve(slanted, 0, { out: [4, 1] })], { path: 0, node: 2 })).toEqual([]);
  });

  it('senza direzioni (angolo digitato) restano solo i coincidenti', () => {
    const flat = path([[0, 0], [30, 0.5]]);
    expect(inferNodeConstraints([flat], { path: 0, node: 1 }, undefined, false)).toEqual([]);
    const onOther = [path([[0, 0], [30, 0]]), path([[30, 0], [40, 10]], 'm')];
    expect(inferNodeConstraints(onOther, { path: 0, node: 1 }, undefined, false)).toEqual([{ t: 'coincident', p: ['n2', 'm1'] }]);
  });

  it('il lato di chiusura (ultimo nodo, primo nodo) è orizzontale, verticale o perpendicolare al lato prima; curvo o aperto no', () => {
    const closedPath = (pts: Vec2[]): PathContour => path(pts, 'n', true);
    // Il lato n4 -> n1 va da (0,4 ; 20) a (0 ; 0): verticale
    expect(inferClosingConstraints([closedPath([[0, 0], [30, 0], [30, 20], [0.4, 20]])], 0)).toEqual([{ t: 'vertical', p: ['n4', 'n1'] }]);
    // Il lato n3 -> n1 va da (30 ; 0,5) a (0 ; 0): orizzontale
    expect(inferClosingConstraints([closedPath([[0, 0], [15, 20], [30, 0.5]])], 0)).toEqual([{ t: 'horizontal', p: ['n3', 'n1'] }]);
    // Un lato obliquo ma perpendicolare al precedente: Perpendicolare
    expect(inferClosingConstraints([closedPath([[0, 0], [40, 0], [20, 20]])], 0)).toEqual([{ t: 'perpendicular', p: ['n2', 'n3', 'n3', 'n1'] }]);
    // Un lato obliquo qualunque: niente
    expect(inferClosingConstraints([closedPath([[0, 0], [40, 0], [30, 20]])], 0)).toEqual([]);
    // Aperto o con meno di tre nodi: niente; con directions falso: niente
    expect(inferClosingConstraints([path([[0, 0], [30, 0], [30, 20], [0.2, 10]])], 0)).toEqual([]);
    expect(inferClosingConstraints([closedPath([[0, 0], [30, 0]])], 0)).toEqual([]);
    expect(inferClosingConstraints([closedPath([[0, 0], [30, 0], [30, 20], [0.2, 10]])], 0, undefined, false)).toEqual([]);
    // Il lato di chiusura curvo (maniglia in uscita dall'ultimo nodo) non deduce nulla
    const withHandle = curve(closedPath([[0, 0], [30, 0], [30, 20], [0.2, 10]]), 3, { out: [-3, -3] });
    expect(inferClosingConstraints([withHandle], 0)).toEqual([]);
  });
});
