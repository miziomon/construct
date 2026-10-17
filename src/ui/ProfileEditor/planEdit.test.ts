import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN, halfWidth, planOutline, planPaths } from '../../scene/planShape';
import type { PlanDraft, PlanSym } from '../../scene/planShape';
import type { PathContour, Vec2 } from '../../scene/types';
import { applySymmetry, deletePlanNodes, insertPlanNode, PLAN_MIN_NODES, symmetrizePlan } from './planEdit';
import { moveHandle, moveNodes } from './model';

const sym = (s: PlanSym, patch: Partial<PlanDraft> = {}): PathContour => symmetrizePlan({ ...DEFAULT_PLAN, ...patch }, 30, s).paths[0];
const near = (a: Vec2, b: Vec2, d = 1e-6) => Math.abs(a[0] - b[0]) < d && Math.abs(a[1] - b[1]) < d;
const findAt = (c: PathContour, p: Vec2) => c.nodes.findIndex((n) => near(n.p, p, 1e-4));

describe('contorno simmetrico', () => {
  it('nasce chiuso, con la semi-larghezza del raggio e i nodi speculari', () => {
    for (const s of ['v', 'h', 'q'] as const) {
      const c = sym(s);
      expect(c.closed).toBe(true);
      expect(halfWidth([c], 0.01)).toBeCloseTo(30, 1);
      c.nodes.forEach((n, i) => {
        const mirrorX = findAt(c, [-n.p[0], n.p[1]]);
        const mirrorY = findAt(c, [n.p[0], -n.p[1]]);
        if (s === 'v' || s === 'q') expect(mirrorX, `${s} nodo ${i}`).toBeGreaterThanOrEqual(0);
        if (s === 'h' || s === 'q') expect(mirrorY, `${s} nodo ${i}`).toBeGreaterThanOrEqual(0);
      });
    }
  });

  it('i nodi sugli assi stanno esattamente sugli assi', () => {
    const c = sym('v');
    expect(c.nodes.filter((n) => n.p[0] === 0)).toHaveLength(2);
    const q = sym('q');
    expect(q.nodes.filter((n) => n.p[0] === 0)).toHaveLength(2);
    expect(q.nodes.filter((n) => n.p[1] === 0)).toHaveLength(2);
  });

  it('un cerchio campionato resta quasi un cerchio', () => {
    const area = (pts: Vec2[]) => pts.reduce((a, p, i) => a + (p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1]) / 2, 0);
    const a = area(planOutline([sym('none')], 0.01));
    expect(a / (Math.PI * 900)).toBeGreaterThan(0.99);
    expect(a / (Math.PI * 900)).toBeLessThan(1.01);
  });
});

describe('modifica simmetrica', () => {
  it('spostare un nodo muove anche il suo speculare (simmetria verticale)', () => {
    const c = sym('v');
    const i = c.nodes.findIndex((n) => n.p[0] > 5 && n.p[1] > 5);
    const mirror = findAt(c, [-c.nodes[i].p[0], c.nodes[i].p[1]]);
    expect(mirror).toBeGreaterThanOrEqual(0);
    const moved = moveNodes([c], [{ path: 0, node: i }], [3, 2])[0];
    const out = applySymmetry(c, moved, 'v');
    expect(near(out.nodes[mirror].p, [-out.nodes[i].p[0], out.nodes[i].p[1]])).toBe(true);
    // Le maniglie si scambiano: la entrante dell'uno è la speculare dell'uscente dell'altro
    expect(near(out.nodes[mirror].in!, [-out.nodes[i].out![0], out.nodes[i].out![1]])).toBe(true);
    expect(out.nodes[i].p[0]).toBeCloseTo(c.nodes[i].p[0] + 3, 9);
  });

  it('un nodo sull\'asse resta sull\'asse anche se lo si trascina di lato', () => {
    const c = sym('v');
    const i = c.nodes.findIndex((n) => n.p[0] === 0 && n.p[1] > 0);
    const out = applySymmetry(c, moveNodes([c], [{ path: 0, node: i }], [4, 3])[0], 'v');
    expect(out.nodes[i].p[0]).toBe(0);
    expect(out.nodes[i].p[1]).toBeCloseTo(c.nodes[i].p[1] + 3, 9);
  });

  it('la maniglia di un nodo sull\'asse tiene la tangente perpendicolare e le due maniglie speculari', () => {
    const c = sym('v');
    const i = c.nodes.findIndex((n) => n.p[0] === 0 && n.p[1] > 0);
    const h = moveHandle([c], { path: 0, node: i, side: 'out' }, [c.nodes[i].p[0] - 7, c.nodes[i].p[1] + 5], false)[0];
    const out = applySymmetry(c, h, 'v');
    expect(out.nodes[i].out![1]).toBe(0);
    expect(out.nodes[i].in![0]).toBeCloseTo(-out.nodes[i].out![0], 9);
  });

  it('con quattro quarti un nodo ha tre speculari', () => {
    const c = sym('q');
    const i = c.nodes.findIndex((n) => n.p[0] > 5 && n.p[1] > 5);
    const out = applySymmetry(c, moveNodes([c], [{ path: 0, node: i }], [-2, 1])[0], 'q');
    const [x, y] = out.nodes[i].p;
    for (const p of [[-x, y], [x, -y], [-x, -y]] as Vec2[]) expect(findAt(out, p)).toBeGreaterThanOrEqual(0);
  });

  it('un gruppo spostato con lo stesso vettore resta simmetrico', () => {
    const c = sym('v');
    const both = c.nodes.map((_, node) => ({ path: 0, node })).filter(({ node }) => c.nodes[node].p[1] > 5);
    const out = applySymmetry(c, moveNodes([c], both, [2, 3])[0], 'v');
    out.nodes.forEach((n) => expect(findAt(out, [-n.p[0], n.p[1]])).toBeGreaterThanOrEqual(0));
  });

  it('senza simmetria o con un numero di nodi diverso non cambia nulla', () => {
    const c = sym('none');
    const moved = moveNodes([c], [{ path: 0, node: 1 }], [1, 1])[0];
    expect(applySymmetry(c, moved, 'none')).toBe(moved);
    const sy = sym('v');
    const fewer: PathContour = { ...sy, nodes: sy.nodes.slice(1) };
    expect(applySymmetry(sy, fewer, 'v')).toBe(fewer);
  });
});

