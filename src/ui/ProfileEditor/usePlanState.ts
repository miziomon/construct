import { useCallback, useRef, useState } from 'react';
import { breakPlan, DEFAULT_PLAN, planPaths, resetPlan, resetPlanToDefault, selectKind } from '../../scene/planShape';
import type { PlanDraft, PlanKind, PlanSym } from '../../scene/planShape';
import type { PathContour } from '../../scene/types';
import { createHistory } from './history';
import type { History } from './history';
import type { NodeRef } from './model';
import { applySymmetry, deletePlanNodes, symmetrizePlan } from './planEdit';

/**
 * Stato della sagoma nella modale del Profilo (sperimentale): la sagoma, i nodi selezionati e una cronologia propria
 * (Annulla e Ripeti valgono per vista). Come per il profilo, un gesto è un solo passo: durante il trascinamento la
 * sagoma cambia (`live`), al rilascio si chiude il passo (`settle`, o `commit` per le modifiche d'un colpo). Le modifiche
 * a mano dei nodi passano da `editPaths`: una forma parametrica diventa libera al primo ritocco, i contorni restano chiusi
 * e, con una simmetria, speculari.
 */
export function usePlanState(rtFor: (plan: PlanDraft) => number, initial: PlanDraft = DEFAULT_PLAN) {
  const [plan, setPlan] = useState<PlanDraft>(initial);
  const [selection, setSelection] = useState<NodeRef[]>([]);
  // Vero finché un gesto è in corso: il calcolo dell'anteprima usa una qualità ridotta
  const [dragging, setDragging] = useState(false);
  const history = useRef<History<PlanDraft>>(null);
  if (!history.current) {
    history.current = createHistory<PlanDraft>();
    history.current.reset(initial);
  }
  /** Ultimo stato concluso: è la base delle modifiche in corso (la simmetria si riporta rispetto a lui). */
  const committed = useRef(initial);
  const latest = useRef(initial);
  const pending = useRef(false);
  const rtRef = useRef(rtFor);
  rtRef.current = rtFor;

  const settle = useCallback(() => {
    if (!pending.current) return;
    pending.current = false;
    committed.current = latest.current;
    history.current!.push(latest.current);
    setDragging(false);
  }, []);

  const commit = (next: PlanDraft, sel?: NodeRef[]) => {
    settle();
    history.current!.push(next);
    committed.current = next;
    latest.current = next;
    setPlan(next);
    if (sel) setSelection(sel);
    setDragging(false);
  };
  /**
   * Modifica in corso. Con `track` (i cursori) il passo resta aperto e lo chiude `settle` al rilascio; i gesti sul
   * disegno no: li chiude il loro `commit`, un solo passo per gesto.
   */
  const live = (next: PlanDraft, sel?: NodeRef[], track = false) => {
    latest.current = next;
    if (track) pending.current = true;
    setPlan(next);
    if (sel) setSelection(sel);
    setDragging(true);
  };
  const restore = (next: PlanDraft | undefined) => {
    if (!next) return;
    committed.current = next;
    latest.current = next;
    setPlan(next);
    setSelection([]);
  };
  const undo = () => {
    settle();
    restore(history.current!.undo());
  };
  const redo = () => {
    settle();
    restore(history.current!.redo());
  };

  /** Contorno effettivo (mm) di un stato: quello che il disegno mostra. */
  const effective = (p: PlanDraft): PathContour | undefined => planPaths(p, rtRef.current(p)).paths[0];

  /**
   * Modifica dei nodi dal disegno. La forma parametrica diventa libera (un passo solo, con la modifica); il contorno
   * resta chiuso; con una simmetria le modifiche si riportano sugli speculari partendo dall'ultimo stato concluso.
   */
  const editPaths = (paths: PathContour[], mode: 'live' | 'commit', sel?: NodeRef[]) => {
    const base = committed.current;
    const rt = rtRef.current(base);
    const next = paths[0];
    if (!next) return;
    let contour: PathContour = { closed: true, nodes: next.nodes };
    const prev = effective(base);
    if (base.kind === 'free' && prev) contour = applySymmetry(prev, contour, base.sym);
    const broken = base.kind === 'free' ? base : breakPlan(base, rt);
    const out: PlanDraft = { ...broken, paths: [contour], refR: rt };
    if (mode === 'live') live(out, sel);
    else commit(out, sel);
  };

  /** Toglie i nodi selezionati (e i loro speculari). Falso se la forma scenderebbe sotto tre nodi. */
  const deleteSelected = (): boolean => {
    const base = committed.current;
    const contour = effective(base);
    if (!contour || !selection.length) return true;
    const out = deletePlanNodes(contour, selection.map((r) => r.node), base.kind === 'free' ? base.sym : 'none');
    if (!out) return false;
    const rt = rtRef.current(base);
    const broken = base.kind === 'free' ? base : breakPlan(base, rt);
    commit({ ...broken, paths: [out], refR: rt }, []);
    return true;
  };

  return {
    plan,
    selection,
    dragging,
    setSelection,
    committed,
    canUndo: history.current.canUndo(),
    canRedo: history.current.canRedo(),
    undo,
    redo,
    settle,
    live,
    commit,
    editPaths,
    deleteSelected,
    /** Parametri di una forma parametrica (cursori): in corso o conclusi. */
    patch: (patch: Partial<PlanDraft>, mode: 'live' | 'commit' = 'live') => (mode === 'live' ? live({ ...latest.current, ...patch }, undefined, true) : commit({ ...latest.current, ...patch })),
    setKind: (kind: PlanKind) => commit(selectKind(latest.current, kind, rtRef.current(latest.current)), []),
    setSym: (sym: PlanSym) => commit(symmetrizePlan(latest.current, rtRef.current(latest.current), sym), []),
    /** Forma di partenza rapida (Squircle, Esagono...): parametri e tipo di forma, senza nodi liberi. */
    preset: (p: Partial<PlanDraft>) => commit({ ...latest.current, ...p, paths: [], refR: 1, sym: 'none' }, []),
    /** Torna alla forma parametrica da cui si è partiti. */
    toParams: () => commit(resetPlan(latest.current), []),
    /** Reset: torna al cerchio con i parametri iniziali. */
    reset: () => commit(resetPlanToDefault(latest.current), []),
  };
}
