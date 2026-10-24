import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAsset, addImage } from '../import/assets';
import { sampleImage } from './textureImage';
import { sceneFromJson, sceneToJson } from './persistence';
import { defaultPatternParams, normalizePattern } from './pattern';
import type { GroupNode, PatternParams, PrimitiveNode, Scene, Vec3 } from './types';

// Il kernel è un worker: nei test si simula (registra le chiamate di `registerImage`)
const kernelCalls = vi.hoisted(() => [] as { id: string; w: number; h: number; length: number }[]);
vi.mock('../kernel/client', () => ({
  getKernel: () => ({
    registerImage: async (id: string, w: number, h: number, data: Uint8Array) => void kernelCalls.push({ id, w, h, length: data.length }),
    registerAsset: async () => ({ ok: true }),
  }),
}));

/**
 * Progetti con immagini: andata e ritorno nel file, una sola copia per immagine con più Pattern, progetti vecchi (senza immagini
 * e con mesh) leggibili, e ripristino nel kernel (simulato) all'apertura.
 */

const bounds = { min: [-10, -10, -10] as Vec3, max: [10, 10, 10] as Vec3 };
const box = (id: string): PrimitiveNode => ({ id, type: 'primitive', name: id, kind: 'box', size: [20, 20, 20], cornerRadius: 0, position: [0, 0, 10], rotation: [0, 0, 0], mode: 'solid', color: '#ff0000' });

/** Scena con tanti Pattern Immagine quante sono le immagini date (ognuno sul suo cubo). */
function sceneWith(imageIds: (string | undefined)[]): Scene {
  const nodes: Scene['nodes'] = {};
  const rootIds: string[] = [];
  imageIds.forEach((imageId, i) => {
    const pattern = normalizePattern({ ...defaultPatternParams(bounds, i), kind: 'texture', imageId } as PatternParams);
    nodes[`c${i}`] = box(`c${i}`);
    nodes[`g${i}`] = { id: `g${i}`, name: `Immagine ${i}`, type: 'group', op: 'pattern', children: [`c${i}`], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff', pattern } as GroupNode;
    rootIds.push(`g${i}`);
  });
  return { nodes, rootIds };
}

describe('progetto con immagini', () => {
  it('andata e ritorno: il grigio torna identico e l\'immagine resta una sola anche con più Pattern', async () => {
    const photo = { w: 64, h: 48, data: Uint8Array.from({ length: 64 * 48 }, (_, i) => (i * 13 + (i >> 6) * 5) % 256) };
    const asset = await addImage(photo);
    const scene = sceneWith([asset.id, asset.id, undefined]);
    const json = sceneToJson(scene);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(8);
    // Una sola copia nel file, con il prefisso img-; l'esempio della libreria (senza imageId) non si salva
    const imageKeys = Object.keys(parsed.assets).filter((k) => k.startsWith('img-'));
    expect(imageKeys).toEqual([asset.id]);
    expect(Object.keys(parsed.assets)).toHaveLength(1);
    const back = sceneFromJson(json);
    expect(back.images).toHaveLength(1);
    expect(back.images[0]).toMatchObject({ id: asset.id, w: 64, h: 48 });
    expect(Array.from(back.images[0].gray)).toEqual(Array.from(photo.data));
    expect(back.assets).toEqual([]);
    // Il Pattern conserva imageId e i parametri
    expect((back.scene.nodes.g0 as GroupNode).pattern).toMatchObject({ kind: 'texture', imageId: asset.id, textureAlgorithm: 1 });
    expect((back.scene.nodes.g2 as GroupNode).pattern!.imageId).toBeUndefined();
  });

  it("Immagine → cambio tipo dal pannello (nessuna normalizzazione) → salva → riapri → torna a Immagine: l'immagine c'è", async () => {
    const photo = { w: 32, h: 32, data: Uint8Array.from({ length: 32 * 32 }, (_, i) => (i * 11 + (i >> 5)) % 256) };
    const asset = await addImage(photo);
    const scene = sceneWith([asset.id]);
    // Il pannello delle Proprietà: `patch({ pattern: { ...node.pattern, ...change } })`, senza normalizzare
    const group = scene.nodes.g0 as GroupNode;
    group.pattern = { ...group.pattern!, kind: 'hexagon' };
    expect(group.pattern.imageId).toBe(asset.id);
    const json = sceneToJson(scene);
    // Il file salva l'immagine anche se il Pattern non è più di tipo Immagine
    expect(Object.keys(JSON.parse(json).assets)).toEqual([asset.id]);
    const back = sceneFromJson(json);
    expect(back.images).toHaveLength(1);
    expect(Array.from(back.images[0].gray)).toEqual(Array.from(photo.data));
    // Ripristino all'apertura: l'immagine va nel kernel anche se il tipo corrente non la usa
    const { restoreAssets } = await import('../import/restore');
    await restoreAssets(back.scene);
    expect(kernelCalls.filter((c) => c.id === asset.id)).toHaveLength(1);
    // Si torna a Immagine dal pannello: l'immagine è quella
    const reopened = { ...(back.scene.nodes.g0 as GroupNode) };
    reopened.pattern = { ...reopened.pattern!, kind: 'texture' };
    const { imageOf } = await import('./textureImage');
    const { getImage } = await import('../import/assets');
    expect(imageOf(reopened.pattern, getImage)).toBeDefined();
    expect(Array.from(imageOf(reopened.pattern, getImage)!.data)).toEqual(Array.from(photo.data));
  });

  it('mesh e immagini nello stesso file non si confondono', async () => {
    const mesh = await addAsset(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]));
    const image = await addImage({ w: 4, h: 4, data: new Uint8Array(16).fill(77) });
    const scene = sceneWith([image.id]);
    scene.nodes.m = { id: 'm', type: 'mesh', name: 'Mesh', assetId: mesh.id, fileName: 'x.stl', scale: 1, position: [30, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#00ff00' } as unknown as Scene['nodes'][string];
    scene.rootIds.push('m');
    const back = sceneFromJson(sceneToJson(scene));
    expect(back.assets.map((a) => a.id)).toEqual([mesh.id]);
    expect(back.images.map((a) => a.id)).toEqual([image.id]);
  });

  it('un immagine non registrata non si salva e non rompe il file', () => {
    const json = sceneToJson(sceneWith(['img-0123456789abcdef']));
    expect(Object.keys(JSON.parse(json).assets)).toEqual([]);
    expect(sceneFromJson(json).images).toEqual([]);
  });

  it('i progetti vecchi si leggono ancora: versione 7 e precedenti, con mesh e senza immagini', async () => {
    const mesh = await addAsset(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2]), new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]));
    const { encodeAsset, getAsset } = await import('../import/assets');
    const scene: Scene = { nodes: { b: box('b') }, rootIds: ['b'] };
    for (const version of [1, 2, 5, 7]) {
      const old = JSON.stringify({ format: 'construct-scene', version, scene, assets: { [mesh.id]: encodeAsset(getAsset(mesh.id)!) } });
      const back = sceneFromJson(old);
      expect(back.scene.rootIds).toEqual(['b']);
      expect(back.assets).toHaveLength(1);
      expect(back.images).toEqual([]);
    }
    // Il formato del vecchio nome e un progetto senza elenco di asset
    expect(sceneFromJson(JSON.stringify({ format: 'webcad-scene', version: 7, scene })).images).toEqual([]);
    // Un progetto di una versione più recente non si apre
    expect(() => sceneFromJson(JSON.stringify({ format: 'construct-scene', version: 9, scene }))).toThrow(/più recente/);
  });

  it('un\'immagine del file con dati corrotti dà un errore e non un\'immagine sbagliata', () => {
    const scene = sceneWith([undefined]);
    const bad = JSON.stringify({ format: 'construct-scene', version: 8, scene, assets: { 'img-aaaaaaaaaaaaaaaa': 'AAAA' } });
    expect(() => sceneFromJson(bad)).toThrow();
  });
});

