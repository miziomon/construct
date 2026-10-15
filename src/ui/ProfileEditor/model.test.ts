import { describe, expect, it } from 'vitest';
import { appendPenNode, bakeScale, canCloseContour, closeContour, contourContains, cycleKind, deleteNodes, draftContours, draftFromNode, dropLastNode, emptyDraft, gridStep, insertNode, isOpenEnd, joinContours, moveHandle, moveNodes, nearestSegment, pathCenter, resumeContour, setNodeKind, snapPoint, trimDuplicateTail } from './model';
import { bboxOf, cubicPoint, segmentOf, signedArea, splitCubic } from '../../scene/bezier';
import { pathContours, pathNaturalSize } from '../../scene/shapes2d';
import { shape2dDefaults } from '../../scene/defaults';
import type { PathContour, PathNode, Shape2DNode, Vec2 } from '../../scene/types';

const node = (p: Vec2, out?: Vec2, inn?: Vec2, kind: PathNode['kind'] = 'corner'): PathNode => ({ p, ...(inn ? { in: inn } : {}), ...(out ? { out } : {}), kind });

/** Congela in profondità: una funzione che modifica l'input lancia un errore (le funzioni del modello sono immutabili). */
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const K = 0.5523;
/** Cerchio di raggio 10 centrato nell'origine: quattro nodi simmetrici con le maniglie della cubica. */
const circle = (): PathContour => ({
  closed: true,
  nodes: [
    node([10, 0], [0, 10 * K], [0, -10 * K], 'symmetric'),
    node([0, 10], [-10 * K, 0], [10 * K, 0], 'symmetric'),
    node([-10, 0], [0, -10 * K], [0, 10 * K], 'symmetric'),
    node([0, -10], [10 * K, 0], [-10 * K, 0], 'symmetric'),
  ],
});
const square = (): PathContour => ({ closed: true, nodes: [node([0, 0]), node([20, 0]), node([20, 20]), node([0, 20])] });

describe('moveNodes', () => {
  it('sposta i nodi indicati e le maniglie (relative) li seguono; gli altri contorni restano gli stessi oggetti', () => {
    const paths = freeze([circle(), square()]);
    const moved = moveNodes(paths, [{ path: 0, node: 1 }], [5, -3]);
    expect(moved[0].nodes[1]).toEqual({ ...paths[0].nodes[1], p: [5, 7] });
    expect(moved[0].nodes[0]).toBe(paths[0].nodes[0]);
    expect(moved[1]).toBe(paths[1]);
  });

  it('più nodi insieme', () => {
    const moved = moveNodes(freeze([square()]), [{ path: 0, node: 0 }, { path: 0, node: 3 }], [1, 1]);
    expect(moved[0].nodes.map((n) => n.p)).toEqual([[1, 1], [20, 0], [20, 20], [1, 21]]);
  });
});

