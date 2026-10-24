import { validateValue } from './constraints';
import { addConstraint, addReferenceDimension, placeDimension } from './dimensions';
import { applyInferred, inferClosingConstraints, inferNodeConstraints } from './infer';
import { appendPenNode, closeContour, normalizeProfile } from './model';
import type { Draft, NodeRef } from './model';
import { assignNodeIds } from '../../scene/bezier';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';

/**
 * Penna con lunghezza e angolo digitati (tappa 4 dello studio quote): le funzioni pure che trasformano ciò che l'utente
 * scrive nei due campi in un punto e in quote. Un campo vuoto è libero e segue il cursore. L'angolo è in gradi rispetto
 * all'asse X (antiorario, Y verso l'alto), come l'angolo a due punti del risolutore.
 */

/** Esito della lettura di un campo: vuoto (libero), numero, oppure testo che non è un numero. */
export type Typed = { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'bad' };

/** Legge un campo: numeri con la virgola o il punto, anche con segno; il resto è «non valido». */
export function typed(text: string): Typed {
  const t = text.trim().replace(',', '.');
  if (t === '') return { kind: 'empty' };
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? { kind: 'number', value: Number(t) } : { kind: 'bad' };
}

/** Un angolo in gradi in (-180, 180]. */
export function normalizeDeg(angle: number): number {
  const v = angle - 360 * Math.round(angle / 360);
  return (v === -180 ? 180 : v) + 0;
}

/** Il vettore di lunghezza `length` a `deg` gradi dall'asse X; i multipli di 90 gradi sono esatti (nessun 6e-17 al posto dello zero). */
export function polar(length: number, deg: number): Vec2 {
  const turns = (((deg % 360) + 360) % 360) / 90;
  if (Number.isInteger(turns)) return [[length, 0], [0, length], [-length, 0], [0, -length]][turns] as Vec2;
  const r = (deg * Math.PI) / 180;
  return [length * Math.cos(r), length * Math.sin(r)];
}

/** Il punto in cui nascerebbe il nodo, con ciò che l'utente ha scritto (`typedLength` e `typedAngle` dicono quali campi non erano vuoti). */
export type PenTarget = { ok: true; p: Vec2; length: number; angle: number; typedLength: boolean; typedAngle: boolean } | { ok: false; message: string };

/**
 * Il nodo che nasce dal nodo `last` con i testi dei due campi. Un campo vuoto segue il cursore (`cursor`, assente = 10 mm a
 * destra): la lunghezza è la distanza dal cursore, l'angolo la sua direzione. I valori scritti si validano come quelli delle
 * quote (`validateValue`: lunghezza maggiore di zero e al più 100000 mm, angolo tra -360 e 360 gradi); il messaggio dice quale
 * campo non va. Con entrambi i campi vuoti e il cursore sul nodo non c'è nessun segmento.
 */
export function penTarget(last: Vec2, cursor: Vec2 | null, lengthText: string, angleText: string): PenTarget {
  const [tl, ta] = [typed(lengthText), typed(angleText)];
  if (tl.kind === 'bad') return { ok: false, message: 'Lunghezza non valida: scrivi un numero' };
  if (ta.kind === 'bad') return { ok: false, message: 'Angolo non valido: scrivi un numero' };
  const d: Vec2 = cursor ? [cursor[0] - last[0], cursor[1] - last[1]] : [10, 0];
  const length = tl.kind === 'number' ? tl.value : Math.hypot(d[0], d[1]);
  const angle = ta.kind === 'number' ? ta.value : (Math.atan2(d[1], d[0]) * 180) / Math.PI;
  if (tl.kind === 'number') {
    const invalid = validateValue('dist', length);
    if (invalid) return { ok: false, message: `Lunghezza: ${invalid.charAt(0).toLowerCase()}${invalid.slice(1)}` };
  } else if (!(length > 1e-9)) return { ok: false, message: 'Serve una lunghezza maggiore di zero: scrivila o sposta il cursore' };
  if (ta.kind === 'number') {
    const invalid = validateValue('angle', angle);
    if (invalid) return { ok: false, message: invalid };
  }
  const v = polar(length, angle);
  return { ok: true, p: [last[0] + v[0], last[1] + v[1]], length, angle, typedLength: tl.kind === 'number', typedAngle: ta.kind === 'number' };
}

