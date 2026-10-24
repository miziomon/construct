// Dipendenza da ui/ProfileEditor: `constraints.ts` è il risolutore puro, senza import; andrà spostato in scene/ (rimandato)
import { NPTS, type ConstraintType } from '../ui/ProfileEditor/constraints';
import type { PathContour, PathNode, ProfileConstraint, ProfileParams, Vec2 } from './types';

/**
 * Curve di Bézier cubiche dei profili `path`: campionamento in poligoni, riquadro, autointersezioni e validazione.
 * Funzioni pure condivise da kernel, generatore OpenSCAD e (in futuro) editor, così le uscite non divergono.
 */

/** Tolleranza di campionamento iniziale, minima e massima (mm): errore massimo tra la curva e il poligono. */
export const PATH_DEFAULT_TOLERANCE = 0.05;
export const PATH_MIN_TOLERANCE = 0.001;
export const PATH_MAX_TOLERANCE = 1;
/** Limiti dei dati (anche per quelli che arrivano da un file .scad non fidato). */
export const MAX_PATH_NODES = 500;
export const MAX_PATH_CONTOURS = 100;
/** Tetti di punti campionati: oltre, la tolleranza raddoppia e si ricampiona. */
export const MAX_CONTOUR_SAMPLES = 2000;
export const MAX_PATH_SAMPLES = 20000;
/** Valore assoluto massimo accettato per una coordinata (mm). */
const MAX_COORD = 1e5;
/** Profondità massima della suddivisione di una cubica: 2^16 pezzi al più. */
const MAX_DEPTH = 16;
/** Raddoppi massimi della tolleranza per rientrare nei tetti (poi si smette e si segnala `capped`). */
const MAX_DOUBLINGS = 12;

/** Cubica di Bézier: punto iniziale, due maniglie assolute, punto finale. */
export type Cubic = [Vec2, Vec2, Vec2, Vec2];

/** Una maniglia c'è solo se esiste e non è nulla. */
const hasHandle = (h: Vec2 | undefined): h is Vec2 => h !== undefined && (h[0] !== 0 || h[1] !== 0);

/**
 * Segmento `i` di un contorno: dal nodo `i` al successivo (l'ultimo torna al primo se il contorno è chiuso).
 * `straight` è vero se non ci sono maniglie da nessuno dei due lati: il segmento è retto.
 */
export function segmentOf(c: PathContour, i: number): { cubic: Cubic; straight: boolean } {
  const a = c.nodes[i];
  const b = c.nodes[(i + 1) % c.nodes.length];
  const out = hasHandle(a.out) ? a.out : undefined;
  const inn = hasHandle(b.in) ? b.in : undefined;
  const cubic: Cubic = [a.p, out ? [a.p[0] + out[0], a.p[1] + out[1]] : a.p, inn ? [b.p[0] + inn[0], b.p[1] + inn[1]] : b.p, b.p];
  return { cubic, straight: !out && !inn };
}

/** Numero di segmenti di un contorno. */
const segmentCount = (c: PathContour): number => (c.closed ? c.nodes.length : Math.max(0, c.nodes.length - 1));

/** Punto della cubica al parametro t (0..1), con i polinomi di Bernstein. */
export function cubicPoint(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const [w0, w1, w2, w3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0] + w3 * c[3][0], w0 * c[0][1] + w1 * c[1][1] + w2 * c[2][1] + w3 * c[3][1]];
}

/** Punto medio tra due punti, al parametro t. */
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Divide la cubica al parametro t con l'algoritmo di de Casteljau: le due metà descrivono la stessa curva. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const ab = lerp(c[0], c[1], t);
  const bc = lerp(c[1], c[2], t);
  const cd = lerp(c[2], c[3], t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const mid = lerp(abc, bcd, t);
  return [
    [c[0], ab, abc, mid],
    [mid, bcd, cd, c[3]],
  ];
}

/** Parametri t (strettamente tra 0 e 1) in cui la derivata di una coordinata si annulla. */
function axisExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t) / 3 = a t² + b t + k
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const k = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    // Derivata di primo grado (o costante: nessun estremo)
    if (Math.abs(b) > 1e-12) roots.push(-k / b);
  } else {
    const disc = b * b - 4 * a * k;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return roots.filter((t) => t > 1e-9 && t < 1 - 1e-9);
}

/** Parametri t (ordinati, senza doppioni) degli estremi in x e in y della cubica: il campionamento li include sempre (D2). */
export function cubicExtrema(c: Cubic): number[] {
  const all = [...axisExtrema(c[0][0], c[1][0], c[2][0], c[3][0]), ...axisExtrema(c[0][1], c[1][1], c[2][1], c[3][1])].sort((a, b) => a - b);
  return all.filter((t, i) => i === 0 || t - all[i - 1] > 1e-12);
}

