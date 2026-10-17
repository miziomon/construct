import { MAX_PATH_CONTOURS, MAX_PATH_NODES, PATH_DEFAULT_TOLERANCE, bboxOf, cubicPoint, samplePaths, segmentOf, signedArea, splitCubic } from '../../scene/bezier';
import { ellipseContour, polygonContour, regularPolygon } from '../../scene/pathShapes';
import { REVOLVE_DEFAULT_ANGLE, REVOLVE_DEFAULT_SEGMENTS, pathContours, pathNaturalBox } from '../../scene/shapes2d';
import { hasBoundDimension } from '../../scene/resize';
import { shape2dDefaults } from '../../scene/defaults';
import type { Draft, PathContour, PathNode, Shape2DNode, Vec2 } from '../../scene/types';

// Il tipo vive nella scena (lo usa anche lo store): qui si riesporta per chi lo importava da qui
export type { Draft };

/**
 * Modello del disegno nella modale del Profilo: funzioni pure e IMMUTABILI sui contorni (`PathContour[]`). Ogni funzione
 * restituisce contorni nuovi e riusa per riferimento quelli che non cambiano: la cache del riquadro naturale
 * (`pathNaturalBox`) e la cronologia locale si basano sull'identità degli array, quindi nessuna funzione modifica
 * l'input. Le coordinate sono quelle dell'editor (mm, Y verso l'alto); le maniglie sono relative al nodo.
 */

/** Un nodo: indice del contorno e del nodo dentro il contorno. */
export type NodeRef = { path: number; node: number };
/** Una maniglia: il nodo e il lato (`in` verso il nodo precedente, `out` verso il successivo). */
export type HandleRef = NodeRef & { side: 'in' | 'out' };
/** Un segmento: il segmento `segment` va dal nodo `segment` al successivo (l'ultimo torna al primo se il contorno è chiuso). */
export type SegmentRef = { path: number; segment: number };

/** Sotto questa lunghezza (mm) una maniglia non esiste: si toglie invece di tenerla a zero. */
const EPS = 1e-9;

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
/** Moltiplica per k; `+ 0` toglie il -0 (0 × -1) dai dati. */
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k + 0, a[1] * k + 0];
const length = (a: Vec2): number => Math.hypot(a[0], a[1]);
const dist = (a: Vec2, b: Vec2): number => length(sub(a, b));

/** Nodo con le sole maniglie che esistono: un campo `in`/`out` assente o nullo non si scrive (i dati restano puliti). */
function makeNode(p: Vec2, inn: Vec2 | undefined, out: Vec2 | undefined, kind: PathNode['kind']): PathNode {
  return { p, ...(inn && length(inn) > EPS ? { in: inn } : {}), ...(out && length(out) > EPS ? { out } : {}), kind };
}

/** Sostituisce il nodo indicato con il risultato di `fn`; se il riferimento non esiste i contorni restano com'erano. */
function mapNode(paths: PathContour[], ref: NodeRef, fn: (n: PathNode) => PathNode): PathContour[] {
  const contour = paths[ref.path];
  if (!contour || !contour.nodes[ref.node]) return paths;
  const nodes = contour.nodes.map((n, i) => (i === ref.node ? fn(n) : n));
  return paths.map((c, i) => (i === ref.path ? { ...c, nodes } : c));
}

/** Sposta i nodi indicati del vettore `d` (mm): le maniglie sono relative, quindi seguono da sole. */
export function moveNodes(paths: PathContour[], refs: NodeRef[], d: Vec2): PathContour[] {
  const keys = new Set(refs.map((r) => `${r.path}:${r.node}`));
  return paths.map((c, pi) => {
    if (!c.nodes.some((_, ni) => keys.has(`${pi}:${ni}`))) return c;
    return { ...c, nodes: c.nodes.map((n, ni) => (keys.has(`${pi}:${ni}`) ? { ...n, p: add(n.p, d) } : n)) };
  });
}

/**
 * Porta una maniglia nel punto assoluto `to` e applica il vincolo del tipo di nodo all'altra: liscio = allineata e
 * opposta con la propria lunghezza (se non c'è, resta assente: l'utente l'aveva ritirata), simmetrico = uguale e opposta,
 * spigolo = indipendente. Con `breakTangent` (Alt) il nodo liscio o simmetrico diventa spigolo e l'altra non si tocca.
 */
