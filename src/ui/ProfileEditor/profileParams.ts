import { solveSketch, validateValue } from './constraints';
import { describeConstraint, normalizeAngle, nodeNames, pointsOf, preRotated, preSized, setConstraintValue, solveWith, validConstraints } from './dimensions';
import type { Applied, Messages } from './dimensions';
import type { ProfileGeometry } from './model';
import { MAX_EXPR, MAX_PARAMS, validParamName, validParamNumber } from '../../scene/bezier';
import { evalFormula, formulaDeps, nameProblem, resolveParams } from '../../scene/params';
import type { Param, ProfileConstraint, ProfileParams } from '../../scene/types';

/**
 * Parametri locali del profilo ed espressioni nelle quote (tappa 5 dello studio quote). Un parametro è un nome con un numero o
 * un'espressione (`larghezza/2 + 3`); una quota può avere un'espressione (`expr`) al posto del numero, e il suo valore `v` è
 * quello valutato. Il valutatore è quello dei parametri di scena (`evalFormula`, `resolveParams` in scene/params.ts: stessa
 * sintassi, cicli e nomi riservati inclusi); qui si riusa mandando i parametri locali come se fossero un elenco di `Param`.
 *
 * Regole: il disegno si risolve solo quando l'utente cambia un parametro o una quota (mai alla lettura), un cambio che non si
 * può applicare (espressione non valida, valore non ammesso, conflitto) lascia tutto com'era, e i parametri non si scalano
 * quando il profilo si ridimensiona (come i valori delle quote).
 */

/** Disegno con i parametri: contorni, vincoli e parametri locali. */
export type ParamGeometry = ProfileGeometry & { params?: ProfileParams };

/** Testo con cui si mostra il valore di un parametro: il numero, o l'espressione scritta. */
export const paramText = (v: number | string): string => String(typeof v === 'number' ? Number(v.toFixed(6)) : v);

/** Valori calcolati dei parametri locali e, per nome, il perché di quelli che non si calcolano (nome non valido, formula errata, riferimento mancante o circolare). */
export function resolveLocal(params: ProfileParams | undefined): { values: Record<string, number>; errors: Record<string, string> } {
  const list: Param[] = Object.entries(params ?? {}).map(([name, v]) => ({ id: name, name, expr: String(v) }));
  const { values, errors } = resolveParams(list);
  return { values, errors };
}

/** Un numero scritto da solo (virgola o punto decimale, anche con segno). */
const SIMPLE_NUMBER = /^[-+]?(\d+[.,]?\d*|[.,]\d+)$/;

/** Esito della lettura del testo di un campo valore. `expr` c'è solo se il testo usa almeno un parametro del profilo. */
export type FieldValue = { ok: true; v: number; expr?: string } | { ok: false; error: string };

/**
 * Legge il testo di una quota o di un raggio: un numero, un calcolo senza parametri (`10 / 2`, solo il risultato) oppure
 * un'espressione con i parametri locali (`larghezza / 2 + 3`, che si ricorda). Mai eccezioni: l'esito dice che cosa non va.
 */
export function parseFieldValue(text: string, params: ProfileParams | undefined): FieldValue {
  const raw = text.trim();
  if (raw === '') return { ok: false, error: 'Scrivi un valore' };
  if (SIMPLE_NUMBER.test(raw)) return { ok: true, v: Number(raw.replace(',', '.')) };
  const deps = formulaDeps(raw);
  // Un'espressione che si ricorda deve stare nei limiti di quello che si salva (altrimenti sparirebbe alla prima riapertura)
  if (deps.length && raw.length > MAX_EXPR) return { ok: false, error: `L'espressione è troppo lunga: al massimo ${MAX_EXPR} caratteri` };
  const { values, errors } = resolveLocal(params);
  // Un parametro che usa un'espressione è sbagliato lui stesso: l'errore è suo, non della quota
  const broken = deps.find((name) => errors[name]);
  if (broken) return { ok: false, error: `Il parametro «${broken}» non si calcola: ${errors[broken]}` };
  const result = evalFormula(raw, values);
  if (!result.ok) return { ok: false, error: result.error.startsWith('Parametro sconosciuto') ? `${result.error}: aggiungilo ai parametri del profilo` : `Espressione non valida: ${result.error}` };
  return deps.length ? { ok: true, v: result.value, expr: raw } : { ok: true, v: result.value };
}