/** Distanza di un punto dal segmento a-b (non dalla retta: oltre gli estremi conta la distanza dall'estremo). */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Appende a `out` i punti che approssimano la cubica entro `tol` mm (l'estremo iniziale non si ripete, quello finale sì).
 * La cubica è abbastanza piatta quando le due maniglie stanno a non più di `tol` dal segmento tra gli estremi.
 */
export function flattenCubic(c: Cubic, tol: number, out: Vec2[], depth = 0): void {
  const flat = distanceToSegment(c[1], c[0], c[3]) <= tol && distanceToSegment(c[2], c[0], c[3]) <= tol;
  // Oltre il tetto di punti per contorno non si suddivide più: il campionamento verrà scartato e rifatto con più tolleranza
  if (flat || depth >= MAX_DEPTH || out.length > MAX_CONTOUR_SAMPLES) {
    out.push(c[3]);
    return;
  }
  const [left, right] = splitCubic(c, 0.5);
  flattenCubic(left, tol, out, depth + 1);
  flattenCubic(right, tol, out, depth + 1);
}

/** Divide la cubica in più pezzi ai parametri `ts` (ordinati, nella scala della cubica intera). */
function splitAt(c: Cubic, ts: number[]): Cubic[] {
  const pieces: Cubic[] = [];
  let rest = c;
  // Parametro (della cubica intera) già consumato dai pezzi precedenti
  let done = 0;
  for (const t of ts) {
    const [head, tail] = splitCubic(rest, (t - done) / (1 - done));
    pieces.push(head);
    rest = tail;
    done = t;
  }
  pieces.push(rest);
  return pieces;
}

/** Tolleranza dentro i limiti consentiti (un valore non numerico vale quello predefinito). */
const clampTolerance = (tol: number): number => (Number.isFinite(tol) ? Math.min(PATH_MAX_TOLERANCE, Math.max(PATH_MIN_TOLERANCE, tol)) : PATH_DEFAULT_TOLERANCE);

// --- Raggio di raccordo per nodo ---------------------------------------------------------------------------------------

/**
 * Raggio di raccordo (`r` di un nodo): lo spigolo si sostituisce con un arco di cerchio tangente ai due segmenti retti che
 * vi arrivano. È un'ESPANSIONE A VALLE: i nodi del contorno restano quelli di controllo (il risolutore dei vincoli e le
 * quote lavorano su di loro, mai sui punti dell'arco) e l'arco nasce solo quando il contorno si campiona. Poiché kernel,
 * codice OpenSCAD, anteprima e riquadro campionano tutti con `sampleContour`, il poligono è lo stesso ovunque.
 *
 * Vale per un nodo `corner` senza maniglie, con un segmento retto prima e uno dopo (un contorno aperto non raccorda i suoi
 * estremi). Con maniglie o segmenti curvi il raggio si ignora (`filletInfo` lo dice all'interfaccia). Il raggio si riduce
 * se i segmenti non bastano: la distanza di tangenza non supera la lunghezza del segmento, né la sua metà se il nodo
 * dall'altra parte è raccordato a sua volta (così due raccordi vicini non si sovrappongono).
 */
export interface FilletInfo {
  /** Il nodo può avere un raggio di raccordo. */
  eligible: boolean;
  /** Raggio massimo (mm) con cui l'arco sta nei segmenti; 0 se il nodo non può raccordarsi. */
  rmax: number;
  /** Perché non può, per l'interfaccia. */
  reason?: string;
}

/** Indici del nodo precedente e di quello successivo, o -1 se non ci sono (estremi di un contorno aperto). */
function neighbours(c: PathContour, i: number): [number, number] {
  const n = c.nodes.length;
  return [i > 0 ? i - 1 : c.closed ? n - 1 : -1, i < n - 1 ? i + 1 : c.closed ? 0 : -1];
}

/** Direzioni unitarie dal nodo `i` verso il precedente e il successivo, con le lunghezze dei due segmenti; null se non è un angolo valido. */
function corner(c: PathContour, i: number): { u: Vec2; v: Vec2; lenU: number; lenV: number; phi: number } | null {
  const [pi, ni] = neighbours(c, i);
  if (pi < 0 || ni < 0 || pi === ni || c.nodes.length < 3) return null;
  const [p, q, s] = [c.nodes[pi].p, c.nodes[i].p, c.nodes[ni].p];
  const [lenU, lenV] = [Math.hypot(p[0] - q[0], p[1] - q[1]), Math.hypot(s[0] - q[0], s[1] - q[1])];
  if (lenU < 1e-9 || lenV < 1e-9) return null;
  const u: Vec2 = [(p[0] - q[0]) / lenU, (p[1] - q[1]) / lenU];
  const v: Vec2 = [(s[0] - q[0]) / lenV, (s[1] - q[1]) / lenV];
  const cos = u[0] * v[0] + u[1] * v[1];
  // Segmenti allineati (angolo piatto) o ripiegati l'uno sull'altro: nessun arco
  if (Math.abs(cos) > 1 - 1e-9) return null;
  return { u, v, lenU, lenV, phi: Math.acos(Math.max(-1, Math.min(1, cos))) };
}

/** Il nodo `i` è uno spigolo senza maniglie tra due segmenti retti (a prescindere dal raggio). */
function isSharpCorner(c: PathContour, i: number): boolean {
  const n = c.nodes[i];
  if (!n || n.kind !== 'corner' || hasHandle(n.in) || hasHandle(n.out)) return false;
  const [pi, ni] = neighbours(c, i);
  if (pi < 0 || ni < 0 || hasHandle(c.nodes[pi].out) || hasHandle(c.nodes[ni].in)) return false;
  return corner(c, i) !== null;
}

/** Il nodo `i` ha un raggio e può raccordarsi. */
const isFilleted = (c: PathContour, i: number): boolean => (c.nodes[i]?.r ?? 0) > 0 && isSharpCorner(c, i);

/** Se il nodo `i` può avere un raggio di raccordo e fino a quanto. */
export function filletInfo(c: PathContour, i: number): FilletInfo {
  const n = c.nodes[i];
  if (!n) return { eligible: false, rmax: 0, reason: 'Nodo inesistente' };
  if (n.kind !== 'corner' || hasHandle(n.in) || hasHandle(n.out)) return { eligible: false, rmax: 0, reason: 'Il raccordo vale per uno spigolo senza maniglie' };
  const [pi, ni] = neighbours(c, i);
  if (pi < 0 || ni < 0) return { eligible: false, rmax: 0, reason: 'Il raccordo vale per un nodo con un segmento prima e uno dopo' };
  if (hasHandle(c.nodes[pi].out) || hasHandle(c.nodes[ni].in)) return { eligible: false, rmax: 0, reason: 'Il raccordo vale tra due segmenti retti' };
  const k = corner(c, i);
  if (!k) {
    // Nodi coincidenti: un segmento senza lunghezza; altrimenti i due segmenti sono sulla stessa retta
    const zero = [pi, ni].some((j) => Math.hypot(c.nodes[j].p[0] - n.p[0], c.nodes[j].p[1] - n.p[1]) < 1e-9);
    return { eligible: false, rmax: 0, reason: zero ? 'Un segmento ha lunghezza zero' : 'I due segmenti sono allineati: non c\'è uno spigolo' };
  }
  // Distanza di tangenza al massimo: il segmento intero, o la metà se dall'altra parte c'è un altro raccordo
  const reach = Math.min(k.lenU * (isFilleted(c, pi) ? 0.5 : 1), k.lenV * (isFilleted(c, ni) ? 0.5 : 1));
  return { eligible: true, rmax: reach * Math.tan(k.phi / 2) };
}

/** Nodi (con le maniglie) dell'arco di raccordo del nodo `i`, dal punto di tangenza sul segmento prima a quello sul segmento dopo. */
function filletNodes(c: PathContour, i: number): PathNode[] {
  const k = corner(c, i)!;
  const info = filletInfo(c, i);
  const r = Math.min(c.nodes[i].r as number, info.rmax);
  const q = c.nodes[i].p;
  const t = r / Math.tan(k.phi / 2);
  // Centro dell'arco sulla bisettrice, a r / sin(phi/2) dallo spigolo
  const bis: Vec2 = [k.u[0] + k.v[0], k.u[1] + k.v[1]];
  const bl = Math.hypot(bis[0], bis[1]);
  const d = r / Math.sin(k.phi / 2);
  const o: Vec2 = [q[0] + (bis[0] / bl) * d, q[1] + (bis[1] / bl) * d];
  const t1: Vec2 = [q[0] + k.u[0] * t, q[1] + k.u[1] * t];
  const t2: Vec2 = [q[0] + k.v[0] * t, q[1] + k.v[1] * t];
  // Arco minore da t1 a t2
  const a1 = Math.atan2(t1[1] - o[1], t1[0] - o[0]);
  let sweep = Math.atan2(t2[1] - o[1], t2[0] - o[0]) - a1;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  // Una cubica per ogni quarto di giro al più: l'errore del cerchio resta sotto lo 0,03% del raggio
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const delta = sweep / pieces;
  const handle = (4 / 3) * Math.tan(Math.abs(delta) / 4) * r;
  const dir = Math.sign(delta);
  const nodes: PathNode[] = [];
  for (let j = 0; j <= pieces; j++) {
    const a = a1 + j * delta;
    // Primo e ultimo punto sono le tangenze esatte (nessun errore di arrotondamento sul segmento retto)
    const p: Vec2 = j === 0 ? t1 : j === pieces ? t2 : [o[0] + r * Math.cos(a), o[1] + r * Math.sin(a)];
    const tangent: Vec2 = [-Math.sin(a) * dir * handle, Math.cos(a) * dir * handle];
    nodes.push({ p, kind: 'smooth', ...(j > 0 ? { in: [-tangent[0], -tangent[1]] as Vec2 } : {}), ...(j < pieces ? { out: tangent } : {}) });
  }
  return nodes;
}

/**
 * Il contorno con i raccordi espansi in archi (nodi in più, nessuna `id` né `r`). Senza raccordi restituisce lo stesso
 * contorno. È il contorno che si campiona, si disegna e si esporta; i nodi di controllo restano quelli di `c`.
 */
export function expandFillets(c: PathContour): PathContour {
  if (!c.nodes.some((n) => (n.r ?? 0) > 0)) return c;
  const nodes = c.nodes.flatMap((n, i) => (isFilleted(c, i) ? filletNodes(c, i) : [n]));
  return { closed: c.closed, nodes };
}

/**
 * Poligono che approssima un contorno entro `tol` mm. Ogni cubica si spezza prima nei suoi estremi in x e y, così il
 * riquadro del poligono è quello esatto della curva qualunque sia la tolleranza (D2). Un contorno chiuso non ripete il
 * primo punto in fondo. Oltre il tetto di punti per contorno `flattenCubic` smette di suddividere (il lavoro resta limitato) ma
 * nessun segmento viene saltato: chi chiama riconosce il superamento dalla lunghezza e ricampiona con più tolleranza.
 */
export function sampleContour(source: PathContour, tol: number): Vec2[] {
  const t = clampTolerance(tol);
  // I raccordi (`r` dei nodi) diventano archi prima del campionamento: poligono unico per kernel, OpenSCAD e disegno
  const c = expandFillets(source);
  if (c.nodes.length === 0) return [];
  const points: Vec2[] = [c.nodes[0].p];
  for (let i = 0; i < segmentCount(c); i++) {
    const { cubic, straight } = segmentOf(c, i);
    if (straight) {
      points.push(cubic[3]);
    } else {
      for (const piece of splitAt(cubic, cubicExtrema(cubic))) flattenCubic(piece, t, points);
    }
  }
  // Un contorno chiuso torna al primo punto: il duplicato finale si toglie. Si tolgono anche i doppioni consecutivi
  // (con una tolleranza di 1e-9 mm: un raccordo che arriva al massimo del raggio ha l'estremo dell'arco sul nodo vicino, a meno di un errore di calcolo)
  const same = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
  const unique = points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
  if (c.closed && unique.length > 1 && same(unique[unique.length - 1], unique[0])) unique.pop();
  return unique;
}

/**
 * Campiona tutti i contorni. Se superano i tetti di punti la tolleranza raddoppia e si ricampiona (deterministico):
 * `capped` lo segnala e `tolerance` è quella usata davvero. La tolleranza non va oltre `PATH_MAX_TOLERANCE`: arrivati lì
 * un altro raddoppio darebbe gli stessi punti, quindi ci si ferma (anche se i tetti restano superati) e si restituisce
 * la tolleranza limitata, non quella raddoppiata a vuoto.
 */
export function samplePaths(paths: PathContour[], tolerance: number): { contours: { points: Vec2[]; closed: boolean }[]; tolerance: number; capped: boolean } {
  let tol = clampTolerance(tolerance);
  let capped = false;
  for (let attempt = 0; ; attempt++) {
    const contours = paths.map((c) => ({ points: sampleContour(c, tol), closed: c.closed }));
    const total = contours.reduce((sum, c) => sum + c.points.length, 0);
    const over = total > MAX_PATH_SAMPLES || contours.some((c) => c.points.length > MAX_CONTOUR_SAMPLES);
    // Tolleranza davvero usata da `sampleContour`: la stessa funzione la limita
    const used = clampTolerance(tol);
    if (!over || attempt >= MAX_DOUBLINGS || used >= PATH_MAX_TOLERANCE) return { contours, tolerance: used, capped: capped || over };
    tol = used * 2;
    capped = true;
  }
}

/** Riquadro di un insieme di contorni, oppure null se non ci sono punti. */
export function bboxOf(points: Vec2[][]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let box: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  for (const list of points) {
    for (const [x, y] of list) {
      if (!box) box = { minX: x, maxX: x, minY: y, maxY: y };
      else {
        box.minX = Math.min(box.minX, x);
        box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y);
        box.maxY = Math.max(box.maxY, y);
      }
    }
  }
  return box;
}

