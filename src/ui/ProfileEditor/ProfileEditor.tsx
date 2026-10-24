import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ImportError } from '../../import/types';
import { readSvgPaths } from '../../import/svgPaths';
import { MAX_PATH_CONTOURS, assignNodeIds, samplePaths, selfIntersections } from '../../scene/bezier';
import { crossingsAt, preparePlan, ringCache, ridgeRadius, wallThickness } from '../../scene/planRevolve';
import type { PlanPrep } from '../../scene/planRevolve';
import { cleanPlan, DEFAULT_PLAN, featureAngles, isDefaultPlan, isPlainCircle, PLAN_PRESETS, planOutline, planPaths, planTolerance } from '../../scene/planShape';
import type { PlanDraft } from '../../scene/planShape';
import { hasBoundDimension } from '../../scene/resize';
import { quoteScaleWarning } from '../../scene/quoteScale';
import { pathNaturalBox } from '../../scene/shapes2d';
import { useSceneStore } from '../../scene/store';
import type { PathContour, PathNode, ProfileConstraint, Vec2 } from '../../scene/types';
import { Modal } from '../Modal/Modal';
import { useUiStore } from '../uiStore';
import { confirmDialog, notify } from '../notify/notifyStore';
import { DrawingCanvas } from './DrawingCanvas';
import { EditorToolbar } from './EditorToolbar';
import type { ViewMode } from './EditorToolbar';
import type { DimHit, GridSettings, QuoteProps, Tool } from './DrawingCanvas';
import { SELECTION_CONSTRAINTS, addConstraint, addReferenceDimension, addSelectionConstraint, canApplyConstraint, createAngleDimension, createDimension, diagnose, idsOf, isDimension, equalizeLengths, moveNodesConstrained, quoteMismatch, removeConstraint, repositionDimensions, selectionItems, setCommonValue, setConstraintValue, stateText } from './dimensions';
import { applyInferred, inferNodeConstraints, inferShapeConstraints } from './infer';
import { typedPenNode } from './penInput';
import type { PenTarget } from './penInput';
import type { Applied, DimMode, SelectionConstraint } from './dimensions';
import { validateValue } from './constraints';
import { clearDraft, flushDrafts, loadDraft, saveDraft } from './draft';
import { createHistory } from './history';
import type { History } from './history';
import { POLYGON_SIDES, canCloseContour, closeContour, contourHoles, deleteNodesWithConstraints, draftContours, draftFromNode, dropLastNode, emptyDraft, moveHandle, moveNodes, normalizeProfile, pathCenter, pruneConstraints, setNodeRadius, setNodesKind, setNodesRadius, trimDuplicateTail } from './model';
import type { Draft, NodeRef, SegmentRef } from './model';
import { insertPlanNode } from './planEdit';
import { PlanSidebar } from './PlanSidebar';
import type { PlanMeasures } from './PlanSidebar';
import { PlanUnderlay } from './PlanUnderlay';
import { useProfileEditor } from './profileEditorStore';
import type { ProfileTarget } from './profileEditorStore';
import { ProfilePreview } from './ProfilePreview';
import type { PreviewMode } from './ProfilePreview';
import { Sidebar } from './Sidebar';
import type { SectionProps } from './Sidebar';
import { usePlanState } from './usePlanState';
import { usePreviewMesh } from './usePreviewMesh';
import './ProfileEditor.scss';

/** Stato del disegno: contorni e parametri (Draft), nodi selezionati, strumento e contorno in corso della Penna. La cronologia sta a parte. */
interface EditorState {
  draft: Draft;
  selection: NodeRef[];
  tool: Tool;
  /** Indice del contorno che la Penna sta disegnando (null = nessuno). */
  pen: number | null;
}

type Action =
  // Un nuovo disegno (passo concluso, annulla, ripeti, ripristino): la Penna non ha più un contorno in corso
  | { type: 'replace'; draft: Draft; selection?: NodeRef[]; pen?: number | null }
  // Modifica in corso (trascinamento, Penna): `pen` cambia solo se indicato
  | { type: 'paths'; paths: PathContour[]; selection?: NodeRef[]; pen?: number | null }
  | { type: 'select'; selection: NodeRef[] }
  | { type: 'tool'; tool: Tool };

// Il reducer è puro: la cronologia (con i suoi effetti) si aggiorna fuori, nei gestori degli eventi
function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'replace':
      return { ...state, draft: action.draft, selection: action.selection ?? state.selection, pen: action.pen ?? null };
    case 'paths':
      return { ...state, draft: { ...state.draft, paths: action.paths }, selection: action.selection ?? state.selection, pen: action.pen === undefined ? state.pen : action.pen };
    case 'select':
      return { ...state, selection: action.selection };
    case 'tool':
      return { ...state, tool: action.tool, pen: null };
  }
}

/** Aggancio e griglia iniziali: passo di 1 mm, tutti gli agganci attivi, assi visibili. */
const GRID: GridSettings = { step: 1, snapGrid: true, snapNodes: true, snapOrtho: true, showAxis: true };

/** Vero se il tasto va a un campo che usa la tastiera per scrivere (le scorciatoie della modale restano inattive). Caselle e pulsanti no. */
const isTyping = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLInputElement) return t.type !== 'checkbox' && t.type !== 'radio';
  return t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
};

/** Chip di stato nel piede; `action` è un pulsante che risolve l'avviso. */
interface Chip {
  kind: 'ok' | 'warn' | 'err' | 'info';
  text: string;
  action?: { label: string; run: () => void };
}

/** Funzione vuota per le azioni della Penna che nella sagoma non esistono. */
const noop = () => {};

/** Numero con al più due decimali, per i messaggi. */
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Valore proposto nel campo di una quota: fino a quattro decimali, con la virgola italiana. */
const fmtField = (n: number) => String(Number(n.toFixed(4))).replace('.', ',');

/** Quota in corso di scrittura (campo sopra l'etichetta): `base` è il disegno com'era alla scelta dei nodi (con gli id), `con.id` è «draft» se la quota è nuova. */
interface QuoteEdit {
  base: Draft;
  con: ProfileConstraint;
  isNew: boolean;
  text: string;
}

/** Numero scritto in un campo di quota: solo numeri (le espressioni e i parametri arrivano più avanti), virgola o punto; null se non lo è. */
const parseQuoteValue = (text: string): number | null => {
  const t = text.trim().replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
};

/** Insieme vuoto condiviso (nessun vincolo da evidenziare). */
const NONE: Set<string> = new Set();

/**
 * Modale di disegno del Profilo (si apre da `useProfileEditor`). Il disegno vive nello stato locale con una cronologia
 * propria (Ctrl+Z / Ctrl+Maiusc+Z); solo l'OK tocca la scena, con un solo passo di Annulla: "Profilo" per un nodo
 * esistente, "Aggiungi Profilo" per uno nuovo. Una bozza in localStorage protegge il lavoro non confermato.
 */
export default function ProfileEditor() {
  const target = useProfileEditor((s) => s.target);
  if (!target) return null;
  // Un'altra destinazione riparte da capo (stato e cronologia nuovi)
  return <Editor key={JSON.stringify(target)} target={target} />;
}