describe('moveHandle', () => {
  const at = (kind: PathNode['kind'], inn?: Vec2, out?: Vec2): PathContour[] => freeze([{ closed: false, nodes: [node([0, 0]), node([10, 0], out, inn, kind), node([20, 0])] }]);
  const ref = (side: 'in' | 'out') => ({ path: 0, node: 1, side });

  it('liscio: l\'opposta si allinea e tiene la propria lunghezza', () => {
    const moved = moveHandle(at('smooth', [-2, 0], [4, 0]), ref('out'), [10, 5], false);
    expect(moved[0].nodes[1].out).toEqual([0, 5]);
    // Opposta alla maniglia mossa, lunga 2 come prima
    expect(moved[0].nodes[1].in?.[0]).toBeCloseTo(0, 12);
    expect(moved[0].nodes[1].in?.[1]).toBeCloseTo(-2, 12);
    expect(moved[0].nodes[1].kind).toBe('smooth');
  });

  it('liscio: un\'opposta assente (ritirata dall\'utente) resta assente', () => {
    const moved = moveHandle(at('smooth', undefined, [4, 0]), ref('out'), [13, 3], false);
    expect(moved[0].nodes[1].out).toEqual([3, 3]);
    expect(moved[0].nodes[1]).not.toHaveProperty('in');
  });

  it('simmetrico: l\'opposta è uguale e contraria', () => {
    const moved = moveHandle(at('symmetric', [-4, 0], [4, 0]), ref('in'), [7, 2], false);
    expect(moved[0].nodes[1].in).toEqual([-3, 2]);
    expect(moved[0].nodes[1].out).toEqual([3, -2]);
  });

  it('spigolo: l\'altra non si tocca', () => {
    const moved = moveHandle(at('corner', [-4, 0], [4, 0]), ref('out'), [10, 9], false);
    expect(moved[0].nodes[1].out).toEqual([0, 9]);
    expect(moved[0].nodes[1].in).toEqual([-4, 0]);
  });

  it('Alt (breakTangent): il nodo diventa spigolo e l\'altra maniglia resta', () => {
    const moved = moveHandle(at('symmetric', [-4, 0], [4, 0]), ref('out'), [10, 9], true);
    expect(moved[0].nodes[1]).toEqual({ p: [10, 0], in: [-4, 0], out: [0, 9], kind: 'corner' });
  });

  it('Alt momentaneo: dallo stato congelato è spigolo, dallo stato di partenza il tipo torna quello di prima', () => {
    const base = at('symmetric', [-4, 0], [4, 0]);
    // Prima di Alt la maniglia è stata trascinata e l'opposta l'ha seguita
    const before = moveHandle(base, ref('out'), [13, 3], false);
    expect(before[0].nodes[1].in).toEqual([-3, -3]);
    // Alt premuto: si parte da lì, l'opposta resta dov'era
    const alt = moveHandle(before, ref('out'), [10, 9], true);
    expect(alt[0].nodes[1]).toEqual({ p: [10, 0], in: [-3, -3], out: [0, 9], kind: 'corner' });
    // Alt rilasciato: dallo stato di partenza il nodo è di nuovo simmetrico
    const released = moveHandle(base, ref('out'), [10, 9], false);
    expect(released[0].nodes[1]).toEqual({ p: [10, 0], in: [0, -9], out: [0, 9], kind: 'symmetric' });
  });

  it('una maniglia portata sul nodo sparisce (niente [0, 0])', () => {
    const moved = moveHandle(at('corner', [-4, 0], [4, 0]), ref('out'), [10, 0], false);
    expect(moved[0].nodes[1]).not.toHaveProperty('out');
    // Su un nodo simmetrico sparisce anche l'opposta
    const sym = moveHandle(at('symmetric', [-4, 0], [4, 0]), ref('out'), [10, 0], false);
    expect(sym[0].nodes[1]).toEqual({ p: [10, 0], kind: 'symmetric' });
  });

  it('un riferimento inesistente non cambia nulla', () => {
    const paths = at('corner');
    expect(moveHandle(paths, { path: 5, node: 0, side: 'out' }, [1, 1], false)).toBe(paths);
  });
});

describe('setNodeKind e cycleKind', () => {
  it('il ciclo è spigolo, liscio, simmetrico, spigolo', () => {
    expect(cycleKind('corner')).toBe('smooth');
    expect(cycleKind('smooth')).toBe('symmetric');
    expect(cycleKind('symmetric')).toBe('corner');
  });

  it('da spigolo senza maniglie nascono due maniglie lungo la tangente dei vicini, un terzo della distanza minore', () => {
    const paths = freeze([{ closed: true, nodes: [node([0, 0]), node([10, 0]), node([10, 20])] }]);
    // Il nodo 0 ha per vicini l'ultimo (10, 20) e il successivo (10, 0): tangente verticale verso il basso
    const out = setNodeKind(paths, { path: 0, node: 0 }, 'smooth')[0].nodes[0];
    expect(out.kind).toBe('smooth');
    expect(out.out?.[0]).toBeCloseTo(0, 12);
    expect(out.out?.[1]).toBeCloseTo(-(10 / 3), 12);
    expect(out.in?.[1]).toBeCloseTo(10 / 3, 12);
  });

  it('verso spigolo cambia solo il tipo: le maniglie restano', () => {
    const paths = freeze([circle()]);
    const corner = setNodeKind(paths, { path: 0, node: 0 }, 'corner')[0].nodes[0];
    expect(corner).toEqual({ ...paths[0].nodes[0], kind: 'corner' });
  });

  it('con una sola maniglia l\'altra è la sua opposta; con due, verso liscio, si allinea tenendo la propria lunghezza', () => {
    const one = freeze([{ closed: false, nodes: [node([0, 0]), node([10, 0], [3, 0]), node([20, 0])] }]);
    expect(setNodeKind(one, { path: 0, node: 1 }, 'symmetric')[0].nodes[1].in).toEqual([-3, 0]);
    const two = freeze([{ closed: false, nodes: [node([0, 0]), node([10, 0], [0, 4], [-1, -1]), node([20, 0])] }]);
    const smooth = setNodeKind(two, { path: 0, node: 1 }, 'smooth')[0].nodes[1];
    expect(smooth.out).toEqual([0, 4]);
    expect(smooth.in?.[0]).toBeCloseTo(0, 12);
    expect(smooth.in?.[1]).toBeCloseTo(-Math.SQRT2, 12);
    // Verso simmetrico diventa l'opposta esatta
    expect(setNodeKind(two, { path: 0, node: 1 }, 'symmetric')[0].nodes[1].in).toEqual([0, -4]);
  });

  it('un nodo solo, senza vicini, cambia il tipo senza inventare maniglie', () => {
    const lone = freeze([{ closed: false, nodes: [node([5, 5])] }]);
    expect(setNodeKind(lone, { path: 0, node: 0 }, 'smooth')[0].nodes[0]).toEqual({ p: [5, 5], kind: 'smooth' });
  });
});