/** Area con segno di un poligono chiuso (positiva se antiorario). */
export function signedArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Segno del prodotto vettoriale (b - a) × (c - a): da che parte di a-b sta c. */
const cross = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/**
 * Punti in cui i lati dei poligoni chiusi si attraversano (anche tra contorni diversi), fino a `limit`. I lati adiacenti
 * dello stesso contorno e i semplici contatti nei vertici non contano. Scansione dei lati ordinati per x minima.
 */
export function selfIntersections(contours: Vec2[][], limit = 100): Vec2[] {
  // Elenco dei lati con il contorno e la posizione, per riconoscere quelli adiacenti
  const edges: { a: Vec2; b: Vec2; minX: number; maxX: number; contour: number; index: number; count: number }[] = [];
  contours.forEach((points, contour) => {
    if (points.length < 3) return;
    points.forEach((a, index) => {
      const b = points[(index + 1) % points.length];
      edges.push({ a, b, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), contour, index, count: points.length });
    });
  });
  edges.sort((p, q) => p.minX - q.minX);
  const found: Vec2[] = [];
  for (let i = 0; i < edges.length && found.length < limit; i++) {
    const e = edges[i];
    for (let j = i + 1; j < edges.length && edges[j].minX <= e.maxX && found.length < limit; j++) {
      const f = edges[j];
      // Lati consecutivi dello stesso contorno (anche l'ultimo con il primo): si toccano nel vertice
      if (e.contour === f.contour) {
        const gap = Math.abs(e.index - f.index);
        if (gap === 1 || gap === e.count - 1) continue;
      }
      // Attraversamento vero: gli estremi di ciascun lato stanno da parti opposte dell'altro
      const d1 = cross(e.a, e.b, f.a);
      const d2 = cross(e.a, e.b, f.b);
      const d3 = cross(f.a, f.b, e.a);
      const d4 = cross(f.a, f.b, e.b);
      if (d1 * d2 < 0 && d3 * d4 < 0) {
        const t = d1 / (d1 - d2);
        found.push(lerp(f.a, f.b, t));
      }
    }
  }
  return found;
}

