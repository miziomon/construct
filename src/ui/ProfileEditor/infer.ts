import { addConstraint } from './dimensions';
import type { NodeRef, ProfileGeometry } from './model';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';

/**
 * Vincoli dedotti durante il disegno (tappa 4 dello studio quote, come in Fusion): se il segmento appena disegnato è
 * (quasi) orizzontale o verticale, se è (quasi) perpendicolare al segmento che lo precede, o se il nuovo nodo cade su un
 * altro nodo, il vincolo si aggiunge da solo. Questo modulo propone i candidati e li applica: ogni candidato passa da
 * `addConstraint`, quindi uno in conflitto con i vincoli che ci sono (o ridondante) semplicemente non si aggiunge. Le funzioni
 * lavorano su contorni con gli id dei nodi (`normalizeProfile` prima), e non risolvono mai niente al caricamento: servono solo
 * ai gesti di disegno.
 */

/** Tolleranza angolare (gradi) sotto cui un segmento si considera orizzontale, verticale o perpendicolare. */
export const INFER_TOLERANCE_DEG = 3;
/** Distanza (mm) sotto cui due nodi sono lo stesso punto. */
const SAME_POINT = 1e-6;

/** Un candidato: un vincolo senza id (l'id lo dà `addConstraint`). */
export type Candidate = Omit<ProfileConstraint, 'id'>;

/** Se il segmento a→b è orizzontale o verticale entro `tolDeg` gradi; null altrimenti (o se è lungo zero). */
export function directionKind(a: Vec2, b: Vec2, tolDeg: number = INFER_TOLERANCE_DEG): 'horizontal' | 'vertical' | null {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  if (Math.hypot(dx, dy) < 1e-9) return null;
  // Angolo dalla retta orizzontale, in gradi, tra 0 e 90 (la direzione non conta, solo la retta)
  const fromHorizontal = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  if (fromHorizontal <= tolDeg) return 'horizontal';
  return fromHorizontal >= 90 - tolDeg ? 'vertical' : null;
}

/** Angolo (gradi, tra 0 e 180) tra due direzioni. */
function between(u: Vec2, v: Vec2): number {
  const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/**
 * I vincoli che il nodo appena aggiunto `ref` suggerisce, rispetto al nodo che lo precede nel contorno:
 * - segmento orizzontale o verticale entro la tolleranza: Orizzontale o Verticale;
 * - altrimenti, se c'è un segmento prima e l'angolo tra i due è 90 gradi entro la tolleranza: Perpendicolare (un segmento
 *   quasi parallelo al precedente è una prosecuzione: non si deduce nulla);
 * - se cade su un altro nodo (di qualunque contorno, non quello che lo precede): Coincidente.
 * Senza nodo precedente (il primo punto di un contorno) restano solo i coincidenti.
 */
export function inferNodeConstraints(paths: PathContour[], ref: NodeRef, tolDeg: number = INFER_TOLERANCE_DEG): Candidate[] {
  const contour = paths[ref.path];
  const node = contour?.nodes[ref.node];
  if (!contour || !node?.id) return [];
  const out: Candidate[] = [];
  const prev = ref.node > 0 ? contour.nodes[ref.node - 1] : undefined;
  if (prev?.id) {
    const kind = directionKind(prev.p, node.p, tolDeg);
    if (kind) out.push({ t: kind, p: [prev.id, node.id] });
    else {
      const before = ref.node > 1 ? contour.nodes[ref.node - 2] : undefined;
      if (before?.id) {
        const [u, v]: [Vec2, Vec2] = [[prev.p[0] - before.p[0], prev.p[1] - before.p[1]], [node.p[0] - prev.p[0], node.p[1] - prev.p[1]]];
        if (Math.hypot(...u) > 1e-9 && Math.hypot(...v) > 1e-9 && Math.abs(between(u, v) - 90) <= tolDeg) out.push({ t: 'perpendicular', p: [before.id, prev.id, prev.id, node.id] });
      }
    }
  }
  // Un altro nodo nello stesso punto (il nodo precedente no: sarebbe un segmento lungo zero)
  for (const [pi, c] of paths.entries()) {
    for (const [ni, other] of c.nodes.entries()) {
      if (!other.id || other.id === node.id || other.id === prev?.id || (pi === ref.path && ni === ref.node)) continue;
      if (Math.hypot(other.p[0] - node.p[0], other.p[1] - node.p[1]) < SAME_POINT) {
        out.push({ t: 'coincident', p: [node.id, other.id] });
        return out;
      }
    }
  }
  return out;
}

/**
 * Orizzontali e verticali di un contorno appena disegnato (il rettangolo): ogni lato esattamente orizzontale o verticale
 * (entro 1e-6 gradi: le forme base nascono sugli assi) diventa un vincolo. Un contorno senza id o con un lato obliquo
 * dà solo i lati giusti.
 */
export function inferShapeConstraints(paths: PathContour[], contour: number): Candidate[] {
  const c = paths[contour];
  if (!c) return [];
  const out: Candidate[] = [];
  const count = c.closed ? c.nodes.length : c.nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const [a, b] = [c.nodes[i], c.nodes[(i + 1) % c.nodes.length]];
    const kind = a.id && b.id ? directionKind(a.p, b.p, 1e-6) : null;
    if (kind) out.push({ t: kind, p: [a.id as string, b.id as string] });
  }
  return out;
}

/**
 * Aggiunge i candidati uno dopo l'altro, ognuno risolvendo il disegno: quelli che andrebbero in conflitto con ciò che c'è, o
 * che sarebbero ridondanti, si saltano. Restituisce il disegno con i vincoli aggiunti (e i nodi spostati dal risolutore: un
 * segmento quasi orizzontale diventa davvero orizzontale), lo stesso oggetto se non se n'è aggiunto nessuno.
 */
export function applyInferred<T extends ProfileGeometry>(d: T, candidates: Candidate[]): T {
  let current = d;
  for (const candidate of candidates) {
    const result = addConstraint(current, candidate);
    if (result.ok) current = result.draft;
  }
  return current;
}