export function moveHandle(paths: PathContour[], h: HandleRef, to: Vec2, breakTangent: boolean): PathContour[] {
  return mapNode(paths, h, (n) => {
    const vec = sub(to, n.p);
    const moved = length(vec) > EPS ? vec : undefined;
    const kind = breakTangent && n.kind !== 'corner' ? 'corner' : n.kind;
    const otherSide = h.side === 'in' ? 'out' : 'in';
    let other = n[otherSide];
    if (kind === 'symmetric') other = moved ? scale(moved, -1) : undefined;
    else if (kind === 'smooth' && moved && other) other = scale(moved, -length(other) / length(moved));
    return h.side === 'in' ? makeNode(n.p, moved, other, kind) : makeNode(n.p, other, moved, kind);
  });
}

/** Tipo successivo nel ciclo del doppio clic: spigolo, liscio, simmetrico. */
export function cycleKind(k: PathNode['kind']): PathNode['kind'] {
  return k === 'corner' ? 'smooth' : k === 'smooth' ? 'symmetric' : 'corner';
}

/**
 * Cambia il tipo di un nodo. Verso liscio o simmetrico: senza maniglie ne nascono due lungo la tangente dei vicini (un
 * terzo della distanza dal più vicino); con una sola, l'altra è la sua opposta; con due si allinea la seconda alla prima.
 * Verso spigolo cambia solo il tipo: le maniglie restano, la forma non cambia.
 */
export function setNodeKind(paths: PathContour[], r: NodeRef, kind: PathNode['kind']): PathContour[] {
  const contour = paths[r.path];
  return mapNode(paths, r, (n) => {
    if (kind === 'corner') return { ...n, kind };
    let { in: inn, out } = n;
    if (!inn && !out) {
      // Nessuna maniglia: la tangente segue il segmento tra i vicini (in un contorno aperto, gli estremi hanno un vicino solo)
      const last = contour.nodes.length - 1;
      const prev = r.node > 0 ? contour.nodes[r.node - 1] : contour.closed ? contour.nodes[last] : undefined;
      const next = r.node < last ? contour.nodes[r.node + 1] : contour.closed ? contour.nodes[0] : undefined;
      const dir = sub(next ? next.p : n.p, prev ? prev.p : n.p);
      const reach = Math.min(prev ? dist(prev.p, n.p) : Infinity, next ? dist(next.p, n.p) : Infinity) / 3;
      // Vicini coincidenti con il nodo, o nodo solo: nessuna tangente, cambia solo il tipo
      if (length(dir) < EPS || !Number.isFinite(reach) || reach < EPS) return { ...n, kind };
      out = scale(dir, reach / length(dir));
      inn = scale(out, -1);
    } else if (out && !inn) inn = scale(out, -1);
    else if (inn && !out) out = scale(inn, -1);
    else if (kind === 'smooth' && inn && out) inn = scale(out, -length(inn) / length(out));
    else if (out) inn = scale(out, -1);
    return makeNode(n.p, inn, out, kind);
  });
}

/**
 * Inserisce un nodo sul segmento al parametro `t` (0 < t < 1) con de Casteljau: la forma non cambia. Su un segmento retto
 * nasce uno spigolo senza maniglie; su una curva un nodo liscio e le maniglie dei due estremi si accorciano. Un estremo
 * simmetrico, con una maniglia più corta dell'altra, diventa liscio (resta vera la tangente, non l'uguaglianza).
 * Restituisce i contorni nuovi e il riferimento al nodo inserito, oppure null se non si può (t fuori dall'intervallo, segmento
 * inesistente o contorno già al massimo dei nodi).
 */
