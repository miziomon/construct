import type { ArrayParams, Binding, CornerNode, EdgeNode, GroupNode, MeshNode, PatternParams, PrimitiveNode, Scene, SceneNode, Shape2DNode, ShellParams, Vec3 } from '../scene/types';
import { cavityOf, openName, SHELL_OPEN_MARGIN } from '../scene/shell';
import { cornerCutter } from '../scene/cornerProfile';
import { isCutter } from '../scene/treatment';
import { composeTransform, round } from '../scene/math';
import type { Mirror, Transform } from '../scene/math';
import { CORNER_SPHERE_SEGMENTS, twistDivisions } from '../scene/defaults';
import { edgeProfile, endMargin, endOvershoot, endPlanesOf, halfSpaceMatrix, hasPerpendicularEnds } from '../scene/edgeProfile';
import { resolveEnds } from '../scene/edgeEnds';
import { stretchFactors } from '../scene/ellipse';
import { isScaled, scaleOf } from '../scene/groupScale';
import { circularStep, linearStep, normalizeArray } from '../scene/arrayPattern';
import { cutReach, faceFrame, frameRect, isAxisFace, normalizePattern, patternCells } from '../scene/pattern';
import { isRotational, pathContours, revolveParams, shapeContours, svgContours } from '../scene/shapes2d';
import { hasPlan, planSolid } from '../scene/planSolid';
import type { PlanSolid } from '../scene/planSolid';
import { encodePathMeta } from '../scene/bezier';
import { isProfileShape, profileContours } from '../scene/profiles';
import { fontInfo, fontsUsed, scadFontName } from '../scene/fontCatalog';
import { platesOf } from '../scene/plates';
import { dropBrokenBindings, resolveParams } from '../scene/params';
import { dieSolid, maxPolyhedronRadius, polygonMaxRadius, polygonShrunkRadius, polyhedronVertices, roundedPolyhedronCenters } from '../scene/polyhedra';

const IND = '  ';
const n = (v: number) => String(round(v, 4));
const vec = (v: readonly number[]) => `[${v.map(n).join(', ')}]`;

/** Nodo con campi legati a una formula. */
type Bound = { exprs?: Record<string, Binding> };

/**
 * Misura di un campo: se è legato a una formula esce la formula con i nomi dei parametri (tra parentesi se è un calcolo),
 * altrimenti il numero. Si usa solo dove il valore scritto coincide con quello del campo; dove è derivato esce il numero.
 */
function field(node: Bound | undefined, path: string, value: number): string {
  const expr = node?.exprs?.[path]?.expr.trim();
  if (!expr) return n(value);
  return /^(?:[A-Za-z_]\w*|\d+(?:\.\d+)?)$/.test(expr) ? expr : `(${expr})`;
}

/** Vettore di tre campi legati ("size.0", "size.1", "size.2") con le formule dove ci sono. */
const vecField = (node: Bound | undefined, key: string, v: readonly number[]) => `[${v.map((x, i) => field(node, `${key}.${i}`, x)).join(', ')}]`;

/** Vero se qualche componente del vettore ha una formula. */
const hasBound = (node: Bound, key: string) => [0, 1, 2].some((i) => node.exprs?.[`${key}.${i}`]);

/** Vettori per riga negli elenchi lunghi (points, centri delle sfere). */
const VECTORS_PER_LINE = 3;

/** Colore "#rrggbb" in vettore RGB 0..1 per color() di OpenSCAD. */
function rgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '[0.3, 0.64, 1]';
  return vec([1, 2, 3].map((i) => parseInt(m[i], 16) / 255).map((v) => round(v, 3)));
}

/** Elenco di vettori su più righe (tre per riga), rientrato di due livelli rispetto al comando che lo contiene. */
function vectorRows(vectors: readonly number[][], indent: string): string[] {
  const rows: string[] = [];
  for (let i = 0; i < vectors.length; i += VECTORS_PER_LINE) {
    const last = i + VECTORS_PER_LINE >= vectors.length;
    rows.push(`${indent}${vectors.slice(i, i + VECTORS_PER_LINE).map(vec).join(', ')}${last ? '' : ','}`);
  }
  return rows;
}

/** Riga `scale(...)` per le forme non proporzionali (ellissi ed ellissoidi), se serve. */
function stretchLine(p: PrimitiveNode | Shape2DNode): string[] {
  const f = stretchFactors(p);
  if (!f) return [];
  // Le forme 2D hanno solo gli assi X e Y
  return [`scale(${vec(p.type === 'shape2d' ? f.slice(0, 2) : f)})`];
}

/**
 * Comandi OpenSCAD della sola primitiva, centrata nell'origine: un comando per riga, dal modificatore più esterno
 * al primitivo (che chiude con ";"). Le righe che continuano un comando hanno un rientro in più.
 */
