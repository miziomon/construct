import { dragSketch, maxResidual, solveSketch, validateValue } from './constraints';
import type { ConstraintType, Pt, Report } from './constraints';
import { dimensionValue, isDimension, placeDimension, pointMap, pointsOf } from './dimPlacement';
import { constraintIdMaker, moveNodes } from './model';
import type { NodeRef, ProfileGeometry } from './model';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';

/**
 * Quote e vincoli del Profilo (tappa 2a dello studio quote): la logica pura tra il disegno (`PathContour[]` con nodi con
 * id) e il risolutore (`constraints.ts`). Nessun componente qui dentro: la modale chiama queste funzioni e fa il passo di
 * cronologia. Tutte le funzioni sono immutabili. I vincoli citano i nodi per id (B1): chi chiama deve avere dato gli id
 * (`normalizeProfile`) prima di creare un vincolo.
 *
 * Regola di fondo: il disegno si risolve SOLO quando l'utente aggiunge o cambia un vincolo o una quota, o rilascia un
 * trascinamento; mai al caricamento (le coordinate salvate sono già la soluzione).
 */

// La geometria delle quote (posizione, testo, disposizione automatica) sta in dimPlacement.ts: da qui si riesporta
export { DIM_GAP_PX, dimLayout, dimText, dimensionValue, dragDimension, fmtDim, isDimension, isLinearDimension, pillWidthPx, placeDimension, pointMap, pointsOf, repositionDimensions } from './dimPlacement';
export type { DimLayout } from './dimPlacement';

/** Come si misura una quota di lunghezza: allineata ai due nodi, solo in orizzontale (distX) o solo in verticale (distY). */
export type DimMode = 'len' | 'h' | 'v';

/** Nomi dei tipi di vincolo, come nell'elenco del pannello. */
export const CONSTRAINT_NAMES: Record<ConstraintType, string> = {
  fixed: 'Fisso',
  horizontal: 'Orizzontale',
  vertical: 'Verticale',
  coincident: 'Coincidente',
  dist: 'Distanza',
  distX: 'Distanza X',
  distY: 'Distanza Y',
  angle: 'Angolo',
  parallel: 'Parallelo',
  perpendicular: 'Perpendicolare',
  equal: 'Uguale',
  midpoint: 'Punto medio',
  collinear: 'Collineare',
  symmetric: 'Simmetrico',
};

/** Sigla dentro l'icona di un vincolo geometrico sul disegno. */
export const CONSTRAINT_GLYPHS: Record<ConstraintType, string> = {
  fixed: 'F',
  horizontal: 'H',
  vertical: 'V',
  coincident: '●',
  dist: '↔',
  distX: '↔',
  distY: '↕',
  angle: '∠',
  parallel: '∥',
  perpendicular: '⊥',
  equal: '=',
  midpoint: 'M',
  collinear: '≡',
  symmetric: 'S',
};

/** Vincoli che si creano dalla selezione di nodi nella modale (le quote si creano con lo strumento Quota). */
export const SELECTION_CONSTRAINTS = ['horizontal', 'vertical', 'fixed', 'coincident'] as const;
export type SelectionConstraint = (typeof SELECTION_CONSTRAINTS)[number];

// --- Punti del risolutore ---------------------------------------------------------------------------------------------

/** Nome leggibile dei nodi (P1.2 = secondo nodo del primo percorso): è quello del pannello, come nei contorni dell'elenco Percorsi. */
export function nodeNames(paths: PathContour[]): Map<string, string> {
  return new Map(paths.flatMap((c, pi) => c.nodes.flatMap((n, ni): [string, string][] => (n.id ? [[n.id, `P${pi + 1}.${ni + 1}`]] : []))));
}

/** Id dei nodi indicati (quelli senza id non ci sono: per citarli serve prima `normalizeProfile`). */
export function idsOf(paths: PathContour[], refs: NodeRef[]): string[] {
  return refs.flatMap((r) => {
    const id = paths[r.path]?.nodes[r.node]?.id;
    return id ? [id] : [];
  });
}

/** I vincoli che il risolutore può leggere: tutti i punti citati esistono (un nodo cancellato non lascia vincoli, ma un file rovinato sì). */
export function validConstraints(paths: PathContour[], constraints: ProfileConstraint[] | undefined): ProfileConstraint[] {
  if (!constraints?.length) return [];
  const ids = pointMap(paths);
  return constraints.filter((c) => c.p.every((id) => ids.has(id)));
}

