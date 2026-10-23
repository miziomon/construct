import { describe, expect, it } from 'vitest';
import {
  HAMMERED_DESIGNS,
  MAX_DENTS,
  SCALE_ASPECT,
  WOOD_DESIGNS,
  copperDepth,
  dentList,
  facetDepth,
  facetList,
  grainDepth,
  hammerCapped,
  knotList,
  normalizeRelief,
  reliefDefaults,
  reliefDepth,
  scaleDepth,
  scaleList,
  scaleSize,
  woodBoxes,
  woodMaxDepth,
} from './relief';
import type { HammeredDesign, HammeredParams, WoodDesign, WoodParams } from './relief';
import { defaultPatternParams, faceFromBounds, frameRect, normalizePattern, patternRelief, reliefToStore, reliefWarnings, woodGrainLimit } from './pattern';
import type { PatternParams, Vec3 } from './types';

/** Faccia 80 × 60 mm centrata nell'origine e una meno comoda. */
const RECT = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
const ODD = { minX: -41.3, minY: -12.9, maxX: 44.2, maxY: 36.1 };

const hammered = reliefDefaults('hammered') as HammeredParams;
const wood = reliefDefaults('wood') as WoodParams;
const withHammered = (patch: Partial<HammeredParams>): HammeredParams => ({ ...hammered, ...patch });
const withWood = (patch: Partial<WoodParams>): WoodParams => ({ ...wood, ...patch });

type Cell = [number, number, number, number];
const overlap = (a: Cell, b: Cell) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
/** Numero di coppie di rettangoli con area in comune (ordinando per x0 si scartano presto quelle lontane). */
function overlaps(cells: Cell[]): number {
  const sorted = [...cells].sort((a, b) => a[0] - b[0]);
  let count = 0;
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j][0] < sorted[i][2]; j++) if (overlap(sorted[i], sorted[j]) > 1e-6) count++;
  return count;
}
/** Area del poligono (positiva se antiorario). */
const signedArea = (ring: number[][]) => ring.reduce((sum, [x, y], k) => sum + (x * ring[(k + 1) % ring.length][1] - ring[(k + 1) % ring.length][0] * y), 0) / 2;

describe('Rame battuto e Legno: parametri', () => {
  it('normalizeRelief: disegno sconosciuto o assente torna a quello di partenza, i validi restano', () => {
    expect(normalizeRelief({ ...hammered, design: 'zigzag' as HammeredDesign }).design).toBe('dimples');
    expect(normalizeRelief({ ...hammered, design: undefined }).design).toBe('dimples');
    expect(normalizeRelief({ ...wood, design: 'zigzag' as WoodDesign }).design).toBe('planks');
    expect(normalizeRelief({ ...wood, design: undefined }).design).toBe('planks');
    for (const design of HAMMERED_DESIGNS) expect(normalizeRelief(withHammered({ design })).design).toBe(design);
    for (const design of WOOD_DESIGNS) expect(normalizeRelief(withWood({ design })).design).toBe(design);
    // I valori di partenza sono validi: nessuna modifica
    expect(normalizeRelief(hammered)).toEqual(hammered);
    expect(normalizeRelief(wood)).toEqual(wood);
  });

  it('i limiti obbligatori valgono per ogni disegno (misure a zero o non finite)', () => {
    const bad = normalizeRelief(withHammered({ design: 'facets', size: 0, depth: -1, jitter: 5, regularity: Number.NaN, seed: -3 }));
    expect(bad).toMatchObject({ size: 2, depth: 0.05, jitter: 0.9, regularity: hammered.regularity, seed: 0 });
    const w = normalizeRelief(withWood({ design: 'parquet', plankW: 0, plankL: 0, gap: 0, gapDepth: 0, ringSpacing: 0 }));
    expect(w).toMatchObject({ plankW: 2, plankL: 5, gap: 0.2, gapDepth: 0.05, ringSpacing: 0.5 });
  });
});

