import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { Circle, FlipHorizontal2, Hand, Hexagon, Maximize, MousePointer2, PenTool, Square, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { MAX_PATH_CONTOURS, cubicPoint, segmentOf } from '../../scene/bezier';
import type { PathContour, PathNode, Vec2 } from '../../scene/types';
import { NumberField } from '../NumberField/NumberField';
import { POLYGON_SIDES, appendPenNode, baseShapeContour, contourContains, cycleKind, gridStep, insertNode, joinContours, moveHandle, moveNodes, nearestSegment, resumeContour, setNodeKind, snapPoint } from './model';
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

export type Tool = 'select' | 'pen' | 'pan' | 'rect' | 'ellipse' | 'polygon';

interface Props {
  draft: Draft;
  /** Poligoni riempiti dal kernel (stesso campionamento del solido), nelle coordinate del disegno. */
  contours: Vec2[][];
  /** Punti in cui i contorni si attraversano. */
  crossings: Vec2[];
  /** Un elemento per contorno: `true` se è un foro (annidamento dispari), `null` se non ha area. */
  holes: (boolean | null)[];
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
  /** Vista specchiata in orizzontale (solo in rotazione): la parte non ruotata sta a destra dell'asse. Non cambia i dati. */
  flip: boolean;
  onFlip: () => void;
  /** Contorno che la Penna sta disegnando (indice), oppure null. */
  pen: number | null;
  /** Penna: un nodo in più (o spostato durante il trascinamento) nel contorno `current`; il passo di cronologia lo fa il termine del contorno. */
  onPenLive: (paths: PathContour[], current: number, selection: NodeRef[]) => void;
  /** Penna: ripresa o unione di contorni (cambia il contorno in corso): come `onPenLive`, ma `resumed` dice che il disegno non è ancora cambiato. */
  onPenResume: (paths: PathContour[], current: number, selection: NodeRef[]) => void;
  /** Penna: clic sul primo nodo, il contorno `index` si chiude; `paths` porta la maniglia disegnata trascinando (assente = nessuna modifica). */
  onPenClose: (index: number, paths?: PathContour[]) => void;
  /** Penna: doppio clic, il contorno termina aperto. */
  onPenFinish: () => void;
  /** Penna: raggiunto il limite di nodi o di contorni. */
  onPenLimit: () => void;
  /** Forme base: raggiunto il limite di contorni. */
  onShapeLimit: () => void;
  /** Forme base: il gesto è finito senza una forma dopo averne mostrata una in anteprima; il disegno torna all'ultimo concluso. */
  onShapeCancel: () => void;
  /** Importa SVG: il file scelto dall'utente. */
  onImportSvg: (file: File) => void;
  /** Contatore: a ogni aumento la vista inquadra tutto il disegno (dopo un import, quando i contorni sono già nello stato). */
  fitRequest: number;
}

/** Vista: centro (mm) e zoom (pixel per mm). La Y del disegno va verso l'alto. */
interface View {
  cx: number;
  cy: number;
  s: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 200;
/** Larghezza minima (pixel) della parte non ruotata visibile perché mostri la scritta e il pulsante per invertire l'asse. */
const OUTSIDE_LABEL_MIN = 180;
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
  // In rotazione l'inquadratura lascia a sinistra dell'asse spazio per la parte non ruotata (scritta e pulsante dell'inversione)
  const pts: Vec2[] = [];
  for (const c of paths) {
    for (const n of c.nodes) {
      pts.push(n.p);
      if (n.in) pts.push(add(n.p, n.in));
      if (n.out) pts.push(add(n.p, n.out));
    }
  }
  // Senza disegno l'asse resta al centro dell'area, in lineare e in rotazione
  if (pts.length === 0) return { cx: 0, cy: 10, s: clampScale(Math.min(w, h) / 60) };
  if (rotate) pts.push([0, 0], [-Math.max(10, Math.max(...pts.map((p) => p[0])) * 0.75), 0]);
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
  | { type: 'node'; refs: NodeRef[]; base: PathContour[]; last: PathContour[]; primary: Vec2; down: Vec2; sx: number; sy: number; moved: boolean; collapse: NodeRef | null }
  // Alt è momentaneo: `frozen` è lo stato nell'istante in cui è stato premuto (l'altra maniglia resta com'era), `to` il punto agganciato più recente
  | { type: 'handle'; ref: HandleRef; base: PathContour[]; last: PathContour[]; frozen: PathContour[]; to: Vec2 | null; sx: number; sy: number; moved: boolean; alt: boolean }
  | { type: 'box'; sx: number; sy: number; shift: boolean; base: NodeRef[]; moved: boolean }
  // Forma base (rettangolo, ellisse, poligono) trascinata dal centro: `last` è il disegno con la forma in anteprima (`base` se non c'è ancora una misura), `live` dice se il disegno è già stato cambiato
  | { type: 'shape'; tool: 'rect' | 'ellipse' | 'polygon'; center: Vec2; base: PathContour[]; last: PathContour[]; sx: number; sy: number; moved: boolean; live: boolean }
  // Penna, ripresa da un estremo (maniglia in uscita) o chiusura sul primo nodo (`close`, maniglia in entrata opposta al mouse): il trascinamento la disegna
  // (nodo liscio, spigolo con Alt); `last` parte dal nodo reso liscio
  | { type: 'resume'; ref: HandleRef; current: number; close: boolean; base: PathContour[]; last: PathContour[]; frozen: PathContour[]; to: Vec2 | null; sx: number; sy: number; moved: boolean; alt: boolean }
  // Penna: lo stato di partenza serve a ricalcolare il nodo (e la sua maniglia) a ogni movimento del trascinamento
  // Alt è momentaneo: `keepIn` è la maniglia in entrata che il nodo aveva quando è stato premuto, `out` la maniglia trascinata
  | { type: 'pen'; base: PathContour[]; current: number | null; p: Vec2; sx: number; sy: number; moved: boolean; alt: boolean; keepIn: Vec2 | undefined; out: Vec2 | undefined };

/**
 * Disegno 2D del profilo (SVG) con lo strumento Seleziona: clic, Maiusc, riquadro, trascinamento di nodi e maniglie
 * (finché Alt è premuto il nodo è uno spigolo, rilasciandolo torna al tipo di prima), clic su un segmento per selezionare tutto il contorno
 * (trascinandolo si sposta), doppio clic per cambiare il tipo. Penna: clic su una curva per inserirvi un nodo (Ctrl o ⌘ lo sospende),
 * clic su un estremo aperto per riprendere quel contorno. Rotella per lo
 * zoom sul puntatore, Spazio o tasto centrale per la panoramica. Le modifiche passano da `onLive` (durante il gesto) e
 * `onCommit` (al rilascio): un gesto è un solo passo della cronologia.
 */
export function DrawingCanvas({ draft, contours, crossings, holes, selection, grid, spaceDown, onLive, onCommit, onSelect, tool, onTool, flip, onFlip, pen, onPenLive, onPenResume, onPenClose, onPenFinish, onPenLimit, onShapeLimit, onShapeCancel, onImportSvg, fitRequest }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [view, setView] = useState<View>({ cx: 0, cy: 10, s: 8 });
  // Copie per i listener nativi (rotella, osservatore della dimensione), che non vedono lo stato più recente
  const viewRef = useRef(view);
  const flipRef = useRef(flip);
  flipRef.current = flip;
  const sgn = flip ? -1 : 1;
  const sizeRef = useRef(size);
  const latest = useRef({ paths: draft.paths, rotate: draft.extrusion === 'rotate' });
  const fitted = useRef(false);
  const drag = useRef<Drag | null>(null);
  const [rubber, setRubber] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  // Alt premuto durante un trascinamento di maniglia: serve all'etichetta "Alt: spigolo"
  const [altHeld, setAltHeld] = useState(false);
  // Penna, senza contorno in corso: punto della curva in cui un clic inserirebbe un nodo; estremo aperto che un clic riprenderebbe o unirebbe
  const [insertAt, setInsertAt] = useState<Vec2 | null>(null);
  const [endHot, setEndHot] = useState<NodeRef | null>(null);
  const lastPointer = useRef<[number, number] | null>(null);
  // Panoramica in corso: il cursore diventa una mano chiusa
  const [panning, setPanning] = useState(false);
  // Penna: contorno che si sta chiudendo con il trascinamento sul primo nodo (per mostrare il segmento di chiusura)
  const [closing, setClosing] = useState<number | null>(null);
  // Penna: punto (agganciato) in cui cadrebbe il prossimo nodo, per l'anteprima del segmento
  const [hover, setHover] = useState<Vec2 | null>(null);
  // Lati del poligono regolare (strumento Poligono)
  const [sides, setSides] = useState<number>(POLYGON_SIDES.default);
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

  // Adatta chiesto da fuori (dopo un import): l'effetto che aggiorna `latest` sta più in alto, quindi vede già i contorni nuovi
  useEffect(() => {
    if (fitRequest > 0) fit();
  }, [fitRequest, fit]);

  // Passando alla rotazione si inquadra di nuovo: serve spazio a sinistra dell'asse per la parte non ruotata
  const wasRotate = useRef(rotate);
  useEffect(() => {
    if (rotate && !wasRotate.current && fitted.current) {
      // Con un disegno si inquadra di nuovo; vuoto, l'asse (x = 0) torna al centro dell'area e lo zoom resta
      if (latest.current.paths.some((c) => c.nodes.length > 0)) fit();
      else changeView({ ...viewRef.current, cx: 0 });
    }
    wasRotate.current = rotate;
  }, [rotate, fit, changeView]);

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
      const k = flipRef.current ? -1 : 1;
      const [wx, wy] = [(k * (sx - sz.w / 2)) / v.s + v.cx, -(sy - sz.h / 2) / v.s + v.cy];
      const s = clampScale(v.s * Math.exp(-e.deltaY * 0.0015));
      changeView({ s, cx: wx - (k * (sx - sz.w / 2)) / s, cy: wy + (sy - sz.h / 2) / s });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [changeView]);

  /** Disegno -> pixel dell'area. */
  const toS = useCallback((p: Vec2): Vec2 => [size.w / 2 + sgn * (p[0] - view.cx) * view.s, size.h / 2 - (p[1] - view.cy) * view.s], [size, view, sgn]);
  /** Pixel dell'area -> disegno. */
  const toW = useCallback((sx: number, sy: number): Vec2 => [(sgn * (sx - size.w / 2)) / view.s + view.cx, -(sy - size.h / 2) / view.s + view.cy], [size, view, sgn]);
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

  /** Estremo di un contorno aperto sotto il puntatore (pixel), escluso il contorno `except` (quello in corso). */
  const endAt = (sx: number, sy: number, except: number | null): NodeRef | null => {
    for (let pi = draft.paths.length - 1; pi >= 0; pi--) {
      if (pi === except || draft.paths[pi].closed) continue;
      const last = draft.paths[pi].nodes.length - 1;
      for (const ni of last === 0 ? [0] : [last, 0]) {
        const sp = toS(draft.paths[pi].nodes[ni].p);
        if (Math.hypot(sp[0] - sx, sp[1] - sy) <= nodeR) return { path: pi, node: ni };
      }
    }
    return null;
  };
  /** Penna senza contorno in corso: dove un clic sulla curva inserirebbe un nodo (a qualche pixel dalla curva e lontano dai nodi), o null. */
  const insertCandidate = (sx: number, sy: number): { seg: SegmentRef; t: number; point: Vec2 } | null => {
    const near = nearestSegment(draft.paths, (coarse ? 12 : 6) / view.s, toW(sx, sy));
    if (!near || !(near.t > 0 && near.t < 1)) return null;
    for (const c of draft.paths) {
      for (const n of c.nodes) {
        const sp = toS(n.p);
        if (Math.hypot(sp[0] - sx, sp[1] - sy) <= nodeR) return null;
      }
    }
    const seg = { path: near.path, segment: near.segment };
    return { seg, t: near.t, point: cubicPoint(segmentOf(draft.paths[seg.path], seg.segment).cubic, near.t) };
  };
  /** Anteprime della Penna: pallino di inserimento sulla curva (se non `suspend`, cioè Ctrl o ⌘ non è premuto) ed estremo che un clic riprenderebbe. */
  const refreshHover = (sx: number, sy: number, suspend: boolean, ctrl: boolean) => {
    if (tool !== 'pen') return;
    const end = endAt(sx, sy, activePen ? pen : null);
    const candidate = activePen || end || suspend ? null : insertCandidate(sx, sy);
    setEndHot(end);
    setInsertAt(candidate ? candidate.point : null);
    if (candidate || end) setHover(null);
    else setHover(snapped(toW(sx, sy), { ctrlKey: ctrl }, allNodes(), activePen ? activePen.nodes[activePen.nodes.length - 1].p : undefined));
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    wrap.current?.focus();
    const [sx, sy] = pos(e);
    // Panoramica: tasto destro o centrale, barra spaziatrice, o lo strumento Sposta vista
    if (e.button === 1 || e.button === 2 || spaceDown.current || tool === 'pan') {
      e.preventDefault();
      drag.current = { type: 'pan', sx, sy, cx: view.cx, cy: view.cy };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    const w = toW(sx, sy);
    if (tool === 'rect' || tool === 'ellipse' || tool === 'polygon') {
      // Forma base: si preme sul centro (agganciato; Ctrl sospende) e si trascina. Con 100 contorni non c'è posto per un altro
      if (draft.paths.length >= MAX_PATH_CONTOURS) {
        onShapeLimit();
        return;
      }
      drag.current = { type: 'shape', tool, center: snapped(w, e, allNodes()), base: draft.paths, last: draft.paths, sx, sy, moved: false, live: false };
      return;
    }
    if (tool === 'pen') {
      setHover(null);
      setInsertAt(null);
      const prev = activePen ? activePen.nodes[activePen.nodes.length - 1].p : undefined;
      const p = snapped(w, e, allNodes(), prev);
      // Clic sul primo nodo (o aggancio a lui): il contorno si chiude
      if (activePen && activePen.nodes.length >= 2) {
        const first = activePen.nodes[0].p;
        const fs = toS(first);
        if (Math.hypot(fs[0] - sx, fs[1] - sy) <= nodeR || (p[0] === first[0] && p[1] === first[1])) {
          // Il contorno si chiude al rilascio: un clic lo chiude e basta, un trascinamento disegna prima la maniglia del primo nodo (liscio, spigolo con Alt)
          const smooth = draft.paths.map((c, i) => (i === pen ? { ...c, nodes: c.nodes.map((n, k) => (k === 0 ? { ...n, kind: 'smooth' as const } : n)) } : c));
          setClosing(pen!);
          drag.current = { type: 'resume', ref: { path: pen!, node: 0, side: 'in' }, current: pen!, close: true, base: smooth, last: smooth, frozen: smooth, to: null, sx, sy, moved: false, alt: false };
          if (e.altKey) setAlt(drag.current, true);
          return;
        }
      }
      // Clic su un estremo di un altro contorno aperto: con un contorno in corso i due si uniscono, senza si riprende quello
      const end = endAt(sx, sy, activePen ? pen : null);
      if (end) {
        const joined = activePen ? joinContours(draft.paths, pen!, end) : resumeContour(draft.paths, end);
        if (!joined) {
          onPenLimit();
          return;
        }
        const last = joined.paths[joined.current].nodes.length - 1;
        onPenResume(joined.paths, joined.current, [{ path: joined.current, node: last }]);
        if (!activePen) {
          // Un trascinamento disegna la maniglia in uscita dell'estremo, che diventa liscio
          const smooth = joined.paths.map((c, i) => (i === joined.current ? { ...c, nodes: c.nodes.map((n, k) => (k === last ? { ...n, kind: 'smooth' as const } : n)) } : c));
          drag.current = { type: 'resume', ref: { path: joined.current, node: last, side: 'out' }, current: joined.current, close: false, base: smooth, last: smooth, frozen: smooth, to: null, sx, sy, moved: false, alt: false };
          if (e.altKey) setAlt(drag.current, true);
        }
        return;
      }
      // Su una curva, senza contorno in corso e senza Ctrl o ⌘: un nodo sulla curva (la forma non cambia)
      if (!activePen && !e.ctrlKey && !e.metaKey) {
        const candidate = insertCandidate(sx, sy);
        const inserted = candidate && insertNode(draft.paths, candidate.seg, candidate.t);
        if (inserted) {
          onCommit(inserted.paths, [inserted.node]);
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
      drag.current = { type: 'pen', base: draft.paths, current: activePen ? pen : null, p, sx, sy, moved: false, alt: false, keepIn: undefined, out: undefined };
      // Alt già premuto prima del nodo: nessuna maniglia in entrata da conservare
      if (e.altKey) setAlt(drag.current, true);
      return;
    }
    const hit = hitTest(sx, sy);
    if (hit.type === 'handle') {
      drag.current = { type: 'handle', ref: hit.ref, base: draft.paths, last: draft.paths, frozen: draft.paths, to: null, sx, sy, moved: false, alt: false };
      if (e.altKey) setAlt(drag.current, true);
    } else if (hit.type === 'node') {
      const selected = selection.some((r) => same(r, hit.ref));
      // Maiusc aggiunge o toglie dalla selezione; senza, un nodo già selezionato resta nel gruppo (si trascinano tutti)
      const next = e.shiftKey ? (selected ? selection.filter((r) => !same(r, hit.ref)) : [...selection, hit.ref]) : selected ? selection : [hit.ref];
      if (next !== selection) onSelect(next);
      const refs = next.some((r) => same(r, hit.ref)) ? next : [];
      drag.current = {
        type: 'node', refs, base: draft.paths, last: draft.paths, primary: draft.paths[hit.ref.path].nodes[hit.ref.node].p, down: w, sx, sy, moved: false,
        // Un clic senza trascinamento su un nodo di una selezione multipla lascia solo quel nodo
        collapse: !e.shiftKey && selected && selection.length > 1 ? hit.ref : null,
      };
    } else if (hit.type === 'segment') {
      // Il clic su una curva seleziona tutto il contorno (Maiusc lo aggiunge o lo toglie) e trascinandola lo si sposta
      const all: NodeRef[] = draft.paths[hit.seg.path].nodes.map((_, node) => ({ path: hit.seg.path, node }));
      const selected = all.every((r) => selection.some((x) => same(x, r)));
      const next = e.shiftKey ? (selected ? selection.filter((r) => r.path !== hit.seg.path) : [...selection.filter((r) => r.path !== hit.seg.path), ...all]) : all;
      onSelect(next);
      drag.current = { type: 'node', refs: e.shiftKey && selected ? [] : all, base: draft.paths, last: draft.paths, primary: draft.paths[hit.seg.path].nodes[0].p, down: w, sx, sy, moved: false, collapse: null };
    } else {
      // Clic dentro un contorno interamente selezionato: lo si trascina anche dal riempimento
      const filled = e.shiftKey ? -1 : draft.paths.findLastIndex((c, pi) => c.nodes.length >= 3 && c.nodes.every((_, ni) => selection.some((r) => r.path === pi && r.node === ni)) && contourContains(c, w));
      if (filled >= 0) {
        drag.current = { type: 'node', refs: selection, base: draft.paths, last: draft.paths, primary: draft.paths[filled].nodes[0].p, down: w, sx, sy, moved: false, collapse: null };
      } else drag.current = { type: 'box', sx, sy, shift: e.shiftKey, base: selection, moved: false };
    }
  };

  /** Rifà il nodo della Penna dallo stato di partenza: con Alt è uno spigolo (in conservata, out al puntatore), senza è simmetrico. */
  const applyPen = (d: Extract<Drag, { type: 'pen' }>) => {
    const next = appendPenNode(d.base, d.current, d.p, d.out, d.alt ? { keepIn: d.keepIn } : undefined);
    if (next) onPenLive(next.paths, next.current, [next.node]);
  };
  /** Rifà la maniglia trascinata: con Alt dallo stato in cui è stato premuto (spigolo, l'altra resta), senza dallo stato di partenza (il tipo di prima). */
  const applyResume = (d: Extract<Drag, { type: 'resume' }>) => {
    if (!d.to) return;
    // Senza Alt l'estremo è liscio (la base già lo è); con Alt è uno spigolo e l'altra maniglia resta com'era
    d.last = moveHandle(d.alt ? d.frozen : d.base, d.ref, d.to, d.alt);
    onPenLive(d.last, d.current, [{ path: d.ref.path, node: d.ref.node }]);
  };
  const applyHandle = (d: Extract<Drag, { type: 'handle' }>) => {
    if (!d.to) return;
    d.last = d.alt ? moveHandle(d.frozen, d.ref, d.to, true) : moveHandle(d.base, d.ref, d.to, false);
    onLive(d.last);
  };
  /**
   * Alt è momentaneo: cambia il tipo del nodo solo finché è premuto. Quando lo si preme si conserva ciò che il nodo ha in
   * quell'istante (la maniglia in entrata della Penna, lo stato delle maniglie in Seleziona), così la curva già costruita non
   * cambia; se era premuto già prima del nodo non c'è nulla da conservare. Chi chiama ridisegna il nodo.
   */
  const setAlt = (d: Extract<Drag, { type: 'pen' | 'handle' | 'resume' }>, alt: boolean) => {
    if (d.alt === alt) return;
    d.alt = alt;
    setAltHeld(alt);
    if (!alt) return;
    if (d.type === 'pen') d.keepIn = d.out && (d.out[0] !== 0 || d.out[1] !== 0) ? [-d.out[0] + 0, -d.out[1] + 0] : undefined;
    else d.frozen = d.last;
  };

  // Alt premuto o rilasciato a mouse fermo: il nodo cambia subito, senza aspettare un movimento. La fase di cattura serve perché
  // la modale ferma i tasti prima che arrivino alla finestra. Se la finestra perde il focus Alt si considera rilasciato.
  const altRef = useRef<(alt: boolean) => void>(() => {});
  altRef.current = (alt: boolean) => {
    const d = drag.current;
    if (!d || (d.type !== 'pen' && d.type !== 'handle' && d.type !== 'resume') || d.alt === alt) return;
    setAlt(d, alt);
    if (d.type === 'pen') applyPen(d);
    else if (d.type === 'resume') applyResume(d);
    else applyHandle(d);
  };
  // Ctrl o ⌘ premuti o rilasciati a mouse fermo: il pallino di inserimento sparisce o torna subito
  const hoverRef = useRef<(suspend: boolean, ctrl: boolean) => void>(() => {});
  hoverRef.current = (suspend: boolean, ctrl: boolean) => {
    if (drag.current || !lastPointer.current) return;
    refreshHover(lastPointer.current[0], lastPointer.current[1], suspend, ctrl);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        hoverRef.current(e.type === 'keydown', e.key === 'Control' && e.type === 'keydown');
        return;
      }
      if (e.key !== 'Alt') return;
      const d = drag.current;
      if (!d || (d.type !== 'pen' && d.type !== 'handle' && d.type !== 'resume')) return;
      // Alt da solo, su Windows, porta il focus alla barra dei menu del browser
      e.preventDefault();
      altRef.current(e.type === 'keydown');
    };
    const onBlur = () => {
      altRef.current(false);
      hoverRef.current(false, false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const [sx, sy] = pos(e);
    const w = toW(sx, sy);
    setCursor(w);
    lastPointer.current = [sx, sy];
    const d = drag.current;
    if (!d) {
      // Penna senza gesto in corso: l'anteprima del prossimo segmento (o il pallino di inserimento sulla curva) segue il puntatore
      refreshHover(sx, sy, e.ctrlKey || e.metaKey, e.ctrlKey);
      return;
    }
    if (d.type === 'pan') {
      changeView({ ...view, cx: d.cx - (sgn * (sx - d.sx)) / view.s, cy: d.cy + (sy - d.sy) / view.s });
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
      setAlt(d, e.altKey);
      d.to = snapped(w, e, undefined);
      applyHandle(d);
    } else if (d.type === 'resume') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setAlt(d, e.altKey);
      d.to = snapped(w, e, undefined);
      // Chiusura: la maniglia in entrata è opposta al mouse
      if (d.close) {
        const p0 = d.base[d.ref.path].nodes[d.ref.node].p;
        d.to = [2 * p0[0] - d.to[0], 2 * p0[1] - d.to[1]];
      }
      applyResume(d);
    } else if (d.type === 'pen') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setAlt(d, e.altKey);
      // La maniglia è il vettore dal nodo al puntatore (agganciato): il nodo si ricalcola dallo stato di partenza
      const target = snapped(w, e, undefined, d.p);
      d.out = [target[0] - d.p[0], target[1] - d.p[1]];
      applyPen(d);
    } else if (d.type === 'shape') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < DRAG_THRESHOLD) return;
      d.moved = true;
      // L'anteprima è la forma vera nel disegno (un passo locale solo al rilascio); senza misura il disegno torna com'era. Maiusc: quadrato, cerchio, angolo a 15°
      const contour = baseShapeContour({ tool: d.tool, center: d.center, to: snapped(w, { ctrlKey: e.ctrlKey }, d.base.flatMap((c) => c.nodes.map((n) => n.p))), shift: e.shiftKey, sides });
      if (contour) {
        d.last = [...d.base, contour];
        d.live = true;
        onLive(d.last, contour.nodes.map((_, node) => ({ path: d.base.length, node })));
      } else if (d.last !== d.base) {
        d.last = d.base;
        onLive(d.base, []);
      }
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
    setAltHeld(false);
    setPanning(false);
    setClosing(null);
    if (!d) return;
    // Penna: niente da fare al rilascio, il passo di cronologia lo fa il termine del contorno
    if (d.type === 'node') {
      if (d.moved) onCommit(d.last, d.refs);
      else if (d.collapse) onSelect([d.collapse]);
    } else if (d.type === 'resume') {
      if (d.close) onPenClose(d.current, d.moved ? d.last : undefined);
    } else if (d.type === 'handle') {
      if (d.moved) onCommit(d.last, selection);
    } else if (d.type === 'shape') {
      // Il contorno nuovo resta selezionato e lo strumento resta attivo
      if (d.last !== d.base) onCommit(d.last, d.last[d.base.length].nodes.map((_, node) => ({ path: d.base.length, node })));
      // Una forma mostrata e poi tornata a misura nulla: non c'è nulla da concludere, il disegno è quello di prima
      else if (d.live) onShapeCancel();
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
    if (tool === 'pan' || tool === 'rect' || tool === 'ellipse' || tool === 'polygon') return;
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
  // Con la vista specchiata la X cresce verso sinistra
  const [xa, xb] = [Math.min(w0[0], w1[0]), Math.max(w0[0], w1[0])];
  let minor = '';
  let major = '';
  for (let i = Math.ceil(xa / step); i <= Math.floor(xb / step); i++) {
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
  for (let i = Math.ceil(xa / labelStep); i <= Math.floor(xb / labelStep); i++) labels.push({ x: toS([i * labelStep, 0])[0] + 3, y: size.h - 5, text: fmt(i * labelStep), anchor: 'x' });
  for (let i = Math.ceil(w0[1] / labelStep); i <= Math.floor(w1[1] / labelStep); i++) labels.push({ x: 4, y: toS([0, i * labelStep])[1] - 3, text: fmt(i * labelStep), anchor: 'y' });

  const origin = toS([0, 0]);
  // Parte non ruotata visibile: a sinistra dell'asse, o a destra con la vista specchiata
  const outsideX = flip ? Math.max(0, origin[0]) : 0;
  const outsideWidth = flip ? Math.max(0, size.w - outsideX) : Math.max(0, Math.min(size.w, origin[0]));
  const fill = contours.map((poly) => `M${poly.map((p) => toS(p).map(f1).join(' ')).join('L')}Z`).join(' ');

  const nodeShape = (kind: PathNode['kind']) =>
    kind === 'corner' ? <rect x={-4.5} y={-4.5} width={9} height={9} /> : kind === 'symmetric' ? <polygon points="0,-6 6,0 0,6 -6,0" /> : <circle r={5} />;

  return (
    <div ref={wrap} className="profile-editor__canvas" tabIndex={0} role="group" aria-label="Disegno del profilo" data-tool={tool} data-panning={panning || undefined}>
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
          setInsertAt(null);
          setEndHot(null);
          lastPointer.current = null;
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* In rotazione la parte non ruotata (a sinistra dell'asse, a destra con la vista specchiata) ha una tinta */}
        {rotate && outsideWidth > 0 && (
          <g className="profile-editor__outside">
            <rect x={outsideX} y={0} width={outsideWidth} height={size.h} />
            {outsideWidth >= OUTSIDE_LABEL_MIN && (
              <text x={outsideX + outsideWidth / 2} y={size.h / 2} textAnchor="middle">
                Questa parte non viene ruotata
              </text>
            )}
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
          <text className="profile-editor__axis-label" x={origin[0] + (flip ? -6 : 6)} y={60} textAnchor={flip ? 'end' : 'start'}>
            asse di rotazione
          </text>
        )}
        <path className="profile-editor__fill" fillRule="evenodd" d={fill} />
        {draft.paths.map((c, pi) => (
          <path key={pi} className={`profile-editor__curve${holes[pi] ? ' profile-editor__curve--hole' : ''}`} d={contourPath(c, toS)} />
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
              <g key={`${pi}:${ni}`} className={`profile-editor__node${selected ? ' profile-editor__node--selected' : ''}${activePen && pi === pen && ni === 0 && activePen.nodes.length >= 2 ? ' profile-editor__node--first' : ''}${tool === 'pen' && endHot && endHot.path === pi && endHot.node === ni ? ' profile-editor__node--resume' : ''}`} transform={`translate(${f1(x)} ${f1(y)})`} data-node={`${pi}:${ni}`} data-kind={n.kind}>
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
        {/* Chiusura con il trascinamento: il segmento dall'ultimo al primo nodo, con la maniglia che si sta disegnando */}
        {tool === 'pen' && closing !== null && draft.paths[closing] && (() => {
          const closed: PathContour = { ...draft.paths[closing], closed: true };
          const { cubic, straight } = segmentOf(closed, closed.nodes.length - 1);
          const pt = (q: Vec2) => toS(q).map(f1).join(' ');
          return <path className="profile-editor__preview" d={straight ? `M${pt(cubic[0])} L${pt(cubic[3])}` : `M${pt(cubic[0])} C${pt(cubic[1])} ${pt(cubic[2])} ${pt(cubic[3])}`} />;
        })()}
        {tool === 'pen' && insertAt && <circle className="profile-editor__insert" cx={toS(insertAt)[0]} cy={toS(insertAt)[1]} r={4.5} />}
        {tool === 'pen' && hover && <circle className="profile-editor__snap" cx={toS(hover)[0]} cy={toS(hover)[1]} r={4} />}
        {rubber && <rect className="profile-editor__rubber" x={Math.min(rubber.x0, rubber.x1)} y={Math.min(rubber.y0, rubber.y1)} width={Math.abs(rubber.x1 - rubber.x0)} height={Math.abs(rubber.y1 - rubber.y0)} />}
      </svg>
      <div className="profile-editor__tools" role="toolbar" aria-label="Strumenti di disegno">
        <button type="button" aria-pressed={tool === 'select'} title="Seleziona (V): sposta nodi e maniglie (Alt: la maniglia si muove da sola e il nodo è uno spigolo), clic su una curva per selezionare tutto il contorno (trascinala per spostarlo)" onClick={() => onTool('select')}>
          <MousePointer2 size={16} />
          <span>Seleziona</span>
        </button>
        <button type="button" aria-pressed={tool === 'pen'} title="Penna (P): clic per uno spigolo, clic e trascina per una curva (tieni premuto Alt per uno spigolo), clic su una curva esistente per inserirvi un nodo (Ctrl o ⌘: no), clic su un estremo aperto per riprendere il contorno, clic sul primo nodo per chiudere (trascinando ne disegni la maniglia, Alt per uno spigolo), Invio per terminare" onClick={() => onTool('pen')}>
          <PenTool size={16} />
          <span>Penna</span>
        </button>
        <button type="button" aria-pressed={tool === 'pan'} title="Sposta vista (H): trascina per spostare il disegno nella vista. Si può anche tenere premuto Spazio, il tasto centrale o il destro" onClick={() => onTool('pan')}>
          <Hand size={16} />
          <span>Sposta vista</span>
        </button>
        <button type="button" aria-pressed={tool === 'rect'} title="Rettangolo (R): premi sul centro e trascina (Maiusc: quadrato). Nasce con quattro spigoli, modificabili come ogni contorno" onClick={() => onTool('rect')}>
          <Square size={16} />
          <span>Rettangolo</span>
        </button>
        <button type="button" aria-pressed={tool === 'ellipse'} title="Ellisse (C): premi sul centro e trascina (Maiusc: cerchio). Nasce con quattro nodi simmetrici" onClick={() => onTool('ellipse')}>
          <Circle size={16} />
          <span>Ellisse</span>
        </button>
        <button type="button" aria-pressed={tool === 'polygon'} title="Poligono regolare (G): premi sul centro e trascina, il primo vertice va verso il puntatore (Maiusc: angolo a multipli di 15°). Il numero di lati si sceglie nel campo Lati" onClick={() => onTool('polygon')}>
          <Hexagon size={16} />
          <span>Poligono</span>
        </button>
        {tool === 'polygon' && (
          <div className="profile-editor__sides">
            <NumberField label="Lati" min={POLYGON_SIDES.min} max={POLYGON_SIDES.max} integer value={sides} onCommit={setSides} />
          </div>
        )}
        <button type="button" title="Importa SVG: aggiunge al disegno i contorni di un file SVG conservandone le curve (in millimetri, con la X del file e il fondo a y = 0)" onClick={() => fileInput.current?.click()}>
          <Upload size={16} />
          <span>Importa SVG</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          aria-label="File SVG da importare"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Si azzera il campo: lo stesso file si può importare di nuovo
            e.target.value = '';
            if (file) onImportSvg(file);
          }}
        />
      </div>
      {rotate && outsideWidth >= OUTSIDE_LABEL_MIN && (
        <div className="profile-editor__flip" style={{ left: outsideX + outsideWidth / 2, top: size.h / 2 + 14 }}>
          <button type="button" title="Specchia la vista in orizzontale: la parte non ruotata passa dall'altro lato dell'asse, il disegno resta com'è" onClick={onFlip}>
            <FlipHorizontal2 size={14} />
            <span>Inverti asse di simmetria</span>
          </button>
        </div>
      )}
      {draft.paths.length === 0 && (
        <div className="profile-editor__empty" role="note">
          {tool === 'pen' ? 'Fai clic nel disegno per aggiungere il primo punto' : tool === 'rect' || tool === 'ellipse' || tool === 'polygon' ? 'Premi sul centro e trascina per disegnare la forma' : 'Scegli la Penna e fai clic per iniziare, oppure parti da una forma base (R, C, G) o da un SVG'}
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
      {altHeld && (
        <div className="profile-editor__modifier" role="status">
          Alt: spigolo
        </div>
      )}
      <div className="profile-editor__coords" aria-hidden="true">
        {cursor ? `x ${fmt(cursor[0])}  y ${fmt(cursor[1])} mm` : ''}
      </div>
    </div>
  );
}
