import { dragSketch, maxResidual, measure, solveSketch, validateValue } from './constraints';
import type { ConstraintType, Pt, Report } from './constraints';
import { dimensionValue, isDimension, isLinearDimension, placeDimension, pointMap, pointsOf } from './dimPlacement';
import { constraintIdMaker, edgeAt, moveNodes, normalizeProfile, refPoint } from './model';
import type { NodeRef, ProfileGeometry, SegmentRef } from './model';
import { circleContour, freshNodeIds, regenCircle } from '../../scene/bezier';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';

/**
 * Quote e vincoli del Profilo (tappa 2a dello studio quote): la logica pura tra il disegno (`PathContour[]` con nodi con
 * id) e il risolutore (`constraints.ts`). Nessun componente qui dentro: la modale chiama queste funzioni e fa il passo di
 * cronologia. Tutte le funzioni sono immutabili. I vincoli citano i nodi per id (B1): chi chiama deve avere dato gli id
 * (`normalizeProfile`) prima di creare un vincolo.
 *
 * Regola di fondo: il disegno si risolve SOLO quando l'utente aggiunge o cambia un vincolo o una quota, o rilascia un
 * trascinamento; mai al caricamento (le coordinate salvate sono già la soluzione).
 *
 * Il risolutore lavora sempre e solo sui NODI DI CONTROLLO (le coordinate `p` dei nodi con id): i raccordi (`r` di un nodo)
 * sono un'espansione a valle, calcolata quando il contorno si campiona (`expandFillets` in scene/bezier.ts). Un vincolo
 * o una quota su un nodo raccordato riguarda lo spigolo (il punto in cui si incontrerebbero i due segmenti), non l'arco.
 */

// La geometria delle quote (posizione, testo, disposizione automatica) sta in dimPlacement.ts: da qui si riesporta
export { ANGLE_R_PX, DIM_GAP_PX, angleLayout, arcPoints, dimLabel, dimLayout, dimText, dimensionValue, dragDimension, fmtDim, isDimension, isLinearDimension, isPositionedDimension, pillWidthPx, placeDimension, pointMap, pointsOf, repositionDimensions, shownValue } from './dimPlacement';
export type { AngleLayout, DimLayout } from './dimPlacement';

/** Come si misura una quota: lunghezza allineata ai due nodi, solo in orizzontale (distX) o solo in verticale (distY), oppure l'angolo tra due segmenti. */
export type DimMode = 'len' | 'h' | 'v' | 'ang';

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
export const SELECTION_CONSTRAINTS = ['horizontal', 'vertical', 'fixed', 'coincident', 'parallel', 'perpendicular', 'equal', 'midpoint', 'symmetric', 'collinear'] as const;
export type SelectionConstraint = (typeof SELECTION_CONSTRAINTS)[number];

// --- Punti del risolutore ---------------------------------------------------------------------------------------------

/** Nome leggibile dei nodi (P1.2 = secondo nodo del primo percorso): è quello del pannello, come nei contorni dell'elenco Percorsi. */
export function nodeNames(paths: PathContour[]): Map<string, string> {
  // Il centro di un cerchio parametrico è C1, C2... (come il suo contorno nell'elenco)
  return new Map(paths.flatMap((c, pi) => [...(c.circ ? ([[c.circ.id, `C${pi + 1}`]] as [string, string][]) : []), ...c.nodes.flatMap((n, ni): [string, string][] => (n.id ? [[n.id, `P${pi + 1}.${ni + 1}`]] : []))]));
}

/**
 * Id dei nodi indicati (quelli senza id non ci sono: per citarli serve prima `normalizeProfile`). Il centro di un cerchio
 * parametrico ha l'indice subito dopo l'ultimo nodo del suo contorno; gli altri tre nodi del cerchio non hanno id.
 */
export function idsOf(paths: PathContour[], refs: NodeRef[]): string[] {
  return refs.flatMap((r) => {
    const c = paths[r.path];
    const id = c?.circ && r.node === c.nodes.length ? c.circ.id : c?.nodes[r.node]?.id;
    return id ? [id] : [];
  });
}