function primitiveLines(p: PrimitiveNode): string[] {
  switch (p.kind) {
    case 'box': {
      const r = Math.min(Math.max(0, p.cornerRadius ?? 0), (Math.min(...p.size) - 0.01) / 2);
      if (r <= 0) return [`cube(${vecField(p, 'size', p.size)}, center = true);`];
      // Scatola arrotondata: involucro convesso di otto sfere agli angoli
      const [hx, hy, hz] = p.size.map((v) => v / 2 - r);
      return [
        'hull()',
        `for (x = [${n(-hx)}, ${n(hx)}], y = [${n(-hy)}, ${n(hy)}], z = [${n(-hz)}, ${n(hz)}])`,
        'translate([x, y, z])',
        `sphere(r = ${n(r)}, $fn = ${CORNER_SPHERE_SEGMENTS});`,
      ];
    }
    case 'cylinder':
      return [...stretchLine(p), `cylinder(h = ${field(p, 'height', p.height)}, r = ${field(p, 'radius', p.radius)}, center = true, $fn = ${p.segments});`];
    case 'cone':
      return [...stretchLine(p), `cylinder(h = ${field(p, 'height', p.height)}, r1 = ${field(p, 'radiusBottom', p.radiusBottom)}, r2 = ${field(p, 'radiusTop', p.radiusTop)}, center = true, $fn = ${p.segments});`];
    case 'sphere':
      return [...stretchLine(p), `sphere(r = ${field(p, 'radius', p.radius)}, $fn = ${p.segments});`];
    case 'torus':
      return [`rotate_extrude($fn = ${p.segments})`, `translate([${field(p, 'majorRadius', p.majorRadius)}, 0])`, `circle(r = ${field(p, 'minorRadius', p.minorRadius)}, $fn = ${p.segments});`];
    case 'die': {
      const solid = dieSolid(p.faces);
      const r = Math.min(Math.max(0, p.cornerRadius), maxPolyhedronRadius(p.size));
      // Solido arrotondato: involucro convesso di sfere sui vertici del solido ridotto
      if (r > 0) {
        return [
          'hull()',
          'for (p = [',
          ...vectorRows(roundedPolyhedronCenters(solid, p.size, r), IND),
          '])',
          'translate(p)',
          `sphere(r = ${n(r)}, $fn = ${CORNER_SPHERE_SEGMENTS});`,
        ];
      }
      // Solido a spigoli vivi: involucro convesso dei vertici (hull() usa solo i punti, le facce indicate sono segnaposto)
      const points = polyhedronVertices(solid, p.size);
      return [
        'hull()',
        'polyhedron(',
        `${IND}points = [`,
        ...vectorRows(points, IND + IND),
        `${IND}],`,
        // Un solo elenco con tutti gli indici, a righe di 16 (il d30 ha 32 vertici: su una riga sola supererebbe i 100 caratteri)
        `${IND}faces = [[`,
        ...Array.from({ length: Math.ceil(points.length / 16) }, (_, row) => {
          const indices = points.slice(row * 16, row * 16 + 16).map((_, i) => row * 16 + i);
          return `${IND}${IND}${indices.join(', ')}${(row + 1) * 16 < points.length ? ',' : ''}`;
        }),
        `${IND}]]`,
        ');',
      ];
    }
  }
}

/**
 * Un profilo di Bézier sta tutto a destra dell'asse una volta spostato del raggio? Si guardano i numeri che si scrivono nel
 * codice (4 decimali, in interi per evitare gli errori dei decimali): se sì, e il contorno non cresce, `intersection()`
 * non serve. Nel dubbio si tiene.
 */
function pathFitsAxis(p: Extract<Shape2DNode, { kind: 'path' }>): boolean {
  const radius = Math.round(revolveParams(p).radius * 1e4);
  return (p.offset ?? 0) <= 0 && pathContours(p).every((c) => c.every(([x]) => Math.round(x * 1e4) + radius >= 0));
}

/**
 * Profilo ruotato lungo una sagoma: `polyhedron` con i punti e i triangoli della mesh del kernel (`planSolid`), le facce in
 * senso orario viste da fuori come vuole OpenSCAD, e con un angolo parziale l'intersezione con il settore. Il commento
 * `construct:plan` conserva la sagoma (la rilettura del file per ora non la ricostruisce).
 */
function planLines(p: Extract<Shape2DNode, { kind: 'path' }>, solid: PlanSolid): string[] {
  const { positions, indices } = solid.mesh;
  const points = Array.from({ length: positions.length / 3 }, (_, i) => [round(positions[i * 3], 4), round(positions[i * 3 + 1], 4), round(positions[i * 3 + 2], 4)]);
  const faces = Array.from({ length: indices.length / 3 }, (_, i) => [indices[i * 3], indices[i * 3 + 2], indices[i * 3 + 1]]);
  const poly = ['polyhedron(', `${IND}points = [`, ...vectorRows(points, IND + IND), `${IND}],`, `${IND}faces = [`, ...vectorRows(faces, IND + IND), `${IND}]`, ');'];
  const meta = `// construct:plan ${JSON.stringify(p.plan)}`;
  if (!solid.wedge) return [meta, ...poly];
  const { polygon, z0, z1 } = solid.wedge;
  return [
    meta,
    'intersection() {',
    ...poly.map((l) => IND + l),
    `${IND}translate([0, 0, ${n(z0)}])`,
    `${IND}linear_extrude(height = ${n(z1 - z0)})`,
    `${IND}polygon([`,
    ...vectorRows(polygon.map(([x, y]) => [round(x, 4), round(y, 4)]), IND + IND),
    `${IND}]);`,
    '}',
  ];
}

