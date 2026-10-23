import { describe, expect, it } from 'vitest';
import {
  brickDepth,
  brickLayout,
  copperDepth,
  craterList,
  dentList,
  fbm,
  grainDepth,
  MAX_GRID_NODES,
  MAX_STUDS,
  normalizeRelief,
  plankLayout,
  reliefDefaults,
  rustDepth,
  sampleGrid,
  studCenters,
  studHeight,
  studProfile,
  valueNoise,
} from './relief';
import type { BrickParams, HammeredParams, RustParams, StudParams, WoodParams } from './relief';

/** Faccia 80 × 60 mm centrata nell'origine, come nei test del kernel. */
const RECT = { minX: -40, minY: -30, maxX: 40, maxY: 30 };

const brick = reliefDefaults('brick') as BrickParams;
const wood = reliefDefaults('wood') as WoodParams;
const rust = reliefDefaults('rust') as RustParams;
const studs = reliefDefaults('studs') as StudParams;
const hammered = reliefDefaults('hammered') as HammeredParams;

/** Deviazione standard dei valori. */
const stdDev = (values: ArrayLike<number>) => {
  const list = Array.from(values);
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  return Math.sqrt(list.reduce((a, b) => a + (b - mean) ** 2, 0) / list.length);
};

describe('rumore', () => {
  it('value noise e fBm sono deterministici, tra 0 e 1 e cambiano con il seme', () => {
    expect(valueNoise(1.3, 2.7, 5)).toBe(valueNoise(1.3, 2.7, 5));
    expect(valueNoise(1.3, 2.7, 5)).not.toBe(valueNoise(1.3, 2.7, 6));
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.37, i * 0.11, 3, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('è continuo: due punti vicinissimi hanno valori quasi uguali', () => {
    expect(Math.abs(fbm(3.2, 4.1, 1) - fbm(3.2001, 4.1, 1))).toBeLessThan(0.01);
  });
});

describe('limiti sui parametri', () => {
  it('le misure a zero o non finite tornano ai minimi e ai valori di partenza; i valori validi non cambiano', () => {
    const brickOk = normalizeRelief(brick);
    expect(brickOk).toEqual(brick);
    const bad = normalizeRelief({ ...brick, brickW: 0, brickH: -3, mortar: Number.NaN, depth: 0 });
    expect(bad.brickW).toBe(2);
    expect(bad.brickH).toBe(2);
    expect(bad.mortar).toBe(brick.mortar);
    expect(bad.depth).toBe(0.05);
    expect(normalizeRelief({ ...studs, pitch: 0, radius: 0 }).pitch).toBe(2);
    expect(normalizeRelief({ ...wood, plankW: 0, plankL: 0, gap: 0 })).toMatchObject({ plankW: 2, plankL: 5, gap: 0.2 });
    expect(normalizeRelief({ ...rust, craterDensity: 1e9, flakes: 7 })).toMatchObject({ craterDensity: 20, flakes: 1 });
  });

  it('i generatori con misure a zero terminano e restituiscono elenchi finiti', () => {
    expect(brickLayout(RECT, { ...brick, brickW: 0, brickH: 0, mortar: 0 }).length).toBeGreaterThan(0);
    expect(plankLayout(RECT, { ...wood, plankW: 0, plankL: 0, gap: 0 }).flat().length).toBeGreaterThan(0);
    expect(studCenters(RECT, { ...studs, pitch: 0 }).length).toBeLessThanOrEqual(MAX_STUDS * 1.1);
    expect(dentList(RECT, { ...hammered, size: 0 }).length).toBeLessThanOrEqual(500);
  });

  it('la mappa di altezze ha un tetto di nodi: il passo si allarga', () => {
    const big = sampleGrid({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, 0.3, () => 0);
    expect(big.nx * big.ny).toBeLessThanOrEqual(MAX_GRID_NODES * 1.05);
    // Passo non valido: si usa quello di partenza e il minimo
    expect(() => sampleGrid({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0, () => 0)).not.toThrow();
    // Rettangolo vuoto o non finito: errore chiaro invece di una griglia infinita
    expect(() => sampleGrid({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, 0.5, () => 0)).toThrow();
  });
});

describe('mattoni', () => {
  const boxes = brickLayout(RECT, brick);

  it("mattoni della misura data, con la fuga tra uno e l'altro", () => {
    for (const [x0, y0, x1, y1] of boxes) {
      expect(x1 - x0).toBeCloseTo(brick.brickW, 6);
      expect(y1 - y0).toBeCloseTo(brick.brickH, 6);
    }
    // Primo e secondo mattone della prima fila: li separa la fuga
    expect(boxes[1][0] - boxes[0][2]).toBeCloseTo(brick.mortar, 6);
  });

  it('le file sono sfalsate di mezzo mattone', () => {
    const firstOfRow = (y: number) => Math.min(...boxes.filter((b) => Math.abs(b[1] - y) < 1e-6).map((b) => b[0]));
    const rowY = [...new Set(boxes.map((b) => b[1]))].sort((a, b) => a - b);
    const pitch = brick.brickW + brick.mortar;
    expect(Math.abs(firstOfRow(rowY[0]) - firstOfRow(rowY[1]))).toBeCloseTo(pitch / 2, 6);
    // Le file pari tornano allineate
    expect(firstOfRow(rowY[0])).toBeCloseTo(firstOfRow(rowY[2]), 6);
  });

  it('la funzione di profondità vale la profondità solo nelle fughe', () => {
    const depth = brickDepth(RECT, brick);
    const [x0, y0, x1, y1] = boxes[3];
    expect(depth((x0 + x1) / 2, (y0 + y1) / 2)).toBe(0);
    expect(depth(x1 + brick.mortar / 2, (y0 + y1) / 2)).toBe(brick.depth);
    expect(depth((x0 + x1) / 2, y1 + brick.mortar / 2)).toBe(brick.depth);
  });
});

describe('doghe e venature', () => {
  it('stesso seme, stesso layout; seme diverso, giunti diversi', () => {
    expect(plankLayout(RECT, wood)).toEqual(plankLayout(RECT, wood));
    expect(plankLayout(RECT, { ...wood, seed: 2 })).not.toEqual(plankLayout(RECT, wood));
  });

  it('le doghe distano la fuga e i giunti di file vicine non coincidono', () => {
    const rows = plankLayout(RECT, wood);
    for (const row of rows) {
      for (let i = 1; i < row.length; i++) expect(row[i].box[0] - row[i - 1].box[2]).toBeCloseTo(wood.gap, 6);
    }
    for (let r = 1; r < rows.length; r++) {
      const joints = (row: (typeof rows)[number]) => row.map((pl) => pl.box[2]);
      for (const a of joints(rows[r])) for (const b of joints(rows[r - 1])) expect(Math.abs(a - b)).toBeGreaterThan(1);
    }
  });

  it('la venatura è deterministica, profonda frazioni di mm e non liscia', () => {
    const a = sampleGrid(RECT, 0.5, grainDepth(RECT, wood));
    const b = sampleGrid(RECT, 0.5, grainDepth(RECT, wood));
    expect(a.z).toEqual(b.z);
    expect(Math.max(...a.z)).toBeLessThanOrEqual(wood.grainDepth + 1e-6);
    expect(Math.min(...a.z)).toBeGreaterThanOrEqual(0);
    expect(stdDev(a.z)).toBeGreaterThan(0.02);
    expect(sampleGrid(RECT, 0.5, grainDepth(RECT, { ...wood, seed: 9 })).z).not.toEqual(a.z);
  });

  it('con withGaps le fughe valgono la profondità della fuga', () => {
    const rows = plankLayout(RECT, wood);
    const gapY = rows[0][0].box[3] + wood.gap / 2;
    expect(grainDepth(RECT, wood, true)(0, gapY)).toBe(wood.gapDepth);
    expect(grainDepth(RECT, wood, false)(0, gapY)).toBe(0);
  });
});

describe('ruggine', () => {
  const grid = (p: RustParams) => sampleGrid(RECT, 0.4, rustDepth(RECT, p));

  it('stesso seme, stessa superficie; seme diverso, superficie diversa', () => {
    expect(grid(rust).z).toEqual(grid(rust).z);
    expect(grid({ ...rust, seed: 2 }).z).not.toEqual(grid(rust).z);
    expect(craterList(RECT, rust)).toEqual(craterList(RECT, rust));
    expect(craterList(RECT, { ...rust, seed: 2 })).not.toEqual(craterList(RECT, rust));
  });

  it('non è mai liscia: deviazione standard e salti tra campioni vicini sopra soglia', () => {
    const { z, nx, ny } = grid(rust);
    expect(stdDev(z)).toBeGreaterThan(0.08);
    // La quasi totalità dei campioni vicini differisce (nessun grande piano)
    let differing = 0;
    let pairs = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx - 1; i++) {
        pairs++;
        if (Math.abs(z[j * nx + i] - z[j * nx + i + 1]) > 0.001) differing++;
      }
    }
    expect(differing / pairs).toBeGreaterThan(0.8);
  });

  it('è ruvida e butterata in ogni riquadro di 5 × 5 mm (anche sfalsati di 2,5 mm), non solo in media (escursione di quota almeno 0,2 mm)', () => {
    const flat: string[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const flakes of [0, rust.flakes, 1]) {
        const depth = rustDepth(RECT, { ...rust, seed, flakes });
        for (let wy = RECT.minY + 2.5; wy < RECT.maxY - 5; wy += 2.5) {
          for (let wx = RECT.minX + 2.5; wx < RECT.maxX - 5; wx += 2.5) {
            // 13 × 13 campioni a passo 0,4 mm dentro il riquadro
            const values: number[] = [];
            for (let j = 0; j < 13; j++) for (let i = 0; i < 13; i++) values.push(depth(wx + i * 0.4, wy + j * 0.4));
            const range = Math.max(...values) - Math.min(...values);
            if (range < 0.2) flat.push(`seed ${seed} flakes ${flakes} (${wx}, ${wy}): ${range.toFixed(3)}`);
          }
        }
      }
    }
    expect(flat).toEqual([]);
  });

  it('profondità sempre almeno 0,05 mm e con più ruvidità aumenta la deviazione standard', () => {
    const calm = grid({ ...rust, roughness: 0.1, craterDensity: 0, flakes: 0 });
    const rough = grid({ ...rust, roughness: 0.5, craterDensity: 0, flakes: 0 });
    expect(Math.min(...calm.z)).toBeGreaterThanOrEqual(0.05);
    expect(stdDev(rough.z)).toBeGreaterThan(stdDev(calm.z) * 2);
  });

  it('i crateri scavano più della quota base e sono in numero proporzionale alla densità', () => {
    const craters = craterList(RECT, { ...rust, craterDensity: 2 });
    expect(craters.length).toBe(Math.round((2 * 80 * 60) / 100));
    const c = craters[0];
    const without = rustDepth(RECT, { ...rust, craterDensity: 0, flakes: 0 })(c.x, c.y);
    const withPits = rustDepth(RECT, { ...rust, craterDensity: 2, flakes: 0 })(c.x, c.y);
    expect(withPits).toBeGreaterThan(without);
  });
});

describe('borchie', () => {
  it('griglia centrata e borchie tutte intere dentro il rettangolo, deterministica', () => {
    const centers = studCenters(RECT, studs);
    // 7 colonne (x = -36, -24, ..., 36) per 5 file (y = -24, ..., 24)
    expect(centers.length).toBe(35);
    for (const [x, y] of centers) {
      expect(x - studs.radius).toBeGreaterThanOrEqual(RECT.minX);
      expect(x + studs.radius).toBeLessThanOrEqual(RECT.maxX);
      expect(y - studs.radius).toBeGreaterThanOrEqual(RECT.minY);
      expect(y + studs.radius).toBeLessThanOrEqual(RECT.maxY);
    }
    // Centrata: i margini a sinistra e a destra (e in basso e in alto) coincidono
    const xs = centers.map((c) => c[0]);
    const ys = centers.map((c) => c[1]);
    expect(Math.min(...xs) - RECT.minX).toBeCloseTo(RECT.maxX - Math.max(...xs), 6);
    expect(Math.min(...ys) - RECT.minY).toBeCloseTo(RECT.maxY - Math.max(...ys), 6);
    expect(studCenters(RECT, studs)).toEqual(centers);
  });

  it('nessuna borchia se la faccia è più stretta del diametro; il passo si allarga oltre il tetto di borchie', () => {
    expect(studCenters({ minX: 0, minY: 0, maxX: 4, maxY: 40 }, studs)).toEqual([]);
    expect(studCenters({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, { ...studs, pitch: 2 }).length).toBeLessThanOrEqual(MAX_STUDS * 1.1);
  });

  it('con borchie sovrapposte la mappa vale il massimo delle altezze e non disegna borchie che non esistono', () => {
    const dense = { ...studs, pitch: 3 };
    const centers = studCenters(RECT, dense);
    const height = studHeight(RECT, dense, centers);
    // Tra due centri a 3 mm (raggio 2,5) la quota è quella della più alta delle due calotte
    const [a, b] = centers;
    const mid = height((a[0] + b[0]) / 2, a[1]);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(dense.height);
    // Fuori dalla griglia (oltre il raggio dall'ultima borchia) niente spicchi
    const last = centers[centers.length - 1];
    expect(height(last[0] + dense.radius + 0.3, last[1])).toBe(0);
  });

  it("il profilo della calotta va dall'apice alla base e la funzione di altezza lo rispetta", () => {
    const profile = studProfile(studs);
    expect(profile[0][1]).toBeCloseTo(studs.height, 6);
    expect(profile[profile.length - 1]).toEqual([studs.radius, 0]);
    const [cx, cy] = studCenters(RECT, studs)[0];
    const height = studHeight(RECT, studs);
    expect(height(cx, cy)).toBeCloseTo(studs.height, 2);
    expect(height(cx + studs.radius + 0.5, cy)).toBe(0);
    // Tra due borchie la faccia resta piana
    expect(height(cx + studs.pitch / 2, cy)).toBe(0);
  });

  it('la borchia cilindrica ha tetto piatto e smusso', () => {
    const p = { ...studs, shape: 'chamfered' as const, chamfer: 0.5 };
    const profile = studProfile(p);
    expect(profile[1][1]).toBe(p.height);
    expect(profile[2]).toEqual([p.radius, p.height - 0.5]);
  });
});

describe('rame battuto', () => {
  it('stesse martellate con lo stesso seme, diverse con un altro; raggi e profondità variano', () => {
    const dents = dentList(RECT, hammered);
    expect(dentList(RECT, hammered)).toEqual(dents);
    expect(dentList(RECT, { ...hammered, seed: 2 })).not.toEqual(dents);
    expect(new Set(dents.map((d) => d.r.toFixed(3))).size).toBeGreaterThan(dents.length / 2);
    expect(new Set(dents.map((d) => d.d.toFixed(3))).size).toBeGreaterThan(dents.length / 2);
    for (const d of dents) {
      expect(d.d).toBeGreaterThan(0.05 - 1e-9);
      expect(d.d).toBeLessThanOrEqual(hammered.depth * (1 + hammered.jitter) + 1e-9);
    }
  });

  it('la profondità è la calotta sferica: massima al centro, nulla fuori dal bordo', () => {
    const [d] = dentList(RECT, hammered);
    const depth = copperDepth(RECT, hammered);
    expect(depth(d.x, d.y)).toBeGreaterThanOrEqual(d.d - 1e-6);
    const grid = sampleGrid(RECT, 0.5, depth);
    expect(Math.max(...grid.z)).toBeLessThanOrEqual(hammered.depth * (1 + hammered.jitter) + 1e-6);
    expect(stdDev(grid.z)).toBeGreaterThan(0.05);
  });
});
