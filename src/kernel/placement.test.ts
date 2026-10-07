import { beforeEach, describe, expect, it } from 'vitest';
import { applyPlacement, combineToBed, queueDropToBed, queueKeepBase } from './placement';
import { useResultStore } from './useKernel';
import { useSceneStore } from '../scene/store';
import type { NodeMesh } from './evaluate';

/** Mesh finta con il solo ingombro: il resto non serve all'appoggio. */
const meshOf = (rootId: string, minZ: number): NodeMesh =>
  ({ id: rootId, rootId, path: [rootId], empty: false, bbox: { min: [0, 0, minZ], max: [1, 1, minZ + 10] } }) as NodeMesh;

beforeEach(() => {
  useSceneStore.getState().loadScene({ nodes: {}, rootIds: [] });
  useSceneStore.getState().addPrimitive('box');
  useSceneStore.getState().addPrimitive('box');
});

describe('appoggio automatico', () => {
  it('applyPlacement riporta la base sul piatto e non crea passi di Annulla', () => {
    const [id] = useSceneStore.getState().scene.rootIds;
    useSceneStore.getState().updateNode(id, { position: [0, 0, 30] });
    useResultStore.setState({ meshes: [meshOf(id, 20)] });
    const past = useSceneStore.temporal.getState().pastStates.length;
    queueDropToBed([id]);
    expect(applyPlacement()).toBe(true);
    expect(useSceneStore.getState().scene.nodes[id].position[2]).toBe(10);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(past);
    // Niente in coda: nessuna modifica
    expect(applyPlacement()).toBe(false);
  });

  it('queueKeepBase mantiene la quota della base anche se le misure cambiano', () => {
    const [id] = useSceneStore.getState().scene.rootIds;
    useResultStore.setState({ meshes: [meshOf(id, 5)] });
    queueKeepBase(id);
    const z = useSceneStore.getState().scene.nodes[id].position[2];
    // Dopo la modifica il kernel riporta una base a 2: serve alzare di 3
    useResultStore.setState({ meshes: [meshOf(id, 2)] });
    applyPlacement();
    expect(useSceneStore.getState().scene.nodes[id].position[2]).toBe(z + 3);
  });

  it('combineToBed accoda il gruppo nuovo, non quando la selezione è insufficiente', () => {
    const { rootIds } = useSceneStore.getState().scene;
    useSceneStore.getState().select([rootIds[0]]);
    combineToBed('union');
    expect(useSceneStore.getState().scene.rootIds).toHaveLength(2);
    useSceneStore.getState().select(rootIds);
    combineToBed('union');
    const [group] = useSceneStore.getState().scene.rootIds;
    useSceneStore.getState().updateNode(group, { position: [0, 0, 40] });
    useResultStore.setState({ meshes: [meshOf(group, 30)] });
    applyPlacement();
    expect(useSceneStore.getState().scene.nodes[group].position[2]).toBe(10);
  });
});
