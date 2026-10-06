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
      translate([5, 0, 0])
      rotate([0, 0, 90])
      color([0.302, 0.639, 1]) {
        difference() {
          union() {
            // Cubo
            translate([0, 0, 10])
            color([0.302, 0.639, 1])
            cube([20, 20, 20], center = true);
          }
          // Foro (foro)
          translate([0, 0, 10])
          cylinder(h = 40, r = 5, center = true, $fn = 64);
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
    expect(code).toContain('linear_extrude(height = 10, center = true, twist = -90, scale = 0.5, slices = 45)\ncircle(r = 10, $fn = 6);');
    expect(code).toContain('offset(r = 4, $fn = 32)\nsquare([22, 12], center = true);');
  });

  it('scatola arrotondata: hull() di otto sfere', () => {
    const box = { ...primitiveDefaults('box'), id: 'b', name: 'Cubo', position: [0, 0, 10], size: [20, 20, 20], cornerRadius: 2 } as PrimitiveNode;
    const code = sceneToOpenScad({ nodes: { b: box }, rootIds: ['b'] });
    expect(code).toContain('hull()\nfor (x = [-8, 8], y = [-8, 8], z = [-8, 8])\ntranslate([x, y, z])\nsphere(r = 2, $fn = 24);');
  });

  it('ogni comando sta su una riga e nessuna riga è lunga, anche per i solidi dei dadi', () => {
    const kinds = ['octahedron', 'decahedron', 'dodecahedron', 'icosahedron'] as const;
    const nodes: Record<string, PrimitiveNode> = {};
    for (const kind of kinds) {
      nodes[kind] = { ...primitiveDefaults(kind), id: kind, name: kind, position: [0, 0, 10] } as PrimitiveNode;
      nodes[`${kind}-r`] = { ...primitiveDefaults(kind), id: `${kind}-r`, name: kind, position: [0, 0, 10], cornerRadius: 3 } as PrimitiveNode;
    }
    const code = sceneToOpenScad({ nodes, rootIds: Object.keys(nodes) });
    for (const line of code.split('\n')) {
      expect(line.length, line).toBeLessThanOrEqual(100);
      // Tolti gli elenchi tra parentesi quadre, resta al massimo un comando (nome seguito da "(") per riga
      const commands = line.replace(/\[[^\]]*\]/g, '[]').match(/\b[a-z_]+\s*\(/g) ?? [];
      expect(commands.length, line).toBeLessThanOrEqual(1);
    }
  });

  it('forme non proporzionali: scale() prima del primitivo, solo se serve', () => {
    const cyl = { ...primitiveDefaults('cylinder'), id: 'c', name: 'Ovale', position: [0, 0, 10], radius: 10, radiusY: 5 } as PrimitiveNode;
    const sph = { ...primitiveDefaults('sphere'), id: 's', name: 'Uovo', position: [0, 0, 10], radius: 10, radiusZ: 20 } as PrimitiveNode;
    const round = { ...primitiveDefaults('cylinder'), id: 'r', name: 'Tondo', position: [0, 0, 10], radius: 10, radiusY: 10 } as PrimitiveNode;
    const code = sceneToOpenScad({ nodes: { c: cyl, s: sph, r: round }, rootIds: ['c', 's', 'r'] });
    expect(code).toContain('scale([1, 0.5, 1])\ncylinder(h = 20, r = 10');
    expect(code).toContain('scale([1, 1, 2])\nsphere(r = 10');
    // Con i due raggi uguali il codice resta quello di prima
    expect(code.match(/scale\(/g)).toHaveLength(2);
  });

  describe('Raggruppa', () => {
    const box = (id: string, position: [number, number, number], color: string) =>
      ({ ...primitiveDefaults('box'), id, name: id, position, color }) as PrimitiveNode;
    const group = (id: string, op: GroupNode['op'], children: string[], extra: Partial<GroupNode> = {}): GroupNode => ({
      id, name: id, type: 'group', op, children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#ffffff', ...extra,
    });

    it('non produce union() né graffe: ogni figlio è un oggetto a sé, con la trasformazione del gruppo composta e il proprio colore', () => {
      const nodes = {
        a: box('a', [-20, 0, 0], '#ff0000'),
        b: box('b', [20, 0, 0], '#00ff00'),
        g: group('g', 'group', ['a', 'b'], { position: [100, 0, 0], rotation: [0, 0, 90] }),
      };
      const code = sceneToOpenScad({ nodes, rootIds: ['g'] });
      expect(code).not.toContain('union()');
      expect(code).not.toContain('{');
      // a: (-20, 0, 0) ruotato di 90° attorno a Z va in (0, -20, 0), poi + (100, 0, 0)
      expect(code).toContain('// a\ntranslate([100, -20, 0])\nrotate([0, 0, 90])\ncolor([1, 0, 0])\ncube([20, 20, 20], center = true);');
      expect(code).toContain('// b\ntranslate([100, 20, 0])\nrotate([0, 0, 90])\ncolor([0, 1, 0])\ncube([20, 20, 20], center = true);');
    });

    it('più livelli: le trasformazioni di Raggruppa annidati si compongono', () => {
      const nodes = {
        a: box('a', [5, 0, 0], '#ff0000'),
        inner: group('inner', 'group', ['a'], { position: [10, 0, 0] }),
        outer: group('outer', 'group', ['inner'], { position: [0, 50, 0] }),
      };
      expect(sceneToOpenScad({ nodes, rootIds: ['outer'] })).toContain('// a\ntranslate([15, 50, 0])');
    });

    it('dentro una Unione il Raggruppa vale come union() dei suoi figli', () => {
      const nodes = {
        a: box('a', [0, 0, 0], '#ff0000'),
        b: box('b', [30, 0, 0], '#00ff00'),
        g: group('g', 'group', ['a', 'b']),
        u: group('u', 'union', ['g']),
      };
      const code = sceneToOpenScad({ nodes, rootIds: ['u'] });
      // Il gruppo interno diventa un union() con i due figli
      expect(code.match(/union\(\) \{/g)).toHaveLength(2);
    });

    it('una booleana dentro un Raggruppa resta un blocco unico con la trasformazione del gruppo', () => {
      const nodes = {
        a: box('a', [0, 0, 0], '#ff0000'),
        b: box('b', [30, 0, 0], '#00ff00'),
        u: group('u', 'union', ['a', 'b']),
        side: box('side', [100, 0, 0], '#0000ff'),
        g: group('g', 'group', ['u', 'side'], { position: [0, 10, 0] }),
      };
      const code = sceneToOpenScad({ nodes, rootIds: ['g'] });
      expect(code).toContain('// u\ntranslate([0, 10, 0])');
      expect(code.match(/union\(\) \{/g)).toHaveLength(1);
      expect(code).toContain('// side\ntranslate([100, 10, 0])');
    });
  });
});
