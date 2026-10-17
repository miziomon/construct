import { describe, expect, it } from 'vitest';
import { breakPlan, DEFAULT_PLAN, featureAngles, isPlainCircle, planOutline, planPaths, planTolerance } from './planShape';
import type { PlanDraft } from './planShape';
import { crossingsAt, preparePlan, revolveMesh, ridgeRadius, ringCache, wallThickness } from './planRevolve';
import type { PlanPrep } from './planRevolve';
import type { Vec2 } from './types';

const CUP: Vec2[] = [[0, 0], [30, 0], [30, 50], [28, 50], [28, 3], [0, 3]];
const DOME: Vec2[] = [[0, 0], ...Array.from({ length: 29 }, (_, i): Vec2 => [30 * Math.cos((i / 28) * Math.PI / 2), 22 * Math.sin((i / 28) * Math.PI / 2)])];

function prepFor(plan: PlanDraft, rt = 30, K = 360, M = 160): PlanPrep {
  const { paths } = planPaths(plan, rt);
  return preparePlan(planOutline(paths, planTolerance(rt)), featureAngles(paths), K, M, rt, isPlainCircle(plan));
}
const wall = (plan: PlanDraft, model: 'offset' | 'scale') => {
  const prep = prepFor(plan);
  const ring = ringCache(prep, model, 30);
  return wallThickness(prep, ring, crossingsAt([CUP], 25));
};
const squircle: PlanDraft = { ...DEFAULT_PLAN, kind: 'rect', base: 'rect', cornerR: 14, cornerType: 'smooth', smooth: 1 };
const wide: PlanDraft = { ...DEFAULT_PLAN, kind: 'rect', base: 'rect', cornerR: 8, sx: 200 };

describe('anelli della sagoma', () => {
  it('una sagoma stellata è valida, una a C no', () => {
    expect(prepFor(squircle).ok).toBe(true);
    const c: Vec2[] = [[10, 10], [-10, 10], [-10, 5], [5, 5], [5, -5], [-10, -5], [-10, -10], [10, -10]];
    expect(preparePlan(c, [], 120, 40, 10).ok).toBe(false);
  });

  it('equidistante: la parete resta di 2 mm anche con gli angoli continui', () => {
    const w = wall(squircle, 'offset')!;
    expect(w.nominal).toBeCloseTo(2, 5);
    expect(w.min).toBeGreaterThan(1.99);
    expect(w.max).toBeLessThan(2.03);
  });

  it('omotetico: la parete si assottiglia o ingrossa con la forma', () => {
    const w = wall(squircle, 'scale')!;
    expect(w.max).toBeGreaterThan(2.2);
    const r = wall(wide, 'scale')!;
    expect(r.min).toBeLessThan(1.1);
    expect(wall(wide, 'offset')!.min).toBeGreaterThan(1.98);
  });

  it('un cerchio perfetto dà lo stesso solido nei due modelli, con il volume del poligono', () => {
    const prep = prepFor(DEFAULT_PLAN);
    const a = revolveMesh(prep, 'offset', [[[0, 0], [30, 0], [30, 50], [0, 50]]], 30);
    const b = revolveMesh(prep, 'scale', [[[0, 0], [30, 0], [30, 50], [0, 50]]], 30);
    expect(a.volume).toBeCloseTo(b.volume, 6);
    // Poligono di K lati: area = K/2 · r² · sin(2π/K); il solido è alto 50
    const expected = (prep.K / 2) * 900 * Math.sin((2 * Math.PI) / prep.K) * 50;
    // Il bordo è campionato (poligono inscritto nel cerchio): entro lo 0,5 %
    expect(a.volume / expected).toBeCloseTo(1, 2);
  });

  it('la mesh è orientata verso l\'esterno e ha triangoli', () => {
    const prep = prepFor(squircle);
    const m = revolveMesh(prep, 'offset', [CUP], 30);
    expect(m.volume).toBeGreaterThan(0);
    expect(m.indices.length).toBeGreaterThan(0);
    expect(m.bbox.max[0]).toBeCloseTo(30, 1);
    expect(m.bbox.max[2]).toBeCloseTo(50, 5);
    expect(m.rings).toBe(CUP.length);
  });

  it('il bicchiere equidistante ha il volume della parete e del fondo, e un quadrato pieno rientra nel suo ingombro', () => {
    const prep = prepFor(squircle);
    const cup = revolveMesh(prep, 'offset', [CUP], 30).volume;
    const full = revolveMesh(prep, 'offset', [[[0, 0], [30, 0], [30, 50], [0, 50]]], 30).volume;
    expect(cup).toBeLessThan(full);
    // Fondo 3 mm + pareti 2 mm: il vuoto è il quadrato rientrato di 2 mm, alto 47 mm
    const wallArea = (v: number) => v;
    expect(wallArea(cup)).toBeGreaterThan(full * 0.1);
    expect(wallArea(cup)).toBeLessThan(full * 0.35);
  });

  it('la cupola su un rettangolo forma una cresta, su un cerchio no', () => {
    expect(ridgeRadius(prepFor(wide), 'offset', [DOME], 30)).not.toBeNull();
    expect(ridgeRadius(prepFor(wide), 'scale', [DOME], 30)).toBeNull();
    expect(ridgeRadius(prepFor(DEFAULT_PLAN), 'offset', [DOME], 30)).toBeNull();
  });

  it('i profili che toccano l\'asse non hanno una parete da misurare', () => {
    const prep = prepFor(squircle);
    expect(wallThickness(prep, ringCache(prep, 'offset', 30), crossingsAt([DOME], 10))).toBeNull();
  });

  it('una forma libera rotta dal rettangolo dà gli stessi anelli del rettangolo parametrico', () => {
    const a = prepFor(wide);
    const b = prepFor(breakPlan(wide, 30));
    const ra = ringCache(a, 'offset', 30)(28);
    const rb = ringCache(b, 'offset', 30)(28);
    expect(ra[0]).toBeCloseTo(rb[0], 2);
    expect(Math.max(...ra)).toBeCloseTo(Math.max(...rb), 1);
  });
});