describe('Rame battuto: martellato, sfaccettato, scaglie', () => {
  it.each(['dimples', 'facets', 'scales'] as HammeredDesign[])('%s: deterministico dal seme, diverso con un altro seme', (design) => {
    const list = (patch: Partial<HammeredParams>) => {
      const p = withHammered({ design, ...patch });
      return JSON.stringify(design === 'facets' ? facetList(RECT, p) : design === 'scales' ? scaleList(RECT, p) : dentList(RECT, p));
    };
    expect(list({})).toBe(list({}));
    expect(list({ seed: 2 })).not.toBe(list({}));
    // La profondità di ogni cella dipende dal seme ma resta dentro `depth` +/- `jitter`
    const depths = (design === 'facets' ? facetList(RECT, withHammered({ design })).map((f) => f.d) : design === 'scales' ? scaleList(RECT, withHammered({ design })).map((c) => c.d) : dentList(RECT, withHammered({ design })).map((c) => c.d));
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(hammered.depth * (1 - hammered.jitter) - 1e-9);
    expect(Math.max(...depths)).toBeLessThanOrEqual(hammered.depth * (1 + hammered.jitter) + 1e-9);
  });

  it('il tetto di martellate: mai più di 500 celle, anche con una faccia enorme e celle minuscole', () => {
    const big = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
    const tiny = { size: 2 };
    expect(dentList(big, withHammered(tiny)).length).toBeLessThanOrEqual(MAX_DENTS);
    expect(facetList(big, withHammered({ design: 'facets', ...tiny })).length).toBeLessThanOrEqual(MAX_DENTS);
    const scales = scaleList(big, withHammered({ design: 'scales', ...tiny }));
    expect(scales.length).toBeLessThanOrEqual(MAX_DENTS);
    expect(scales.length).toBeGreaterThan(100);
    // Le scaglie si allargano per restare sotto il tetto; su una faccia normale restano della misura chiesta
    expect(scaleSize(big, 2)).toBeGreaterThan(2);
    expect(scaleSize(RECT, 8)).toBe(8);
    expect(hammerCapped(big, withHammered(tiny))).toBe(true);
    expect(hammerCapped(RECT, hammered)).toBe(false);
    expect(hammerCapped(big, withHammered({ design: 'scales', size: 2 }))).toBe(true);
  });

  it('faccette: celle convesse e antiorarie che tassellano la faccia, con il piano inclinato dal bordo alla profondità massima', () => {
    for (const rect of [RECT, ODD]) {
      const facets = facetList(rect, withHammered({ design: 'facets' }));
      expect(facets.length).toBeGreaterThan(10);
      let total = 0;
      for (const f of facets) {
        expect(f.ring.length).toBeGreaterThanOrEqual(3);
        const area = signedArea(f.ring);
        expect(area).toBeGreaterThan(0);
        total += area;
        // Convessa: ogni svolta è a sinistra
        f.ring.forEach(([ax, ay], k) => {
          const [bx, by] = f.ring[(k + 1) % f.ring.length];
          const [cx, cy] = f.ring[(k + 2) % f.ring.length];
          expect((bx - ax) * (cy - by) - (by - ay) * (cx - bx)).toBeGreaterThanOrEqual(-1e-6);
        });
        // Il piano: 0 sul lato più alto, `d` su quello opposto, lineare lungo la direzione
        const zs = f.ring.map((v) => v[2]);
        expect(Math.max(...zs)).toBeCloseTo(0, 3);
        expect(Math.min(...zs)).toBeCloseTo(-f.d, 3);
        f.ring.forEach(([x, y, z]) => expect(z).toBeCloseTo((-f.d * (x * f.dir[0] + y * f.dir[1] - f.umin)) / f.length, 3));
      }
      // Le celle coprono tutta la faccia, senza sovrapporsi
      expect(total).toBeCloseTo((rect.maxX - rect.minX) * (rect.maxY - rect.minY), 2);
    }
  });

  it('funzioni di profondità: nulle fuori dalle celle, dentro le facce valgono il piano; tutte tra 0 e la profondità massima', () => {
    const facets = facetList(RECT, withHammered({ design: 'facets' }));
    const depth = facetDepth(RECT, withHammered({ design: 'facets' }));
    const max = hammered.depth * (1 + hammered.jitter);
    for (const f of facets.slice(0, 20)) {
      const x = f.x;
      const y = f.y;
      const expected = f.d * Math.min(1, Math.max(0, (x * f.dir[0] + y * f.dir[1] - f.umin) / f.length));
      expect(depth(x, y)).toBeCloseTo(expected, 6);
    }
    for (const design of HAMMERED_DESIGNS) {
      const fn = reliefDepth(RECT, withHammered({ design }));
      for (let x = -39.5; x < 40; x += 3.1) {
        for (let y = -29.5; y < 30; y += 2.3) {
          expect(fn(x, y)).toBeGreaterThanOrEqual(0);
          expect(fn(x, y)).toBeLessThanOrEqual(max + 1e-9);
        }
      }
    }
    // Il martellato resta quello di prima (reliefDepth per 'dimples' è copperDepth)
    expect(reliefDepth(RECT, hammered)(3, 4)).toBe(copperDepth(RECT, hammered)(3, 4));
  });

  it('scaglie: file sfalsate di mezzo passo che si sovrappongono e coprono tutta la faccia', () => {
    const p = withHammered({ design: 'scales', size: 8 });
    const scales = scaleList(RECT, p);
    const rows = [...new Set(scales.map((s) => s.y.toFixed(6)))].sort((a, b) => Number(a) - Number(b));
    expect(rows.length).toBeGreaterThan(10);
    // Le file distano mezza larghezza (si sovrappongono) e quelle dispari sono sfalsate di mezzo passo
    expect(Number(rows[1]) - Number(rows[0])).toBeCloseTo(4, 6);
    const firstX = (row: string) => Math.min(...scales.filter((s) => s.y.toFixed(6) === row).map((s) => s.x));
    expect(Math.abs(firstX(rows[1]) - firstX(rows[0])) % 8).toBeCloseTo(4, 5);
    // Ovali: il semiasse in Y è SCALE_ASPECT volte quello in X
    expect(scales[0].r / scales[0].rx).toBeCloseTo(SCALE_ASPECT, 9);
    // Copertura: ogni punto della faccia sta dentro almeno una scaglia (la profondità è maggiore di zero)
    const depth = scaleDepth(RECT, p);
    for (let x = -39.5; x < 40; x += 1.7) for (let y = -29.5; y < 30; y += 1.3) expect(depth(x, y)).toBeGreaterThan(0);
  });
});

