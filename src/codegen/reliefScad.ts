import { SCALE_ASPECT, brickLayout, brickPitch, craterList, dentList, facetList, fitBrick, grainDepth, normalizeRelief, pyramidPolyhedron, reliefDepth, sampleGrid, scaleList, studCenters, studGrid, studHeight, studProfile, woodBoxes } from '../scene/relief';
import type { BrickParams, HammeredParams, HeightGrid, ReliefParams, StudParams, WoodParams } from '../scene/relief';
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
  // Una riga per rettangolo (così chi indenta il codice rientra anche le righe dell'elenco)
  return [`${name} = [`, ...boxes.map((b, k) => `  ${vec(b)}${k < boxes.length - 1 ? ',' : ''}`), '];'];
}

/**
 * Mattoni: i dati (`bricks`, solo per spina di pesce e cesto) e il solido da sottrarre, in righe senza rientro, nel
 * riferimento della faccia. Il solido è il rettangolo meno i mattoni, esteso in profondità: è la stessa regione
 * `rettangolo - mattoni` del kernel, ma ancora non ritagliata sulla faccia (lo fa il chiamante). `id` suffissa i nomi dei dati,
 * così più facce di un Pattern non si pestano i piedi. Niente `module`: il chiamante inserisce le righe dove servono.
 */
export function brickScad(rect: Rect, params: BrickParams, id = ''): { data: string[]; solid: string[] } {
  const p = fitBrick(rect, params);
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  const head = `translate([${n(rect.minX)}, ${n(rect.minY)}, ${n(-p.depth)}]) linear_extrude(${n(p.depth + ABOVE)}) difference() {`;
  if (p.design === 'running') {
    // Mattoni sfalsati: due cicli, nessun dato
    const [px, py] = brickPitch(p);
    return {
      data: [],
      solid: [
        head,
        `  square([${n(w)}, ${n(h)}]);`,
        `  for (r = [0 : ${Math.ceil(h / py) - 1}], c = [0 : ${Math.ceil(w / px)}])`,
        `    translate([c * ${n(px)} - (r % 2) * ${n(px / 2)} + ${n(p.mortar / 2)}, r * ${n(py)} + ${n(p.mortar / 2)}]) square([${n(p.brickW)}, ${n(p.brickH)}]);`,
        '}',
      ],
    };
  }
  // Spina di pesce e cesto: un elenco, una riga per mattone (coordinate relative all'angolo del rettangolo)
  const bricks = brickLayout(rect, p).map((b) => b.map((v, k) => (k % 2 === 0 ? v - rect.minX : v - rect.minY)));
  return {
    data: boxesLines(`bricks${id}`, bricks),
    solid: [head, `  square([${n(w)}, ${n(h)}]);`, `  for (b = bricks${id}) translate([b[0], b[1]]) square([b[2] - b[0], b[3] - b[1]]);`, '}'],
  };
}

/**
 * Borchie: i dati (`studs`, l'elenco dei centri già calcolato, e `stud_profile` per le forme di rivoluzione) e il solido da
 * unire, in righe senza rientro, nel riferimento della faccia. Cupola e cilindro smussato sono `rotate_extrude` dello stesso
 * profilo del kernel (24 segmenti), la piramide è il `polyhedron` del kernel (`pyramidPolyhedron`, con i triangoli rovesciati
 * perché OpenSCAD li vuole orari). `id` suffissa i nomi dei dati, per più facce di un Pattern.
 */