export function insertNode(paths: PathContour[], seg: SegmentRef, t: number): { paths: PathContour[]; node: NodeRef } | null {
  const contour = paths[seg.path];
  if (!contour || !(t > 0 && t < 1) || contour.nodes.length >= MAX_PATH_NODES) return null;
  const count = contour.closed ? contour.nodes.length : contour.nodes.length - 1;
  if (seg.segment < 0 || seg.segment >= count) return null;
  const j = (seg.segment + 1) % contour.nodes.length;
  const a = contour.nodes[seg.segment];
  const b = contour.nodes[j];
  const { cubic, straight } = segmentOf(contour, seg.segment);
  let fresh: PathNode;
  let newA = a;
  let newB = b;
  if (straight) {
    fresh = { p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t], kind: 'corner' };
  } else {
    const [left, right] = splitCubic(cubic, t);
    const mid = left[3];
    fresh = makeNode(mid, sub(left[2], mid), sub(right[1], mid), 'smooth');
    // Le maniglie degli estremi si accorciano: quella interna al segmento è la prima di ciascuna metà
    newA = makeNode(a.p, a.in, sub(left[1], a.p), a.kind === 'symmetric' ? 'smooth' : a.kind);
    newB = makeNode(b.p, sub(right[2], b.p), b.out, b.kind === 'symmetric' ? 'smooth' : b.kind);
  }
  // L'ultimo segmento di un contorno chiuso va dall'ultimo nodo al primo: il nuovo nodo va in fondo all'elenco
  const nodes = contour.nodes.map((n, i) => (i === seg.segment ? newA : i === j ? newB : n));
  nodes.splice(seg.segment + 1, 0, fresh);
  return { paths: paths.map((c, i) => (i === seg.path ? { ...c, nodes } : c)), node: { path: seg.path, node: seg.segment + 1 } };
}

/** Elimina i nodi indicati; un contorno che resta con meno di 2 nodi sparisce. */
export function deleteNodes(paths: PathContour[], refs: NodeRef[]): PathContour[] {
  const keys = new Set(refs.map((r) => `${r.path}:${r.node}`));
  const result: PathContour[] = [];
  paths.forEach((c, pi) => {
    if (!c.nodes.some((_, ni) => keys.has(`${pi}:${ni}`))) {
      result.push(c);
      return;
    }
    const nodes = c.nodes.filter((_, ni) => !keys.has(`${pi}:${ni}`));
    if (nodes.length >= 2) result.push({ ...c, nodes });
  });
  return result;
}

/**
 * Segmento più vicino al punto `p` entro `tol` mm (la tolleranza la sceglie chi chiama, di solito qualche pixel
 * convertito in mm): il parametro `t` del punto più vicino e la distanza. Null se nessun segmento è abbastanza vicino.
 */
export function nearestSegment(paths: PathContour[], tol: number, p: Vec2): { path: number; segment: number; t: number; distance: number } | null {
  let best: { path: number; segment: number; t: number; distance: number } | null = null;
  paths.forEach((c, pi) => {
    const count = c.closed ? c.nodes.length : c.nodes.length - 1;
    for (let si = 0; si < count; si++) {
      const { cubic, straight } = segmentOf(c, si);
      let t: number;
      let d: number;
      if (straight) {
        // Proiezione esatta sul segmento
        const dir = sub(cubic[3], cubic[0]);
        const len2 = dir[0] * dir[0] + dir[1] * dir[1];
        t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - cubic[0][0]) * dir[0] + (p[1] - cubic[0][1]) * dir[1]) / len2));
        d = dist(p, cubicPoint(cubic, t));
      } else {
        // Curva: ricerca grossolana su 40 passi e poi più fine attorno al migliore (precisione di 1/400 del parametro)
        t = 0;
        d = Infinity;
        const probe = (u: number) => {
          const e = dist(p, cubicPoint(cubic, u));
          if (e < d) [t, d] = [u, e];
        };
        for (let k = 0; k <= 40; k++) probe(k / 40);
        const coarse = t;
        for (let k = -10; k <= 10; k++) probe(Math.min(1, Math.max(0, coarse + k / 400)));
      }
      if (d <= tol && (!best || d < best.distance)) best = { path: pi, segment: si, t, distance: d };
    }
  });
  return best;
}

/** Vero se il punto `p` sta dentro il poligono (regola pari-dispari: un raggio verso destra che attraversa un numero dispari di lati). */
export function pointInPolygon(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Vero se il punto `p` sta dentro il contorno (regola pari-dispari sul contorno campionato). Un contorno aperto si considera
 * chiuso da un tratto retto, come fa l'estrusione lineare; sotto i 3 nodi non c'è area.
 */
export function contourContains(c: PathContour, p: Vec2): boolean {
  if (c.nodes.length < 3) return false;
  const poly: Vec2[] = [];
  const count = c.closed ? c.nodes.length : c.nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const { cubic, straight } = segmentOf(c, i);
    poly.push(cubic[0]);
    if (!straight) for (let k = 1; k < 16; k++) poly.push(cubicPoint(cubic, k / 16));
  }
  if (!c.closed) poly.push(c.nodes[c.nodes.length - 1].p);
  return pointInPolygon(poly, p);
}

