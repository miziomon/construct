import { describe, expect, it } from 'vitest';
import { BRICK_DESIGNS, MAX_BRICKS, brickDepth, brickLayout, brickModule, normalizeRelief, reliefDefaults } from './relief';
import type { BrickDesign, BrickParams } from './relief';
import { defaultPatternParams, normalizePattern, patternCells, reliefWarnings } from './pattern';
import type { PatternParams, Vec3 } from './types';

/** Faccia 80 × 60 mm centrata nell'origine e una meno comoda (origine e misure non intere). */
const RECT = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
const ODD = { minX: -41.3, minY: -12.9, maxX: 44.2, maxY: 36.1 };

const brick = reliefDefaults('brick') as BrickParams;
const withDesign = (design: BrickDesign, patch: Partial<BrickParams> = {}): BrickParams => ({ ...brick, design, ...patch });

type Cell = [number, number, number, number];

/** Area della parte di `cell` dentro il rettangolo. */
const clippedArea = (r: typeof RECT, [x0, y0, x1, y1]: Cell) => Math.max(0, Math.min(x1, r.maxX) - Math.max(x0, r.minX)) * Math.max(0, Math.min(y1, r.maxY) - Math.max(y0, r.minY));

/** Area in comune di due rettangoli. */
const overlap = (a: Cell, b: Cell) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** Celle (mattone più mezza fuga per lato): tassellano il piano senza vuoti né sovrapposizioni. */
const cellsOf = (boxes: Cell[], mortar: number): Cell[] => boxes.map(([x0, y0, x1, y1]) => [x0 - mortar / 2, y0 - mortar / 2, x1 + mortar / 2, y1 + mortar / 2]);

/** Coppie di celle con area in comune (ordinando per x0 si scartano presto quelle lontane). */
function overlaps(cells: Cell[]): number {
  const sorted = [...cells].sort((a, b) => a[0] - b[0]);
  let count = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j][0] < sorted[i][2]; j++) if (overlap(sorted[i], sorted[j]) > 1e-6) count++;
  }
  return count;
}