/** Quote e parametri che usano il parametro `name` (le quote per id, i parametri per nome). */
export function paramUsers(d: ParamGeometry, name: string): { quotes: string[]; params: string[] } {
  return {
    quotes: (d.constraints ?? []).filter((c) => c.expr && formulaDeps(c.expr).includes(name)).map((c) => c.id),
    params: Object.entries(d.params ?? {}).filter(([other, v]) => other !== name && typeof v === 'string' && formulaDeps(v).includes(name)).map(([other]) => other),
  };
}

const invalid = <T>(message: string): Applied<T> => ({ ok: false, message, ids: [], reason: 'invalid' });

/** Il disegno con i parametri dati (il campo non c'è se non ne resta nessuno). */
function withParams<T extends ParamGeometry>(d: T, params: ProfileParams): T {
  const { params: _old, ...rest } = d;
  return (Object.keys(params).length ? { ...rest, params } : rest) as T;
}

/** Valore di una quota letto dalla sua espressione: il raggio per un diametro. */
const valueOf = (c: ProfileConstraint, shown: number): number => (c.dia ? shown / 2 : shown);

/**
 * Mette i parametri `next` e rilegge le quote che hanno un'espressione: i nuovi valori si validano come quelli digitati
 * (lunghezza positiva, angolo senza 0 tra lati con un nodo in comune...) e il disegno si risolve UNA volta. Se un parametro
 * non si calcola (ciclo, nome, formula), se una quota non può avere il nuovo valore o se il disegno va in conflitto non cambia
 * nulla. `label` è il parametro cambiato, per i messaggi. Senza quote con espressione, o se nessun valore cambia, il disegno
 * non si risolve (si ricorda solo il parametro).
 */
export function applyParams<T extends ParamGeometry>(d: T, next: ProfileParams, label = ''): Applied<T> {
  const { values, errors } = resolveLocal(next);
  const [badName, problem] = Object.entries(errors)[0] ?? [];
  if (badName) return invalid(`Parametro «${badName}»: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`);
  const names = nodeNames(d.paths);
  let changed = false;
  const updated: ProfileConstraint[] = [];
  for (const c of d.constraints ?? []) {
    if (!c.expr || c.ref) {
      updated.push(c);
      continue;
    }
    const result = evalFormula(c.expr, values);
    const who = describeConstraint(c, names);
    if (!result.ok) return invalid(`${who} con ${c.expr}: ${result.error.charAt(0).toLowerCase()}${result.error.slice(1)}`);
    let edited: ProfileConstraint = { ...c, v: valueOf(c, result.value) };
    const refused = validateValue(c.t, edited.v as number);
    if (refused) return invalid(`${who} con ${c.expr}: ${refused.charAt(0).toLowerCase()}${refused.slice(1)}`);
    if (c.t === 'angle') {
      const normal = normalizeAngle(edited);
      if (typeof normal === 'string') return invalid(`${who} con ${c.expr}: ${normal.charAt(0).toLowerCase()}${normal.slice(1)}`);
      edited = normal;
    }
    if (Math.abs((edited.v as number) - (c.v ?? Number.NaN)) > 1e-12 || edited.p.some((id, i) => id !== c.p[i])) changed = true;
    updated.push(edited);
  }
  const base = withParams(d, next);
  if (!changed) return { ok: true, draft: base, report: solveSketch(pointsOf(d.paths), validConstraints(d.paths, d.constraints)) };
  // Gli angoli che cambiano: prima si ruota il segmento al nuovo valore, così il risolutore parte vicino alla soluzione
  let start: T = { ...base, constraints: updated };
  for (const c of updated) {
    if (c.t === 'angle' && c.expr && c.v !== undefined) start = preRotated(start, c, c.v);
    else if (c.dia && c.expr && c.v !== undefined) start = preSized(start, c, c.v);
  }
  const messages: Messages = {
    conflict: (who) => `${label ? `Il valore di «${label}»` : 'Il valore'} va in conflitto con ${who || 'i vincoli'}: non applicato`,
    redundant: `${label ? `Il valore di «${label}»` : 'Il valore'} non è raggiungibile: il disegno è già vincolato da altri vincoli`,
  };
  return solveWith(start, updated, null, messages);
}

/** Valore di un parametro scritto dall'utente: un numero, oppure un'espressione (che può usare altri parametri). Null se è vuoto. */
export function parseParamValue(text: string): number | string | null {
  const raw = text.trim();
  if (raw === '') return null;
  return SIMPLE_NUMBER.test(raw) ? Number(raw.replace(',', '.')) : raw;
}

