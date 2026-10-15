import { PATH_MAX_TOLERANCE, PATH_MIN_TOLERANCE, sanitizePaths } from '../../scene/bezier';
import type { Draft } from './model';

/**
 * Bozza del disegno della modale del Profilo: si salva in localStorage mentre si disegna, per non perdere il lavoro se la
 * pagina si chiude per sbaglio. Una bozza per nodo (`construct:profile-draft:<id>`) e una per il Profilo nuovo (`:new`).
 * Il contenuto di localStorage non è fidato: `loadDraft` lo valida, e ogni accesso ammette che lo storage manchi o lanci.
 */

/** Attesa dopo l'ultima modifica prima di scrivere (ms). */
const SAVE_DELAY = 500;

/** Chiave di localStorage: `nodeId` null è il Profilo nuovo. */
const keyOf = (nodeId: string | null): string => `construct:profile-draft:${nodeId ?? 'new'}`;

/** Scritture in attesa, per chiave: il timer e la scrittura da fare (l'ultima modifica sostituisce la precedente). */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>();

/**
 * Salva la bozza dopo 500 ms dall'ultima chiamata (un trascinamento ne fa decine). I contorni con meno di 2 nodi (la Penna
 * ne ha appena iniziato uno) non si salvano: la validazione in lettura rifiuterebbe l'intera bozza.
 */
export function saveDraft(nodeId: string | null, draft: Draft, storage?: Pick<Storage, 'setItem'>): void {
  const key = keyOf(nodeId);
  clearTimeout(pending.get(key)?.timer);
  const write = () => {
    pending.delete(key);
    try {
      const clean: Draft = { ...draft, paths: draft.paths.filter((c) => c.nodes.length >= 2) };
      (storage ?? localStorage).setItem(key, JSON.stringify({ v: 1, draft: clean }));
    } catch {
      // Spazio esaurito o storage non disponibile: senza bozza si lavora lo stesso
    }
  };
  pending.set(key, { timer: setTimeout(write, SAVE_DELAY), write });
}

/** Scrive subito le bozze in attesa: alla chiusura della pagina o della modale non si perde l'ultima modifica. */
export function flushDrafts(): void {
  for (const { timer, write } of [...pending.values()]) {
    clearTimeout(timer);
    write();
  }
}

/** Numero finito entro l'intervallo (estremi inclusi). */
const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Bozza salvata, oppure null se non c'è o non è valida (JSON rovinato, contorni o parametri fuori dai limiti). */
export function loadDraft(nodeId: string | null, storage?: Pick<Storage, 'getItem'>): Draft | null {
  try {
    const text = (storage ?? localStorage).getItem(keyOf(nodeId));
    if (!text) return null;
    const data = JSON.parse(text) as { v?: unknown; draft?: Record<string, unknown> };
    const d = data?.draft;
    if (data?.v !== 1 || typeof d !== 'object' || d === null) return null;
    const paths = sanitizePaths(d.paths);
    if (!paths) return null;
    // Limiti larghi (quelli dei campi sono più stretti): servono solo a scartare dati rovinati
    if (!inRange(d.tolerance, PATH_MIN_TOLERANCE, PATH_MAX_TOLERANCE) || (d.extrusion !== 'linear' && d.extrusion !== 'rotate')) return null;
    if (!inRange(d.height, 0.01, 1e5) || !inRange(d.twist, -3600, 3600) || !inRange(d.scaleTop, 0, 1000) || !inRange(d.revolveAngle, 1, 360) || !inRange(d.revolveSegments, 3, 256)) return null;
    return { paths, tolerance: d.tolerance, extrusion: d.extrusion, height: d.height, twist: d.twist, scaleTop: d.scaleTop, revolveAngle: d.revolveAngle, revolveSegments: d.revolveSegments };
  } catch {
    // JSON non valido o storage non disponibile
    return null;
  }
}

/** Elimina la bozza e annulla la scrittura in attesa: senza questo un salvataggio tardivo la farebbe risorgere dopo OK o Annulla. */
export function clearDraft(nodeId: string | null, storage?: Pick<Storage, 'removeItem'>): void {
  const key = keyOf(nodeId);
  clearTimeout(pending.get(key)?.timer);
  pending.delete(key);
  try {
    (storage ?? localStorage).removeItem(key);
  } catch {
    // Storage non disponibile: nulla da eliminare
  }
}