export function studScad(params: StudParams, centers: Vec2[], id = '', embed = EMBED): { data: string[]; solid: string[] } {
  const p = normalizeRelief(params);
  // Quattro decimali: la stessa precisione con cui il kernel calcola il profilo
  const n4 = (v: number) => String(Math.round(v * 10000) / 10000);
  const data = [`studs${id} = [`, ...centers.map((c, k) => `  [${c.map(n4).join(', ')}]${k < centers.length - 1 ? ',' : ''}`), '];'];
  if (p.shape === 'pyramid') {
    const { points, faces } = pyramidPolyhedron(p.radius, p.height, embed);
    const pts = points.map((q) => `[${q.map(n4).join(', ')}]`).join(', ');
    const tris = faces.map((f) => `[${[...f].reverse().join(', ')}]`).join(', ');
    return { data, solid: [`for (c = studs${id}) translate([c[0], c[1], 0]) polyhedron(points = [${pts}], faces = [${tris}]);`] };
  }
  data.push(`stud_profile${id} = [${studProfile(p).map((q) => `[${q.map(n4).join(', ')}]`).join(', ')}, [${n4(p.radius)}, ${n4(-embed)}], [0, ${n4(-embed)}]];`);
  return { data, solid: [`for (c = studs${id}) translate([c[0], c[1], 0]) rotate_extrude($fn = 24) polygon(stud_profile${id});`] };
}

/**
 * Come `polyhedronLines` ma senza `function` né `module` (in OpenSCAD non si possono definire dentro un blocco di un
 * operatore, come quello del Pattern): solo assegnazioni, tutte con il suffisso `id`. Restituisce i dati e l'istruzione `polyhedron`.
 * Stessa mesh del kernel: superficie, pareti verticali a quadrilateri e ventaglio di chiusura sul piano `planeZ`.
 */
export function polyhedronInline(grid: HeightGrid, planeZ: number, side: HeightSide, id = ''): { data: string[]; solid: string[] } {
  const { nx, ny, x0, y0, dx, dy, z } = grid;
  const rows: string[] = [];
  for (let j = 0; j < ny; j++) rows.push(`  [${Array.from(z.subarray(j * nx, (j + 1) * nx), (v) => Math.round(v * 100)).join(',')}]${j < ny - 1 ? ',' : ''}`);
  const plane = n(planeZ);
  // I triangoli del kernel sono antiorari visti da fuori e OpenSCAD li vuole orari: per il materiale sopra la superficie vale l'ordine base
  const tri = (a: string, b: string, c: string) => (side === 'above' ? `[${a}, ${b}, ${c}]` : `[${a}, ${c}, ${b}]`);
  const [NX, NY, X0, Y0, DX, DY, ZMAP, N, PER, P, PTS, FACES] = ['nx', 'ny', 'x0', 'y0', 'dx', 'dy', 'zmap', 'N', 'per', 'P', 'pts', 'faces'].map((name) => `${name}${id}`);
  return {
    data: [
      `${NX} = ${nx}; ${NY} = ${ny}; ${X0} = ${x0}; ${Y0} = ${y0}; ${DX} = ${dx}; ${DY} = ${dy};`,
      '// Quote in centesimi di mm',
      `${ZMAP} = [`,
      ...rows,
      '];',
      `${N} = ${NX} * ${NY};`,
      '// Bordo della griglia in senso antiorario: lato basso, destro, alto, sinistro (senza ripetere gli angoli)',
      `${PER} = concat([for (i = [0 : ${NX} - 1]) i], [for (j = [1 : ${NY} - 1]) j * ${NX} + ${NX} - 1], [for (i = [${NX} - 2 : -1 : 0]) (${NY} - 1) * ${NX} + i], [for (j = [${NY} - 2 : -1 : 1]) j * ${NX}]);`,
      `${P} = len(${PER});`,
      `${PTS} = concat([for (j = [0 : ${NY} - 1]) for (i = [0 : ${NX} - 1]) [${X0} + i * ${DX}, ${Y0} + j * ${DY}, ${ZMAP}[j][i] / 100]], [for (s = ${PER}) [${X0} + (s % ${NX}) * ${DX}, ${Y0} + floor(s / ${NX}) * ${DY}, ${plane}]], [[${X0} + (${NX} - 1) * ${DX} / 2, ${Y0} + (${NY} - 1) * ${DY} / 2, ${plane}]]);`,
      `${FACES} = concat(`,
      `  [for (j = [0 : ${NY} - 2]) for (i = [0 : ${NX} - 2]) let (a = j * ${NX} + i, b = a + 1, c = a + ${NX} + 1, d = a + ${NX}) each [${tri('a', 'b', 'c')}, ${tri('a', 'c', 'd')}]],`,
      `  [for (k = [0 : ${P} - 1]) let (m = (k + 1) % ${P}, p0 = ${PER}[k], p1 = ${PER}[m]) each [${tri('p1', 'p0', `${N} + k`)}, ${tri('p1', `${N} + k`, `${N} + m`)}, ${tri(`${N} + ${P}`, `${N} + m`, `${N} + k`)}]]`,
      ');',
    ],
    solid: [`polyhedron(${PTS}, ${FACES}, convexity = 10);`],
  };
}