describe('insertNode', () => {
  /** Verifica che due metà descrivano la stessa curva dell'originale: left(u) = C(u t), right(u) = C(t + u (1 - t)). */
  function expectSameCurve(before: PathContour, after: PathContour, segment: number, t: number) {
    const original = segmentOf(before, segment).cubic;
    const left = segmentOf(after, segment).cubic;
    const right = segmentOf(after, segment + 1).cubic;
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      const [a, b] = [cubicPoint(left, u), cubicPoint(original, u * t)];
      const [c, d] = [cubicPoint(right, u), cubicPoint(original, t + u * (1 - t))];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-9);
      expect(Math.hypot(c[0] - d[0], c[1] - d[1])).toBeLessThan(1e-9);
    }
  }

  it('sulla curva non cambia la forma (le due metà coincidono con l\'originale a 1e-9) e il nodo nuovo è liscio', () => {
    const paths = freeze([circle()]);
    const result = insertNode(paths, { path: 0, segment: 0 }, 0.3);
    expect(result?.node).toEqual({ path: 0, node: 1 });
    const after = result!.paths[0];
    expect(after.nodes).toHaveLength(5);
    expect(after.nodes[1].kind).toBe('smooth');
    expectSameCurve(paths[0], after, 0, 0.3);
    // Gli estremi simmetrici hanno una maniglia accorciata: diventano lisci, gli altri nodi non cambiano
    expect(after.nodes[0].kind).toBe('smooth');
    expect(after.nodes[2].kind).toBe('smooth');
    expect(after.nodes[3]).toBe(paths[0].nodes[2]);
  });

  it('l\'ultimo segmento di un contorno chiuso aggiunge il nodo in fondo', () => {
    const paths = freeze([circle()]);
    const result = insertNode(paths, { path: 0, segment: 3 }, 0.6);
    expect(result?.node).toEqual({ path: 0, node: 4 });
    const after = result!.paths[0];
    expect(after.nodes).toHaveLength(5);
    const original = segmentOf(paths[0], 3).cubic;
    const left = segmentOf(after, 3).cubic;
    const p = cubicPoint(left, 1);
    const q = cubicPoint(original, 0.6);
    expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-9);
  });

  it('su un segmento retto nasce uno spigolo senza maniglie sulla retta', () => {
    const paths = freeze([square()]);
    const result = insertNode(paths, { path: 0, segment: 1 }, 0.25);
    expect(result!.paths[0].nodes[2]).toEqual({ p: [20, 5], kind: 'corner' });
    expect(result!.paths[0].nodes[1]).toBe(paths[0].nodes[1]);
  });

  it('segmento con una sola maniglia: la forma resta la stessa', () => {
    const half: PathContour = { closed: false, nodes: [node([0, 0], [0, 10]), node([20, 0])] };
    const result = insertNode(freeze([half]), { path: 0, segment: 0 }, 0.5);
    expectSameCurve(half, result!.paths[0], 0, 0.5);
  });

  it('rifiuta t fuori da (0, 1), segmenti inesistenti e il segmento di un contorno aperto che non c\'è', () => {
    const paths = freeze([{ closed: false, nodes: [node([0, 0]), node([10, 0])] }]);
    expect(insertNode(paths, { path: 0, segment: 0 }, 0)).toBeNull();
    expect(insertNode(paths, { path: 0, segment: 0 }, 1)).toBeNull();
    expect(insertNode(paths, { path: 0, segment: 1 }, 0.5)).toBeNull();
    expect(insertNode(paths, { path: 3, segment: 0 }, 0.5)).toBeNull();
  });

  it('il campionamento della curva resta entro la tolleranza dopo l\'inserimento', () => {
    const before = freeze([circle()]);
    const after = insertNode(before, { path: 0, segment: 1 }, 0.5)!.paths;
    // Gli estremi in x e y sono quelli di prima (le due metà descrivono la stessa curva: vedi expectSameCurve)
    expect(pathNaturalSize({ paths: after }).width).toBeCloseTo(pathNaturalSize({ paths: before }).width, 9);
    expect(pathNaturalSize({ paths: after }).depth).toBeCloseTo(pathNaturalSize({ paths: before }).depth, 9);
  });
});

