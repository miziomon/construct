import { describe, expect, it } from 'vitest';
import { BAR_KINDS, clampProfile, maxRootRadius, maxTipSize, PROFILE_KINDS, profileArea, profileContours, thicknessAxes, type BarShape, type ProfileShape } from './profiles';
import { shape2dDefaults } from './defaults';
import type { ProfileKind } from './types';

const profile = <K extends ProfileKind>(kind: K, patch: Partial<Extract<ProfileShape, { kind: K }>> = {}): Extract<ProfileShape, { kind: K }> =>
  ({ ...shape2dDefaults(kind), id: 'p', name: 'p', position: [0, 0, 0], ...patch }) as Extract<ProfileShape, { kind: K }>;

const bar = (kind: BarShape['kind'], patch: Partial<BarShape> = {}): BarShape => ({ ...shape2dDefaults(kind), id: 'p', name: 'p', position: [0, 0, 0], ...patch }) as BarShape;

/** Area con segno (positiva se antiorario). */
const area = (c: [number, number][]) => c.reduce((sum, [x, y], i) => sum + (x * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * y), 0) / 2;

const bounds = (contours: [number, number][][]) => {
  const all = contours.flat();
  return {
    minX: Math.min(...all.map((p) => p[0])),
    maxX: Math.max(...all.map((p) => p[0])),
    minY: Math.min(...all.map((p) => p[1])),
    maxY: Math.max(...all.map((p) => p[1])),
  };
};