describe('ripristino delle immagini nel kernel', () => {
  const registered = kernelCalls;
  const errors: string[] = [];

  beforeEach(() => {
    registered.length = 0;
    errors.length = 0;
  });

  it('registra nel kernel le immagini usate e avvisa per quelle che mancano, senza togliere nulla dalla scena', async () => {
    const [{ addImage: add }, { restoreAssets }, { notify }] = await Promise.all([import('../import/assets'), import('../import/restore'), import('../ui/notify/notifyStore')]);
    const error = vi.spyOn(notify, 'error');
    const asset = await add({ w: 8, h: 8, data: new Uint8Array(64).fill(9) });
    const scene = sceneWith([asset.id, 'img-ffffffffffffffff']);
    const restored = await restoreAssets(scene);
    expect(restored).toBe(scene);
    expect(registered).toEqual([{ id: asset.id, w: 8, h: 8, length: 64 }]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('immagine');
    expect(Object.keys(restored.nodes)).toHaveLength(4);
  });

  it("l'avviso conta solo i Pattern di tipo Immagine: un imageId conservato da un altro tipo che manca non avvisa", async () => {
    const [{ restoreAssets }, { notify }] = await Promise.all([import('../import/restore'), import('../ui/notify/notifyStore')]);
    const error = vi.spyOn(notify, 'error');
    error.mockClear();
    const scene = sceneWith(['img-eeeeeeeeeeeeeeee', 'img-ffffffffffffffff']);
    // Il primo passa a un tipo a celle dal pannello (campi conservati), il secondo resta Immagine
    (scene.nodes.g0 as GroupNode).pattern = { ...(scene.nodes.g0 as GroupNode).pattern!, kind: 'hexagon' };
    await restoreAssets(scene);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/^Un'immagine di un Pattern non è più disponibile/);
    // Solo il tipo cambiato: nessun avviso
    error.mockClear();
    const onlyStale = sceneWith(['img-dddddddddddddddd']);
    (onlyStale.nodes.g0 as GroupNode).pattern = { ...(onlyStale.nodes.g0 as GroupNode).pattern!, kind: 'brick' };
    await restoreAssets(onlyStale);
    expect(error).not.toHaveBeenCalled();
  });

  it('senza Pattern Immagine non tocca il kernel né avvisa', async () => {
    const [{ restoreAssets }, { notify }] = await Promise.all([import('../import/restore'), import('../ui/notify/notifyStore')]);
    const error = vi.spyOn(notify, 'error');
    const scene: Scene = { nodes: { b: box('b') }, rootIds: ['b'] };
    expect(await restoreAssets(scene)).toBe(scene);
    expect(registered).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it('le texture di esempio non sono immagini da ripristinare', async () => {
    const { restoreAssets } = await import('../import/restore');
    const scene = sceneWith([undefined]);
    expect(await restoreAssets(scene)).toBe(scene);
    expect(registered).toEqual([]);
    expect(sampleImage('knurl').w).toBe(256);
  });
});