/** I vincoli che il risolutore può leggere: tutti i punti citati esistono (un nodo cancellato non lascia vincoli, ma un file rovinato sì). */
export function validConstraints(paths: PathContour[], constraints: ProfileConstraint[] | undefined): ProfileConstraint[] {
  // Ogni cerchio parametrico ha un vincolo implicito, mai salvato: il suo nodo sul bordo sta alla stessa altezza del centro. Così il
  // cerchio ha tre gradi di libertà (x, y, raggio) e non quattro (la direzione di quel nodo non conta: tutti i nodi sono equivalenti)
  const implicit = paths.flatMap((c): ProfileConstraint[] => (c.circ && c.nodes[0]?.id ? [{ id: `h-${c.circ.id}`, t: 'horizontal', p: [c.circ.id, c.nodes[0].id] }] : []));
  if (!constraints?.length) return implicit;
  const ids = pointMap(paths);
  return [...implicit, ...constraints.filter((c) => c.p.every((id) => ids.has(id)))];
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
    // Il centro di un cerchio parametrico è un punto del risolutore come i nodi
    const q = c.circ ? solved.get(c.circ.id) : undefined;
    const moved = !!c.circ && !!q && (Math.abs(q.x - c.circ.p[0]) >= 1e-12 || Math.abs(q.y - c.circ.p[1]) >= 1e-12);
    if (!touched && !moved) return c;
    changed = true;
    const written: PathContour = { ...c, nodes, ...(c.circ && moved && q ? { circ: { ...c.circ, p: [q.x || 0, q.y || 0] as Vec2 } } : {}) };
    // I tre nodi derivati e le maniglie del cerchio seguono il centro e il nodo sul bordo
    return regenCircle(written);
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
export type Applied<T> = { ok: true; draft: T; report: Report; keeper?: string } | { ok: false; message: string; ids: string[]; reason?: 'conflict' | 'redundant' | 'unsolved' | 'invalid' };

const UNSOLVED = 'Il risolutore non è arrivato a una soluzione (non è detto che ci sia un conflitto): prova un valore più vicino a quello attuale.';

/** Descrizione breve di un vincolo, per i messaggi e il pannello: «Distanza P1.1-P1.2». */
export function describeConstraint(c: ProfileConstraint, names: Map<string, string>): string {
  // La quota di un cerchio parametrico è il suo diametro (il centro dà il nome: C1)
  if (c.dia) return `Diametro ${names.get(c.p[0]) ?? '?'}`;
  // Un nodo condiviso tra due segmenti (angolo, parallelo...) si nomina una volta
  return `${CONSTRAINT_NAMES[c.t]} ${[...new Set(c.p)].map((id) => names.get(id) ?? '?').join('-')}`;
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
export interface Messages {
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
export function solveWith<T extends ProfileGeometry>(d: T, list: ProfileConstraint[], added: ProfileConstraint | null, messages: Messages, strict = false): Applied<T> {
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
  let added: ProfileConstraint = { ...con, id };
  if (added.t === 'angle' && !added.ref) {
    // L'angolo si porta in (-180, 180] (con un segno negativo e quattro punti i segmenti si scambiano: l'angolo torna positivo)
    const normal = normalizeAngle(added);
    if (typeof normal === 'string') return { ok: false, message: normal, ids: [], reason: 'invalid' };
    added = normal;
  }
  // Una quota angolare nuova: prima si ruota il segmento al nuovo angolo, così il risolutore parte vicino alla soluzione
  const start = added.t === 'angle' && !added.ref ? preRotated(d, added, added.v ?? 0) : d;
  return solveWith(start, [...list, added], added, messagesFor(isDimension(added) ? 'Quota' : 'Vincolo'));
}

/**
 * Porta il valore di una quota angolare in (-180, 180]. Con quattro punti, se è negativo si scambiano i due segmenti e il
 * valore diventa positivo (l'angolo da cd ad ab è l'opposto di quello da ab a cd): l'arco e l'etichetta dicono la stessa
 * cosa. Con due punti (angolo dall'asse X) resta con il segno. Un angolo nullo (a meno di giri interi) tra due lati che hanno
 * un nodo in comune li sovrapporrebbe: si rifiuta con un messaggio (restituito come stringa).
 */
export function normalizeAngle(c: ProfileConstraint): ProfileConstraint | string {
  if (c.v === undefined || !Number.isFinite(c.v)) return c;
  let v = c.v - 360 * Math.round(c.v / 360);
  if (v === -180) v = 180;
  // (un nodo in comune in qualunque posizione: ab e cd, ab e dc, ba e cd... sono lo stesso caso)
  const sharesNode = c.p.length === 4 && (c.p[0] === c.p[2] || c.p[0] === c.p[3] || c.p[1] === c.p[2] || c.p[1] === c.p[3]);
  if (sharesNode && Math.abs(v) < 1e-9) return 'I due lati si sovrapporrebbero: un angolo di 0 gradi tra due lati con un nodo in comune non è un angolo';
  if (v < 0 && c.p.length === 4) return { ...c, p: [c.p[2], c.p[3], c.p[0], c.p[1]], v: -v };
  return { ...c, v: v + 0 };
}

/**
 * Prima di risolvere una quota angolare si ruota il segmento al nuovo angolo (come nel prototipo dello studio): da 10 a 170
 * gradi la via a norma minima sposterebbe i nodi di decine di mm e incontrerebbe il salto a 180 gradi. Gira attorno all'estremo
 * più vincolato (quello senza gradi di libertà, altrimenti il primo). Il risultato è solo il punto di partenza: la risoluzione
 * decide, e se non va il disegno originale non si tocca.
 */
export function preRotated<T extends ProfileGeometry>(d: T, c: ProfileConstraint, value: number): T {
  const pm = pointMap(d.paths);
  if (!c.p.every((id) => pm.has(id))) return d;
  const delta = ((value - measure(c, pointsOf(d.paths))) * Math.PI) / 180;
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-12) return d;
  // Chi gira: di preferenza un estremo libero. Ruotando il secondo segmento (cd) di +delta l'angolo cresce di delta, ruotando il
  // primo (ab) cala di delta (con due soli punti il primo segmento misura l'angolo dall'asse X, quindi cresce)
  const [a, b, e, f] = c.p;
  const all: [string, string, number][] = c.p.length === 2 ? [[a, b, 1], [b, a, 1]] : [[e, f, 1], [f, e, 1], [a, b, -1], [b, a, -1]];
  // Chi gira non può essere un nodo dell'altro segmento (il vertice in comune): ruoterebbero tutti e due
  const options = all.filter(([, m, sg]) => c.p.length === 2 || !(sg === 1 ? [a, b] : [e, f]).includes(m));
  if (!options.length) return d;
  const free = new Set(diagnose(d)?.report.free ?? []);
  const [pivot, mover, sign] = options.find(([, m]) => free.has(m)) ?? options[0];
  const [o, q] = [pm.get(pivot)!, pm.get(mover)!];
  const [cos, sin] = [Math.cos(sign * delta), Math.sin(sign * delta)];
  const [dx, dy] = [q[0] - o[0], q[1] - o[1]];
  return { ...d, paths: writeBack(d.paths, [{ id: mover, x: o[0] + dx * cos - dy * sin, y: o[1] + dx * sin + dy * cos }]) };
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

// --- Vincoli dalla selezione ---------------------------------------------------------------------------------------------

/**
 * Ciò che è scelto nella modale, in id: i nodi SCIOLTI (scelti uno a uno), i segmenti (scelti con Alt+clic: la coppia di id dei
 * due estremi) e tutti i nodi. Un segmento vale solo se i suoi due nodi sono ancora scelti; i suoi estremi non contano come nodi sciolti.
 */
export interface SelectionItems {
  nodes: string[];
  segments: [string, string][];
  all: string[];
}

/** Gli elementi scelti, dai nodi selezionati e dai segmenti scelti con Alt+clic (i nodi senza id non si contano: servono prima gli id). */
export function selectionItems(paths: PathContour[], selection: NodeRef[], segments: SegmentRef[]): SelectionItems {
  const key = (r: NodeRef) => `${r.path}:${r.node}`;
  const selected = new Set(selection.map(key));
  const idOf = (r: NodeRef): string | undefined => idsOf(paths, [r])[0];
  const inSegment = new Set<string>();
  const pairs: [string, string][] = [];
  for (const seg of segments) {
    const c = paths[seg.path];
    if (!c) continue;
    const [a, b] = [{ path: seg.path, node: seg.segment }, { path: seg.path, node: (seg.segment + 1) % c.nodes.length }];
    const [ida, idb] = [idOf(a), idOf(b)];
    if (!ida || !idb || !selected.has(key(a)) || !selected.has(key(b)) || pairs.some(([x, y]) => (x === ida && y === idb) || (x === idb && y === ida))) continue;
    pairs.push([ida, idb]);
    inSegment.add(key(a));
    inSegment.add(key(b));
  }
  const unique = (ids: (string | undefined)[]) => [...new Set(ids.filter((id): id is string => !!id))];
  return { nodes: unique(selection.filter((r) => !inSegment.has(key(r))).map(idOf)), segments: pairs, all: unique(selection.map(idOf)) };
}

/**
 * I punti (id) del vincolo che la selezione può avere, nell'ordine che il risolutore vuole, o null se non basta o non è compatibile:
 * - orizzontale, verticale: un segmento, oppure due nodi;
 * - coincidente: due nodi; fisso: uno o più nodi (tutti quelli scelti);
 * - parallelo, perpendicolare, uguale, collineare: due segmenti diversi (anche con un nodo in comune);
 * - punto medio: un nodo e un segmento; simmetrico: due nodi e un segmento (l'asse).
 */
export function constraintPoints(type: SelectionConstraint, items: SelectionItems): string[] | null {
  const { nodes, segments } = items;
  switch (type) {
    case 'horizontal':
    case 'vertical':
      if (segments.length === 1 && !nodes.length) return [...segments[0]];
      return !segments.length && nodes.length === 2 ? nodes : null;
    case 'coincident':
      return !segments.length && nodes.length === 2 ? nodes : null;
    case 'fixed':
      return items.all.length >= 1 ? items.all : null;
    case 'parallel':
    case 'perpendicular':
    case 'equal':
    case 'collinear':
      return segments.length === 2 && !nodes.length ? [...segments[0], ...segments[1]] : null;
    case 'midpoint':
      return nodes.length === 1 && segments.length === 1 ? [nodes[0], ...segments[0]] : null;
    case 'symmetric':
      return nodes.length === 2 && segments.length === 1 ? [...nodes, ...segments[0]] : null;
  }
}

/** Un vincolo si può creare con ciò che è scelto? */
export const canApplyConstraint = (type: SelectionConstraint, items: SelectionItems): boolean => constraintPoints(type, items) !== null;

/** Che cosa serve scegliere per ogni vincolo (per i messaggi e le descrizioni dei pulsanti). */
export const CONSTRAINT_NEEDS: Record<SelectionConstraint, string> = {
  horizontal: 'un segmento (Alt+clic) o due nodi',
  vertical: 'un segmento (Alt+clic) o due nodi',
  fixed: 'uno o più nodi',
  coincident: 'due nodi',
  parallel: 'due segmenti (Alt+clic, poi Maiusc+Alt+clic sul secondo)',
  perpendicular: 'due segmenti (Alt+clic, poi Maiusc+Alt+clic sul secondo)',
  equal: 'due segmenti (Alt+clic, poi Maiusc+Alt+clic sul secondo)',
  collinear: 'due segmenti (Alt+clic, poi Maiusc+Alt+clic sul secondo)',
  midpoint: 'un nodo e un segmento (Alt+clic)',
  symmetric: 'due nodi e un segmento (Alt+clic) che fa da asse',
};

/** Crea il vincolo scelto dalla selezione, oppure spiega che cosa serve scegliere. */
export function addSelectionConstraint<T extends ProfileGeometry>(d: T, type: SelectionConstraint, items: SelectionItems): Applied<T> {
  const p = constraintPoints(type, items);
  if (!p) return { ok: false, message: `${CONSTRAINT_NAMES[type]}: scegli ${CONSTRAINT_NEEDS[type]}`, ids: [], reason: 'invalid' };
  // Due segmenti uguali (la stessa coppia di nodi) non sono due segmenti
  if (p.length === 4 && ((p[0] === p[2] && p[1] === p[3]) || (p[0] === p[3] && p[1] === p[2]))) return { ok: false, message: `${CONSTRAINT_NAMES[type]}: scegli due segmenti diversi`, ids: [], reason: 'invalid' };
  return type === 'fixed' ? addFixed(d, p) : addConstraint(d, { t: type, p });
}

/** Cambia il valore di una quota e risolve; se il valore non è ammesso o non è raggiungibile il disegno resta com'era. */
export function setConstraintValue<T extends ProfileGeometry>(d: T, id: string, value: number): Applied<T> {
  const list = d.constraints ?? [];
  const con = list.find((c) => c.id === id);
  if (!con || !isDimension(con) || con.ref) return { ok: false, message: 'Questa quota non ha un valore da cambiare', ids: [], reason: 'invalid' };
  const invalid = validateValue(con.t, value);
  if (invalid) return { ok: false, message: invalid, ids: [], reason: 'invalid' };
  let edited: ProfileConstraint = { ...con, v: value };
  if (con.t === 'angle') {
    const normal = normalizeAngle(edited);
    if (typeof normal === 'string') return { ok: false, message: normal, ids: [], reason: 'invalid' };
    edited = normal;
  }
  // Per una modifica la frase è «Valore non raggiungibile» (la quota c'era già); il valore uguale all'attuale non è mai ridondante
  const messages: Messages = { conflict: (who) => `Valore non raggiungibile: va in conflitto con ${who || 'i vincoli'}`, redundant: 'Valore non raggiungibile: il disegno è già vincolato da altri vincoli' };
  const start = con.t === 'angle' ? preRotated(d, edited, edited.v ?? value) : con.dia ? preSized(d, edited, value) : d;
  return solveWith(start, list.map((c) => (c.id === id ? edited : c)), edited, messages);
}

/**
 * Prima di risolvere la quota Ø di un cerchio si porta il nodo sul bordo al nuovo raggio, lungo la sua direzione: il risolutore
 * parte da una soluzione e il centro resta dov'è (altrimenti, a norma minima, centro e bordo si spartirebbero la differenza).
 */
export function preSized<T extends ProfileGeometry>(d: T, c: ProfileConstraint, radius: number): T {
  const pm = pointMap(d.paths);
  const [center, edge] = [pm.get(c.p[0]), pm.get(c.p[1])];
  if (!c.dia || !center || !edge || !(radius > 0)) return d;
  const current = Math.hypot(edge[0] - center[0], edge[1] - center[1]);
  const unit: Vec2 = current > 1e-12 ? [(edge[0] - center[0]) / current, (edge[1] - center[1]) / current] : [1, 0];
  return { ...d, paths: writeBack(d.paths, [{ id: c.p[1], x: center[0] + unit[0] * radius, y: center[1] + unit[1] * radius }]) };
}

// --- Più quote scelte ----------------------------------------------------------------------------------------------------

/** Ciò che si può fare con più quote scelte nell'elenco. */
export interface GroupInfo {
  /** Quante delle quote scelte esistono ancora. */
  count: number;
  /** Tutte quote di lunghezza pilotanti (non di riferimento) dello stesso tipo: hanno un valore comune da cambiare. Le quote angolari no (vedi `setCommonValue`). */
  type: ConstraintType | null;
  /** Il valore comune se sono tutti uguali (entro 1e-9), altrimenti null (il campo mostra «—»). */
  value: number | null;
  /** Due o più distanze tra coppie diverse di nodi: si possono rendere uguali con vincoli Uguale. */
  canEqualize: boolean;
}

/** Che cosa dicono le quote scelte (gli id che non ci sono più si ignorano). */
export function groupInfo(constraints: ProfileConstraint[] | undefined, ids: string[]): GroupInfo {
  const chosen = ids.flatMap((id) => constraints?.find((c) => c.id === id) ?? []);
  const driving = chosen.length > 0 && chosen.every((c) => isDimension(c) && !c.ref && c.v !== undefined);
  // Il valore comune vale per le lunghezze: un angolo comune vuole la normalizzazione e la rotazione preliminare di ogni quota, e per due angoli la via è il vincolo Uguale
  // I diametri dei cerchi (`dia`: il valore salvato è il raggio, quello mostrato il diametro) non fanno gruppo: né valore comune né Uguale
  const sameType = driving && chosen.every((c) => c.t === chosen[0].t && isLinearDimension(c) && !c.dia);
  const value = sameType && chosen.every((c) => Math.abs((c.v as number) - (chosen[0].v as number)) < 1e-9) ? (chosen[0].v as number) : null;
  const pairs = new Set(chosen.filter((c) => c.t === 'dist').map((c) => [...c.p].sort().join('|')));
  return { count: chosen.length, type: sameType ? chosen[0].t : null, value, canEqualize: chosen.length >= 2 && chosen.every((c) => c.t === 'dist' && !c.dia) && pairs.size === chosen.length };
}

/**
 * Dà lo stesso valore a tutte le quote scelte (dello stesso tipo, pilotanti) e risolve una volta sola: o tutte o nessuna.
 * Il valore si valida come quello di una quota; se il disegno non lo raggiunge non cambia nulla.
 */
export function setCommonValue<T extends ProfileGeometry>(d: T, ids: string[], value: number): Applied<T> {
  const info = groupInfo(d.constraints, ids);
  if (info.count < 2 || !info.type) return { ok: false, message: 'Scegli due o più quote di lunghezza pilotanti dello stesso tipo', ids: [], reason: 'invalid' };
  const invalid = validateValue(info.type, value);
  if (invalid) return { ok: false, message: invalid, ids: [], reason: 'invalid' };
  const chosen = new Set(ids);
  const messages: Messages = { conflict: (who) => `Valore non raggiungibile: va in conflitto con ${who || 'i vincoli'}`, redundant: 'Valore non raggiungibile: il disegno è già vincolato da altri vincoli' };
  // Un valore comune è un numero: l'espressione che la quota aveva (parametri locali) si toglie
  return solveWith(d, (d.constraints ?? []).map((c) => { if (!chosen.has(c.id)) return c; const { expr: _expr, ...plain } = c; return { ...plain, v: value }; }), null, messages);
}

/**
 * Rende uguali le distanze scelte. Resta pilotante la prima nell'ordine di scelta (`ids`, cioè dei clic; la prima quota
 * pilotante, o la prima se sono tutte di riferimento): le altre diventano di riferimento (tra parentesi) e ognuna riceve un
 * vincolo Uguale con la prima, quindi il valore finale è quello della prima e i segmenti delle altre si adeguano. Un Uguale
 * ridondante (i due lati sono già uguali per gli altri vincoli, per esempio i lati opposti di un rettangolo con orizzontali
 * e verticali) si salta; solo un conflitto fa fallire, e allora non cambia nulla. Un solo passo. `keeper` = id della quota che resta.
 */
export function equalizeLengths<T extends ProfileGeometry>(d: T, ids: string[]): Applied<T> {
  const info = groupInfo(d.constraints, ids);
  if (!info.canEqualize) return { ok: false, message: 'Scegli due o più distanze tra coppie diverse di nodi', ids: [], reason: 'invalid' };
  // Nell'ordine dei clic (gli id doppi e quelli che non ci sono più non contano)
  const chosen = [...new Set(ids)].flatMap((id) => (d.constraints ?? []).find((c) => c.id === id) ?? []);
  const keeper = chosen.find((c) => !c.ref) ?? chosen[0];
  const others = chosen.filter((c) => c !== keeper);
  // Le quote pilotanti che non restano diventano di riferimento: così non fissano più la lunghezza e l'Uguale non è né in conflitto né ridondante
  const demoted = new Set(others.filter((c) => !c.ref).map((c) => c.id));
  // (una quota di riferimento non ha espressione: misura e basta)
  let current: T = {
    ...d,
    constraints: (d.constraints ?? []).map((c) => {
      if (!demoted.has(c.id)) return c;
      const { expr: _expr, ...plain } = c;
      return { ...plain, ref: true as const };
    }),
  };
  let added = 0;
  for (const other of others) {
    const result = addConstraint(current, { t: 'equal', p: [keeper.p[0], keeper.p[1], other.p[0], other.p[1]] });
    // Ridondante: le due lunghezze sono già uguali per i vincoli del disegno, niente da aggiungere per questa coppia
    if (!result.ok && result.reason === 'redundant') continue;
    if (!result.ok) return { ...result, message: `Non si possono rendere uguali: ${result.message.charAt(0).toLowerCase()}${result.message.slice(1)}` };
    current = result.draft;
    added++;
  }
  if (!added && !demoted.size) return { ok: false, message: 'Le distanze scelte sono già uguali per i vincoli del disegno: non c\'è niente da aggiungere', ids: [], reason: 'redundant' };
  // Il valore promemoria delle quote diventate di riferimento è la misura che hanno adesso
  const finalPaths = current.paths;
  current = { ...current, constraints: (current.constraints ?? []).map((c) => (demoted.has(c.id) ? { ...c, v: dimensionValue({ ...c, v: undefined }, finalPaths) } : c)) };
  return { ok: true, draft: current, report: solveSketch(pointsOf(current.paths), validConstraints(current.paths, current.constraints)), keeper: keeper.id };
}

/**
 * Rende pilotante una quota di riferimento: prende il valore che il disegno ha adesso e comincia a vincolare (per esempio una
 * quota declassata da «Rendi uguali»). Se il disegno è già vincolato da altri vincoli (la quota sarebbe ridondante) o va in
 * conflitto non si applica, e il messaggio dice perché.
 */
export function makeDriving<T extends ProfileGeometry>(d: T, id: string): Applied<T> {
  const c = (d.constraints ?? []).find((x) => x.id === id);
  if (!c || !c.ref || !isDimension(c)) return { ok: false, message: 'Solo una quota di riferimento si può rendere pilotante', ids: [], reason: 'invalid' };
  // La quota prende la misura di adesso: l'espressione che avesse non vale più
  const { ref: _ref, expr: _expr, ...rest } = c;
  let driving: ProfileConstraint = { ...rest, v: dimensionValue({ ...c, v: undefined }, d.paths) };
  if (driving.t === 'angle') {
    const normal = normalizeAngle(driving);
    if (typeof normal === 'string') return { ok: false, message: normal, ids: [], reason: 'invalid' };
    driving = normal;
  }
  const messages: Messages = {
    conflict: (who) => `Non si può rendere pilotante: va in conflitto con ${who || 'gli altri vincoli'}`,
    redundant: 'Non si può rendere pilotante: il disegno è già vincolato da altri vincoli, la quota resta di riferimento',
  };
  // Severo: anche una ridondanza con un altro vincolo (per esempio l'Uguale che l'ha declassata) rifiuta
  return solveWith(d, (d.constraints ?? []).map((x) => (x.id === id ? driving : x)), driving, messages, true);
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
 * Nuova quota angolare tra due segmenti (coppie di id degli estremi), con l'angolo che hanno adesso: l'arco sta nel vertice
 * (con un nodo in comune sono i due raggi uscenti da lì) e l'angolo si presenta sempre positivo. Il raggio dell'arco e la
 * posizione dell'etichetta sono quelli scelti da `placeDimension`. Restituisce un messaggio se i due segmenti sono paralleli
 * (serve il vincolo Parallelo) o coincidono. Non risolve e non assegna l'id.
 */
export function createAngleDimension(paths: PathContour[], first: [string, string], second: [string, string], pxPerMm: number, existing: ProfileConstraint[] = []): Omit<ProfileConstraint, 'id'> | string {
  const pm = pointMap(paths);
  if (![...first, ...second].every((id) => pm.has(id))) return 'Scegli due segmenti';
  if ((first[0] === second[0] && first[1] === second[1]) || (first[0] === second[1] && first[1] === second[0])) return 'Scegli due segmenti diversi';
  // Con un nodo in comune l'angolo si misura tra i due raggi che escono da lì
  const shared = first.find((id) => id === second[0] || id === second[1]);
  let l1: [string, string] = first;
  let l2: [string, string] = second;
  if (shared) {
    l1 = [shared, first[0] === shared ? first[1] : first[0]];
    l2 = [shared, second[0] === shared ? second[1] : second[0]];
  }
  const pts = pointsOf(paths);
  let con: Omit<ProfileConstraint, 'id'> = { t: 'angle', p: [...l1, ...l2] };
  // L'angolo si presenta sempre positivo: se è negativo i segmenti si scambiano
  if (measure(con as ProfileConstraint, pts) < 0) con = { t: 'angle', p: [...l2, ...l1] };
  const v = measure(con as ProfileConstraint, pts);
  if (Math.abs(v) < 1e-6 || Math.abs(Math.abs(v) - 180) < 1e-6) return 'I due segmenti sono paralleli: usa il vincolo Parallelo';
  const dim = { ...con, v };
  return { ...dim, ...placeDimension(paths, existing, dim as ProfileConstraint, pxPerMm) };
}

/**
 * Aggiunge una quota di riferimento: mostra la misura attuale (tra parentesi sul disegno), non entra nel risolutore e non si
 * modifica. Serve quando una quota nuova sarebbe ridondante o in conflitto con le altre. Non risolve: il disegno non cambia.
 * Lavora sul disegno `d` che le si dà (chi chiama passa quello CORRENTE, non quello di quando la quota è stata rifiutata) e
 * restituisce null se un nodo della quota non c'è più.
 */
export function addReferenceDimension<T extends ProfileGeometry>(d: T, con: Omit<ProfileConstraint, 'id'>): T | null {
  if (!con.p.every((id) => pointMap(d.paths).has(id))) return null;
  const list = d.constraints ?? [];
  const id = constraintIdMaker(list)();
  const ref: ProfileConstraint = { ...con, id, ref: true };
  // La misura che ha adesso (positiva per le distanze); `v` resta come promemoria, il disegno la rilegge sempre
  const measured = dimensionValue({ ...ref, v: undefined }, d.paths);
  return { ...d, constraints: [...list, { ...ref, v: measured }] };
}

// --- Cerchio parametrico -------------------------------------------------------------------------------------------------

/** Raggio minimo (mm) di un cerchio disegnato: sotto, il gesto non crea nulla. */
export const MIN_CIRCLE_RADIUS = 0.05;

/**
 * Aggiunge un cerchio parametrico (un foro quotato) di centro `center` e raggio `radius`: un contorno chiuso di 4 nodi lisci
 * (il primo con id, sul bordo a destra del centro; il centro è un punto con id; vedi `PathContour.circ`) e la sua quota Ø,
 * già posizionata sopra il cerchio. Il diametro si arrotonda a 2 decimali, perché la quota è un valore leggibile (il cerchio nasce
 * già di quella misura). Restituisce il disegno nuovo, l'indice del contorno e l'id della quota, oppure un messaggio.
 */
export function addCircle<T extends ProfileGeometry>(d: T, center: Vec2, radius: number, pxPerMm: number): { draft: T; path: number; quote: string } | string {
  const diameter = Math.round(2 * radius * 100) / 100;
  const r = diameter / 2;
  if (!(r >= MIN_CIRCLE_RADIUS)) return 'Il cerchio è troppo piccolo: trascina più in là dal centro';
  const refused = validateValue('dist', r);
  if (refused) return refused;
  const base = normalizeProfile(d);
  if (base.paths.length >= 100) return 'Limite raggiunto: al massimo 100 contorni per profilo';
  const [centerId, nodeId] = freshNodeIds(base.paths, 2);
  const paths = [...base.paths, circleContour(center, r, centerId, nodeId)];
  const quote: Omit<ProfileConstraint, 'id'> = { t: 'dist', p: [centerId, nodeId], v: r, dia: true };
  const placed = { ...quote, ...placeDimension(paths, base.constraints ?? [], quote as ProfileConstraint, pxPerMm) };
  const result = addConstraint({ ...base, paths }, placed);
  if (!result.ok) return result.message;
  return { draft: result.draft, path: paths.length - 1, quote: result.draft.constraints!.at(-1)!.id };
}

/** La quota Ø del cerchio `index`, se c'è. */
export function circleQuote(d: ProfileGeometry, index: number): ProfileConstraint | undefined {
  const c = d.paths[index];
  const first = c?.nodes[0]?.id;
  return c?.circ && first ? (d.constraints ?? []).find((q) => q.dia && q.p[0] === c.circ!.id && q.p[1] === first) : undefined;
}

/** Il cerchio di cui `a` e `b` sono il centro e il nodo sul bordo (in qualunque ordine), o -1. */
export function circleOfPair(paths: PathContour[], a: string, b: string): number {
  return paths.findIndex((c) => c.circ && c.nodes[0]?.id && ((c.circ.id === a && c.nodes[0].id === b) || (c.circ.id === b && c.nodes[0].id === a)));
}

/** Nuova quota Ø per il cerchio `index` (con il diametro che ha adesso), già posizionata; un messaggio se non è un cerchio. Non risolve e non dà l'id. */
export function circleDimension(paths: PathContour[], index: number, pxPerMm: number, existing: ProfileConstraint[] = []): Omit<ProfileConstraint, 'id'> | string {
  const c = paths[index];
  const first = c?.nodes[0];
  if (!c?.circ || !first?.id) return 'Il diametro si assegna a un cerchio';
  const dim: Omit<ProfileConstraint, 'id'> = { t: 'dist', p: [c.circ.id, first.id], v: Math.hypot(first.p[0] - c.circ.p[0], first.p[1] - c.circ.p[1]), dia: true };
  return { ...dim, ...placeDimension(paths, existing, dim as ProfileConstraint, pxPerMm) };
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
  // Posizione libera dei nodi trascinati; per un cerchio parametrico il centro (o uno dei tre nodi derivati) porta con sé tutto il
  // cerchio, il solo nodo sul bordo ne cambia il raggio
  const where = new Map(targets.map((t) => [`${t.ref.path}:${t.ref.node}`, t.to]));
  const moves: Record<string, Vec2> = {};
  const moved = current.map((c, pi) => {
    if (c.circ) {
      const whole = targets.find((t) => t.ref.path === pi && t.ref.node !== 0);
      const first = targets.find((t) => t.ref.path === pi && t.ref.node === 0);
      if (whole) {
        const from = refPoint(current, whole.ref)!;
        const delta: Vec2 = [whole.to[0] - from[0], whole.to[1] - from[1]];
        const shifted: PathContour = { ...c, nodes: c.nodes.map((n) => ({ ...n, p: [n.p[0] + delta[0], n.p[1] + delta[1]] as Vec2 })), circ: { ...c.circ, p: [c.circ.p[0] + delta[0], c.circ.p[1] + delta[1]] as Vec2 } };
        moves[c.circ.id] = shifted.circ!.p;
        if (c.nodes[0].id) moves[c.nodes[0].id] = shifted.nodes[0].p;
        return shifted;
      }
      if (first) {
        // Il nodo sul bordo cambia il raggio: sta sempre sulla orizzontale del centro (il vincolo implicito)
        const to = edgeAt(c, first.to);
        if (c.nodes[0].id) moves[c.nodes[0].id] = to;
        return regenCircle({ ...c, nodes: c.nodes.map((n, ni) => (ni === 0 ? { ...n, p: to } : n)) });
      }
      return c;
    }
    for (const [ni, n] of c.nodes.entries()) if (n.id && where.has(`${pi}:${ni}`)) moves[n.id] = where.get(`${pi}:${ni}`)!;
    return c.nodes.some((_, ni) => where.has(`${pi}:${ni}`)) ? { ...c, nodes: c.nodes.map((n, ni) => (where.has(`${pi}:${ni}`) ? { ...n, p: where.get(`${pi}:${ni}`)! } : n)) } : c;
  });
  const cons = validConstraints(current, constraints);
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
    const p = refPoint(paths, ref);
    return p ? [{ ref, to: [p[0] + delta[0], p[1] + delta[1]] as Vec2 }] : [];
  });
  let frame = dragFrame(paths, constraints, targets, false);
  if (!frame.paths) frame = dragFrame(paths, constraints, targets, true);
  return frame.paths ? settlePaths(frame.paths, constraints) : paths;
}
