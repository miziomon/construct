import { describe, expect, it } from 'vitest';
import { sanitizeConstraints, sanitizeParams } from '../../scene/bezier';
import type { PathContour, ProfileConstraint, ProfileParams, Vec2 } from '../../scene/types';
import { addCircle, addConstraint, addFixed, createAngleDimension, dimText, pointMap } from './dimensions';
import type { Applied } from './dimensions';
import { addParam, applyParams, deleteParam, parseFieldValue, parseParamValue, paramText, paramUsers, resolveLocal, setParam, setQuoteText } from './profileParams';
import type { ParamGeometry } from './profileParams';

/** Rettangolo con n1 fisso e lati orizzontali e verticali (come la piastra): restano la larghezza e l'altezza. */
const squared = (): ParamGeometry => {
  const paths: PathContour[] = [
    {
      closed: true,
      nodes: [
        { id: 'n1', p: [0, 0], kind: 'corner' },
        { id: 'n2', p: [40, 0], kind: 'corner' },
        { id: 'n3', p: [40, 20], kind: 'corner' },
        { id: 'n4', p: [0, 20], kind: 'corner' },
      ],
    },
  ];
  let d: ParamGeometry = { paths };
  d = must(addFixed(d, ['n1']));
  d = must(addConstraint(d, { t: 'horizontal', p: ['n1', 'n2'] }));
  d = must(addConstraint(d, { t: 'horizontal', p: ['n4', 'n3'] }));
  d = must(addConstraint(d, { t: 'vertical', p: ['n2', 'n3'] }));
  return must(addConstraint(d, { t: 'vertical', p: ['n1', 'n4'] }));
};
function must<T>(r: Applied<T>): T {
  if (!r.ok) throw new Error(r.message);
  return r.draft;
}
const pos = (d: ParamGeometry, id: string): Vec2 => pointMap(d.paths).get(id)!;
/** Il rettangolo con i parametri larghezza (40) e altezza (20) e le quote scritte come espressioni. */
const parametric = (): ParamGeometry => {
  let d = squared();
  d = { ...d, params: { larghezza: 40, altezza: 20 } };
  d = must(addConstraint(d, { t: 'distX', p: ['n1', 'n2'], s: 1, v: 40, expr: 'larghezza' }));
  return must(addConstraint(d, { t: 'distY', p: ['n1', 'n4'], s: 1, v: 20, expr: 'altezza/2*2' }));
};

describe('lettura dei campi: numeri, calcoli ed espressioni con parametri', () => {
  const params: ProfileParams = { larghezza: 80, passo: 'larghezza / 4', rotto: 'manca + 1' };

  it('un numero (anche con la virgola) resta un numero, senza espressione', () => {
    expect(parseFieldValue('12.5', params)).toEqual({ ok: true, v: 12.5 });
    expect(parseFieldValue(' 12,5 ', params)).toEqual({ ok: true, v: 12.5 });
    expect(parseFieldValue('-3', params)).toEqual({ ok: true, v: -3 });
  });

  it('un calcolo senza parametri dà solo il risultato; con un parametro si ricorda l\'espressione', () => {
    expect(parseFieldValue('10 / 4', params)).toEqual({ ok: true, v: 2.5 });
    expect(parseFieldValue('larghezza/2 + 3', params)).toEqual({ ok: true, v: 43, expr: 'larghezza/2 + 3' });
    // Un parametro può usarne un altro
    expect(parseFieldValue('passo * 2', params)).toEqual({ ok: true, v: 40, expr: 'passo * 2' });
    // Le funzioni delle formule di scena valgono anche qui
    expect(parseFieldValue('sqrt(larghezza) * 0 + max(1, 2)', params)).toMatchObject({ ok: true, v: 2 });
  });

  it('errori in italiano: vuoto, parametro sconosciuto, espressione non valida, parametro che non si calcola', () => {
    expect(parseFieldValue('', params)).toMatchObject({ ok: false, error: 'Scrivi un valore' });
    const unknown = parseFieldValue('altezza + 1', params);
    expect(unknown).toMatchObject({ ok: false });
    if (!unknown.ok) expect(unknown.error).toMatch(/Parametro sconosciuto: altezza/);
    const bad = parseFieldValue('larghezza +* 2', params);
    expect(bad).toMatchObject({ ok: false });
    const broken = parseFieldValue('rotto * 2', params);
    expect(broken).toMatchObject({ ok: false });
    if (!broken.ok) expect(broken.error).toMatch(/«rotto» non si calcola/);
    // Divisione per zero
    expect(parseFieldValue('larghezza / 0', params)).toMatchObject({ ok: false });
  });

  it('resolveLocal e paramText', () => {
    const { values, errors } = resolveLocal({ a: 2, b: 'a * 3', c: 'd', d: 'c' });
    expect(values).toMatchObject({ a: 2, b: 6 });
    expect(Object.keys(errors).sort()).toEqual(['c', 'd']);
    expect(paramText(12.5)).toBe('12.5');
    expect(paramText('a * 3')).toBe('a * 3');
    expect(parseParamValue('3,5')).toBe(3.5);
    expect(parseParamValue('a*2')).toBe('a*2');
    expect(parseParamValue('  ')).toBeNull();
  });
});

