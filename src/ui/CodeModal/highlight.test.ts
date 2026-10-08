import { describe, expect, it } from 'vitest';
import { tokenizeLine } from './highlight';

/** Coppie "genere:testo" dei soli segmenti non vuoti e non semplici spazi. */
const kinds = (line: string) => tokenizeLine(line).filter((t) => t.text.trim()).map((t) => `${t.kind}:${t.text}`);

describe('tokenizeLine', () => {
  it('riconosce funzioni, parametri e numeri', () => {
    expect(kinds('cylinder(h = 20, r = 10.5, $fn = 64);')).toEqual([
      'function:cylinder', 'punct:(', 'param:h', 'punct:=', 'number:20', 'punct:,',
      'param:r', 'punct:=', 'number:10.5', 'punct:,', 'param:$fn', 'punct:=', 'number:64', 'punct:)', 'punct:;',
    ]);
  });

  it('riconosce le parole chiave e i commenti fino a fine riga', () => {
    expect(kinds('cube(size, center = true); // un cubo')).toEqual([
      'function:cube', 'punct:(', 'text:size', 'punct:,', 'keyword:center', 'punct:=', 'keyword:true', 'punct:)', 'punct:;', 'comment:// un cubo',
    ]);
  });

  it('numeri negativi e vettori', () => {
    expect(kinds('translate([-5, 0, 2.5])')).toEqual([
      'function:translate', 'punct:(', 'punct:[', 'punct:-', 'number:5', 'punct:,', 'number:0', 'punct:,', 'number:2.5', 'punct:]', 'punct:)',
    ]);
  });

  it('conserva l indentazione e ricompone la riga identica', () => {
    const line = '    translate([1, 2, 3]) color([0.3, 0.6, 1]) sphere(r = 4);';
    expect(tokenizeLine(line).map((t) => t.text).join('')).toBe(line);
  });

  it('una riga vuota non produce segmenti', () => {
    expect(tokenizeLine('')).toEqual([]);
  });

  it('un commento di sola riga è un unico segmento', () => {
    expect(tokenizeLine('// Generato da Construct. Unità: millimetri.')).toEqual([{ kind: 'comment', text: '// Generato da Construct. Unità: millimetri.' }]);
  });
});