describe('deleteNodes', () => {
  it('toglie i nodi indicati, anche di contorni diversi, nell\'ordine giusto', () => {
    const paths = freeze([square(), circle()]);
    const result = deleteNodes(paths, [{ path: 0, node: 0 }, { path: 0, node: 2 }, { path: 1, node: 3 }]);
    expect(result[0].nodes.map((n) => n.p)).toEqual([[20, 0], [0, 20]]);
    expect(result[1].nodes).toHaveLength(3);
  });

  it('un contorno che resta con meno di 2 nodi sparisce', () => {
    const paths = freeze([{ closed: false, nodes: [node([0, 0]), node([5, 5])] }, square()]);
    const result = deleteNodes(paths, [{ path: 0, node: 1 }]);
    expect(result).toHaveLength(1);
    expect(result[0].nodes).toHaveLength(4);
  });
});

describe('nearestSegment e closeContour', () => {
  it('trova il segmento più vicino entro la tolleranza (retto e curvo) con il parametro t', () => {
    const paths = freeze([square(), { closed: false, nodes: [node([50, 0], [0, 50 * K]), node([0, 50], undefined, [50 * K, 0])] }]);
    const straight = nearestSegment(paths, 1, [10, -0.5]);
    expect(straight).toMatchObject({ path: 0, segment: 0 });
    expect(straight!.t).toBeCloseTo(0.5, 6);
    // Il quarto di cerchio di raggio 50 passa per (35.36, 35.36): il punto sulla curva dista meno di 0,01
    const curve = nearestSegment(paths, 1, [50 * Math.SQRT1_2, 50 * Math.SQRT1_2]);
    expect(curve).toMatchObject({ path: 1, segment: 0 });
    expect(curve!.distance).toBeLessThan(0.05);
    expect(curve!.t).toBeCloseTo(0.5, 1);
  });

  it('fuori tolleranza è null e un contorno aperto non ha il segmento di chiusura', () => {
    const open = freeze([{ closed: false, nodes: [node([0, 0]), node([20, 0]), node([20, 20])] }]);
    expect(nearestSegment(open, 1, [10, 10])).toBeNull();
    // Il lato da (20, 20) a (0, 0) non esiste: (10, 10) è lontano da entrambi i segmenti reali
    expect(nearestSegment(freeze([square()]), 1, [10, 10])).toBeNull();
    expect(nearestSegment(freeze([square()]), 1, [0, 10])).toMatchObject({ segment: 3 });
  });

  it('closeContour chiude solo un contorno aperto con almeno 2 nodi', () => {
    const open = freeze([{ closed: false, nodes: [node([0, 0]), node([5, 5]), node([9, 1])] }, { closed: false, nodes: [node([0, 0])] }]);
    expect(closeContour(open, 0)[0].closed).toBe(true);
    expect(closeContour(open, 1)).toBe(open);
    const closed = freeze([square()]);
    expect(closeContour(closed, 0)).toBe(closed);
    expect(closeContour(open, 7)).toBe(open);
  });
});

