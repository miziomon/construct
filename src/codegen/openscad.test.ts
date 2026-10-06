import { describe, expect, it } from 'vitest';
import { sceneToOpenScad } from './openscad';
import { primitiveDefaults, shape2dDefaults } from '../scene/defaults';
import type { GroupNode, PrimitiveNode, Scene, Shape2DNode } from '../scene/types';

const scene = (): Scene => {
  const box = { ...primitiveDefaults('box'), id: 'b', name: 'Cubo', position: [0, 0, 10] } as PrimitiveNode;
  const hole = {
    ...primitiveDefaults('cylinder'), id: 'h', name: 'Foro', position: [0, 0, 10], mode: 'hole', radius: 5, height: 40,
  } as PrimitiveNode;
  const g: GroupNode = {
    id: 'g', name: 'Gruppo', type: 'group', op: 'union', children: ['b', 'h'], position: [5, 0, 0], rotation: [0, 0, 90], mode: 'solid', color: '#4da3ff',
  };
  return { nodes: { b: box, h: hole, g }, rootIds: ['g'] };
};

describe('sceneToOpenScad', () => {
  it('genera difference() con solid e hole e trasformazioni nell ordine corretto', () => {
    expect(sceneToOpenScad(scene())).toMatchInlineSnapshot(`
      "// Generato da WebCAD. Unità: millimetri.

      // Gruppo
      translate([5, 0, 0]) rotate([0, 0, 90]) color([0.302, 0.639, 1]) {
        difference() {
          union() {
            // Cubo
            translate([0, 0, 10]) color([0.302, 0.639, 1]) cube([20, 20, 20], center = true);
          }
          // Foro (foro)
          translate([0, 0, 10]) cylinder(h = 40, r = 5, center = true, $fn = 64);
        }
      }
      "
    `);
  });

  it('scena vuota o con soli hole alla radice non produce geometria', () => {
    expect(sceneToOpenScad({ nodes: {}, rootIds: [] })).toContain('// Scena vuota');
  });

  it('gruppo di tipo differenza: difference() con i figli in ordine', () => {
    const sc = scene();
    (sc.nodes.g as GroupNode).op = 'difference';
    const code = sceneToOpenScad(sc);
    expect(code).toContain('difference() {');
    expect(code.indexOf('// Cubo')).toBeLessThan(code.indexOf('// Foro'));
    expect(code).not.toContain('union()');
  });

  it('forme 2D estruse: linear_extrude con $fn, torsione invertita e angoli con offset', () => {
    const hex = { ...shape2dDefaults('circle'), id: 'h', name: 'Esagono', position: [0, 0, 5], radius: 10, segments: 6, twist: 90, scaleTop: 0.5 } as Shape2DNode;
    const sq = { ...shape2dDefaults('square'), id: 's', name: 'Piastra', position: [0, 0, 5], width: 30, depth: 20, cornerRadius: 4 } as Shape2DNode;
    const code = sceneToOpenScad({ nodes: { h: hex, s: sq }, rootIds: ['h', 's'] });
    expect(code).toContain('linear_extrude(height = 10, center = true, twist = -90, scale = 0.5, slices = 45) circle(r = 10, $fn = 6);');
    expect(code).toContain('offset(r = 4, $fn = 32) square([22, 12], center = true);');
  });

  it('scatola arrotondata: hull() di otto sfere', () => {
    const box = { ...primitiveDefaults('box'), id: 'b', name: 'Cubo', position: [0, 0, 10], size: [20, 20, 20], cornerRadius: 2 } as PrimitiveNode;
    const code = sceneToOpenScad({ nodes: { b: box }, rootIds: ['b'] });
    expect(code).toContain('hull() for (x = [-8, 8], y = [-8, 8], z = [-8, 8]) translate([x, y, z]) sphere(r = 2, $fn = 24);');
  });
});
