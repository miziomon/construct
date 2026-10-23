import { PATH_DEFAULT_TOLERANCE, samplePaths } from '../../scene/bezier';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';
import { measure } from './constraints';
import type { ConstraintType, Pt } from './constraints';
import { pointInPolygon } from './model';

/**
 * Dove stanno le quote sul disegno: geometria della linea di quota e dell'etichetta, disposizione automatica fuori dal
 * disegno e senza sovrapposizioni, trascinamento della linea e dell'etichetta. Funzioni pure, in millimetri del disegno:
 * i pixel entrano solo come dimensioni dell'etichetta (`pxPerMm` è lo zoom).
 *
 * Posizione di una quota di lunghezza (tutto nel modello B1: `off` e `at`):
 * - allineata (`dist`): la linea di quota è parallela al segmento A→B, alla distanza `off` con segno dalla normale a
 *   sinistra di A→B (Y verso l'alto);
 * - orizzontale (`distX`): la linea è orizzontale, a `off` sopra (positivo) o sotto (negativo) la quota Y a metà tra i due nodi;
 * - verticale (`distY`): la linea è verticale, a `off` a destra (positivo) o a sinistra (negativo) della X a metà tra i due nodi;
 * - `at` (0-1) è la posizione dell'etichetta lungo la linea, da A a B.
 */

/** Distanza (pixel) della linea di quota dal disegno alla sua creazione, e passo con cui si allontana per liberare lo spazio. */
export const DIM_GAP_PX = 30;
const STEP_PX = 20;
/** Quanti passi al massimo per cercare uno spazio libero, da una parte e dall'altra. */
const MAX_STEPS = 16;
/** Misure dell'etichetta a pillola in pixel (come nel disegno): larghezza per carattere, margine, altezza. */
const CHAR_PX = 6.6;
const PILL_PAD_PX = 14;
const PILL_H_PX = 18;
/** Margine (pixel) che deve restare libero attorno a un'etichetta. */
const MARGIN_PX = 3;

/** Quote con una linea di lunghezza: le uniche che hanno una posizione da scegliere. */
const LINEAR = new Set<ConstraintType>(['dist', 'distX', 'distY']);
export const isLinearDimension = (c: Pick<ProfileConstraint, 't'>): boolean => LINEAR.has(c.t);
/** Tipi che hanno un valore (le quote); gli altri sono vincoli geometrici. */
const DIMENSION_TYPES = new Set<ConstraintType>(['dist', 'distX', 'distY', 'angle']);
export const isDimension = (c: Pick<ProfileConstraint, 't'>): boolean => DIMENSION_TYPES.has(c.t);

// --- Punti ------------------------------------------------------------------------------------------------------------

/** Punti del risolutore: i nodi che hanno un id (gli altri non possono essere citati da nessun vincolo). */
export function pointsOf(paths: PathContour[]): Pt[] {
  return paths.flatMap((c) => c.nodes.flatMap((n) => (n.id ? [{ id: n.id, x: n.p[0], y: n.p[1] }] : [])));
}

/** Posizione di ogni nodo con id. */
export function pointMap(paths: PathContour[]): Map<string, Vec2> {
  return new Map(paths.flatMap((c) => c.nodes.flatMap((n): [string, Vec2][] => (n.id ? [[n.id, n.p]] : []))));
}

/** Misura attuale di una quota (per una quota di riferimento è l'unico valore che ha). Le distanze in X e in Y si mostrano sempre positive. */
export function dimensionValue(c: ProfileConstraint, paths: PathContour[]): number {
  if (!c.ref && c.v !== undefined) return c.v;
  const m = measure(c, pointsOf(paths));
  return c.t === 'distX' || c.t === 'distY' ? Math.abs(m) : m;
}

// --- Testo ------------------------------------------------------------------------------------------------------------

/** Numero con al più due decimali e la virgola italiana. */
export const fmtDim = (n: number): string => String(Number(n.toFixed(2))).replace('.', ',');

/** Testo dell'etichetta di una quota: il valore, tra parentesi se è di riferimento. */
export function dimText(c: ProfileConstraint, paths: PathContour[]): string {
  const v = dimensionValue(c, paths);
  const text = c.t === 'angle' ? `${fmtDim(v)}°` : fmtDim(v);
  return c.ref ? `(${text})` : text;
}

