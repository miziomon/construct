import { beforeEach, describe, expect, it } from 'vitest';
import { activePlateId, addPlateScene, allRootIds, hasManyPlates, moveRootsToPlate, plateOfRoot, platesAreValid, platesOf, removePlateScene, renamePlateScene, sceneForPlate, switchPlateScene } from './plates';
import { sceneFromJson, sceneToJson } from './persistence';
import { useSceneStore } from './store';
import { primitiveDefaults } from './defaults';
import type { PrimitiveNode, Scene } from './types';

const box = (id: string) => ({ ...primitiveDefaults('box'), id, name: id, position: [0, 0, 10] }) as PrimitiveNode;
const sceneOf = (ids: string[]): Scene => ({ nodes: Object.fromEntries(ids.map((id) => [id, box(id)])), rootIds: ids });

describe('piatti: funzioni pure', () => {
  it('una scena senza piatti ne ha uno implicito con tutte le radici', () => {
    const scene = sceneOf(['a', 'b']);
    expect(platesOf(scene)).toEqual([{ id: 'piatto-1', name: 'Piatto 1', rootIds: ['a', 'b'] }]);
    expect(hasManyPlates(scene)).toBe(false);
    expect(allRootIds(scene)).toEqual(['a', 'b']);
    expect(platesAreValid(scene)).toBe(true);
  });

  it('aggiungere un piatto non cambia le radici attive e il nome è progressivo', () => {
    const scene = addPlateScene(sceneOf(['a']), 'p2');
    expect(scene.rootIds).toEqual(['a']);
    expect(platesOf(scene).map((p) => p.name)).toEqual(['Piatto 1', 'Piatto 2']);
    expect(activePlateId(scene)).toBe('piatto-1');
    expect(hasManyPlates(scene)).toBe(true);
    expect(platesAreValid(scene)).toBe(true);
  });

  it('cambiare piatto parcheggia le radici attive e porta in vista quelle dell\'altro', () => {
    let scene = addPlateScene(sceneOf(['a', 'b']), 'p2');
    scene = moveRootsToPlate(scene, ['b'], 'p2');
    expect(scene.rootIds).toEqual(['a']);
    scene = switchPlateScene(scene, 'p2');
    expect(scene.rootIds).toEqual(['b']);
    expect(activePlateId(scene)).toBe('p2');
    // Il piatto 1 è parcheggiato con la sua radice
    expect(platesOf(scene).find((p) => p.id === 'piatto-1')!.rootIds).toEqual(['a']);
    expect(allRootIds(scene).sort()).toEqual(['a', 'b']);
    expect(plateOfRoot(scene, 'a')!.name).toBe('Piatto 1');
    expect(platesAreValid(scene)).toBe(true);
    // Tornando indietro tutto è come prima
    expect(switchPlateScene(scene, 'piatto-1').rootIds).toEqual(['a']);
  });

  it('spostare verso il piatto attivo o un piatto che non c\'è non cambia nulla', () => {
    const scene = addPlateScene(sceneOf(['a']), 'p2');
    expect(moveRootsToPlate(scene, ['a'], 'piatto-1')).toBe(scene);
    expect(moveRootsToPlate(scene, ['a'], 'nonesiste')).toBe(scene);
  });

  it('rinomina: un nome vuoto non cambia nulla', () => {
    const scene = addPlateScene(sceneOf(['a']), 'p2');
    expect(platesOf(renamePlateScene(scene, 'p2', '  Coperchio '))[1].name).toBe('Coperchio');
    expect(renamePlateScene(scene, 'p2', '   ')).toBe(scene);
  });

  it('eliminare un piatto toglie i suoi oggetti, anche i figli dei gruppi, e l\'ultimo non si elimina', () => {
    let scene = addPlateScene(sceneOf(['a', 'b']), 'p2');
    scene = moveRootsToPlate(scene, ['b'], 'p2');
    const after = removePlateScene(scene, 'p2');
    expect(Object.keys(after.nodes)).toEqual(['a']);
    expect(platesOf(after)).toHaveLength(1);
    expect(removePlateScene(sceneOf(['a']), 'piatto-1').rootIds).toEqual(['a']);

    // Eliminare il piatto attivo porta in vista un altro piatto
    const onP2 = switchPlateScene(scene, 'p2');
    const gone = removePlateScene(onP2, 'p2');
    expect(gone.rootIds).toEqual(['a']);
    expect(gone.nodes.b).toBeUndefined();
  });

  it('sceneForPlate dà una vista con le sole radici del piatto', () => {
    let scene = addPlateScene(sceneOf(['a', 'b']), 'p2');
    scene = moveRootsToPlate(scene, ['b'], 'p2');
    expect(sceneForPlate(scene, 'p2').rootIds).toEqual(['b']);
    expect(sceneForPlate(scene, 'piatto-1').rootIds).toEqual(['a']);
    expect(Object.keys(sceneForPlate(scene, 'p2').nodes).sort()).toEqual(['a', 'b']);
  });

  it('platesAreValid scarta radici inesistenti o doppie', () => {
    const scene = addPlateScene(sceneOf(['a']), 'p2');
    expect(platesAreValid({ ...scene, plates: [{ id: 'piatto-1', name: 'x', rootIds: [] }, { id: 'p2', name: 'y', rootIds: ['zzz'] }] })).toBe(false);
    expect(platesAreValid({ ...scene, plates: [{ id: 'piatto-1', name: 'x', rootIds: [] }, { id: 'p2', name: 'y', rootIds: ['a'] }] })).toBe(false);
    expect(platesAreValid({ ...scene, activePlateId: 'nonesiste' })).toBe(false);
  });

  it('il file di progetto conserva i piatti e un file vecchio senza piatti si apre con uno solo', () => {
    let scene = addPlateScene(sceneOf(['a', 'b']), 'p2');
    scene = moveRootsToPlate(scene, ['b'], 'p2');
    const loaded = sceneFromJson(sceneToJson(scene)).scene;
    expect(loaded).toEqual(scene);
    expect(JSON.parse(sceneToJson(scene)).version).toBe(4);
    const old = JSON.parse(sceneToJson(sceneOf(['a'])));
    old.version = 3;
    expect(platesOf(sceneFromJson(JSON.stringify(old)).scene)).toHaveLength(1);
    // Un file con piatti incoerenti è rifiutato
    const broken = JSON.parse(sceneToJson(scene));
    broken.scene.plates[1].rootIds = ['zzz'];
    expect(() => sceneFromJson(JSON.stringify(broken))).toThrow('progetto Construct');
  });
});