// --- Validazione dei dati non fidati -------------------------------------------------------------------------------

const KINDS = new Set<PathNode['kind']>(['corner', 'smooth', 'symmetric']);

/** Coppia di numeri finiti entro i limiti, oppure null. Il -0 diventa 0 (il JSON non lo distingue). */
function vec2(value: unknown): Vec2 | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return null;
  return [x || 0, y || 0];
}

/** Un id valido (di nodo o di vincolo): poche lettere, cifre, trattini (finisce nel commento del codice OpenSCAD). */
const NODE_ID = /^[A-Za-z0-9_-]{1,16}$/;

/**
 * Valida contorni arrivati da fuori (file .scad, bozze): al massimo 100 contorni di 2-500 nodi, numeri finiti entro
 * ±1e5, tipi del nodo noti. Restituisce oggetti nuovi, senza i campi in più, oppure null se qualcosa non va.
 * `id` e `r` sono facoltativi e non fanno fallire la lettura: un `id` malformato o già usato da un altro nodo del profilo
 * (si tiene il primo) e un `r` non valido o nullo si scartano, e `assignNodeIds` ridà un id al nodo che ne è privo.
 */
export function sanitizePaths(value: unknown): PathContour[] | null {
  if (!Array.isArray(value) || value.length > MAX_PATH_CONTOURS) return null;
  const result: PathContour[] = [];
  // Id già visti in tutto il profilo: devono essere unici anche tra contorni diversi
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { closed, nodes } = raw as { closed?: unknown; nodes?: unknown };
    if (typeof closed !== 'boolean' || !Array.isArray(nodes) || nodes.length < 2 || nodes.length > MAX_PATH_NODES) return null;
    const clean: PathNode[] = [];
    for (const n of nodes) {
      if (typeof n !== 'object' || n === null) return null;
      const { id, p, in: inn, out, kind, r } = n as { id?: unknown; p?: unknown; in?: unknown; out?: unknown; kind?: unknown; r?: unknown };
      const position = vec2(p);
      if (!position || typeof kind !== 'string' || !KINDS.has(kind as PathNode['kind'])) return null;
      // Le maniglie sono facoltative: se ci sono devono essere valide, se mancano il campo non esiste proprio
      const handleIn = inn === undefined ? undefined : vec2(inn);
      const handleOut = out === undefined ? undefined : vec2(out);
      if (handleIn === null || handleOut === null) return null;
      // Id: stringa breve e mai vista prima, altrimenti il campo non c'è
      const nodeId = typeof id === 'string' && NODE_ID.test(id) && !seen.has(id) ? id : undefined;
      if (nodeId) seen.add(nodeId);
      // Raggio di raccordo: numero finito positivo entro il limite delle coordinate
      const radius = typeof r === 'number' && Number.isFinite(r) && r > 0 && r <= MAX_COORD ? r : undefined;
      clean.push({ ...(nodeId ? { id: nodeId } : {}), p: position, ...(handleIn ? { in: handleIn } : {}), ...(handleOut ? { out: handleOut } : {}), kind: kind as PathNode['kind'], ...(radius ? { r: radius } : {}) });
    }
    // Cerchio parametrico: solo su un contorno chiuso di 4 nodi con il primo che ha un id; i tre nodi derivati non hanno id
    const rawCirc = (raw as { circ?: unknown }).circ;
    let circ: PathContour['circ'];
    if (typeof rawCirc === 'object' && rawCirc !== null && closed && clean.length === 4 && clean[0].id) {
      const { id: circId, p: circP } = rawCirc as { id?: unknown; p?: unknown };
      const center = vec2(circP);
      if (center && typeof circId === 'string' && NODE_ID.test(circId) && !seen.has(circId)) {
        seen.add(circId);
        circ = { id: circId, p: center };
        for (let i = 1; i < 4; i++) delete clean[i].id;
      }
    }
    result.push({ closed, nodes: clean, ...(circ ? { circ } : {}) });
  }
  return result;
}

