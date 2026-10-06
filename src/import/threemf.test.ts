// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parse3mf } from './threemf';
import { write3mf } from '../kernel/export/threemf';
import { ImportError } from './types';

const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]);
const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]);

/** Costruisce un pacchetto 3MF minimale con il contenuto XML indicato. */
function pack(modelXml: string): ArrayBuffer {
  return zipSync({ '3D/3dmodel.model': strToU8(modelXml) }).buffer as ArrayBuffer;
}

const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"';
// Tetraedro con un vertice nell'origine e gli altri a 10 mm lungo gli assi
const TETRA =
  '<mesh><vertices>' +
  '<vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>' +
  '</vertices><triangles>' +
  '<triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/>' +
  '</triangles></mesh>';

describe('parse3mf', () => {
  it('rilegge un file scritto da write3mf (round-trip) con nome e colore', () => {
    const bytes = write3mf([{ name: 'Tetraedro', color: '#ff8800', positions, indices }]);
    const [mesh] = parse3mf(bytes.buffer, 'file');
    expect(mesh.name).toBe('Tetraedro');
    expect(mesh.color).toBe('#ff8800');
    expect(mesh.indices.length / 3).toBe(4);
    expect(Array.from(mesh.positions)).toEqual(Array.from(positions));
  });

  it('converte le unità in millimetri e applica la trasformazione della voce di build', () => {
    // Unità in pollici; la voce di build trasla di 1 pollice in X (riga di traslazione m30 = 1)
    const xml = `<model unit="inch" ${NS}><resources><object id="1" name="Pezzo" type="model">${TETRA}</object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 1 0 0"/></build></model>`;
    const [mesh] = parse3mf(pack(xml), 'f');
    // Il vertice 1 era (10, 0, 0): (10 + 1) pollici = 279,4 mm
    expect(mesh.positions[3]).toBeCloseTo(11 * 25.4, 3);
    expect(mesh.positions[0]).toBeCloseTo(25.4, 3);
  });

  it('appiattisce i componenti con le loro trasformazioni', () => {
    const xml =
      `<model unit="millimeter" ${NS}><resources>` +
      `<object id="1" type="model">${TETRA}</object>` +
      '<object id="2" name="Assieme" type="model"><components><component objectid="1"/>' +
      '<component objectid="1" transform="1 0 0 0 1 0 0 0 1 100 0 0"/></components></object>' +
      '</resources><build><item objectid="2"/></build></model>';
    const [mesh] = parse3mf(pack(xml), 'f');
    expect(mesh.name).toBe('Assieme');
    expect(mesh.indices.length / 3).toBe(8);
    expect(Math.max(...Array.from(mesh.positions).filter((_, i) => i % 3 === 0))).toBeCloseTo(110, 3);
  });

  it('segnala archivi, XML e indici non validi con messaggi chiari', () => {
    expect(() => parse3mf(new TextEncoder().encode('non è uno zip').buffer, 'x')).toThrow(ImportError);
    expect(() => parse3mf(zipSync({ 'altro.txt': strToU8('x') }).buffer as ArrayBuffer, 'x')).toThrow(/modello/);
    expect(() => parse3mf(pack('<model><oggetto></model>'), 'x')).toThrow(/XML/);
    const bad =
      `<model ${NS}><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices>` +
      '<triangles><triangle v1="0" v2="5" v3="9"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
    expect(() => parse3mf(pack(bad), 'x')).toThrow(/indici/);
  });
});
