import { describe, expect, it } from 'vitest';
import { primitiveDefaults, shape2dDefaults } from './defaults';
import { sceneFromJson, sceneToJson } from './persistence';
import type { CornerNode, EdgeNode, GroupNode, PrimitiveNode, Scene, SceneNode, Shape2DNode, Vec3 } from './types';

/**
 * Il file di progetto (Salva / Apri progetto) contiene la scena intera: tutto ciò che il codice OpenSCAD non può
 * rappresentare (ordine degli oggetti, Raggruppa, nomi, blocchi, fori alla radice, colori) viaggia nel JSON.
 */

const prim = (id: string, kind: PrimitiveNode['kind'], extra: Record<string, unknown> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults(kind), id, name: `Nome ${id}`, position: [1, 2, 3], ...extra }) as PrimitiveNode;
const group = (id: string, op: GroupNode['op'], children: string[], extra: Partial<GroupNode> = {}): GroupNode => ({
  id, name: `Gruppo ${id}`, type: 'group', op, children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#123456', ...extra,
});
const sceneOf = (nodes: SceneNode[], rootIds: string[]): Scene => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds });

/** Scena con un esemplare di ogni cosa che il codice OpenSCAD perde o riordina. */
function fullScene(): Scene {
  const edge: EdgeNode = {
    id: 'e', type: 'edge', name: 'Smusso', position: [10, 0, 20], rotation: [-90, 45, 0], mode: 'solid', color: '#abcdef',
    treatment: 'chamfer', convex: true, angle: 90, length: 20, radius: 2, distance1: 3, distance2: 4, reach: 20, ends: [null, null], endVia: [null, 'x'],
  };
  const corner: CornerNode = {
    id: 'c', type: 'corner', name: 'Raccordo angolare', position: [10, 10, 20], rotation: [0, 0, 0], mode: 'solid', color: '#abcdef',
    treatment: 'fillet', directions: [[-1, 0, 0], [0, -1, 0], [0, 0, -1]], lengths: [20, 20, 20], distance: 3, segments: 32,
  };
  const twisted = { ...shape2dDefaults('square'), id: 't', name: 'Quadrato torto', position: [5, 5, 0] as Vec3, twist: 45, scaleTop: 0.5 } as Shape2DNode;
  return sceneOf(
    [
      // Formato attuale: la posizione sta sul gruppo del trattamento (s), non sul pezzo
      prim('a', 'box', { locked: true, mode: 'solid', color: '#ff0000', position: [0, 0, 0] }),
      prim('b', 'cylinder', { mode: 'hole' }),
      edge,
      corner,
      group('d', 'difference', ['a', 'e']),
      group('s', 'shell', ['d'], { position: [1, 2, 3], shell: { wall: 2, bottom: 3, bounds: { min: [-10, -10, 0], max: [10, 10, 20] } } }),
      group('g', 'group', ['b', 'c']),
      group('u', 'union', ['s', 'g'], { position: [5, 6, 7], rotation: [10, 20, 30], locked: true }),
      twisted,
    ],
    ['t', 'u'],
  );
}

describe('file di progetto JSON', () => {
  it('andata e ritorno identica: ordine, gruppi, nomi, blocchi, modi, colori, guscio, smussi e angoli', () => {
    const scene = fullScene();
    const { scene: loaded } = sceneFromJson(sceneToJson(scene));
    expect(loaded).toEqual(scene);
    // L'ordine degli oggetti alla radice e dei figli di ogni gruppo si conserva
    expect(loaded.rootIds).toEqual(['t', 'u']);
    expect((loaded.nodes.u as GroupNode).children).toEqual(['s', 'g']);
    expect((loaded.nodes.g as GroupNode).op).toBe('group');
  });

  it('il file è leggibile: formato, versione, scena e nessun dato di interfaccia', () => {
    const data = JSON.parse(sceneToJson(fullScene()));
    expect(data.format).toBe('webcad-scene');
    expect(data.version).toBeGreaterThanOrEqual(3);
    expect(Object.keys(data).sort()).toEqual(['assets', 'format', 'scene', 'version']);
  });

  it('un file che non è un progetto è rifiutato con un messaggio', () => {
    expect(() => sceneFromJson('{"a":1}')).toThrow('progetto WebCAD');
    expect(() => sceneFromJson('non json')).toThrow('progetto WebCAD');
  });

  it('un progetto salvato con il gruppo dei trattamenti all\'origine viene sistemato all\'apertura', () => {
    const cube = prim('a', 'box', { position: [30, 40, 10] });
    const edge: EdgeNode = {
      id: 'e', type: 'edge', name: 'Smusso', position: [40, 30, 20], rotation: [0, 0, 0], mode: 'solid', color: '#fff',
      treatment: 'chamfer', convex: true, angle: 90, length: 20, radius: 2, distance1: 3, distance2: 3, reach: 20, ends: [null, null],
    };
    const legacy = sceneOf([cube, edge, group('d', 'difference', ['a', 'e'])], ['d']);
    const { scene } = sceneFromJson(sceneToJson(legacy));
    expect((scene.nodes.d as GroupNode).position).toEqual([30, 40, 10]);
    expect(scene.nodes.a.position).toEqual([0, 0, 0]);
    expect(scene.nodes.e.position).toEqual([10, -10, 10]);
  });
});
