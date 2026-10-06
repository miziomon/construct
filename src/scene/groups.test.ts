import { beforeEach, describe, expect, it } from 'vitest';
import { canMoveInto, isAppGroup, useSceneStore, worldTransform } from './store';
import { composeTransform, toLocalTransform } from './math';
import { dropTarget, zoneAt } from '../ui/Outliner/dnd';
import type { GroupNode, Vec3 } from './types';

const st = () => useSceneStore.getState();
const undo = () => useSceneStore.temporal.getState().undo();

beforeEach(() => {
  st().clear();
  useSceneStore.temporal.getState().clear();
});

/** Aggiunge `n` oggetti con posizioni diverse e restituisce i loro id nell'ordine di creazione. */
function addBoxes(n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    st().addPrimitive('box');
    const id = st().selection[0];
    st().updateNode(id, { position: [i * 40, 0, 10] });
    ids.push(id);
  }
  return ids;
}

describe('toLocalTransform', () => {
  it('è l inverso di composeTransform', () => {
    const parent = { position: [10, -5, 3] as Vec3, rotation: [20, 35, 70] as Vec3 };
    const child = { position: [4, 8, -2] as Vec3, rotation: [0, 0, 45] as Vec3 };
    const world = composeTransform(parent, child);
    const back = toLocalTransform(parent, world);
    back.position.forEach((v, i) => expect(v).toBeCloseTo(child.position[i], 6));
    // Le rotazioni si confrontano come matrici composte, non come angoli (più terne danno la stessa rotazione)
    const again = composeTransform(parent, back);
    again.position.forEach((v, i) => expect(v).toBeCloseTo(world.position[i], 6));
  });
});

describe('Raggruppa e Unisci', () => {
  it('Raggruppa crea un gruppo "group" e Unisci una unione booleana', () => {
    const [a, b, c, d] = addBoxes(4);
    st().select([a, b]);
    st().groupSelected();
    st().select([c, d]);
    st().unionSelected();
    const groups = Object.values(st().scene.nodes).filter((n): n is GroupNode => n.type === 'group');
    expect(groups.map((g) => g.op).sort()).toEqual(['group', 'union']);
    expect(groups.find((g) => g.op === 'group')!.name).toBe('Gruppo');
    expect(groups.find((g) => g.op === 'union')!.name).toBe('Unione');
  });

  it('un foro raggruppato diventa un solido', () => {
    const [a, b] = addBoxes(2);
    st().select([b]);
    st().toggleHoleSelected();
    expect(st().scene.nodes[b].mode).toBe('hole');
    st().select([a, b]);
    st().groupSelected();
    expect(st().scene.nodes[b].mode).toBe('solid');
  });

  it('un foro dentro un Raggruppa non si può riattivare', () => {
    const [a, b] = addBoxes(2);
    st().select([a, b]);
    st().groupSelected();
    st().select([b]);
    st().toggleHoleSelected();
    expect(st().scene.nodes[b].mode).toBe('solid');
  });

  it('un foro dentro una Unione resta un foro', () => {
    const [a, b] = addBoxes(2);
    st().select([a, b]);
    st().unionSelected();
    st().select([b]);
    st().toggleHoleSelected();
    expect(st().scene.nodes[b].mode).toBe('hole');
  });
});