describe('parametri locali: crea, modifica, elimina', () => {
  it('addParam: nome valido e libero, valore numero o espressione; poi i nomi e i cicli si rifiutano', () => {
    let d = squared();
    d = must(addParam(d, 'larghezza', '40'));
    expect(d.params).toEqual({ larghezza: 40 });
    d = must(addParam(d, ' passo ', 'larghezza / 4'));
    expect(d.params).toEqual({ larghezza: 40, passo: 'larghezza / 4' });
    for (const bad of ['', '1a', 'a b', 'sin', 'PI', 'perché', 'x-y', 'module']) expect(addParam(d, bad, '1')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(addParam(d, 'larghezza', '5')).toMatchObject({ ok: false, message: 'Esiste già un parametro «larghezza»' });
    expect(addParam(d, 'altro', '')).toMatchObject({ ok: false });
    expect(addParam(d, 'altro', 'manca * 2')).toMatchObject({ ok: false });
    // Un ciclo (a usa b, b usa a) si rifiuta e dice quale parametro
    const cyc = addParam(must(addParam(d, 'a', '1')), 'b', 'a + 1');
    const loop = setParam(must(cyc), 'a', 'b + 1');
    expect(loop).toMatchObject({ ok: false });
    if (!loop.ok) expect(loop.message).toMatch(/circolare/);
  });

  it('addParam e setParam non toccano il disegno se nessuna quota li usa', () => {
    const d = squared();
    const out = must(addParam(d, 'x', '5'));
    expect(out.paths).toBe(d.paths);
    const changed = must(setParam(out, 'x', '7'));
    expect(changed.paths).toBe(d.paths);
    expect(changed.params).toEqual({ x: 7 });
  });

  it('setParam: le quote con espressione si rileggono e il disegno si risolve una volta', () => {
    const d = parametric();
    const out = must(setParam(d, 'larghezza', '80'));
    expect(pos(out, 'n2')[0]).toBeCloseTo(80, 6);
    expect(pos(out, 'n3')[0]).toBeCloseTo(80, 6);
    expect(out.constraints!.find((c) => c.expr === 'larghezza')!.v).toBe(80);
    // L'altezza dipende dal parametro altezza: non è cambiata
    expect(pos(out, 'n4')[1]).toBeCloseTo(20, 6);
    // Un parametro che usa un altro parametro si propaga: l'altezza segue «meta» che segue la larghezza
    const chained = must(addParam(out, 'meta', 'larghezza / 4'));
    const height = chained.constraints!.find((c) => c.expr === 'altezza/2*2')!;
    const linked = must(setQuoteText(chained, height.id, 'meta'));
    expect(linked.constraints!.find((c) => c.id === height.id)).toMatchObject({ v: 20, expr: 'meta' });
    const wider = must(setParam(linked, 'larghezza', '120'));
    expect(pos(wider, 'n4')[1]).toBeCloseTo(30, 6);
    expect(pos(wider, 'n2')[0]).toBeCloseTo(120, 6);
  });

  it('un parametro che renderebbe una quota non valida (zero, negativo) si rifiuta e non cambia nulla', () => {
    const d = parametric();
    const zero = setParam(d, 'larghezza', '0');
    expect(zero).toMatchObject({ ok: false, reason: 'invalid' });
    if (!zero.ok) expect(zero.message).toMatch(/larghezza/);
    const negative = setParam(d, 'larghezza', '-5');
    expect(negative).toMatchObject({ ok: false });
    // L'espressione di un parametro non valida (sintassi): rifiutata, il parametro resta com'era
    expect(setParam(d, 'larghezza', '3 +* 2')).toMatchObject({ ok: false });
    expect(setParam(d, 'larghezza', '40')).toMatchObject({ ok: false, message: 'Il valore è già quello' });
    expect(setParam(d, 'zzz', '4')).toMatchObject({ ok: false });
  });

  it('un parametro che il disegno non può rispettare (triangolo impossibile) si rifiuta e non cambia nulla', () => {
    let d: ParamGeometry = { paths: [{ closed: true, nodes: [{ id: 'n1', p: [0, 0], kind: 'corner' }, { id: 'n2', p: [40, 0], kind: 'corner' }, { id: 'n3', p: [40, 30], kind: 'corner' }] }], params: { c: 50 } };
    d = must(addFixed(d, ['n1']));
    d = must(addConstraint(d, { t: 'horizontal', p: ['n1', 'n2'] }));
    d = must(addConstraint(d, { t: 'dist', p: ['n1', 'n2'], v: 40 }));
    d = must(addConstraint(d, { t: 'dist', p: ['n2', 'n3'], v: 30 }));
    d = must(addConstraint(d, { t: 'dist', p: ['n1', 'n3'], v: 50, expr: 'c' }));
    // Con c = 60 il triangolo esiste (40, 30, 60 no: 40 + 30 > 60, sì): il disegno cambia
    expect(setParam(d, 'c', '60')).toMatchObject({ ok: true });
    // Con c = 100 no: non si applica e il parametro resta 50
    const out = setParam(d, 'c', '100');
    expect(out).toMatchObject({ ok: false });
    if (!out.ok) expect(['conflict', 'unsolved', 'redundant']).toContain(out.reason);
  });

  it('deleteParam: si toglie se nessuno lo usa; altrimenti dice chi lo usa', () => {
    let d = parametric();
    d = must(addParam(d, 'libero', '3'));
    d = must(addParam(d, 'derivato', 'larghezza / 2'));
    expect(paramUsers(d, 'larghezza')).toEqual({ quotes: [d.constraints!.find((c) => c.expr === 'larghezza')!.id], params: ['derivato'] });
    const used = deleteParam(d, 'larghezza');
    expect(used).toMatchObject({ ok: false, reason: 'invalid' });
    if (!used.ok) expect(used.message).toMatch(/usato da 1 quota e il parametro «derivato»/);
    const free = must(deleteParam(d, 'libero'));
    expect(free.params).not.toHaveProperty('libero');
    expect(deleteParam(d, 'nonc')).toMatchObject({ ok: false });
    // Tolto l'ultimo parametro il campo non c'è più
    const only = must(addParam(squared(), 'x', '1'));
    expect(must(deleteParam(only, 'x'))).not.toHaveProperty('params');
  });
});

describe('quote con espressione', () => {
  it('setQuoteText: un\'espressione con un parametro si ricorda e mostra ƒ; un numero la toglie', () => {
    const d = { ...squared(), params: { larghezza: 40 } } as ParamGeometry;
    const withQuote = must(addConstraint(d, { t: 'distX', p: ['n1', 'n2'], s: 1, v: 40 }));
    const id = withQuote.constraints!.at(-1)!.id;
    const expr = must(setQuoteText(withQuote, id, 'larghezza / 2 + 3'));
    const quote = expr.constraints!.find((c) => c.id === id)!;
    expect(quote).toMatchObject({ v: 23, expr: 'larghezza / 2 + 3' });
    expect(dimText(quote, expr.paths)).toBe('23 ƒ');
    expect(pos(expr, 'n2')[0]).toBeCloseTo(23, 6);
    // Un numero semplice toglie l'espressione
    const plain = must(setQuoteText(expr, id, '30'));
    expect(plain.constraints!.find((c) => c.id === id)).not.toHaveProperty('expr');
    expect(dimText(plain.constraints!.find((c) => c.id === id)!, plain.paths)).toBe('30');
    // Un calcolo senza parametri non è un'espressione da ricordare
    const calc = must(setQuoteText(expr, id, '10 * 3'));
    expect(calc.constraints!.find((c) => c.id === id)).not.toHaveProperty('expr');
    expect(calc.constraints!.find((c) => c.id === id)!.v).toBe(30);
    // Errori: non cambia nulla
    expect(setQuoteText(expr, id, 'sconosciuto * 2')).toMatchObject({ ok: false });
    expect(setQuoteText(expr, id, 'larghezza - 40')).toMatchObject({ ok: false, message: 'La misura deve essere maggiore di zero' });
    expect(setQuoteText(expr, 'zz', '3')).toMatchObject({ ok: false });
  });

  it('una quota angolare con espressione si rilegge con il parametro (e lo 0 tra lati con un nodo in comune si rifiuta)', () => {
    let d: ParamGeometry = { paths: [{ closed: false, nodes: [{ id: 'n1', p: [0, 0], kind: 'corner' }, { id: 'n2', p: [40, 0], kind: 'corner' }, { id: 'n3', p: [40, 20], kind: 'corner' }] }], params: { apertura: 90 } };
    d = must(addFixed(d, ['n1', 'n2']));
    const dim = createAngleDimension(d.paths, ['n1', 'n2'], ['n2', 'n3'], 10) as Omit<ProfileConstraint, 'id'>;
    d = must(addConstraint(d, { ...dim, v: 90, expr: 'apertura' }));
    const out = must(setParam(d, 'apertura', '60'));
    expect(out.constraints!.at(-1)!.v).toBeCloseTo(60, 6);
    const zero = setParam(d, 'apertura', '0');
    expect(zero).toMatchObject({ ok: false });
    if (!zero.ok) expect(zero.message).toMatch(/sovrappor/);
  });

  it('il diametro di un cerchio con espressione: il parametro dà il diametro, la quota salva il raggio', () => {
    const base = addCircle({ paths: [], params: { foro: 10 } } as ParamGeometry, [0, 0], 5, 8);
    if (typeof base === 'string') throw new Error(base);
    const id = base.quote;
    const expr = must(setQuoteText(base.draft, id, 'foro + 2'));
    expect(expr.constraints!.find((c) => c.id === id)).toMatchObject({ v: 6, expr: 'foro + 2', dia: true });
    expect(dimText(expr.constraints!.find((c) => c.id === id)!, expr.paths)).toBe('Ø12 ƒ');
    const out = must(setParam(expr, 'foro', '20'));
    expect(out.constraints!.find((c) => c.id === id)!.v).toBe(11);
    expect(out.paths[0].nodes[0].p[0] - out.paths[0].circ!.p[0]).toBeCloseTo(11, 6);
    // Il centro non si è mosso (il nodo sul bordo si porta al nuovo raggio prima di risolvere)
    expect(out.paths[0].circ!.p).toEqual([0, 0]);
  });

  it('applyParams senza quote con espressione non risolve nulla; setCommonValue toglie l\'espressione', () => {
    const d = squared();
    const out = must(applyParams(d, { k: 3 }));
    expect(out.paths).toBe(d.paths);
    expect(out.params).toEqual({ k: 3 });
  });
});

describe('i limiti dell\'editor sono quelli dei sanitizzatori (niente che sparisca alla riapertura)', () => {
  it('addParam rifiuta i nomi che sanitizeParams scarterebbe: oltre 32 caratteri, __proto__, constructor, prototype', () => {
    const d = squared();
    expect(addParam(d, 'a'.repeat(33), '1')).toMatchObject({ ok: false, message: 'Il nome è troppo lungo: al massimo 32 caratteri' });
    expect(addParam(d, 'a'.repeat(32), '1')).toMatchObject({ ok: true });
    for (const bad of ['__proto__', 'constructor', 'prototype']) expect(addParam(d, bad, '1')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('un valore fuori misura o un\'espressione oltre 200 caratteri si rifiuta (parametri e quote)', () => {
    const d = squared();
    expect(addParam(d, 'x', '200000')).toMatchObject({ ok: false, message: 'Il valore deve essere un numero entro ±100000' });
    const longExpr = `1${' + 1'.repeat(80)}`;
    expect(longExpr.length).toBeGreaterThan(200);
    expect(addParam(d, 'x', longExpr)).toMatchObject({ ok: false });
    const withX = must(addParam(d, 'x', '3'));
    expect(setParam(withX, 'x', longExpr)).toMatchObject({ ok: false });
    // Una quota con un'espressione che usa un parametro e supera il limite
    const quoteExpr = `x${' + x'.repeat(100)}`;
    expect(parseFieldValue(quoteExpr, withX.params)).toMatchObject({ ok: false });
    // Un calcolo lungo senza parametri non si ricorda: nessun limite da rispettare
    expect(parseFieldValue(`1${' + 1'.repeat(80)}`, withX.params)).toMatchObject({ ok: true, v: 81 });
  });

  it('ciò che l\'editor accetta sopravvive a sanitizeParams e sanitizeConstraints senza cambiare', () => {
    let d = squared();
    d = must(addParam(d, 'larghezza', '40'));
    d = must(addParam(d, 'meta', 'larghezza / 2'));
    d = must(addParam(d, 'q'.repeat(32), '12,5'));
    d = must(addConstraint(d, { t: 'distX', p: ['n1', 'n2'], s: 1, v: 40, expr: 'larghezza' }));
    d = must(setQuoteText(d, d.constraints!.at(-1)!.id, 'meta * 2 + 3'));
    expect(sanitizeParams(d.params)).toEqual(d.params);
    expect(sanitizeConstraints(d.constraints, d.paths)).toEqual(d.constraints!.map((c) => ({ ...c })).filter(() => true));
  });
});
