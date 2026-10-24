import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dimText, fmtDim } from './dimPlacement';
import { QuoteOverlay, quoteLabelPoint } from './QuoteOverlay';
import type { PathContour, ProfileConstraint, Vec2 } from '../../scene/types';

/** Rettangolo 40 x 20 con id n1..n4. */
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
/** 10 pixel per mm, Y verso il basso come nello schermo. */
const toS = (p: Vec2): Vec2 => [100 + p[0] * 10, 300 - p[1] * 10];

const width: ProfileConstraint = { id: 'k1', t: 'dist', p: ['n1', 'n2'], v: 40, off: -3, at: 0.5 };
const horizontal: ProfileConstraint = { id: 'k2', t: 'horizontal', p: ['n1', 'n2'] };
const fixed: ProfileConstraint = { id: 'k3', t: 'fixed', p: ['n1'], x: 0, y: 0 };

type Props = Parameters<typeof QuoteOverlay>[0];
const render = (patch: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement('svg', null, createElement(QuoteOverlay, { paths, constraints: [], toS, pxPerMm: 10, bad: new Set<string>(), flash: new Set<string>(), selected: null, draft: null, pick: [], ...patch })),
  );

describe('testi delle quote', () => {
  it('numeri con la virgola e al più due decimali; le quote di riferimento tra parentesi; l\'angolo con i gradi', () => {
    expect(fmtDim(12.3456)).toBe('12,35');
    expect(fmtDim(40)).toBe('40');
    expect(dimText(width, paths)).toBe('40');
    expect(dimText({ ...width, ref: true }, paths)).toBe('(40)');
    expect(dimText({ id: 'k', t: 'angle', p: ['n1', 'n2'], v: 45 }, paths)).toBe('45°');
  });

  it('il centro dell\'etichetta è in pixel, sulla linea di quota', () => {
    // Linea a 3 mm sotto il lato in basso: a metà, 30 pixel sotto il lato (la Y dello schermo cresce verso il basso)
    expect(quoteLabelPoint(width, paths, toS, 10)).toEqual([300, 330]);
    expect(quoteLabelPoint({ ...width, p: ['n1', 'n9'] }, paths, toS, 10)).toBeNull();
  });
});

