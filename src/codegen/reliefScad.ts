import { brickPitch, craterList, dentList, grainDepth, normalizeRelief, plankLayout, reliefDepth, sampleGrid, studCenters, studGrid, studHeight, studProfile } from '../scene/relief';
import type { HeightGrid, ReliefParams } from '../scene/relief';
import type { Rect, Vec2 } from '../scene/voronoi';
import type { HeightSide, ReliefEngine } from '../kernel/relief';

/**
 * Codice OpenSCAD delle texture in rilievo (studio di fattibilità, non ancora collegato al generatore dell'app).
 * Il motore CSG scrive le celle (o i loop parametrici) e le operazioni; la mappa di altezze scrive un `polyhedron` con i
 * valori della griglia. Il codice è nel riferimento della faccia (faccia su z = 0): il chiamante lo sposta e ruota come per
 * i Pattern. Stesse costanti del kernel (`ABOVE`, `EMBED`, `FLOOR`).
 */
const ABOVE = 0.5;
const EMBED = 0.2;
const FLOOR = 0.02;

/** Numero con al più due decimali, senza zeri inutili. */
const n = (v: number) => String(Math.round(v * 100) / 100);
const vec = (v: number[]) => `[${v.map(n).join(', ')}]`;

/** Modulo della calotta concava (usato da ruggine e rame): rivoluzione dell'arco con la stessa formula del kernel. */
const DENT_MODULE = [
  'module dent(r, d) {',
  '  R = (r * r + d * d) / (2 * d);',
  '  a = asin(min(1, r / R));',
  '  rotate_extrude($fn = 24) polygon(concat([for (k = [0 : 4]) let (t = a * k / 4) [R * sin(t), R - d - R * cos(t)]], [[r, 0.5], [0, 0.5]]));',
  '}',
];

/**
 * `polyhedron` chiuso della griglia, con lo stesso schema del kernel: superficie, un gemello sul piano `planeZ` per ogni
 * vertice del bordo (pareti verticali a quadrilateri), ventaglio di chiusura dal centro del piano. I valori di `zmap` sono
 * centesimi di mm interi (un terzo di caratteri in meno dei decimali) e `pts` li divide per 100.
 */
export function polyhedronLines(grid: HeightGrid, planeZ: number, side: HeightSide): string[] {
  const { nx, ny, x0, y0, dx, dy, z } = grid;
  const rows: string[] = [];
  for (let j = 0; j < ny; j++) rows.push(`  [${Array.from(z.subarray(j * nx, (j + 1) * nx), (v) => Math.round(v * 100)).join(',')}]`);
  const plane = n(planeZ);
  return [
    `nx = ${nx}; ny = ${ny}; x0 = ${x0}; y0 = ${y0}; dx = ${dx}; dy = ${dy};`,
    '// Quote in centesimi di mm',
    'zmap = [',
    rows.join(',\n'),
    '];',
    'N = nx * ny;',
    'function v(i, j) = j * nx + i;',
    '// Bordo della griglia in senso antiorario: lato basso, destro, alto, sinistro (senza ripetere gli angoli)',
    'per = concat([for (i = [0 : nx - 1]) v(i, 0)], [for (j = [1 : ny - 1]) v(nx - 1, j)], [for (i = [nx - 2 : -1 : 0]) v(i, ny - 1)], [for (j = [ny - 2 : -1 : 1]) v(0, j)]);',
    'P = len(per);',
    `pts = concat([for (j = [0 : ny - 1]) for (i = [0 : nx - 1]) [x0 + i * dx, y0 + j * dy, zmap[j][i] / 100]], [for (s = per) [x0 + (s % nx) * dx, y0 + floor(s / nx) * dy, ${plane}]], [[x0 + (nx - 1) * dx / 2, y0 + (ny - 1) * dy / 2, ${plane}]]);`,
    '// Facce con i vertici in ordine antiorario visti da fuori (come nel kernel); OpenSCAD le vuole orarie, quindi t() le rovescia',
    `function t(a, b, c) = ${side === 'above' ? '[a, b, c]' : '[a, c, b]'};`,
    'faces = concat(',
    '  [for (j = [0 : ny - 2]) for (i = [0 : nx - 2]) each [t(v(i, j), v(i + 1, j), v(i + 1, j + 1)), t(v(i, j), v(i + 1, j + 1), v(i, j + 1))]],',
    '  [for (k = [0 : P - 1]) let (m = (k + 1) % P) each [t(per[m], per[k], N + k), t(per[m], N + k, N + m), t(N + P, N + m, N + k)]]',
    ');',
    'polyhedron(pts, faces, convexity = 10);',
  ];
}

/** Rettangoli come `square` posizionati: elenco [x0, y0, x1, y1] e un ciclo che li disegna. */
function boxesLines(name: string, boxes: number[][]): string[] {
  return [`${name} = [`, boxes.map((b) => `  ${vec(b)}`).join(',\n'), '];'];
}

/**
 * Modulo `relief()` con il codice OpenSCAD della texture nel motore dato; `step` è il passo della mappa di altezze.
 * Per le borchie `centers` (facoltativo) sono i centri effettivamente scritti, per esempio quelli rimasti dentro la
 * regione (`studsInRegion` del kernel): se mancano vale la griglia centrata, scritta con due cicli.
 */