describe('Legno: doghe, parquet, tavola unica', () => {
  it('doghe e listelli non si sovrappongono; il parquet con le fughe tassella la faccia; la tavola unica non ha rettangoli', () => {
    for (const rect of [RECT, ODD]) {
      const planks = woodBoxes(rect, withWood({ design: 'planks' })).map((w) => w.box as Cell);
      expect(planks.length).toBeGreaterThan(5);
      expect(overlaps(planks)).toBe(0);
      const gap = wood.gap;
      const strips = woodBoxes(rect, withWood({ design: 'parquet' }));
      expect(strips.length).toBeGreaterThan(5);
      const cells = strips.map(({ box: [x0, y0, x1, y1] }) => [x0 - gap / 2, y0 - gap / 2, x1 + gap / 2, y1 + gap / 2] as Cell);
      expect(overlaps(cells)).toBe(0);
      const inside = cells.reduce((sum, [x0, y0, x1, y1]) => sum + Math.max(0, Math.min(x1, rect.maxX) - Math.max(x0, rect.minX)) * Math.max(0, Math.min(y1, rect.maxY) - Math.max(y0, rect.minY)), 0);
      expect(inside).toBeCloseTo((rect.maxX - rect.minX) * (rect.maxY - rect.minY), 3);
      // Numeri progressivi diversi per ogni listello (la venatura cambia da uno all'altro)
      expect(new Set(strips.map((s) => s.id)).size).toBe(strips.length);
    }
    expect(woodBoxes(RECT, withWood({ design: 'single' }))).toEqual([]);
  });

  it('il parquet è una spina di pesce: listelli orizzontali e verticali, tutti della stessa misura', () => {
    const strips = woodBoxes(RECT, withWood({ design: 'parquet', plankW: 10, plankL: 40, gap: 1 })).map((s) => s.box);
    expect(strips.some((b) => b[2] - b[0] > b[3] - b[1])).toBe(true);
    expect(strips.some((b) => b[2] - b[0] < b[3] - b[1])).toBe(true);
    // Larghezza 10, passo 11, lunghezza 40 + 1 = 41 -> 4 passi da 11 = 44 - 1 = 43
    const sizes = new Set(strips.map(([x0, y0, x1, y1]) => [x1 - x0, y1 - y0].map((v) => v.toFixed(4)).sort().join('x')));
    expect([...sizes]).toEqual(['10.0000x43.0000']);
  });

  it('venatura: tra 0 e `grainDepth` dentro doghe e listelli, `gapDepth` nelle fughe solo se richiesto, deterministica dal seme', () => {
    for (const design of ['planks', 'parquet'] as WoodDesign[]) {
      const p = withWood({ design });
      const plain = grainDepth(RECT, p);
      const withGaps = grainDepth(RECT, p, true);
      let grooves = 0;
      for (let x = -39.5; x < 40; x += 0.9) {
        for (let y = -29.5; y < 30; y += 0.7) {
          expect(plain(x, y)).toBeGreaterThanOrEqual(0);
          expect(plain(x, y)).toBeLessThanOrEqual(p.grainDepth + 1e-9);
          if (withGaps(x, y) === p.gapDepth && plain(x, y) === 0) grooves++;
          else expect(withGaps(x, y)).toBe(plain(x, y));
        }
      }
      expect(grooves).toBeGreaterThan(0);
      expect(grainDepth(RECT, p)(1.1, 2.2)).toBe(grainDepth(RECT, p)(1.1, 2.2));
      expect(grainDepth(RECT, { ...p, seed: 5 })(1.1, 2.2)).not.toBe(grainDepth(RECT, p)(1.1, 2.2));
    }
  });

  it('le doghe di prima non cambiano: la venatura del design planks è quella del codice di prova', () => {
    // Una doga orizzontale: u dal centro in Y e v lungo X, come prima del refactoring (valore di riferimento bloccato)
    const depth = grainDepth(RECT, wood);
    const values = [depth(-20, -10), depth(0, 0), depth(17.3, 12.1)];
    expect(values.every((v) => v >= 0 && v <= wood.grainDepth)).toBe(true);
    expect(values).toEqual([depth(-20, -10), depth(0, 0), depth(17.3, 12.1)]);
  });

  it('tavola unica: 2-4 nodi dal seme dentro la faccia, conche più profonde della venatura e nessuna fuga', () => {
    const p = withWood({ design: 'single', grainDepth: 0.4 });
    for (let seed = 1; seed < 30; seed++) {
      const knots = knotList(RECT, { ...p, seed });
      expect(knots.length).toBeGreaterThanOrEqual(2);
      expect(knots.length).toBeLessThanOrEqual(4);
      for (const k of knots) {
        expect(k.r).toBeGreaterThanOrEqual(2);
        expect(k.r).toBeLessThanOrEqual(5);
        expect(k.x - k.r).toBeGreaterThan(RECT.minX);
        expect(k.x + k.r).toBeLessThan(RECT.maxX);
        expect(k.y - k.r).toBeGreaterThan(RECT.minY);
        expect(k.y + k.r).toBeLessThan(RECT.maxY);
      }
    }
    expect(JSON.stringify(knotList(RECT, p))).toBe(JSON.stringify(knotList(RECT, p)));
    expect(JSON.stringify(knotList(RECT, { ...p, seed: 9 }))).not.toBe(JSON.stringify(knotList(RECT, p)));
    const depth = grainDepth(RECT, p);
    // Al centro di un nodo la conca supera il massimo della venatura, e il picco sta sotto 2 volte la venatura
    for (const k of knotList(RECT, p)) {
      expect(depth(k.x, k.y)).toBeGreaterThan(p.grainDepth);
      expect(depth(k.x, k.y)).toBeLessThanOrEqual(woodMaxDepth(p) + 1e-9);
    }
    // Le fughe non esistono: con o senza `withGaps` è lo stesso
    expect(grainDepth(RECT, p, true)(-39.9, -29.9)).toBe(depth(-39.9, -29.9));
    // Senza venatura (0) non resta nulla
    expect(grainDepth(RECT, withWood({ design: 'single', grainDepth: 0 }))(0, 0)).toBe(0);
  });
});