/** Costante di Bézier per approssimare un quarto di cerchio con una cubica (maniglie a 0,5523 volte il raggio). */
export const CIRCLE_KAPPA = 0.5522847498307936;

/** Un vettore ruotato di 90 gradi in senso antiorario (esatto: nessuna trigonometria). */
const quarter = (v: Vec2): Vec2 => [-v[1] + 0, v[0] + 0];

/**
 * Ricalcola i tre nodi derivati e le maniglie di un cerchio parametrico dal suo centro (`circ.p`) e dal primo nodo (sul bordo,
 * che resta dov'è). I nodi stanno a quarti di giro dal primo, tutti lisci e simmetrici con le maniglie a `CIRCLE_KAPPA` volte
 * il raggio. Un contorno senza `circ` resta com'è. Restituisce lo stesso oggetto se è già coerente.
 */
export function regenCircle(c: PathContour): PathContour {
  if (!c.circ || c.nodes.length !== 4) return c;
  const [first] = c.nodes;
  const center = c.circ.p;
  let spoke: Vec2 = [first.p[0] - center[0], first.p[1] - center[1]];
  let changed = false;
  const nodes = c.nodes.map((n, k): PathNode => {
    const out: Vec2 = (([x, y]) => [x * CIRCLE_KAPPA + 0, y * CIRCLE_KAPPA + 0] as Vec2)(quarter(spoke));
    const handleIn: Vec2 = [-out[0] || 0, -out[1] || 0];
    const p: Vec2 = k === 0 ? n.p : [center[0] + spoke[0], center[1] + spoke[1]];
    const next: PathNode = { ...(n.id ? { id: n.id } : {}), p, in: handleIn, out, kind: 'symmetric' };
    spoke = quarter(spoke);
    const same = n.kind === 'symmetric' && n.p[0] === p[0] && n.p[1] === p[1] && n.in?.[0] === handleIn[0] && n.in?.[1] === handleIn[1] && n.out?.[0] === out[0] && n.out?.[1] === out[1] && !n.r;
    if (!same) changed = true;
    return next;
  });
  return changed ? { ...c, nodes } : c;
}

