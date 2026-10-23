import { describe, expect, it } from 'vitest';
import { STUD_LAYOUTS, STUD_SHAPES, normalizeRelief, pyramidPolyhedron, reliefDefaults, studCenters, studCentersFor, studGrid, studHeight, studProfile } from './relief';
import type { StudLayout, StudParams, StudShape } from './relief';
import { defaultPatternParams, faceFromBounds, frameRect, normalizePattern, patternCells, reliefToStore, reliefWarnings, studCentersOf, studRelief } from './pattern';
import type { PatternParams, Vec3 } from './types';

/** Faccia 80 × 60 mm centrata nell'origine e una più stretta. */
const RECT = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
const ODD = { minX: -41.3, minY: -12.9, maxX: 44.2, maxY: 36.1 };

const studs = reliefDefaults('studs') as StudParams;
const withStuds = (patch: Partial<StudParams>): StudParams => ({ ...studs, ...patch });

/** Volume di un poliedro chiuso (somma dei tetraedri dall'origine), per controllare la piramide. */
function polyhedronVolume({ points, faces }: { points: number[][]; faces: number[][] }): number {
  let volume = 0;
  for (const [a, b, c] of faces) {
    const [p, q, r] = [points[a], points[b], points[c]];
    volume += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
  }
  return volume;
}

