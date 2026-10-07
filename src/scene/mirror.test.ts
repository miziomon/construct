import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './store';
import { composeTransform, eulerToMatrix, toLocalTransform } from './math';
import type { Transform } from './math';
import type { Vec3 } from './types';

const st = () => useSceneStore.getState();
const undo = () => useSceneStore.temporal.getState().undo();

beforeEach(() => {
  st().clear();
  useSceneStore.temporal.getState().clear();
});

/** Applica a un punto la trasformazione x' = R · D · x + p, come fa il kernel. */
function apply(t: Transform, point: Vec3): Vec3 {
  const d = [0, 1, 2].map((i) => (t.mirror?.[i] ? -1 : 1));
  const r = eulerToMatrix(t.rotation);
  const v = point.map((x, i) => x * d[i]);
  return [0, 1, 2].map((i) => r[i][0] * v[0] + r[i][1] * v[1] + r[i][2] * v[2] + t.position[i]) as Vec3;
}

describe('trasformazioni con specchio', () => {
  const parent: Transform = { position: [10, -5, 3], rotation: [20, 35, 70], mirror: [true, false, true] };
  const child: Transform = { position: [4, 8, -2], rotation: [15, 0, 45], mirror: [false, true, true] };
  const point: Vec3 = [3, -7, 11];

  it('composeTransform equivale ad applicare prima il figlio e poi il genitore', () => {
    const world = composeTransform(parent, child);
    const expected = apply(parent, apply(child, point));
    apply(world, point).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
  });

  it('toLocalTransform è l inverso di composeTransform', () => {
    const world = composeTransform(parent, child);
    const back = toLocalTransform(parent, world);
    // La trasformazione ritrovata dà gli stessi punti del figlio originale
    apply(back, point).forEach((v, i) => expect(v).toBeCloseTo(apply(child, point)[i], 6));
  });

  it('senza specchi il risultato non ha il campo mirror', () => {
    const world = composeTransform({ position: [1, 2, 3], rotation: [0, 0, 90] }, { position: [1, 0, 0], rotation: [0, 0, 0] });
    expect(world).not.toHaveProperty('mirror');
  });

  it('due specchi sullo stesso asse si annullano', () => {
    const world = composeTransform({ position: [0, 0, 0], rotation: [0, 0, 0], mirror: [true, false, false] }, { position: [0, 0, 0], rotation: [0, 0, 0], mirror: [true, false, false] });
    expect(world).not.toHaveProperty('mirror');
  });
});

describe('Specchia', () => {
  it('riflette posizione e specchio rispetto al centro e si annulla specchiando due volte', () => {
    st().addPrimitive('box');
    const [id] = st().scene.rootIds;
    st().updateNode(id, { position: [10, 4, 10] });
    st().mirrorSelected(0, [0, 0, 10]);
    expect(st().scene.nodes[id].position).toEqual([-10, 4, 10]);
    expect(st().scene.nodes[id].mirror).toEqual([true, false, false]);
    st().mirrorSelected(0, [0, 0, 10]);
    expect(st().scene.nodes[id].position).toEqual([10, 4, 10]);
    expect(st().scene.nodes[id]).not.toHaveProperty('mirror');
  });

  it('un oggetto ruotato resta uno specchio dell originale', () => {
    st().addPrimitive('box');
    const [id] = st().scene.rootIds;
    st().updateNode(id, { position: [10, 0, 10], rotation: [0, 0, 30] });
    const before = { ...st().scene.nodes[id] } as Transform;
    st().mirrorSelected(0, [0, 0, 0]);
    const after = st().scene.nodes[id] as Transform;
    // Lo stesso punto locale (5, 2, 1) finisce nel riflesso X di dov'era prima
    const p: Vec3 = [5, 2, 1];
    const [bx, by, bz] = apply(before, p);
    const [ax, ay, az] = apply(after, p);
    expect(ax).toBeCloseTo(-bx, 3);
    expect(ay).toBeCloseTo(by, 3);
    expect(az).toBeCloseTo(bz, 3);
  });

  it('gli oggetti bloccati non si specchiano', () => {
    st().addPrimitive('box');
    const [id] = st().scene.rootIds;
    st().updateNode(id, { position: [10, 0, 10] });
    st().toggleLockSelected();
    st().mirrorSelected(0, [0, 0, 0]);
    expect(st().scene.nodes[id].position).toEqual([10, 0, 10]);
  });

  it('è un passo unico di Annulla', () => {
    st().addPrimitive('box');
    const [id] = st().scene.rootIds;
    st().mirrorSelected(1, [0, 0, 0]);
    expect(st().scene.nodes[id].mirror).toEqual([false, true, false]);
    undo();
    expect(st().scene.nodes[id]).not.toHaveProperty('mirror');
  });

  it('separando un gruppo specchiato i figli restano dove sono nel mondo', () => {
    st().addPrimitive('box');
    st().addPrimitive('sphere');
    const [a, b] = st().scene.rootIds;
    st().updateNode(a, { position: [10, 0, 10] });
    st().updateNode(b, { position: [30, 5, 10], rotation: [0, 0, 40] });
    st().select([a, b]);
    st().groupSelected();
    const [gid] = st().scene.rootIds;
    st().mirrorSelected(0, [0, 0, 0]);
    // Posizione nel mondo del figlio b prima di separare: gruppo ∘ figlio
    const world = composeTransform(st().scene.nodes[gid] as Transform, st().scene.nodes[b] as Transform);
    st().select([gid]);
    st().ungroupSelected();
    const after = st().scene.nodes[b] as Transform;
    after.position.forEach((v, i) => expect(v).toBeCloseTo(world.position[i], 3));
    expect(after.mirror).toEqual(world.mirror);
  });
});

describe('Allinea', () => {
  it('sposta gli oggetti selezionati alla radice e salta i bloccati', () => {
    st().addPrimitive('box');
    st().addPrimitive('box');
    const [a, b] = st().scene.rootIds;
    st().updateNode(a, { position: [0, 0, 10] });
    st().updateNode(b, { position: [50, 0, 10] });
    st().select([a, b]);
    st().alignSelected({ [a]: [25, 0, 0], [b]: [-25, 0, 0] });
    expect(st().scene.nodes[a].position).toEqual([25, 0, 10]);
    expect(st().scene.nodes[b].position).toEqual([25, 0, 10]);
    undo();
    expect(st().scene.nodes[a].position).toEqual([0, 0, 10]);
  });
});