describe('appendPenNode', () => {
  it('senza contorno attivo ne inizia uno; con il contorno attivo aggiunge in fondo', () => {
    const first = appendPenNode(freeze([square()]), null, [1, 2])!;
    expect(first.current).toBe(1);
    expect(first.paths[1]).toEqual({ closed: false, nodes: [{ p: [1, 2], kind: 'corner' }] });
    const second = appendPenNode(freeze(first.paths), first.current, [3, 4])!;
    expect(second.paths[1].nodes.map((n) => n.p)).toEqual([[1, 2], [3, 4]]);
    expect(second.node).toEqual({ path: 1, node: 1 });
  });

  it('clic e trascina: nodo simmetrico con le maniglie opposte', () => {
    const result = appendPenNode(freeze([]), null, [5, 5], [3, 1])!;
    expect(result.paths[0].nodes[0]).toEqual({ p: [5, 5], in: [-3, -1], out: [3, 1], kind: 'symmetric' });
    // Un trascinamento nullo è un clic
    expect(appendPenNode(freeze([]), null, [5, 5], [0, 0])!.paths[0].nodes[0]).toEqual({ p: [5, 5], kind: 'corner' });
  });

  it('con `corner` (Alt) il nodo è uno spigolo: out segue il trascinamento, in è quella conservata', () => {
    const kept = appendPenNode(freeze([]), null, [5, 5], [3, 1], { keepIn: [-2, 0] })!;
    expect(kept.paths[0].nodes[0]).toEqual({ p: [5, 5], in: [-2, 0], out: [3, 1], kind: 'corner' });
    // Alt premuto prima del nodo: solo la maniglia out
    expect(appendPenNode(freeze([]), null, [5, 5], [3, 1], {})!.paths[0].nodes[0]).toEqual({ p: [5, 5], out: [3, 1], kind: 'corner' });
    // Senza trascinamento né maniglia conservata è un normale spigolo
    expect(appendPenNode(freeze([]), null, [5, 5], undefined, {})!.paths[0].nodes[0]).toEqual({ p: [5, 5], kind: 'corner' });
    // Lo stesso punto senza `corner` torna simmetrico
    expect(appendPenNode(freeze([]), null, [5, 5], [3, 1])!.paths[0].nodes[0].kind).toBe('symmetric');
  });

  it('un contorno chiuso come attivo ne fa iniziare uno nuovo', () => {
    const result = appendPenNode(freeze([square()]), 0, [1, 1])!;
    expect(result.current).toBe(1);
    expect(result.paths).toHaveLength(2);
  });

  it('oltre 500 nodi o 100 contorni si ferma (null)', () => {
    const full: PathContour = { closed: false, nodes: Array.from({ length: 500 }, (_, i): PathNode => ({ p: [i, 0], kind: 'corner' })) };
    expect(appendPenNode([full], 0, [1, 1])).toBeNull();
    const many = Array.from({ length: 100 }, () => square());
    expect(appendPenNode(many, null, [1, 1])).toBeNull();
  });
});

describe('bakeScale', () => {
  it('scala nodi e maniglie attorno al centro, che resta fermo', () => {
    const paths = freeze([circle()]);
    const baked = bakeScale(paths, 2, 3, 1, 1);
    expect(baked[0].nodes[0].p).toEqual([19, -2]);
    expect(baked[0].nodes[0].out).toEqual([0, 10 * K * 3]);
    // Il riquadro naturale cresce di sx e sy e il suo centro non si muove
    const [before, after] = [pathNaturalSize({ paths }), pathNaturalSize({ paths: baked })];
    expect(after.width / before.width).toBeCloseTo(2, 9);
    expect(after.depth / before.depth).toBeCloseTo(3, 9);
    // Anche con il centro fuori dall'origine il centro non si muove
    const shifted = moveNodes(paths, paths[0].nodes.map((_, node) => ({ path: 0, node })), [1, 1]);
    const [cb, ca] = [pathCenter({ paths: shifted }), pathCenter({ paths: bakeScale(shifted, 2, 3, 1, 1) })];
    expect(cb).toEqual([1, 1]);
    expect(ca[0]).toBeCloseTo(1, 9);
    expect(ca[1]).toBeCloseTo(1, 9);
  });
});

describe('snapPoint', () => {
  const base = { ortho: false, angle45: false, radius: 1 };

  it('griglia: arrotonda al passo', () => {
    expect(snapPoint([12.4, -7.6], { ...base, grid: 5 })).toEqual([10, -10]);
    expect(snapPoint([12.4, -7.6], base)).toEqual([12.4, -7.6]);
  });

  it('nodo: si aggancia al più vicino entro il raggio, prima della griglia', () => {
    expect(snapPoint([10.4, 3.1], { ...base, grid: 5, nodes: [[10, 3], [30, 30]] })).toEqual([10, 3]);
    // Fuori dal raggio vale la griglia
    expect(snapPoint([12.4, 3.1], { ...base, grid: 5, nodes: [[10, 3]] })).toEqual([10, 5]);
  });

  it('45 gradi: la direzione dal punto precedente diventa un multiplo di 45° e la distanza resta', () => {
    // 21,8° -> 0°
    const flat = snapPoint([10, 4], { ...base, angle45: true, prev: [0, 0], grid: 5 });
    expect(flat[0]).toBeCloseTo(Math.hypot(10, 4), 9);
    expect(flat[1]).toBeCloseTo(0, 9);
    // 38,7° -> 45°, rispetto a un punto precedente qualunque
    const diagonal = snapPoint([11, 9], { ...base, angle45: true, prev: [1, 1] });
    expect(diagonal[0] - 1).toBeCloseTo(diagonal[1] - 1, 9);
    expect(Math.hypot(diagonal[0] - 1, diagonal[1] - 1)).toBeCloseTo(Math.hypot(10, 8), 9);
    // Senza punto precedente non c'è nulla da vincolare
    expect(snapPoint([10, 4], { ...base, angle45: true })).toEqual([10, 4]);
  });

  it('orizzontale e verticale: si allinea al punto precedente solo entro il raggio', () => {
    expect(snapPoint([20.3, 7], { ...base, ortho: true, prev: [20, 0] })).toEqual([20, 7]);
    expect(snapPoint([20.3, 0.4], { ...base, ortho: true, prev: [20, 0] })).toEqual([20, 0]);
    expect(snapPoint([22, 7], { ...base, ortho: true, prev: [20, 0] })).toEqual([22, 7]);
  });
});

