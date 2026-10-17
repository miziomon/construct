import { describe, expect, it } from 'vitest';
import { breakPlan, cleanPlan, DEFAULT_PLAN, featureAngles, halfWidth, isPlainCircle, isValidPlan, normalizeFree, planOutline, planPaths, resetPlan, scalePaths, selectKind } from './planShape';
import type { PlanDraft } from './planShape';

const plan = (patch: Partial<PlanDraft>): PlanDraft => ({ ...DEFAULT_PLAN, ...patch });
const area = (pts: [number, number][]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length];
    a += pts[i][0] * q[1] - q[0] * pts[i][1];
  }
  return a / 2;
};
const box = (pts: [number, number][]) => ({ w: Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), h: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])) });

describe('sagoma parametrica', () => {
  it('il cerchio predefinito ha quattro nodi e il raggio richiesto', () => {
    const { paths } = planPaths(DEFAULT_PLAN, 30);
    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toHaveLength(4);
    expect(halfWidth(paths, 0.01)).toBeCloseTo(30, 1);
    expect(isPlainCircle(DEFAULT_PLAN)).toBe(true);
    // L'area è quella del cerchio (la cubica sbaglia di meno di un millesimo)
    expect(area(planOutline(paths, 0.01))).toBeCloseTo(Math.PI * 900, -1);
  });

  it('scala X e Y fanno un\'ellisse con la semi-larghezza del raggio', () => {
    const { paths } = planPaths(plan({ sx: 100, sy: 60 }), 30);
    const b = box(planOutline(paths, 0.01));
    expect(b.w).toBeCloseTo(60, 1);
    expect(b.h).toBeCloseTo(36, 1);
    expect(isPlainCircle(plan({ sx: 100, sy: 60 }))).toBe(false);
  });

  it('il rettangolo senza raggio è un rettangolo con la larghezza richiesta', () => {
    const { paths } = planPaths(plan({ kind: 'rect', base: 'rect', cornerR: 0, sx: 200, sy: 100 }), 30);
    expect(paths[0].nodes).toHaveLength(4);
    const b = box(planOutline(paths, 0.01));
    expect(b.w).toBeCloseTo(60, 3);
    expect(b.h).toBeCloseTo(30, 3);
  });

  it('con gli angoli arrotondati la larghezza massima resta quella richiesta', () => {
    for (const kind of ['rect', 'polygon', 'star'] as const) {
      const { paths } = planPaths(plan({ kind, base: kind, cornerR: 8, innerR: 3 }), 30);
      expect(halfWidth(paths, 0.005)).toBeCloseTo(30, 1);
    }
  });

  it('l\'angolo continuo toglie più area di quello ad arco, che ne toglie più dell\'angolo vivo', () => {
    const sharp = area(planOutline(planPaths(plan({ kind: 'rect', base: 'rect', cornerR: 0 }), 30).paths, 0.01));
    const arc = area(planOutline(planPaths(plan({ kind: 'rect', base: 'rect', cornerR: 14, cornerType: 'arc' }), 30).paths, 0.01));
    const smooth = area(planOutline(planPaths(plan({ kind: 'rect', base: 'rect', cornerR: 14, cornerType: 'smooth', smooth: 1 }), 30).paths, 0.01));
    // La curva continua parte più lontano dallo spigolo: lo smussa di più a parità di raggio
    expect(smooth).toBeLessThan(arc);
    expect(arc).toBeLessThan(sharp);
  });

  it('un raggio troppo grande per i lati viene ridotto e segnalato', () => {
    const r = planPaths(plan({ kind: 'polygon', base: 'polygon', n: 5, cornerR: 60 }), 30);
    expect(r.limited).toBe(true);
    expect(isValidPlan(r.paths)).toBe(true);
  });

  it('la stella ha i raggi interni con arrotondamento che si allarga', () => {
    const star = plan({ kind: 'star', base: 'star', n: 5, ratio: 0.5, cornerR: 0, innerR: 0 });
    expect(planPaths(star, 30).paths[0].nodes).toHaveLength(10);
    // Cinque punte vive e cinque angoli interni arrotondati (due nodi ciascuno)
    expect(planPaths({ ...star, innerR: 4 }, 30).paths[0].nodes).toHaveLength(15);
  });

  it('gli angoli ampi usano due cubiche e restano vicini a un arco di cerchio', () => {
    // Un triangolo ha angoli di 60°: l'arco da percorrere è di 120°
    const { paths } = planPaths(plan({ kind: 'polygon', base: 'polygon', n: 3, cornerR: 8 }), 30);
    expect(paths[0].nodes.filter((n) => n.kind === 'smooth')).toHaveLength(3);
    expect(paths[0].nodes).toHaveLength(9);
  });
});

describe('forma libera', () => {
  it('rompere la forma conserva i nodi effettivi e Reset torna ai parametri', () => {
    const star = plan({ kind: 'star', base: 'star', n: 5, cornerR: 3, innerR: 2 });
    const broken = breakPlan(star, 30);
    expect(broken.kind).toBe('free');
    expect(broken.base).toBe('star');
    expect(broken.paths).toEqual(planPaths(star, 30).paths);
    expect(broken.refR).toBe(30);
    const back = resetPlan(broken);
    expect(back.kind).toBe('star');
    expect(back.paths).toEqual([]);
    expect(back.n).toBe(5);
  });

  it('cambiando forma e tornando indietro si ritrovano gli ultimi parametri', () => {
    const star = plan({ kind: 'star', base: 'star', n: 7, ratio: 0.4, cornerR: 2, innerR: 5 });
    const hex = selectKind(star, 'polygon', 30);
    expect(hex.kind).toBe('polygon');
    const again = selectKind(hex, 'star', 30);
    expect([again.n, again.ratio, again.cornerR, again.innerR]).toEqual([7, 0.4, 2, 5]);
  });

  it('la forma libera segue il raggio del profilo senza deformarsi', () => {
    const free = breakPlan(plan({ kind: 'rect', base: 'rect', cornerR: 0 }), 30);
    const wider = planPaths(free, 45).paths;
    expect(halfWidth(wider, 0.01)).toBeCloseTo(45, 2);
    // Un quadrato di lato 2·45: resta un quadrato
    expect(box(planOutline(wider, 0.01)).h).toBeCloseTo(90, 2);
  });

  it('normalizeFree riporta la semi-larghezza al raggio', () => {
    const free = breakPlan(plan({ kind: 'rect', base: 'rect', cornerR: 0 }), 30);
    const stretched = scalePaths(free.paths, 1.5);
    const n = normalizeFree(stretched, 30);
    expect(halfWidth(n.paths, 0.01)).toBeCloseTo(30, 2);
    expect(n.refR).toBe(30);
  });

  it('gli angoli dei nodi servono ai raggi della mesh', () => {
    const angles = featureAngles(planPaths(plan({ kind: 'rect', base: 'rect', cornerR: 0 }), 30).paths);
    expect(angles).toHaveLength(4);
    angles.forEach((a) => expect(a).toBeGreaterThanOrEqual(0));
  });
});

describe('dati non fidati', () => {
  it('cleanPlan riporta ai limiti e scarta i valori sbagliati', () => {
    const c = cleanPlan({ kind: 'dado' as never, n: 99, sx: 5000, ratio: NaN as never, model: 'scale', paths: 'x' as never });
    expect(c.kind).toBe('circle');
    expect(c.n).toBe(16);
    expect(c.sx).toBe(200);
    expect(c.ratio).toBe(DEFAULT_PLAN.ratio);
    expect(c.model).toBe('scale');
    expect(c.paths).toEqual([]);
  });
});
