import type { PathContour, PathNode, Vec2 } from './types';

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

/**
 * Poligono che approssima un contorno entro `tol` mm. Ogni cubica si spezza prima nei suoi estremi in x e y, così il
 * riquadro del poligono è quello esatto della curva qualunque sia la tolleranza (D2). Un contorno chiuso non ripete il
 * primo punto in fondo. Oltre il tetto di punti per contorno `flattenCubic` smette di suddividere (il lavoro resta limitato) ma
 * nessun segmento viene saltato: chi chiama riconosce il superamento dalla lunghezza e ricampiona con più tolleranza.
 */
export function sampleContour(c: PathContour, tol: number): Vec2[] {
  const t = clampTolerance(tol);
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
  const unique = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (c.closed && unique.length > 1 && unique[unique.length - 1][0] === unique[0][0] && unique[unique.length - 1][1] === unique[0][1]) unique.pop();
  return unique;
}

/**
 * Campiona tutti i contorni. Se superano i tetti di punti la tolleranza raddoppia e si ricampiona (deterministico):
 * `capped` lo segnala e `tolerance` è quella usata davvero.
 */
export function samplePaths(paths: PathContour[], tolerance: number): { contours: { points: Vec2[]; closed: boolean }[]; tolerance: number; capped: boolean } {
  let tol = clampTolerance(tolerance);
  let capped = false;
  for (let attempt = 0; ; attempt++) {
    const contours = paths.map((c) => ({ points: sampleContour(c, tol), closed: c.closed }));
    const total = contours.reduce((sum, c) => sum + c.points.length, 0);
    const over = total > MAX_PATH_SAMPLES || contours.some((c) => c.points.length > MAX_CONTOUR_SAMPLES);
    if (!over || attempt >= MAX_DOUBLINGS) return { contours, tolerance: tol, capped: capped || over };
    tol *= 2;
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

/**
 * Valida contorni arrivati da fuori (file .scad, bozze): al massimo 100 contorni di 2-500 nodi, numeri finiti entro
 * ±1e5, tipi del nodo noti. Restituisce oggetti nuovi, senza i campi in più, oppure null se qualcosa non va.
 */
export function sanitizePaths(value: unknown): PathContour[] | null {
  if (!Array.isArray(value) || value.length > MAX_PATH_CONTOURS) return null;
  const result: PathContour[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { closed, nodes } = raw as { closed?: unknown; nodes?: unknown };
    if (typeof closed !== 'boolean' || !Array.isArray(nodes) || nodes.length < 2 || nodes.length > MAX_PATH_NODES) return null;
    const clean: PathNode[] = [];
    for (const n of nodes) {
      if (typeof n !== 'object' || n === null) return null;
      const { p, in: inn, out, kind } = n as { p?: unknown; in?: unknown; out?: unknown; kind?: unknown };
      const position = vec2(p);
      if (!position || typeof kind !== 'string' || !KINDS.has(kind as PathNode['kind'])) return null;
      // Le maniglie sono facoltative: se ci sono devono essere valide, se mancano il campo non esiste proprio
      const handleIn = inn === undefined ? undefined : vec2(inn);
      const handleOut = out === undefined ? undefined : vec2(out);
      if (handleIn === null || handleOut === null) return null;
      clean.push({ p: position, ...(handleIn ? { in: handleIn } : {}), ...(handleOut ? { out: handleOut } : {}), kind: kind as PathNode['kind'] });
    }
    result.push({ closed, nodes: clean });
  }
  return result;
}

/** Dati di un profilo `path` che finiscono nel commento del codice OpenSCAD. */
interface PathMeta {
  paths: PathContour[];
  tolerance: number;
  width: number;
  depth: number;
}

/** Commento `// construct:path`: i dati su una sola riga di JSON, senza arrotondamenti (i nodi sono già arrotondati dallo store). */
export function encodePathMeta(p: PathMeta): string {
  return JSON.stringify({ v: 1, w: p.width, d: p.depth, t: p.tolerance, paths: p.paths });
}

/** Rilegge il commento: null se non è JSON, la versione è ignota, le misure non sono valide o i contorni non passano `sanitizePaths`. */
export function decodePathMeta(text: string): PathMeta | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { v, w, d, t, paths } = data as { v?: unknown; w?: unknown; d?: unknown; t?: unknown; paths?: unknown };
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= MAX_COORD;
  if (v !== 1 || !finite(w) || !finite(d) || !finite(t)) return null;
  const clean = sanitizePaths(paths);
  return clean ? { paths: clean, tolerance: clampTolerance(t), width: w, depth: d } : null;
}