describe('gridStep', () => {
  it('si allarga di 5 volte finché le righe distano meno di 10 pixel', () => {
    expect(gridStep(1, 20)).toBe(1);
    expect(gridStep(1, 5)).toBe(5);
    expect(gridStep(0.1, 2)).toBe(12.5);
    expect(gridStep(1, 0.1)).toBe(125);
  });

  it('valori non validi non fanno girare il ciclo all\'infinito', () => {
    expect(gridStep(0, 10)).toBe(0);
    expect(gridStep(1, 0)).toBe(1);
    expect(gridStep(1, NaN)).toBe(1);
  });
});

describe('disegno di un Profilo: apertura', () => {
  const profile = (patch: object = {}) => ({ ...shape2dDefaults('path'), id: 'p', name: 'Profilo', position: [0, 0, 0], paths: freeze([circle()]), ...patch }) as Extract<Shape2DNode, { kind: 'path' }>;

  it('il disegno vuoto parte lineare con i valori iniziali', () => {
    expect(emptyDraft()).toMatchObject({ paths: [], extrusion: 'linear', tolerance: 0.05, twist: 0, scaleTop: 1, revolveAngle: 360, revolveSegments: 64 });
  });

  it('un Profilo alla misura naturale si apre com\'è (stessi contorni)', () => {
    const node = profile({ ...pathNaturalSize({ paths: [circle()] }), height: 7 });
    const draft = draftFromNode(node);
    expect(draft.paths).toBe(node.paths);
    expect(draft.height).toBe(7);
  });

  it('un Profilo ingrandito si apre con la scala incorporata: il disegno ha la misura vera e lo stesso contorno', () => {
    const natural = pathNaturalSize({ paths: [circle()] });
    const node = profile({ width: natural.width * 2, depth: natural.depth * 3 });
    const draft = draftFromNode(node);
    const size = pathNaturalSize(draft);
    expect(size.width).toBeCloseTo(node.width, 9);
    expect(size.depth).toBeCloseTo(node.depth, 9);
    // Al kernel arriva lo stesso ingombro (D2: indipendente dal campionamento) e quasi la stessa area (il campionamento
    // adattivo ricomincia dalla misura vera, quindi i punti non coincidono)
    const baked = { ...node, ...size, paths: draft.paths };
    const [a, b] = [pathContours(node), pathContours(baked)];
    const [boxA, boxB] = [bboxOf(a)!, bboxOf(b)!];
    for (const key of ['minX', 'maxX', 'minY', 'maxY'] as const) expect(boxB[key]).toBeCloseTo(boxA[key], 3);
    expect(Math.abs(signedArea(b[0])) / Math.abs(signedArea(a[0]))).toBeCloseTo(1, 2);
  });

  it('con una misura legata a un parametro non si incorpora nulla', () => {
    const natural = pathNaturalSize({ paths: [circle()] });
    const node = profile({ width: natural.width * 2, depth: natural.depth, exprs: { width: { expr: 'a' } } });
    expect(draftFromNode(node).paths).toBe(node.paths);
  });

  it('un disegno senza larghezza (linea verticale) non produce NaN né infiniti', () => {
    const line = freeze([{ closed: false, nodes: [node([5, 0]), node([5, 10])] }]);
    const draft = draftFromNode(profile({ paths: line, width: 20, depth: 10 }));
    expect(draft.paths).toBe(line);
  });

  it('un Profilo senza contorni si apre vuoto', () => {
    expect(draftFromNode(profile({ paths: [] })).paths).toEqual([]);
    expect(pathCenter({ paths: [] })).toEqual([0, 0]);
  });
});

