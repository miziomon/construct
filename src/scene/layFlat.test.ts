import { beforeEach, describe, expect, it } from 'vitest';
import { layFlatPatch, rotationToDown } from './layFlat';
import { apply, eulerToMatrix } from './math';
import { useSceneStore } from './store';
import type { Vec3 } from './types';

const near = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('rotationToDown', () => {
  it('porta ogni normale su -Z, anche quelle già in basso, in alto e oblique', () => {
    const normals: Vec3[] = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 1, 1], [-3, 2, 0.5], [0.001, 0, 1], [0, 0.001, -1]];
    for (const n of normals) near(apply(rotationToDown(n), unit(n)), [0, 0, -1]);
  });

  it('una normale già in basso non ruota nulla', () => {
    near(rotationToDown([0, 0, -5]).flat(), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('è una rotazione vera: conserva le lunghezze e il determinante vale 1', () => {
    const m = rotationToDown([2, -1, 3]);
    const v: Vec3 = [1, 2, 3];
    expect(Math.hypot(...apply(m, v))).toBeCloseTo(Math.hypot(...v), 9);
    const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    expect(det).toBeCloseTo(1, 9);
  });

  it('una normale nulla non cambia nulla', () => {
    near(rotationToDown([0, 0, 0]).flat(), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('layFlatPatch', () => {
  it('dopo la rotazione la faccia scelta guarda in basso', () => {
    // Cubo inclinato: la sua faccia superiore (normale locale +Z) in coordinate mondo
    const node = { position: [10, 5, 20] as Vec3, rotation: [30, 20, 10] as Vec3 };
    const normal = apply(eulerToMatrix(node.rotation), [0, 0, 1]);
    const next = layFlatPatch(node, normal, [10, 5, 20]);
    near(apply(eulerToMatrix(next.rotation), [0, 0, 1]), [0, 0, -1], 3);
  });

  it('ruota attorno al centro: la distanza dal centro non cambia e il centro resta fermo', () => {
    const node = { position: [40, 0, 10] as Vec3, rotation: [0, 0, 0] as Vec3 };
    const center: Vec3 = [30, 0, 10];
    const next = layFlatPatch(node, [1, 0, 0], center);
    expect(Math.hypot(next.position[0] - center[0], next.position[1] - center[1], next.position[2] - center[2])).toBeCloseTo(10, 3);
    // Un oggetto il cui centro coincide con la sua posizione non si sposta
    near(layFlatPatch({ position: [30, 0, 10], rotation: [0, 0, 0] }, [1, 0, 0], center).position, [30, 0, 10], 4);
  });
});

describe('azione layOnFace dello store', () => {
  const st = () => useSceneStore.getState();
  beforeEach(() => {
    st().clear();
    useSceneStore.temporal.getState().clear();
  });

  it('ruota l oggetto, è un passo di Annulla e salta gli oggetti bloccati', () => {
    st().addPrimitive('box');
    const [id] = st().scene.rootIds;
    st().updateNode(id, { rotation: [30, 0, 0] });
    const normal = apply(eulerToMatrix([30, 0, 0]), [0, 0, 1]);
    const before = useSceneStore.temporal.getState().pastStates.length;
    st().layOnFace(id, normal, st().scene.nodes[id].position);
    near(apply(eulerToMatrix(st().scene.nodes[id].rotation), [0, 0, 1]), [0, 0, -1], 3);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(before + 1);

    st().select([id]);
    st().toggleLockSelected();
    const locked = [...st().scene.nodes[id].rotation];
    st().layOnFace(id, [1, 0, 0], [0, 0, 0]);
    expect(st().scene.nodes[id].rotation).toEqual(locked);
  });
});