export function reliefScad(rect: Rect, params: ReliefParams, engine: ReliefEngine, step = 0.5, centers?: Vec2[]): string {
  const p = normalizeRelief(params);
  if (engine === 'hybrid' && p.kind !== 'wood') throw new Error(`Motore 'hybrid' non disponibile per la texture '${p.kind}'`);
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  const out: string[] = [`// Texture in rilievo: ${p.kind}, motore ${engine}`];

  if (p.kind === 'studs') {
    const list = centers ?? studCenters(rect, p);
    if (list.length === 0) return [...out, 'module relief() {}'].join('\n');
    if (engine === 'heightmap') {
      const height = studHeight(rect, p, list);
      const grid = sampleGrid(rect, step, (x, y) => Math.max(height(x, y), -FLOOR));
      out.push('module relief() {', ...polyhedronLines(grid, -EMBED, 'below').map((l) => `  ${l}`), '}');
    } else {
      out.push(`stud_profile = [${studProfile(p).map((q) => `[${q.map((v) => Math.round(v * 10000) / 10000).join(', ')}]`).join(', ')}, [${n(p.radius)}, ${n(-EMBED)}], [0, ${n(-EMBED)}]];`);
      if (centers) {
        // Centri scelti dal chiamante: un elenco, una riga per borchia
        out.push('studs = [', list.map((c) => `  ${vec(c)}`).join(',\n'), '];', 'module relief() {', '  for (c = studs) translate([c[0], c[1], 0]) rotate_extrude($fn = 24) polygon(stud_profile);', '}');
      } else {
        // Griglia centrata e tutta dentro il rettangolo: due cicli, nessun dato
        const g = studGrid(rect, p);
        out.push(
          'module relief() {',
          `  for (i = [0 : ${g.cols - 1}], j = [0 : ${g.rows - 1}])`,
          `    translate([${n(g.x0)} + i * ${n(g.pitch)}, ${n(g.y0)} + j * ${n(g.pitch)}, 0]) rotate_extrude($fn = 24) polygon(stud_profile);`,
          '}',
        );
      }
    }
    return out.join('\n');
  }

  if (engine === 'heightmap' || (engine === 'hybrid' && p.kind === 'wood')) {
    // Legno 'hybrid': la mappa contiene solo la venatura (le fughe sono in CSG), altrimenti tutta la profondità
    const depth = engine === 'hybrid' && p.kind === 'wood' ? grainDepth(rect, p) : reliefDepth(rect, p);
    const grid = sampleGrid(rect, step, (x, y) => FLOOR - depth(x, y));
    out.push('module relief_map() {', ...polyhedronLines(grid, ABOVE + 1, 'above').map((l) => `  ${l}`), '}');
    if (engine === 'heightmap') {
      out.push('module relief() relief_map();');
      return out.join('\n');
    }
  }

  if (p.kind === 'brick') {
    const [px, py] = brickPitch(p);
    out.push(
      'module relief() {',
      `  translate([${n(rect.minX)}, ${n(rect.minY)}, ${n(-p.depth)}]) linear_extrude(${n(p.depth + ABOVE)}) difference() {`,
      `    square([${n(w)}, ${n(h)}]);`,
      `    for (r = [0 : ${Math.ceil(h / py) - 1}], c = [0 : ${Math.ceil(w / px)}])`,
      `      translate([c * ${n(px)} - (r % 2) * ${n(px / 2)} + ${n(p.mortar / 2)}, r * ${n(py)} + ${n(p.mortar / 2)}]) square([${n(p.brickW)}, ${n(p.brickH)}]);`,
      '  }',
      '}',
    );
  } else if (p.kind === 'wood') {
    const planks = plankLayout(rect, p).flat().map((pl) => pl.box.map((v, k) => (k % 2 === 0 ? v - rect.minX : v - rect.minY)));
    out.push(
      ...boxesLines('planks', planks),
      'module relief() {',
      `  translate([${n(rect.minX)}, ${n(rect.minY)}, ${n(-p.gapDepth)}]) linear_extrude(${n(p.gapDepth + ABOVE)}) difference() {`,
      `    square([${n(w)}, ${n(h)}]);`,
      '    for (b = planks) translate([b[0], b[1]]) square([b[2] - b[0], b[3] - b[1]]);',
      '  }',
      ...(engine === 'hybrid' ? ['  relief_map();'] : []),
      '}',
    );
  } else if (p.kind === 'rust' || p.kind === 'hammered') {
    // Solo CSG: calotte (per la ruggine senza ruvidità, che in CSG non si può scrivere)
    const dents = p.kind === 'rust' ? craterList(rect, p).map((c) => [c.x, c.y, c.r, c.d]) : dentList(rect, p).map((d) => [d.x, d.y, d.r, d.d]);
    out.push(
      ...DENT_MODULE,
      'dents = [',
      dents.map((d) => `  ${vec(d)}`).join(',\n'),
      '];',
      'module relief() {',
      ...(p.kind === 'rust' ? [`  translate([${n(rect.minX)}, ${n(rect.minY)}, ${n(-p.baseDepth)}]) cube([${n(w)}, ${n(h)}, ${n(p.baseDepth + ABOVE)}]);`] : []),
      `  for (d = dents) translate([d[0], d[1], ${p.kind === 'rust' ? n(-p.baseDepth) : 0}]) dent(d[2], d[3]);`,
      '}',
    );
  }
  return out.join('\n');
}