/**
 * Legno: i dati e il solido da sottrarre (righe senza rientro, nel riferimento della faccia). Doghe e listelli: le fughe come
 * `rettangolo - elenco` estruso (CSG) e, se `engine` non è 'csg' e c'è la venatura, la mappa di altezze della venatura in
 * `union()`. Tavola unica: la sola mappa (venatura e nodi). `id` suffissa i nomi dei dati. Stessa griglia (`sampleGrid`) del kernel.
 */
export function woodScad(rect: Rect, params: WoodParams, engine: ReliefEngine, step = 0.5, id = ''): { data: string[]; solid: string[] } {
  const p = normalizeRelief(params);
  const data: string[] = [];
  const parts: string[][] = [];
  const boxes = woodBoxes(rect, p).map((wb) => wb.box.map((v, k) => (k % 2 === 0 ? v - rect.minX : v - rect.minY)));
  if (boxes.length) {
    data.push(...boxesLines(`planks${id}`, boxes));
    parts.push([
      `translate([${n(rect.minX)}, ${n(rect.minY)}, ${n(-p.gapDepth)}]) linear_extrude(${n(p.gapDepth + ABOVE)}) difference() {`,
      `  square([${n(rect.maxX - rect.minX)}, ${n(rect.maxY - rect.minY)}]);`,
      `  for (b = planks${id}) translate([b[0], b[1]]) square([b[2] - b[0], b[3] - b[1]]);`,
      '}',
    ]);
  }
  if (engine !== 'csg' && p.grainDepth > 0) {
    const depth = grainDepth(rect, p);
    const grid = sampleGrid(rect, step, (x, y) => FLOOR - depth(x, y));
    const poly = polyhedronInline(grid, ABOVE + 1, 'above', id);
    data.push(...poly.data);
    parts.push(poly.solid);
  }
  // Una sola parte: così com'è; due: in unione
  return { data, solid: parts.length === 1 ? parts[0] : parts.length === 0 ? ['union() {}'] : ['union() {', ...parts.flat().map((l) => `  ${l}`), '}'] };
}

/**
 * Rame battuto: i dati e il solido da sottrarre (righe senza rientro, nel riferimento della faccia). Martellato e scaglie:
 * l'elenco `dents = [[x, y, r, d]]` e una calotta per `rotate_extrude` dello stesso arco del kernel (5 punti, 24 segmenti),
 * stirata in Y per le scaglie. Sfaccettato: l'elenco `facets` dei vertici (x, y, z) di ogni cella e un `polyhedron` convesso per
 * cella (fondo e coperchio a ventaglio, lati verticali), come nel kernel. Niente `module` né `let` di geometria.
 */
