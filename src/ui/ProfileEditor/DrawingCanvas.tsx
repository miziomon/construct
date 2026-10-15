import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize, MousePointer2, PenTool, ZoomIn, ZoomOut } from 'lucide-react';
import { segmentOf } from '../../scene/bezier';
import type { PathContour, PathNode, Vec2 } from '../../scene/types';
import { appendPenNode, cycleKind, gridStep, insertNode, moveHandle, moveNodes, nearestSegment, setNodeKind, snapPoint } from './model';
import type { Draft, HandleRef, NodeRef, SegmentRef } from './model';

/** Aggancio e griglia: il passo (mm) serve anche a disegnare le righe; gli interruttori dicono a cosa ci si aggancia. */
export interface GridSettings {
  step: number;
  snapGrid: boolean;
  snapNodes: boolean;
  /** Penna: allinea alla X o alla Y del punto precedente. */
  snapOrtho: boolean;
  /** Disegna gli assi (a Y = 0 e, di rotazione, a X = 0). */
  showAxis: boolean;
}

export type Tool = 'select' | 'pen';

interface Props {
  draft: Draft;
  /** Poligoni riempiti dal kernel (stesso campionamento del solido), nelle coordinate del disegno. */
  contours: Vec2[][];
  /** Punti in cui i contorni si attraversano. */
  crossings: Vec2[];
  selection: NodeRef[];
  grid: GridSettings;
  /** Vero mentre è premuta la barra spaziatrice (la tastiera la legge la radice della modale): il trascinamento sposta la vista. */
  spaceDown: MutableRefObject<boolean>;
  /** Modifica in corso (trascinamento): non è un passo della cronologia. */
  onLive: (paths: PathContour[], selection?: NodeRef[]) => void;
  /** Modifica conclusa: un passo della cronologia. */
  onCommit: (paths: PathContour[], selection: NodeRef[]) => void;
  onSelect: (selection: NodeRef[]) => void;
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** Contorno che la Penna sta disegnando (indice), oppure null. */
  pen: number | null;
  /** Penna: un nodo in più (o spostato durante il trascinamento) nel contorno `current`; il passo di cronologia lo fa il termine del contorno. */
  onPenLive: (paths: PathContour[], current: number, selection: NodeRef[]) => void;
  /** Penna: clic sul primo nodo, il contorno `index` si chiude. */
  onPenClose: (index: number) => void;
  /** Penna: doppio clic, il contorno termina aperto. */
  onPenFinish: () => void;
  /** Penna: raggiunto il limite di nodi o di contorni. */
  onPenLimit: () => void;
}

/** Vista: centro (mm) e zoom (pixel per mm). La Y del disegno va verso l'alto. */
interface View {
  cx: number;
  cy: number;
  s: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 200;
/** Movimento minimo (pixel) prima che un clic diventi un trascinamento: evita passi di cronologia involontari. */
const DRAG_THRESHOLD = 4;
/** Raggio di aggancio ai nodi (pixel). */
const SNAP_RADIUS_PX = 8;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const keyOf = (r: NodeRef) => `${r.path}:${r.node}`;
const same = (a: NodeRef, b: NodeRef) => a.path === b.path && a.node === b.node;
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
/** Coordinata per l'attributo SVG: un decimale basta e tiene corto il markup. */
const f1 = (n: number) => n.toFixed(1);
/** Valore di un'etichetta degli assi senza decimali inutili. */
const fmt = (n: number) => String(Number(n.toFixed(2)));

/** Vista che inquadra tutti i nodi e le maniglie (e l'asse in rotazione), con un po' di margine. */
function fitView(paths: PathContour[], rotate: boolean, w: number, h: number): View {
  const pts: Vec2[] = rotate ? [[0, 0]] : [];
  for (const c of paths) {
    for (const n of c.nodes) {
      pts.push(n.p);
      if (n.in) pts.push(add(n.p, n.in));
      if (n.out) pts.push(add(n.p, n.out));
    }
  }
  if (pts.length === 0) return { cx: 0, cy: 10, s: clampScale(Math.min(w, h) / 60) };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: clampScale(Math.min(w / Math.max(x1 - x0, 1), h / Math.max(y1 - y0, 1)) / 1.35) };
}

