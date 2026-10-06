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