export function hammeredScad(rect: Rect, params: HammeredParams, id = ''): { data: string[]; solid: string[] } {
  const p = normalizeRelief(params);
  const n4 = (v: number) => String(Math.round(v * 10000) / 10000);
  const lines = (name: string, items: string[]) => [`${name} = [`, ...items.map((item, k) => `  ${item}${k < items.length - 1 ? ',' : ''}`), '];'];
  if (p.design === 'facets') {
    const facets = facetList(rect, p);
    const f = `facets${id}`;
    // Con `len(f[...])` al posto di una variabile locale: vale in ogni punto in cui si può scrivere un `for`
    const points = `concat([for (v = c) v], [for (v = c) [v[0], v[1], ${n4(ABOVE)}]])`;
    const k = 'len(c)';
    const faces = `concat([for (i = [1 : ${k} - 2]) [0, i, i + 1]], [for (i = [1 : ${k} - 2]) [${k}, ${k} + i + 1, ${k} + i]], [for (i = [0 : ${k} - 1]) [${k} + i, ${k} + (i + 1) % ${k}, (i + 1) % ${k}, i]])`;
    return {
      data: lines(f, facets.map((facet) => `[${facet.ring.map((v) => `[${v.map(n4).join(', ')}]`).join(', ')}]`)),
      solid: [`for (c = ${f}) polyhedron(points = ${points}, faces = ${faces});`],
    };
  }
  const scales = p.design === 'scales';
  const caps = scales ? scaleList(rect, p).map((c) => [c.x, c.y, c.rx, c.d]) : dentList(rect, p).map((d) => [d.x, d.y, d.r, d.d]);
  const arc = `polygon(concat([for (k = [0 : 4]) let (r = d[2], h = d[3], R = (r * r + h * h) / (2 * h), t = asin(min(1, r / R)) * k / 4) [R * sin(t), R - h - R * cos(t)]], [[d[2], ${n4(ABOVE)}], [0, ${n4(ABOVE)}]]))`;
  return {
    data: lines(`dents${id}`, caps.map((c) => `[${c.map(n4).join(', ')}]`)),
    solid: [`for (d = dents${id}) translate([d[0], d[1], 0]) ${scales ? `scale([1, ${n4(SCALE_ASPECT)}, 1]) ` : ''}rotate_extrude($fn = 24) ${arc};`],
  };
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
    } else if (centers || p.shape === 'pyramid' || p.layout === 'staggered') {
      // Centri scelti dal chiamante, piramidi e file sfalsate: un elenco, una riga per borchia
      const { data, solid } = studScad(p, list);
      out.push(...data, 'module relief() {', ...solid.map((l) => `  ${l}`), '}');
    } else {
      // Griglia quadrata centrata e tutta dentro il rettangolo: due cicli, nessun dato
      const g = studGrid(rect, p);
      out.push(
        `stud_profile = [${studProfile(p).map((q) => `[${q.map((v) => Math.round(v * 10000) / 10000).join(', ')}]`).join(', ')}, [${n(p.radius)}, ${n(-EMBED)}], [0, ${n(-EMBED)}]];`,
        'module relief() {',
        `  for (i = [0 : ${g.cols - 1}], j = [0 : ${g.rows - 1}])`,
        `    translate([${n(g.x0)} + i * ${n(g.pitch)}, ${n(g.y0)} + j * ${n(g.pitch)}, 0]) rotate_extrude($fn = 24) polygon(stud_profile);`,
        '}',
      );
    }
    return out.join('\n');
  }

  if (engine === 'heightmap') {
    // Tutta la profondità (fughe comprese) in una mappa di altezze
    const depth = reliefDepth(rect, p);
    const grid = sampleGrid(rect, step, (x, y) => FLOOR - depth(x, y));
    out.push('module relief_map() {', ...polyhedronLines(grid, ABOVE + 1, 'above').map((l) => `  ${l}`), '}');
    out.push('module relief() relief_map();');
    return out.join('\n');
  }

  // Legno (fughe in CSG, venatura in mappa) e rame battuto (solo CSG): stessi generatori del Pattern, in un modulo
  if (p.kind === 'wood' || p.kind === 'hammered') {
    const { data, solid } = p.kind === 'wood' ? woodScad(rect, p, engine, step) : hammeredScad(rect, p);
    out.push(...data, 'module relief() {', ...solid.map((l) => `  ${l}`), '}');
    return out.join('\n');
  }

  if (p.kind === 'brick') {
    const { data, solid } = brickScad(rect, p);
    out.push(...data, 'module relief() {', ...solid.map((l) => `  ${l}`), '}');
  } else if (p.kind === 'rust') {
    // Solo CSG: calotte (per la ruggine senza ruvidità, che in CSG non si può scrivere)
    const dents = craterList(rect, p).map((c) => [c.x, c.y, c.r, c.d]);
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