describe('livello delle quote', () => {
  it('senza vincoli non disegna nulla (solo il gruppo vuoto)', () => {
    const html = render();
    expect(html).toContain('data-quotes');
    expect(html).not.toContain('data-qid');
  });

  it('una quota ha linea di quota con frecce, etichetta cliccabile con il valore e data-qid', () => {
    const html = render({ constraints: [width] });
    expect(html).toContain('data-quote-label="k1"');
    expect(html).toContain('data-qid="k1"');
    expect(html).toMatch(/<text[^>]*>40<\/text>/);
    // Linea di richiamo, linea di quota e due frecce: un solo path con più comandi
    expect(html).toMatch(/<path d="M[^"]+L[^"]+"/);
  });

  it('la linea di quota ha un tracciato largo da afferrare (data-qline), la quota in attesa e i vincoli no', () => {
    const html = render({ constraints: [width, horizontal], draft: { con: { ...width, id: 'draft' }, paths } });
    expect(html.match(/data-qline="/g)).toHaveLength(1);
    expect(html).toContain('data-qline="k1"');
    expect(html).not.toContain('data-qline="draft"');
  });

  it('una quota di riferimento mostra la misura tra parentesi, anche se i nodi sono stati spostati', () => {
    const moved: PathContour[] = [{ closed: true, nodes: paths[0].nodes.map((n) => (n.id === 'n2' ? { ...n, p: [50, 0] as Vec2 } : n)) }];
    const html = render({ paths: moved, constraints: [{ id: 'r1', t: 'dist', p: ['n1', 'n2'], ref: true, off: -3 }] });
    expect(html).toMatch(/<text[^>]*>\(50\)<\/text>/);
  });

  it('una quota angolare è un arco con l\'etichetta in gradi, la linea da afferrare e i colori di stato come le altre', () => {
    const corner: ProfileConstraint = { id: 'a1', t: 'angle', p: ['n2', 'n3', 'n2', 'n1'], v: 90, off: 4, at: 0.5 };
    const html = render({ constraints: [corner] });
    expect(html).toMatch(/<text[^>]*>90°<\/text>/);
    expect(html).toContain('data-quote-label="a1"');
    expect(html).toContain('data-qline="a1"');
    // Un arco: molti segmenti L sulla stessa curva
    expect(html.match(/L[\d.-]+ [\d.-]+/g)!.length).toBeGreaterThan(20);
    expect(render({ constraints: [{ ...corner, ref: true }] })).toMatch(/<text[^>]*>\(90°\)<\/text>/);
    expect(render({ constraints: [corner], bad: new Set(['a1']) })).toContain('profile-editor__qlabel--err');
    expect(render({ constraints: [corner], selected: 'a1' })).toContain('profile-editor__dim--sel');
    // Con due punti c'è anche la semiretta di riferimento sull'asse X; non c'è l'icona di un vincolo
    const axis = render({ constraints: [{ id: 'a2', t: 'angle', p: ['n1', 'n3'], v: 26.57, off: 4 }] });
    expect(axis).not.toContain('data-constraint-glyph');
    expect(quoteLabelPoint(corner, paths, toS, 10)).not.toBeNull();
  });

  it('stati: di riferimento, scelta, in conflitto (anche dopo un rifiuto) e nuova', () => {
    expect(render({ constraints: [{ ...width, ref: true }] })).toContain('profile-editor__qlabel--ref');
    expect(render({ constraints: [{ ...width, ref: true }] })).toContain('profile-editor__dim--ref');
    expect(render({ constraints: [width], selected: 'k1' })).toContain('profile-editor__qlabel--sel');
    expect(render({ constraints: [width], bad: new Set(['k1']) })).toContain('profile-editor__qlabel--err');
    expect(render({ constraints: [width], flash: new Set(['k1']) })).toContain('profile-editor__dim--err');
    const draft = render({ draft: { con: { ...width, id: 'draft' }, paths } });
    expect(draft).toContain('profile-editor__qlabel--draft');
    expect(draft).toContain('data-quote-label="draft"');
  });

  it('un vincolo geometrico è un\'icona con la sua sigla, accanto al segmento o al nodo, con il nome nel titolo', () => {
    const html = render({ constraints: [horizontal, fixed] });
    expect(html).toContain('data-constraint-glyph="horizontal"');
    expect(html).toContain('data-constraint-glyph="fixed"');
    expect(html).toMatch(/<text[^>]*>H<\/text>/);
    expect(html).toMatch(/<text[^>]*>F<\/text>/);
    expect(html).toContain('<title>Orizzontale P1.1-P1.2</title>');
    // Due icone sullo stesso segmento si affiancano: due cerchi con centri diversi
    const two = render({ constraints: [horizontal, { id: 'k9', t: 'vertical', p: ['n1', 'n2'] }] });
    const centres = [...two.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => m[1]);
    expect(centres).toHaveLength(2);
    expect(new Set(centres).size).toBe(2);
  });

  it('i vincoli che citano nodi mancanti non si disegnano; i nodi scelti hanno un anello', () => {
    const html = render({ constraints: [{ ...width, p: ['n1', 'n9'] }], pick: [{ path: 0, node: 1 }, { path: 4, node: 0 }] });
    expect(html).not.toContain('data-qid');
    expect(html).toContain('profile-editor__qring');
    expect(html.match(/profile-editor__qring/g)).toHaveLength(1);
  });

  it('quote orizzontale e verticale: etichetta a metà, valori diversi', () => {
    const html = render({
      constraints: [
        { id: 'a', t: 'distX', p: ['n1', 'n2'], v: 40, s: 1, off: -3 },
        { id: 'b', t: 'distY', p: ['n2', 'n3'], v: 20, s: 1, off: 3 },
      ],
    });
    expect(html).toMatch(/<text[^>]*>40<\/text>/);
    expect(html).toMatch(/<text[^>]*>20<\/text>/);
    expect(html).toContain('data-quote-label="a"');
    expect(html).toContain('data-quote-label="b"');
  });
});
