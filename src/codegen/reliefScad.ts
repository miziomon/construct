import { brickPitch, craterList, dentList, grainDepth, plankLayout, reliefDepth, sampleGrid, studCenters, studHeight, studProfile } from '../scene/relief';
import type { HeightGrid, ReliefParams } from '../scene/relief';
import type { Rect } from '../scene/voronoi';
import type { ReliefEngine } from '../kernel/relief';

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

/** `polyhedron` chiuso della griglia: superficie, piano di chiusura a `planeZ` e pareti (stesso schema del kernel, facce orarie visti da fuori). */
function polyhedronLines(grid: HeightGrid, planeZ: number): string[] {
  const { nx, ny, x0, y0, dx, dy, z } = grid;
  const rows: string[] = [];
  for (let j = 0; j < ny; j++) rows.push(`  [${Array.from(z.subarray(j * nx, (j + 1) * nx), n).join(',')}]`);
  const x1 = x0 + (nx - 1) * dx;
  const y1 = y0 + (ny - 1) * dy;
  // Piano sopra la superficie (solido da togliere) o sotto (solido da aggiungere): cambia il verso delle facce
  const above = planeZ > z[0];
  return [
    `nx = ${nx}; ny = ${ny}; x0 = ${n(x0)}; y0 = ${n(y0)}; dx = ${dx.toFixed(4)}; dy = ${dy.toFixed(4)};`,
    'zmap = [',
    rows.join(',\n'),
    '];',
    'N = nx * ny;',
    `pts = concat([for (j = [0 : ny - 1]) for (i = [0 : nx - 1]) [x0 + i * dx, y0 + j * dy, zmap[j][i]]], [[x0, y0, ${n(planeZ)}], [${n(x1)}, y0, ${n(planeZ)}], [${n(x1)}, ${n(y1)}, ${n(planeZ)}], [x0, ${n(y1)}, ${n(planeZ)}]]);`,
    'function v(i, j) = j * nx + i;',
    '// Facce con i vertici in ordine antiorario visti da fuori (come nel kernel); OpenSCAD le vuole orarie, quindi t() le rovescia',
    `function t(a, b, c) = ${above ? '[a, b, c]' : '[a, c, b]'};`,
    'faces = concat(',
    '  [for (j = [0 : ny - 2]) for (i = [0 : nx - 2]) each [t(v(i, j), v(i + 1, j), v(i + 1, j + 1)), t(v(i, j), v(i + 1, j + 1), v(i, j + 1))]],',
    '  [t(N + 1, N, N + 3), t(N + 1, N + 3, N + 2)],',
    '  [for (i = [1 : nx - 1]) t(N, v(i, 0), v(i - 1, 0)), t(N, N + 1, v(nx - 1, 0))],',
    '  [for (j = [1 : ny - 1]) t(N + 1, v(nx - 1, j), v(nx - 1, j - 1)), t(N + 1, N + 2, v(nx - 1, ny - 1))],',
    '  [for (i = [1 : nx - 1]) t(N + 2, v(nx - 1 - i, ny - 1), v(nx - i, ny - 1)), t(N + 2, N + 3, v(0, ny - 1))],',
    '  [for (j = [1 : ny - 1]) t(N + 3, v(0, ny - 1 - j), v(0, ny - j)), t(N + 3, N, v(0, 0))]',
    ');',
    'polyhedron(pts, faces, convexity = 10);',
  ];
}

/** Rettangoli come `square` posizionati: elenco [x0, y0, x1, y1] e un ciclo che li disegna. */
function boxesLines(name: string, boxes: number[][]): string[] {
  return [`${name} = [`, boxes.map((b) => `  ${vec(b)}`).join(',\n'), '];'];
}

/** Modulo `relief()` con il codice OpenSCAD della texture nel motore dato; `step` è il passo della mappa di altezze. */
export function reliefScad(rect: Rect, p: ReliefParams, engine: ReliefEngine, step = 0.5): string {
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  const out: string[] = [`// Texture in rilievo: ${p.kind}, motore ${engine}`];

  if (p.kind === 'studs') {
    if (engine === 'heightmap') {
      const height = studHeight(rect, p);
      const grid = sampleGrid(rect, step, (x, y) => Math.max(height(x, y), -FLOOR));
      out.push('module relief() {', ...polyhedronLines(grid, -EMBED).map((l) => `  ${l}`), '}');
    } else {
      const cols = studCenters(rect, p).filter(([, y]) => y === studCenters(rect, p)[0][1]).length;
      const rows = studCenters(rect, p).length / cols;
      out.push(
        `stud_profile = [${studProfile(p).map((q) => vec(q)).join(', ')}, [${n(p.radius)}, ${n(-EMBED)}], [0, ${n(-EMBED)}]];`,
        'module relief() {',
        `  for (i = [0 : ${cols - 1}], j = [0 : ${rows - 1}])`,
        `    translate([${n(rect.minX + p.pitch / 2)} + i * ${n(p.pitch)}, ${n(rect.minY + p.pitch / 2)} + j * ${n(p.pitch)}, 0]) rotate_extrude($fn = 24) polygon(stud_profile);`,
        '}',
      );
    }
    return out.join('\n');
  }

  if (engine === 'heightmap' || (engine === 'hybrid' && p.kind === 'wood')) {
    // Legno 'hybrid': la mappa contiene solo la venatura (le fughe sono in CSG), altrimenti tutta la profondità
    const depth = engine === 'hybrid' && p.kind === 'wood' ? grainDepth(rect, p) : reliefDepth(rect, p);
    const grid = sampleGrid(rect, step, (x, y) => FLOOR - depth(x, y));
    out.push('module relief_map() {', ...polyhedronLines(grid, ABOVE + 1).map((l) => `  ${l}`), '}');
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
