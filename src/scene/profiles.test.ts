import { describe, expect, it } from 'vitest';
import { clampProfile, maxRootRadius, PROFILE_KINDS, profileArea, profileContours, thicknessAxes, type ProfileShape } from './profiles';
import { shape2dDefaults } from './defaults';
import type { ProfileKind } from './types';

const profile = (kind: ProfileKind, patch: Partial<ProfileShape> = {}): ProfileShape =>
  ({ ...shape2dDefaults(kind), id: 'p', name: 'p', position: [0, 0, 0], ...patch }) as ProfileShape;

/** Area con segno (positiva se antiorario). */
const area = (c: [number, number][]) => c.reduce((sum, [x, y], i) => sum + (x * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * y), 0) / 2;

const bounds = (c: [number, number][]) => ({
  minX: Math.min(...c.map((p) => p[0])),
  maxX: Math.max(...c.map((p) => p[0])),
  minY: Math.min(...c.map((p) => p[1])),
  maxY: Math.max(...c.map((p) => p[1])),
});

describe('profilati strutturali', () => {
  it.each(PROFILE_KINDS)('%s: un contorno antiorario con ingombro width × depth centrato nell\'origine', (kind) => {
    const contours = profileContours(profile(kind, { width: 30, depth: 18, flange: 2, web: 3 }));
    expect(contours).toHaveLength(1);
    const [c] = contours;
    const b = bounds(c);
    expect(b.maxX - b.minX).toBeCloseTo(30, 4);
    expect(b.maxY - b.minY).toBeCloseTo(18, 4);
    expect((b.maxX + b.minX) / 2).toBeCloseTo(0, 4);
    expect((b.maxY + b.minY) / 2).toBeCloseTo(0, 4);
    expect(area(c)).toBeGreaterThan(0);
  });

  it('numero di vertici e area esatta senza raccordo', () => {
    const l = profileContours(profile('profileL', { width: 30, depth: 20, flange: 2, web: 3 }))[0];
    expect(l).toHaveLength(6);
    // Ala orizzontale 30 × 2 più ala verticale (20 − 2) × 3
    expect(area(l)).toBeCloseTo(30 * 2 + 18 * 3, 6);
    const t = profileContours(profile('profileT', { width: 30, depth: 20, flange: 2, web: 3 }))[0];
    expect(t).toHaveLength(8);
    expect(area(t)).toBeCloseTo(30 * 2 + 18 * 3, 6);
    const h = profileContours(profile('profileH', { width: 30, depth: 20, flange: 2, web: 3 }))[0];
    expect(h).toHaveLength(12);
    // Due ali verticali 20 × 2 più anima (30 − 4) × 3
    expect(area(h)).toBeCloseTo(2 * 20 * 2 + 26 * 3, 6);
    expect(profileArea(profile('profileH', { width: 30, depth: 20, flange: 2, web: 3 }))).toBeCloseTo(2 * 20 * 2 + 26 * 3, 6);
  });

  it('la L ha l\'angolo esterno in basso a sinistra, la T l\'ala in cima, la H le ali ai lati', () => {
    const inside = (c: [number, number][], x: number, y: number) => {
      // Punto dentro il poligono: regola pari-dispari sul raggio orizzontale
      let hit = false;
      for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
        const [xi, yi] = c[i];
        const [xj, yj] = c[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    const l = profileContours(profile('profileL', { width: 20, depth: 20, flange: 3, web: 3 }))[0];
    expect(inside(l, -9, -9)).toBe(true);
    expect(inside(l, 9, 9)).toBe(false);
    const t = profileContours(profile('profileT', { width: 20, depth: 20, flange: 3, web: 3 }))[0];
    expect(inside(t, 9, 9)).toBe(true);
    expect(inside(t, 0, -9)).toBe(true);
    expect(inside(t, 9, -9)).toBe(false);
    const h = profileContours(profile('profileH', { width: 20, depth: 20, flange: 3, web: 3 }))[0];
    expect(inside(h, -9, 9)).toBe(true);
    expect(inside(h, 0, 0)).toBe(true);
    expect(inside(h, 0, 9)).toBe(false);
  });

  it('raccordo interno: aggiunge materiale negli angoli concavi (circa (1 − π/4)·r² ciascuno) e l\'ingombro non cambia', () => {
    const corners = { profileL: 1, profileT: 2, profileH: 4 } as const;
    for (const kind of PROFILE_KINDS) {
      const sharp = profileContours(profile(kind, { width: 30, depth: 20, flange: 2, web: 3 }))[0];
      const rounded = profileContours(profile(kind, { width: 30, depth: 20, flange: 2, web: 3, rootRadius: 2 }))[0];
      const b = bounds(rounded);
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

  it('clampProfile: spessori dentro l\'ingombro e raccordo entro il massimo', () => {
    const l = clampProfile(profile('profileL', { width: 20, depth: 10, flange: 50, web: 50, rootRadius: 99 }));
    expect(l.flange).toBeCloseTo(9.9, 6);
    expect(l.web).toBeCloseTo(19.9, 6);
    // Resta 0,1 mm di parte dritta per lato: il raccordo si ferma poco sotto
    expect(l.rootRadius).toBeCloseTo(0.09, 6);
    const h = clampProfile(profile('profileH', { width: 20, depth: 10, flange: 50, web: 50 }));
    // Due ali dentro la larghezza, anima dentro la profondità
    expect(h.flange).toBeCloseTo(9.95, 6);
    expect(h.web).toBeCloseTo(9.9, 6);
    const ok = clampProfile(profile('profileT', { width: 20, depth: 20, flange: 3, web: 3, rootRadius: 2 }));
    expect(ok).toMatchObject({ flange: 3, web: 3, rootRadius: 2 });
  });

  it('maxRootRadius: la parte dritta più corta vicino agli angoli concavi', () => {
    expect(maxRootRadius(profile('profileL', { width: 20, depth: 12, flange: 2, web: 4 }))).toBeCloseTo(10 - 0.01, 3);
    expect(maxRootRadius(profile('profileT', { width: 20, depth: 12, flange: 2, web: 4 }))).toBeCloseTo(8 - 0.01, 3);
    expect(maxRootRadius(profile('profileH', { width: 20, depth: 12, flange: 2, web: 4 }))).toBeCloseTo(4 - 0.01, 3);
  });

  it('thicknessAxes: nella H le ali si misurano lungo X, nelle altre lungo Y', () => {
    expect(thicknessAxes('profileH')).toEqual({ flange: 0, web: 1 });
    expect(thicknessAxes('profileL')).toEqual({ flange: 1, web: 0 });
    expect(thicknessAxes('profileT')).toEqual({ flange: 1, web: 0 });
  });
});