/** Contorno di un cerchio parametrico di centro `center` e raggio `r`: il primo nodo (con id) a destra del centro. */
export function circleContour(center: Vec2, r: number, centerId: string, nodeId: string): PathContour {
  const first: PathNode = { id: nodeId, p: [center[0] + r, center[1]], kind: 'symmetric' };
  return regenCircle({ closed: true, nodes: [first, { p: [0, 0], kind: 'symmetric' }, { p: [0, 0], kind: 'symmetric' }, { p: [0, 0], kind: 'symmetric' }], circ: { id: centerId, p: center } });
}

/** Tipi di vincolo tra due segmenti (4 punti, `angle` anche 2) in cui i segmenti possono avere in comune un nodo. */
const SHARED_NODE_OK = new Set<ConstraintType>(['angle', 'parallel', 'perpendicular', 'equal', 'collinear']);

/**
 * Punti ripetuti: un segmento non ha due estremi uguali, i due segmenti non sono lo stesso, e il nodo condiviso è ammesso
 * solo nei vincoli tra segmenti (angolo, parallelo, perpendicolare, uguale, collineare). Punto medio e simmetrico vogliono
 * punti tutti diversi.
 */
function distinctPoints(type: ConstraintType, p: string[]): boolean {
  if (p.length >= 2 && p[0] === p[1]) return false;
  if (p.length === 4) {
    if (p[2] === p[3] || (p[0] === p[2] && p[1] === p[3]) || (p[0] === p[3] && p[1] === p[2])) return false;
    return SHARED_NODE_OK.has(type) || new Set(p).size === 4;
  }
  return p.length !== 3 || new Set(p).size === 3;
}
/** Tetti dei dati dei vincoli (anche per quelli che arrivano da un file .scad non fidato). */
export const MAX_CONSTRAINTS = 1000;
export const MAX_PARAMS = 100;
/** Numero finito entro ±1e5 (coordinate, misure, scostamenti). */
const bounded = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= MAX_COORD;

