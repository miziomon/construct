import type { GroupNode, MeshNode, PrimitiveNode, Scene, SceneNode, Shape2DNode } from '../scene/types';
import { round } from '../scene/math';
import { CORNER_SPHERE_SEGMENTS, twistDivisions } from '../scene/defaults';
import { stretchFactors } from '../scene/ellipse';
import { maxPolyhedronRadius, polygonMaxRadius, polygonShrunkRadius, polyhedronVertices, roundedPolyhedronCenters } from '../scene/polyhedra';

const IND = '  ';
const n = (v: number) => String(round(v, 4));
const vec = (v: readonly number[]) => `[${v.map(n).join(', ')}]`;

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
      if (r <= 0) return [`cube(${vec(p.size)}, center = true);`];
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
      return [...stretchLine(p), `cylinder(h = ${n(p.height)}, r = ${n(p.radius)}, center = true, $fn = ${p.segments});`];
    case 'cone':
      return [...stretchLine(p), `cylinder(h = ${n(p.height)}, r1 = ${n(p.radiusBottom)}, r2 = ${n(p.radiusTop)}, center = true, $fn = ${p.segments});`];
    case 'sphere':
      return [...stretchLine(p), `sphere(r = ${n(p.radius)}, $fn = ${p.segments});`];
    case 'torus':
      return [`rotate_extrude($fn = ${p.segments})`, `translate([${n(p.majorRadius)}, 0])`, `circle(r = ${n(p.minorRadius)}, $fn = ${p.segments});`];
    case 'octahedron':
    case 'decahedron':
    case 'dodecahedron':
    case 'icosahedron': {
      const r = Math.min(Math.max(0, p.cornerRadius), maxPolyhedronRadius(p.size));
      // Solido arrotondato: involucro convesso di sfere sui vertici del solido ridotto
      if (r > 0) {
        return [
          'hull()',
          'for (p = [',
          ...vectorRows(roundedPolyhedronCenters(p.kind, p.size, r), IND),
          '])',
          'translate(p)',
          `sphere(r = ${n(r)}, $fn = ${CORNER_SPHERE_SEGMENTS});`,
        ];
      }
      // Solido a spigoli vivi: involucro convesso dei vertici (hull() usa solo i punti, le facce indicate sono segnaposto)
      const points = polyhedronVertices(p.kind, p.size);
      return [
        'hull()',
        'polyhedron(',
        `${IND}points = [`,
        ...vectorRows(points, IND + IND),
        `${IND}],`,
        `${IND}faces = [[${points.map((_, i) => i).join(', ')}]]`,
        ');',
      ];
    }
  }
}

/**
 * Forma 2D estrusa. In OpenSCAD la torsione positiva ruota in senso orario (regola della mano sinistra),
 * in manifold in senso antiorario: il segno si inverte per ottenere lo stesso solido.
 */
function shape2dLines(p: Shape2DNode): string[] {
  const extrude = `linear_extrude(height = ${n(p.height)}, center = true, twist = ${n(-p.twist)}, scale = ${n(p.scaleTop)}, slices = ${Math.max(1, twistDivisions(p.twist))})`;
  if (p.kind === 'circle') {
    const rc = Math.min(Math.max(0, p.cornerRadius ?? 0), polygonMaxRadius(p.radius, p.segments));
    // L'ellisse si ottiene scalando il profilo già arrotondato
    if (rc > 0) {
      return [extrude, ...stretchLine(p), `offset(r = ${n(rc)}, $fn = 32)`, `circle(r = ${n(polygonShrunkRadius(p.radius, p.segments, rc))}, $fn = ${p.segments});`];
    }
    return [extrude, ...stretchLine(p), `circle(r = ${n(p.radius)}, $fn = ${p.segments});`];
  }
  const r = Math.min(Math.max(0, p.cornerRadius), (Math.min(p.width, p.depth) - 0.01) / 2);
  if (r > 0) return [extrude, `offset(r = ${n(r)}, $fn = 32)`, `square([${n(p.width - 2 * r)}, ${n(p.depth - 2 * r)}], center = true);`];
  return [extrude, `square([${n(p.width)}, ${n(p.depth)}], center = true);`];
}

/**
 * Mesh importata. La geometria interna è ricentrata sull'ingombro: per ritrovare la posizione del file
 * originale si sposta di -origine. Il file va tenuto accanto al codice (stesso nome).
 */
function meshLines(p: MeshNode): string[] {
  const file = p.fileName.replace(/[\\"]/g, (c) => (c === '"' ? '' : '/'));
  return [...(p.scale === 1 ? [] : [`scale(${n(p.scale)})`]), `translate(${vec(p.origin.map((v) => -v))})`, `import("${file}");`];
}

/** Modificatori di posizione e colore di un nodo, uno per riga. Gli hole non hanno colore (verranno sottratti). */
function transformLines(node: SceneNode): string[] {
  // OpenSCAD applica le trasformazioni da destra verso sinistra: translate esterno, rotate interno
  const lines = [`translate(${vec(node.position)})`];
  if (node.rotation.some((v) => v !== 0)) lines.push(`rotate(${vec(node.rotation)})`);
  if (node.mode === 'solid') lines.push(`color(${rgb(node.color)})`);
  return lines;
}

/** Righe di codice di un nodo: commento, modificatori e comandi, ognuno su una riga. */
function nodeLines(scene: Scene, node: SceneNode, depth: number): string[] {
  const pad = IND.repeat(depth);
  const out: string[] = [`${pad}// ${node.name}${node.mode === 'hole' ? ' (foro)' : ''}`];
  const head = transformLines(node).map((l) => `${pad}${l}`);

  if (node.type === 'group') {
    out.push(...groupLines(scene, node, head, depth));
    return out;
  }
  const body = node.type === 'primitive' ? primitiveLines(node) : node.type === 'shape2d' ? shape2dLines(node) : meshLines(node);
  out.push(...head, ...body.map((l) => `${pad}${l}`));
  return out;
}

function groupLines(scene: Scene, g: GroupNode, head: string[], depth: number): string[] {
  const pad = IND.repeat(depth);
  const kids = g.children.map((c) => scene.nodes[c]);
  const solids = kids.filter((k) => k.mode === 'solid');
  const holes = kids.filter((k) => k.mode === 'hole');
  const body = (list: SceneNode[], d: number) => list.flatMap((k) => nodeLines(scene, k, d));
  // L'ultima riga dei modificatori apre il blocco
  const open = [...head.slice(0, -1), `${head[head.length - 1]} {`];

  // Differenza: il primo figlio meno gli altri, indipendentemente dal modo solid/hole
  if (g.op === 'difference') {
    return [...open, `${pad}${IND}difference() {`, ...body(kids, depth + 2), `${pad}${IND}}`, `${pad}}`];
  }

  // Blocco dei solid combinati; se ci sono hole, difference(solids, holes)
  const combine = g.op === 'union' ? 'union' : 'intersection';
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

/** Genera il codice OpenSCAD dell'intera scena. Gli hole alla radice non producono geometria. */
export function sceneToOpenScad(scene: Scene): string {
  const header = ['// Generato da WebCAD. Unità: millimetri.', ''];
  const roots = scene.rootIds.map((id) => scene.nodes[id]).filter((nd) => nd.mode === 'solid');
  if (!roots.length) return [...header, '// Scena vuota'].join('\n') + '\n';
  const lines = roots.flatMap((nd) => [...nodeLines(scene, nd, 0), '']);
  return [...header, ...lines].join('\n').trimEnd() + '\n';
}
