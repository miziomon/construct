import { describe, expect, it } from 'vitest';
import { parseStl } from './stl';
import { writeStl } from '../kernel/export/stl';
import { ImportError } from './types';

// Cubo di lato 2 centrato nell'origine: 8 vertici, 12 triangoli
const cubePositions = new Float32Array([-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]);
const cubeIndices = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);

describe('parseStl', () => {
  it('legge un STL binario e condivide i vertici coincidenti', () => {
    const bytes = writeStl(cubePositions, cubeIndices);
    const [mesh] = parseStl(bytes.buffer, 'cubo');
    expect(mesh.name).toBe('cubo');
    expect(mesh.indices.length / 3).toBe(12);
    expect(mesh.positions.length / 3).toBe(8); // l'STL ne scrive 36, il parser li riunisce
  });

  it('legge un STL ASCII', () => {
    const text = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
facet normal 0 0 1
 outer loop
  vertex 1 0 0
  vertex 1 1 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
    const [mesh] = parseStl(new TextEncoder().encode(text).buffer, 'quadrato');
    expect(mesh.indices.length / 3).toBe(2);
    expect(mesh.positions.length / 3).toBe(4);
  });

  it('rifiuta file vuoti o troncati con un errore leggibile', () => {
    expect(() => parseStl(new TextEncoder().encode('solid vuoto\nendsolid').buffer, 'x')).toThrow(ImportError);
    const truncated = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nendloop\nendfacet';
    expect(() => parseStl(new TextEncoder().encode(truncated).buffer, 'x')).toThrow(/incompleto/);
  });
});