describe('rilievo Mattoni: disegni', () => {
  it('normalizeRelief: un disegno sconosciuto o assente vale "running", i validi restano', () => {
    expect(normalizeRelief({ ...brick, design: 'nonesiste' as BrickDesign }).design).toBe('running');
    expect(normalizeRelief({ ...brick, design: undefined }).design).toBe('running');
    for (const design of BRICK_DESIGNS) expect(normalizeRelief(withDesign(design)).design).toBe(design);
  });

  it('spina di pesce e cesto: il mattone è lungo un multiplo intero del passo corto (almeno 2)', () => {
    // 24 × 8 con fuga 1,2: passo corto 9,2 e rapporto 25,2 / 9,2 = 2,74, quindi 3 passi, cioè 26,4 mm di mattone
    expect(brickModule(brick)).toEqual({ u: 9.2, n: 3 });
    // Mattone più alto che largo: si ferma al minimo di 2
    expect(brickModule({ ...brick, brickW: 6, brickH: 20 }).n).toBe(2);
  });

  it.each([
    ['herringbone', RECT, {}],
    ['herringbone', ODD, {}],
    ['herringbone', RECT, { brickW: 16, brickH: 8, mortar: 1 }],
    ['herringbone', ODD, { brickW: 40, brickH: 8, mortar: 2 }],
    ['basket', RECT, {}],
    ['basket', ODD, {}],
    ['basket', RECT, { brickW: 40, brickH: 8, mortar: 2 }],
    ['running', ODD, {}],
  ] as [BrickDesign, typeof RECT, Partial<BrickParams>][])('%s: nessuna sovrapposizione e nessun vuoto (%#)', (design, rect, patch) => {
    const p = withDesign(design, patch);
    const boxes = brickLayout(rect, p) as Cell[];
    const cells = cellsOf(boxes, p.mortar);
    expect(boxes.length).toBeGreaterThan(10);
    // Le celle non si sovrappongono (è anche la condizione di `CrossSection.compose` nel kernel)...
    expect(overlaps(cells)).toBe(0);
    // ...e la parte dentro il rettangolo le somma tutte: nessun vuoto
    const area = cells.reduce((sum, c) => sum + clippedArea(rect, c), 0);
    expect(area).toBeCloseTo((rect.maxX - rect.minX) * (rect.maxY - rect.minY), 4);
    // Nessun mattone fuori dal rettangolo senza toccarlo
    expect(boxes.every((b) => clippedArea(rect, [b[0] - p.mortar, b[1] - p.mortar, b[2] + p.mortar, b[3] + p.mortar]) > 0)).toBe(true);
  });

  it('spina di pesce e cesto: tutti i mattoni hanno la stessa misura, in due orientamenti', () => {
    for (const design of ['herringbone', 'basket'] as const) {
      const { u, n } = brickModule(brick);
      const long = n * u - brick.mortar;
      const sizes = new Set(brickLayout(RECT, withDesign(design)).map(([x0, y0, x1, y1]) => [x1 - x0, y1 - y0].map((v) => v.toFixed(4)).sort().join('x')));
      expect([...sizes]).toEqual([[brick.brickH, long].map((v) => v.toFixed(4)).sort().join('x')]);
      // Sia orizzontali sia verticali
      const boxes = brickLayout(RECT, withDesign(design));
      expect(boxes.some((b) => b[2] - b[0] > b[3] - b[1])).toBe(true);
      expect(boxes.some((b) => b[2] - b[0] < b[3] - b[1])).toBe(true);
    }
  });

  it('numero di mattoni: circa area / (n u²), più quelli di bordo', () => {
    const { u, n } = brickModule(brick);
    const expected = (80 * 60) / (n * u * u);
    for (const design of ['herringbone', 'basket'] as const) {
      const count = brickLayout(RECT, withDesign(design)).length;
      expect(count).toBeGreaterThanOrEqual(Math.floor(expected));
      expect(count).toBeLessThan(expected * 1.6);
    }
  });

  it('la spina di pesce è fatta di zigzag: ogni mattone orizzontale ha il verticale accanto alla sua punta', () => {
    const boxes = brickLayout(RECT, withDesign('herringbone')) as Cell[];
    const { u, n } = brickModule(brick);
    const long = n * u - brick.mortar;
    const inner = boxes.filter((b) => b[0] > -30 && b[2] < 10 && b[1] > -15 && b[3] < 15);
    const horizontal = inner.filter((b) => b[2] - b[0] > b[3] - b[1]);
    expect(horizontal.length).toBeGreaterThan(0);
    for (const h of horizontal) {
      // Il verticale parte a una fuga dalla punta destra, con la sua cima all'altezza del tetto del orizzontale
      const next = boxes.find((b) => Math.abs(b[0] - (h[2] + brick.mortar)) < 1e-6 && Math.abs(b[3] - h[3]) < 1e-6);
      expect(next).toBeDefined();
      expect(next![3] - next![1]).toBeCloseTo(long, 6);
    }
  });

  it('la funzione di profondità vale 0 sul mattone e la profondità nella fuga, per ogni disegno', () => {
    for (const design of BRICK_DESIGNS) {
      const p = withDesign(design);
      const boxes = brickLayout(RECT, p);
      const depth = brickDepth(RECT, p);
      // Centro di un mattone interno
      const b = boxes.find((c) => c[0] > -15 && c[2] < 15 && c[1] > -15 && c[3] < 15)!;
      expect(depth((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)).toBe(0);
      // A mezza fuga dal bordo destro del mattone: dentro la fuga
      expect(depth(b[2] + p.mortar / 2, (b[1] + b[3]) / 2)).toBe(p.depth);
      // Coerenza con il layout su una griglia di punti: dentro un mattone (con tolleranza sui bordi) = 0
      let mismatches = 0;
      for (let x = -39.9; x < 40; x += 1.37) {
        for (let y = -29.9; y < 30; y += 1.13) {
          const inside = boxes.some((c) => x > c[0] + 1e-6 && x < c[2] - 1e-6 && y > c[1] + 1e-6 && y < c[3] - 1e-6);
          const value = depth(x, y);
          if (inside && value !== 0) mismatches++;
          if (!inside && !boxes.some((c) => x >= c[0] - 1e-6 && x <= c[2] + 1e-6 && y >= c[1] - 1e-6 && y <= c[3] + 1e-6) && value !== p.depth) mismatches++;
        }
      }
      expect(mismatches).toBe(0);
    }
  });

  it('con mattoni minuscoli su una faccia grande le misure si allargano: il numero resta limitato', () => {
    const big = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
    for (const design of BRICK_DESIGNS) {
      const boxes = brickLayout(big, withDesign(design, { brickW: 2, brickH: 2, mortar: 0.2 }));
      expect(boxes.length).toBeLessThan(MAX_BRICKS * 1.6);
      expect(boxes.length).toBeGreaterThan(MAX_BRICKS * 0.5);
    }
    // Misure normali: nessuna modifica
    expect(brickLayout(RECT, withDesign('running')).length).toBe(brickLayout(RECT, brick).length);
  });

  it('i disegni diversi danno layout diversi', () => {
    const key = (design: BrickDesign) => JSON.stringify(brickLayout(RECT, withDesign(design)));
    expect(new Set(BRICK_DESIGNS.map(key)).size).toBe(3);
  });
});

describe('Pattern Mattoni: normalizzazione', () => {
  const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
  const params = (patch: Partial<PatternParams>) => ({ ...defaultPatternParams(bounds, 3), ...patch });

  it('kind brick: disegno e misure di partenza, versione del rilievo', () => {
    const n = normalizePattern(params({ kind: 'brick' }));
    expect(n.kind).toBe('brick');
    expect(n.design).toBe('running');
    expect(n.relief).toEqual(reliefDefaults('brick'));
    expect(n.reliefAlgorithm).toBe(1);
  });

  it('disegno sconosciuto e misure fuori range tornano dentro i limiti', () => {
    const n = normalizePattern(params({ kind: 'brick', design: 'zigzag' as BrickDesign, relief: { ...brick, brickW: 0, brickH: -3, mortar: Number.NaN, depth: 0 } }));
    expect(n.design).toBe('running');
    expect(n.relief).toMatchObject({ kind: 'brick', design: 'running', brickW: 2, brickH: 2, mortar: brick.mortar, depth: 0.05 });
    // I disegni validi si conservano, anche dentro `relief`
    expect(normalizePattern(params({ kind: 'brick', design: 'basket' })).relief).toMatchObject({ design: 'basket' });
  });

  it('un kind sconosciuto torna Voronoi e i Pattern a celle non guadagnano campi di rilievo', () => {
    expect(normalizePattern(params({ kind: 'nonesiste' as PatternParams['kind'] })).kind).toBe('voronoi');
    const voronoi = normalizePattern(params({ kind: 'hexagon' }));
    expect(voronoi).not.toHaveProperty('design');
    expect(voronoi).not.toHaveProperty('relief');
    expect(voronoi).not.toHaveProperty('reliefAlgorithm');
  });

  it('i Mattoni non hanno celle', () => {
    expect(patternCells(params({ kind: 'brick' }), RECT)).toEqual([]);
  });

  it('avviso sulla fuga sotto 0,8 mm (e nessun avviso sopra, né per i tipi a celle)', () => {
    expect(reliefWarnings(params({ kind: 'brick', relief: { ...brick, mortar: 0.5 } }))).toHaveLength(1);
    expect(reliefWarnings(params({ kind: 'brick', relief: { ...brick, mortar: 0.8 } }))).toEqual([]);
    expect(reliefWarnings(params({ kind: 'brick' }))).toEqual([]);
    expect(reliefWarnings(params({ kind: 'voronoi', wall: 0.2 }))).toEqual([]);
    // La fuga a zero sale al minimo di 0,2 e avvisa
    expect(reliefWarnings(params({ kind: 'brick', relief: { ...brick, mortar: 0 } }))).toHaveLength(1);
  });
});