/** Tutti gli id dei nodi di un profilo. */
export const nodeIds = (paths: PathContour[]): Set<string> => new Set(paths.flatMap((c) => [...(c.circ ? [c.circ.id] : []), ...c.nodes.flatMap((n) => (n.id ? [n.id] : []))]));

/**
 * Valida i vincoli arrivati da fuori contro i contorni (già validati) a cui si riferiscono. A differenza di `sanitizePaths`
 * non fallisce mai: scarta i vincoli sbagliati e tiene gli altri (al più 1000). Si scarta un vincolo con tipo ignoto,
 * numero di punti sbagliato, nodi inesistenti, valori non finiti o mancanti (`v` per le quote, `x` e `y` per `fixed`; una
 * quota di riferimento può non avere `v`) e l'id già usato da un vincolo precedente. Restituisce oggetti nuovi, senza i
 * campi in più, e una lista vuota per un dato che non è un elenco.
 */
export function sanitizeConstraints(value: unknown, paths: PathContour[]): ProfileConstraint[] {
  if (!Array.isArray(value)) return [];
  const ids = nodeIds(paths);
  const seen = new Set<string>();
  const result: ProfileConstraint[] = [];
  for (const raw of value) {
    if (result.length >= MAX_CONSTRAINTS) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const { id, t, p, v, s, x, y, ref, off, at, expr, dia } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !NODE_ID.test(id) || seen.has(id)) continue;
    if (typeof t !== 'string' || !Object.hasOwn(NPTS, t)) continue;
    const type = t as ConstraintType;
    // Punti: il numero giusto per il tipo (l'angolo anche 4: dal segmento ab al segmento cd) e tutti esistenti
    const want = NPTS[type];
    if (!Array.isArray(p) || (p.length !== want && !(type === 'angle' && p.length === 4)) || !p.every((q) => typeof q === 'string' && ids.has(q))) continue;
    if (!distinctPoints(type, p)) continue;
    const isRef = ref === true;
    // Misura: obbligatoria per le quote (tranne il riferimento), positiva per la lunghezza, con segno solo l'angolo
    const measured = type === 'dist' || type === 'distX' || type === 'distY' || type === 'angle';
    if (measured && !isRef && !(bounded(v) && (type === 'angle' || (type === 'dist' ? v > 0 : v >= 0)))) continue;
    if (type === 'fixed' && !(bounded(x) && bounded(y))) continue;
    // Campi facoltativi non validi: il campo si perde, il vincolo resta
    result.push({
      id,
      t: type,
      p: [...(p as string[])],
      ...(measured && bounded(v) ? { v } : {}),
      ...(s === 1 || s === -1 ? { s } : {}),
      ...(type === 'fixed' ? { x: x as number, y: y as number } : {}),
      ...(isRef ? { ref: true } : {}),
      ...(bounded(off) ? { off } : {}),
      ...(typeof at === 'number' && at >= 0 && at <= 1 ? { at } : {}),
      // Espressione dei parametri locali (solo quote pilotanti) e diametro del cerchio (solo una distanza pilotante)
      ...(measured && !isRef && typeof expr === 'string' && expr.length > 0 && expr.length <= MAX_EXPR ? { expr } : {}),
      ...(type === 'dist' && !isRef && dia === true ? { dia: true as const } : {}),
    });
    seen.add(id);
  }
  return result;
}

/** Nomi dei parametri: un identificatore, e mai quelli che toccherebbero il prototipo dell'oggetto. */
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
/** Lunghezza massima di un'espressione di parametro. */
const MAX_EXPR = 200;

/** Valida i parametri del profilo (numeri finiti o brevi espressioni): scarta le voci non valide; undefined se non ne resta nessuna. */
export function sanitizeParams(value: unknown): ProfileParams | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const result: ProfileParams = {};
  let count = 0;
  for (const [name, v] of Object.entries(value)) {
    if (count >= MAX_PARAMS) break;
    if (!PARAM_NAME.test(name) || RESERVED_NAMES.has(name)) continue;
    if (!(bounded(v) || (typeof v === 'string' && v.length <= MAX_EXPR))) continue;
    result[name] = v;
    count++;
  }
  return count ? result : undefined;
}