/**
 * Scrive nei nodi le posizioni risolte. I nodi che non si muovono restano gli stessi oggetti (e se nulla si muove il
 * risultato è lo stesso array): le cache e i confronti per identità non vedono cambiamenti inutili.
 */
export function writeBack(paths: PathContour[], points: Pt[]): PathContour[] {
  const solved = new Map(points.map((q) => [q.id, q]));
  let changed = false;
  const next = paths.map((c) => {
    let touched = false;
    const nodes = c.nodes.map((n) => {
      const q = n.id ? solved.get(n.id) : undefined;
      // `|| 0` toglie il -0
      if (!q || (Math.abs(q.x - n.p[0]) < 1e-12 && Math.abs(q.y - n.p[1]) < 1e-12)) return n;
      touched = true;
      return { ...n, p: [q.x || 0, q.y || 0] as Vec2 };
    });
    if (!touched) return c;
    changed = true;
    return { ...c, nodes };
  });
  return changed ? next : paths;
}

// --- Diagnosi ---------------------------------------------------------------------------------------------------------

/** Stato di un nodo: `free` ha ancora gradi di libertà, `def` è completamente vincolato, `err` è in un vincolo in conflitto o ridondante. */
export type NodeState = 'free' | 'def' | 'err';

export interface Diagnosis {
  report: Report;
  /** Stato di ogni nodo con id. */
  states: Map<string, NodeState>;
  /** Id dei vincoli in conflitto o ridondanti. */
  bad: Set<string>;
}

/** Diagnosi del disegno così com'è (senza modificarlo), oppure null se non ci sono vincoli. Costa un po': non va chiamata a ogni fotogramma di un trascinamento. */
export function diagnose(d: ProfileGeometry): Diagnosis | null {
  const constraints = validConstraints(d.paths, d.constraints);
  if (!constraints.length) return null;
  const report = solveSketch(pointsOf(d.paths), constraints);
  const bad = new Set([...report.conflicting, ...report.redundant]);
  const err = new Set(constraints.filter((c) => bad.has(c.id)).flatMap((c) => c.p));
  const free = new Set(report.free);
  const states = new Map<string, NodeState>();
  for (const q of report.points) states.set(q.id, err.has(q.id) ? 'err' : free.has(q.id) ? 'free' : 'def');
  return { report, states, bad };
}

/** Testo dello stato per il piede e il pannello. */
export function stateText(report: Report): { kind: 'info' | 'ok' | 'warn' | 'err'; text: string } {
  if (report.state === 'over') {
    const parts = [report.conflicting.length ? `${report.conflicting.length} in conflitto` : '', report.redundant.length ? `${report.redundant.length} ridondanti` : '', report.converged ? '' : 'non risolvibile'];
    return { kind: 'err', text: `Sovravincolato: ${parts.filter(Boolean).join(', ')}` };
  }
  if (report.state === 'unsolved') return { kind: 'warn', text: 'Non risolto: il risolutore si è fermato, nessun conflitto dimostrato' };
  if (report.state === 'full') return { kind: 'ok', text: 'Completamente vincolato: 0 gradi di libertà' };
  return { kind: 'info', text: `Sottovincolato: ${report.dof} ${report.dof === 1 ? 'grado' : 'gradi'} di libertà` };
}

/** Scarto (mm) sotto cui le quote si considerano rispettate: quello dell'arrotondamento a 4 decimali dei nodi al salvataggio (§3 dello studio). */
export const QUOTE_TOLERANCE = 2e-4;

/**
 * Di quanto il disegno si discosta dalle sue quote e dai suoi vincoli (scarto massimo dei vincoli pilotanti), oppure null se
 * li rispetta entro `QUOTE_TOLERANCE`. Succede dopo un ridimensionamento (la scala è nei nodi, non nei valori) o con un file
 * modificato a mano: la prima modifica risolverebbe e farebbe tornare i nodi alle quote. Non risolve nulla.
 */
export function quoteMismatch(d: ProfileGeometry): number | null {
  const constraints = validConstraints(d.paths, d.constraints);
  if (!constraints.length) return null;
  const residual = maxResidual(pointsOf(d.paths), constraints);
  return residual > QUOTE_TOLERANCE ? residual : null;
}

// --- Aggiunta e modifica -----------------------------------------------------------------------------------------------

/** Esito di un'aggiunta o modifica: il disegno nuovo (già risolto), oppure il perché non si è applicata e i vincoli da evidenziare. */
export type Applied<T> = { ok: true; draft: T; report: Report } | { ok: false; message: string; ids: string[]; reason?: 'conflict' | 'redundant' | 'unsolved' | 'invalid' };