/**
 * Quali contorni sono fori: un elemento per contorno, nello stesso ordine di `d.paths` (`true` foro, `false` contorno,
 * `null` senza area, che il kernel scarta). Si parte dagli stessi poligoni del kernel (stesso campionamento; in rotazione un
 * contorno aperto si chiude sull'asse, a x = 0 nel sistema dell'editor, come in `pathContours`). Un contorno ha tanti
 * livelli di annidamento quanti sono gli altri poligoni che contengono il suo primo punto: con riempimento pari-dispari
 * un livello dispari è un foro.
 */
export function contourHoles(d: Pick<Draft, 'paths' | 'tolerance' | 'extrusion'>): (boolean | null)[] {
  const rotational = d.extrusion === 'rotate';
  // Poligono di ogni contorno (null se il kernel lo scarta: meno di 2 punti, o senza area)
  const polygons = samplePaths(d.paths, d.tolerance).contours.map((c): Vec2[] | null => {
    const points = c.points.slice();
    if (points.length < 2) return null;
    if (rotational && !c.closed) {
      // Dall'ultimo punto all'asse e dall'asse al primo, senza punti doppi
      const [first, last] = [points[0], points[points.length - 1]];
      for (const q of [[0, last[1]], [0, first[1]]] as Vec2[]) {
        const tail = points[points.length - 1];
        if (q[0] !== tail[0] || q[1] !== tail[1]) points.push(q);
      }
      const end = points[points.length - 1];
      if (end[0] === first[0] && end[1] === first[1]) points.pop();
    }
    return points.length >= 3 && Math.abs(signedArea(points)) > 1e-8 ? points : null;
  });
  // Riquadri: se il primo punto sta fuori dal riquadro di un poligono non serve provare i lati
  const boxes = polygons.map((poly) => (poly ? bboxOf([poly]) : null));
  return polygons.map((poly, i) => {
    if (!poly) return null;
    const probe = poly[0];
    let depth = 0;
    polygons.forEach((other, j) => {
      const box = boxes[j];
      if (j === i || !other || !box || probe[0] < box.minX || probe[0] > box.maxX || probe[1] < box.minY || probe[1] > box.maxY) return;
      if (pointInPolygon(other, probe)) depth++;
    });
    return depth % 2 === 1;
  });
}

/**
 * Vero se il contorno aperto `c` può chiudersi con un'area: da 3 nodi sempre; con 2 serve almeno un segmento curvo (due rette
 * che vanno e tornano sullo stesso segmento non racchiudono nulla).
 */
export function canCloseContour(c: PathContour): boolean {
  if (c.nodes.length >= 3) return true;
  if (c.nodes.length < 2) return false;
  const closed: PathContour = { ...c, closed: true };
  return !segmentOf(closed, 0).straight || !segmentOf(closed, 1).straight;
}

/** Chiude il contorno `i` (l'ultimo nodo si unisce al primo); se non esiste, è già chiuso o ha meno di 2 nodi non cambia nulla. */
export function closeContour(paths: PathContour[], i: number): PathContour[] {
  const c = paths[i];
  if (!c || c.closed || c.nodes.length < 2) return paths;
  return paths.map((x, k) => (k === i ? { ...x, closed: true } : x));
}

/**
 * Aggiunge alla Penna un nodo nel punto `p` al contorno aperto `current` (o ne inizia uno nuovo se `current` è null, non
 * esiste o è chiuso). Con `out` (clic e trascina: la maniglia come vettore relativo) il nodo è simmetrico con le maniglie
 * opposte; senza, è uno spigolo. Con `corner` (Alt premuto durante il trascinamento) il nodo è sempre uno spigolo: `out`
 * segue il puntatore e `in` è quella indicata da `corner.keepIn` (la maniglia che il nodo aveva quando Alt è stato premuto),
 * o manca. Restituisce null se si superano i limiti (500 nodi per contorno, 100 contorni).
 */
