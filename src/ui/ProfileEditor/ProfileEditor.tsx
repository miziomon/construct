import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { selfIntersections } from '../../scene/bezier';
import { hasBoundDimension } from '../../scene/resize';
import { useSceneStore } from '../../scene/store';
import type { PathContour, PathNode } from '../../scene/types';
import { Modal } from '../Modal/Modal';
import { confirmDialog, notify } from '../notify/notifyStore';
import { DrawingCanvas } from './DrawingCanvas';
import type { GridSettings } from './DrawingCanvas';
import { clearDraft, flushDrafts, loadDraft, saveDraft } from './draft';
import { createHistory } from './history';
import type { History } from './history';
import { deleteNodes, draftContours, draftFromNode, emptyDraft, moveNodes, pathCenter, setNodeKind } from './model';
import type { Draft, NodeRef } from './model';
import { useProfileEditor } from './profileEditorStore';
import type { ProfileTarget } from './profileEditorStore';
import { Sidebar } from './Sidebar';
import './ProfileEditor.scss';

/** Stato del disegno: i contorni e i parametri (Draft) e i nodi selezionati. La cronologia sta a parte (vedi `createHistory`). */
interface EditorState {
  draft: Draft;
  selection: NodeRef[];
}

type Action =
  | { type: 'replace'; draft: Draft; selection?: NodeRef[] }
  | { type: 'paths'; paths: PathContour[]; selection?: NodeRef[] }
  | { type: 'select'; selection: NodeRef[] };

// Il reducer è puro: la cronologia (con i suoi effetti) si aggiorna fuori, nei gestori degli eventi
function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'replace':
      return { draft: action.draft, selection: action.selection ?? state.selection };
    case 'paths':
      return { draft: { ...state.draft, paths: action.paths }, selection: action.selection ?? state.selection };
    case 'select':
      return { ...state, selection: action.selection };
  }
}

/** Aggancio e griglia iniziali: passo di 1 mm, a griglia e a nodi (la sidebar completa li renderà modificabili). */
const GRID: GridSettings = { step: 1, snapGrid: true, snapNodes: true };

