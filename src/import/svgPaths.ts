import { MAX_PATH_CONTOURS, MAX_PATH_NODES } from '../scene/bezier';
import { arcCubics, cubicSeg, cubicsToContour } from '../scene/pathShapes';
import type { PathSeg } from '../scene/pathShapes';
import { pathNaturalBox } from '../scene/shapes2d';
import type { PathContour, Vec2 } from '../scene/types';
import { unitScale } from './svg';
import { ImportError } from './types';

/**
 * Legge i tracciati di un SVG conservando le curve di Bézier (a differenza di `parseSvg`, che le appiattisce): ogni
 * contorno diventa un `PathContour` con nodi e maniglie. Il parser dei dati `d` è scritto qui perché l'API
 * `SVGPathElement` non espone i punti di controllo. Non si leggono `<style>` (fogli di stile) e `<use>`: limite dichiarato.
 */

/** Sottotracciato: punto iniziale, segmenti assoluti e se si chiude con Z. */
interface Subpath {
  start: Vec2;
  segs: PathSeg[];
  closed: boolean;
}

/** Matrice affine [a, b, c, d, e, f] di SVG: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Prodotto m1 · m2: si applica prima m2, poi m1 (la trasformazione del figlio dentro quella del genitore). */
const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

/** Punto trasformato dalla matrice intera. */
const applyPoint = (m: Matrix, p: Vec2): Vec2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

/**
 * Matrice di un attributo `transform`: le funzioni (matrix, translate, scale, rotate, skewX, skewY) si compongono da
 * sinistra a destra. Una funzione sconosciuta o con argomenti sbagliati si ignora.
 */
export function parseTransform(text: string | null | undefined): Matrix {
  let m = IDENTITY;
  for (const match of (text ?? '').matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const a = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some((n) => !Number.isFinite(n))) continue;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    let t: Matrix | null = null;
    switch (match[1]) {
      case 'matrix':
        if (a.length === 6) t = a as Matrix;
        break;
      case 'translate':
        if (a.length === 1 || a.length === 2) t = [1, 0, 0, 1, a[0], a[1] ?? 0];
        break;
      case 'scale':
        if (a.length === 1 || a.length === 2) t = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
        break;
      case 'rotate':
        if (a.length === 1 || a.length === 3) {
          const [c, s] = [Math.cos(rad(a[0])), Math.sin(rad(a[0]))];
          const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
          // Rotazione attorno a (cx, cy): sposta in origine, ruota, riporta
          t = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        }
        break;
      case 'skewX':
        if (a.length === 1) t = [1, 0, Math.tan(rad(a[0])), 1, 0, 0];
        break;
      case 'skewY':
        if (a.length === 1) t = [1, Math.tan(rad(a[0])), 0, 1, 0, 0];
        break;
    }
    if (t) m = multiply(m, t);
  }
  return m;
}

/**
 * Cubiche di un arco ellittico SVG (comando A) dal punto `p0` a `p1`, con la conversione dagli estremi al centro dell'allegato
 * F.6.5 della specifica. I raggi troppo piccoli si ingrandiscono quanto serve; un raggio nullo è una retta; estremi coincidenti
 * non danno nulla. Ogni pezzo copre al più 90° (vedi `arcCubics`).
 */
export function arcToCubics(p0: Vec2, rxIn: number, ryIn: number, rotation: number, large: boolean, sweep: boolean, p1: Vec2): PathSeg[] {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return [];
  let [rx, ry] = [Math.abs(rxIn), Math.abs(ryIn)];
  if (rx === 0 || ry === 0) return [{ to: p1 }];
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  // Passo 1: l'estremo iniziale nel sistema dell'ellisse (senza rotazione), con il punto medio nell'origine
  const [dx, dy] = [(p0[0] - p1[0]) / 2, (p0[1] - p1[1]) / 2];
  const [x1, y1] = [cos * dx + sin * dy, -sin * dx + cos * dy];
  // Raggi troppo piccoli per unire i due punti: si ingrandiscono
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  // Passo 2: centro nel sistema dell'ellisse
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const [cxp, cyp] = [(coef * rx * y1) / ry, (-coef * ry * x1) / rx];
  const center: Vec2 = [cos * cxp - sin * cyp + (p0[0] + p1[0]) / 2, sin * cxp + cos * cyp + (p0[1] + p1[1]) / 2];
  // Passo 3: angolo iniziale e ampiezza (in senso orario con sweep, che nel piano SVG con Y verso il basso è l'antiorario matematico)
  const theta = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx);
  let delta = Math.atan2((-y1 - cyp) / ry, (-x1 - cxp) / rx) - theta;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  // Le cubiche dell'arco unitario si portano sull'ellisse: scala dei raggi, rotazione, centro
  const place = (q: Vec2): Vec2 => [cos * rx * q[0] - sin * ry * q[1] + center[0], sin * rx * q[0] + cos * ry * q[1] + center[1]];
  const segs = arcCubics(theta, delta).map((c) => cubicSeg([place(c[0]), place(c[1]), place(c[2]), place(c[3])]));
  // L'ultimo punto è esattamente l'estremo richiesto (niente deriva numerica: i contorni chiusi tornano al punto iniziale)
  segs[segs.length - 1].to = p1;
  return segs;
}