/**
 * Forma 2D estrusa: `linear_extrude` oppure, per l'estrusione rotazionale, `rotate_extrude`. In questo caso il profilo
 * si sposta di `radius` dall'asse e si tiene solo la parte con x >= 0 (come fa il kernel), perché OpenSCAD ignora le
 * forme che attraversano l'asse.
 */
function shape2dLines(p: Shape2DNode): string[] {
  const base = linearShape2dLines(p);
  // Contorno (offset 2D): subito dopo l'intestazione, quindi applicato al profilo già scalato (come nel kernel)
  const offset = p.offset ?? 0;
  const lines = offset === 0 ? base : [base[0], p.offsetJoin === 'sharp' ? `offset(delta = ${n(offset)})` : `offset(r = ${n(offset)}, $fn = 32)`, ...base.slice(1)];
  if (!isRotational(p)) return lines;
  // Rotazione lungo una sagoma (sperimentale): lo stesso solido del kernel, come poliedro
  const plan = hasPlan(p) ? planSolid(p) : null;
  if (plan && p.kind === 'path') return planLines(p, plan);
  const { angle, radius, segments } = revolveParams(p);
  // Profilo di Bézier tutto oltre l'asse: basta spostarlo, il ritaglio sarebbe superfluo (e il file si rilegge come Profilo)
  if (p.kind === 'path' && pathFitsAxis(p)) return [`rotate_extrude(angle = ${n(angle)}, $fn = ${segments})`, `translate([${n(radius)}, 0])`, ...lines.slice(1)];
  return [
    `rotate_extrude(angle = ${n(angle)}, $fn = ${segments})`,
    'intersection() {',
    `${IND}translate([${n(radius)}, 0])`,
    // Il primo elemento è l'intestazione di linear_extrude: il resto è il profilo 2D
    ...lines.slice(1).map((l) => `${IND}${l}`),
    `${IND}translate([0, -1000])`,
    `${IND}square([1000, 2000]);`,
    '}',
  ];
}

/**
 * Forma 2D estrusa in linea retta. In OpenSCAD la torsione positiva ruota in senso orario (regola della mano sinistra),
 * in manifold in senso antiorario: il segno si inverte per ottenere lo stesso solido.
 */