const UNSOLVED = 'Il risolutore non è arrivato a una soluzione (non è detto che ci sia un conflitto): prova un valore più vicino a quello attuale.';

/** Descrizione breve di un vincolo, per i messaggi e il pannello: «Lunghezza P1.1-P1.2». */
export function describeConstraint(c: ProfileConstraint, names: Map<string, string>): string {
  return `${CONSTRAINT_NAMES[c.t]} ${c.p.map((id) => names.get(id) ?? '?').join('-')}`;
}

/** Fino a tre vincoli per nome, per dire con quali va in conflitto quello nuovo. */
function namesOf(ids: string[], list: ProfileConstraint[], names: Map<string, string>): string {
  return ids
    .flatMap((id) => {
      const c = list.find((x) => x.id === id);
      return c ? [describeConstraint(c, names)] : [];
    })
    .slice(0, 3)
    .join(', ');
}

/** Frasi dei rifiuti, diverse per un vincolo nuovo, una quota nuova, un valore cambiato, un Fisso su più nodi. */
interface Messages {
  /** `who` = i vincoli con cui va in conflitto (può essere vuoto). */
  conflict: (who: string) => string;
  redundant: string;
}

const messagesFor = (what: 'Vincolo' | 'Quota'): Messages => ({
  conflict: (who) => `${what} in conflitto con ${who || 'gli altri vincoli'}: non applicato`,
  redundant: `${what} ridondante: il disegno è già vincolato da altri vincoli, non applicato`,
});

/**
 * Risolve il disegno con l'elenco di vincoli dato, dalla configurazione attuale. `added` = il vincolo appena aggiunto (se
 * è ridondante o in conflitto non si applica), `strict` = qualunque ridondanza rifiuta (usato dal Fisso su più nodi).
 * Non applicato = il disegno resta com'era (chi chiama non tocca nulla).
 */
function solveWith<T extends ProfileGeometry>(d: T, list: ProfileConstraint[], added: ProfileConstraint | null, messages: Messages, strict = false): Applied<T> {
  const next: T = { ...d, constraints: list };
  const rep = solveSketch(pointsOf(d.paths), validConstraints(d.paths, list));
  if (rep.unsolved) return { ok: false, message: UNSOLVED, ids: [], reason: 'unsolved' };
  if (!rep.converged || rep.conflicting.length) {
    const others = rep.conflicting.filter((id) => id !== added?.id);
    return { ok: false, message: messages.conflict(namesOf(others, list, nodeNames(d.paths))), ids: others, reason: 'conflict' };
  }
  if ((added && rep.redundant.includes(added.id)) || (strict && rep.redundant.length)) return { ok: false, message: messages.redundant, ids: [], reason: 'redundant' };
  return { ok: true, draft: { ...next, paths: writeBack(d.paths, rep.points) }, report: rep };
}

/**
 * Aggiunge un vincolo o una quota e risolve. Se il disegno diventa sovravincolato (conflitto o ridondanza) o il risolutore
 * non arriva a una soluzione, NON si applica (in questa fase non c'è ancora la quota di riferimento).
 */
export function addConstraint<T extends ProfileGeometry>(d: T, con: Omit<ProfileConstraint, 'id'> & { id?: string }): Applied<T> {
  const list = d.constraints ?? [];
  const id = con.id ?? constraintIdMaker(list)();
  const added: ProfileConstraint = { ...con, id };
  return solveWith(d, [...list, added], added, messagesFor(isDimension(added) ? 'Quota' : 'Vincolo'));
}

/** Fissa i nodi dati nella posizione attuale (quelli già fissi si saltano). Tutti o nessuno: se il disegno diventa sovravincolato non si applica. */
export function addFixed<T extends ProfileGeometry>(d: T, ids: string[]): Applied<T> {
  const list = d.constraints ?? [];
  const already = new Set(list.filter((c) => c.t === 'fixed').map((c) => c.p[0]));
  const pm = pointMap(d.paths);
  const targets = [...new Set(ids)].filter((id) => pm.has(id) && !already.has(id));
  if (!targets.length) return { ok: false, message: 'I nodi scelti sono già fissi', ids: [] };
  const fresh = constraintIdMaker(list);
  const added = targets.map((id): ProfileConstraint => ({ id: fresh(), t: 'fixed', p: [id], x: pm.get(id)![0], y: pm.get(id)![1] }));
  const over = 'Fissare questi nodi renderebbe il disegno sovravincolato';
  return solveWith(d, [...list, ...added], null, { conflict: () => over, redundant: over }, true);
}

