import type { Cubic } from './bezier';
import type { PathContour, PathNode, Vec2 } from './types';

/**
 * Contorni di Bézier delle forme base (cerchio, ellisse, poligoni, angoli arrotondati) e costruzione di un contorno da
 * una sequenza di segmenti. Funzioni pure condivise da "Converti in profilo", dalle forme base della modale e
 * dall'import SVG: una sola costruzione degli archi per tutti.
 */

/** Costante delle quattro cubiche che approssimano un cerchio: 4/3 · tan(π/8). */
export const KAPPA = 0.5522847498;

/** Sotto questa distanza (mm) due punti coincidono e una maniglia non esiste. */
const EPS = 1e-9;
/** Seno massimo dell'angolo tra due maniglie perché il nodo sia liscio (circa 1,1°). */
const SMOOTH_SINE = 0.02;
/** Distanza massima, in frazione della diagonale del riquadro dei nodi, perché l'ultimo punto di un contorno chiuso coincida con il primo. */
const CLOSE_RATIO = 1e-4;
/** Differenza relativa massima tra le lunghezze delle maniglie perché il nodo sia simmetrico. */
const SYMMETRIC_RATIO = 0.01;

/** Segmento assoluto: punto d'arrivo e, se è curvo, le due maniglie (assenti = segmento retto). */
export interface PathSeg {
  to: Vec2;
  c1?: Vec2;
  c2?: Vec2;
}

/** Segmento curvo da una cubica (il punto iniziale è quello del segmento precedente). */
export const cubicSeg = (c: Cubic): PathSeg => ({ c1: c[1], c2: c[2], to: c[3] });

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);

/**
 * Cubiche che approssimano un arco della circonferenza unitaria, da `a0` per `sweep` radianti (con segno: positivo =
 * antiorario). Ogni pezzo copre al più 90° e ha le maniglie lunghe 4/3 · tan(θ/4), la costruzione standard: l'errore
 * radiale resta sotto 3 su 10000 del raggio. Chi chiama scala, ruota e sposta le cubiche.
 */
export function arcCubics(a0: number, sweep: number): Cubic[] {
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const theta = sweep / pieces;
  const k = (4 / 3) * Math.tan(theta / 4);
  const cubics: Cubic[] = [];
  for (let i = 0; i < pieces; i++) {
    const a = a0 + theta * i;
    const b = a + theta;
    const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
    // Le maniglie vanno lungo la tangente ai due estremi (perpendicolare al raggio)
    cubics.push([[ca, sa], [ca - k * sa, sa + k * ca], [cb + k * sb, sb - k * cb], [cb, sb]]);
  }
  return cubics;
}

/**
 * Tipo di un nodo dalle sue maniglie (relative): spigolo se ne manca una o non sono opposte, liscio se sono opposte
 * (entro circa 1°), simmetrico se in più hanno la stessa lunghezza (entro l'1%). Serve a chi costruisce un contorno
 * da dati che il tipo non lo portano (SVG, forme base).
 */
export function inferKind(inn: Vec2 | undefined, out: Vec2 | undefined): PathNode['kind'] {
  if (!inn || !out) return 'corner';
  const [li, lo] = [len(inn), len(out)];
  if (li < EPS || lo < EPS) return 'corner';
  const sine = Math.abs(inn[0] * out[1] - inn[1] * out[0]) / (li * lo);
  const opposite = inn[0] * out[0] + inn[1] * out[1] < 0;
  if (!opposite || sine > SMOOTH_SINE) return 'corner';
  return Math.abs(li - lo) / Math.max(li, lo) <= SYMMETRIC_RATIO ? 'symmetric' : 'smooth';
}

/**
 * Contorno da un punto iniziale e una sequenza di segmenti assoluti. Un contorno chiuso il cui ultimo segmento torna
 * al punto iniziale non ripete il nodo: la maniglia in arrivo passa al primo. I segmenti retti senza lunghezza si
 * scartano. Restituisce null se restano meno di 2 nodi (nulla da disegnare).
 */
