import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExprField } from './ExprField';
import { ParamsPanel } from './ParamsPanel';
import type { ParamsPanelProps } from './ParamsPanel';

const noop = () => {};
const render = (patch: Partial<ParamsPanelProps> = {}) =>
  renderToStaticMarkup(createElement(ParamsPanel, { params: undefined, usedBy: () => 0, onAdd: () => true, onSet: noop, onDelete: noop, ...patch }));

describe('sezione Parametri', () => {
  it('senza parametri: il suggerimento e la riga per aggiungerne uno', () => {
    const html = render();
    expect(html).toContain('data-params-panel');
    expect(html).toContain('Nessun parametro');
    expect(html).toContain('aria-label="Nome del nuovo parametro"');
    expect(html).toContain('aria-label="Valore del nuovo parametro"');
    expect(html).toContain('data-param-add');
    expect(html).not.toContain('data-param=');
  });

  it('un elenco con nome, valore (numero o espressione con ƒ e il valore calcolato) ed eliminazione', () => {
    const html = render({ params: { larghezza: 40, passo: 'larghezza / 4' }, usedBy: (name) => (name === 'larghezza' ? 2 : 0) });
    expect(html).toContain('data-param="larghezza"');
    expect(html).toContain('data-param="passo"');
    expect(html).toMatch(/aria-label="Valore del parametro larghezza"[^>]*value="40"/);
    // L'espressione sta nel campo, con ƒ e il valore calcolato (40 / 4 = 10)
    expect(html).toMatch(/aria-label="Valore del parametro passo"[^>]*value="larghezza \/ 4"/);
    expect(html).toContain('ƒ = 10');
    expect(html).toContain('aria-label="Elimina il parametro larghezza"');
    expect(html).toContain('Usato da 2 quote o parametri');
    expect(html).toContain('title="Non usato"');
    expect(html).not.toContain('Nessun parametro');
  });
});

describe('campo con espressione', () => {
  it('spento e con valori diversi (mixed), come il Raggio nella sezione del nodo', () => {
    const off = renderToStaticMarkup(createElement(ExprField, { label: 'Raggio', unit: 'mm', value: 0, disabled: true, onCommit: noop }));
    expect(off).toContain('disabled');
    const mixed = renderToStaticMarkup(createElement(ExprField, { label: 'Raggio', unit: 'mm', value: 0, mixed: true, onCommit: noop }));
    expect(mixed).toContain('placeholder="—"');
    expect(mixed).toContain('value=""');
  });

  it('un numero si mostra com\'è, senza ƒ; con un\'espressione si vede il testo scritto, ƒ e il valore', () => {
    const plain = renderToStaticMarkup(createElement(ExprField, { label: 'Valore', ariaLabel: 'Valore di X', unit: 'mm', value: 12.3456, onCommit: noop }));
    expect(plain).toContain('value="12.346"');
    expect(plain).not.toContain('ƒ');
    expect(plain).not.toContain('data-expr-field');
    const expr = renderToStaticMarkup(createElement(ExprField, { label: 'Valore', ariaLabel: 'Valore di X', unit: 'mm', value: 43, expr: 'larghezza/2 + 3', onCommit: noop }));
    expect(expr).toContain('value="larghezza/2 + 3"');
    expect(expr).toContain('ƒ = 43');
    expect(expr).toContain('data-expr-field');
    expect(expr).toContain('mm');
  });
});