export function appendPenNode(paths: PathContour[], current: number | null, p: Vec2, out?: Vec2, corner?: { keepIn?: Vec2 }): { paths: PathContour[]; current: number; node: NodeRef } | null {
  const node: PathNode = corner ? makeNode(p, corner.keepIn, out, 'corner') : out && length(out) > EPS ? { p, in: scale(out, -1), out, kind: 'symmetric' } : { p, kind: 'corner' };
  const open = current !== null ? paths[current] : undefined;
  if (current === null || !open || open.closed) {
    if (paths.length >= MAX_PATH_CONTOURS) return null;
    return { paths: [...paths, { closed: false, nodes: [node] }], current: paths.length, node: { path: paths.length, node: 0 } };
  }
  if (open.nodes.length >= MAX_PATH_NODES) return null;
  return {
    paths: paths.map((c, i) => (i === current ? { ...c, nodes: [...c.nodes, node] } : c)),
    current,
    node: { path: current, node: open.nodes.length },
  };
}

/** Contorno percorso al contrario: nodi in ordine inverso e maniglie `in` e `out` scambiate, la forma non cambia. */
function reversed(c: PathContour): PathContour {
  return { ...c, nodes: c.nodes.slice().reverse().map((n) => makeNode(n.p, n.out, n.in, n.kind)) };
}

/** Vero se `ref` è il primo o l'ultimo nodo di un contorno aperto (un estremo da cui riprendere il disegno). */
export function isOpenEnd(paths: PathContour[], ref: NodeRef): boolean {
  const c = paths[ref.path];
  return !!c && !c.closed && c.nodes.length >= 1 && (ref.node === 0 || ref.node === c.nodes.length - 1);
}

/**
 * Riprende il disegno di un contorno aperto da un estremo: l'estremo cliccato diventa l'ultimo nodo, quindi un contorno
 * ripreso dal primo nodo si inverte (la forma non cambia). Restituisce i contorni e l'indice del contorno da continuare,
 * oppure null se `ref` non è un estremo di un contorno aperto.
 */
export function resumeContour(paths: PathContour[], ref: NodeRef): { paths: PathContour[]; current: number } | null {
  if (!isOpenEnd(paths, ref)) return null;
  const c = paths[ref.path];
  if (ref.node === c.nodes.length - 1) return { paths, current: ref.path };
  return { paths: paths.map((x, i) => (i === ref.path ? reversed(x) : x)), current: ref.path };
}

/**
 * Unisce al contorno aperto `active` quello a cui appartiene l'estremo `end`: i nodi del secondo si accodano al primo
 * partendo dall'estremo cliccato (il secondo si inverte se è l'ultimo) e il disegno prosegue dal suo altro estremo. Il
 * secondo contorno sparisce. Restituisce i contorni e il nuovo indice del contorno unito, oppure null se `end` non è un
 * estremo di un altro contorno aperto o si superano i nodi consentiti.
 */
export function joinContours(paths: PathContour[], active: number, end: NodeRef): { paths: PathContour[]; current: number } | null {
  const a = paths[active];
  if (!a || a.closed || end.path === active || !isOpenEnd(paths, end)) return null;
  const b = paths[end.path];
  if (a.nodes.length + b.nodes.length > MAX_PATH_NODES) return null;
  const tail = end.node === 0 ? b : reversed(b);
  const merged: PathContour = { ...a, nodes: [...a.nodes, ...tail.nodes] };
  const result = paths.map((c, i) => (i === active ? merged : c)).filter((_, i) => i !== end.path);
  return { paths: result, current: end.path < active ? active - 1 : active };
}

/** Toglie l'ultimo nodo del contorno `i` (Backspace della Penna); un contorno che resta senza nodi sparisce. */
export function dropLastNode(paths: PathContour[], i: number): PathContour[] {
  const c = paths[i];
  if (!c) return paths;
  if (c.nodes.length <= 1) return paths.filter((_, k) => k !== i);
  return paths.map((x, k) => (k === i ? { ...x, nodes: x.nodes.slice(0, -1) } : x));
}

/** Toglie l'ultimo nodo del contorno `i` se coincide con il penultimo (il secondo clic di un doppio clic della Penna). */
export function trimDuplicateTail(paths: PathContour[], i: number): PathContour[] {
  const c = paths[i];
  if (!c || c.nodes.length < 2) return paths;
  const [last, prev] = [c.nodes[c.nodes.length - 1], c.nodes[c.nodes.length - 2]];
  return dist(last.p, prev.p) < 1e-6 ? dropLastNode(paths, i) : paths;
}

/**
 * Incorpora una scala nei nodi: posizioni e maniglie si scalano di `sx`, `sy` attorno al centro (cx, cy), che resta
 * dov'è. Serve ad aprire nella modale un profilo ingrandito col gizmo: il disegno mostra la misura vera.
 */