export function cubicsToContour(start: Vec2, segs: PathSeg[], closed: boolean): PathContour | null {
  const points: Vec2[] = [start];
  // Maniglie assolute: `outs[i]` esce dal nodo i, `ins[i]` entra nel nodo i
  const outs: (Vec2 | undefined)[] = [undefined];
  const ins: (Vec2 | undefined)[] = [undefined];
  for (const s of segs) {
    const prev = points[points.length - 1];
    if (!s.c1 && !s.c2 && len(sub(s.to, prev)) < EPS) continue;
    outs[points.length - 1] = s.c1;
    points.push(s.to);
    ins.push(s.c2);
    outs.push(undefined);
  }
  // Chiusura sul punto iniziale: l'ultimo nodo coincide con il primo, la sua maniglia in arrivo passa al primo. La tolleranza è
  // relativa alla misura del contorno: coordinate relative arrotondate (SVG) tornano al punto iniziale con un errore di millesimi
  // Il riquadro si calcola con un ciclo: `Math.max(...punti)` va in errore con centinaia di migliaia di punti
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const closeTol = Math.max(EPS, CLOSE_RATIO * Math.hypot(maxX - minX, maxY - minY));
  if (closed && points.length > 1 && len(sub(points[points.length - 1], start)) < closeTol) {
    ins[0] = ins[points.length - 1];
    points.pop();
    ins.pop();
    outs.pop();
  }
  if (points.length < 2) return null;
  const nodes = points.map((p, i): PathNode => {
    // Maniglie relative al nodo; una lunga zero non esiste
    const inn = ins[i] && len(sub(ins[i]!, p)) > EPS ? sub(ins[i]!, p) : undefined;
    const out = outs[i] && len(sub(outs[i]!, p)) > EPS ? sub(outs[i]!, p) : undefined;
    return { p, ...(inn ? { in: inn } : {}), ...(out ? { out } : {}), kind: inferKind(inn, out) };
  });
  return { closed, nodes };
}

/** Vertici di un poligono regolare di `n` lati e raggio `r` (distanza dal centro), in senso antiorario dal primo vertice, a `a0` radianti. */
export function regularPolygon(n: number, r: number, a0 = 0, center: Vec2 = [0, 0]): Vec2[] {
  return Array.from({ length: n }, (_, i): Vec2 => [center[0] + r * Math.cos(a0 + (2 * Math.PI * i) / n), center[1] + r * Math.sin(a0 + (2 * Math.PI * i) / n)]);
}

/** Contorno chiuso di soli spigoli (nessuna maniglia) sui punti dati. */
export function polygonContour(points: Vec2[]): PathContour {
  return { closed: true, nodes: points.map((p): PathNode => ({ p, kind: 'corner' })) };
}

/** Ellisse di centro (cx, cy) e semiassi rx, ry: quattro nodi simmetrici con le maniglie lunghe KAPPA per il semiasse. */
export function ellipseContour(cx: number, cy: number, rx: number, ry: number): PathContour {
  // Un giro completo della circonferenza unitaria (4 cubiche) portato sull'ellisse con una scala e uno spostamento
  const place = (p: Vec2): Vec2 => [cx + p[0] * rx, cy + p[1] * ry];
  const cubics = arcCubics(0, 2 * Math.PI);
  return cubicsToContour(place(cubics[0][0]), cubics.map((c) => ({ c1: place(c[1]), c2: place(c[2]), to: place(c[3]) })), true)!;
}

/**
 * Poligono convesso antiorario con gli angoli arrotondati di raggio `rc`: il poligono "gonfiato" di `rc` (come un
 * offset arrotondato). Ogni vertice diventa un arco di raggio `rc` centrato nel vertice, tra le normali dei due lati,
 * e i lati restano rette spostate verso l'esterno di `rc`: con `rc` nullo è il poligono stesso.
 */
export function roundedPolygonContour(vertices: Vec2[], rc: number): PathContour {
  if (!(rc > 0)) return polygonContour(vertices);
  const n = vertices.length;
  // Normale uscente di ogni lato (dal vertice i al successivo), per un poligono antiorario
  const normals = vertices.map((v, i): Vec2 => {
    const d = sub(vertices[(i + 1) % n], v);
    return [d[1] / len(d), -d[0] / len(d)];
  });
  const segs: PathSeg[] = [];
  let start: Vec2 | undefined;
  vertices.forEach((v, i) => {
    const [from, to] = [normals[(i + n - 1) % n], normals[i]];
    // Angolo esterno: la rotazione antioraria dalla normale del lato che arriva a quella del lato che parte
    const a0 = Math.atan2(from[1], from[0]);
    let sweep = Math.atan2(to[1], to[0]) - a0;
    if (sweep < 0) sweep += 2 * Math.PI;
    const place = (p: Vec2): Vec2 => [v[0] + rc * p[0], v[1] + rc * p[1]];
    // Il lato dritto che porta all'inizio di questo arco parte dalla fine dell'arco precedente
    const arcs = arcCubics(a0, sweep);
    if (!start) start = place(arcs[0][0]);
    else segs.push({ to: place(arcs[0][0]) });
    for (const c of arcs) segs.push({ c1: place(c[1]), c2: place(c[2]), to: place(c[3]) });
  });
  // Ultimo lato: dalla fine dell'ultimo arco all'inizio del primo
  segs.push({ to: start! });
  return cubicsToContour(start!, segs, true)!;
}