/**
 * Le quote che i valori digitati diventano, tra il nodo di partenza e quello d'arrivo (id): la distanza se la lunghezza era
 * scritta, e l'angolo dall'asse X (a due punti, in (-180, 180]) se era scritto l'angolo. Un campo vuoto non dà nessuna quota.
 */
export function penQuotes(fromId: string, toId: string, target: Extract<PenTarget, { ok: true }>): Omit<ProfileConstraint, 'id'>[] {
  const out: Omit<ProfileConstraint, 'id'>[] = [];
  if (target.typedLength) out.push({ t: 'dist', p: [fromId, toId], v: target.length });
  if (target.typedAngle) out.push({ t: 'angle', p: [fromId, toId], v: normalizeDeg(target.angle) });
  return out;
}

/** Il disegno dopo un nodo digitato: il nuovo disegno, il nodo da selezionare e se il contorno si è chiuso; oppure l'errore. */
export type TypedNode = { draft: Draft; selection: NodeRef; closing: boolean } | { error: string };

/**
 * Aggiunge al contorno aperto `index` il nodo calcolato da `target` e le quote dei valori digitati, già posizionate fuori dal
 * disegno (`pxPerMm` è lo zoom). Se il punto cade sul primo nodo di un contorno con almeno tre nodi il contorno si chiude
 * (nessun nodo in più) e le quote vanno all'ultimo lato. Una quota già implicata dalle altre, o in conflitto, entra come
 * quota di riferimento: i numeri dell'utente non si perdono. Con `infer` (vincoli automatici accesi) il nuovo lato porta anche
 * i vincoli dedotti (orizzontale, verticale, perpendicolare, coincidente; per il lato di chiusura i primi tre), salvo la
 * direzione quando l'angolo è digitato (la sua quota la decide già). Il nodo nasce esattamente nel punto digitato, poi i
 * vincoli dedotti possono ritoccarlo.
 */
export function typedPenNode(current: Draft, index: number, target: Extract<PenTarget, { ok: true }>, pxPerMm: number, infer = false): TypedNode {
  const open = current.paths[index];
  if (!open || open.closed || !open.nodes.length) return { error: 'Non c\'è un contorno aperto da continuare' };
  const base = normalizeProfile(current);
  const contour = base.paths[index];
  const [from, first] = [contour.nodes[contour.nodes.length - 1], contour.nodes[0]];
  const closing = contour.nodes.length >= 3 && Math.hypot(target.p[0] - first.p[0], target.p[1] - first.p[1]) < 1e-6;
  let paths: PathContour[];
  if (closing) paths = closeContour(base.paths, index);
  else {
    const added = appendPenNode(base.paths, index, target.p);
    if (!added) return { error: 'Limite raggiunto: al massimo 500 nodi per contorno e 100 contorni. Termina il contorno (Invio) o chiudilo' };
    paths = assignNodeIds(added.paths);
  }
  const toId = closing ? (first.id as string) : (paths[index].nodes[paths[index].nodes.length - 1].id as string);
  let drawn: Draft = { ...base, paths };
  for (const quote of penQuotes(from.id as string, toId, target)) {
    const placed = { ...quote, ...placeDimension(drawn.paths, drawn.constraints ?? [], quote as ProfileConstraint, pxPerMm) };
    const result = addConstraint(drawn, placed);
    drawn = result.ok ? result.draft : (addReferenceDimension(drawn, placed) ?? drawn);
  }
  if (infer) {
    // Vincoli dedotti dopo le quote digitate: la direzione solo se l'angolo non era scritto
    const candidates = closing
      ? inferClosingConstraints(drawn.paths, index, undefined, !target.typedAngle)
      : inferNodeConstraints(drawn.paths, { path: index, node: drawn.paths[index].nodes.length - 1 }, undefined, !target.typedAngle);
    drawn = applyInferred(drawn, candidates);
  }
  return { draft: drawn, selection: { path: index, node: closing ? 0 : paths[index].nodes.length - 1 }, closing };
}
