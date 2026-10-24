import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NodeSection } from './Sidebar';
import type { PathContour, PathNode } from '../../scene/types';

const corner = (p: [number, number], extra: Partial<PathNode> = {}): PathNode => ({ p, kind: 'corner', ...extra });
const square = (r?: number): PathContour[] => [{ closed: true, nodes: [corner([0, 0]), corner([40, 0]), corner([40, 40], r ? { r } : {}), corner([0, 40])] }];
const noop = () => {};
const render = (paths: PathContour[], node: number, withRadius = true) =>
  renderToStaticMarkup(createElement(NodeSection, { paths, selection: [{ path: 0, node }], onKind: noop, onRadius: withRadius ? noop : undefined, onCoordinate: noop, onHandle: noop }));

describe('campo Raggio nella sezione del nodo', () => {
  it('uno spigolo tra due segmenti retti ha il campo acceso con il valore; senza raggio vale zero e nessuna nota', () => {
    const html = render(square(5), 2);
    expect(html).toContain('data-fillet');
    expect(html).toMatch(/<span class="number-field__label">Raggio<\/span><input[^>]*value="5"/);
    expect(html).not.toMatch(/data-fillet[^>]*>.*?<input[^>]*disabled/s);
    expect(html).not.toContain('data-fillet-note');
    expect(render(square(), 2)).toMatch(/Raggio<\/span><input[^>]*value="0"/);
  });

  it('un raggio troppo grande per i segmenti dice a quanto si riduce', () => {
    const html = render(square(500), 2);
    expect(html).toContain('data-fillet-note');
    expect(html).toContain('Raggio ridotto a 40 mm: i segmenti non bastano');
  });

  it('un nodo che non può raccordarsi ha il campo spento e il motivo', () => {
    const open: PathContour[] = [{ closed: false, nodes: [corner([0, 0]), corner([40, 0]), corner([40, 40])] }];
    const end = render(open, 0);
    expect(end).toMatch(/Raggio<\/span><input[^>]*disabled/);
    expect(end).toContain('Il raccordo vale per un nodo con un segmento prima e uno dopo');
    const smooth: PathContour[] = [{ closed: true, nodes: [corner([0, 0]), corner([40, 0]), { p: [40, 40], kind: 'smooth' }, corner([0, 40])] }];
    // Un nodo liscio non è uno spigolo: il campo non c'è
    expect(render(smooth, 2)).not.toContain('data-fillet');
    // Uno spigolo con una maniglia sì, ma spento
    const handled: PathContour[] = [{ closed: true, nodes: [corner([0, 0]), corner([40, 0]), { p: [40, 40], in: [0, -5], kind: 'corner' }, corner([0, 40])] }];
    expect(render(handled, 2)).toContain('Il raccordo vale per uno spigolo senza maniglie');
    const curved: PathContour[] = [{ closed: true, nodes: [corner([0, 0]), { p: [40, 0], out: [5, 5], kind: 'corner' }, corner([40, 40]), corner([0, 40])] }];
    expect(render(curved, 2)).toContain('Il raccordo vale tra due segmenti retti');
  });

  it('senza `onRadius` (la sagoma) il campo non c\'è', () => {
    expect(render(square(5), 2, false)).not.toContain('data-fillet');
  });
});

describe('campi comuni con più nodi scelti', () => {
  const pair = (paths: PathContour[], nodes: number[]) => renderToStaticMarkup(createElement(NodeSection, { paths, selection: nodes.map((node) => ({ path: 0, node })), onKind: noop, onRadius: noop, onCoordinate: noop, onHandle: noop }));
  const rects = (radii: number[]): PathContour[] => [{ closed: true, nodes: [corner([0, 0], radii[0] ? { r: radii[0] } : {}), corner([40, 0], radii[1] ? { r: radii[1] } : {}), corner([40, 40], radii[2] ? { r: radii[2] } : {}), corner([0, 40])] }];

  it('il raggio è uno solo per tutti gli spigoli compatibili: il valore comune se uguale, vuoto con «—» se diverso', () => {
    const same = pair(rects([5, 5, 0]), [0, 1]);
    expect(same).toContain('data-fillet');
    expect(same).toMatch(/Raggio<\/span><input[^>]*value="5"/);
    expect(same).toContain('2 di 2 nodi possono raccordarsi');
    const mixed = pair(rects([5, 8, 0]), [0, 1]);
    expect(mixed).toMatch(/Raggio<\/span><input[^>]*placeholder="—"[^>]*value=""|Raggio<\/span><input[^>]*value=""[^>]*placeholder="—"/);
    // Con un nodo senza raggio e uno con: diversi
    expect(pair(rects([5, 0, 0]), [0, 1])).toMatch(/placeholder="—"/);
    // Il tipo resta comune
    expect(same).toContain('2 nodi selezionati: il tipo e il raggio valgono per tutti');
  });

  it('conta solo i nodi compatibili; se nessuno lo è il campo non c\'è', () => {
    const open: PathContour[] = [{ closed: false, nodes: [corner([0, 0]), corner([40, 0]), corner([40, 40])] }];
    const html = pair(open, [0, 1]);
    expect(html).toContain('1 di 2 nodi possono raccordarsi');
    expect(pair(open, [0, 2])).not.toContain('data-fillet');
    expect(pair(rects([0, 0, 0]), [0, 1])).toContain('value="0"');
  });
});
