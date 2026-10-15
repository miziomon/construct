import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { samplePaths, selfIntersections } from '../../scene/bezier';
import { hasBoundDimension } from '../../scene/resize';
import { pathNaturalBox } from '../../scene/shapes2d';
import { useSceneStore } from '../../scene/store';
import type { PathContour, PathNode, Vec2 } from '../../scene/types';
import { Modal } from '../Modal/Modal';
import { confirmDialog, notify } from '../notify/notifyStore';
import { DrawingCanvas } from './DrawingCanvas';
import type { GridSettings, Tool } from './DrawingCanvas';
import { clearDraft, flushDrafts, loadDraft, saveDraft } from './draft';
import { createHistory } from './history';
import type { History } from './history';
import { canCloseContour, closeContour, deleteNodes, draftContours, draftFromNode, dropLastNode, emptyDraft, moveHandle, moveNodes, pathCenter, setNodeKind, trimDuplicateTail } from './model';
import type { Draft, NodeRef } from './model';
import { useProfileEditor } from './profileEditorStore';
import type { ProfileTarget } from './profileEditorStore';
import { ProfilePreview } from './ProfilePreview';
import type { PreviewMode } from './ProfilePreview';
import { Sidebar } from './Sidebar';
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
  | { type: 'replace'; draft: Draft; selection?: NodeRef[] }
  // Modifica in corso (trascinamento, Penna): `pen` cambia solo se indicato
  | { type: 'paths'; paths: PathContour[]; selection?: NodeRef[]; pen?: number | null }
  | { type: 'select'; selection: NodeRef[] }
  | { type: 'tool'; tool: Tool };

// Il reducer è puro: la cronologia (con i suoi effetti) si aggiorna fuori, nei gestori degli eventi
function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'replace':
      return { ...state, draft: action.draft, selection: action.selection ?? state.selection, pen: null };
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
  kind: 'ok' | 'warn' | 'err';
  text: string;
  action?: { label: string; run: () => void };
}