/** Quanti numeri legge ogni comando per ogni gruppo di argomenti. */
const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * Legge i dati `d` di un tracciato: comandi M L H V C S Q T A Z, relativi e assoluti. Un lineto implicito segue il moveto, i
 * numeri possono stare attaccati (`1.5.5`, `-1-2`) e i flag degli archi sono un carattere (`a1 1 0 00.5.5`). Un comando dopo Z riparte dal
 * punto iniziale. Le quadratiche diventano cubiche esatte. Un errore di sintassi ferma la lettura: restano i sottotracciati letti fin lì.
 */
export function parsePathData(d: string): Subpath[] {
  const subpaths: Subpath[] = [];
  let sub: Subpath | null = null;
  let cur: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  // Ultima maniglia (assoluta) di una cubica o di una quadratica, per i comandi S e T
  let lastCubic: Vec2 | null = null;
  let lastQuad: Vec2 | null = null;
  let i = 0;
  let cmd = '';

  const skipSeparators = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  /** Numero all'indice corrente, oppure null (senza avanzare) se non c'è. */
  const number = (): number | null => {
    skipSeparators();
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  /** Flag di un arco: un solo carattere, 0 o 1. */
  const flag = (): boolean | null => {
    skipSeparators();
    if (d[i] !== '0' && d[i] !== '1') return null;
    return d[i++] === '1';
  };
  /** Sottotracciato in corso: dopo una Z ne inizia uno nuovo dal punto iniziale. */
  const current = (): Subpath => {
    if (!sub || sub.closed) {
      sub = { start: cur, segs: [], closed: false };
      subpaths.push(sub);
    }
    return sub;
  };

  while (true) {
    skipSeparators();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) {
      cmd = d[i++];
      if (!(cmd.toUpperCase() in ARGS)) break;
    } else if (!cmd || cmd.toUpperCase() === 'Z') {
      // Numeri senza comando (o dopo Z): errore
      break;
    }
    const abs = cmd === cmd.toUpperCase();
    const type = cmd.toUpperCase();
    if (type === 'Z') {
      if (sub) sub.closed = true;
      cur = start;
      lastCubic = lastQuad = null;
      continue;
    }
    // Argomenti di un gruppo; un numero mancante o non valido ferma la lettura
    const args: number[] = [];
    if (type === 'A') {
      // rx ry rotazione flag-grande flag-sweep x y: i flag sono un carattere
      const [rx, ry, rot] = [number(), number(), number()];
      const [large, sweepFlag] = [flag(), flag()];
      const [x, y] = [number(), number()];
      if ([rx, ry, rot, x, y].includes(null) || large === null || sweepFlag === null) break;
      args.push(rx!, ry!, rot!, large ? 1 : 0, sweepFlag ? 1 : 0, x!, y!);
    } else {
      let ok = true;
      for (let k = 0; k < ARGS[type]; k++) {
        const n = number();
        if (n === null) {
          ok = false;
          break;
        }
        args.push(n);
      }
      if (!ok) break;
    }
    // Punto assoluto da una coppia di argomenti (relativa al punto corrente se il comando è minuscolo)
    const pt = (x: number, y: number): Vec2 => (abs ? [x, y] : [cur[0] + x, cur[1] + y]);

    if (type === 'M') {
      cur = start = pt(args[0], args[1]);
      sub = { start: cur, segs: [], closed: false };
      subpaths.push(sub);
      // Le coppie successive di un moveto sono lineto
      cmd = abs ? 'L' : 'l';
      lastCubic = lastQuad = null;
      continue;
    }
    const target = current();
    if (type === 'L' || type === 'H' || type === 'V') {
      const to: Vec2 = type === 'L' ? pt(args[0], args[1]) : type === 'H' ? [abs ? args[0] : cur[0] + args[0], cur[1]] : [cur[0], abs ? args[0] : cur[1] + args[0]];
      target.segs.push({ to });
      cur = to;
      lastCubic = lastQuad = null;
    } else if (type === 'C' || type === 'S') {
      // S: la prima maniglia è il riflesso dell'ultima cubica rispetto al punto corrente
      const c1: Vec2 = type === 'C' ? pt(args[0], args[1]) : lastCubic ? [2 * cur[0] - lastCubic[0], 2 * cur[1] - lastCubic[1]] : cur;
      const o = type === 'C' ? 2 : 0;
      const c2 = pt(args[o], args[o + 1]);
      const to = pt(args[o + 2], args[o + 3]);
      target.segs.push({ c1, c2, to });
      cur = to;
      lastCubic = c2;
      lastQuad = null;
    } else if (type === 'Q' || type === 'T') {
      const q: Vec2 = type === 'Q' ? pt(args[0], args[1]) : lastQuad ? [2 * cur[0] - lastQuad[0], 2 * cur[1] - lastQuad[1]] : cur;
      const to = pt(args[type === 'Q' ? 2 : 0], args[type === 'Q' ? 3 : 1]);
      // Quadratica -> cubica esatta: le maniglie stanno a 2/3 della strada verso il punto di controllo
      target.segs.push({ c1: [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], c2: [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])], to });
      cur = to;
      lastQuad = q;
      lastCubic = null;
    } else {
      const to = pt(args[5], args[6]);
      target.segs.push(...arcToCubics(cur, args[0], args[1], args[2], args[3] === 1, args[4] === 1, to));
      cur = to;
      lastCubic = lastQuad = null;
    }
  }
  return subpaths;
}

