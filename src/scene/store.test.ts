import { beforeEach, describe, expect, it } from 'vitest';
import { isLocked, useSceneStore } from './store';
import { composeTransform, eulerToMatrix, matrixToEuler } from './math';

const st = () => useSceneStore.getState();
const undo = () => useSceneStore.temporal.getState().undo();

beforeEach(() => {
  st().clear();
  useSceneStore.temporal.getState().clear();
});

describe('store della scena', () => {
  it('aggiunge una primitiva appoggiata sul piatto e la seleziona', () => {
    st().addPrimitive('box');
    const [id] = st().scene.rootIds;
    expect(st().scene.nodes[id].position).toEqual([0, 0, 10]); // metà dell'altezza di 20 mm
    expect(st().selection).toEqual([id]);
    st().addPrimitive('box');
    expect(Object.values(st().scene.nodes).map((x) => x.name)).toEqual(['Scatola', 'Scatola 2']);
  });

  it('raggruppa mantenendo le posizioni nel mondo e separa ripristinandole', () => {
    st().addPrimitive('box');
    st().addPrimitive('sphere');
    const [a, b] = st().scene.rootIds;
    st().updateNode(a, { position: [10, 0, 10] });
    st().updateNode(b, { position: [30, 0, 10] });
    st().select([a, b]);
    st().groupSelected();
    const [gid] = st().scene.rootIds;
    const g = st().scene.nodes[gid];
    expect(g.type).toBe('group');
    expect(g.position).toEqual([20, 0, 10]);
    expect(st().scene.nodes[a].position).toEqual([-10, 0, 0]);

    // Ruoto il gruppo di 90° attorno a Z: separandolo, i figli devono finire dove sono nel mondo
    st().updateNode(gid, { rotation: [0, 0, 90] });
    st().ungroupSelected();
    expect(st().scene.rootIds).toEqual([a, b]);
    const pa = st().scene.nodes[a].position;
    expect(pa[0]).toBeCloseTo(20, 3);
    expect(pa[1]).toBeCloseTo(-10, 3);
    expect(st().scene.nodes[a].rotation[2]).toBeCloseTo(90, 3);
    expect(st().scene.nodes[gid]).toBeUndefined();
  });

  it('toggle solid/hole, duplica ed elimina', () => {
    st().addPrimitive('cylinder');
    const [id] = st().scene.rootIds;
    st().toggleHoleSelected();
    expect(st().scene.nodes[id].mode).toBe('hole');
    st().duplicateSelected();
    expect(st().scene.rootIds).toHaveLength(2);
    expect(st().selection).not.toContain(id);
    st().removeSelected();
    expect(st().scene.rootIds).toEqual([id]);
  });

  it('undo e redo ripristinano la scena ma non la selezione', () => {
    st().addPrimitive('box');
    st().addPrimitive('cone');
    expect(st().scene.rootIds).toHaveLength(2);
    undo();
    expect(st().scene.rootIds).toHaveLength(1);
    useSceneStore.temporal.getState().redo();
    expect(st().scene.rootIds).toHaveLength(2);
  });

  it('euler ⇄ matrice sono inversi', () => {
    for (const r of [[10, 20, 30], [-45, 60, 170], [0, 0, 90], [90, 0, 0]] as const) {
      const back = matrixToEuler(eulerToMatrix([...r]));
      r.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 6));
    }
    const w = composeTransform({ position: [1, 2, 3], rotation: [0, 0, 90] }, { position: [1, 0, 0], rotation: [0, 0, 0] });
    expect(w.position[0]).toBeCloseTo(1, 6);
    expect(w.position[1]).toBeCloseTo(3, 6);
  });

  describe('blocco oggetti', () => {
    it('un oggetto bloccato non si sposta, non si elimina e non si modifica nella geometria', () => {
      st().addPrimitive('box');
      const [id] = st().scene.rootIds;
      st().toggleLockSelected();
      expect(st().scene.nodes[id].locked).toBe(true);

      st().nudgeSelected([10, 0, 0]);
      st().updateNode(id, { position: [50, 50, 50] });
      st().updateNode(id, { size: [5, 5, 5] } as never);
      st().toggleHoleSelected();
      st().removeSelected();
      const n = st().scene.nodes[id];
      expect(n.position).toEqual([0, 0, 10]);
      expect(n.mode).toBe('solid');
      expect(st().scene.rootIds).toEqual([id]);

      // Nome e colore restano modificabili
      st().updateNode(id, { name: 'Base', color: '#ff0000' });
      expect(st().scene.nodes[id].name).toBe('Base');

      // Sbloccando torna tutto possibile
      st().toggleLockSelected();
      st().nudgeSelected([10, 0, 0]);
      expect(st().scene.nodes[id].position[0]).toBe(10);
    });

    it('un gruppo bloccato blocca anche i figli; la copia nasce sbloccata', () => {
      st().addPrimitive('box');
      st().addPrimitive('sphere');
      st().select(st().scene.rootIds);
      st().groupSelected();
      const [gid] = st().scene.rootIds;
      const child = (st().scene.nodes[gid] as { children: string[] }).children[0];
      st().toggleLockSelected();
      expect(isLocked(st().scene, child)).toBe(true);
      st().updateNode(child, { position: [99, 0, 0] });
      expect(st().scene.nodes[child].position[0]).not.toBe(99);

      st().duplicateSelected();
      const copy = st().selection[0];
      expect(st().scene.nodes[copy].locked).toBe(false);
      expect(st().scene.nodes[gid].locked).toBe(true);
    });

    it('i bloccati non entrano nei gruppi e non si separano', () => {
      st().addPrimitive('box');
      st().addPrimitive('cone');
      const [a, b] = st().scene.rootIds;
      st().select([a]);
      st().toggleLockSelected();
      st().select([a, b]);
      st().groupSelected(); // resta un solo oggetto sbloccato: nessun gruppo
      expect(st().scene.rootIds).toEqual([a, b]);
    });
  });
});