/** Numero con al più due decimali, per i messaggi. */
const fmt = (n: number) => String(Math.round(n * 100) / 100);

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
    const draft = path ? draftFromNode(path) : emptyDraft();
    return {
      valid: nodeId === null || !!path,
      draft,
      before: pathCenter(draft),
      // La scala è stata incorporata nei nodi: anche un OK senza modifiche deve scriverli
      baked: !!path && draft.paths !== path.paths,
      // Misure legate a un parametro: il disegno si scala alla misura della formula
      bound: path ? { is: hasBoundDimension(path), width: path.width, depth: path.depth } : { is: false, width: 0, depth: 0 },
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
  const [, setSettled] = useState(0);

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
    const stored = loadDraft(nodeId);
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
    committed.current = stateRef.current.draft;
    history.current!.push(stateRef.current.draft);
    // Passo concluso: l'anteprima si aggiorna subito (vedi `immediate` più sotto)
    setSettled((n) => n + 1);
    // Lo slider lascia il focus alla pagina al rilascio: senza un elemento attivo le scorciatoie della modale (Ctrl+Z, P) non arrivano
    if (document.activeElement === document.body) root.current?.focus();
  }, []);
  useEffect(() => {
    window.addEventListener('pointerup', settle);
    window.addEventListener('keyup', settle);
    return () => {
      window.removeEventListener('pointerup', settle);
      window.removeEventListener('keyup', settle);
    };
  }, [settle]);

  /** Modifica conclusa: un passo della cronologia locale. */
  const commitDraft = (next: Draft, nextSelection?: NodeRef[]) => {
    settle();
    history.current!.push(next);
    committed.current = next;
    dispatch({ type: 'replace', draft: next, selection: nextSelection });
  };
  const commitPaths = (paths: PathContour[], nextSelection: NodeRef[] = stateRef.current.selection) => commitDraft({ ...stateRef.current.draft, paths }, nextSelection);
  /** Modifica in corso di un parametro (slider): il disegno cambia subito, il passo si chiude al rilascio (`settle`). */
  const liveDraft = (patch: Partial<Draft>) => {
    finishPen();
    const next = { ...stateRef.current.draft, ...patch };
    stateRef.current = { ...stateRef.current, draft: next };
    pendingLive.current = true;
    dispatch({ type: 'replace', draft: next });
  };
  const undo = () => {
    // Con un contorno della Penna a metà, annulla quel contorno (non è ancora un passo)
    if (stateRef.current.pen !== null) {
      dispatch({ type: 'replace', draft: committed.current, selection: [] });
      return;
    }
    settle();
    const prev = history.current!.undo();
    if (prev) {
      committed.current = prev;
      dispatch({ type: 'replace', draft: prev, selection: [] });
    }
  };
  const redo = () => {
    settle();
    const next = history.current!.redo();
    if (next) {
      committed.current = next;
      dispatch({ type: 'replace', draft: next, selection: [] });
    }
  };

  // --- Penna ----------------------------------------------------------------------------------------------------------
  /** Contorni subito dopo la ripresa di un contorno: se alla fine sono ancora quelli, il disegno non è cambiato. */
  const resumedPaths = useRef<PathContour[] | null>(null);
  /** Termina il contorno della Penna in corso: un solo passo di cronologia per tutto il contorno. Con meno di 2 nodi sparisce. */
  const finishPen = () => {
    const { draft: current, pen: index } = stateRef.current;
    if (index === null) return;
    // Ripresa di un contorno senza aggiungere nulla (al più invertito): niente passo di cronologia
    if (resumedPaths.current === current.paths) {
      resumedPaths.current = null;
      dispatch({ type: 'replace', draft: committed.current, selection: [] });
      return;
    }
    const paths = trimDuplicateTail(current.paths, index);
    if ((paths[index]?.nodes.length ?? 0) < 2) {
      // Il contorno è l'unica cosa che la Penna aveva aggiunto: si torna all'ultimo disegno concluso
      dispatch({ type: 'replace', draft: committed.current, selection: [] });
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
    // Se il contorno sparisce la Penna non aveva aggiunto altro: si torna all'ultimo disegno concluso
    if (paths.length < current.paths.length) dispatch({ type: 'replace', draft: committed.current, selection: [] });
    else dispatch({ type: 'paths', paths, selection: [], pen: index });
  };
  const changeTool = (next: Tool) => {
    finishPen();
    dispatch({ type: 'tool', tool: next });
  };

  // --- Chiusura -------------------------------------------------------------------------------------------------------
  /** Annulla o Esc: se c'è qualcosa di non salvato chiede conferma; una richiesta alla volta. */
  const askClose = async () => {
    if (confirming.current) return;
    confirming.current = true;
    try {
      if (stateRef.current.draft !== init.draft && !(await confirmDialog('Chiudere senza salvare il profilo?', 'Chiudi'))) return;
      clearDraft(nodeId);
      close();
    } finally {
      confirming.current = false;
    }
  };

  const contours = useMemo(() => draftContours(draft), [draft]);
  const crossings = useMemo(() => selfIntersections(contours), [contours]);
  const sampling = useMemo(() => {
    const sampled = samplePaths(draft.paths, draft.tolerance);
    return { points: sampled.contours.reduce((n, c) => n + c.points.length, 0), tolerance: sampled.tolerance, capped: sampled.capped };
  }, [draft.paths, draft.tolerance]);
  const validContours = draft.paths.filter((c) => c.nodes.length >= 2);
  const nodeCount = draft.paths.reduce((n, c) => n + c.nodes.length, 0);
  // OK solo con almeno un contorno che il kernel riempie davvero
  const canApply = contours.length > 0;
  // Durante un trascinamento il disegno non è ancora un passo concluso: l'anteprima si aggiorna al più ogni 100 ms; al rilascio subito
  const preview = usePreviewMesh(draft, init.node, init.size, draft === committed.current, canApply);

  /** OK: applica il disegno alla scena (un solo passo) e chiude. */
  const apply = () => {
    if (!canApply) return;
    // I contorni con un solo nodo (un tratto appena iniziato) non descrivono nulla
    const final: Draft = { ...draft, paths: validContours };
    if (nodeId) {
      // Senza modifiche e senza scala da incorporare non c'è niente da scrivere
      if (dirty || init.baked) {
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
    else if (key === 'enter') {
      // Invio termina il contorno della Penna (sui pulsanti conserva il suo significato)
      if (penIndex !== null && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        finishPen();
      }
    } else if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      if (penIndex !== null) penBackspace();
      else if (sel.length && stateRef.current.tool === 'select') commitPaths(deleteNodes(stateRef.current.draft.paths, sel), []);
    } else if (key.startsWith('arrow')) {
      // Frecce: un passo di griglia (Maiusc: dieci)
      e.preventDefault();
      if (!sel.length || stateRef.current.tool !== 'select') return;
      const step = grid.step * (e.shiftKey ? 10 : 1);
      const sx = draft.extrusion === 'rotate' && flipX ? -1 : 1;
      const delta: Vec2 = key === 'arrowleft' ? [-step * sx, 0] : key === 'arrowright' ? [step * sx, 0] : key === 'arrowup' ? [0, step] : [0, -step];
      commitPaths(moveNodes(stateRef.current.draft.paths, sel, delta));
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
  if (!chips.length && contours.length) chips.push({ kind: 'ok', text: 'Nessun avviso' });

  if (!init.valid) return null;

  return (
    <Modal open title="Profilo" size="large" dismissable={false} onClose={() => void askClose()} onEscape={() => void askClose()}>
      <div ref={root} className="profile-editor" tabIndex={-1} onKeyDown={onKeyDown} onKeyUp={onKeyUp}>
        <div className={`profile-editor__main profile-editor__main--preview-${previewMode}`}>
          <DrawingCanvas
            draft={draft}
            contours={contours}
            crossings={crossings}
            selection={selection}
            grid={grid}
            spaceDown={spaceDown}
            tool={tool}
            onTool={changeTool}
            flip={draft.extrusion === 'rotate' && flipX}
            onFlip={() => setFlipX((f) => !f)}
            pen={pen}
            onLive={(paths, sel) => dispatch({ type: 'paths', paths, selection: sel })}
            onCommit={commitPaths}
            onSelect={(sel) => dispatch({ type: 'select', selection: sel })}
            onPenLive={(paths, current, sel) => dispatch({ type: 'paths', paths, selection: sel, pen: current })}
            onPenResume={(paths, current, sel) => {
              resumedPaths.current = paths;
              dispatch({ type: 'paths', paths, selection: sel, pen: current });
            }}
            onPenClose={closePen}
            onPenFinish={finishPen}
            onPenLimit={() => notify.info('Limite raggiunto: al massimo 500 nodi per contorno e 100 contorni. Termina il contorno (Invio) o chiudilo')}
          />
          <ProfilePreview {...preview} mode={previewMode} onMode={setPreviewMode} fitSignal={fitSignal} onFit={() => setFitSignal((n) => n + 1)} />
          <Sidebar
            draft={draft}
            selection={selection}
            grid={grid}
            sampling={sampling}
            onExtrusion={(mode) => commitDraft({ ...draft, extrusion: mode })}
            onLive={liveDraft}
            onPatch={(patch) => commitDraft({ ...draft, ...patch })}
            onKind={(kind: PathNode['kind']) => selected && commitPaths(setNodeKind(draft.paths, selected, kind), selection)}
            onCoordinate={(axis, value) => {
              const p = selected && draft.paths[selected.path].nodes[selected.node].p;
              if (selected && p) commitPaths(moveNodes(draft.paths, [selected], axis === 0 ? [value - p[0], 0] : [0, value - p[1]]), selection);
            }}
            onHandle={setHandle}
            onGrid={(patch) => setGrid((g) => ({ ...g, ...patch }))}
            onSelectPath={(i) => dispatch({ type: 'select', selection: draft.paths[i].nodes.map((_, node) => ({ path: i, node })) })}
            onClosePath={(i) => commitPaths(closeContour(draft.paths, i))}
            onDeletePath={(i) => commitPaths(draft.paths.filter((_, k) => k !== i), [])}
          />
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