/** Larghezza (pixel) dell'etichetta a pillola per un testo. */
export const pillWidthPx = (text: string): number => text.length * CHAR_PX + PILL_PAD_PX;

// --- Geometria della quota --------------------------------------------------------------------------------------------

/** Geometria di una quota nel disegno (mm): linee di richiamo da `a` e `b` verso `a2` e `b2`, linea di quota tra `a2` e `b2`, centro dell'etichetta. */
export interface DimLayout {
  a: Vec2;
  b: Vec2;
  a2: Vec2;
  b2: Vec2;
  label: Vec2;
}

/**
 * Dove sta una quota, secondo `off` e `at` (vedi sopra). `fallbackOff` vale per una quota senza `off`. Restituisce null se
 * un nodo citato non c'è.
 */
export function dimLayout(c: ProfileConstraint, pm: Map<string, Vec2>, fallbackOff: number): DimLayout | null {
  const a = pm.get(c.p[0]);
  const b = pm.get(c.p[1]);
  if (!a || !b) return null;
  const off = c.off ?? fallbackOff;
  const at = c.at ?? 0.5;
  let a2: Vec2 = a;
  let b2: Vec2 = b;
  if (c.t === 'dist') {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: Vec2 = [(-(b[1] - a[1]) / l) * off, ((b[0] - a[0]) / l) * off];
    a2 = [a[0] + n[0], a[1] + n[1]];
    b2 = [b[0] + n[0], b[1] + n[1]];
  } else if (c.t === 'distX') {
    const y = (a[1] + b[1]) / 2 + off;
    a2 = [a[0], y];
    b2 = [b[0], y];
  } else if (c.t === 'distY') {
    const x = (a[0] + b[0]) / 2 + off;
    a2 = [x, a[1]];
    b2 = [x, b[1]];
  }
  return { a, b, a2, b2, label: [a2[0] + (b2[0] - a2[0]) * at, a2[1] + (b2[1] - a2[1]) * at] };
}

/** Posizione (`off` e `at`) con cui l'etichetta, o la linea, della quota passa per il punto `p` (mm). Per la linea `at` resta com'era. */
export function dragDimension(c: ProfileConstraint, pm: Map<string, Vec2>, p: Vec2, part: 'label' | 'line'): { off: number; at: number } {
  const a = pm.get(c.p[0]);
  const b = pm.get(c.p[1]);
  const keep = c.at ?? 0.5;
  if (!a || !b) return { off: c.off ?? 0, at: keep };
  const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
  const clampOff = (o: number) => Math.min(1e5, Math.max(-1e5, o));
  let off = 0;
  let along = keep;
  if (c.t === 'dist') {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const [ux, uy] = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const [dx, dy] = [p[0] - a[0], p[1] - a[1]];
    off = -uy * dx + ux * dy;
    along = (ux * dx + uy * dy) / l;
  } else if (c.t === 'distX') {
    off = p[1] - (a[1] + b[1]) / 2;
    along = b[0] === a[0] ? keep : (p[0] - a[0]) / (b[0] - a[0]);
  } else if (c.t === 'distY') {
    off = p[0] - (a[0] + b[0]) / 2;
    along = b[1] === a[1] ? keep : (p[1] - a[1]) / (b[1] - a[1]);
  }
  return { off: clampOff(off), at: part === 'label' ? clamp01(along) : keep };
}

// --- Sovrapposizioni --------------------------------------------------------------------------------------------------

/** Rettangolo (mm). */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
type Seg = [Vec2, Vec2];

/** Riquadro dell'etichetta, centrato in `c`, con il margine. */
function labelBox(c: Vec2, text: string, pxPerMm: number): Box {
  const w = (pillWidthPx(text) + 2 * MARGIN_PX) / pxPerMm / 2;
  const h = (PILL_H_PX + 2 * MARGIN_PX) / pxPerMm / 2;
  return { x0: c[0] - w, y0: c[1] - h, x1: c[0] + w, y1: c[1] + h };
}

const boxesOverlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Il segmento tocca il rettangolo (un estremo dentro, o taglia un lato). */
function segmentHitsBox([p, q]: Seg, b: Box): boolean {
  const inside = (v: Vec2) => v[0] > b.x0 && v[0] < b.x1 && v[1] > b.y0 && v[1] < b.y1;
  if (inside(p) || inside(q)) return true;
  const corners: Vec2[] = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  return corners.some((c, i) => segmentsCross([p, q], [c, corners[(i + 1) % 4]], 0));
}

/** Due segmenti si incrociano; `eps` esclude i punti vicini agli estremi del primo (parametro t entro eps da 0 o da 1). */
function segmentsCross([p, q]: Seg, [r, s]: Seg, eps: number): boolean {
  const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
  const [ex, ey] = [s[0] - r[0], s[1] - r[1]];
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((r[0] - p[0]) * ey - (r[1] - p[1]) * ex) / den;
  const u = ((r[0] - p[0]) * dy - (r[1] - p[1]) * dx) / den;
  return t > eps && t < 1 - eps && u >= 0 && u <= 1;
}

/**
 * Contorni campionati: segmenti (per gli urti, tutti i contorni) e poligoni (per sapere se un punto è dentro il disegno
 * pieno: solo i contorni CHIUSI, un contorno aperto non delimita nessuna area).
 */
function contourGeometry(paths: PathContour[]): { segments: Seg[]; polygons: Vec2[][] } {
  const sampled = samplePaths(paths, PATH_DEFAULT_TOLERANCE).contours;
  const segments: Seg[] = [];
  for (const c of sampled) {
    const n = c.points.length;
    for (let i = 0; i < (c.closed ? n : n - 1); i++) segments.push([c.points[i], c.points[(i + 1) % n]]);
  }
  return { segments, polygons: sampled.filter((c) => c.closed && c.points.length >= 3).map((c) => c.points) };
}

/** Il punto sta nel disegno pieno: regola pari-dispari sui contorni chiusi (un foro è fuori, un contorno aperto non conta). */
export function insideDrawing(paths: PathContour[], p: Vec2): boolean {
  return contourGeometry(paths).polygons.filter((poly) => pointInPolygon(poly, p)).length % 2 === 1;
}

/** Baricentro di un contorno campionato (con l'area; senza area la media dei punti). */
function centroid(points: Vec2[]): Vec2 {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [p, q] = [points[i], points[(i + 1) % points.length]];
    const cross = p[0] * q[1] - q[0] * p[1];
    area += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  if (Math.abs(area) < 1e-9) return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  return [cx / (3 * area), cy / (3 * area)];
}

/** Segmenti della quota: linea di quota e linee di richiamo. */
const dimSegments = (l: DimLayout): Seg[] => [[l.a2, l.b2], [l.a, l.a2], [l.b, l.b2]];

/**
 * Posizione automatica di una quota nuova: fuori dal disegno pieno, dalla parte opposta al baricentro del contorno del primo
 * nodo (su un foro «fuori» è anche dentro il foro, che è vuoto: una quota sul bordo di un foro può finirci dentro, se c'è posto), a `DIM_GAP_PX` pixel; se l'etichetta cadrebbe dentro il disegno, su un contorno, su un'altra etichetta o linea di
 * quota (o la linea di quota taglia il contorno o un'altra etichetta) si allontana a passi di `STEP_PX` pixel. Si sceglie
 * la parte (opposta al baricentro, o l'altra) che chiede meno passi; se da nessuna c'è posto entro `MAX_STEPS` resta alla distanza iniziale. `others` sono le
 * quote già posizionate (quelle senza nodi nel disegno si ignorano). `at` è sempre 0,5.
 */