describe('splitCubic coerente con insertNode', () => {
  it('il nodo inserito sta sulla curva originale', () => {
    const paths = freeze([circle()]);
    const original = segmentOf(paths[0], 0).cubic;
    const [left] = splitCubic(original, 0.4);
    const inserted = insertNode(paths, { path: 0, segment: 0 }, 0.4)!.paths[0].nodes[1].p;
    expect(inserted).toEqual(left[3]);
  });
});

describe('draftContours', () => {
  it('sono i poligoni del kernel nelle coordinate del disegno: il cerchio resta dov\'è disegnato', () => {
    const shifted = moveNodes([circle()], [0, 1, 2, 3].map((node) => ({ path: 0, node })), [30, 5]);
    const [contour] = draftContours({ ...emptyDraft(), paths: shifted });
    const box = bboxOf([contour])!;
    expect(box.minX).toBeCloseTo(20, 3);
    expect(box.maxX).toBeCloseTo(40, 3);
    expect(box.minY).toBeCloseTo(-5, 3);
    expect(box.maxY).toBeCloseTo(15, 3);
  });

  it('un contorno aperto in rotazione si chiude sull\'asse (x = 0), in lineare no', () => {
    const open: PathContour = { closed: false, nodes: [node([10, 0]), node([12, 5]), node([10, 10])] };
    const rotated = draftContours({ ...emptyDraft(), paths: [open], extrusion: 'rotate' });
    expect(rotated).toHaveLength(1);
    expect(rotated[0].some(([x]) => Math.abs(x) < 1e-3)).toBe(true);
    const linear = draftContours({ ...emptyDraft(), paths: [open] });
    expect(linear[0].every(([x]) => x > 9)).toBe(true);
  });

  it('un disegno senza area (linea verticale) o vuoto non ha poligoni', () => {
    expect(draftContours({ ...emptyDraft(), paths: [{ closed: false, nodes: [node([5, 0]), node([5, 10])] }], extrusion: 'rotate' })).toEqual([]);
    expect(draftContours(emptyDraft())).toEqual([]);
  });
});

describe('dropLastNode e trimDuplicateTail', () => {
  it('toglie l\'ultimo nodo; con un nodo solo il contorno sparisce', () => {
    const paths = freeze([square(), { closed: false, nodes: [node([1, 1]), node([2, 2])] }]);
    const result = dropLastNode(paths, 1);
    expect(result[1].nodes).toEqual([node([1, 1])]);
    expect(result[0]).toBe(paths[0]);
    expect(dropLastNode(result, 1)).toHaveLength(1);
    expect(dropLastNode(paths, 9)).toBe(paths);
  });

  it('il nodo doppio finale (doppio clic) si toglie, uno distinto no', () => {
    const doubled = freeze([{ closed: false, nodes: [node([1, 1]), node([5, 5]), node([5, 5])] }]);
    expect(trimDuplicateTail(doubled, 0)[0].nodes).toHaveLength(2);
    const distinct = freeze([{ closed: false, nodes: [node([1, 1]), node([5, 5])] }]);
    expect(trimDuplicateTail(distinct, 0)).toBe(distinct);
  });
});

