import { describe, expect, it } from 'vitest';
import { subdivideContours, twistPieceLength } from './twist';

describe('suddivisione dei lati per la torsione', () => {
  const rect: [number, number][] = [[-60, -2.5], [60, -2.5], [60, 2.5], [-60, 2.5]];

  it('il tratto massimo è due strati, con un minimo di mezzo millimetro', () => {
    expect(twistPieceLength(120, 80)).toBe(1.5);
    expect(twistPieceLength(1, 400)).toBe(0.5);
  });

  it('spezza i lati lunghi e tiene i vertici originali', () => {
    const [c] = subdivideContours([rect], 3, 80);
    // 120 / 3 = 40 tratti per lato lungo, 5 / 3 -> 2 per lato corto
    expect(c).toHaveLength(40 + 2 + 40 + 2);
    expect(c).toContainEqual([-60, -2.5]);
    expect(c).toContainEqual([60, 2.5]);
    // I punti nuovi stanno sul lato
    expect(c.filter((p) => p[1] === -2.5).length).toBe(41);
  });

  it('un profilo già fitto resta com\'è', () => {
    const tiny: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(subdivideContours([tiny], 3, 80)[0]).toEqual(tiny);
  });

  it('con molti strati il tratto cresce per restare entro il limite di vertici', () => {
    const [c] = subdivideContours([rect], 0.5, 360);
    expect(c.length * 360).toBeLessThanOrEqual(400_000 + 4 * 360);
  });
});