/** Punto dentro il poligono: regola pari-dispari sul raggio orizzontale. */
const inside = (c: [number, number][], x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const [xi, yi] = c[i];
    const [xj, yj] = c[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

describe('profilati con ali e anima', () => {
  it.each(BAR_KINDS)('%s: un contorno antiorario con ingombro width × depth centrato nell\'origine', (kind) => {
    const contours = profileContours(bar(kind, { width: 30, depth: 18, flange: 2, web: 3 }));
    expect(contours).toHaveLength(1);
    const b = bounds(contours);
    expect(b.maxX - b.minX).toBeCloseTo(30, 4);
    expect(b.maxY - b.minY).toBeCloseTo(18, 4);
    expect((b.maxX + b.minX) / 2).toBeCloseTo(0, 4);
    expect((b.maxY + b.minY) / 2).toBeCloseTo(0, 4);
    expect(area(contours[0])).toBeGreaterThan(0);
  });

  it('numero di vertici e area esatta senza raccordo', () => {
    const dims = { width: 30, depth: 20, flange: 2, web: 3 };
    const l = profileContours(bar('profileL', dims))[0];
    expect(l).toHaveLength(6);
    // Ala orizzontale 30 × 2 più ala verticale (20 − 2) × 3
    expect(area(l)).toBeCloseTo(30 * 2 + 18 * 3, 6);
    const t = profileContours(bar('profileT', dims))[0];
    expect(t).toHaveLength(8);
    expect(area(t)).toBeCloseTo(30 * 2 + 18 * 3, 6);
    const h = profileContours(bar('profileH', dims))[0];
    expect(h).toHaveLength(12);
    // Due ali verticali 20 × 2 più anima (30 − 4) × 3
    expect(area(h)).toBeCloseTo(2 * 20 * 2 + 26 * 3, 6);
    const u = profileContours(bar('profileU', dims))[0];
    expect(u).toHaveLength(8);
    // Fondo 30 × 3 più due ali (20 − 3) × 2
    expect(area(u)).toBeCloseTo(30 * 3 + 2 * 17 * 2, 6);
    for (const kind of BAR_KINDS) expect(area(profileContours(bar(kind, dims))[0])).toBeCloseTo(profileArea(bar(kind, dims)), 6);
  });

  it('la L ha l\'angolo esterno in basso a sinistra, la T l\'ala in cima, la H le ali ai lati, la U il fondo in basso', () => {
    const l = profileContours(bar('profileL'))[0];
    expect(inside(l, -9, -9)).toBe(true);
    expect(inside(l, 9, 9)).toBe(false);
    const t = profileContours(bar('profileT'))[0];
    expect(inside(t, 9, 9)).toBe(true);
    expect(inside(t, 0, -9)).toBe(true);
    expect(inside(t, 9, -9)).toBe(false);
    const h = profileContours(bar('profileH'))[0];
    expect(inside(h, -9, 9)).toBe(true);
    expect(inside(h, 0, 0)).toBe(true);
    expect(inside(h, 0, 9)).toBe(false);
    const u = profileContours(bar('profileU'))[0];
    expect(inside(u, 0, -9)).toBe(true);
    expect(inside(u, -9, 9)).toBe(true);
    expect(inside(u, 0, 0)).toBe(false);
  });

  it('raccordo interno: aggiunge materiale negli angoli concavi (circa (1 − π/4)·r² ciascuno) e l\'ingombro non cambia', () => {
    const corners = { profileL: 1, profileT: 2, profileH: 4, profileU: 2 } as const;
    for (const kind of BAR_KINDS) {
      const sharp = profileContours(bar(kind, { width: 30, depth: 20, flange: 2, web: 3 }))[0];
      const rounded = profileContours(bar(kind, { width: 30, depth: 20, flange: 2, web: 3, rootRadius: 2 }))[0];
      const b = bounds([rounded]);
      expect(b.maxX - b.minX).toBeCloseTo(30, 4);
      expect(b.maxY - b.minY).toBeCloseTo(20, 4);
      // L'arco è un poligono inscritto: toglie un po' meno aria del cerchio vero, quindi aggiunge un po' più materiale
      const added = area(rounded) - area(sharp);
      const ideal = corners[kind] * (1 - Math.PI / 4) * 4;
      expect(added).toBeGreaterThanOrEqual(ideal - 1e-6);
      expect(added).toBeLessThan(ideal * 1.1);
      // Ogni angolo concavo diventa 9 punti al posto di 1
      expect(rounded).toHaveLength(sharp.length + corners[kind] * 8);
    }
  });

  it('punte: lo smusso toglie s²/2 per punta, il raccordo circa (1 − π/4)·s², l\'ingombro non cambia', () => {
    const tips = { profileL: 4, profileT: 6, profileH: 8, profileU: 4 } as const;
    const dims = { width: 30, depth: 20, flange: 4, web: 4 };
    for (const kind of BAR_KINDS) {
      const sharp = profileContours(bar(kind, dims))[0];
      const chamfered = profileContours(bar(kind, { ...dims, tipSize: 1, tipStyle: 'chamfer' }))[0];
      expect(area(sharp) - area(chamfered)).toBeCloseTo(tips[kind] * 0.5, 6);
      expect(chamfered).toHaveLength(sharp.length + tips[kind]);
      const rounded = profileContours(bar(kind, { ...dims, tipSize: 1 }))[0];
      const removed = area(sharp) - area(rounded);
      const ideal = tips[kind] * (1 - Math.PI / 4);
      // L'arco è un poligono inscritto nel cerchio: resta un po' meno materiale del raccordo ideale
      expect(removed).toBeGreaterThanOrEqual(ideal - 1e-6);
      expect(removed).toBeLessThan(ideal * 1.1);
      expect(rounded).toHaveLength(sharp.length + tips[kind] * 8);
      const b = bounds([rounded]);
      expect(b.maxX - b.minX).toBeCloseTo(30, 4);
      expect(b.maxY - b.minY).toBeCloseTo(20, 4);
      // Punte e raccordo interno insieme: contorno ancora valido (area positiva)
      expect(area(profileContours(bar(kind, { ...dims, tipSize: 1, rootRadius: 2 }))[0])).toBeGreaterThan(0);
    }
  });

  it('maxTipSize: metà dello spessore più sottile, e non oltre la parte dritta libera accanto al raccordo interno', () => {
    expect(maxTipSize(bar('profileL', { width: 30, depth: 20, flange: 4, web: 6 }))).toBeCloseTo(1.99, 3);
    // Raccordo interno grande: resta poca parte dritta (L: min(w − t, d − f) − r = 14 − 0,01 − 13)
    expect(maxTipSize(bar('profileL', { width: 30, depth: 20, flange: 6, web: 16, rootRadius: 13 }))).toBeCloseTo(0.99, 3);
    expect(clampProfile(bar('profileT', { width: 30, depth: 20, flange: 4, web: 4, tipSize: 50 })).tipSize).toBeCloseTo(1.99, 3);
  });

  it('clampProfile: spessori dentro l\'ingombro e raccordo entro il massimo', () => {
    const l = clampProfile(bar('profileL', { width: 20, depth: 10, flange: 50, web: 50, rootRadius: 99 }));
    expect(l.flange).toBeCloseTo(9.9, 6);
    expect(l.web).toBeCloseTo(19.9, 6);
    // Resta 0,1 mm di parte dritta per lato: il raccordo si ferma poco sotto
    expect(l.rootRadius).toBeCloseTo(0.09, 6);
    const h = clampProfile(bar('profileH', { width: 20, depth: 10, flange: 50, web: 50 }));
    // Due ali dentro la larghezza, anima dentro la profondità
    expect(h.flange).toBeCloseTo(9.95, 6);
    expect(h.web).toBeCloseTo(9.9, 6);
    const ok = clampProfile(bar('profileT', { width: 20, depth: 20, flange: 3, web: 3, rootRadius: 2 }));
    expect(ok).toMatchObject({ flange: 3, web: 3, rootRadius: 2 });
  });

  it('maxRootRadius: la parte dritta più corta vicino agli angoli concavi', () => {
    expect(maxRootRadius(bar('profileL', { width: 20, depth: 12, flange: 2, web: 4 }))).toBeCloseTo(10 - 0.01, 3);
    expect(maxRootRadius(bar('profileT', { width: 20, depth: 12, flange: 2, web: 4 }))).toBeCloseTo(8 - 0.01, 3);
    expect(maxRootRadius(bar('profileH', { width: 20, depth: 12, flange: 2, web: 4 }))).toBeCloseTo(4 - 0.01, 3);
    expect(maxRootRadius(bar('profileU', { width: 20, depth: 12, flange: 2, web: 4 }))).toBeCloseTo(8 - 0.01, 3);
  });

  it('thicknessAxes: nella H e nella U le ali si misurano lungo X, nelle altre lungo Y', () => {
    expect(thicknessAxes('profileH')).toEqual({ flange: 0, web: 1 });
    expect(thicknessAxes('profileU')).toEqual({ flange: 0, web: 1 });
    expect(thicknessAxes('profileL')).toEqual({ flange: 1, web: 0 });
    expect(thicknessAxes('profileT')).toEqual({ flange: 1, web: 0 });
  });
});

describe('tubolari', () => {
  it('rettangolare: esterno antiorario, foro orario, area esatta, angoli arrotondati che non cambiano l\'ingombro', () => {
    const sharp = profileContours(profile('tubeRect', { width: 30, depth: 20, wall: 2 }));
    expect(sharp).toHaveLength(2);
    expect(sharp[0]).toHaveLength(4);
    expect(sharp[1]).toHaveLength(4);
    expect(area(sharp[0])).toBeGreaterThan(0);
    expect(area(sharp[1])).toBeLessThan(0);
    expect(area(sharp[0]) + area(sharp[1])).toBeCloseTo(30 * 20 - 26 * 16, 6);
    expect(profileArea(profile('tubeRect', { width: 30, depth: 20, wall: 2 }))).toBeCloseTo(30 * 20 - 26 * 16, 6);
    const b = bounds(sharp);
    expect(b.maxX - b.minX).toBeCloseTo(30, 4);
    expect(b.maxY - b.minY).toBeCloseTo(20, 4);
    // Il foro è 26 × 16
    const hole = bounds([sharp[1]]);
    expect(hole.maxX - hole.minX).toBeCloseTo(26, 4);

    const rounded = profileContours(profile('tubeRect', { width: 30, depth: 20, wall: 2, cornerRadius: 4 }));
    const rb = bounds(rounded);
    expect(rb.maxX - rb.minX).toBeCloseTo(30, 4);
    expect(rb.maxY - rb.minY).toBeCloseTo(20, 4);
    // Quattro archi di 9 punti all'esterno e all'interno (raggio interno 2)
    expect(rounded[0]).toHaveLength(36);
    expect(rounded[1]).toHaveLength(36);
    expect(area(rounded[0])).toBeLessThan(area(sharp[0]));
    // Con il raggio interno a zero (parete più spessa del raggio) il foro resta un rettangolo
    const thick = profileContours(profile('tubeRect', { width: 30, depth: 20, wall: 5, cornerRadius: 4 }));
    expect(thick[1]).toHaveLength(4);
  });

  it('tondo: due cerchi, il foro orario, area vicina alla corona circolare', () => {
    const c = profileContours(profile('tubeRound', { radius: 10, wall: 2, segments: 64 }));
    expect(c).toHaveLength(2);
    expect(c[0]).toHaveLength(64);
    expect(c[1]).toHaveLength(64);
    expect(area(c[1])).toBeLessThan(0);
    // Poligono a 64 lati: poco sotto il cerchio ideale
    expect(Math.abs((area(c[0]) + area(c[1])) / (Math.PI * (100 - 64)) - 1)).toBeLessThan(0.005);
    // Il primo vertice sta a +X, come circle($fn) di OpenSCAD
    expect(c[0][0]).toEqual([10, 0]);
  });

  it('clampProfile sui tubolari: parete dentro metà del lato minore (o del raggio)', () => {
    expect(clampProfile(profile('tubeRect', { width: 20, depth: 10, wall: 50, cornerRadius: 50 }))).toMatchObject({ wall: 4.9, cornerRadius: 5 });
    expect(clampProfile(profile('tubeRound', { radius: 10, wall: 50 }))).toMatchObject({ wall: 9.9 });
  });

  it('PROFILE_KINDS elenca le sei sezioni nell\'ordine della libreria', () => {
    expect(PROFILE_KINDS).toEqual(['profileL', 'profileT', 'profileH', 'profileU', 'tubeRect', 'tubeRound']);
  });
});