/** Un vincolo si può creare con tanti nodi scelti? Due per orizzontale, verticale e coincidente; almeno uno per fisso. */
export function canApplyConstraint(type: SelectionConstraint, count: number): boolean {
  return type === 'fixed' ? count >= 1 : count === 2;
}

/** Crea il vincolo scelto dai nodi indicati (id), oppure spiega perché non si può. */
export function addSelectionConstraint<T extends ProfileGeometry>(d: T, type: SelectionConstraint, ids: string[]): Applied<T> {
  if (!canApplyConstraint(type, ids.length) || new Set(ids).size !== ids.length) return { ok: false, message: type === 'fixed' ? 'Scegli almeno un nodo' : 'Scegli due nodi diversi', ids: [] };
  return type === 'fixed' ? addFixed(d, ids) : addConstraint(d, { t: type, p: [ids[0], ids[1]] });
}

/** Cambia il valore di una quota e risolve; se il valore non è ammesso o non è raggiungibile il disegno resta com'era. */
export function setConstraintValue<T extends ProfileGeometry>(d: T, id: string, value: number): Applied<T> {
  const list = d.constraints ?? [];
  const con = list.find((c) => c.id === id);
  if (!con || !isDimension(con) || con.ref) return { ok: false, message: 'Questa quota non ha un valore da cambiare', ids: [], reason: 'invalid' };
  const invalid = validateValue(con.t, value);
  if (invalid) return { ok: false, message: invalid, ids: [], reason: 'invalid' };
  const edited: ProfileConstraint = { ...con, v: value };
  // Per una modifica la frase è «Valore non raggiungibile» (la quota c'era già); il valore uguale all'attuale non è mai ridondante
  const messages: Messages = { conflict: (who) => `Valore non raggiungibile: va in conflitto con ${who || 'i vincoli'}`, redundant: 'Valore non raggiungibile: il disegno è già vincolato da altri vincoli' };
  return solveWith(d, list.map((c) => (c.id === id ? edited : c)), edited, messages);
}

/** Toglie un vincolo o una quota. Non risolve (togliere un vincolo non può sovravincolare): il disegno resta dov'è. Senza più vincoli il campo non c'è. */
export function removeConstraint<T extends ProfileGeometry>(d: T, id: string): T {
  const list = (d.constraints ?? []).filter((c) => c.id !== id);
  const next: T = { ...d };
  if (list.length) next.constraints = list;
  else delete next.constraints;
  return next;
}

// --- Creazione di una quota di lunghezza ---------------------------------------------------------------------------------

/**
 * Nuova quota tra due nodi (id), con il valore che hanno adesso e la posizione della linea di quota scelta da
 * `placeDimension`: fuori dal disegno, dalla parte opposta al baricentro, a `DIM_GAP_PX` pixel e più lontano se l'etichetta
 * si sovrapporrebbe al disegno o a una quota già posizionata (`existing`). `pxPerMm` è lo zoom. Non risolve e non assegna
 * l'id: è la proposta che l'utente conferma digitando il valore. Restituisce un messaggio se i due nodi coincidono sull'asse scelto.
 */
export function createDimension(paths: PathContour[], mode: DimMode, idA: string, idB: string, pxPerMm: number, existing: ProfileConstraint[] = []): Omit<ProfileConstraint, 'id'> | string {
  const pm = pointMap(paths);
  const a = pm.get(idA);
  const b = pm.get(idB);
  if (!a || !b || idA === idB) return 'Scegli due nodi diversi';
  let dim: Omit<ProfileConstraint, 'id'>;
  if (mode === 'len') {
    const v = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (v < 1e-6) return 'I due nodi sono nello stesso punto: prima separali';
    dim = { t: 'dist', p: [idA, idB], v };
  } else if (mode === 'h') {
    const v = Math.abs(b[0] - a[0]);
    if (v < 1e-6) return 'I due nodi hanno la stessa x: prima separali';
    dim = { t: 'distX', p: [idA, idB], s: b[0] >= a[0] ? 1 : -1, v };
  } else {
    const v = Math.abs(b[1] - a[1]);
    if (v < 1e-6) return 'I due nodi hanno la stessa y: prima separali';
    dim = { t: 'distY', p: [idA, idB], s: b[1] >= a[1] ? 1 : -1, v };
  }
  return { ...dim, ...placeDimension(paths, existing, dim as ProfileConstraint, pxPerMm) };
}

