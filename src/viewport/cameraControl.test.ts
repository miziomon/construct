import { describe, expect, it } from 'vitest';
import { boundingSphere, CAMERA_FOV, distanceFromZoom, fitDistance, orthoZoom, PRESET_DIRECTIONS, viewBounds } from './cameraControl';
import type { Vec3 } from '../scene/types';

describe('viste della camera', () => {
  it('le direzioni dei preset sono unitarie e orientate come ci si aspetta', () => {
    for (const d of Object.values(PRESET_DIRECTIONS)) expect(Math.hypot(...d)).toBeCloseTo(1, 9);
    // Dall'alto quasi verticale, dal fronte si guarda verso +Y, di lato da +X, isometrica sopra e davanti a destra
    expect(PRESET_DIRECTIONS.top[2]).toBeGreaterThan(0.999);
    expect(PRESET_DIRECTIONS.front).toEqual([0, -1, 0]);
    expect(PRESET_DIRECTIONS.side).toEqual([1, 0, 0]);
    expect(PRESET_DIRECTIONS.iso[0]).toBeGreaterThan(0);
    expect(PRESET_DIRECTIONS.iso[1]).toBeLessThan(0);
    expect(PRESET_DIRECTIONS.iso[2]).toBeGreaterThan(0);
  });

  it('la distanza di inquadratura fa entrare la sfera nell\'altezza della vista, con margine', () => {
    const d = fitDistance(10);
    // Il raggio apparente della sfera (10 / d) deve stare sotto la metà del campo verticale
    expect(Math.asin(10 / d)).toBeLessThan((CAMERA_FOV * Math.PI) / 360);
    expect(Math.asin(10 / d)).toBeGreaterThan(((CAMERA_FOV * Math.PI) / 360) * 0.8);
    // Scene minuscole o vuote: distanza finita e sensata
    expect(fitDistance(0)).toBeGreaterThan(1);
  });

  it('zoom ortografico e distanza prospettica sono l\'uno l\'inverso dell\'altra', () => {
    const zoom = orthoZoom(800, 300);
    expect(distanceFromZoom(800, zoom)).toBeCloseTo(300, 9);
    // A distanza 300 con 38° si vedono circa 206 mm in altezza: su 800 px lo zoom è circa 3,9
    expect(zoom).toBeCloseTo(800 / (2 * 300 * Math.tan((CAMERA_FOV * Math.PI) / 360)), 9);
  });

  it('boundingSphere: centro e metà diagonale', () => {
    const s = boundingSphere({ min: [0, 0, 0], max: [20, 20, 40] });
    expect(s.center).toEqual([10, 10, 20]);
    expect(s.radius).toBeCloseTo(Math.hypot(20, 20, 40) / 2, 9);
  });

  it('viewBounds: la selezione, poi tutta la scena, poi il piatto', () => {
    const a = { min: [0, 0, 0] as Vec3, max: [10, 10, 10] as Vec3 };
    const b = { min: [50, 50, 0] as Vec3, max: [60, 60, 30] as Vec3 };
    const input = { selection: ['b'], rootIds: ['a', 'b'], boundsByRoot: { a, b }, bed: { width: 256, depth: 256 } };
    expect(viewBounds(input, true)).toEqual(b);
    expect(viewBounds(input, false)).toEqual({ min: [0, 0, 0], max: [60, 60, 30] });
    // Selezione vuota o non alla radice: tutta la scena
    expect(viewBounds({ ...input, selection: [] }, true)).toEqual({ min: [0, 0, 0], max: [60, 60, 30] });
    expect(viewBounds({ ...input, selection: ['x'] }, true)).toEqual({ min: [0, 0, 0], max: [60, 60, 30] });
    // Scena vuota: il piatto
    expect(viewBounds({ selection: [], rootIds: [], boundsByRoot: {}, bed: { width: 200, depth: 100 } }, false)).toEqual({ min: [-100, -50, 0], max: [100, 50, 0] });
  });
});