function linearShape2dLines(p: Shape2DNode): string[] {
  const extrude = `linear_extrude(height = ${field(p, 'height', p.height)}, center = true, twist = ${n(-p.twist)}, scale = ${n(p.scaleTop)}, slices = ${Math.max(1, twistDivisions(p.twist))})`;
  if (p.kind === 'circle') {
    const rc = Math.min(Math.max(0, p.cornerRadius ?? 0), polygonMaxRadius(p.radius, p.segments));
    // L'ellisse si ottiene scalando il profilo già arrotondato
    if (rc > 0) {
      return [extrude, ...stretchLine(p), `offset(r = ${n(rc)}, $fn = 32)`, `circle(r = ${n(polygonShrunkRadius(p.radius, p.segments, rc))}, $fn = ${p.segments});`];
    }
    return [extrude, ...stretchLine(p), `circle(r = ${field(p, 'radius', p.radius)}, $fn = ${p.segments});`];
  }
  if (p.kind === 'text') {
    // Il font si importa con `use <file.ttf>` in testa al file (il file sta accanto al codice); la centratura è quella
    // del kernel (orizzontale sull'avanzamento, verticale sull'ingombro dei glifi)
    const text = p.text.replace(/[\\"]/g, (c) => `\\${c}`);
    const spacing = p.spacing !== undefined && p.spacing !== 1 ? `, spacing = ${n(p.spacing)}` : '';
    return [extrude, `text("${text}", size = ${field(p, 'size', p.size)}${spacing}, font = "${scadFontName(fontInfo(p.font))}", halign = "center", valign = "center");`];
  }
  if (p.kind !== 'square') {
    // Forme poligonali, profilati e disegni SVG: un contorno, oppure più contorni (il foro dell'anello) con `paths`;
    // punti su più righe
    const contours = p.kind === 'svg' ? svgContours(p) : p.kind === 'path' ? pathContours(p) : isProfileShape(p) ? profileContours(p) : shapeContours(p);
    // Un SVG senza tracciati (file svuotato) non produce nulla
    if (contours.length === 0) return [extrude, 'square(0.01, center = true);'];
    const points = contours.flat();
    // Il profilo di Bézier porta i suoi nodi nel commento sulla riga prima di polygon(): il file si rilegge come Profilo
    const meta = p.kind === 'path' ? [`// construct:path ${encodePathMeta(p)}`] : [];
    if (contours.length === 1) return [extrude, ...meta, 'polygon([', ...vectorRows(points, IND), ']);'];
    let start = 0;
    const paths = contours.map((c) => {
      const indices = c.map((_, i) => start + i);
      start += c.length;
      return `[${indices.join(', ')}]`;
    });
    return [extrude, ...meta, 'polygon(points = [', ...vectorRows(points, IND), `], paths = [${paths.join(', ')}]);`];
  }
  const r = Math.min(Math.max(0, p.cornerRadius), (Math.min(p.width, p.depth) - 0.01) / 2);
  if (r > 0) return [extrude, `offset(r = ${n(r)}, $fn = 32)`, `square([${n(p.width - 2 * r)}, ${n(p.depth - 2 * r)}], center = true);`];
  return [extrude, `square([${field(p, 'width', p.width)}, ${field(p, 'depth', p.depth)}], center = true);`];
}

/**
 * Mesh importata. La geometria interna è ricentrata sull'ingombro: per ritrovare la posizione del file
 * originale si sposta di -origine. Il file va tenuto accanto al codice (stesso nome).
 */
function meshLines(p: MeshNode): string[] {
  const file = p.fileName.replace(/[\\"]/g, (c) => (c === '"' ? '' : '/'));
  return [...(p.scale === 1 ? [] : [`scale(${n(p.scale)})`]), `translate(${vec(p.origin.map((v) => -v))})`, `import("${file}");`];
}

/** Semispazio grande a sufficienza per ritagliare il taglierino (mm). */
const HALF_SPACE_SIZE = 1000;

/** Numero con più decimali, per le matrici dei piani di chiusura (un errore di 1e-4 sull'orientamento sposterebbe il piano). */
const fine = (v: number) => String(round(v, 6));

/**
 * Taglierino di un raccordo o di uno smusso: sezione 2D estrusa lungo lo spigolo (Z locale). Con le estremità
 * perpendicolari basta l'estrusione; con un piano di chiusura obliquo si estrude più lungo e si interseca con i
 * semispazi (equivalente di trimByPlane del kernel).
 */
function edgeLines(p: EdgeNode): string[] {
  const profile = edgeProfile(p);
  const polygon = `polygon([${profile.polygon.map(vec).join(', ')}]);`;
  const section = profile.circle
    ? ['difference() {', `${IND}polygon([${profile.polygon.map(vec).join(', ')}]);`, `${IND}translate(${vec(profile.circle.center)})`, `${IND}circle(r = ${n(profile.circle.radius)}, $fn = ${profile.circle.segments});`, '}']
    : [polygon];

  if (hasPerpendicularEnds(p)) {
    // Stessa abbondanza del kernel oltre le due estremità
    const over = endOvershoot(p);
    if (over === 0) return [`linear_extrude(height = ${n(p.length)})`, ...section];
    return [`translate([0, 0, ${n(-over)}])`, `linear_extrude(height = ${n(p.length + 2 * over)})`, ...section];
  }

  const margin = endMargin(p);
  const half = HALF_SPACE_SIZE;
  const spaces = endPlanesOf(p).flatMap((plane) => [
    `multmatrix([${halfSpaceMatrix(plane).map((row) => `[${row.map(fine).join(', ')}]`).join(', ')}])`,
    `translate([${-half}, ${-half}, ${-2 * half}])`,
    `cube(${2 * half});`,
  ]);
  return [
    'intersection() {',
    `${IND}translate([0, 0, ${n(-margin)}])`,
    `${IND}linear_extrude(height = ${n(p.length + 2 * margin)})`,
    ...section.map((l) => `${IND}${l}`),
    ...spaces.map((l) => `${IND}${l}`),
    '}',
  ];
}

/**
 * Taglierino di uno smusso angolare: involucro convesso del vertice (origine) e dei punti sugli spigoli, come per i
 * poliedri (`hull()` usa solo i punti: la faccia indicata è un segnaposto). Lo sferico sottrae la sfera tangente.
 */
function cornerLines(p: CornerNode): string[] {
  const cutter = cornerCutter(p);
  const hull = ['hull()', 'polyhedron(', `${IND}points = [`, ...vectorRows(cutter.points, IND + IND), `${IND}],`, `${IND}faces = [[${cutter.points.map((_, i) => i).join(', ')}]]`, ');'];
  if (!cutter.sphere) return hull;
  return ['difference() {', ...hull.map((l) => `${IND}${l}`), `${IND}translate(${vec(cutter.sphere.center)})`, `${IND}sphere(r = ${n(cutter.sphere.radius)}, $fn = ${cutter.sphere.segments});`, '}'];
}

/** Un `mirror()` per ogni asse specchiato (X, Y, Z). */
function mirrorLines(mirror?: Mirror): string[] {
  return (mirror ?? []).flatMap((on, axis) => (on ? [`mirror(${vec([axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0])})`] : []));
}

/** Modificatori di posizione e colore di un nodo, uno per riga. Gli hole non hanno colore (verranno sottratti). */
function transformLines(node: SceneNode): string[] {
  // OpenSCAD applica le trasformazioni da destra verso sinistra: translate esterno, rotate interno
  const lines = [`translate(${vecField(node, 'position', node.position)})`];
  if (node.rotation.some((v) => v !== 0) || hasBound(node, 'rotation')) lines.push(`rotate(${vecField(node, 'rotation', node.rotation)})`);
  // Lo specchio è il più interno (si applica per primo, come in x' = R·D·x + p)
  lines.push(...mirrorLines(node.mirror));
  // La scala di un gruppo ridimensionato è la più interna di tutte (x' = R·D·S·x + p)
  if (node.type === 'group' && isScaled(node)) lines.push(`scale(${vec(scaleOf(node))})`);
  // Il taglierino di un raccordo non si vede: non ha colore
  if (node.mode === 'solid' && !isCutter(node)) lines.push(`color(${rgb(node.color)})`);
  return lines;
}

/** Trasformazione già accumulata dai Raggruppa antenati (identità fuori da ogni Raggruppa). */
type Inherited = Transform;
const NO_TRANSFORM: Inherited = { position: [0, 0, 0], rotation: [0, 0, 0] };

/**
 * Righe di codice di un nodo: commento, modificatori e comandi, ognuno su una riga.
 * Un Raggruppa non produce codice proprio: ogni figlio esce come oggetto a sé, con la trasformazione dei gruppi
 * antenati composta con la propria (`inherited`) e il proprio colore. Dentro una booleana (`free` falso) un
 * Raggruppa è invece una semplice unione dei figli.
 */
function nodeLines(scene: Scene, node: SceneNode, depth: number, inherited: Inherited = NO_TRANSFORM, free = true): string[] {
  const pad = IND.repeat(depth);
  // Le formule di posizione e rotazione valgono solo senza Raggruppa antenati: altrimenti il valore esce composto, in numeri
  const direct = inherited === NO_TRANSFORM ? node.exprs : undefined;

  if (free && node.type === 'group' && node.op === 'group') {
    // Un Raggruppa ridimensionato: la scala non si compone nelle trasformazioni dei figli, quindi i figli stanno dentro
    // un blocco con la trasformazione del gruppo (e la sua scala) e non ereditano altro
    if (isScaled(node)) {
      const placed = inherited === NO_TRANSFORM ? node : composeTransform(inherited, node);
      const head = transformLines({ ...node, position: placed.position.map((v) => round(v)) as Vec3, rotation: placed.rotation.map((v) => round(v)) as Vec3, mirror: placed.mirror, mode: 'hole', exprs: direct })
        .map((l) => `${pad}${l}`);
      head[head.length - 1] += ' {';
      return [`${pad}// ${node.name} (gruppo ridimensionato: oggetti separati)`, ...head, ...node.children.flatMap((c) => nodeLines(scene, scene.nodes[c], depth + 1, NO_TRANSFORM, true)), `${pad}}`];
    }
    const here = composeTransform(inherited, node);
    return [`${pad}// ${node.name} (gruppo: oggetti separati)`, ...node.children.flatMap((c) => nodeLines(scene, scene.nodes[c], depth, here, true))];
  }

  const out: string[] = [`${pad}// ${node.name}${node.mode === 'hole' ? ' (foro)' : ''}`];
  // La trasformazione effettiva è quella dei Raggruppa antenati composta con la propria
  // (senza gruppi antenati si usa la trasformazione del nodo così com'è, senza ricalcolare gli angoli)
  const placed = inherited === NO_TRANSFORM ? node : composeTransform(inherited, node);
  const head = transformLines({ ...node, position: placed.position.map((v) => round(v)) as Vec3, rotation: placed.rotation.map((v) => round(v)) as Vec3, mirror: placed.mirror, exprs: direct }).map((l) => `${pad}${l}`);

  if (node.type === 'group') {
    out.push(...groupLines(scene, node, head, depth));
    return out;
  }
  const body = node.type === 'primitive' ? primitiveLines(node) : node.type === 'shape2d' ? shape2dLines(node) : node.type === 'edge' ? edgeLines({ ...node, ends: resolveEnds(scene, node) }) : node.type === 'corner' ? cornerLines(node) : meshLines(node);
  out.push(...head, ...body.map((l) => `${pad}${l}`));
  return out;
}

/**
 * Cavità di un Guscio come comandi OpenSCAD (da mettere come secondo figlio di un `difference()`), oppure null se le
 * pareti non entrano nel solido. Stessa cavità del kernel (`cavityOf`), così codice e anteprima coincidono.
 */
function shellCavityLines(scene: Scene, child: SceneNode, shell: ShellParams, depth: number): string[] | null {
  const pad = IND.repeat(depth);
  const cavity = cavityOf(scene, child, shell);
  if (cavity.kind === 'error') return null;
  // La cavità sta dove sta il figlio: stessa traslazione e stessa rotazione
  const place = [
    `${pad}translate(${vec(child.position)})`,
    ...(child.rotation.some((v) => v !== 0) ? [`${pad}rotate(${vec(child.rotation)})`] : []),
    ...mirrorLines(child.mirror).map((l) => `${pad}${l}`),
  ];
  const label = `${pad}// cavità del guscio (laterale ${n(shell.wall)} mm, fondo ${n(shell.bottom)} mm, aperto su ${openName(shell.open)})`;

  if (cavity.kind === 'exact') {
    // Forma ridotta, alzata dello `offset` lungo Z locale
    const node = cavity.node;
    const body = node.type === 'primitive' ? primitiveLines(node) : shape2dLines(node);
    return [label, ...place, `${pad}translate(${vec(cavity.offset)})`, ...body.map((l) => `${pad}${l}`)];
  }

  if (cavity.kind === 'parts') {
    // Una cavità esatta per ogni solido dell'unione, ciascuna nella posizione del suo solido
    const parts = cavity.parts.flatMap((part) => [
      `${IND}translate(${vec(part.position)})`,
      ...(part.rotation.some((v) => v !== 0) ? [`${IND}rotate(${vec(part.rotation)})`] : []),
      ...mirrorLines(part.mirror).map((l) => `${IND}${l}`),
      `${IND}translate(${vec(part.offset)})`,
      ...(part.node.type === 'primitive' ? primitiveLines(part.node) : shape2dLines(part.node)).map((l) => `${IND}${l}`),
    ]);
    return [`${label} (una per solido: tra i solidi uniti resta una parete interna)`, `${pad}union() {`, ...parts.map((l) => `${pad}${l}`), `${pad}}`];
  }

  if (cavity.kind === 'prism') {
    // Sezione del solido a metà altezza (projection con cut), ristretta di w (offset 2D) ed estrusa dal fondo alla cima
    const floor = cavity.z0 + shell.bottom;
    return [
      `${label} (sezione ristretta: pareti uniformi anche ai giunti)`,
      `${pad}translate(${vec([0, 0, floor])})`,
      `${pad}linear_extrude(height = ${n(cavity.z1 + SHELL_OPEN_MARGIN - floor)})`,
      `${pad}offset(delta = ${n(-shell.wall)})`,
      `${pad}projection(cut = true)`,
      `${pad}translate(${vec([0, 0, -cavity.zMid])})`,
      ...nodeLines(scene, child, depth, NO_TRANSFORM, false),
    ];
  }

  // Cavità scalata (le trasformazioni si leggono dal basso verso l'alto): il figlio senza posizione né rotazione,
  // spostato col perno nell'origine, scalato, riportato al perno e spostato dello spessore del fondo
  const [px, py, pz] = cavity.pivot;
  const [lx, ly, lz] = cavity.lift;
  const bare = { ...child, position: [0, 0, 0], rotation: [0, 0, 0], mirror: undefined, exprs: undefined } as SceneNode;
  return [
    label + ' (approssimata: oggetto scalato)',
    ...place,
    `${pad}translate(${vec([px + lx, py + ly, pz + lz])})`,
    `${pad}scale(${vec(cavity.scale)})`,
    `${pad}translate(${vec([-px, -py, -pz])})`,
    ...nodeLines(scene, bare, depth, NO_TRANSFORM, false),
  ];
}

/**
 * Codice di una Ripetizione con `for()`: lineare `translate(i * passo)`, griglia un `for` per asse con più di una copia,
 * circolare `rotate` attorno al centro (con le copie non ruotate: `translate(c) rotate(a) translate(-c) rotate(-a)`, che
 * equivale allo spostamento lungo la circonferenza). `child(depth)` restituisce le righe dell'originale a quel rientro.
 */
function arrayLines(params: ArrayParams, child: (depth: number) => string[], depth: number, node?: Bound): string[] {
  const p = normalizeArray(params);
  const out: string[] = [];
  /** Rientro di ogni blocco aperto, per chiuderli in ordine inverso. */
  const openLevels: number[] = [];
  let level = depth;
  const modifier = (text: string) => out.push(`${IND.repeat(level)}${text}`);
  const block = (text: string) => {
    out.push(`${IND.repeat(level)}${text} {`);
    openLevels.push(level);
    level++;
  };
  const first = p.includeOriginal ? 0 : 1;
  /** Ultimo indice di un conteggio: con la formula `(formula) - 1`, altrimenti il numero. */
  const countMinusOne = (path: string, count: number) => (node?.exprs?.[path] ? `${field(node, path, count)} - 1` : String(count - 1));
  if (p.kind === 'grid') {
    const names = ['i', 'j', 'k'];
    for (let a = 0; a < 3; a++) if (p.counts[a] > 1) block(`for (${names[a]} = [0 : ${countMinusOne(`array.counts.${a}`, p.counts[a])}])`);
    // Gli assi con una sola copia valgono sempre 0
    block(`translate([${[0, 1, 2].map((a) => (p.counts[a] > 1 ? `${names[a]} * ${field(node, `array.gridStep.${a}`, p.gridStep[a])}` : '0')).join(', ')}])`);
  } else if (p.kind === 'linear') {
    const d = linearStep(p);
    block(`for (i = [${first} : ${countMinusOne('array.count', p.count)}])`);
    // Con la distanza "Passo" il passo è il valore del campo; con "Totale" è derivato (diviso per le copie): numero
    const stepOf = (a: number) => (p.spacing === 'step' ? field(node, `array.step.${a}`, d[a]) : n(d[a]));
    block(`translate([i * ${stepOf(0)}, i * ${stepOf(1)}, i * ${stepOf(2)}])`);
  } else {
    const step = circularStep(p);
    const turn = (sign: string) => `rotate([${[0, 1, 2].map((a) => (a === p.axis ? `${sign}i * ${n(step)}` : '0')).join(', ')}])`;
    block(`for (i = [${first} : ${countMinusOne('array.count', p.count)}])`);
    modifier(`translate(${vecField(node, 'array.center', p.center)})`);
    modifier(turn(''));
    if (p.rotateCopies) {
      block(`translate(${vec(p.center.map((v) => -v))})`);
    } else {
      // Le copie restano orientate come l'originale: si annulla la rotazione attorno all'origine dell'oggetto
      modifier(`translate(${vec(p.center.map((v) => -v))})`);
      block(turn('-'));
    }
  }
  out.push(...child(level));
  for (const l of openLevels.reverse()) out.push(`${IND.repeat(l)}}`);
  return out;
}

/**
 * Codice di un Pattern: le celle già calcolate dal generatore (prima della riduzione) in `cells`, poi le stesse operazioni
 * del kernel fatte da OpenSCAD (parete e arrotondamento con `offset`, regione con `projection`, margine con `offset`).
 * Il taglio di ogni faccia si costruisce nel suo riferimento e si riporta nel riferimento del pezzo. `child(depth)` dà le righe
 * del pezzo a quel rientro.
 */
function patternLines(params: PatternParams, child: (depth: number) => string[], depth: number): string[] {
  const p = normalizePattern(params);
  const pad = IND.repeat(depth);
  const at = (d: number, text: string) => `${IND.repeat(d)}${text}`;
  const through = p.depth <= 0;
  const out: string[] = [];

  // Le celle di ogni faccia, già calcolate dal generatore (con più facce un elenco per faccia)
  const names = p.faces.map((_, i) => (p.faces.length > 1 ? `cells_${i + 1}` : 'cells'));
  p.faces.forEach((face, i) => {
    const cells = patternCells(p, frameRect(p, face), i);
    out.push(
      `${pad}// Pattern ${p.kind}, seme ${p.seed + i}: ${cells.length} celle (poligoni nel riferimento della faccia ${i + 1})`,
      `${pad}${names[i]} = [`,
      ...cells.map((c, k) => `${pad}${IND}[${c.map((pt) => vec(pt)).join(', ')}]${k < cells.length - 1 ? ',' : ''}`),
      `${pad}];`,
    );
  });
  out.push(`${pad}difference() {`, ...child(depth + 1));

  // Un taglio per faccia: dal riferimento della faccia a quello del pezzo
  p.faces.forEach((face, i) => {
    const frame = faceFrame(face);
    // Faccia inclinata: regione = contorno della faccia e taglio da un solo lato (come nel kernel)
    const axisFace = isAxisFace(face);
    let d = depth + 1;
    out.push(at(d, `translate(${vec(frame.origin)}) rotate(${vec(frame.inverseEuler)}) {`));
    d++;
    if (through) {
      out.push(at(d, `linear_extrude(height = ${n(2 * cutReach(p, face))}, center = true)`));
    } else if (p.sides === 'both' && axisFace) {
      // Dalla faccia e dalla faccia opposta (a `thickness` sotto): stessa profondità
      out.push(at(d, `for (z = [${n(-p.depth)}, ${n(-face.thickness - 1)}]) translate([0, 0, z]) linear_extrude(height = ${n(p.depth + 1)})`));
    } else {
      out.push(at(d, `translate([0, 0, ${n(-p.depth)}]) linear_extrude(height = ${n(p.depth + 1)})`));
    }
    d++;

    // Disegno 2D: Fori = celle dentro la regione, Solchi = regione meno le celle
    const shrink = n(p.wall / 2 + p.rounding);
    const cellShape = `for (c = ${names[i]}) ${p.rounding > 0 ? `offset(r = ${n(p.rounding)}, $fn = 32) ` : ''}offset(delta = -${shrink}) polygon(c);`;
    const regionHead = `${p.margin > 0 ? `offset(delta = -${n(p.margin)}) ` : ''}${through && axisFace ? 'projection()' : 'projection(cut = true) translate([0, 0, 0.01])'}`;
    const region = [
      at(d + 1, `${regionHead} rotate(${vec(frame.euler)}) translate(${vec(frame.origin.map((v) => -v))}) {`),
      ...child(d + 2),
      at(d + 1, '}'),
    ];
    if (p.mode === 'holes') {
      out.push(at(d - 1, 'intersection() {'), at(d, cellShape), ...region, at(d - 1, '}'));
    } else {
      out.push(at(d - 1, 'difference() {'), ...region, at(d, cellShape), at(d - 1, '}'));
    }
    out.push(at(d - 2, '}'));
  });
  out.push(`${pad}}`);
  return out;
}

function groupLines(scene: Scene, g: GroupNode, head: string[], depth: number): string[] {
  const pad = IND.repeat(depth);
  const kids = g.children.map((c) => scene.nodes[c]);
  // Un Raggruppa dentro una booleana è una unione di tutti i figli e non ha fori
  const asUnion = g.op === 'group';
  const solids = kids.filter((k) => asUnion || k.mode === 'solid');
  const holes = asUnion ? [] : kids.filter((k) => k.mode === 'hole');
  const body = (list: SceneNode[], d: number) => list.flatMap((k) => nodeLines(scene, k, d, NO_TRANSFORM, false));
  // L'ultima riga dei modificatori apre il blocco
  const open = [...head.slice(0, -1), `${head[head.length - 1]} {`];

  // DIFFERENZA: il primo figlio meno gli altri, indipendentemente dal modo solid/hole
  if (g.op === 'difference') {
    return [...open, `${pad}${IND}difference() {`, ...body(kids, depth + 2), `${pad}${IND}}`, `${pad}}`];
  }

  // RIPETIZIONE: l'originale dentro i for() di OpenSCAD, uno per asse (griglia) o uno solo (lineare e circolare)
  if (g.op === 'array' && g.array && kids.length === 1) return [...open, ...arrayLines(g.array, (d) => body(kids, d), depth + 1, g), `${pad}}`];

  // PATTERN: il pezzo meno il disegno (celle Voronoi, esagoni, cerchi) oppure il pezzo ritagliato sul reticolo 3D
  if (g.op === 'pattern' && g.pattern && kids.length === 1) return [...open, ...patternLines(g.pattern, (d) => body(kids, d), depth + 1), `${pad}}`];

  // GUSCIO: il solido meno la sua cavità. Se la cavità non esiste (pareti troppo spesse) esce il solido pieno,
  // come nel kernel
  if (g.op === 'shell' && g.shell && kids.length === 1) {
    const cavity = shellCavityLines(scene, kids[0], g.shell, depth + 2);
    if (cavity) return [...open, `${pad}${IND}difference() {`, ...body(kids, depth + 2), ...cavity, `${pad}${IND}}`, `${pad}}`];
    return [...open, ...body(kids, depth + 1), `${pad}}`];
  }

  // UNIONE, INTERSEZIONE, INVILUPPO CONVESSO e MINKOWSKI: blocco dei solid combinati; se ci sono hole, difference(solids, holes)
  const combine = g.op === 'intersection' ? 'intersection' : g.op === 'hull' ? 'hull' : g.op === 'minkowski' ? 'minkowski' : 'union';
  const lines: string[] = [...open];
  if (holes.length) {
    lines.push(`${pad}${IND}difference() {`);
    lines.push(`${pad}${IND}${IND}${combine}() {`, ...body(solids, depth + 3), `${pad}${IND}${IND}}`);
    lines.push(...body(holes, depth + 2), `${pad}${IND}}`);
  } else {
    lines.push(`${pad}${IND}${combine}() {`, ...body(solids, depth + 2), `${pad}${IND}}`);
  }
  lines.push(`${pad}}`);
  return lines;
}

/** Intestazione del modulo di un piatto: l'importazione di un file .scad la riconosce per ritrovare i nomi dei piatti. */
export const plateComment = (index: number, name: string) => `// === Piatto ${index}: ${name} ===`;

/**
 * Genera il codice OpenSCAD dell'intera scena. Gli hole alla radice non producono geometria. Con più piatti ognuno è un
 * `module piatto_N()` e i moduli sono richiamati affiancati lungo X di `plateSpacing` mm, come nell'esportazione 3MF.
 */
export function sceneToOpenScad(source: Scene, options: { plateSpacing?: number } = {}): string {
  // I campi con una formula che non si calcola (parametro rotto o mancante) escono come numeri: il codice resta valido
  const { values } = resolveParams(source.params);
  const scene = dropBrokenBindings(source, values);
  // Un `use <font.ttf>` per ogni font del testo: i file TTF stanno nella stessa cartella del codice (vedi l'export ZIP)
  const fontLines = fontsUsed(scene).map((f) => `use <${f.file}>;`);
  // Parametri come variabili, in ordine di dipendenza (quelli in errore non si scrivono). Il blocco `[Parametri]` li mostra
  // nel Customizer di OpenSCAD; una nota diventa il commento che lo precede
  const paramLines = Object.keys(values).flatMap((name) => {
    const param = scene.params!.find((p) => p.name === name)!;
    return [...(param.note?.trim() ? [`// ${param.note.trim().replace(/\s+/g, ' ')}`] : []), `${name} = ${param.expr.trim()};`];
  });
  const header = [
    '// Generato da Construct. Unità: millimetri.',
    ...(fontLines.length ? ['// I font usati dal testo (file .ttf) devono stare nella stessa cartella di questo file.', ...fontLines] : []),
    ...(paramLines.length ? ['', '/* [Parametri] */', ...paramLines] : []),
    '',
  ];
  const solidsOf = (rootIds: string[]) => rootIds.map((id) => scene.nodes[id]).filter((nd) => nd.mode === 'solid');
  const plates = platesOf(scene);
  if (plates.length > 1) {
    // Un modulo per piatto, poi i richiami: il primo al suo posto, gli altri spostati di `plateSpacing` ciascuno
    const spacing = options.plateSpacing ?? 276;
    const modules = plates.flatMap((p, i) => {
      const roots = solidsOf(p.rootIds);
      const body = roots.length ? roots.flatMap((nd) => nodeLines(scene, nd, 1)) : [`${IND}// Piatto vuoto`];
      return [plateComment(i + 1, p.name), `module piatto_${i + 1}() {`, ...body, '}', ''];
    });
    const calls = plates.map((_, i) => (i === 0 ? 'piatto_1();' : `translate([${n(i * spacing)}, 0, 0]) piatto_${i + 1}();`));
    return [...header, ...modules, `// I piatti sono affiancati lungo X di ${n(spacing)} mm, come nel 3MF: per vederne uno solo lascia il suo richiamo.`, ...calls].join('\n') + '\n';
  }
  const roots = solidsOf(scene.rootIds);
  if (!roots.length) return [...header, '// Scena vuota'].join('\n') + '\n';
  const lines = roots.flatMap((nd) => [...nodeLines(scene, nd, 0), '']);
  return [...header, ...lines].join('\n').trimEnd() + '\n';
}