/** Tracciato SVG di un contorno: rette dove il segmento non ha maniglie, cubiche altrove. */
function contourPath(c: PathContour, toS: (p: Vec2) => Vec2): string {
  if (c.nodes.length === 0) return '';
  const pt = (p: Vec2) => toS(p).map(f1).join(' ');
  let d = `M${pt(c.nodes[0].p)}`;
  const count = c.closed ? c.nodes.length : c.nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const { cubic, straight } = segmentOf(c, i);
    d += straight ? ` L${pt(cubic[3])}` : ` C${pt(cubic[1])} ${pt(cubic[2])} ${pt(cubic[3])}`;
  }
  return d + (c.closed ? ' Z' : '');
}

/** Che cosa c'è sotto il puntatore. */
type Hit = { type: 'handle'; ref: HandleRef } | { type: 'node'; ref: NodeRef } | { type: 'segment'; seg: SegmentRef; t: number } | { type: 'none' };

/** Gesto in corso (si tiene in un ref: cambia a ogni movimento e non deve ridisegnare da solo). */
type Drag =
  | { type: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { type: 'node'; refs: NodeRef[]; base: PathContour[]; last: PathContour[]; primary: Vec2; down: Vec2; sx: number; sy: number; moved: boolean; inserted: boolean; collapse: NodeRef | null }
  | { type: 'handle'; ref: HandleRef; base: PathContour[]; last: PathContour[]; sx: number; sy: number; moved: boolean; alt: boolean }
  | { type: 'box'; sx: number; sy: number; shift: boolean; base: NodeRef[]; moved: boolean }
  // Penna: lo stato di partenza serve a ricalcolare il nodo (e la sua maniglia) a ogni movimento del trascinamento
  | { type: 'pen'; base: PathContour[]; current: number | null; p: Vec2; sx: number; sy: number; moved: boolean };

/**
 * Disegno 2D del profilo (SVG) con lo strumento Seleziona: clic, Maiusc, riquadro, trascinamento di nodi e maniglie
 * (Alt spezza la tangente), clic su un segmento per inserire un nodo, doppio clic per cambiare il tipo. Rotella per lo
 * zoom sul puntatore, Spazio o tasto centrale per la panoramica. Le modifiche passano da `onLive` (durante il gesto) e
 * `onCommit` (al rilascio): un gesto è un solo passo della cronologia.
 */
export function DrawingCanvas({ draft, contours, crossings, selection, grid, spaceDown, onLive, onCommit, onSelect, tool, onTool, pen, onPenLive, onPenClose, onPenFinish, onPenLimit }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [view, setView] = useState<View>({ cx: 0, cy: 10, s: 8 });
  // Copie per i listener nativi (rotella, osservatore della dimensione), che non vedono lo stato più recente
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  const latest = useRef({ paths: draft.paths, rotate: draft.extrusion === 'rotate' });
  const fitted = useRef(false);
  const drag = useRef<Drag | null>(null);
  const [rubber, setRubber] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  // Penna: punto (agganciato) in cui cadrebbe il prossimo nodo, per l'anteprima del segmento
  const [hover, setHover] = useState<Vec2 | null>(null);
  // Schermo a dito: aree attive più grandi
  const [coarse] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true);
  const rotate = draft.extrusion === 'rotate';
  const nodeR = coarse ? 20 : 10;
  // Contorno aperto che la Penna sta continuando
  const activePen = tool === 'pen' && pen !== null && draft.paths[pen] && !draft.paths[pen].closed ? draft.paths[pen] : null;

  useEffect(() => {
    latest.current = { paths: draft.paths, rotate };
  });

  const changeView = useCallback((v: View) => {
    viewRef.current = v;
    setView(v);
  }, []);

  /** Inquadra tutto il disegno. */
  const fit = useCallback(() => {
    changeView(fitView(latest.current.paths, latest.current.rotate, sizeRef.current.w, sizeRef.current.h));
  }, [changeView]);

  // Segue la dimensione dell'area; alla prima misura inquadra il disegno
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      sizeRef.current = { w: r.width, h: r.height };
      setSize(sizeRef.current);
      if (!fitted.current) {
        fitted.current = true;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  // Rotella: zoom sul puntatore. Il listener è nativo e non passivo, altrimenti la pagina scorrerebbe
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const [sx, sy] = [e.clientX - r.left, e.clientY - r.top];
      const v = viewRef.current;
      const sz = sizeRef.current;
      // Punto del disegno sotto il puntatore: dopo lo zoom deve restare lì
      const [wx, wy] = [(sx - sz.w / 2) / v.s + v.cx, -(sy - sz.h / 2) / v.s + v.cy];
      const s = clampScale(v.s * Math.exp(-e.deltaY * 0.0015));
      changeView({ s, cx: wx - (sx - sz.w / 2) / s, cy: wy + (sy - sz.h / 2) / s });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [changeView]);

  /** Disegno -> pixel dell'area. */
  const toS = useCallback((p: Vec2): Vec2 => [size.w / 2 + (p[0] - view.cx) * view.s, size.h / 2 - (p[1] - view.cy) * view.s], [size, view]);
  /** Pixel dell'area -> disegno. */
  const toW = useCallback((sx: number, sy: number): Vec2 => [(sx - size.w / 2) / view.s + view.cx, -(sy - size.h / 2) / view.s + view.cy], [size, view]);
  const pos = (e: ReactPointerEvent | ReactMouseEvent): Vec2 => {
    const r = svg.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // Nodi di cui si mostrano le maniglie: i selezionati e i loro vicini
  const shown = useMemo(() => {
    const keys = new Set<string>();
    for (const r of selection) {
      const c = draft.paths[r.path];
      if (!c) continue;
      const n = c.nodes.length;
      for (const delta of [-1, 0, 1]) {
        const i = r.node + delta;
        if (i >= 0 && i < n) keys.add(`${r.path}:${i}`);
        else if (c.closed) keys.add(`${r.path}:${(i + n) % n}`);
      }
    }
    return keys;
  }, [selection, draft.paths]);

  /** Che cosa c'è nel punto (pixel): prima le maniglie visibili, poi i nodi, infine i segmenti. */
  const hitTest = (sx: number, sy: number): Hit => {
    const handleR = coarse ? 18 : 9;
    for (const key of shown) {
      const [pi, ni] = key.split(':').map(Number);
      const n = draft.paths[pi].nodes[ni];
      for (const side of ['out', 'in'] as const) {
        const h = n[side];
        if (!h) continue;
        const sp = toS(add(n.p, h));
        if (Math.hypot(sp[0] - sx, sp[1] - sy) <= handleR) return { type: 'handle', ref: { path: pi, node: ni, side } };
      }
    }
    for (let pi = draft.paths.length - 1; pi >= 0; pi--) {
      for (let ni = draft.paths[pi].nodes.length - 1; ni >= 0; ni--) {
        const sp = toS(draft.paths[pi].nodes[ni].p);
        if (Math.hypot(sp[0] - sx, sp[1] - sy) <= nodeR) return { type: 'node', ref: { path: pi, node: ni } };
      }
    }
    const near = nearestSegment(draft.paths, (coarse ? 14 : 7) / view.s, toW(sx, sy));
    return near ? { type: 'segment', seg: { path: near.path, segment: near.segment }, t: near.t } : { type: 'none' };
  };

  /**
   * Aggancio del punto: griglia, nodi, e con un punto precedente (`prev`, solo la Penna) allineamento orizzontale o
   * verticale e Maiusc per i 45°; Ctrl lo sospende.
   */
  const snapped = (p: Vec2, e: { ctrlKey: boolean; shiftKey?: boolean }, others: Vec2[] | undefined, prev?: Vec2): Vec2 =>
    e.ctrlKey ? p : snapPoint(p, { grid: grid.snapGrid ? gridStep(grid.step, view.s) : undefined, nodes: grid.snapNodes ? others : undefined, prev, ortho: grid.snapOrtho && !!prev, angle45: !!e.shiftKey && !!prev, radius: SNAP_RADIUS_PX / view.s });
  const allNodes = () => draft.paths.flatMap((c) => c.nodes.map((n) => n.p));

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    wrap.current?.focus();
    const [sx, sy] = pos(e);
    // Panoramica: tasto centrale o barra spaziatrice
    if (e.button === 1 || spaceDown.current) {
      e.preventDefault();
      drag.current = { type: 'pan', sx, sy, cx: view.cx, cy: view.cy };
      return;
    }
    if (e.button !== 0) return;
    const w = toW(sx, sy);
    if (tool === 'pen') {
      setHover(null);
      const prev = activePen ? activePen.nodes[activePen.nodes.length - 1].p : undefined;
      const p = snapped(w, e, allNodes(), prev);
      // Clic sul primo nodo (o aggancio a lui): il contorno si chiude
      if (activePen && activePen.nodes.length >= 3) {
        const first = activePen.nodes[0].p;
        const fs = toS(first);
        if (Math.hypot(fs[0] - sx, fs[1] - sy) <= nodeR || (p[0] === first[0] && p[1] === first[1])) {
          onPenClose(pen!);
          return;
        }
      }
      // Un nodo in più; con il trascinamento (sotto) diventa simmetrico con la maniglia
      const added = appendPenNode(draft.paths, activePen ? pen : null, p);
      if (!added) {
        onPenLimit();
        return;
      }
      onPenLive(added.paths, added.current, [added.node]);
      drag.current = { type: 'pen', base: draft.paths, current: activePen ? pen : null, p, sx, sy, moved: false };
      return;
    }
    const hit = hitTest(sx, sy);
    if (hit.type === 'handle') {
      drag.current = { type: 'handle', ref: hit.ref, base: draft.paths, last: draft.paths, sx, sy, moved: false, alt: false };
    } else if (hit.type === 'node') {
      const selected = selection.some((r) => same(r, hit.ref));
      // Maiusc aggiunge o toglie dalla selezione; senza, un nodo già selezionato resta nel gruppo (si trascinano tutti)
      const next = e.shiftKey ? (selected ? selection.filter((r) => !same(r, hit.ref)) : [...selection, hit.ref]) : selected ? selection : [hit.ref];
      if (next !== selection) onSelect(next);
      const refs = next.some((r) => same(r, hit.ref)) ? next : [];
      drag.current = {
        type: 'node', refs, base: draft.paths, last: draft.paths, primary: draft.paths[hit.ref.path].nodes[hit.ref.node].p, down: w, sx, sy, moved: false, inserted: false,
        // Un clic senza trascinamento su un nodo di una selezione multipla lascia solo quel nodo
        collapse: !e.shiftKey && selected && selection.length > 1 ? hit.ref : null,
      };
    } else if (hit.type === 'segment') {
      // Il clic su un segmento inserisce un nodo (la forma non cambia) e lo si può trascinare subito: tutto è un solo passo
      const inserted = insertNode(draft.paths, hit.seg, hit.t);
      if (inserted) {
        onLive(inserted.paths, [inserted.node]);
        drag.current = { type: 'node', refs: [inserted.node], base: inserted.paths, last: inserted.paths, primary: inserted.paths[inserted.node.path].nodes[inserted.node.node].p, down: w, sx, sy, moved: false, inserted: true, collapse: null };
      }
    } else {
      drag.current = { type: 'box', sx, sy, shift: e.shiftKey, base: selection, moved: false };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const [sx, sy] = pos(e);
    const w = toW(sx, sy);
    setCursor(w);
    const d = drag.current;
    if (!d) {
      // Penna senza gesto in corso: l'anteprima del prossimo segmento segue il puntatore
      if (tool === 'pen') setHover(snapped(w, e, allNodes(), activePen ? activePen.nodes[activePen.nodes.length - 1].p : undefined));
      return;
    }
    if (d.type === 'pan') {
      changeView({ ...view, cx: d.cx - (sx - d.sx) / view.s, cy: d.cy + (sy - d.sy) / view.s });
    } else if (d.type === 'node') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < DRAG_THRESHOLD) return;
      d.moved = true;
      if (d.refs.length === 0) return;
      // Il nodo cliccato segue il puntatore (agganciato) e gli altri selezionati si muovono dello stesso vettore
      const target: Vec2 = [d.primary[0] + w[0] - d.down[0], d.primary[1] + w[1] - d.down[1]];
      const moving = new Set(d.refs.map(keyOf));
      const others = d.base.flatMap((c, pi) => c.nodes.filter((_, ni) => !moving.has(`${pi}:${ni}`)).map((n) => n.p));
      const p = snapped(target, e, others);
      d.last = moveNodes(d.base, d.refs, [p[0] - d.primary[0], p[1] - d.primary[1]]);
      onLive(d.last);
    } else if (d.type === 'handle') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < DRAG_THRESHOLD) return;
      d.moved = true;
      // Alt (anche solo a un certo punto del gesto) rende il nodo uno spigolo per tutto il resto del trascinamento
      d.alt = d.alt || e.altKey;
      d.last = moveHandle(d.base, d.ref, snapped(w, e, undefined), d.alt);
      onLive(d.last);
    } else if (d.type === 'pen') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < DRAG_THRESHOLD) return;
      d.moved = true;
      // La maniglia è il vettore dal nodo al puntatore (agganciato): il nodo si ricalcola dallo stato di partenza
      const target = snapped(w, e, undefined, d.p);
      const dragged = appendPenNode(d.base, d.current, d.p, [target[0] - d.p[0], target[1] - d.p[1]]);
      if (dragged) onPenLive(dragged.paths, dragged.current, [dragged.node]);
    } else if (d.type === 'box') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setRubber({ x0: d.sx, y0: d.sy, x1: sx, y1: sy });
    }
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    setRubber(null);
    if (!d) return;
    // Penna: niente da fare al rilascio, il passo di cronologia lo fa il termine del contorno
    if (d.type === 'node') {
      if (d.moved || d.inserted) onCommit(d.last, d.refs);
      else if (d.collapse) onSelect([d.collapse]);
    } else if (d.type === 'handle') {
      if (d.moved) onCommit(d.last, selection);
    } else if (d.type === 'box') {
      if (!d.moved) {
        // Clic nel vuoto: azzera la selezione (con Maiusc la lascia)
        if (!d.shift && selection.length) onSelect([]);
        return;
      }
      const [sx, sy] = pos(e);
      const [x0, x1] = [Math.min(d.sx, sx), Math.max(d.sx, sx)];
      const [y0, y1] = [Math.min(d.sy, sy), Math.max(d.sy, sy)];
      const inside: NodeRef[] = [];
      draft.paths.forEach((c, pi) =>
        c.nodes.forEach((n, ni) => {
          const [px, py] = toS(n.p);
          if (px >= x0 && px <= x1 && py >= y0 && py <= y1) inside.push({ path: pi, node: ni });
        }),
      );
      onSelect(d.shift ? [...d.base, ...inside.filter((r) => !d.base.some((b) => same(b, r)))] : inside);
    }
  };

  // Doppio clic su un nodo: scorre il tipo (spigolo, liscio, simmetrico)
  const onDoubleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    // Penna: il doppio clic termina il contorno (il nodo doppio lo toglie chi termina)
    if (tool === 'pen') {
      onPenFinish();
      return;
    }
    const [sx, sy] = pos(e);
    const hit = hitTest(sx, sy);
    if (hit.type !== 'node') return;
    const kind = draft.paths[hit.ref.path].nodes[hit.ref.node].kind;
    onCommit(setNodeKind(draft.paths, hit.ref, cycleKind(kind)), [hit.ref]);
  };

  // --- Disegno --------------------------------------------------------------------------------------------------------
  const step = gridStep(grid.step, view.s);
  const [w0, w1] = [toW(0, size.h), toW(size.w, 0)];
  let minor = '';
  let major = '';
  for (let i = Math.ceil(w0[0] / step); i <= Math.floor(w1[0] / step); i++) {
    const x = f1(toS([i * step, 0])[0]);
    if (i % 5 === 0) major += `M${x} 0V${size.h}`;
    else minor += `M${x} 0V${size.h}`;
  }
  for (let i = Math.ceil(w0[1] / step); i <= Math.floor(w1[1] / step); i++) {
    const y = f1(toS([0, i * step])[1]);
    if (i % 5 === 0) major += `M0 ${y}H${size.w}`;
    else minor += `M0 ${y}H${size.w}`;
  }
  // Etichette sulle righe principali: una ogni tanto, perché non si sovrappongano
  const labels: { x: number; y: number; text: string; anchor: 'x' | 'y' }[] = [];
  let every = 1;
  while (step * 5 * every * view.s < 46) every *= 2;
  const labelStep = step * 5 * every;
  for (let i = Math.ceil(w0[0] / labelStep); i <= Math.floor(w1[0] / labelStep); i++) labels.push({ x: toS([i * labelStep, 0])[0] + 3, y: size.h - 5, text: fmt(i * labelStep), anchor: 'x' });
  for (let i = Math.ceil(w0[1] / labelStep); i <= Math.floor(w1[1] / labelStep); i++) labels.push({ x: 4, y: toS([0, i * labelStep])[1] - 3, text: fmt(i * labelStep), anchor: 'y' });

  const origin = toS([0, 0]);
  const outsideWidth = Math.min(size.w, origin[0]);
  const fill = contours.map((poly) => `M${poly.map((p) => toS(p).map(f1).join(' ')).join('L')}Z`).join(' ');

  const nodeShape = (kind: PathNode['kind']) =>
    kind === 'corner' ? <rect x={-4.5} y={-4.5} width={9} height={9} /> : kind === 'symmetric' ? <polygon points="0,-6 6,0 0,6 -6,0" /> : <circle r={5} />;

  return (
    <div ref={wrap} className="profile-editor__canvas" tabIndex={0} role="group" aria-label="Disegno del profilo" data-tool={tool}>
      <svg
        ref={svg}
        className="profile-editor__svg"
        width={size.w}
        height={size.h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          setCursor(null);
          setHover(null);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* In rotazione la parte a sinistra dell'asse non viene ruotata */}
        {rotate && outsideWidth > 0 && (
          <g className="profile-editor__outside">
            <rect x={0} y={0} width={outsideWidth} height={size.h} />
            <text x={Math.max(8, outsideWidth - 8)} y={78} textAnchor={outsideWidth > 180 ? 'end' : 'start'}>
              Questa parte non viene ruotata
            </text>
          </g>
        )}
        <path className="profile-editor__grid profile-editor__grid--minor" d={minor} />
        <path className="profile-editor__grid profile-editor__grid--major" d={major} />
        {labels.map((l) => (
          <text key={`${l.anchor}${l.text}`} className="profile-editor__tick" x={l.x} y={l.y}>
            {l.text}
          </text>
        ))}
        {/* Assi: la X sta a y = 0; l'asse verticale a x = 0 è l'asse di rotazione */}
        {grid.showAxis && <line className="profile-editor__axis profile-editor__axis--x" x1={0} x2={size.w} y1={origin[1]} y2={origin[1]} />}
        {grid.showAxis && <line className="profile-editor__axis profile-editor__axis--y" x1={origin[0]} x2={origin[0]} y1={0} y2={size.h} />}
        {rotate && grid.showAxis && (
          <text className="profile-editor__axis-label" x={origin[0] + 6} y={60}>
            asse di rotazione
          </text>
        )}
        <path className="profile-editor__fill" fillRule="evenodd" d={fill} />
        {draft.paths.map((c, pi) => (
          <path key={pi} className="profile-editor__curve" d={contourPath(c, toS)} />
        ))}
        {/* Maniglie dei nodi selezionati e dei loro vicini */}
        {[...shown].map((key) => {
          const [pi, ni] = key.split(':').map(Number);
          const n = draft.paths[pi].nodes[ni];
          const np = toS(n.p);
          return (['in', 'out'] as const).map((side) => {
            const h = n[side];
            if (!h) return null;
            const hp = toS(add(n.p, h));
            return (
              <g key={`${key}${side}`} className="profile-editor__handle" data-handle={`${key}:${side}`}>
                <line x1={np[0]} y1={np[1]} x2={hp[0]} y2={hp[1]} />
                <circle cx={hp[0]} cy={hp[1]} r={4.5} />
              </g>
            );
          });
        })}
        {/* Nodi: la forma dice il tipo (quadrato = spigolo, cerchio = liscio, rombo = simmetrico) */}
        {draft.paths.map((c, pi) =>
          c.nodes.map((n, ni) => {
            const [x, y] = toS(n.p);
            const selected = selection.some((r) => r.path === pi && r.node === ni);
            return (
              <g key={`${pi}:${ni}`} className={`profile-editor__node${selected ? ' profile-editor__node--selected' : ''}${activePen && pi === pen && ni === 0 && activePen.nodes.length >= 3 ? ' profile-editor__node--first' : ''}`} transform={`translate(${f1(x)} ${f1(y)})`} data-node={`${pi}:${ni}`} data-kind={n.kind}>
                {nodeShape(n.kind)}
              </g>
            );
          }),
        )}
        {crossings.map((q, i) => {
          const [x, y] = toS(q);
          return <circle key={i} className="profile-editor__crossing" cx={x} cy={y} r={7} />;
        })}
        {/* Penna: il segmento che nascerebbe dal prossimo clic (curvo se l'ultimo nodo ha la maniglia) e il punto agganciato */}
        {activePen && hover && (() => {
          const last = activePen.nodes[activePen.nodes.length - 1];
          const [a, b] = [toS(last.p), toS(hover)];
          const d = last.out ? `M${a.map(f1).join(' ')} C${toS(add(last.p, last.out)).map(f1).join(' ')} ${b.map(f1).join(' ')} ${b.map(f1).join(' ')}` : `M${a.map(f1).join(' ')} L${b.map(f1).join(' ')}`;
          return <path className="profile-editor__preview" d={d} />;
        })()}
        {tool === 'pen' && hover && <circle className="profile-editor__snap" cx={toS(hover)[0]} cy={toS(hover)[1]} r={4} />}
        {rubber && <rect className="profile-editor__rubber" x={Math.min(rubber.x0, rubber.x1)} y={Math.min(rubber.y0, rubber.y1)} width={Math.abs(rubber.x1 - rubber.x0)} height={Math.abs(rubber.y1 - rubber.y0)} />}
      </svg>
      <div className="profile-editor__tools" role="toolbar" aria-label="Strumenti di disegno">
        <button type="button" aria-pressed={tool === 'select'} title="Seleziona (V): sposta nodi e maniglie, clic su un segmento per inserire un nodo" onClick={() => onTool('select')}>
          <MousePointer2 size={16} />
          <span>Seleziona</span>
        </button>
        <button type="button" aria-pressed={tool === 'pen'} title="Penna (P): clic per uno spigolo, clic e trascina per una curva, clic sul primo nodo per chiudere, Invio per terminare" onClick={() => onTool('pen')}>
          <PenTool size={16} />
          <span>Penna</span>
        </button>
      </div>
      {draft.paths.length === 0 && (
        <div className="profile-editor__empty" role="note">
          {tool === 'pen' ? 'Fai clic nel disegno per aggiungere il primo punto' : 'Scegli la Penna e fai clic per iniziare'}
        </div>
      )}
      <div className="profile-editor__zoom" role="toolbar" aria-label="Vista del disegno">
        <button type="button" aria-label="Rimpicciolisci" title="Rimpicciolisci" onClick={() => changeView({ ...view, s: clampScale(view.s / 1.4) })}>
          <ZoomOut size={16} />
        </button>
        <button type="button" aria-label="Ingrandisci" title="Ingrandisci" onClick={() => changeView({ ...view, s: clampScale(view.s * 1.4) })}>
          <ZoomIn size={16} />
        </button>
        <button type="button" aria-label="Adatta" title="Adatta il disegno alla vista" onClick={fit}>
          <Maximize size={16} />
        </button>
      </div>
      <div className="profile-editor__coords" aria-hidden="true">
        {cursor ? `x ${fmt(cursor[0])}  y ${fmt(cursor[1])} mm` : ''}
      </div>
    </div>
  );
}
