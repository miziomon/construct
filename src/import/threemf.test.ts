// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parse3mf } from './threemf';
import { write3mf } from '../kernel/export/threemf';
import { ImportError, type ImportedMesh } from './types';

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

describe('parse3mf: estensione di produzione (Bambu Studio)', () => {
  const NS_P = `${NS} xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"`;

  /** Pacchetto con le mesh in 3D/Objects/object_1.model e solo riferimenti p:path nel modello principale. */
  function bambu(extra: Record<string, Uint8Array> = {}, itemTransform = '1 0 0 0 1 0 0 0 1 100 50 5'): ArrayBuffer {
    const sub = `<model unit="millimeter" ${NS_P}><resources><object id="1" type="model">${TETRA}</object><object id="2" type="model">${TETRA}</object></resources></model>`;
    const main =
      `<model unit="millimeter" ${NS_P}><resources><object id="3" type="model"><components>` +
      '<component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>' +
      '<component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>' +
      `</components></object></resources><build><item objectid="3" transform="${itemTransform}"/></build></model>`;
    return zipSync({ '3D/3dmodel.model': strToU8(main), '3D/Objects/object_1.model': strToU8(sub), ...extra }).buffer as ArrayBuffer;
  }

  it('segue p:path e produce una mesh per componente, con le trasformazioni composte', () => {
    const meshes = parse3mf(bambu(), 'dado');
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m) => m.indices.length / 3)).toEqual([4, 4]);
    // Il primo componente è il tetraedro traslato dalla sola voce di build, il secondo anche di 20 mm in X
    const minX = (m: ImportedMesh) => Math.min(...Array.from(m.positions).filter((_, i) => i % 3 === 0));
    expect(minX(meshes[0])).toBeCloseTo(100, 3);
    expect(minX(meshes[1])).toBeCloseTo(120, 3);
  });

  it('nomi e colori vengono dalle impostazioni di Bambu Studio', () => {
    const settings =
      '<config><object id="3"><metadata key="name" value="Dado zodiacale"/><metadata key="extruder" value="1"/>' +
      '<part id="1"><metadata key="name" value="Dado"/><metadata key="extruder" value="1"/></part>' +
      '<part id="2"><metadata key="name" value="Simboli"/><metadata key="extruder" value="2"/></part></object></config>';
    const project = JSON.stringify({ filament_colour: ['#EDE6D6', '#A31621'] });
    const meshes = parse3mf(bambu({ 'Metadata/model_settings.config': strToU8(settings), 'Metadata/project_settings.config': strToU8(project) }), 'dado');
    expect(meshes.map((m) => m.name)).toEqual(['Dado', 'Simboli']);
    expect(meshes.map((m) => m.color)).toEqual(['#ede6d6', '#a31621']);
  });

  it('senza impostazioni i nomi sono quelli dell oggetto e un numero, senza colore', () => {
    const meshes = parse3mf(bambu(), 'dado');
    expect(meshes.map((m) => m.name)).toEqual(['dado 3 1', 'dado 3 2']);
    expect(meshes.every((m) => m.color === undefined)).toBe(true);
  });

  it('impostazioni illeggibili non bloccano l import', () => {
    const meshes = parse3mf(bambu({ 'Metadata/model_settings.config': strToU8('<config><object'), 'Metadata/project_settings.config': strToU8('{non json') }), 'dado');
    expect(meshes).toHaveLength(2);
  });

  it('un riferimento a un file mancante dà l errore di geometria assente, non un arresto', () => {
    const main =
      `<model unit="millimeter" ${NS_P}><resources><object id="3" type="model"><components>` +
      '<component p:path="/3D/Objects/non_c_e.model" objectid="1"/></components></object></resources>' +
      '<build><item objectid="3"/></build></model>';
    expect(() => parse3mf(pack(main), 'x')).toThrow(/non contiene geometria/);
  });
});