describe('rilievo Borchie: parametri e griglia', () => {
  it('normalizeRelief: forma e griglia sconosciute tornano ai valori di partenza, quelle valide restano', () => {
    expect(normalizeRelief({ ...studs, shape: 'cubo' as StudShape, layout: 'esagonale' as StudLayout })).toMatchObject({ shape: 'dome', layout: 'square' });
    for (const shape of STUD_SHAPES) expect(normalizeRelief(withStuds({ shape })).shape).toBe(shape);
    for (const layout of STUD_LAYOUTS) expect(normalizeRelief(withStuds({ layout })).layout).toBe(layout);
    // Una borchia salvata prima della scelta della griglia vale quadrata
    expect(normalizeRelief({ ...studs, layout: undefined }).layout).toBe('square');
    expect(normalizeRelief(studs)).toEqual(studs);
  });

  it.each(STUD_LAYOUTS)('%s: tutte le borchie intere dentro il rettangolo e mai più vicine del passo', (layout) => {
    for (const rect of [RECT, ODD]) {
      const p = withStuds({ layout, pitch: 9, radius: 2.5 });
      const centers = studCenters(rect, p);
      expect(centers.length).toBeGreaterThan(10);
      for (const [x, y] of centers) {
        expect(x - p.radius).toBeGreaterThanOrEqual(rect.minX - 1e-9);
        expect(x + p.radius).toBeLessThanOrEqual(rect.maxX + 1e-9);
        expect(y - p.radius).toBeGreaterThanOrEqual(rect.minY - 1e-9);
        expect(y + p.radius).toBeLessThanOrEqual(rect.maxY + 1e-9);
      }
      // Nessuna sovrapposizione: la distanza minima tra due centri è il passo
      let closest = Infinity;
      for (let i = 0; i < centers.length; i++) for (let j = i + 1; j < centers.length; j++) closest = Math.min(closest, Math.hypot(centers[i][0] - centers[j][0], centers[i][1] - centers[j][1]));
      expect(closest).toBeGreaterThanOrEqual(p.pitch - 1e-9);
      // Determinismo
      expect(studCenters(rect, p)).toEqual(centers);
    }
  });

  it('griglia sfalsata: le file dispari sono spostate di mezzo passo e le file distano un passo', () => {
    const p = withStuds({ layout: 'staggered', pitch: 10, radius: 2 });
    const g = studGrid(RECT, p);
    expect(g.stagger).toBe(5);
    const centers = studCenters(RECT, p);
    const row = (j: number) => centers.slice(j * g.cols, (j + 1) * g.cols);
    expect(row(1)[0][0] - row(0)[0][0]).toBeCloseTo(5, 9);
    expect(row(2)[0][0]).toBeCloseTo(row(0)[0][0], 9);
    expect(row(1)[0][1] - row(0)[0][1]).toBeCloseTo(10, 9);
    // L'insieme delle file è centrato: lo spazio a sinistra della fila pari è quello a destra della dispari
    const left = row(0)[0][0] - p.radius - RECT.minX;
    const right = RECT.maxX - (row(1)[g.cols - 1][0] + p.radius);
    expect(left).toBeCloseTo(right, 9);
    // La griglia quadrata della stessa misura ha una colonna in più (non deve ospitare lo sfalsamento)
    expect(studGrid(RECT, withStuds({ layout: 'square', pitch: 10, radius: 2 })).cols).toBeGreaterThanOrEqual(g.cols);
  });

  it('la griglia quadrata non è cambiata (progetti e codice di prima)', () => {
    const g = studGrid(RECT, studs);
    expect([g.cols, g.rows, g.stagger]).toEqual([7, 5, 0]);
  });

  it('studCentersFor: la griglia sta nel rettangolo ridotto del margine, centrata e con le borchie intere', () => {
    const all = studCenters(RECT, studs);
    expect(studCentersFor(RECT, studs, 0)).toEqual(all);
    const inner = studCentersFor(RECT, studs, 4);
    expect(inner.length).toBeGreaterThan(0);
    for (const [x, y] of inner) {
      expect(x - studs.radius).toBeGreaterThanOrEqual(RECT.minX + 4 - 1e-9);
      expect(x + studs.radius).toBeLessThanOrEqual(RECT.maxX - 4 + 1e-9);
      expect(y - studs.radius).toBeGreaterThanOrEqual(RECT.minY + 4 - 1e-9);
      expect(y + studs.radius).toBeLessThanOrEqual(RECT.maxY - 4 + 1e-9);
    }
    // Centrata: lo spazio a sinistra e a destra del disegno è lo stesso
    const xs = inner.map((c) => c[0]);
    expect(Math.min(...xs) - studs.radius - (RECT.minX + 4)).toBeCloseTo(RECT.maxX - 4 - (Math.max(...xs) + studs.radius), 9);
    // Un pezzo piccolo con il margine predefinito ha comunque le sue borchie (cubo da 20 mm, margine 2)
    const cube = { minX: -10, minY: -10, maxX: 10, maxY: 10 };
    expect(studCentersFor(cube, studs, 2).length).toBeGreaterThan(0);
    // Un margine enorme non lascia nulla (e non è un errore); un margine non finito vale zero
    expect(studCentersFor(RECT, studs, 1000)).toEqual([]);
    expect(studCentersFor(RECT, studs, 30)).toEqual([]);
    expect(studCentersFor(RECT, studs, Number.NaN)).toEqual(all);
  });

  it('piramide: poliedro chiuso con il volume del piede più quello della punta, altezza sulla punta', () => {
    const { points, faces } = pyramidPolyhedron(2.5, 1.5, 0.2);
    expect(polyhedronVolume({ points, faces })).toBeCloseTo(5 * 5 * 0.2 + (4 * 2.5 * 2.5 * 1.5) / 3, 9);
    expect(Math.max(...points.map((q) => q[2]))).toBe(1.5);
    // Ogni spigolo è condiviso da due facce (poliedro chiuso)
    const edges = new Map<string, number>();
    for (const f of faces) for (let k = 0; k < 3; k++) edges.set(`${f[k]}-${f[(k + 1) % 3]}`, (edges.get(`${f[k]}-${f[(k + 1) % 3]}`) ?? 0) + 1);
    for (const [key] of edges) {
      const [a, b] = key.split('-');
      expect(edges.get(`${b}-${a}`)).toBe(1);
    }
  });

  it('quota della piramide nella mappa di altezze: punta al centro, zero al bordo, scende linearmente', () => {
    const p = withStuds({ shape: 'pyramid', radius: 3, height: 2 });
    const [cx, cy] = studCenters(RECT, p)[0];
    const height = studHeight(RECT, p);
    expect(height(cx, cy)).toBeCloseTo(2, 9);
    expect(height(cx + 1.5, cy + 1.5)).toBeCloseTo(1, 9);
    expect(height(cx + 3.1, cy)).toBe(0);
    // Il profilo di rivoluzione esiste comunque (cono inscritto), senza errori
    expect(studProfile(p)).toEqual([[0, 2], [3, 0]]);
  });
});