export function bakeScale(paths: PathContour[], sx: number, sy: number, cx: number, cy: number): PathContour[] {
  const point = (p: Vec2): Vec2 => [cx + (p[0] - cx) * sx, cy + (p[1] - cy) * sy];
  const handle = (h: Vec2): Vec2 => [h[0] * sx, h[1] * sy];
  return paths.map((c) => ({
    ...c,
    nodes: c.nodes.map((n) => ({ p: point(n.p), ...(n.in ? { in: handle(n.in) } : {}), ...(n.out ? { out: handle(n.out) } : {}), kind: n.kind })),
  }));
}

/** Opzioni dell'aggancio: `radius` e `grid` sono in mm (chi chiama converte i pixel con lo zoom). */
export interface SnapOptions {
  /** Passo della griglia (mm); assente = niente aggancio alla griglia. */
  grid?: number;
  /** Nodi esistenti a cui agganciarsi. */
  nodes?: Vec2[];
  /** Punto precedente: serve all'allineamento orizzontale/verticale e al vincolo dei 45°. */
  prev?: Vec2;
  /** Allinea alla X o alla Y del punto precedente se è entro `radius`. */
  ortho: boolean;
  /** Vincola la direzione dal punto precedente a multipli di 45° (Maiusc). */
  angle45: boolean;
  /** Distanza massima di aggancio, in mm. */
  radius: number;
}

/**
 * Aggancia il punto `p`. Priorità: vincolo a 45° dal punto precedente (esclusivo), poi il nodo più vicino entro `radius`
 * (esclusivo), poi griglia e allineamento orizzontale/verticale al punto precedente. Per sospendere l'aggancio (Ctrl) chi
 * chiama non la usa.
 */
export function snapPoint(p: Vec2, o: SnapOptions): Vec2 {
  if (o.angle45 && o.prev) {
    const d = sub(p, o.prev);
    const a = Math.round(Math.atan2(d[1], d[0]) / (Math.PI / 4)) * (Math.PI / 4);
    const len = length(d);
    return [o.prev[0] + Math.cos(a) * len, o.prev[1] + Math.sin(a) * len];
  }
  let nearest: Vec2 | null = null;
  let best = o.radius;
  for (const n of o.nodes ?? []) {
    const d = dist(p, n);
    if (d < best) [nearest, best] = [n, d];
  }
  if (nearest) return [nearest[0], nearest[1]];
  let q: Vec2 = [p[0], p[1]];
  if (o.grid && o.grid > 0) q = [Math.round(p[0] / o.grid) * o.grid, Math.round(p[1] / o.grid) * o.grid];
  if (o.ortho && o.prev) {
    if (Math.abs(p[0] - o.prev[0]) < o.radius) q[0] = o.prev[0];
    if (Math.abs(p[1] - o.prev[1]) < o.radius) q[1] = o.prev[1];
  }
  return q;
}

/**
 * Passo della griglia da usare con lo zoom attuale (`pxPerMm` pixel per mm): parte da `base` e si allarga di 5 volte
 * finché le righe distano meno di 10 pixel, così non ci si aggancia a righe invisibili.
 */
export function gridStep(base: number, pxPerMm: number): number {
  if (!(base > 0) || !(pxPerMm > 0)) return base;
  let step = base;
  while (step * pxPerMm < 10) step *= 5;
  return step;
}

/** Limiti del numero di lati del poligono regolare e valore iniziale. */
export const POLYGON_SIDES = { min: 3, max: 24, default: 6 };

/**
 * Forma base trascinata dal centro con uno strumento della modale: `center` è il punto premuto, `to` il puntatore (entrambi
 * già agganciati). Rettangolo ed ellisse hanno per semiassi le distanze in X e in Y; il poligono ha per raggio la distanza e il
 * primo vertice verso il puntatore. Con `shift`: quadrato e cerchio (lato maggiore) o, per il poligono, l'angolo a multipli di 15°.
 */
export interface BaseShape {
  tool: 'rect' | 'ellipse' | 'polygon';
  center: Vec2;
  to: Vec2;
  shift: boolean;
  /** Lati del poligono (3-24). */
  sides: number;
}

/** Misura minima (mm) sotto cui una forma base non esiste: un clic senza trascinamento non crea nulla. */
const MIN_SHAPE = 1e-6;