describe('Rame battuto e Legno nel Pattern: normalizzazione e avvisi', () => {
  const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
  const params = (patch: Partial<PatternParams>) => ({ ...defaultPatternParams(bounds, 3), ...patch });

  it('kind hammered e wood: disegno e misure di partenza, senza ripetere il disegno in `relief`', () => {
    for (const [kind, defaults, design] of [['hammered', hammered, 'dimples'], ['wood', wood, 'planks']] as const) {
      const n = normalizePattern(params({ kind }));
      expect(n.kind).toBe(kind);
      expect(n.design).toBe(design);
      const { design: _design, ...rest } = defaults as unknown as Record<string, unknown>;
      expect(n.relief).toEqual(rest);
      expect(n.relief).not.toHaveProperty('design');
      expect(n.reliefAlgorithm).toBe(1);
    }
  });

  it('il disegno vale per il tipo: una forma delle borchie sul rame e un disegno del rame sul legno tornano ai valori di partenza', () => {
    expect(normalizePattern(params({ kind: 'hammered', design: 'scales' })).design).toBe('scales');
    expect(normalizePattern(params({ kind: 'hammered', design: 'pyramid' })).design).toBe('dimples');
    expect(normalizePattern(params({ kind: 'wood', design: 'single' })).design).toBe('single');
    expect(normalizePattern(params({ kind: 'wood', design: 'dimples' })).design).toBe('planks');
    expect(reliefToStore(params({ kind: 'wood', design: 'parquet' }))).not.toHaveProperty('design');
    // Un `design` rimasto dentro `relief` non vince su quello del Pattern
    expect(patternRelief(params({ kind: 'hammered', design: 'facets', relief: { ...hammered, design: 'scales' } })).relief).toMatchObject({ design: 'facets' });
  });

  it('il seme del rilievo vale per la prima faccia così com\'è e cresce con l\'indice della faccia', () => {
    const faces = [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')];
    const p = normalizePattern(params({ kind: 'wood', faces, relief: { ...wood, seed: 10 } }));
    expect((patternRelief(p, 0).relief as WoodParams).seed).toBe(10);
    expect((patternRelief(p, 1).relief as WoodParams).seed).toBe(11);
    // I Mattoni non hanno seme: nessun cambiamento
    expect(patternRelief(params({ kind: 'brick' }), 1).relief).toEqual(patternRelief(params({ kind: 'brick' })).relief);
  });

  it('la profondità non supera lo spessore (con facce opposte la metà) e il valore salvato non si riduce', () => {
    const deep = normalizePattern(params({ kind: 'hammered', relief: { ...hammered, depth: 50 } }));
    expect(deep.relief).toMatchObject({ depth: 50 });
    // Ogni cella scende fino a depth · (1 + variazione): il limite 4,8 mm si divide per 1,25
    expect((patternRelief(deep).relief as HammeredParams).depth).toBeCloseTo(3.84, 6);
    expect(reliefWarnings(deep).some((w) => w.startsWith('Profondità ridotta a 3,8') && w.includes("sull'ingombro del pezzo"))).toBe(true);
    const both = normalizePattern(params({ kind: 'hammered', relief: { ...hammered, depth: 50 }, faces: [faceFromBounds(bounds, 'z+'), faceFromBounds(bounds, 'z-')] }));
    expect((patternRelief(both).relief as HammeredParams).depth).toBeCloseTo(1.84, 6);
    // Legno: fughe e venatura
    const w = normalizePattern(params({ kind: 'wood', relief: { ...wood, gapDepth: 50, grainDepth: 40 } }));
    expect(w.relief).toMatchObject({ gapDepth: 50, grainDepth: 40 });
    expect(patternRelief(w).relief).toMatchObject({ gapDepth: expect.closeTo(4.8, 6), grainDepth: expect.closeTo(4.8, 6) });
    expect(reliefWarnings(w).some((x) => x.startsWith('Profondità ridotta a 4,8'))).toBe(true);
    expect(reliefWarnings(normalizePattern(params({ kind: 'wood' }))).some((x) => x.startsWith('Profondità ridotta'))).toBe(false);
    // Tavola unica: i nodi scendono fino a 2 volte la venatura, quindi la venatura arriva alla metà del limite (le fughe non esistono)
    const single = normalizePattern(params({ kind: 'wood', design: 'single', relief: { ...wood, gapDepth: 50, grainDepth: 40 } }));
    expect((patternRelief(single).relief as WoodParams).grainDepth).toBeCloseTo(2.4, 6);
    expect(woodGrainLimit(single, 'single')).toBeCloseTo(2.4, 6);
    expect(reliefWarnings(single).some((x) => x.startsWith('Profondità ridotta a'))).toBe(true);
    // Con le fughe sole fuori limite ma la venatura a posto, la tavola unica non avvisa
    expect(reliefWarnings(normalizePattern(params({ kind: 'wood', design: 'single', relief: { ...wood, gapDepth: 50 } }))).some((x) => x.startsWith('Profondità ridotta'))).toBe(false);
  });

  it('avvisi del legno: fuga sotto 0,8 mm (non per la tavola unica) e lunghezza del listello arrotondata', () => {
    const w = (design: WoodDesign, relief: Partial<WoodParams> = {}) => reliefWarnings(params({ kind: 'wood', design, relief: { ...wood, ...relief } }));
    expect(w('planks')).toEqual([]);
    expect(w('planks', { gap: 0.5 })[0]).toContain('Fuga sotto 0,8 mm');
    expect(w('parquet', { gap: 0.5, plankW: 10, plankL: 41.5 })[0]).toContain('Fuga sotto 0,8 mm');
    expect(w('single', { gap: 0.5 })).toEqual([]);
    // Parquet 12 × 60 con fuga 0,8: passo 12,8, lunghezza 60,8 / 12,8 = 4,75 -> 5 passi, 5 × 12,8 - 0,8 = 63,2
    const rounded = w('parquet');
    expect(rounded).toHaveLength(1);
    expect(rounded[0]).toContain('63,2 × 12');
    // Lunghezza già multipla: nessun avviso (larghezza 10, fuga 1, lunghezza 43 = 4 × 11 - 1)
    expect(w('parquet', { plankW: 10, plankL: 43, gap: 1 })).toEqual([]);
  });

  it('avviso del rame battuto: troppe martellate su una faccia grande', () => {
    expect(reliefWarnings(params({ kind: 'hammered' }))).toEqual([]);
    const big = defaultPatternParams({ min: [-200, -200, -2.5], max: [200, 200, 2.5] }, 1);
    const warnings = reliefWarnings({ ...big, kind: 'hammered', relief: { ...hammered, size: 3 } });
    expect(warnings.some((x) => x.startsWith('Troppe martellate per la faccia'))).toBe(true);
    expect(reliefWarnings({ ...big, kind: 'hammered', design: 'scales', relief: { ...hammered, size: 3 } }).some((x) => x.startsWith('Troppe martellate'))).toBe(true);
  });

  it('la faccia del Pattern ha il suo rettangolo e i tipi in rilievo non hanno celle', () => {
    const p = params({ kind: 'wood' });
    const rect = frameRect(p, p.faces[0]);
    expect([rect.maxX - rect.minX, rect.maxY - rect.minY]).toEqual([82, 62]);
  });
});