/** Perché un valore di parametro non si può salvare (numero fuori misura, espressione troppo lunga), o null se va bene. */
function valueProblem(value: number | string): string | null {
  if (typeof value === 'number') return validParamNumber(value) ? null : 'Il valore deve essere un numero entro ±100000';
  return value.length > MAX_EXPR ? `L'espressione è troppo lunga: al massimo ${MAX_EXPR} caratteri` : null;
}

/** Aggiunge un parametro (nome valido e libero, valore numero o espressione) e rilegge le quote. */
export function addParam<T extends ParamGeometry>(d: T, name: string, text: string): Applied<T> {
  const trimmed = name.trim();
  const problem = nameProblem(trimmed) ?? (validParamName(trimmed) ? null : trimmed.length > 32 ? 'Il nome è troppo lungo: al massimo 32 caratteri' : `«${trimmed}» non è un nome ammesso`);
  if (problem) return invalid(problem);
  if (d.params && Object.hasOwn(d.params, trimmed)) return invalid(`Esiste già un parametro «${trimmed}»`);
  if (Object.keys(d.params ?? {}).length >= MAX_PARAMS) return invalid(`Al massimo ${MAX_PARAMS} parametri per profilo`);
  const value = parseParamValue(text);
  if (value === null) return invalid('Scrivi il valore del parametro: un numero o un\'espressione');
  const bad = valueProblem(value);
  if (bad) return invalid(bad);
  return applyParams(d, { ...d.params, [trimmed]: value }, trimmed);
}

/** Cambia il valore di un parametro che c'è già: le quote che lo usano si rileggono e il disegno si risolve in un solo passo. */
export function setParam<T extends ParamGeometry>(d: T, name: string, text: string): Applied<T> {
  if (!d.params || !Object.hasOwn(d.params, name)) return invalid(`Il parametro «${name}» non c'è`);
  const value = parseParamValue(text);
  if (value === null) return invalid('Scrivi il valore del parametro: un numero o un\'espressione');
  if (value === d.params[name]) return invalid('Il valore è già quello');
  const bad = valueProblem(value);
  if (bad) return invalid(bad);
  return applyParams(d, { ...d.params, [name]: value }, name);
}

/** Toglie un parametro che nessuna quota e nessun altro parametro usa; altrimenti rifiuta e dice chi lo usa. */
export function deleteParam<T extends ParamGeometry>(d: T, name: string): Applied<T> {
  if (!d.params || !Object.hasOwn(d.params, name)) return invalid(`Il parametro «${name}» non c'è`);
  const users = paramUsers(d, name);
  if (users.quotes.length || users.params.length) {
    const who = [...(users.quotes.length ? [`${users.quotes.length} ${users.quotes.length === 1 ? 'quota' : 'quote'}`] : []), ...users.params.map((p) => `il parametro «${p}»`)];
    return { ok: false, message: `Il parametro «${name}» è usato da ${who.join(' e ')}: modificale prima`, ids: users.quotes, reason: 'invalid' };
  }
  const { [name]: _gone, ...rest } = d.params;
  return applyParams(d, rest, name);
}

/**
 * Cambia il valore di una quota dal testo del campo: un numero (toglie l'espressione che c'era) o un'espressione con i
 * parametri (la ricorda e mostra ƒ). Per un diametro il testo è il diametro. Il resto è `setConstraintValue`: valida, risolve,
 * e se non si può non cambia nulla.
 */
export function setQuoteText<T extends ParamGeometry>(d: T, id: string, text: string): Applied<T> {
  const con = (d.constraints ?? []).find((c) => c.id === id);
  if (!con) return invalid('Questa quota non c\'è più');
  const parsed = parseFieldValue(text, d.params);
  if (!parsed.ok) return invalid(parsed.error);
  const result = setConstraintValue(d, id, con.dia ? parsed.v / 2 : parsed.v);
  if (!result.ok) return result;
  // L'espressione segue il valore: una nuova la sostituisce, un numero semplice la toglie
  const constraints = (result.draft.constraints ?? []).map((c) => {
    if (c.id !== id) return c;
    const { expr: _expr, ...plain } = c;
    return parsed.expr ? { ...plain, expr: parsed.expr } : plain;
  });
  return { ...result, draft: { ...result.draft, constraints } };
}
