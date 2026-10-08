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
  it('l inviluppo convesso esce come hull() e i fori si sottraggono', () => {
    const a = { ...primitiveDefaults('box'), id: 'a', name: 'A', position: [-20, 0, 0] } as PrimitiveNode;
    const b = { ...primitiveDefaults('sphere'), id: 'b', name: 'B', position: [20, 0, 0] } as PrimitiveNode;
    const hole = { ...primitiveDefaults('box'), id: 'h', name: 'Foro', position: [0, 0, 0], mode: 'hole' } as PrimitiveNode;
    const g: GroupNode = { id: 'g', name: 'Inviluppo', type: 'group', op: 'hull', children: ['a', 'b', 'h'], position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#4da3ff' };
    const code = sceneToOpenScad({ nodes: { a, b, h: hole, g }, rootIds: ['g'] });
    expect(code).toContain('difference() {');
    expect(code).toContain('hull() {');
    expect(code).not.toContain('union() {');
  });

  it('l estrusione rotazionale esce come rotate_extrude con la parte x >= 0', () => {
    const circle = { ...shape2dDefaults('circle'), id: 'c', name: 'Anello', position: [0, 0, 0], extrusion: 'rotate', revolveRadius: 25, revolveAngle: 270, revolveSegments: 48 } as Shape2DNode;
    const code = sceneToOpenScad({ nodes: { c: circle }, rootIds: ['c'] });
    expect(code).toContain(['rotate_extrude(angle = 270, $fn = 48)', 'intersection() {', '  translate([25, 0])', '  circle(r = 10, $fn = 64);'].join(String.fromCharCode(10)));
    expect(code).toContain('square([1000, 2000]);');
    expect(code).not.toContain('linear_extrude');
  });

  it('emette mirror() dopo rotate, uno per asse specchiato', () => {
    const box = { ...primitiveDefaults('box'), id: 'b', name: 'Cubo', position: [0, 0, 10], rotation: [0, 0, 90], mirror: [true, false, true] } as PrimitiveNode;
    const code = sceneToOpenScad({ nodes: { b: box }, rootIds: ['b'] });
    expect(code).toContain(['rotate([0, 0, 90])', 'mirror([1, 0, 0])', 'mirror([0, 0, 1])', 'color('].join('\n'));
  });

  it('genera difference() con solid e hole e trasformazioni nell ordine corretto', () => {
    expect(sceneToOpenScad(scene())).toMatchInlineSnapshot(`
      "// Generato da Construct. Unità: millimetri.

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

describe('nuove forme 2D e testo in OpenSCAD', () => {
  const node = (kind: Parameters<typeof shape2dDefaults>[0], patch: Record<string, unknown> = {}) =>
    ({ ...shape2dDefaults(kind), id: kind, name: kind, position: [0, 0, 5], ...patch }) as Shape2DNode;
  const codeOf = (...nodes: Shape2DNode[]) => sceneToOpenScad({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), rootIds: nodes.map((n) => n.id) });

  it('forma poligonale: linear_extrude di un polygon con i punti su più righe', () => {
    const code = codeOf(node('trapezoid', { width: 24, depth: 16, ratio: 0.5 }));
    expect(code).toContain('linear_extrude(height = 10, center = true, twist = 0, scale = 1, slices = 1)\npolygon([');
    expect(code).toContain('[-12, -8]');
    expect(code).toContain('[6, 8]');
    expect(code).not.toContain('use <');
    // Nessuna riga lunga: i punti vanno a gruppi di tre
    expect(Math.max(...code.split('\n').map((l) => l.length))).toBeLessThan(120);
  });

  it('anello: polygon con points e paths (esterno e foro)', () => {
    const code = codeOf(node('ring', { width: 40, depth: 40, ratio: 0.5 }));
    expect(code).toContain('polygon(points = [');
    expect(code).toMatch(/\], paths = \[\[0, 1, 2, .*\], \[64, 65, .*127\]\]\);/);
  });

  it('testo: use <file.ttf> una volta per font, text() con il nome del font e il testo protetto', () => {
    const code = codeOf(
      node('text', { id: 't1', text: 'Ciao "mondo"', font: 'pacifico', size: 12 }),
      node('text', { id: 't2', text: 'a\\b', font: 'pacifico' }),
      node('text', { id: 't3', text: 'Z', font: 'roboto-bold' }),
    );
    expect(code.match(/^use <Pacifico-Regular\.ttf>;$/gm)).toHaveLength(1);
    expect(code).toContain('use <Roboto-Bold.ttf>;');
    expect(code).toContain('text("Ciao \\"mondo\\"", size = 12, font = "Pacifico:style=Regular", halign = "center", valign = "center");');
    expect(code).toContain('text("a\\\\b"');
    expect(code).toContain('font = "Roboto:style=Bold"');
    // La spaziatura compare solo se diversa da 1
    expect(code).not.toContain('spacing');
    expect(codeOf(node('text', { id: 't4', text: 'Ciao', font: 'pacifico', size: 12, spacing: 1.5 }))).toContain('text("Ciao", size = 12, spacing = 1.5, font = "Pacifico:style=Regular"');
    expect(codeOf(node('text', { id: 't5', text: 'Ciao', font: 'pacifico', spacing: 1 }))).not.toContain('spacing');
    // Gli use stanno in testa, prima del primo oggetto
    expect(code.indexOf('use <')).toBeLessThan(code.indexOf('linear_extrude'));
  });

  it('senza testo non compaiono righe use', () => {
    expect(codeOf(node('square'))).not.toContain('use <');
  });
});