function Editor({ target }: { target: ProfileTarget }) {
  const close = useProfileEditor((s) => s.close);
  const nodeId = 'nodeId' in target ? target.nodeId : null;

  // Apertura: il disegno di partenza (con la scala incorporata) e il centro prima delle modifiche, per compensare la posizione
  const [init] = useState(() => {
    const node = nodeId ? useSceneStore.getState().scene.nodes[nodeId] : undefined;
    const path = node?.type === 'shape2d' && node.kind === 'path' ? node : undefined;
    const opened = path ? draftFromNode(path) : emptyDraft();
    // I profili vecchi ricevono qui gli id dei nodi (non al caricamento della scena); `baked` si decide prima, sul disegno aperto
    const draft = normalizeProfile(opened);
    return {
      valid: nodeId === null || !!path,
      draft,
      before: pathCenter(draft),
      // La scala è stata incorporata nei nodi: anche un OK senza modifiche deve scriverli
      baked: !!path && opened.paths !== path.paths,
      // Misure legate a un parametro: il disegno si scala alla misura della formula
      bound: path ? { is: hasBoundDimension(path), width: path.width, depth: path.depth } : { is: false, width: 0, depth: 0 },
      // Campi legati a un parametro (altezza, torsione...): la modale non li cambia, all'OK la formula vincerebbe comunque
      boundFields: path ? Object.keys(path.exprs ?? {}) : [],
      // Profilo con quote ridimensionato: la scala è nei nodi ma non nei valori delle quote (decisione 11a: si avvisa, non si riscrive)
      scaleWarning: path && !hasBoundDimension(path) ? quoteScaleWarning(path, 'Il profilo') : null,
      // Il nodo esistente (colore, contorno 2D) e le misure che l'anteprima deve tenere
      node: path ?? null,
      size: path && hasBoundDimension(path) ? { width: path.width, depth: path.depth } : null,
    };
  });

  const [state, dispatch] = useReducer(reducer, { draft: init.draft, selection: [], tool: 'select', pen: null } satisfies EditorState);
  const { draft, selection, tool, pen } = state;
  const [grid, setGrid] = useState<GridSettings>(GRID);
  const stateRef = useRef(state);
  const history = useRef<History<Draft>>(null);
  if (!history.current) {
    history.current = createHistory<Draft>();
    history.current.reset(init.draft);
  }
  // Ultimo disegno entrato nella cronologia: a questo torna l'annullamento di un contorno della Penna a metà
  const committed = useRef(init.draft);
  // Un cursore (slider) ha modificato il disegno senza ancora chiudere il passo: lo chiude il rilascio
  const pendingLive = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const spaceDown = useRef(false);
  // Vero finché si decide se ripristinare la bozza: finché non si decide non si salva nulla
  const [ready, setReady] = useState(false);
  const confirming = useRef(false);
  const dirty = draft !== init.draft;
  // Anteprima 3D: la dimensione della colonna, l'inquadratura (Adatta) e un contatore che ridisegna alla chiusura di un passo
  // Vista specchiata in orizzontale (solo in rotazione, solo la vista: i dati non cambiano)
  const [flipX, setFlipX] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('normal');
  const [fitSignal, setFitSignal] = useState(0);
  // Adatta la vista del disegno (dopo un import)
  const [fitRequest, setFitRequest] = useState(0);
  // Lati del Poligono regolare: il campo sta nella barra degli strumenti, il disegno li usa
  const [sides, setSides] = useState<number>(POLYGON_SIDES.default);
  const [, setSettled] = useState(0);

  // Sagoma di rotazione (sperimentale): disegni mostrati, quello su cui si lavora, quota di sezione (frazione dell'altezza del profilo)
  const experimental = useUiStore((s) => s.experimentalPlan);
  // Vincoli automatici mentre si disegna (impostazione persistente, anche nelle Impostazioni)
  const autoConstraints = useUiStore((s) => s.profileAutoConstraints);
  const setSettings = useUiStore((s) => s.setSettings);
  const [viewMode, setViewMode] = useState<ViewMode>('profile');
  const [activeView, setActiveView] = useState<'profile' | 'plan'>('profile');
  const [section, setSection] = useState(0.5);
  const [showSection, setShowSection] = useState(true);

  const contours = useMemo(() => draftContours(draft), [draft]);
  const crossings = useMemo(() => selfIntersections(contours), [contours]);

  // --- Sagoma ---------------------------------------------------------------------------------------------------------
  const isRotate = draft.extrusion === 'rotate';
  /** Profilo da ruotare: poligoni con x ≥ 0 (la parte oltre l'asse si scarta, come nel kernel), raggio massimo e quote. */
  const profileGeo = useMemo(() => {
    if (!isRotate || contours.length === 0) return null;
    const polys = contours.map((c) => c.map(([x, y]): Vec2 => [Math.max(0, x), y]));
    const xs = polys.flatMap((c) => c.map((p) => p[0]));
    const ys = polys.flatMap((c) => c.map((p) => p[1]));
    const rmaxP = Math.max(...xs);
    return rmaxP > 1e-6 ? { polys, rmaxP, xmin: Math.min(...xs), zmin: Math.min(...ys), zmax: Math.max(...ys) } : null;
  }, [isRotate, contours]);
  const planAvailable = experimental && profileGeo !== null;
  const planDisabled = !isRotate ? 'La sagoma vale solo per la rotazione: scegli Rotazionale' : !profileGeo ? 'Disegna prima il profilo' : undefined;
  const rmaxP = profileGeo?.rmaxP ?? 30;
  const rtFor = (p: PlanDraft) => (p.fit === 'profileToPlan' ? p.planW / 2 : rmaxP);
  const [initialPlan] = useState(() => (init.node?.plan ? cleanPlan(init.node.plan) : DEFAULT_PLAN));
  const planState = usePlanState(rtFor, initialPlan);
  const { plan } = planState;
  const rt = rtFor(plan);
  const k = rt / rmaxP;
  // Con una sola vista visibile è lei a ricevere tastiera, Annulla e sidebar
  const active: 'profile' | 'plan' = !planAvailable || viewMode === 'profile' ? 'profile' : viewMode === 'plan' ? 'plan' : activeView;
  const showPlan = planAvailable && viewMode !== 'profile';
  const showProfile = !planAvailable || viewMode !== 'plan';
  const activeRef = useRef(active);
  activeRef.current = active;
  // Se il profilo non c'è più (o non è rotazionale) si torna al solo profilo
  useEffect(() => {
    if (!planAvailable && viewMode !== 'profile') setViewMode('profile');
  }, [planAvailable, viewMode]);

  /** Contorni effettivi della sagoma (mm) e anelli. Con una sagoma non stellata si tiene l'ultima valida. */
  const lastGood = useRef<{ prep: PlanPrep; outline: Vec2[]; paths: PathContour[] } | null>(null);
  const planGeo = useMemo(() => {
    if (!planAvailable) return null;
    const eff = planPaths(plan, rt);
    const outline = planOutline(eff.paths, planTolerance(rt));
    const draftQ = planState.dragging;
    const prep = outline.length >= 3 ? preparePlan(outline, featureAngles(eff.paths), draftQ ? 144 : 360, draftQ ? 56 : 160, rt, isPlainCircle(plan)) : null;
    const valid = !!prep && prep.ok;
    if (valid) lastGood.current = { prep: prep!, outline, paths: eff.paths };
    return { eff, outline, limited: eff.limited, valid, shown: lastGood.current };
  }, [planAvailable, plan, rt, planState.dragging]);
  const shown = planGeo?.shown ?? null;
  /** Profilo scalato in X quando è lui a seguire la sagoma. */
  const scaled = useMemo(() => (profileGeo ? profileGeo.polys.map((c) => c.map(([x, y]): Vec2 => [x * k, y])) : []), [profileGeo, k]);
  const zs = profileGeo ? profileGeo.zmin + section * (profileGeo.zmax - profileGeo.zmin) : 0;
  const sliceXs = useMemo(() => (profileGeo ? crossingsAt(scaled, zs) : []), [profileGeo, scaled, zs]);
  const planExtras = useMemo(() => {
    if (!shown || !profileGeo) return null;
    const ring = ringCache(shown.prep, plan.model, rt);
    const wall = wallThickness(shown.prep, ring, sliceXs);
    const ridge = ridgeRadius(shown.prep, plan.model, scaled, rt);
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, y] of shown.outline) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { wall, ridge, width: x1 - x0, depth: y1 - y0, halfY: Math.max(Math.abs(y0), Math.abs(y1)) };
  }, [shown, profileGeo, plan.model, rt, scaled, sliceXs]);
  /**
   * Sagoma da salvare con OK e da mandare al kernel per l'anteprima: quella della modale se la funzione sperimentale è
   * attiva (nessuna se è il cerchio), altrimenti quella che il nodo aveva già.
   */
  const planForSave = useMemo(() => (planAvailable ? (isDefaultPlan(plan) ? undefined : plan) : init.node?.plan), [planAvailable, plan, init.node]);
  const planDirty = JSON.stringify(planForSave ?? null) !== JSON.stringify(init.node?.plan ?? null);
  const planDirtyRef = useRef(planDirty);
  planDirtyRef.current = planDirty;
  /**
   * Anelli della sezione nell'anteprima 3D, nel sistema della mesh del kernel: raggio dalla sagoma, quota riferita al
   * centro del riquadro naturale del disegno (il kernel lo porta nell'origine). Con un angolo parziale solo l'arco ruotato.
   */
  const sectionRings = useMemo(() => {
    if (!planAvailable || !showSection || !shown || !profileGeo) return [];
    const box = pathNaturalBox(draft);
    const z = zs - (box?.cy ?? 0);
    const ring = ringCache(shown.prep, plan.model, rt);
    const limit = ((draft.revolveAngle ?? 360) * Math.PI) / 180 + 1e-9;
    const full = (draft.revolveAngle ?? 360) >= 360;
    return sliceXs.map((x) => {
      const r = ring(x);
      const pts: number[] = [];
      for (let k = 0; k < shown.prep.K; k++) if (full || shown.prep.th[k] <= limit) pts.push(r[k] * shown.prep.cos[k], r[k] * shown.prep.sin[k], z);
      return { points: Float32Array.from(pts), closed: full };
    });
  }, [planAvailable, showSection, shown, profileGeo, draft, zs, plan.model, rt, sliceXs]);
  /** Contorni effettivi della sagoma, quelli che il disegno mostra e modifica. */
  const planShown = useMemo(() => planGeo?.eff ?? { paths: [] as PathContour[], limited: false }, [planGeo]);
  const planSelected = planState.selection.length === 1 && planShown.paths[0]?.nodes[planState.selection[0].node] ? planState.selection[0] : null;
  /** Mezzo lato del riquadro che «Adatta» inquadra nella sagoma: dipende dal raggio e dalle scale, non dai nodi, così non cambia mentre si modifica. */
  const planExtent = rt * 1.25 * Math.max(1, plan.sy / plan.sx);
  /** Quota di sezione per i cursori delle due colonne: in mm entro le quote del profilo. */
  const sectionControl: SectionProps | null = planAvailable && profileGeo
    ? {
        z: zs,
        min: Math.round(profileGeo.zmin * 100) / 100,
        max: Math.round(profileGeo.zmax * 100) / 100,
        show: showSection,
        onZ: (z) => setSection(Math.min(1, Math.max(0, (z - profileGeo.zmin) / (profileGeo.zmax - profileGeo.zmin || 1)))),
        onShow: setShowSection,
      }
    : null;
  const planMeasures: PlanMeasures | null = profileGeo && planExtras ? { width: planExtras.width, depth: planExtras.depth, rmax: rt, k, zs, wall: planExtras.wall } : null;

  useEffect(() => {
    stateRef.current = state;
  });

  // Un nodo che non c'è più (o non è un Profilo): niente da modificare
  useEffect(() => {
    if (!init.valid) close();
  }, [init.valid, close]);

  // All'apertura: se c'è una bozza diversa dal disegno di partenza si propone di ripristinarla
  useEffect(() => {
    if (!init.valid) return;
    let alive = true;
    // Anche una bozza v:1 (senza id) si normalizza, per confrontarla con il disegno di partenza e per riprenderla con gli id
    const loaded = loadDraft(nodeId);
    const stored = loaded && normalizeProfile(loaded);
    if (stored && JSON.stringify(stored) !== JSON.stringify(init.draft)) {
      void confirmDialog('Ripristinare il disegno non salvato?', 'Ripristina').then((ok) => {
        if (!alive) return;
        if (ok) {
          // Dal disegno ripristinato si può tornare a quello di partenza con Annulla
          history.current!.push(stored);
          committed.current = stored;
          dispatch({ type: 'replace', draft: stored, selection: [] });
        } else clearDraft(nodeId);
        setReady(true);
      });
    } else setReady(true);
    return () => {
      alive = false;
    };
  }, [init, nodeId]);

  // Salva la bozza a ogni modifica (con debounce); tornando al disegno di partenza non c'è più nulla da proteggere
  useEffect(() => {
    if (!ready) return;
    if (draft === init.draft) clearDraft(nodeId);
    else saveDraft(nodeId, draft);
  }, [ready, draft, init.draft, nodeId]);

  // Chiusura della pagina o della modale (anche dal browser): l'ultima modifica non deve restare nel debounce
  useEffect(() => {
    window.addEventListener('pagehide', flushDrafts);
    return () => {
      window.removeEventListener('pagehide', flushDrafts);
      flushDrafts();
    };
  }, []);

  // Il browser può chiudere il dialog da solo (Esc ripetuti senza gesti dell'utente): la bozza resta e la modale si chiude
  useEffect(() => {
    const dialog = root.current?.closest('dialog');
    if (!dialog) return;
    const onNativeClose = () => {
      flushDrafts();
      close();
    };
    dialog.addEventListener('close', onNativeClose);
    return () => dialog.removeEventListener('close', onNativeClose);
  }, [close]);

  // Il focus va alla radice (dopo che la modale si è aperta), così le scorciatoie funzionano subito
  useEffect(() => {
    const t = setTimeout(() => root.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // --- Cronologia -----------------------------------------------------------------------------------------------------
  /** Chiude il passo aperto da uno slider (ogni rilascio, anche fuori dalla barra, e ogni tasto rilasciato). */
  const settle = useCallback(() => {
    if (!pendingLive.current) return;
    pendingLive.current = false;
    // Come ogni passo di cronologia: i vincoli appesi a nodi che non ci sono più spariscono
    const settled = pruneConstraints(stateRef.current.draft);
    committed.current = settled;
    history.current!.push(settled);
    // Passo concluso: l'anteprima si aggiorna subito (vedi `immediate` più sotto)
    setSettled((n) => n + 1);
    // Lo slider lascia il focus alla pagina al rilascio: senza un elemento attivo le scorciatoie della modale (Ctrl+Z, P) non arrivano
    if (document.activeElement === document.body) root.current?.focus();
  }, []);
  const settlePlan = planState.settle;
  useEffect(() => {
    const both = () => {
      settle();
      settlePlan();
    };
    window.addEventListener('pointerup', both);
    window.addEventListener('keyup', both);
    return () => {
      window.removeEventListener('pointerup', both);
      window.removeEventListener('keyup', both);
    };
  }, [settle, settlePlan]);

  /** Modifica conclusa: un passo della cronologia locale. */
  const commitDraft = (draftToCommit: Draft, nextSelection?: NodeRef[], pen?: number | null) => {
    settle();
    // A ogni passo i vincoli appesi a nodi che non esistono più spariscono (solo il filtro: gli id li assegna il modello)
    const next = pruneConstraints(draftToCommit);
    history.current!.push(next);
    committed.current = next;
    // Un'offerta di quota di riferimento riguarda il disegno di prima; gli indici dei segmenti scelti possono essere cambiati
    setRefOffer(null);
    setSegSel([]);
    dispatch({ type: 'replace', draft: next, selection: nextSelection, pen });
  };
  // `constraints` (se c'è, anche vuoto) sostituisce quelli del disegno: serve all'inserimento di un nodo, che può dividere un vincolo
  const commitPaths = (paths: PathContour[], nextSelection: NodeRef[] = stateRef.current.selection, constraints?: ProfileConstraint[]) =>
    commitDraft({ ...stateRef.current.draft, paths, ...(constraints ? { constraints } : {}) }, nextSelection);
  /** Modifica in corso di un parametro (slider): il disegno cambia subito, il passo si chiude al rilascio (`settle`). */
  const liveDraft = (patch: Partial<Draft>) => {
    finishPen();
    setRefOffer(null);
    const next = { ...stateRef.current.draft, ...patch };
    stateRef.current = { ...stateRef.current, draft: next };
    pendingLive.current = true;
    dispatch({ type: 'replace', draft: next });
  };
  const undo = () => {
    // Una cronologia per vista: Annulla agisce sul disegno su cui si lavora
    if (activeRef.current === 'plan') {
      planState.undo();
      return;
    }
    settle();
    const prev = history.current!.undo();
    if (prev) {
      committed.current = prev;
      forgetQuoteState();
      // Con la Penna a metà contorno ogni nodo è un passo: si toglie l'ultimo e la Penna resta sullo stesso contorno
      dispatch({ type: 'replace', draft: prev, selection: [], pen: penStillOpen(prev) });
    }
  };
  const redo = () => {
    if (activeRef.current === 'plan') {
      planState.redo();
      return;
    }
    settle();
    const next = history.current!.redo();
    if (next) {
      committed.current = next;
      forgetQuoteState();
      dispatch({ type: 'replace', draft: next, selection: [], pen: penStillOpen(next) });
    }
  };
  /** Annulla e Ripeti cambiano il disegno: i nodi scelti con la Quota, un'offerta di quota di riferimento e il vincolo scelto che non c'è più non hanno più senso. */
  const forgetQuoteState = () => {
    setDimPick([]);
    setAngPick([]);
    setSegSel([]);
    setRefOffer(null);
    setSelCon(null);
  };
  /** Il contorno della Penna in corso, se nel disegno `d` c'è ancora ed è aperto (allora la Penna lo continua). */
  const penStillOpen = (d: Draft): number | null => {
    const index = stateRef.current.pen;
    if (index === null || stateRef.current.tool !== 'pen') return null;
    const c = d.paths[index];
    return c && !c.closed && c.nodes.length > 0 ? index : null;
  };

  // --- Penna ----------------------------------------------------------------------------------------------------------
  /** Contorni subito dopo la ripresa di un contorno: se alla fine sono ancora quelli, il disegno non è cambiato. */
  const resumedPaths = useRef<PathContour[] | null>(null);
  /** Nodo della Penna aggiunto (al rilascio): un passo della cronologia, la Penna resta sul contorno. */
  const penStep = (paths: PathContour[]) => {
    settle();
    let next = pruneConstraints({ ...stateRef.current.draft, paths });
    // Vincoli dedotti: un nodo appena aggiunto quasi orizzontale o verticale, perpendicolare al precedente o sopra un altro nodo
    // porta il suo vincolo (nello stesso passo di cronologia); quelli in conflitto o ridondanti non si aggiungono
    const index = stateRef.current.pen;
    const added = index !== null && !!paths[index] && paths[index].nodes.length > (committed.current.paths[index]?.nodes.length ?? 0);
    let inferred = false;
    if (autoConstraints && added && index !== null) {
      const base = normalizeProfile(next);
      const candidates = inferNodeConstraints(base.paths, { path: index, node: base.paths[index].nodes.length - 1 });
      const applied = applyInferred(base, candidates);
      if (applied !== base) {
        next = applied;
        inferred = true;
      }
    }
    history.current!.push(next);
    committed.current = next;
    resumedPaths.current = null;
    setRefOffer(null);
    setSettled((n) => n + 1);
    // Con vincoli dedotti i nodi sono stati ritoccati dal risolutore: lo stato prende il disegno nuovo (la Penna resta sul contorno)
    if (inferred) dispatch({ type: 'replace', draft: next, pen: index });
  };
  /**
   * Penna con valori digitati: il nodo nasce nel punto calcolato da lunghezza e angolo, e i valori scritti diventano quote
   * (distanza e angolo dall'asse X) già posizionate fuori dal disegno. Se il punto cade sul primo nodo di un contorno con
   * almeno tre nodi il contorno si chiude (nessun nodo in più). Una quota già implicata dalle altre o in conflitto entra come
   * quota di riferimento (tra parentesi): i numeri dell'utente non si perdono mai. Un solo passo di cronologia per segmento.
   */
  const typePenNode = (target: Extract<PenTarget, { ok: true }>) => {
    const index = stateRef.current.pen;
    if (index === null) return;
    const result = typedPenNode(stateRef.current.draft, index, target, scaleRef.current);
    if ('error' in result) {
      notify.info(result.error);
      return;
    }
    commitDraft(result.draft, [result.selection], result.closing ? null : index);
  };
  /** Forma base disegnata: il rettangolo nasce con i lati orizzontali e verticali (se i vincoli automatici sono accesi). */
  const commitShape = (tool: 'rect' | 'ellipse' | 'polygon', paths: PathContour[], nextSelection: NodeRef[]) => {
    if (!autoConstraints || tool !== 'rect') {
      commitPaths(paths, nextSelection);
      return;
    }
    const base = normalizeProfile({ ...stateRef.current.draft, paths });
    commitDraft(applyInferred(base, inferShapeConstraints(base.paths, base.paths.length - 1)), nextSelection);
  };
  /** Termina il contorno della Penna in corso (i nodi sono già passi della cronologia). Con meno di 2 nodi sparisce. */
  const finishPen = () => {
    const { draft: current, pen: index } = stateRef.current;
    if (index === null) return;
    // Ripresa di un contorno senza aggiungere nulla (al più invertito): niente passo di cronologia
    if (resumedPaths.current === current.paths) {
      resumedPaths.current = null;
      dispatch({ type: 'replace', draft: committed.current, selection: [] });
      return;
    }
    let paths = trimDuplicateTail(current.paths, index);
    // Un contorno di un solo nodo non descrive nulla: sparisce (un passo, che Annulla riporta)
    if ((paths[index]?.nodes.length ?? 0) < 2) paths = paths.filter((_, i) => i !== index);
    // Nulla da togliere e l'ultimo nodo è già un passo: si esce dalla Penna senza un passo in più
    if (paths.length === current.paths.length && paths.every((c, i) => c === current.paths[i]) && current.paths === committed.current.paths) {
      dispatch({ type: 'replace', draft: current, selection: [] });
      return;
    }
    commitDraft({ ...current, paths }, []);
  };
  /** Clic sul primo nodo: il contorno si chiude e termina. */
  const closePen = (index: number, paths: PathContour[] = stateRef.current.draft.paths) => {
    // Due punti uniti da rette non racchiudono un'area: il contorno resta aperto e si segnala
    if (!paths[index] || !canCloseContour(paths[index])) {
      notify.error('Due segmenti diritti non racchiudono un\'area: trascina dal primo punto per curvare la chiusura, o curva uno dei due segmenti');
      return;
    }
    commitDraft({ ...stateRef.current.draft, paths: closeContour(paths, index) }, [{ path: index, node: 0 }]);
  };
  /** Backspace: toglie l'ultimo nodo del contorno in corso. */
  const penBackspace = () => {
    const { draft: current, pen: index } = stateRef.current;
    if (index === null) return;
    const paths = dropLastNode(current.paths, index);
    // Un passo della cronologia, come ogni nodo della Penna; se il contorno sparisce la Penna non ha più nulla da continuare
    const gone = paths.length < current.paths.length;
    const next = pruneConstraints({ ...current, paths });
    settle();
    history.current!.push(next);
    committed.current = next;
    dispatch({ type: 'replace', draft: next, selection: [], pen: gone ? null : index });
  };
  const changeTool = (next: Tool) => {
    finishPen();
    setDimPick([]);
    setAngPick([]);
    setSegSel([]);
    // Cambiando strumento l'avviso della quota rifiutata e la quota scelta non servono più
    setRefOffer(null);
    setSelCon(null);
    dispatch({ type: 'tool', tool: next });
  };

  // --- Quote e vincoli ------------------------------------------------------------------------------------------------
  // Modo e nodi scelti dello strumento Quota; il campo in scrittura (anche in un ref, per i gestori che arrivano dopo la sua chiusura); vincolo scelto e vincoli in evidenza
  const [dimMode, setDimMode] = useState<DimMode>('len');
  const [dimPick, setDimPick] = useState<NodeRef[]>([]);
  // Segmenti scelti con Alt+clic (valgono finché i loro due nodi restano scelti) e segmenti già scelti per una quota angolare
  const [segSel, setSegSel] = useState<SegmentRef[]>([]);
  const [angPick, setAngPick] = useState<SegmentRef[]>([]);
  const [quoteEdit, setQuoteEditState] = useState<QuoteEdit | null>(null);
  const quoteEditRef = useRef<QuoteEdit | null>(null);
  const setQuoteEdit = (next: QuoteEdit | null) => {
    quoteEditRef.current = next;
    setQuoteEditState(next);
  };
  const [selCon, setSelCon] = useState<string | null>(null);
  // Quote scelte insieme nell'elenco (Maiusc+clic sul nome): solo se la quota scelta ultima è tra loro, altrimenti si azzera
  const [groupSel, setGroupSel] = useState<string[]>([]);
  useEffect(() => {
    setGroupSel((g) => (selCon && g.includes(selCon) ? g : []));
  }, [selCon]);
  const group = groupSel.filter((id) => draft.constraints?.some((c) => c.id === id));
  /** Sceglie una quota o un vincolo dall'elenco; con Maiusc la aggiunge o la toglie dalle quote scelte insieme. */
  const selectConstraint = (id: string | null, additive = false) => {
    if (!additive || id === null) {
      setGroupSel([]);
      setSelCon(id);
      return;
    }
    const base = groupSel.length ? groupSel : selCon ? [selCon] : [];
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    setGroupSel(next);
    setSelCon(next.at(-1) ?? null);
  };
  // Cambiando la selezione dei nodi nessuna quota resta «scelta» (Canc deve eliminare i nodi o niente, non una quota di prima)
  useEffect(() => {
    setSelCon(null);
  }, [selection]);
  const [flash, setFlash] = useState<Set<string>>(NONE);
  // Quota che il disegno rifiuta perché ridondante o in conflitto: si può aggiungere come quota di riferimento (non vincola)
  const [refOffer, setRefOffer] = useState<{ message: string; con: Omit<ProfileConstraint, 'id'> } | null>(null);
  // Zoom del disegno (pixel per mm), comunicato dal canvas: serve a ridisporre le quote
  const scaleRef = useRef(8);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  /** Chiuso il campo di una quota il fuoco tornerebbe alla pagina: lo si rimette alla modale, altrimenti le scorciatoie (D, Ctrl+Z) non arrivano. */
  const refocusRoot = () =>
    setTimeout(() => {
      if (document.activeElement === document.body) root.current?.focus();
    }, 0);

  /** Rifiuto: avviso breve e, per qualche secondo, i vincoli con cui andrebbe in conflitto in rosso. */
  const flashIds = (ids: string[]) => {
    clearTimeout(flashTimer.current);
    setFlash(ids.length ? new Set(ids) : NONE);
    if (ids.length) flashTimer.current = setTimeout(() => setFlash(NONE), 3000);
  };
  const reject = (message: string, ids: string[]) => {
    notify.error(message);
    flashIds(ids);
  };
  /** Esito di un'aggiunta o modifica: un passo di cronologia se è andata bene, altrimenti l'avviso e niente cambia. */
  const applyResult = (result: Applied<Draft>): boolean => {
    if (!result.ok) {
      reject(result.message, result.ids);
      return false;
    }
    commitDraft(result.draft);
    return true;
  };

  /** Quota di lunghezza tra due nodi: si propone il valore attuale in un campo sopra l'etichetta, e Invio la applica. */
  const startLinear = (a: NodeRef, b: NodeRef, pxPerMm: number) => {
    // Gli id dei nodi si danno qui (i nodi disegnati dopo l'apertura non ce li hanno): il passo di cronologia lo fa la conferma
    const base = normalizeProfile(stateRef.current.draft);
    const [idA, idB] = idsOf(base.paths, [a, b]);
    const dim = idA && idB ? createDimension(base.paths, dimMode === 'ang' ? 'len' : dimMode, idA, idB, pxPerMm, base.constraints) : 'Scegli due nodi diversi';
    if (typeof dim === 'string') {
      notify.error(dim);
      return;
    }
    setQuoteEdit({ base, con: { ...dim, id: 'draft' }, isNew: true, text: fmtField(dim.v ?? 0) });
  };
  /** Id dei due estremi di un segmento del disegno `paths`. */
  const segmentIds = (paths: PathContour[], seg: SegmentRef): [string, string] | null => {
    const c = paths[seg.path];
    const [a, b] = [c?.nodes[seg.segment]?.id, c?.nodes[(seg.segment + 1) % (c?.nodes.length ?? 1)]?.id];
    return a && b ? [a, b] : null;
  };
  /** Quota angolare tra due segmenti: si propone l'angolo attuale in un campo sull'arco, e Invio la applica. */
  const startAngle = (first: SegmentRef, second: SegmentRef, pxPerMm: number) => {
    const base = normalizeProfile(stateRef.current.draft);
    const [s1, s2] = [segmentIds(base.paths, first), segmentIds(base.paths, second)];
    const dim = s1 && s2 ? createAngleDimension(base.paths, s1, s2, pxPerMm, base.constraints) : 'Scegli due segmenti';
    if (typeof dim === 'string') {
      notify.error(dim);
      return;
    }
    setQuoteEdit({ base, con: { ...dim, id: 'draft' }, isNew: true, text: fmtField(dim.v ?? 0) });
  };
  /** Clic con lo strumento Quota: due nodi, oppure un segmento (la quota tra i suoi estremi); in modo Angolo, due segmenti. */
  const onDimClick = (hit: DimHit, pxPerMm: number) => {
    // Con un campo aperto il clic lo conferma (l'uscita dal campo) e non fa altro
    if (quoteEditRef.current) return;
    // L'azione successiva: la quota scelta (anche quella appena creata) non resta tale
    setSelCon(null);
    if (dimMode === 'ang') {
      if (hit.kind === 'node') {
        notify.info('Per la quota angolare scegli due segmenti');
        return;
      }
      if (angPick.some((q) => q.path === hit.seg.path && q.segment === hit.seg.segment)) return;
      const next = [...angPick, hit.seg];
      if (next.length < 2) {
        setAngPick(next);
        return;
      }
      setAngPick([]);
      startAngle(next[0], next[1], pxPerMm);
      return;
    }
    if (hit.kind === 'segment') {
      setDimPick([]);
      const contour = stateRef.current.draft.paths[hit.seg.path];
      if (contour) startLinear({ path: hit.seg.path, node: hit.seg.segment }, { path: hit.seg.path, node: (hit.seg.segment + 1) % contour.nodes.length }, pxPerMm);
      return;
    }
    if (dimPick.some((r) => r.path === hit.ref.path && r.node === hit.ref.node)) return;
    const next = [...dimPick, hit.ref];
    if (next.length < 2) {
      setDimPick(next);
      return;
    }
    setDimPick([]);
    startLinear(next[0], next[1], pxPerMm);
  };
  /** Clic sull'etichetta di una quota (apre il campo del valore) o sull'icona di un vincolo (lo sceglie nell'elenco). */
  const onLabelClick = (id: string) => {
    if (quoteEditRef.current) return;
    const current = stateRef.current.draft;
    const con = current.constraints?.find((c) => c.id === id);
    if (!con) return;
    setSelCon(id);
    if (isDimension(con) && !con.ref) setQuoteEdit({ base: current, con, isNew: false, text: fmtField(con.v ?? 0) });
    else if (con.ref) notify.info('Quota di riferimento: mostra la misura, non la impone');
  };
  /** Il campo della quota si conferma (Invio o uscita dal campo). Un valore non valido o non raggiungibile lascia il disegno com'è. */
  const commitQuote = (text: string) => {
    const edit = quoteEditRef.current;
    if (!edit) return;
    setQuoteEdit(null);
    refocusRoot();
    const value = parseQuoteValue(text);
    if (value === null) {
      notify.error('Valore non valido: scrivi un numero');
      return;
    }
    const invalid = validateValue(edit.con.t, value);
    if (invalid) {
      notify.error(invalid);
      return;
    }
    if (edit.isNew) {
      const { id: _draftId, ...dim } = edit.con;
      const result = addConstraint(edit.base, { ...dim, v: value });
      if (result.ok) {
        commitDraft(result.draft);
        setSelCon(result.draft.constraints?.at(-1)?.id ?? null);
      } else if (result.reason === 'conflict' || result.reason === 'redundant') {
        // Conflitto o ridondanza: non si applica, ma si offre di aggiungerla come quota di riferimento (misura senza vincolare)
        flashIds(result.ids);
        setRefOffer({ message: result.message, con: dim });
      } else reject(result.message, result.ids);
    } else if (Math.abs(value - (edit.con.v ?? Number.NaN)) > 1e-9) applyResult(setConstraintValue(stateRef.current.draft, edit.con.id, value));
  };
  const cancelQuote = () => {
    setQuoteEdit(null);
    refocusRoot();
  };
  /** Vincolo da ciò che è scelto (pulsanti del pannello): si danno gli id ai nodi che ne sono privi, poi si risolve. */
  const applyConstraintButton = (type: SelectionConstraint) => {
    const base = normalizeProfile(stateRef.current.draft);
    applyResult(addSelectionConstraint(base, type, selectionItems(base.paths, stateRef.current.selection, segSel)));
  };
  /** Alt+clic su un segmento sceglie il segmento (i suoi due nodi); con Maiusc si aggiunge o si toglie dai già scelti (due segmenti per Parallelo...). */
  const pickSegment = (seg: SegmentRef, additive: boolean) => {
    const contour = stateRef.current.draft.paths[seg.path];
    if (!contour) return;
    const pair: NodeRef[] = [{ path: seg.path, node: seg.segment }, { path: seg.path, node: (seg.segment + 1) % contour.nodes.length }];
    const sameNode = (a: NodeRef, b: NodeRef) => a.path === b.path && a.node === b.node;
    const sameSeg = (a: SegmentRef, b: SegmentRef) => a.path === b.path && a.segment === b.segment;
    setSelCon(null);
    if (!additive) {
      setSegSel([seg]);
      dispatch({ type: 'select', selection: pair });
      return;
    }
    if (segSel.some((q) => sameSeg(q, seg))) {
      // Già scelto: si toglie, con i suoi nodi (se non servono a un altro segmento scelto)
      const rest = segSel.filter((q) => !sameSeg(q, seg));
      const kept = rest.flatMap((q) => [{ path: q.path, node: q.segment }, { path: q.path, node: (q.segment + 1) % (stateRef.current.draft.paths[q.path]?.nodes.length ?? 1) }]);
      setSegSel(rest);
      dispatch({ type: 'select', selection: stateRef.current.selection.filter((r) => !pair.some((x) => sameNode(x, r)) || kept.some((x) => sameNode(x, r))) });
      return;
    }
    setSegSel([...segSel, seg]);
    dispatch({ type: 'select', selection: [...stateRef.current.selection, ...pair.filter((x) => !stateRef.current.selection.some((r) => sameNode(x, r)))] });
  };
  /** Elimina uno o più vincoli e quote (le quote scelte insieme), in un solo passo. */
  const deleteConstraints = (ids: string[]) => {
    commitDraft(ids.reduce((d, id) => removeConstraint(d, id), stateRef.current.draft));
    if (selCon && ids.includes(selCon)) setSelCon(null);
  };
  const deleteConstraint = (id: string) => deleteConstraints([id]);
  const setConstraintValueFromPanel = (id: string, value: number) => {
    applyResult(setConstraintValue(stateRef.current.draft, id, value));
  };
  /** «Aggiungi come quota di riferimento»: la quota rifiutata entra con la misura che il disegno ha (tra parentesi, non vincola). */
  const addReference = () => {
    const offer = refOffer;
    if (!offer) return;
    setRefOffer(null);
    // Sul disegno di ADESSO (non su quello di quando la quota è stata rifiutata: nel frattempo si è potuto lavorare), se i nodi ci sono ancora
    const next = addReferenceDimension(normalizeProfile(stateRef.current.draft), offer.con);
    if (!next) {
      notify.error('La quota non si può aggiungere: i suoi nodi non ci sono più');
      return;
    }
    commitDraft(next);
    setSelCon(next.constraints?.at(-1)?.id ?? null);
  };
  /** Trascinamento dell'etichetta o della linea di una quota: la posizione cambia subito, il passo di cronologia lo chiude il rilascio. */
  const moveQuote = (id: string, off: number, at: number) => {
    const current = stateRef.current.draft;
    if (!current.constraints?.some((c) => c.id === id)) return;
    setSelCon(id);
    liveDraft({ constraints: current.constraints.map((c) => (c.id === id ? { ...c, off, at } : c)) });
  };
  /** «Riposiziona quote»: la disposizione automatica per tutte, in un passo. */
  const repositionQuotes = () => {
    const current = stateRef.current.draft;
    if (!current.constraints?.length) return;
    commitDraft({ ...current, constraints: repositionDimensions(current.paths, current.constraints, scaleRef.current) });
  };

  // --- Importa SVG ----------------------------------------------------------------------------------------------------
  /** Importa SVG: i contorni si accodano al disegno in un solo passo locale e restano selezionati; la vista li inquadra. */
  const importSvg = async (file: File) => {
    try {
      const imported = readSvgPaths(await file.text(), file.name.replace(/\.svg$/i, ''));
      // Un contorno della Penna in corso si conclude prima. `stateRef` si aggiorna solo al render successivo: se c'era un contorno
      // in corso la base è l'ultimo disegno concluso (`committed`, già aggiornato da `finishPen`), altrimenti lo stato attuale
      const penning = stateRef.current.pen !== null;
      finishPen();
      const base = penning ? committed.current.paths : stateRef.current.draft.paths;
      if (base.length + imported.length > MAX_PATH_CONTOURS) {
        notify.error(`Con i ${imported.length} contorni del file il disegno supererebbe il massimo di ${MAX_PATH_CONTOURS} contorni`);
        return;
      }
      commitPaths([...base, ...imported], imported.flatMap((c, i) => c.nodes.map((_, node) => ({ path: base.length + i, node }))));
      setFitRequest((n) => n + 1);
    } catch (error) {
      notify.error(error instanceof ImportError ? error.message : 'Impossibile leggere il file SVG');
    }
  };

  // --- Chiusura -------------------------------------------------------------------------------------------------------
  /** Annulla o Esc: se c'è qualcosa di non salvato chiede conferma; una richiesta alla volta. */
  const askClose = async () => {
    if (confirming.current) return;
    confirming.current = true;
    try {
      if ((stateRef.current.draft !== init.draft || planDirtyRef.current) && !(await confirmDialog('Chiudere senza salvare il profilo?', 'Chiudi'))) return;
      clearDraft(nodeId);
      close();
    } finally {
      confirming.current = false;
    }
  };

  const holes = useMemo(() => contourHoles(draft), [draft]);
  const sampling = useMemo(() => {
    const sampled = samplePaths(draft.paths, draft.tolerance);
    return { points: sampled.contours.reduce((n, c) => n + c.points.length, 0), tolerance: sampled.tolerance, capped: sampled.capped };
  }, [draft.paths, draft.tolerance]);
  // Diagnosi dei vincoli (gradi di libertà, nodi e vincoli in conflitto): solo a disegno fermo, un trascinamento in corso mostra l'ultima
  const diagDraft = useRef(draft);
  if (draft === committed.current) diagDraft.current = draft;
  const diag = useMemo(() => diagnose(diagDraft.current), [diagDraft.current]);
  // Le quote non corrispondono ai nodi (profilo ridimensionato e salvato, file modificato a mano): si dice prima che la prima modifica li riporti alle quote
  const mismatch = useMemo(() => quoteMismatch(diagDraft.current), [diagDraft.current]);
  const validContours = draft.paths.filter((c) => c.nodes.length >= 2);
  const nodeCount = draft.paths.reduce((n, c) => n + c.nodes.length, 0);
  // OK solo con almeno un contorno che il kernel riempie davvero
  const canApply = contours.length > 0;
  // Durante un trascinamento il disegno non è ancora un passo concluso: l'anteprima si aggiorna al più ogni 100 ms; al rilascio subito
  // L'anteprima è il kernel vero anche con la sagoma: la stessa mesh che l'OK scrive nella scena
  const previewDraft = useMemo(() => ({ ...draft, plan: planForSave }), [draft, planForSave]);
  const preview = usePreviewMesh(previewDraft, init.node, init.size, draft === committed.current && !planState.dragging, canApply);

  /** OK: applica il disegno alla scena (un solo passo) e chiude. */
  const apply = () => {
    if (!canApply) return;
    // I contorni con un solo nodo (un tratto appena iniziato) non descrivono nulla
    const final: Draft = { ...draft, paths: validContours, plan: planForSave };
    if (nodeId) {
      // Senza modifiche e senza scala da incorporare non c'è niente da scrivere
      if (dirty || planDirty || init.baked) {
        if (!useSceneStore.getState().commitProfile(nodeId, final, { before: init.before, after: pathCenter(final) })) {
          notify.error('Il profilo è bloccato: sbloccalo per modificarlo');
          return;
        }
      }
    } else {
      const { paths, ...params } = final;
      useSceneStore.getState().addPath({ paths, ...params, at: 'new' in target ? target.at : undefined });
    }
    clearDraft(nodeId);
    close();
  };

  // --- Tastiera -------------------------------------------------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Nessun tasto della modale arriva alle scorciatoie dell'app (sulla finestra): con uno strumento della scena aperto
    // Invio o Canc agirebbero sulla scena
    e.stopPropagation();
    // Esc: la gestiamo noi (il dialog non deve chiudersi da solo). Termina il contorno della Penna, altrimenti conferma se
    // c'è del lavoro; in un campo di testo basta l'annullamento del campo
    if (e.key === 'Escape') {
      e.preventDefault();
      if (isTyping(e.target)) return;
      if (stateRef.current.pen !== null) finishPen();
      else if (refOffer) setRefOffer(null);
      else if (dimPick.length || angPick.length) {
        setDimPick([]);
        setAngPick([]);
      }
      else void askClose();
      return;
    }
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod) {
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      }
      return;
    }
    const { selection: sel, pen: penIndex } = stateRef.current;
    if (key === 'v') changeTool('select');
    else if (key === 'p') changeTool('pen');
    else if (key === 'h') changeTool('pan');
    else if (key === 'r') changeTool('rect');
    else if (key === 'c') changeTool('ellipse');
    else if (key === 'g') changeTool('polygon');
    else if (key === 'd') changeTool('dim');
    else if (key === 'enter') {
      // Invio termina il contorno della Penna (sui pulsanti conserva il suo significato)
      if (penIndex !== null && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        finishPen();
      }
    } else if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      if (activeRef.current === 'plan') {
        // Sagoma: i nodi si tolgono con Seleziona e la forma resta chiusa (almeno tre nodi)
        if (stateRef.current.tool === 'select' && planState.selection.length && !planState.deleteSelected()) notify.info('Una sagoma ha almeno tre nodi: la forma deve restare chiusa');
      } else if (penIndex !== null) penBackspace();
      else if (sel.length && stateRef.current.tool === 'select') commitDraft(deleteNodesWithConstraints(stateRef.current.draft, sel), []);
      // Nessun nodo scelto ma una quota o un vincolo scelto nell'elenco o sul disegno (con Seleziona: la Quota sceglie solo per modificare): Canc lo elimina
      else if (!sel.length && stateRef.current.tool === 'select' && selCon && stateRef.current.draft.constraints?.some((c) => c.id === selCon)) deleteConstraints(group.length > 1 ? group : [selCon]);
    } else if (key.startsWith('arrow')) {
      // Frecce: un passo di griglia (Maiusc: dieci)
      e.preventDefault();
      const onPlan = activeRef.current === 'plan';
      const chosen = onPlan ? planState.selection : sel;
      if (!chosen.length || stateRef.current.tool !== 'select') return;
      const step = grid.step * (e.shiftKey ? 10 : 1);
      const sx = !onPlan && draft.extrusion === 'rotate' && flipX ? -1 : 1;
      const delta: Vec2 = key === 'arrowleft' ? [-step * sx, 0] : key === 'arrowright' ? [step * sx, 0] : key === 'arrowup' ? [0, step] : [0, -step];
      if (onPlan) planState.editPaths(moveNodes(planShown.paths, chosen, delta), 'commit');
      else commitPaths(moveNodesConstrained(stateRef.current.draft.paths, stateRef.current.draft.constraints, sel, delta));
    } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLElement && e.target.tagName === 'SUMMARY')) {
      // Spazio: panoramica finché è premuto
      e.preventDefault();
      spaceDown.current = true;
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ') spaceDown.current = false;
  };

  // --- Sidebar --------------------------------------------------------------------------------------------------------
  const selected = selection.length === 1 && draft.paths[selection[0].path]?.nodes[selection[0].node] ? selection[0] : null;
  const setHandle = (side: 'in' | 'out', length: number, angle: number) => {
    if (!selected) return;
    const p = draft.paths[selected.path].nodes[selected.node].p;
    const a = (angle * Math.PI) / 180;
    commitPaths(moveHandle(draft.paths, { ...selected, side }, [p[0] + length * Math.cos(a), p[1] + length * Math.sin(a)], false));
  };
  const closeOpen = () => commitPaths(draft.paths.map((c) => (!c.closed && c.nodes.length >= 2 ? { ...c, closed: true } : c)));

  // Che cosa è scelto (nodi sciolti e segmenti) e quali vincoli ci stanno: i nodi senza id si contano lo stesso (gli id si danno al clic)
  const idPaths = useMemo(() => assignNodeIds(draft.paths), [draft.paths]);
  const items = useMemo(() => selectionItems(idPaths, selection, segSel), [idPaths, selection, segSel]);
  const can = useMemo(() => Object.fromEntries(SELECTION_CONSTRAINTS.map((t) => [t, canApplyConstraint(t, items)])) as Record<SelectionConstraint, boolean>, [items]);
  const selectionText = [items.nodes.length ? `${items.nodes.length} ${items.nodes.length === 1 ? 'nodo' : 'nodi'}` : '', items.segments.length ? `${items.segments.length} ${items.segments.length === 1 ? 'segmento' : 'segmenti'}` : ''].filter(Boolean).join(' e ');
  /** Quote e vincoli per il disegno del profilo (la sagoma non li ha). */
  const quoteProps: QuoteProps = {
    bad: diag?.bad ?? NONE,
    flash,
    selected: group.length > 1 ? group : selCon,
    states: diag?.states ?? null,
    // I nodi già scelti con la Quota; in modo Angolo i due estremi del primo segmento
    pick: [...dimPick, ...angPick.flatMap((q) => [{ path: q.path, node: q.segment }, { path: q.path, node: (q.segment + 1) % (draft.paths[q.path]?.nodes.length ?? 1) }])],
    edit: quoteEdit && { con: quoteEdit.con, paths: quoteEdit.base.paths, isNew: quoteEdit.isNew, text: quoteEdit.text },
    onDimClick,
    onLabelClick,
    onEditCommit: commitQuote,
    onEditCancel: cancelQuote,
    onQuoteMove: moveQuote,
    onDeselect: () => setSelCon(null),
    onScale: (px) => {
      scaleRef.current = px;
    },
  };

  // --- Piede ----------------------------------------------------------------------------------------------------------
  const chips: Chip[] = [];
  if (init.bound.is) chips.push({ kind: 'warn', text: `Le misure sono legate a un parametro: il disegno viene scalato a ${fmt(init.bound.width)} × ${fmt(init.bound.depth)}` });
  if (draft.extrusion === 'linear' && validContours.some((c) => !c.closed)) {
    chips.push({ kind: 'warn', text: 'Contorno aperto: in estrusione lineare si chiude con un segmento retto', action: { label: 'Chiudi il contorno', run: closeOpen } });
  }
  if (crossings.length) chips.push({ kind: 'err', text: `${crossings.length} ${crossings.length === 1 ? 'autointersezione' : 'autointersezioni'}` });
  if (draft.extrusion === 'rotate' && contours.some((c) => c.some(([x]) => x < -1e-6))) chips.push({ kind: 'warn', text: 'Una parte sta oltre l\'asse e non viene ruotata' });
  const noArea = validContours.length - contours.length;
  if (noArea > 0) {
    // Perché non c'è area, e cosa fare: i punti stanno tutti su una retta verticale o orizzontale, oppure allineati in altro modo
    const box = pathNaturalBox(draft);
    const why = box && box.width <= 0 ? 'tutti i punti stanno sulla stessa verticale' : box && box.depth <= 0 ? 'tutti i punti stanno sulla stessa orizzontale' : 'i punti sono allineati';
    const what = noArea === validContours.length ? 'Nessun contorno ha area' : `${noArea} ${noArea === 1 ? 'contorno senza area' : 'contorni senza area'}`;
    chips.push({ kind: 'warn', text: `${what}: ${why}, non produce un solido. Aggiungi un punto non allineato` });
  }
  if (sampling.capped) chips.push({ kind: 'warn', text: `Troppi punti: la tolleranza effettiva è ${fmt(sampling.tolerance)} mm (impostata ${fmt(draft.tolerance)} mm)` });
  if (planAvailable) {
    if (planGeo && !planGeo.valid) chips.push({ kind: 'err', text: 'Sagoma non stellata: il centro non vede tutto il bordo. Si usa l\'ultima valida' });
    if (planGeo?.limited) chips.push({ kind: 'warn', text: 'Raggio angoli ridotto: i lati non bastano' });
    if (planExtras?.ridge != null) chips.push({ kind: 'warn', text: `Cresta: il profilo scende sotto il raggio inscritto (${fmt(planExtras.ridge)} mm)` });
  }
  if (!chips.length && contours.length) chips.push({ kind: 'ok', text: 'Nessun avviso' });
  // Stato dei vincoli (non è un avviso): sottovincolato, completamente vincolato, sovravincolato
  if (diag) chips.push(stateText(diag.report));
  // Ridimensionato con quote: i valori salvati non seguono la scala (decisione 11a): finché ci sono quote pilotanti l'avviso resta
  const scaleChip = !!init.scaleWarning && !!draft.constraints?.some((c) => isDimension(c) && !c.ref);
  if (scaleChip) chips.push({ kind: 'warn', text: init.scaleWarning! });
  // Già salvato dopo un ridimensionamento il fattore non c'è più, ma il disaccordo sì: lo scarto lo segnala (non due volte alla prima apertura)
  else if (mismatch !== null) chips.push({ kind: 'warn', text: `Le quote non corrispondono al disegno (scarto fino a ${fmt(mismatch).replace('.', ',')} mm): alla prossima modifica i nodi tornano alle quote` });

  if (!init.valid) return null;

  return (
    <Modal open title="Profilo" size="large" dismissable={false} onClose={() => void askClose()} onEscape={() => void askClose()}>
      <div ref={root} className="profile-editor" tabIndex={-1} onKeyDown={onKeyDown} onKeyUp={onKeyUp}>
        <div className={`profile-editor__main profile-editor__main--preview-${previewMode}`}>
          <div className="profile-editor__left">
            <EditorToolbar
              tool={tool}
              onTool={changeTool}
              canUndo={active === 'plan' ? planState.canUndo : history.current!.canUndo()}
              canRedo={active === 'plan' ? planState.canRedo : history.current!.canRedo()}
              onUndo={undo}
              onRedo={redo}
              sides={sides}
              onSides={setSides}
              dimMode={dimMode}
              onDimMode={(mode) => {
                setDimMode(mode);
                setDimPick([]);
                setAngPick([]);
              }}
              onImportSvg={(file) => void importSvg(file)}
              shapesOff={active === 'plan' ? 'Nella sagoma ci sono solo Seleziona, Penna e Sposta vista: la forma è un contorno solo, sempre chiuso' : undefined}
              target={showPlan && showProfile ? (active === 'plan' ? 'sagoma' : 'profilo') : undefined}
              views={experimental ? { mode: viewMode, onMode: (m) => { setViewMode(m); if (m !== 'both') setActiveView(m); }, disabled: planDisabled } : undefined}
            />
            <div className={`profile-editor__stage${showPlan && showProfile ? ' profile-editor__stage--both' : ''}`}>
              {showProfile && (
                <div className={`profile-editor__pane${showPlan && active === 'profile' ? ' profile-editor__pane--active' : ''}`} onPointerDownCapture={() => setActiveView('profile')}>
                  {showPlan && <span className="profile-editor__pane-tag">Profilo</span>}
                  <DrawingCanvas
                    paths={draft.paths}
                    rotate={isRotate}
                    refit={`${showPlan}`}
                    contours={contours}
                    crossings={crossings}
                    holes={holes}
                    sides={sides}
                    fitRequest={fitRequest}
                    onShapeLimit={() => notify.info('Limite raggiunto: al massimo 100 contorni. Elimina un contorno per disegnarne un altro')}
                    onShapeCancel={() => dispatch({ type: 'replace', draft: committed.current, selection: [] })}
                    selection={selection}
                    grid={grid}
                    spaceDown={spaceDown}
                    tool={tool}
                    flip={isRotate && flipX}
                    onFlip={() => setFlipX((f) => !f)}
                    pen={pen}
                    section={planAvailable && profileGeo && showSection ? { y: zs, label: `quota z = ${fmt(zs)} mm` } : undefined}
                    onSection={profileGeo ? (y) => setSection(Math.min(1, Math.max(0, (y - profileGeo.zmin) / (profileGeo.zmax - profileGeo.zmin || 1)))) : undefined}
                    onLive={(paths, sel) => dispatch({ type: 'paths', paths, selection: sel })}
                    constraints={draft.constraints}
                    quote={quoteProps}
                    onPickSegment={pickSegment}
                    onCommit={commitPaths}
                    onSelect={(sel) => {
                      // Un clic normale cambia i nodi scelti: i segmenti scelti con Alt+clic non valgono più
                      setSegSel([]);
                      dispatch({ type: 'select', selection: sel });
                    }}
                    onPenLive={(paths, current, sel) => dispatch({ type: 'paths', paths, selection: sel, pen: current })}
                    onPenResume={(paths, current, sel) => {
                      resumedPaths.current = paths;
                      dispatch({ type: 'paths', paths, selection: sel, pen: current });
                    }}
                    onPenClose={closePen}
                    onPenFinish={finishPen}
                    onPenStep={penStep}
                    onPenType={typePenNode}
                    onShape={commitShape}
                    onPenLimit={() => notify.info('Limite raggiunto: al massimo 500 nodi per contorno e 100 contorni. Termina il contorno (Invio) o chiudilo')}
                  />
                  {refOffer && (
                    <div className="profile-editor__qbar" role="alert">
                      <span>{refOffer.message}</span>
                      <button type="button" onClick={addReference}>
                        Aggiungi come quota di riferimento
                      </button>
                      <button type="button" onClick={() => setRefOffer(null)}>
                        Annulla
                      </button>
                    </div>
                  )}
                </div>
              )}
              {showPlan && (
                <div
                  className={`profile-editor__pane${showProfile && active === 'plan' ? ' profile-editor__pane--active' : ''}`}
                  onPointerDownCapture={() => {
                    // Un contorno della Penna a metà nel profilo si chiude quando si passa alla sagoma
                    if (activeRef.current !== 'plan') finishPen();
                    setActiveView('plan');
                  }}
                >
                  {showProfile && <span className="profile-editor__pane-tag">Sagoma</span>}
                  <DrawingCanvas
                    label="Disegno della sagoma"
                    paths={planShown.paths}
                    rotate={false}
                    closedOnly
                    refit={`${showProfile}`}
                    onClosedOnly={() => notify.info('Nella sagoma la Penna inserisce nodi sulla curva: la forma resta sempre chiusa')}
                    insertOverride={(paths, seg, t) => {
                      const r = insertPlanNode(paths[0], seg.segment, t, plan.kind === 'free' ? plan.sym : 'none');
                      return r ? { paths: [r.contour], node: { path: 0, node: r.node } } : null;
                    }}
                    underlay={(ctx) =>
                      shown && profileGeo ? <PlanUnderlay ctx={ctx} prep={shown.prep} model={plan.model} rmax={rt} xmin={profileGeo.xmin * k} xmax={rt} slice={showSection ? sliceXs : []} zs={showSection ? zs : null} sym={plan.kind === 'free' ? plan.sym : 'none'} levels /> : null
                    }
                    fitBox={[-planExtent, -planExtent, planExtent, planExtent]}
                    contours={shown ? [shown.outline] : []}
                    crossings={[]}
                    holes={[]}
                    sides={sides}
                    fitRequest={0}
                    onShapeLimit={noop}
                    onShapeCancel={noop}
                    selection={planState.selection}
                    grid={grid}
                    spaceDown={spaceDown}
                    tool={tool}
                    flip={false}
                    onFlip={noop}
                    pen={null}
                    onLive={(paths, sel) => planState.editPaths(paths, 'live', sel)}
                    onCommit={(paths, sel) => planState.editPaths(paths, 'commit', sel)}
                    onSelect={planState.setSelection}
                    onPenLive={noop}
                    onPenResume={noop}
                    onPenClose={noop}
                    onPenFinish={noop}
                    onPenLimit={noop}
                  />
                </div>
              )}
            </div>
          </div>
          <ProfilePreview {...preview} rings={sectionRings} mode={previewMode} onMode={setPreviewMode} fitSignal={fitSignal} onFit={() => setFitSignal((n) => n + 1)} />
          {planAvailable && active === 'plan' ? (
            <PlanSidebar
              plan={plan}
              paths={planShown.paths}
              selection={planState.selection}
              grid={grid}
              measures={planMeasures}
              onKind={planState.setKind}
              onPreset={(name) => planState.preset(PLAN_PRESETS[name])}
              onPatch={planState.patch}
              onSym={planState.setSym}
              onToParams={planState.toParams}
              onReset={planState.reset}
              onNodeKind={(kind) => planState.selection.length && planState.editPaths(setNodesKind(planShown.paths, planState.selection, kind), 'commit', planState.selection)}
              onCoordinate={(axis, value) => {
                const p = planSelected && planShown.paths[0]?.nodes[planSelected.node].p;
                if (planSelected && p) planState.editPaths(moveNodes(planShown.paths, [planSelected], axis === 0 ? [value - p[0], 0] : [0, value - p[1]]), 'commit', planState.selection);
              }}
              onHandle={(side, length, angle) => {
                if (!planSelected) return;
                const p = planShown.paths[0].nodes[planSelected.node].p;
                const a = (angle * Math.PI) / 180;
                planState.editPaths(moveHandle(planShown.paths, { ...planSelected, side }, [p[0] + length * Math.cos(a), p[1] + length * Math.sin(a)], false), 'commit', planState.selection);
              }}
              onGrid={(patch) => setGrid((g) => ({ ...g, ...patch }))}
              section={sectionControl}
            />
          ) : (
            <Sidebar
              draft={draft}
              selection={selection}
              holes={holes}
              grid={grid}
              sampling={sampling}
              boundFields={init.boundFields}
              section={sectionControl ?? undefined}
              onExtrusion={(mode) => commitDraft({ ...draft, extrusion: mode })}
              onLive={liveDraft}
              onPatch={(patch) => commitDraft({ ...draft, ...patch })}
              onKind={(kind: PathNode['kind']) => selection.length && commitPaths(setNodesKind(draft.paths, selection, kind), selection)}
              onRadius={(r) => {
                // Un nodo: il suo raggio; più nodi: lo stesso raggio a tutti gli spigoli compatibili, in un passo
                if (selection.length === 1 && selected) commitPaths(setNodeRadius(draft.paths, selected, r), selection);
                else if (selection.length > 1) commitPaths(setNodesRadius(draft.paths, selection, r), selection);
              }}
              onCoordinate={(axis, value) => {
                const p = selected && draft.paths[selected.path].nodes[selected.node].p;
                if (selected && p) commitPaths(moveNodesConstrained(draft.paths, draft.constraints, [selected], axis === 0 ? [value - p[0], 0] : [0, value - p[1]]), selection);
              }}
              onHandle={setHandle}
              onGrid={(patch) => setGrid((g) => ({ ...g, ...patch }))}
              onSelectPath={(i) => dispatch({ type: 'select', selection: draft.paths[i].nodes.map((_, node) => ({ path: i, node })) })}
              onClosePath={(i) => commitPaths(closeContour(draft.paths, i))}
              onDeletePath={(i) => commitDraft(normalizeProfile({ ...draft, paths: draft.paths.filter((_, k) => k !== i) }), [])}
              quote={{ auto: autoConstraints, onAuto: (v) => setSettings({ profileAutoConstraints: v }), can, selectionText: selectionText ? `${selectionText} ${items.nodes.length + items.segments.length === 1 ? 'scelto' : 'scelti'}.` : '', bad: diag?.bad ?? NONE, selected: selCon, onSelect: selectConstraint, group, onGroupValue: (v) => applyResult(setCommonValue(stateRef.current.draft, group, v)), onEqualize: () => applyResult(equalizeLengths(stateRef.current.draft, group)), onApply: applyConstraintButton, onValue: setConstraintValueFromPanel, onDelete: deleteConstraint, onReposition: repositionQuotes }}
            />
          )}
        </div>
        <footer className="profile-editor__footer">
          <div className="profile-editor__status" aria-live="polite">
            <span className="profile-editor__chip">
              {validContours.length} {validContours.length === 1 ? 'contorno' : 'contorni'}, {nodeCount} {nodeCount === 1 ? 'nodo' : 'nodi'}
            </span>
            {!validContours.length && <span className="profile-editor__chip profile-editor__chip--warn">Servono almeno 2 nodi per un contorno</span>}
            {chips.map((c) => (
              <span key={c.text} className={`profile-editor__chip profile-editor__chip--${c.kind}`}>
                {c.text}
                {c.action && (
                  <button type="button" className="profile-editor__chip-action" onClick={c.action.run}>
                    {c.action.label}
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="modal__actions">
            <button type="button" className="modal__button" onClick={() => void askClose()}>
              Annulla
            </button>
            <button type="button" className="modal__button modal__button--primary" disabled={!canApply} onClick={apply}>
              OK
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