/**
 * Aggiunge una quota di riferimento: mostra la misura attuale (tra parentesi sul disegno), non entra nel risolutore e non si
 * modifica. Serve quando una quota nuova sarebbe ridondante o in conflitto con le altre. Non risolve: il disegno non cambia.
 */
export function addReferenceDimension<T extends ProfileGeometry>(d: T, con: Omit<ProfileConstraint, 'id'>): T {
  const list = d.constraints ?? [];
  const id = constraintIdMaker(list)();
  const ref: ProfileConstraint = { ...con, id, ref: true };
  // La misura che ha adesso (positiva per le distanze); `v` resta come promemoria, il disegno la rilegge sempre
  const measured = dimensionValue({ ...ref, v: undefined }, d.paths);
  return { ...d, constraints: [...list, { ...ref, v: measured }] };
}

// --- Trascinamento -----------------------------------------------------------------------------------------------------

/** Un nodo trascinato e il punto (mm) in cui il mouse lo vuole. */
export interface DragTarget {
  ref: NodeRef;
  to: Vec2;
}

/**
 * Un fotogramma di trascinamento. `current` è il disegno dell'ultimo fotogramma. Senza vincoli i nodi vanno dove dice il mouse.
 * Con vincoli i nodi con id seguono `dragSketch` (prima rigido, poi morbido: vedi constraints.ts) e i nodi che il mouse non
 * porta si adattano; i nodi senza id (nessun vincolo li cita) vanno liberi. `soft` = un fotogramma precedente ha dovuto
 * rinunciare al tentativo rigido: il resto del trascinamento è morbido. `paths` è null se il fotogramma non si risolve (si salta).
 */
export function dragFrame(current: PathContour[], constraints: ProfileConstraint[] | undefined, targets: DragTarget[], soft: boolean): { paths: PathContour[] | null; soft: boolean } {
  // Posizione libera dei nodi trascinati
  const where = new Map(targets.map((t) => [`${t.ref.path}:${t.ref.node}`, t.to]));
  const moved = current.map((c, pi) => (c.nodes.some((_, ni) => where.has(`${pi}:${ni}`)) ? { ...c, nodes: c.nodes.map((n, ni) => (where.has(`${pi}:${ni}`) ? { ...n, p: where.get(`${pi}:${ni}`)! } : n)) } : c));
  const cons = validConstraints(current, constraints);
  const moves: Record<string, Vec2> = {};
  for (const t of targets) {
    const id = current[t.ref.path]?.nodes[t.ref.node]?.id;
    if (id) moves[id] = t.to;
  }
  if (!cons.length || !Object.keys(moves).length) return { paths: moved, soft };
  const rep = dragSketch(pointsOf(current), cons, moves, soft);
  const nextSoft = soft || !rep.pinned;
  // Un fotogramma quasi risolto (sotto 1e-4 mm, invisibile) si accetta; altrimenti il disegno resta com'era
  return { paths: rep.residual < 1e-4 ? writeBack(moved, rep.points) : null, soft: nextSoft };
}

/** Dopo il trascinamento: si porta il disegno alla precisione piena. Senza vincoli, o se non converge, resta com'è. */
export function settlePaths(paths: PathContour[], constraints: ProfileConstraint[] | undefined): PathContour[] {
  const cons = validConstraints(paths, constraints);
  if (!cons.length) return paths;
  const rep = solveSketch(pointsOf(paths), cons, { diagnose: false, maxIter: 300 });
  return rep.converged ? writeBack(paths, rep.points) : paths;
}

/**
 * Sposta dei nodi di un vettore con i vincoli (frecce, coordinate del pannello): un trascinamento in un solo fotogramma,
 * rigido e poi morbido, e il rilascio. Se il disegno non può seguire resta com'è.
 */
export function moveNodesConstrained(paths: PathContour[], constraints: ProfileConstraint[] | undefined, refs: NodeRef[], delta: Vec2): PathContour[] {
  // Senza vincoli è lo spostamento libero di sempre
  if (!validConstraints(paths, constraints).length) return moveNodes(paths, refs, delta);
  const targets: DragTarget[] = refs.flatMap((ref) => {
    const p = paths[ref.path]?.nodes[ref.node]?.p;
    return p ? [{ ref, to: [p[0] + delta[0], p[1] + delta[1]] as Vec2 }] : [];
  });
  let frame = dragFrame(paths, constraints, targets, false);
  if (!frame.paths) frame = dragFrame(paths, constraints, targets, true);
  return frame.paths ? settlePaths(frame.paths, constraints) : paths;
}