describe('eliminazione e inserimento', () => {
  it('togliere un nodo toglie anche lo speculare e la forma resta chiusa', () => {
    const c = sym('v');
    const i = c.nodes.findIndex((n) => n.p[0] > 5 && n.p[1] > 5);
    const out = deletePlanNodes(c, [i], 'v')!;
    expect(out.closed).toBe(true);
    expect(out.nodes).toHaveLength(c.nodes.length - 2);
    out.nodes.forEach((n) => expect(findAt(out, [-n.p[0], n.p[1]])).toBeGreaterThanOrEqual(0));
  });

  it('non scende mai sotto tre nodi', () => {
    let c = planPaths({ ...DEFAULT_PLAN, kind: 'polygon', base: 'polygon', n: 5, cornerR: 0 }, 30).paths[0];
    while (c.nodes.length > PLAN_MIN_NODES) c = deletePlanNodes(c, [0], 'none')!;
    expect(c.nodes).toHaveLength(PLAN_MIN_NODES);
    expect(deletePlanNodes(c, [0], 'none')).toBeNull();
    expect(c.closed).toBe(true);
  });

  it('inserire un nodo senza simmetria ne aggiunge uno solo e non cambia la forma', () => {
    const c = sym('none');
    const out = insertPlanNode(c, 2, 0.4, 'none')!;
    expect(out.contour.nodes).toHaveLength(c.nodes.length + 1);
    expect(out.node).toBe(3);
    const a = planOutline([c], 0.005);
    const b = planOutline([out.contour], 0.005);
    const area = (pts: Vec2[]) => pts.reduce((s, p, k) => s + (p[0] * pts[(k + 1) % pts.length][1] - pts[(k + 1) % pts.length][0] * p[1]) / 2, 0);
    expect(area(b)).toBeCloseTo(area(a), 1);
  });

  it('inserire con la simmetria verticale aggiunge anche lo speculare', () => {
    const c = sym('v');
    const seg = c.nodes.findIndex((n, k) => n.p[0] > 5 && c.nodes[(k + 1) % c.nodes.length].p[0] > 5);
    const out = insertPlanNode(c, seg, 0.5, 'v')!;
    expect(out.contour.nodes).toHaveLength(c.nodes.length + 2);
    const added = out.contour.nodes[out.node];
    expect(findAt(out.contour, [-added.p[0], added.p[1]])).toBeGreaterThanOrEqual(0);
    out.contour.nodes.forEach((n) => expect(findAt(out.contour, [-n.p[0], n.p[1]])).toBeGreaterThanOrEqual(0));
  });

  it('un segmento che attraversa l\'asse riceve un solo nodo a metà e due altrove', () => {
    // Quadrato con simmetria verticale: il lato in alto va da (10, 10) a (-10, 10) ed è speculare di se stesso
    const sq: PathContour = { closed: true, nodes: [[10, 10], [-10, 10], [-10, -10], [10, -10]].map((p) => ({ p: p as Vec2, kind: 'corner' as const })) };
    const mid = insertPlanNode(sq, 0, 0.5, 'v')!;
    expect(mid.contour.nodes).toHaveLength(5);
    expect(findAt(mid.contour, [0, 10])).toBeGreaterThanOrEqual(0);
    const off = insertPlanNode(sq, 0, 0.3, 'v')!;
    expect(off.contour.nodes).toHaveLength(6);
    expect(findAt(off.contour, [4, 10])).toBeGreaterThanOrEqual(0);
    expect(findAt(off.contour, [-4, 10])).toBeGreaterThanOrEqual(0);
    expect(off.contour.closed).toBe(true);
  });
});