describe('riprendere e unire i contorni aperti', () => {
  const open = (x0: number): PathContour => ({
    closed: false,
    nodes: [{ p: [x0, 0], out: [1, 1], kind: 'smooth', in: [-1, -1] }, { p: [x0 + 5, 0], kind: 'corner' }, { p: [x0 + 10, 0], in: [-2, 0], kind: 'corner' }],
  });

  it('isOpenEnd: solo il primo e l\'ultimo nodo di un contorno aperto', () => {
    const paths = freeze([open(0), square()]);
    expect(isOpenEnd(paths, { path: 0, node: 0 })).toBe(true);
    expect(isOpenEnd(paths, { path: 0, node: 2 })).toBe(true);
    expect(isOpenEnd(paths, { path: 0, node: 1 })).toBe(false);
    expect(isOpenEnd(paths, { path: 1, node: 0 })).toBe(false);
    expect(isOpenEnd(paths, { path: 5, node: 0 })).toBe(false);
  });

  it('resumeContour: dall\'ultimo nodo non cambia nulla, dal primo il contorno si inverte con le maniglie scambiate', () => {
    const paths = freeze([open(0)]);
    const last = resumeContour(paths, { path: 0, node: 2 })!;
    expect(last.paths).toBe(paths);
    expect(last.current).toBe(0);
    const first = resumeContour(paths, { path: 0, node: 0 })!;
    expect(first.paths[0].nodes.map((n) => n.p)).toEqual([[10, 0], [5, 0], [0, 0]]);
    expect(first.paths[0].nodes[0]).toEqual({ p: [10, 0], out: [-2, 0], kind: 'corner' });
    expect(first.paths[0].nodes[2]).toEqual({ p: [0, 0], in: [1, 1], out: [-1, -1], kind: 'smooth' });
    expect(resumeContour(paths, { path: 0, node: 1 })).toBeNull();
    expect(resumeContour(freeze([square()]), { path: 0, node: 0 })).toBeNull();
  });

  it('joinContours: accoda i nodi dell\'altro contorno dall\'estremo cliccato e toglie il secondo', () => {
    const paths = freeze([open(0), open(100)]);
    const fromFirst = joinContours(paths, 0, { path: 1, node: 0 })!;
    expect(fromFirst.paths).toHaveLength(1);
    expect(fromFirst.current).toBe(0);
    expect(fromFirst.paths[0].nodes.map((n) => n.p[0])).toEqual([0, 5, 10, 100, 105, 110]);
    const fromLast = joinContours(paths, 0, { path: 1, node: 2 })!;
    expect(fromLast.paths[0].nodes.map((n) => n.p[0])).toEqual([0, 5, 10, 110, 105, 100]);
  });

  it('joinContours: l\'indice si aggiorna se il contorno unito veniva prima; rifiuta nodi interni, contorni chiusi, se stesso e il limite', () => {
    const paths = freeze([open(100), open(0)]);
    expect(joinContours(paths, 1, { path: 0, node: 0 })!.current).toBe(0);
    expect(joinContours(paths, 0, { path: 1, node: 1 })).toBeNull();
    expect(joinContours(paths, 0, { path: 0, node: 0 })).toBeNull();
    expect(joinContours(freeze([open(0), square()]), 0, { path: 1, node: 0 })).toBeNull();
    const big: PathContour = { closed: false, nodes: Array.from({ length: 499 }, (_, i): PathNode => ({ p: [i, 0], kind: 'corner' })) };
    expect(joinContours([big, open(0)], 0, { path: 1, node: 0 })).toBeNull();
  });
});

describe('contourContains', () => {
  it('dentro e fuori un quadrato', () => {
    expect(contourContains(square(), [5, 5])).toBe(true);
    expect(contourContains(square(), [-1, 5])).toBe(false);
    expect(contourContains(square(), [5, 50])).toBe(false);
  });

  it('un contorno curvo: dentro il cerchio sì, nell\'angolo del suo riquadro no', () => {
    expect(contourContains(circle(), [0, 0])).toBe(true);
    expect(contourContains(circle(), [9.5, 0])).toBe(true);
    expect(contourContains(circle(), [8, 8])).toBe(false);
  });

  it('un contorno aperto si chiude con un tratto retto; meno di 3 nodi non hanno area', () => {
    const open: PathContour = { closed: false, nodes: [{ p: [0, 0], kind: 'corner' }, { p: [10, 0], kind: 'corner' }, { p: [10, 10], kind: 'corner' }] };
    expect(contourContains(open, [8, 2])).toBe(true);
    expect(contourContains(open, [2, 8])).toBe(false);
    expect(contourContains({ closed: false, nodes: open.nodes.slice(0, 2) }, [5, 0])).toBe(false);
  });
});

describe('canCloseContour', () => {
  const two = (a: PathNode, b: PathNode): PathContour => ({ closed: false, nodes: [a, b] });

  it('da tre nodi si chiude sempre; con meno di due mai', () => {
    expect(canCloseContour({ closed: false, nodes: [node([0, 0]), node([5, 0]), node([5, 5])] })).toBe(true);
    expect(canCloseContour({ closed: false, nodes: [node([0, 0])] })).toBe(false);
  });

  it('con due nodi serve almeno un segmento curvo: due rette no, una retta e una curva sì, due curve sì', () => {
    expect(canCloseContour(two(node([0, 0]), node([10, 0])))).toBe(false);
    // Solo la chiusura curva (maniglia in entrata del primo nodo)
    expect(canCloseContour(two(node([0, 0], undefined, [-3, 3]), node([10, 0])))).toBe(true);
    // Due curve (nodi simmetrici)
    expect(canCloseContour(two(node([0, 0], [3, 3], [-3, -3], 'symmetric'), node([10, 0], [3, 3], [-3, -3], 'symmetric')))).toBe(true);
  });
});
