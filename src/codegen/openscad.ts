import type { GroupNode, PrimitiveNode, Scene, SceneNode } from '../scene/types';
import { round } from '../scene/math';

const IND = '  ';
const n = (v: number) => String(round(v, 4));
const vec = (v: readonly number[]) => `[${v.map(n).join(', ')}]`;

/** Colore "#rrggbb" in vettore RGB 0..1 per color() di OpenSCAD. */
function rgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '[0.3, 0.64, 1]';
  return vec([1, 2, 3].map((i) => parseInt(m[i], 16) / 255).map((v) => round(v, 3)));
}

/** Istruzione OpenSCAD della sola primitiva, centrata nell'origine. */
function primitiveCode(p: PrimitiveNode): string {
  switch (p.kind) {
    case 'box':
      return `cube(${vec(p.size)}, center = true);`;
    case 'cylinder':
      return `cylinder(h = ${n(p.height)}, r = ${n(p.radius)}, center = true, $fn = ${p.segments});`;
    case 'cone':
      return `cylinder(h = ${n(p.height)}, r1 = ${n(p.radiusBottom)}, r2 = ${n(p.radiusTop)}, center = true, $fn = ${p.segments});`;
    case 'sphere':
      return `sphere(r = ${n(p.radius)}, $fn = ${p.segments});`;
    case 'torus':
      return `rotate_extrude($fn = ${p.segments}) translate([${n(p.majorRadius)}, 0]) circle(r = ${n(p.minorRadius)}, $fn = ${p.segments});`;
  }
}

/** Righe di codice di un nodo, con trasformazione e commento. Gli hole non hanno colore (verranno sottratti). */
function nodeLines(scene: Scene, node: SceneNode, depth: number): string[] {
  const pad = IND.repeat(depth);
  const out: string[] = [`${pad}// ${node.name}${node.mode === 'hole' ? ' (foro)' : ''}`];
  const hasRot = node.rotation.some((v) => v !== 0);
  // OpenSCAD applica le trasformazioni da destra verso sinistra: translate esterno, rotate interno
  const head = `${pad}translate(${vec(node.position)})${hasRot ? ` rotate(${vec(node.rotation)})` : ''}`;
  const colored = node.mode === 'solid' ? `color(${rgb(node.color)}) ` : '';

  if (node.type === 'primitive') {
    out.push(`${head} ${colored}${primitiveCode(node)}`);
    return out;
  }
  out.push(...groupLines(scene, node, head, colored, depth));
  return out;
}

function groupLines(scene: Scene, g: GroupNode, head: string, colored: string, depth: number): string[] {
  const pad = IND.repeat(depth);
  const kids = g.children.map((c) => scene.nodes[c]);
  const solids = kids.filter((k) => k.mode === 'solid');
  const holes = kids.filter((k) => k.mode === 'hole');
  const body = (list: SceneNode[], d: number) => list.flatMap((k) => nodeLines(scene, k, d));

  // Blocco dei solid combinati; se ci sono hole, difference(solids, holes)
  const combine = g.op === 'union' ? 'union' : 'intersection';
  const lines: string[] = [`${head} ${colored}{`];
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