describe('piatti: azioni dello store', () => {
  beforeEach(() => {
    useSceneStore.getState().loadScene({ nodes: {}, rootIds: [] });
    useSceneStore.temporal.getState().clear();
  });

  it('un piatto per ogni parte: scatola sul piatto 1, coperchio sul piatto 2', () => {
    const s = () => useSceneStore.getState();
    s().addPrimitive('box');
    const boxId = s().scene.rootIds[0];
    const second = s().addPlate();
    // Il nuovo piatto è attivo e vuoto: gli oggetti del primo non si vedono
    expect(activePlateId(s().scene)).toBe(second);
    expect(s().scene.rootIds).toEqual([]);
    s().addPrimitive('cylinder');
    const lidId = s().scene.rootIds[0];
    expect(platesOf(s().scene).map((p) => p.rootIds)).toEqual([[boxId], [lidId]]);

    s().switchPlate(platesOf(s().scene)[0].id);
    expect(s().scene.rootIds).toEqual([boxId]);
    expect(s().selection).toEqual([]);
  });

  it('cambiare piatto non crea un passo di cronologia, aggiungerne uno sì', () => {
    const s = () => useSceneStore.getState();
    s().addPrimitive('box');
    const before = useSceneStore.temporal.getState().pastStates.length;
    const p2 = s().addPlate();
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(before + 1);
    s().switchPlate('piatto-1');
    s().switchPlate(p2);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(before + 1);
    // Annullare l'aggiunta del piatto riporta un solo piatto
    useSceneStore.temporal.getState().undo();
    expect(platesOf(s().scene)).toHaveLength(1);
  });

  it('sposta la selezione in un altro piatto, in un passo di Annulla, e salta gli oggetti bloccati', () => {
    const s = () => useSceneStore.getState();
    s().addPrimitive('box');
    s().addPrimitive('sphere');
    const [sphere, cube] = s().scene.rootIds;
    const p2 = s().addPlate();
    s().switchPlate('piatto-1');
    s().select([sphere, cube]);
    s().updateNode(cube, { locked: true } as never);
    s().moveSelectionToPlate(p2);
    expect(s().scene.rootIds).toEqual([cube]);
    expect(platesOf(s().scene)[1].rootIds).toEqual([sphere]);
    useSceneStore.temporal.getState().undo();
    expect(s().scene.rootIds).toEqual([sphere, cube]);
  });

  it('elimina un piatto con i suoi oggetti e rinomina', () => {
    const s = () => useSceneStore.getState();
    s().addPrimitive('box');
    const p2 = s().addPlate();
    s().addPrimitive('cone');
    s().renamePlate(p2, 'Coperchio');
    expect(platesOf(s().scene)[1].name).toBe('Coperchio');
    s().removePlate(p2);
    expect(platesOf(s().scene)).toHaveLength(1);
    expect(Object.keys(s().scene.nodes)).toHaveLength(1);
  });
});