/** Elementi che non si disegnano da soli (definizioni, maschere, simboli...) o che non si leggono (`style`, `use`): si saltano con tutto il loro contenuto. */
const SKIPPED = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'style', 'script', 'use', 'title', 'desc', 'metadata', 'foreignobject']);

/** Valore di una proprietà di presentazione (`fill`, `stroke`, `display`): lo `style` in linea vince sull'attributo. `inherit` e il vuoto non sono valori. */
function property(el: Element, name: string): string | undefined {
  const inline = (el.getAttribute('style') ?? '')
    .split(';')
    .map((rule) => rule.split(':'))
    .find(([key]) => key?.trim().toLowerCase() === name);
  const value = (inline?.[1] ?? el.getAttribute(name) ?? '').trim();
  return value && value !== 'inherit' ? value : undefined;
}

/** Numero di un attributo (0 se manca o non è un numero: le unità dopo il numero si ignorano, come px). */
const attribute = (el: Element, name: string): number => {
  const n = parseFloat(el.getAttribute(name) ?? '');
  return Number.isFinite(n) ? n : 0;
};

/** Dati `d` equivalenti a una forma di base di SVG (rect, circle, ellipse, line, polyline, polygon), oppure null se non ha misura. */
function shapeData(el: Element, tag: string): string | null {
  switch (tag) {
    case 'path':
      return el.getAttribute('d');
    case 'rect': {
      const [x, y, w, h] = [attribute(el, 'x'), attribute(el, 'y'), attribute(el, 'width'), attribute(el, 'height')];
      if (!(w > 0) || !(h > 0)) return null;
      // Angoli arrotondati: se ne manca uno dei due raggi vale l'altro; mai oltre metà del lato
      const [rxAttr, ryAttr] = [el.getAttribute('rx'), el.getAttribute('ry')];
      const rx = Math.min(w / 2, Math.max(0, parseFloat(rxAttr ?? ryAttr ?? '0') || 0));
      const ry = Math.min(h / 2, Math.max(0, parseFloat(ryAttr ?? rxAttr ?? '0') || 0));
      if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [attribute(el, 'cx'), attribute(el, 'cy')];
      const [rx, ry] = tag === 'circle' ? [attribute(el, 'r'), attribute(el, 'r')] : [attribute(el, 'rx'), attribute(el, 'ry')];
      if (!(rx > 0) || !(ry > 0)) return null;
      // Due mezze ellissi
      return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}Z`;
    }
    case 'line':
      return `M${attribute(el, 'x1')} ${attribute(el, 'y1')}L${attribute(el, 'x2')} ${attribute(el, 'y2')}`;
    case 'polyline':
    case 'polygon': {
      const numbers = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (numbers.length < 4) return null;
      const points = Array.from({ length: Math.floor(numbers.length / 2) }, (_, i) => `${numbers[2 * i]} ${numbers[2 * i + 1]}`);
      return `M${points.join('L')}${tag === 'polygon' ? 'Z' : ''}`;
    }
  }
  return null;
}

/**
 * Raccoglie i contorni di un elemento e dei suoi figli. `matrix` compone le trasformazioni dalla radice; `fill` e `stroke` sono
 * quelli ereditati. Un elemento senza riempimento e senza tratto non si vede e si salta; un tracciato aperto con riempimento
 * si chiude (come lo riempie SVG), uno solo con tratto resta aperto. La linea non ha area: conta solo il suo tratto.
 */
function collect(el: Element, parent: Matrix, fill: string, stroke: string, out: PathContour[]): void {
  const tag = el.localName.toLowerCase();
  if (SKIPPED.has(tag) || property(el, 'display') === 'none') return;
  const matrix = multiply(parent, parseTransform(el.getAttribute('transform')));
  const [ownFill, ownStroke] = [property(el, 'fill') ?? fill, property(el, 'stroke') ?? stroke];
  const d = shapeData(el, tag);
  if (d === null) {
    // Contenitore (g, svg, a...): i figli ereditano riempimento e tratto
    for (const child of Array.from(el.children)) collect(child, matrix, ownFill, ownStroke, out);
    return;
  }
  const filled = ownFill !== 'none' && tag !== 'line';
  if (!filled && ownStroke === 'none') return;
  for (const sub of parsePathData(d)) {
    const segs = sub.segs.map((s): PathSeg => ({ to: applyPoint(matrix, s.to), ...(s.c1 ? { c1: applyPoint(matrix, s.c1) } : {}), ...(s.c2 ? { c2: applyPoint(matrix, s.c2) } : {}) }));
    const contour = cubicsToContour(applyPoint(matrix, sub.start), segs, sub.closed || filled);
    if (contour) out.push(contour);
  }
}

/**
 * Contorni di Bézier di un SVG, nel sistema dell'editor: millimetri (`unitScale`), Y verso l'alto, la X del file così
 * com'è (x = 0 è l'asse di rotazione) e il fondo del disegno a y = 0. Legge path, rect (anche arrotondati), circle, ellipse,
 * line, polyline e polygon con tutte le trasformazioni affini, anche solo con tratto; non gli elementi in `defs`, `clipPath`,
 * `mask`, `symbol`, `marker`, `pattern`, i nascosti (`display:none`), `style` e `use`. Lancia `ImportError` se il file non è un SVG,
 * non ha tracciati o supera i limiti (500 nodi per contorno, 100 contorni).
 */
export function readSvgPaths(text: string, name: string): PathContour[] {
  const invalid = new ImportError(`"${name}" non è un file SVG valido.`);
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch {
    throw invalid;
  }
  // DOMParser non solleva eccezioni sui file rotti: restituisce un documento con <parsererror> (o senza radice svg)
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) throw invalid;

  // Millimetri e Y ribaltata (negli SVG cresce verso il basso) in un'unica matrice di partenza
  const scale = unitScale(root);
  const contours: PathContour[] = [];
  collect(root, [scale, 0, 0, -scale, 0, 0], 'black', 'none', contours);
  if (contours.length === 0) throw new ImportError(`"${name}" non contiene tracciati utilizzabili: servono forme con riempimento o con tratto.`);
  const longest = Math.max(...contours.map((c) => c.nodes.length));
  if (longest > MAX_PATH_NODES) throw new ImportError(`"${name}" ha ${longest} nodi in un contorno (massimo ${MAX_PATH_NODES}): semplifica il disegno.`);
  if (contours.length > MAX_PATH_CONTOURS) throw new ImportError(`"${name}" ha ${contours.length} contorni (massimo ${MAX_PATH_CONTOURS}): semplifica il disegno.`);

  // Il fondo del disegno (riquadro esatto delle curve) sta a y = 0: solo i nodi si spostano, le maniglie sono relative
  const bottom = pathNaturalBox({ paths: contours })?.minY ?? 0;
  return contours.map((c) => ({ closed: c.closed, nodes: c.nodes.map((n) => ({ ...n, p: [n.p[0], n.p[1] - bottom] as Vec2 })) }));
}