/** Vero se il tasto va alla casella di testo che ha il focus (le scorciatoie della modale restano inattive). */
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/** Chip di stato nel piede. */
interface Chip {
  kind: 'ok' | 'warn' | 'err';
  text: string;
}

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
    };
  });

  const [state, dispatch] = useReducer(reducer, { draft: init.draft, selection: [] } satisfies EditorState);
  const { draft, selection } = state;
  const stateRef = useRef(state);
  const history = useRef<History<Draft>>(null);
  if (!history.current) {
    history.current = createHistory<Draft>();
    history.current.reset(init.draft);
  }
  const root = useRef<HTMLDivElement>(null);
  const spaceDown = useRef(false);
  // Vero finché si decide se ripristinare la bozza: finché non si decide non si salva nulla
  const [ready, setReady] = useState(false);
  const confirming = useRef(false);
  const dirty = draft !== init.draft;

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

  // --- Modifiche ------------------------------------------------------------------------------------------------------
  /** Modifica conclusa: un passo della cronologia locale. */
  const commitDraft = (next: Draft, nextSelection?: NodeRef[]) => {
    history.current!.push(next);
    dispatch({ type: 'replace', draft: next, selection: nextSelection });
  };
  const commitPaths = (paths: PathContour[], nextSelection: NodeRef[] = stateRef.current.selection) => commitDraft({ ...stateRef.current.draft, paths }, nextSelection);
  const undo = () => {
    const prev = history.current!.undo();
    if (prev) dispatch({ type: 'replace', draft: prev, selection: [] });
  };
  const redo = () => {
    const next = history.current!.redo();
    if (next) dispatch({ type: 'replace', draft: next, selection: [] });
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
  const validContours = draft.paths.filter((c) => c.nodes.length >= 2);
  const nodeCount = draft.paths.reduce((n, c) => n + c.nodes.length, 0);
  // OK solo con almeno un contorno che il kernel riempie davvero
  const canApply = contours.length > 0;

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
    // Esc: la gestiamo noi (conferma se c'è del lavoro) e il dialog non deve chiudersi da solo; in un campo di testo
    // basta l'annullamento del campo
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!isTyping(e.target)) void askClose();
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
    const sel = stateRef.current.selection;
    if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      if (sel.length) commitPaths(deleteNodes(stateRef.current.draft.paths, sel), []);
    } else if (key.startsWith('arrow')) {
      // Frecce: un passo di griglia (Maiusc: dieci)
      e.preventDefault();
      if (!sel.length) return;
      const step = GRID.step * (e.shiftKey ? 10 : 1);
      const delta: [number, number] = key === 'arrowleft' ? [-step, 0] : key === 'arrowright' ? [step, 0] : key === 'arrowup' ? [0, step] : [0, -step];
      commitPaths(moveNodes(stateRef.current.draft.paths, sel, delta));
    } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
      // Spazio: panoramica finché è premuto
      e.preventDefault();
      spaceDown.current = true;
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ') spaceDown.current = false;
  };

  // --- Sidebar --------------------------------------------------------------------------------------------------------
  const single = selection.length === 1 ? draft.paths[selection[0].path]?.nodes[selection[0].node] ?? null : null;
  const selected = selection.length === 1 ? selection[0] : null;

  // --- Piede ----------------------------------------------------------------------------------------------------------
  const chips: Chip[] = [];
  if (init.bound.is) chips.push({ kind: 'warn', text: `Le misure sono legate a un parametro: il disegno viene scalato a ${Math.round(init.bound.width * 100) / 100} × ${Math.round(init.bound.depth * 100) / 100}` });
  if (draft.extrusion === 'linear' && validContours.some((c) => !c.closed)) chips.push({ kind: 'warn', text: 'Contorno aperto: in estrusione lineare si chiude con un segmento retto' });
  if (crossings.length) chips.push({ kind: 'err', text: `${crossings.length} ${crossings.length === 1 ? 'autointersezione' : 'autointersezioni'}` });
  if (draft.extrusion === 'rotate' && contours.some((c) => c.some(([x]) => x < -1e-6))) chips.push({ kind: 'warn', text: 'Una parte sta oltre l\'asse e non viene ruotata' });
  const noArea = validContours.length - contours.length;
  if (noArea > 0) chips.push({ kind: 'warn', text: `${noArea} ${noArea === 1 ? 'contorno senza area' : 'contorni senza area'}: non entra nel solido` });
  if (!chips.length && contours.length) chips.push({ kind: 'ok', text: 'Nessun avviso' });

  if (!init.valid) return null;

  return (
    <Modal open title="Profilo" size="large" dismissable={false} onClose={() => void askClose()} onEscape={() => void askClose()}>
      <div ref={root} className="profile-editor" tabIndex={-1} onKeyDown={onKeyDown} onKeyUp={onKeyUp}>
        <div className="profile-editor__main">
          <DrawingCanvas
            draft={draft}
            contours={contours}
            crossings={crossings}
            selection={selection}
            grid={GRID}
            spaceDown={spaceDown}
            onLive={(paths, sel) => dispatch({ type: 'paths', paths, selection: sel })}
            onCommit={commitPaths}
            onSelect={(sel) => dispatch({ type: 'select', selection: sel })}
          />
          <Sidebar
            draft={draft}
            node={single}
            selectedCount={selection.length}
            onExtrusion={(mode) => commitDraft({ ...draft, extrusion: mode })}
            onKind={(kind: PathNode['kind']) => selected && commitPaths(setNodeKind(draft.paths, selected, kind), selection)}
            onCoordinate={(axis, value) => selected && single && commitPaths(moveNodes(draft.paths, [selected], axis === 0 ? [value - single.p[0], 0] : [0, value - single.p[1]]), selection)}
          />
        </div>
        <footer className="profile-editor__footer">
          <div className="profile-editor__status" aria-live="polite">
            <span className="profile-editor__chip">
              {validContours.length} {validContours.length === 1 ? 'contorno' : 'contorni'}, {nodeCount} {nodeCount === 1 ? 'nodo' : 'nodi'}
            </span>
            {!contours.length && <span className="profile-editor__chip profile-editor__chip--warn">Servono almeno 2 nodi per un contorno con un&apos;area</span>}
            {chips.map((c) => (
              <span key={c.text} className={`profile-editor__chip profile-editor__chip--${c.kind}`}>
                {c.text}
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
