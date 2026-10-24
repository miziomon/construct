import { addConstraint } from './dimensions';
import type { NodeRef, ProfileGeometry } from './model';
import type { PathContour, PathNode, ProfileConstraint, Vec2 } from '../../scene/types';

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

/** Un segmento è curvo se una delle sue due maniglie (uscita del nodo di partenza, entrata di quello d'arrivo) non è nulla: orizzontale o perpendicolare non hanno senso sulle sue corde. */
const curved = (a: PathNode, b: PathNode): boolean => !!((a.out && (a.out[0] !== 0 || a.out[1] !== 0)) || (b.in && (b.in[0] !== 0 || b.in[1] !== 0)));

/** Angolo (gradi, tra 0 e 180) tra due direzioni. */
function between(u: Vec2, v: Vec2): number {
  const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/**
 * Il vincolo di direzione del segmento diritto `a`→`b`, con `before` il nodo che precede `a` (se c'è):
 * - orizzontale o verticale entro la tolleranza: Orizzontale o Verticale;
 * - altrimenti, se anche il segmento precedente è diritto e l'angolo tra i due è 90 gradi entro la tolleranza: Perpendicolare
 *   (un segmento quasi parallelo al precedente è una prosecuzione: non si deduce nulla).
 * Un segmento curvo (con maniglie) non dà nulla.
 */
function directionCandidate(before: PathNode | undefined, a: PathNode, b: PathNode, tolDeg: number): Candidate | null {
  if (!a.id || !b.id || curved(a, b)) return null;
  const kind = directionKind(a.p, b.p, tolDeg);
  if (kind) return { t: kind, p: [a.id, b.id] };
  if (!before?.id || curved(before, a)) return null;
  const [u, v]: [Vec2, Vec2] = [[a.p[0] - before.p[0], a.p[1] - before.p[1]], [b.p[0] - a.p[0], b.p[1] - a.p[1]]];
  if (Math.hypot(...u) > 1e-9 && Math.hypot(...v) > 1e-9 && Math.abs(between(u, v) - 90) <= tolDeg) return { t: 'perpendicular', p: [before.id, a.id, a.id, b.id] };
  return null;
}

/**
 * I vincoli che il nodo appena aggiunto `ref` suggerisce, rispetto al nodo che lo precede nel contorno:
 * - la direzione del segmento (Orizzontale, Verticale o Perpendicolare al precedente, solo per segmenti diritti: vedi
 *   `directionCandidate`), se `directions` è vero. Con un angolo digitato non servono: la quota dell'angolo già lo decide;
 * - se cade su un altro nodo (di qualunque contorno, non quello che lo precede): Coincidente.
 * Senza nodo precedente (il primo punto di un contorno) restano solo i coincidenti.
 */
export function inferNodeConstraints(paths: PathContour[], ref: NodeRef, tolDeg: number = INFER_TOLERANCE_DEG, directions = true): Candidate[] {
  const contour = paths[ref.path];
  const node = contour?.nodes[ref.node];
  if (!contour || !node?.id) return [];
  const out: Candidate[] = [];
  const prev = ref.node > 0 ? contour.nodes[ref.node - 1] : undefined;
  if (prev?.id && directions) {
    const direction = directionCandidate(ref.node > 1 ? contour.nodes[ref.node - 2] : undefined, prev, node, tolDeg);
    if (direction) out.push(direction);
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
 * Il vincolo del lato di chiusura (dall'ultimo nodo al primo) di un contorno appena chiuso: Orizzontale, Verticale o
 * Perpendicolare al lato che lo precede, come per un nodo nuovo ma senza i coincidenti (il primo nodo c'è già). Un lato curvo,
 * un contorno aperto o con meno di tre nodi non dà nulla. Con `directions` falso (angolo digitato) non dà nulla.
 */
export function inferClosingConstraints(paths: PathContour[], contour: number, tolDeg: number = INFER_TOLERANCE_DEG, directions = true): Candidate[] {
  const c = paths[contour];
  if (!directions || !c?.closed || c.nodes.length < 3) return [];
  const n = c.nodes.length;
  const direction = directionCandidate(c.nodes[n - 2], c.nodes[n - 1], c.nodes[0], tolDeg);
  return direction ? [direction] : [];
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