export function placeDimension(paths: PathContour[], others: ProfileConstraint[], con: Pick<ProfileConstraint, 't' | 'p' | 'v' | 's' | 'ref'>, pxPerMm: number): { off: number; at: number } {
  const pm = pointMap(paths);
  const a = pm.get(con.p[0]);
  const b = pm.get(con.p[1]);
  const at = 0.5;
  if (!a || !b || !isLinearDimension(con)) return { off: 0, at };
  const px = Math.max(pxPerMm, 1e-6);
  const geometry = contourGeometry(paths);
  // Baricentro del contorno del primo nodo
  const owner = paths.findIndex((c) => c.nodes.some((n) => n.id === con.p[0]));
  const ownerPoints = owner >= 0 ? samplePaths([paths[owner]], PATH_DEFAULT_TOLERANCE).contours[0].points : [...pm.values()];
  const c = centroid(ownerPoints.length ? ownerPoints : [...pm.values()]);
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // Verso positivo e scostamento minimo (mm) dalla posizione di riferimento della linea
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const normal: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const away = con.t === 'dist' ? (mid[0] - c[0]) * normal[0] + (mid[1] - c[1]) * normal[1] : con.t === 'distX' ? mid[1] - c[1] : mid[0] - c[0];
  const preferred = away >= 0 ? 1 : -1;
  // Per distX e distY la linea sta a metà tra i nodi + off: per non tagliare tra i due nodi parte oltre il più lontano
  const half = con.t === 'distX' ? Math.abs(b[1] - a[1]) / 2 : con.t === 'distY' ? Math.abs(b[0] - a[0]) / 2 : 0;

  const placed = others.filter((o) => isLinearDimension(o) && o.p.every((id) => pm.has(id)));
  const obstacles = placed.flatMap((o) => {
    const layout = dimLayout(o, pm, DIM_GAP_PX / px);
    return layout ? [{ box: labelBox(layout.label, dimText(o, paths), px), segments: dimSegments(layout) }] : [];
  });
  const text = fmtDim(con.v ?? measure({ ...con, id: '' } as ProfileConstraint, pointsOf(paths)));

  const free = (off: number): boolean => {
    const layout = dimLayout({ ...con, id: '', off, at } as ProfileConstraint, pm, 0);
    if (!layout) return false;
    const box = labelBox(layout.label, text, px);
    // L'etichetta sta fuori dal disegno e non tocca contorni, altre etichette o altre linee di quota
    if (geometry.polygons.filter((poly) => pointInPolygon(poly, layout.label)).length % 2 === 1) return false;
    if (geometry.segments.some((s) => segmentHitsBox(s, box))) return false;
    if (obstacles.some((o) => boxesOverlap(box, o.box) || o.segments.some((s) => segmentHitsBox(s, box)))) return false;
    // La linea di quota non taglia il contorno né un'altra etichetta (gli estremi della linea stanno sulle linee di richiamo: si escludono)
    const line: Seg = [layout.a2, layout.b2];
    if (geometry.segments.some((s) => segmentsCross(line, s, 0.02))) return false;
    if (obstacles.some((o) => segmentHitsBox(line, o.box))) return false;
    return true;
  };
  const offAt = (sign: number, step: number) => sign * (half + (DIM_GAP_PX + STEP_PX * step) / px);
  // Quanti passi servono da una parte e dall'altra: vince la parte che ne chiede meno (a parità, quella opposta al baricentro)
  const stepsNeeded = (sign: number): number => {
    for (let step = 0; step < MAX_STEPS; step++) if (free(offAt(sign, step))) return step;
    return Infinity;
  };
  const [near, far] = [stepsNeeded(preferred), stepsNeeded(-preferred)];
  if (near === Infinity && far === Infinity) return { off: offAt(preferred, 0), at };
  return far < near ? { off: offAt(-preferred, far), at } : { off: offAt(preferred, near), at };
}

/**
 * Ridispone tutte le quote di lunghezza una dopo l'altra, nell'ordine dell'elenco: ognuna tiene conto di quelle già
 * ridisposte. Le altre voci (vincoli, quote d'angolo) restano com'erano.
 */
export function repositionDimensions(paths: PathContour[], constraints: ProfileConstraint[], pxPerMm: number): ProfileConstraint[] {
  const placed: ProfileConstraint[] = [];
  return constraints.map((c) => {
    if (!isLinearDimension(c) || !c.p.every((id) => pointMap(paths).has(id))) return c;
    const next = { ...c, ...placeDimension(paths, placed, c, pxPerMm) };
    placed.push(next);
    return next;
  });
}
