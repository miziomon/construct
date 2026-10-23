import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConstraintsPanel } from './ConstraintsPanel';
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
const render = (patch: Partial<ConstraintsPanelProps> = {}) =>
  renderToStaticMarkup(createElement(ConstraintsPanel, { paths, constraints: [], selectedNodes: 0, bad: new Set<string>(), selected: null, onSelect: noop, onApply: noop, onValue: noop, onDelete: noop, ...patch }));

/** Il pulsante di un vincolo (il suo tag di apertura) nel markup. */
const button = (html: string, type: string) => html.match(new RegExp(`<button[^>]*data-constraint-button="${type}"[^>]*>`))![0];

describe('sezione Quote e vincoli', () => {
  it('senza nodi scelti i pulsanti sono spenti e c\'è il suggerimento; l\'elenco è vuoto', () => {
    const html = render();
    for (const type of ['horizontal', 'vertical', 'fixed', 'coincident']) expect(button(html, type)).toContain('disabled');
    expect(html).toContain('Scegli dei nodi con Seleziona');
    expect(html).toContain('Nessuna quota né vincolo.');
    expect(html).not.toContain('data-constraint=');
  });

  it('con un nodo scelto si accende solo Fisso; con due nodi tutti e quattro; con tre solo Fisso', () => {
    const one = render({ selectedNodes: 1 });
    expect(button(one, 'fixed')).not.toContain('disabled');
    expect(button(one, 'horizontal')).toContain('disabled');
    const two = render({ selectedNodes: 2 });
    for (const type of ['horizontal', 'vertical', 'fixed', 'coincident']) expect(button(two, type)).not.toContain('disabled');
    const three = render({ selectedNodes: 3 });
    expect(button(three, 'fixed')).not.toContain('disabled');
    expect(button(three, 'coincident')).toContain('disabled');
    expect(three).toContain('3 nodi scelti.');
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
    expect(html).toContain('aria-label="Elimina Lunghezza P1.2-P1.3"');
    // Il valore di una quota pilotante è un campo; il vincolo geometrico non ne ha; la quota di riferimento mostra solo la misura
    expect(html.match(/number-field__input/g)).toHaveLength(1);
    expect(html).toContain('value="20"');
    expect(html).toContain('quota di riferimento');
    expect(html).toContain('(44,72 mm)');
    // Stati della riga
    expect(html).toContain('profile-editor__constraint--selected');
    expect(html).toContain('profile-editor__constraint--bad');
  });
});
