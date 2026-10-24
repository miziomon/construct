import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConstraintsPanel } from './ConstraintsPanel';
import { SELECTION_CONSTRAINTS, canApplyConstraint, selectionItems } from './dimensions';
import type { SelectionConstraint } from './dimensions';
import type { ConstraintsPanelProps } from './ConstraintsPanel';
import type { PathContour, ProfileConstraint } from '../../scene/types';

const paths: PathContour[] = [
  {
    closed: true,
    nodes: [
      { id: 'n1', p: [0, 0], kind: 'corner' },
      { id: 'n2', p: [40, 0], kind: 'corner' },
      { id: 'n3', p: [40, 20], kind: 'corner' },
    ],
  },
];
const noop = () => {};
/** Quali pulsanti si accendono con i nodi (indici) e i segmenti scelti nel triangolo di prova. */
const canFor = (nodes: number[], segments: number[]): Record<SelectionConstraint, boolean> => {
  const items = selectionItems(paths, nodes.map((node) => ({ path: 0, node })), segments.map((segment) => ({ path: 0, segment })));
  return Object.fromEntries(SELECTION_CONSTRAINTS.map((t) => [t, canApplyConstraint(t, items)])) as Record<SelectionConstraint, boolean>;
};
const render = (patch: Partial<ConstraintsPanelProps> = {}) =>
  renderToStaticMarkup(createElement(ConstraintsPanel, { paths, constraints: [], can: canFor([], []), selectionText: '', bad: new Set<string>(), selected: null, onSelect: noop, onApply: noop, onValue: noop, onDelete: noop, onReposition: noop, ...patch }));

/** Il pulsante di un vincolo (il suo tag di apertura) nel markup. */
const button = (html: string, type: string) => html.match(new RegExp(`<button[^>]*data-constraint-button="${type}"[^>]*>`))![0];

describe('sezione Quote e vincoli', () => {
  it('senza nodi scelti i pulsanti sono spenti e c\'è il suggerimento; l\'elenco è vuoto', () => {
    const html = render();
    for (const type of SELECTION_CONSTRAINTS) expect(button(html, type)).toContain('disabled');
    expect(html).toContain('Scegli dei nodi con Seleziona');
    expect(html).toContain('Nessuna quota né vincolo.');
    expect(html).not.toContain('data-constraint=');
  });

  it('i pulsanti si accendono secondo ciò che è scelto: un nodo, due nodi, un segmento, due segmenti, nodo e segmento, due nodi e un segmento', () => {
    const on = (html: string) => SELECTION_CONSTRAINTS.filter((t) => !button(html, t).includes('disabled'));
    expect(on(render({ can: canFor([0], []), selectionText: '1 nodo scelto.' }))).toEqual(['fixed']);
    expect(on(render({ can: canFor([0, 1], []) }))).toEqual(['horizontal', 'vertical', 'fixed', 'coincident']);
    // Un segmento (Alt+clic): orizzontale e verticale e fisso, non coincidente
    expect(on(render({ can: canFor([0, 1], [0]) }))).toEqual(['horizontal', 'vertical', 'fixed']);
    // Due segmenti: parallelo, perpendicolare, uguale, collineare, fisso
    expect(on(render({ can: canFor([0, 1, 2], [0, 1]) }))).toEqual(['fixed', 'parallel', 'perpendicular', 'equal', 'collinear']);
    // Un nodo e un segmento: punto medio; due nodi e un segmento: simmetrico
    expect(on(render({ can: canFor([0, 1, 2], [0]) }))).toEqual(['fixed', 'midpoint']);
    expect(on(render({ can: canFor([0, 1, 2], [0]) }))).not.toContain('symmetric');
    expect(button(render({ can: canFor([0, 1], []) }), 'parallel')).toContain('disabled');
    // Il testo della selezione e i suggerimenti dei pulsanti
    expect(render({ can: canFor([0, 1], []), selectionText: '2 nodi scelti.' })).toContain('2 nodi scelti.');
    const html = render();
    expect(html).toContain('Serve: due segmenti (Alt+clic, poi Maiusc+Alt+clic sul secondo)');
    expect(html).toContain('Serve: un nodo e un segmento (Alt+clic)');
    expect(html).toContain('Serve: due nodi e un segmento (Alt+clic) che fa da asse');
  });

  it('l\'elenco ha una riga per vincolo con il nome, il pulsante Elimina e per le quote il valore', () => {
    const constraints: ProfileConstraint[] = [
      { id: 'k1', t: 'horizontal', p: ['n1', 'n2'] },
      { id: 'k2', t: 'dist', p: ['n2', 'n3'], v: 20 },
      { id: 'k3', t: 'dist', p: ['n1', 'n3'], ref: true },
    ];
    const html = render({ constraints, selected: 'k2', bad: new Set(['k1']) });
    expect(html.match(/data-constraint="/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Elimina Orizzontale P1.1-P1.2"');
    expect(html).toContain('aria-label="Elimina Distanza P1.2-P1.3"');
    // Il campo del valore ha un nome che lo distingue dagli altri dell'elenco
    expect(html).toContain('aria-label="Valore di Distanza P1.2-P1.3"');
    // Nessun limite che porti in silenzio un valore a un altro: il campo non ha min né max (la validazione dà il messaggio)
    expect(html).not.toContain('min=');
    // Il valore di una quota pilotante è un campo; il vincolo geometrico non ne ha; la quota di riferimento mostra solo la misura
    expect(html.match(/number-field__input/g)).toHaveLength(1);
    expect(html).toContain('value="20"');
    expect(html).toContain('quota di riferimento');
    expect(html).toContain('(44,72 mm)');
    // Stati della riga
    expect(html).toContain('profile-editor__constraint--selected');
    expect(html).toContain('profile-editor__constraint--bad');
  });

  it('Riposiziona quote c\'è solo se ci sono quote di lunghezza (non per i soli vincoli o per le quote di riferimento senza linea)', () => {
    expect(render()).not.toContain('data-reposition');
    expect(render({ constraints: [{ id: 'k1', t: 'horizontal', p: ['n1', 'n2'] }] })).not.toContain('data-reposition');
    expect(render({ constraints: [{ id: 'k2', t: 'dist', p: ['n1', 'n2'], v: 40 }] })).toContain('data-reposition');
  });
});