/**
 * Assegna un id ai nodi che non ne hanno, con un contatore per profilo (`n1`, `n2`...) che riparte dopo il numero più alto
 * già usato; gli id esistenti non cambiano. Se tutti i nodi ne hanno già, restituisce gli stessi contorni (stesso
 * riferimento, così la cache e la cronologia non vedono un cambiamento).
 */
export function assignNodeIds(paths: PathContour[]): PathContour[] {
  // I tre nodi derivati di un cerchio parametrico non hanno id e non lo devono avere (non sono punti del risolutore)
  const needsId = (c: PathContour) => c.nodes.some((n, i) => !n.id && !(c.circ && i > 0));
  if (!paths.some(needsId)) return paths;
  // Il contatore parte oltre il più alto `n<k>` presente, e un id già preso (anche non numerico) non si riusa
  const taken = nodeIds(paths);
  let counter = 0;
  for (const id of taken) {
    const k = /^n(\d+)$/.exec(id);
    if (k) counter = Math.max(counter, Number(k[1]));
  }
  // Nuovo id: il prossimo numero libero
  const fresh = (): string => {
    do counter++;
    while (taken.has(`n${counter}`));
    return `n${counter}`;
  };
  return paths.map((c) => (needsId(c) ? { ...c, nodes: c.nodes.map((n, i) => (n.id || (c.circ && i > 0) ? n : { ...n, id: fresh() })) } : c));
}

/** `count` id di nodo liberi (`n<k>`) oltre il più alto già usato nel profilo: per i punti che nascono insieme (il cerchio parametrico). */
export function freshNodeIds(paths: PathContour[], count: number): string[] {
  const taken = nodeIds(paths);
  let counter = 0;
  for (const id of taken) {
    const k = /^n(\d+)$/.exec(id);
    if (k) counter = Math.max(counter, Number(k[1]));
  }
  const out: string[] = [];
  while (out.length < count) {
    counter++;
    if (!taken.has(`n${counter}`)) out.push(`n${counter}`);
  }
  return out;
}

/** Dati di un profilo `path` che finiscono nel commento del codice OpenSCAD. */
interface PathMeta {
  paths: PathContour[];
  tolerance: number;
  width: number;
  depth: number;
  constraints?: ProfileConstraint[];
  params?: ProfileParams;
}

/**
 * Commento `// construct:path`: i dati su una sola riga di JSON, senza arrotondamenti (i nodi sono già arrotondati dallo
 * store). La versione è 2 SOLO se ci sono `k` (vincoli), `q` (parametri) o un raccordo `r` che cambia la forma: un'app che
 * conosce solo la versione 1 non la riconosce e il poligono resta un Poligono qualsiasi. Senza, resta 1: gli `id` dei nodi
 * non rendono illeggibile il commento (il lettore v:1 li ignora o li legge).
 */
export function encodePathMeta(p: PathMeta): string {
  const k = p.constraints?.length ? { k: p.constraints } : {};
  const q = p.params && Object.keys(p.params).length ? { q: p.params } : {};
  return JSON.stringify({ v: metaVersion(p), w: p.width, d: p.depth, t: p.tolerance, paths: p.paths, ...k, ...q });
}

/**
 * Versione del formato del commento e della bozza: 2 se ci sono vincoli, parametri, un cerchio parametrico o un raccordo (`r`
 * di un nodo: cambia la forma, e un'app che lo ignorasse rileggerebbe un poligono diverso da quello scritto), altrimenti 1.
 */
export function metaVersion(p: { constraints?: unknown[]; params?: object; paths?: PathContour[] }): 1 | 2 {
  const filleted = p.paths?.some((c) => c.circ || c.nodes.some((n) => (n.r ?? 0) > 0));
  return p.constraints?.length || (p.params && Object.keys(p.params).length) || filleted ? 2 : 1;
}

/**
 * Rilegge il commento (versione 1 o 2): null se non è JSON, la versione è ignota, le misure non sono valide o i contorni
 * non passano `sanitizePaths`. Una versione 1 non ha vincoli. I vincoli e i parametri non validi si scartano senza
 * rifiutare il profilo, che è comunque la forma scritta nel codice.
 */
export function decodePathMeta(text: string): PathMeta | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { v, w, d, t, paths, k, q } = data as { v?: unknown; w?: unknown; d?: unknown; t?: unknown; paths?: unknown; k?: unknown; q?: unknown };
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= MAX_COORD;
  if ((v !== 1 && v !== 2) || !finite(w) || !finite(d) || !finite(t)) return null;
  const clean = sanitizePaths(paths);
  if (!clean) return null;
  const result: PathMeta = { paths: clean, tolerance: clampTolerance(t), width: w, depth: d };
  if (v === 2) {
    const constraints = sanitizeConstraints(k, clean);
    const params = sanitizeParams(q);
    if (constraints.length) result.constraints = constraints;
    if (params) result.params = params;
  }
  return result;
}
