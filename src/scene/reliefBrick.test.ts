import { describe, expect, it } from 'vitest';
import { BRICK_DESIGNS, MAX_BRICKS, brickDepth, brickLayout, brickModule, normalizeRelief, reliefDefaults } from './relief';
import type { BrickDesign, BrickParams } from './relief';
import { brickScad } from '../codegen/reliefScad';
import { brickRelief, defaultPatternParams, faceFromBounds, normalizePattern, patternCells, reliefDepthLimit, reliefWarnings } from './pattern';
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
    // Il disegno sta solo in `design`: `relief` non lo ripete
    const { design: _design, ...rest } = reliefDefaults('brick') as BrickParams;
    expect(n.relief).toEqual(rest);
    expect(n.relief).not.toHaveProperty('design');
    expect(n.reliefAlgorithm).toBe(1);
  });

  it('la versione del rilievo già salvata non si sovrascrive', () => {
    expect(normalizePattern({ ...params({ kind: 'brick' }), reliefAlgorithm: 2 as unknown as 1 }).reliefAlgorithm).toBe(2);
  });

  it('disegno sconosciuto e misure fuori range tornano dentro i limiti', () => {
    const n = normalizePattern(params({ kind: 'brick', design: 'zigzag' as BrickDesign, relief: { ...brick, brickW: 0, brickH: -3, mortar: Number.NaN, depth: 0 } }));
    expect(n.design).toBe('running');
    expect(n.relief).toMatchObject({ kind: 'brick', brickW: 2, brickH: 2, mortar: brick.mortar, depth: 0.05 });
    // I disegni validi si conservano, e un `design` rimasto dentro `relief` non si salva
    expect(normalizePattern(params({ kind: 'brick', design: 'basket' })).design).toBe('basket');
    const stale = normalizePattern(params({ kind: 'brick', design: 'basket', relief: { ...brick, design: 'herringbone' } }));
    expect(stale.design).toBe('basket');
    expect(stale.relief).not.toHaveProperty('design');
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

  it("avviso con la lunghezza effettiva del mattone dopo l'arrotondamento (anche con brickW < brickH)", () => {
    // 24 × 8 con fuga 1,2: n = 3 passi da 9,2, quindi 26,4 mm
    const rounded = reliefWarnings(params({ kind: 'brick', design: 'herringbone' }));
    expect(rounded).toHaveLength(1);
    expect(rounded[0]).toContain('26,4 × 8');
    expect(reliefWarnings(params({ kind: 'brick', design: 'basket' }))[0]).toContain('26,4 × 8');
    // Mattone più alto che largo: n = 2, lunghezza 2 × 21,2 - 1,2 = 41,2
    expect(reliefWarnings(params({ kind: 'brick', design: 'basket', relief: { ...brick, brickW: 6, brickH: 20 } }))[0]).toContain('41,2 × 20');
    // Lunghezza già multipla (16 + 1,2 = 2 × 8,6... con fuga 1,2 e altezza 7,4 il passo è 8,6): nessun avviso
    expect(reliefWarnings(params({ kind: 'brick', design: 'herringbone', relief: { ...brick, brickW: 16, brickH: 7.4 } }))).toEqual([]);
    // Mattoni sfalsati: le misure restano quelle date
    expect(reliefWarnings(params({ kind: 'brick', design: 'running' }))).toEqual([]);
  });

  it('avviso quando il tetto di mattoni ingrandisce le misure', () => {
    const big = defaultPatternParams({ min: [-200, -200, -2.5], max: [200, 200, 2.5] }, 1);
    const warnings = reliefWarnings({ ...big, kind: 'brick', relief: { ...brick, brickW: 2, brickH: 2, mortar: 0.2 } });
    expect(warnings.some((w) => w.startsWith('Troppi mattoni per la faccia'))).toBe(true);
  });

  it('la profondità delle fughe non supera lo spessore della faccia (con facce opposte, la metà)', () => {
    const deep = { ...brick, depth: 50 };
    // Pannello 5 mm: una faccia sola 5 - 0,2
    expect(reliefDepthLimit(params({ kind: 'brick' }))).toBeCloseTo(4.8, 6);
    // Il valore salvato non si riduce: il limite si applica solo ai parametri effettivi (kernel, codice, pannello)
    const single = normalizePattern(params({ kind: 'brick', relief: deep }));
    expect(single.relief).toMatchObject({ depth: 50 });
    expect(brickRelief(single).relief.depth).toBeCloseTo(4.8, 6);
    expect(reliefWarnings(single).some((w) => w.startsWith('Profondità ridotta a 4,8') && w.includes("sull'ingombro del pezzo"))).toBe(true);
    // z+ e z- insieme: le due incisioni non si attraversano (2,5 - 0,2 ciascuna)
    const both = normalizePattern(params({ kind: 'brick', relief: deep, faces: [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')] }));
    expect(both.relief).toMatchObject({ depth: 50 });
    expect(brickRelief(both).relief.depth).toBeCloseTo(2.3, 6);
    expect(reliefWarnings(both).some((w) => w.startsWith('Profondità ridotta a 2,3'))).toBe(true);
    // Aggiungere e poi togliere la faccia opposta ripristina il valore: nessuna perdita nel salvato
    const back = normalizePattern({ ...both, faces: [faceFromBounds(bounds, 'z+')] });
    expect(back.relief).toMatchObject({ depth: 50 });
    expect(brickRelief(back).relief.depth).toBeCloseTo(4.8, 6);
    // Profondità entro il limite: nessun avviso
    expect(reliefWarnings(normalizePattern(params({ kind: 'brick' }))).some((w) => w.startsWith('Profondità ridotta'))).toBe(false);
    // Una faccia laterale e una cima non sono opposte: vale lo spessore più piccolo
    expect(reliefDepthLimit(params({ kind: 'brick', faces: [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'x+')] }))).toBeCloseTo(4.8, 6);
    // Un pannello sottilissimo: sempre almeno 0,05
    expect(reliefDepthLimit(params({ kind: 'brick', faces: [{ ...faceFromBounds(bounds, 'z+'), thickness: 0.1 }] }))).toBe(0.05);
  });

  it('il mattone sfalsato del codice OpenSCAD è lo stesso del kernel (stessa enumerazione (r, c) del ciclo)', () => {
    for (const rect of [RECT, ODD]) {
      const { solid } = brickScad(rect, withDesign('running'));
      const text = solid.join(' ');
      const num = (s: string) => Number(s);
      // Il ciclo del codice: r in [0 : R], c in [0 : C], mattone traslato di (c·px - (r%2)·px/2 + m/2, r·py + m/2)
      const [, R, C] = /r = \[0 : (\d+)\], c = \[0 : (\d+)\]/.exec(text)!.map(num);
      const t = /translate\(\[c \* ([\d.]+) - \(r % 2\) \* ([\d.]+) \+ ([\d.]+), r \* ([\d.]+) \+ ([\d.]+)\]\) square\(\[([\d.]+), ([\d.]+)\]\)/.exec(text)!.slice(1).map(num);
      const origin = /translate\(\[(-?[\d.]+), (-?[\d.]+), /.exec(text)!.slice(1).map(num);
      const [px, half, mx, py, my, w, h] = t;
      const fromCode: Cell[] = [];
      for (let r = 0; r <= R; r++) {
        for (let c = 0; c <= C; c++) {
          const x0 = origin[0] + c * px - (r % 2) * half + mx;
          const y0 = origin[1] + r * py + my;
          fromCode.push([x0, y0, x0 + w, y0 + h]);
        }
      }
      // Solo i mattoni che entrano nel rettangolo (gli altri il ritaglio li scarta)
      const inside = (b: Cell) => b[0] < rect.maxX && b[2] > rect.minX && b[1] < rect.maxY && b[3] > rect.minY;
      const a = fromCode.filter(inside);
      const b = (brickLayout(rect, brick) as Cell[]).filter(inside);
      expect(a.length).toBe(b.length);
      // Ogni mattone del kernel ha il suo gemello nel codice (il codice scrive due decimali)
      for (const k of b) expect(a.some((o) => o.every((v, i) => Math.abs(v - k[i]) < 0.03))).toBe(true);
    }
  });
});