describe('Pattern Borchie: normalizzazione e avvisi', () => {
  const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
  const params = (patch: Partial<PatternParams>) => ({ ...defaultPatternParams(bounds, 3), ...patch });

  it('kind studs: disegno e misure di partenza, senza ripetere la forma in `relief`', () => {
    const n = normalizePattern(params({ kind: 'studs' }));
    expect(n.kind).toBe('studs');
    expect(n.design).toBe('dome');
    const { shape: _shape, ...rest } = studs;
    expect(n.relief).toEqual(rest);
    expect(n.relief).not.toHaveProperty('shape');
    expect(n.reliefAlgorithm).toBe(1);
  });

  it('il disegno vale per il tipo: una forma sui Mattoni e una muratura sulle Borchie tornano ai valori di partenza', () => {
    expect(normalizePattern(params({ kind: 'studs', design: 'pyramid' })).design).toBe('pyramid');
    expect(normalizePattern(params({ kind: 'studs', design: 'basket' })).design).toBe('dome');
    expect(normalizePattern(params({ kind: 'brick', design: 'pyramid' })).design).toBe('running');
    // La forma rimasta dentro `relief` non vince su `design`
    expect(studRelief(params({ kind: 'studs', design: 'chamfered', relief: { ...studs, shape: 'pyramid' } })).relief.shape).toBe('chamfered');
    expect(reliefToStore(params({ kind: 'studs', design: 'chamfered' }))).not.toHaveProperty('shape');
  });

  it('misure fuori range tornano dentro i limiti', () => {
    const n = normalizePattern(params({ kind: 'studs', relief: { ...studs, pitch: 0, radius: -1, height: Number.NaN } }));
    expect(n.relief).toMatchObject({ kind: 'studs', pitch: 2, radius: 0.5, height: studs.height });
    // Passo e griglia sopravvivono alla normalizzazione
    expect(normalizePattern(params({ kind: 'studs', relief: { ...studs, layout: 'staggered', pitch: 15 } })).relief).toMatchObject({ layout: 'staggered', pitch: 15 });
  });

  it('i Mattoni e i tipi a celle non cambiano e i rilievi non hanno celle', () => {
    expect(patternCells(params({ kind: 'studs' }), RECT)).toEqual([]);
    expect(normalizePattern(params({ kind: 'diamond' }))).not.toHaveProperty('reliefAlgorithm');
  });

  it('il rettangolo esatto della faccia (pad 0) è la faccia; il predefinito ha 1 mm per lato', () => {
    const p = params({ kind: 'studs' });
    const exact = frameRect(p, p.faces[0], 0);
    expect([exact.maxX - exact.minX, exact.maxY - exact.minY]).toEqual([80, 60]);
    const padded = frameRect(p, p.faces[0]);
    expect([padded.maxX - padded.minX, padded.maxY - padded.minY]).toEqual([82, 62]);
  });

  it('studCentersOf: la griglia nel rettangolo esatto della faccia ridotto del margine', () => {
    const p = normalizePattern(params({ kind: 'studs', margin: 0 }));
    const { rect, centers } = studCentersOf(p, p.faces[0]);
    expect(centers).toEqual(studCenters(rect, studs));
    expect(studCentersOf({ ...p, margin: 20 }, p.faces[0]).centers.length).toBeLessThan(centers.length);
    // Faccia laterale: rettangolo di 60 × 5, una sola colonna; con un raggio più grande della metà del lato corto nessuna borchia
    expect(studCentersOf(p, faceFromBounds(bounds, 'x+')).centers).toHaveLength(5);
    expect(studCentersOf({ ...p, relief: { ...studs, radius: 3 } }, faceFromBounds(bounds, 'x+')).centers).toEqual([]);
  });

  it('avvisi: borchie troppo vicine o troppo piccole per la stampa, nessuno con i valori di partenza', () => {
    const w = (relief: Partial<StudParams>) => reliefWarnings(params({ kind: 'studs', relief: { ...studs, ...relief } }));
    expect(w({})).toEqual([]);
    // Passo 5 con raggio 2,5: le basi si toccano (servono 2 · 2,5 + 0,8 = 5,8)
    const close = w({ pitch: 5 });
    expect(close).toHaveLength(1);
    expect(close[0]).toContain('troppo vicine');
    expect(close[0]).toContain('5,8');
    expect(w({ pitch: 5.8 })).toEqual([]);
    expect(w({ pitch: 5.79 })).toHaveLength(1);
    // Raggio sotto 1 mm o altezza sotto 0,4 mm
    expect(w({ radius: 0.8, pitch: 12 })[0]).toContain('troppo piccole');
    expect(w({ height: 0.3 })[0]).toContain('troppo piccole');
    // Entrambi i problemi: due avvisi
    expect(w({ pitch: 2, radius: 0.9 })).toHaveLength(2);
    // Vale per le forme e le griglie, non per i tipi a celle
    expect(reliefWarnings(params({ kind: 'studs', design: 'pyramid', relief: { ...studs, pitch: 5, layout: 'staggered' } }))).toHaveLength(1);
    expect(reliefWarnings(params({ kind: 'hexagon' }))).toEqual([]);
  });
});
