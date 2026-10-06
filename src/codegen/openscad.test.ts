import { describe, expect, it } from 'vitest';
import { sceneToOpenScad } from './openscad';
import { primitiveDefaults } from '../scene/defaults';
import type { GroupNode, PrimitiveNode, Scene } from '../scene/types';

const scene = (): Scene => {
  const box = { ...primitiveDefaults('box'), id: 'b', name: 'Scatola', position: [0, 0, 10] } as PrimitiveNode;
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
            // Scatola
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
    expect(code.indexOf('// Scatola')).toBeLessThan(code.indexOf('// Foro'));
    expect(code).not.toContain('union()');
  });
});