describe('moveNode', () => {
  it('sposta un oggetto dentro un gruppo mantenendo la posizione nel mondo', () => {
    const [a, b, c] = addBoxes(3);
    st().select([a, b]);
    st().groupSelected();
    const gid = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group')!;
    st().updateNode(gid, { rotation: [0, 0, 90] });
    const before = worldTransform(st().scene, c);
    expect(st().moveNode(c, { parentId: gid, index: 2 })).toBe(true);
    expect((st().scene.nodes[gid] as GroupNode).children).toContain(c);
    expect(st().scene.rootIds).not.toContain(c);
    const after = worldTransform(st().scene, c);
    after.position.forEach((v, i) => expect(v).toBeCloseTo(before.position[i], 3));
  });

  it('sposta un oggetto fuori da un gruppo alla radice, nella posizione indicata', () => {
    const [a, b, c] = addBoxes(3);
    st().select([a, b]);
    st().groupSelected();
    const gid = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group')!;
    const before = worldTransform(st().scene, a);
    expect(st().moveNode(a, { parentId: null, index: 0 })).toBe(true);
    expect(st().scene.rootIds[0]).toBe(a);
    expect((st().scene.nodes[gid] as GroupNode).children).toEqual([b]);
    const after = worldTransform(st().scene, a);
    after.position.forEach((v, i) => expect(v).toBeCloseTo(before.position[i], 3));
    expect(st().scene.rootIds).toContain(c);
  });

  it('riordina nello stesso elenco, anche verso il basso', () => {
    const [a, b, c] = addBoxes(3);
    // rootIds ha le novità in cima: [c, b, a]
    expect(st().scene.rootIds).toEqual([c, b, a]);
    // Sposto c dopo a (in fondo): l'indice 3 è "dopo l'ultimo"
    st().moveNode(c, { parentId: null, index: 3 });
    expect(st().scene.rootIds).toEqual([b, a, c]);
    st().moveNode(c, { parentId: null, index: 0 });
    expect(st().scene.rootIds).toEqual([c, b, a]);
  });

  it('rifiuta lo spostamento di un gruppo dentro un proprio discendente o dentro se stesso', () => {
    const [a, b, c] = addBoxes(3);
    st().select([a, b]);
    st().groupSelected();
    const inner = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group')!;
    st().select([inner, c]);
    st().groupSelected();
    const outer = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group')!;
    expect(canMoveInto(st().scene, outer, inner)).toBe(false);
    expect(canMoveInto(st().scene, outer, outer)).toBe(false);
    expect(st().moveNode(outer, { parentId: inner, index: 0 })).toBe(false);
  });

  it('rifiuta di spostare oggetti bloccati o dentro gruppi bloccati', () => {
    const [a, b] = addBoxes(2);
    st().select([a]);
    st().toggleLockSelected();
    st().select([b]);
    st().groupSelected();
    expect(st().moveNode(a, { parentId: null, index: 0 })).toBe(false);
    st().select([a, b]);
    const gid = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group')!;
    st().select([gid]);
    st().toggleLockSelected();
    const [x] = addBoxes(1);
    expect(st().moveNode(x, { parentId: gid, index: 0 })).toBe(false);
  });

  it('elimina il gruppo rimasto vuoto, anche a cascata', () => {
    const [a, b, c] = addBoxes(3);
    st().select([a, b]);
    st().groupSelected();
    const inner = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group')!;
    st().select([inner, c]);
    st().groupSelected();
    const outer = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group')!;
    // Porto fuori c: outer resta con il solo inner
    st().moveNode(c, { parentId: null, index: 0 });
    expect((st().scene.nodes[outer] as GroupNode).children).toEqual([inner]);
    // Svuoto inner: sparisce lui, e a cascata anche outer
    st().moveNode(a, { parentId: null, index: 0 });
    expect(st().scene.nodes[inner]).toBeDefined();
    st().moveNode(b, { parentId: null, index: 0 });
    expect(st().scene.nodes[inner]).toBeUndefined();
    expect(st().scene.nodes[outer]).toBeUndefined();
    expect([...st().scene.rootIds].sort()).toEqual([a, b, c].sort());
  });

  it('un foro spostato in un Raggruppa diventa un solido; in una Unione resta un foro', () => {
    const [a, b, c] = addBoxes(3);
    st().select([c]);
    st().toggleHoleSelected();
    st().select([a, b]);
    st().groupSelected();
    const group = st().scene.rootIds.find((id) => isAppGroup(st().scene.nodes[id]))!;
    st().moveNode(c, { parentId: group, index: 0 });
    expect(st().scene.nodes[c].mode).toBe('solid');

    const [d, e, f] = addBoxes(3);
    st().select([f]);
    st().toggleHoleSelected();
    st().select([d, e]);
    st().unionSelected();
    const union = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group' && (st().scene.nodes[id] as GroupNode).op === 'union')!;
    st().moveNode(f, { parentId: union, index: 0 });
    expect(st().scene.nodes[f].mode).toBe('hole');
  });

  it('Annulla ripristina lo spostamento in un solo passo', () => {
    const [a, b, c] = addBoxes(3);
    st().select([a, b]);
    st().groupSelected();
    const gid = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group')!;
    st().moveNode(c, { parentId: gid, index: 0 });
    expect(st().scene.rootIds).not.toContain(c);
    undo();
    expect(st().scene.rootIds).toContain(c);
    expect((st().scene.nodes[gid] as GroupNode).children).not.toContain(c);
  });
});

describe('destinazioni del trascinamento (outliner)', () => {
  it('zoneAt: un gruppo ha anche la zona centrale, gli altri si dividono a metà', () => {
    expect(zoneAt(0.1, true)).toBe('before');
    expect(zoneAt(0.5, true)).toBe('inside');
    expect(zoneAt(0.9, true)).toBe('after');
    expect(zoneAt(0.3, false)).toBe('before');
    expect(zoneAt(0.7, false)).toBe('after');
  });

  it('dropTarget calcola genitore e indice, e rifiuta le destinazioni non valide', () => {
    const [a, b, c] = addBoxes(3); // rootIds: [c, b, a]
    st().select([a, b]);
    st().groupSelected();
    const gid = st().scene.rootIds.find((id) => st().scene.nodes[id].type === 'group')!;
    const scene = st().scene;
    // Prima / dopo una riga alla radice
    expect(dropTarget(scene, c, gid, 'after')).toEqual({ parentId: null, index: scene.rootIds.indexOf(gid) + 1 });
    // Dentro un gruppo: in fondo ai suoi figli
    expect(dropTarget(scene, c, gid, 'inside')).toEqual({ parentId: gid, index: 2 });
    // Prima di un figlio: genitore il gruppo
    expect(dropTarget(scene, c, a, 'before')?.parentId).toBe(gid);
    // Su se stesso o dentro un proprio discendente: rifiutato
    expect(dropTarget(scene, c, c, 'after')).toBeNull();
    expect(dropTarget(scene, gid, a, 'before')).toBeNull();
  });
});
