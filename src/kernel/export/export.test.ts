import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { strFromU8, unzipSync } from 'fflate';
import { writeStl } from './stl';
import { write3mf } from './threemf';
import { Evaluator } from '../evaluate';
import { primitiveDefaults } from '../../scene/defaults';
import type { PrimitiveNode, Scene } from '../../scene/types';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const boxScene = (): Scene => ({
  nodes: { a: { ...primitiveDefaults('box'), id: 'a', name: 'Cubo', position: [0, 0, 10] } as PrimitiveNode },
  rootIds: ['a'],
});

describe('export', () => {
  it('STL binario: dimensione 84 + 50 byte per triangolo e normali corrette', () => {
    const [m] = new Evaluator(wasm).evaluate(boxScene()).meshes;
    const stl = writeStl(m.positions, m.indices);
    expect(stl.length).toBe(84 + 50 * 12);
    const view = new DataView(stl.buffer);
    expect(view.getUint32(80, true)).toBe(12);
    // Ogni normale ha lunghezza 1
    for (let t = 0; t < 12; t++) {
      const o = 84 + t * 50;
      expect(Math.hypot(view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true))).toBeCloseTo(1, 5);
    }
  });

  it('STL: reimportando la mesh in manifold si ottiene lo stesso volume', () => {
    const [m] = new Evaluator(wasm).evaluate(boxScene()).meshes;
    const stl = writeStl(m.positions, m.indices);
    const view = new DataView(stl.buffer);
    const n = view.getUint32(80, true);
    const verts: number[] = [];
    const tris: number[] = [];
    for (let t = 0; t < n; t++) {
      for (let v = 0; v < 3; v++) {
        const o = 84 + t * 50 + 12 + v * 12;
        verts.push(view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true));
        tris.push(t * 3 + v);
      }
    }
    // STL non condivide i vertici: manifold li fonde con merge()
    const mesh = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) });
    mesh.merge();
    const back = new wasm.Manifold(mesh);
    expect(back.status()).toBe('NoError');
    expect(back.volume()).toBeCloseTo(8000, 1);
  });

  it("3MF: un offset sposta l'oggetto con la trasformazione dell'item (piatti affiancati), senza toccare i vertici", () => {
    const [m] = new Evaluator(wasm).evaluate(boxScene()).meshes;
    const xml = strFromU8(unzipSync(write3mf([
      { name: 'A', color: '#ff0000', positions: m.positions, indices: m.indices },
      { name: 'B', color: '#00ff00', positions: m.positions, indices: m.indices, offset: [276, 0, 0] },
    ]))['3D/3dmodel.model']);
    const items = xml.match(/<item [^>]*>/g)!;
    expect(items).toHaveLength(2);
    // Il primo non si sposta: nessuna trasformazione; il secondo trasla di 276 mm lungo X
    expect(items[0]).not.toContain('transform');
    expect(items[1]).toContain('transform="1 0 0 0 1 0 0 0 1 276 0 0"');
  });

  it('3MF con più piatti: aggiunge i metadati dei piatti per Bambu Studio e Orca', () => {
    const [m] = new Evaluator(wasm).evaluate(boxScene()).meshes;
    const parts = [
      { name: 'Piatto 1 – A', color: '#ff0000', positions: m.positions, indices: m.indices, plate: 0 },
      { name: 'Piatto 2 – B & "C"', color: '#00ff00', positions: m.positions, indices: m.indices, plate: 1, offset: [276, 0, 0] as [number, number, number] },
    ];
    const files = unzipSync(write3mf(parts, ['Piatto 1', 'Coperchio']));
    expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model', 'Metadata/model_settings.config']);
    const config = strFromU8(files['Metadata/model_settings.config']);
    expect(config).toContain('<metadata key="plater_name" value="Coperchio"/>');
    expect(config).toContain('B &amp; &quot;C&quot;');
    // Ogni piatto elenca la sua istanza: l'oggetto 2 (primo) sul piatto 1 e l'oggetto 3 sul piatto 2
    const [plate1, plate2] = config.split('<plate>').slice(1);
    expect(plate1).toContain('<metadata key="object_id" value="2"/>');
    expect(plate1).not.toContain('value="3"');
    expect(plate2).toContain('<metadata key="object_id" value="3"/>');
    // Un piatto solo non scrive metadati
    expect(Object.keys(unzipSync(write3mf(parts.slice(0, 1), ['Piatto 1'])))).toHaveLength(3);
  });

  it('3MF: contiene i tre file attesi, unità mm, un oggetto e il materiale', () => {
    const [m] = new Evaluator(wasm).evaluate(boxScene()).meshes;
    const zip = write3mf([{ name: 'Scatola & "test"', color: '#ff8800', positions: m.positions, indices: m.indices }]);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    const xml = strFromU8(files['3D/3dmodel.model']);
    expect(xml).toContain('unit="millimeter"');
    expect(xml).toContain('displaycolor="#FF8800FF"');
    expect(xml).toContain('Scatola &amp; &quot;test&quot;'); // caratteri speciali escapati
    expect((xml.match(/<triangle /g) ?? []).length).toBe(12);
    expect((xml.match(/<item /g) ?? []).length).toBe(1);
    // XML ben formato (il parser nativo di Node non c'è: controllo bilanciamento dei tag principali)
    for (const tag of ['model', 'resources', 'mesh', 'vertices', 'triangles', 'build']) {
      expect(xml.split(`<${tag}>`).length - 1 + xml.split(`<${tag} `).length - 1).toBe(xml.split(`</${tag}>`).length - 1);
    }
  });
});