/** Contorno chiuso della forma base, con le sue coordinate nel sistema dell'editor; null se la misura è nulla. */
export function baseShapeContour(s: BaseShape): PathContour | null {
  const [dx, dy] = sub(s.to, s.center);
  if (s.tool === 'polygon') {
    const radius = Math.hypot(dx, dy);
    if (radius <= MIN_SHAPE) return null;
    const angle = Math.atan2(dy, dx);
    // Con Maiusc il primo vertice sta a multipli di 15 gradi
    const first = s.shift ? Math.round(angle / (Math.PI / 12)) * (Math.PI / 12) : angle;
    return polygonContour(regularPolygon(Math.min(POLYGON_SIDES.max, Math.max(POLYGON_SIDES.min, Math.round(s.sides))), radius, first, s.center));
  }
  // Semiassi: con Maiusc il maggiore dei due (quadrato, cerchio)
  const [hx, hy] = s.shift ? [Math.max(Math.abs(dx), Math.abs(dy)), Math.max(Math.abs(dx), Math.abs(dy))] : [Math.abs(dx), Math.abs(dy)];
  if (hx <= MIN_SHAPE || hy <= MIN_SHAPE) return null;
  if (s.tool === 'ellipse') return ellipseContour(s.center[0], s.center[1], hx, hy);
  const [cx, cy] = s.center;
  return polygonContour([[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]]);
}

/** Centro del riquadro naturale del disegno (le sole curve), o l'origine se è vuoto: è il punto che finisce nell'origine del nodo. */
export function pathCenter(d: Pick<Draft, 'paths'>): Vec2 {
  const box = pathNaturalBox(d);
  return box ? [box.cx, box.cy] : [0, 0];
}

/**
 * Poligoni che il kernel riempie per il disegno, nel sistema dell'editor (per il riempimento della modale): sono i
 * contorni di `pathContours` (stesso campionamento, chiusura dei contorni aperti sull'asse in rotazione, contorni senza
 * area scartati) alla misura naturale, cioè senza scala, riportati dal centro nell'origine alle coordinate del disegno.
 */
export function draftContours(d: Draft): Vec2[][] {
  const box = pathNaturalBox(d);
  if (!box) return [];
  const contours = pathContours({ paths: d.paths, tolerance: d.tolerance, width: box.width, depth: box.depth, extrusion: d.extrusion });
  return contours.map((c) => c.map(([x, y]): Vec2 => [x + box.cx, y + box.cy]));
}

/** Disegno vuoto con i valori iniziali di un Profilo nuovo (estrusione lineare). */
export function emptyDraft(): Draft {
  const d = shape2dDefaults('path');
  return { paths: [], tolerance: PATH_DEFAULT_TOLERANCE, extrusion: 'linear', height: d.height, twist: d.twist, scaleTop: d.scaleTop, revolveAngle: REVOLVE_DEFAULT_ANGLE, revolveSegments: REVOLVE_DEFAULT_SEGMENTS };
}

/**
 * Disegno di un Profilo esistente, da aprire nella modale. Se è stato ingrandito o ridotto col gizmo (`width × depth` diverse
 * dal riquadro naturale) la scala si incorpora nei nodi, così il disegno mostra la misura vera; con misure legate a un
 * parametro non si incorpora nulla (la misura è decisa dalla formula). Un riquadro naturale senza larghezza o profondità
 * (una linea) non si può scalare e resta com'è.
 */
export function draftFromNode(node: Extract<Shape2DNode, { kind: 'path' }>): Draft {
  const box = pathNaturalBox(node);
  let paths = node.paths;
  if (box && box.width > 0 && box.depth > 0 && !hasBoundDimension(node)) {
    // Stesso minimo di `svgContours`, così il disegno coincide con quello che il kernel scala
    const sx = Math.max(0.01, node.width) / box.width;
    const sy = Math.max(0.01, node.depth) / box.depth;
    if (sx !== 1 || sy !== 1) paths = bakeScale(paths, sx, sy, box.cx, box.cy);
  }
  return {
    paths,
    tolerance: node.tolerance,
    extrusion: node.extrusion ?? 'linear',
    height: node.height,
    twist: node.twist,
    scaleTop: node.scaleTop,
    revolveAngle: node.revolveAngle ?? REVOLVE_DEFAULT_ANGLE,
    revolveSegments: node.revolveSegments ?? REVOLVE_DEFAULT_SEGMENTS,
  };
}
