import { describe, expect, it } from 'vitest';
import { sceneToOpenScad } from '../../codegen/openscad';
import { primitiveDefaults, shape2dDefaults } from '../../scene/defaults';
import { addPlateScene, moveRootsToPlate, platesOf, renamePlateScene } from '../../scene/plates';
import type { GroupNode, PrimitiveNode, Scene, Shape2DNode } from '../../scene/types';
import { importScad } from './toScene';

/** Primo oggetto alla radice del primo piatto. */
const first = (code: string) => {
  const r = importScad(code);
  return { r, node: r.nodes[r.plates[0].rootIds[0]] };
};
const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 2));

describe('import di file OpenSCAD: forme e trasformazioni', () => {
  it('cube non centrato: il centro dell\'oggetto sta a metà delle misure', () => {
    const { node } = first('cube([10, 20, 30]);');
    expect(node).toMatchObject({ type: 'primitive', kind: 'box', size: [10, 20, 30] });
    near(node.position, [5, 10, 15]);
  });

  it('translate e center=true; un numero solo vale per i tre lati', () => {
    const { node } = first('translate([10, 0, 5]) cube(8, center = true);');
    expect(node).toMatchObject({ kind: 'box', size: [8, 8, 8] });
    near(node.position, [10, 0, 5]);
  });

  it('rotate attorno a Z sposta anche il centro di un cubo non centrato', () => {
    // Centro locale (5, 10, 15): ruotato di 90° attorno a Z diventa (-10, 5, 15)
    const { node } = first('rotate([0, 0, 90]) cube([10, 20, 30]);');
    near(node.position, [-10, 5, 15]);
    near(node.rotation, [0, 0, 90]);
  });

  it('cilindro, cilindro con diametro, cono e $fn', () => {
    const cyl = first('cylinder(h = 20, r = 5, $fn = 32);').node as PrimitiveNode;
    expect(cyl).toMatchObject({ kind: 'cylinder', radius: 5, height: 20, segments: 32 });
    near(cyl.position, [0, 0, 10]);
    expect(first('cylinder(h = 10, d = 8, center = true);').node).toMatchObject({ kind: 'cylinder', radius: 4, height: 10 });
    const cone = first('cylinder(h = 12, r1 = 6, r2 = 0);').node;
    expect(cone).toMatchObject({ kind: 'cone', radiusBottom: 6, radiusTop: 0, height: 12 });
  });

  it('sfera: raggio, diametro e segmenti multipli di 4', () => {
    expect(first('sphere(r = 7, $fn = 30);').node).toMatchObject({ kind: 'sphere', radius: 7, segments: 32 });
    expect(first('sphere(d = 10);').node).toMatchObject({ radius: 5 });
  });

  it('scale assorbito nelle misure: ellissoide e cubo allungato', () => {
    expect(first('scale([2, 1, 0.5]) sphere(r = 10);').node).toMatchObject({ radius: 20, radiusZ: 5 });
    expect(first('scale([2, 1, 1]) cube([5, 5, 5], center = true);').node).toMatchObject({ size: [10, 5, 5] });
  });

  it('color: nome, esadecimale e terna', () => {
    expect(first('color("red") cube(1);').node.color).toBe('#ff0000');
    expect(first('color("#00ff00") cube(1);').node.color).toBe('#00ff00');
    expect(first('color([0, 0, 1]) cube(1);').node.color).toBe('#0000ff');
  });

  it('mirror su un cono non lo lascia dritto', () => {
    const cone = first('mirror([0, 0, 1]) cylinder(h = 10, r1 = 5, r2 = 0);').node as PrimitiveNode;
    expect(cone.kind).toBe('cone');
    expect(cone.mirror).toEqual([false, false, true]);
  });

  it('linear_extrude di cerchio e quadrato, e di un poligono (diventa un disegno)', () => {
    expect(first('linear_extrude(height = 6) circle(r = 4);').node).toMatchObject({ type: 'shape2d', kind: 'circle', radius: 4, height: 6 });
    const sq = first('linear_extrude(height = 3) square([10, 20]);').node as Shape2DNode;
    expect(sq).toMatchObject({ kind: 'square', width: 10, depth: 20, height: 3 });
    near(sq.position, [5, 10, 1.5]);
    const poly = first('linear_extrude(height = 2) polygon([[0, 0], [10, 0], [5, 8]]);').node as Shape2DNode;
    expect(poly).toMatchObject({ kind: 'svg', width: 10, depth: 8, height: 2 });
  });
});

describe('import di file OpenSCAD: booleane, ripetizioni, moduli', () => {
  it('difference diventa un gruppo con la base per prima', () => {
    const { r, node } = first('difference() { cube(20); translate([10, 10, -1]) cylinder(h = 30, r = 4); }');
    const g = node as GroupNode;
    expect(g).toMatchObject({ type: 'group', op: 'difference' });
    expect(g.children.map((c) => (r.nodes[c] as PrimitiveNode).kind)).toEqual(['box', 'cylinder']);
    expect(r.count).toBe(3);
  });

  it('union, intersection e hull', () => {
    expect((first('union() { cube(5); translate([3, 0, 0]) cube(5); }').node as GroupNode).op).toBe('union');
    expect((first('intersection() { cube(10); sphere(7); }').node as GroupNode).op).toBe('intersection');
    expect((first('hull() { cube(2); translate([10, 0, 0]) cube(2); }').node as GroupNode).op).toBe('hull');
  });

  it('un blocco con più oggetti dentro una trasformazione resta un solo figlio della differenza', () => {
    const { r, node } = first('difference() { translate([1, 0, 0]) { cube(5); cube(6); } sphere(2); }');
    const g = node as GroupNode;
    expect(g.children).toHaveLength(2);
    expect((r.nodes[g.children[0]] as GroupNode).op).toBe('union');
  });

  it('for e variabili: tre sfere affiancate', () => {
    const r = importScad('n = 3; step = 10; for (i = [0 : n - 1]) translate([i * step, 0, 0]) sphere(2);');
    expect(r.plates[0].rootIds).toHaveLength(3);
    expect(r.plates[0].rootIds.map((id) => r.nodes[id].position[0])).toEqual([0, 10, 20]);
  });

  it('modulo con parametri, valori predefiniti e children()', () => {
    const r = importScad(`
      module peg(h = 10, r = 2) { cylinder(h = h, r = r, center = true); }
      module raised(dz) { translate([0, 0, dz]) children(); }
      raised(5) peg(h = 6);
    `);
    const node = r.nodes[r.plates[0].rootIds[0]] as PrimitiveNode;
    expect(node).toMatchObject({ kind: 'cylinder', height: 6, radius: 2 });
    near(node.position, [0, 0, 5]);
  });

  it('funzioni, if, operatore ternario e liste per comprensione', () => {
    const r = importScad(`
      function sq(x) = x * x;
      big = sq(3) > 5 ? 10 : 1;
      if (big == 10) cube(big);
      else sphere(1);
      pts = [for (i = [0 : 2]) i * 4];
      translate([pts[2], 0, 0]) cube(1);
    `);
    const sizes = r.plates[0].rootIds.map((id) => r.nodes[id].position[0]);
    expect(r.plates[0].rootIds).toHaveLength(2);
    near([sizes[1]], [8.5]);
  });

  it('i moduli piatto_N richiamati affiancati diventano piatti, con il loro nome e senza lo spostamento', () => {
    const r = importScad(`
      // === Piatto 1: Scatola ===
      module piatto_1() { cube(10); }

      // === Piatto 2: Coperchio ===
      module piatto_2() { cylinder(h = 4, r = 5); }

      piatto_1();
      translate([276, 0, 0]) piatto_2();
    `);
    expect(r.plates.map((p) => p.name)).toEqual(['Scatola', 'Coperchio']);
    expect(r.nodes[r.plates[1].rootIds[0]]).toMatchObject({ kind: 'cylinder' });
    // La traslazione dei piatti non entra nella posizione dell'oggetto
    near(r.nodes[r.plates[1].rootIds[0]].position, [0, 0, 2]);
  });
});

describe('import di file OpenSCAD: limiti e avvisi', () => {
  it('un errore di sintassi non importa nulla e dice la riga', () => {
    const r = importScad('cube(10);\ncube(;');
    expect(r.count).toBe(0);
    expect(r.warnings[0]).toMatch(/riga 2/);
  });

  it('le istruzioni non supportate si saltano con un avviso e il resto si importa', () => {
    const r = importScad('projection() cube(1); cube(3); polyhedron(points = [[0, 0, 0]], faces = [[0]]);');
    expect(r.count).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/projection/);
    expect(r.warnings.join(' ')).toMatch(/polyhedron/);
  });

  it('use e include non si leggono, e una forma 2D fuori da linear_extrude si salta', () => {
    const r = importScad('use <BOSL2/std.scad>\ncircle(5); cube(1);');
    expect(r.count).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/BOSL2/);
    expect(r.warnings.join(' ')).toMatch(/circle\(\)/);
  });

  it('i limiti fermano un ciclo enorme senza bloccare', () => {
    const r = importScad('for (i = [0 : 1000000]) translate([i, 0, 0]) cube(1);');
    expect(r.count).toBe(0);
    expect(r.warnings[0]).toMatch(/iterazioni|oggetti|passaggi/);
  });

  it('commenti, modificatori * e % e variabili speciali', () => {
    const r = importScad('/* blocco */ $fn = 24; // commento\n*cube(1); %cube(2); #sphere(3);');
    expect(r.count).toBe(1);
    expect(r.nodes[r.plates[0].rootIds[0]]).toMatchObject({ kind: 'sphere', segments: 24 });
  });
});

describe('import di file OpenSCAD: il codice di Construct si rilegge', () => {
  const box = (id: string, position: [number, number, number]): PrimitiveNode => ({ ...primitiveDefaults('box'), id, name: id, position }) as PrimitiveNode;

  it('una scena con un solo piatto torna uguale per tipo, misure e posizione', () => {
    const scene: Scene = { nodes: { a: { ...box('a', [10, 20, 5]), size: [8, 12, 10] } as PrimitiveNode }, rootIds: ['a'] };
    const r = importScad(sceneToOpenScad(scene));
    const node = r.nodes[r.plates[0].rootIds[0]] as PrimitiveNode;
    expect(node).toMatchObject({ kind: 'box', size: [8, 12, 10] });
    near(node.position, [10, 20, 5]);
  });

  it('i parametri esportati come variabili si rileggono con i valori calcolati', () => {
    const scene: Scene = {
      nodes: { a: { ...box('a', [10, 0, 2]), size: [20, 20, 4], exprs: { 'size.2': { expr: '2 * spessore' }, 'position.0': { expr: '5 * spessore' } } } as PrimitiveNode },
      rootIds: ['a'],
      params: [{ id: 'p', name: 'spessore', expr: '2' }],
    };
    const code = sceneToOpenScad(scene);
    expect(code).toContain('spessore = 2;');
    const { node } = first(code);
    expect(node).toMatchObject({ kind: 'box', size: [20, 20, 4] });
    near(node.position, [10, 0, 2]);
  });

  it('una scena con due piatti torna con i due piatti e i loro nomi', () => {
    let scene: Scene = addPlateScene({ nodes: { a: box('a', [0, 0, 10]), b: { ...primitiveDefaults('cylinder'), id: 'b', name: 'b', position: [3, 4, 10] } as PrimitiveNode }, rootIds: ['a', 'b'] }, 'p2');
    scene = moveRootsToPlate(scene, ['b'], 'p2');
    scene = renamePlateScene(scene, 'p2', 'Coperchio');
    const r = importScad(sceneToOpenScad(scene, { plateSpacing: 276 }));
    expect(platesOf(scene)).toHaveLength(2);
    expect(r.plates.map((p) => p.name)).toEqual(['Piatto 1', 'Coperchio']);
    expect(r.nodes[r.plates[0].rootIds[0]]).toMatchObject({ kind: 'box' });
    const lid = r.nodes[r.plates[1].rootIds[0]];
    expect(lid).toMatchObject({ kind: 'cylinder' });
    near(lid.position, [3, 4, 10]);
  });
});

describe('import di file OpenSCAD: correzioni', () => {
  it('la torsione di linear_extrude ha il segno giusto, anche nel giro esporta e importa', () => {
    expect(first('linear_extrude(height = 10, twist = 90) square(5, center = true);').node).toMatchObject({ kind: 'square', twist: -90 });
    const node = { ...shape2dDefaults('square'), id: 'a', name: 'a', position: [0, 0, 5], twist: 45, height: 10 } as Shape2DNode;
    const r = importScad(sceneToOpenScad({ nodes: { a: node }, rootIds: ['a'] }));
    expect(r.nodes[r.plates[0].rootIds[0]]).toMatchObject({ kind: 'square', twist: 45 });
  });

  it("una variabile assegnata più volte vale l'ultima assegnazione, con un avviso", () => {
    const { node, r } = first('x = 1; cube(x); x = 2;');
    expect(node).toMatchObject({ size: [2, 2, 2] });
    expect(r.warnings.join(' ')).toMatch(/più volte/);
  });

  it('% davanti a un for o a un if disattiva tutto, come davanti a una chiamata', () => {
    const r = importScad('%for (i = [0 : 2]) cube(1); %if (true) cube(2); sphere(1);');
    expect(r.count).toBe(1);
  });

  it('! importa solo gli oggetti marcati', () => {
    const r = importScad('cube(1); !sphere(3);');
    expect(r.count).toBe(1);
    expect(r.nodes[r.plates[0].rootIds[0]]).toMatchObject({ kind: 'sphere' });
    expect(r.warnings.join(' ')).toMatch(/!/);
  });
});

describe('import di file OpenSCAD: linguaggio', () => {
  it('let come istruzione, come assign e come espressione', () => {
    expect(first('let (a = 4, b = a * 2) cube(b);').node).toMatchObject({ size: [8, 8, 8] });
    expect(first('assign (a = 3) cube(a);').node).toMatchObject({ size: [3, 3, 3] });
    expect(first('s = let (a = 3) a * 2; cube(s);').node).toMatchObject({ size: [6, 6, 6] });
  });

  it('liste per comprensione: if/else, each, for annidati, forma del C e elementi misti', () => {
    const len = (code: string) => (first(`${code} cube(len(v));`).node as PrimitiveNode & { size: number[] }).size[0];
    expect(len('v = [for (i = [0 : 3]) if (i > 1) i];')).toBe(2);
    expect(len('v = [for (i = [0 : 3]) if (i > 1) i else -1];')).toBe(4);
    expect(len('v = [each [1, 2], for (i = [3 : 4]) i];')).toBe(4);
    expect(len('v = [for (i = [0 : 1]) for (j = [0 : 2]) i + j];')).toBe(6);
    expect(len('v = [for (i = 0; i < 5; i = i + 1) i];')).toBe(5);
    expect(len('v = [1, for (i = [0 : 1]) i, 9];')).toBe(4);
    expect(len('v = [for (i = [0 : 2]) let (k = i * 2) k];')).toBe(3);
  });

  it("operatore ^, funzioni anonime, echo e assert in un'espressione", () => {
    expect(first('cube(2 ^ 3);').node).toMatchObject({ size: [8, 8, 8] });
    expect(first('cube(abs(-2 ^ 2));').node).toMatchObject({ size: [4, 4, 4] });
    expect(first('f = function (x) x * 3; cube(f(2));').node).toMatchObject({ size: [6, 6, 6] });
    expect(first('x = assert(true) 5; cube(x);').node).toMatchObject({ size: [5, 5, 5] });
  });

  it('children(i), children([a, b]) e $children', () => {
    const r = importScad('module two() { translate([10, 0, 0]) children(1); children(0); } two() { cube(1); sphere(1); }');
    expect(r.plates[0].rootIds.map((id) => (r.nodes[id] as PrimitiveNode).kind)).toEqual(['sphere', 'box']);
    near(r.nodes[r.plates[0].rootIds[0]].position, [10, 0, 0]);
    expect(first('module n() { cube($children); } n() { cube(1); sphere(1); sphere(2); }').node).toMatchObject({ size: [3, 3, 3] });
    expect(importScad('module p() { children([0, 2]); } p() { cube(1); cube(2); cube(3); }').count).toBe(2);
  });

  it('$fa e $fs, se il file li imposta, danno il numero di segmenti di OpenSCAD', () => {
    expect(first('$fa = 12; $fs = 2; cylinder(h = 1, r = 10);').node).toMatchObject({ segments: 30 });
    expect(first('cylinder(h = 1, r = 10, $fn = 20);').node).toMatchObject({ segments: 20 });
  });

  it('funzioni predefinite aggiunte', () => {
    const size = (code: string) => (first(`cube(${code});`).node as PrimitiveNode & { size: number[] }).size;
    expect(size('abs(round(-2.5))')).toEqual([3, 3, 3]);
    expect(size('lookup(5, [[0, 0], [10, 20]])')).toEqual([10, 10, 10]);
    expect(size('search("b", "abc")[0] + 1')).toEqual([2, 2, 2]);
    expect(size('cross([1, 0, 0], [0, 1, 0])[2]')).toEqual([1, 1, 1]);
    expect(size('ord("A") - 64')).toEqual([1, 1, 1]);
    expect(size('len(rands(0, 1, 5, 42))')).toEqual([5, 5, 5]);
    expect(size('[1, 2, 3] * [1, 1, 1]')).toEqual([6, 6, 6]);
    expect(size('[[1, 0, 0], [0, 2, 0], [0, 0, 3]] * [1, 1, 1]')).toEqual([1, 2, 3]);
    expect(size('is_string("a") && is_bool(true) ? 7 : 1')).toEqual([7, 7, 7]);
  });
});

describe('import di file OpenSCAD: nuove forme e operazioni', () => {
  it('multmatrix compone una matrice qualsiasi', () => {
    const { node } = first('multmatrix([[1, 0, 0, 10], [0, 1, 0, 20], [0, 0, 1, 30], [0, 0, 0, 1]]) cube(2, center = true);');
    near(node.position, [10, 20, 30]);
  });

  it('polygon con paths: il secondo contorno è un foro', () => {
    const { node } = first('linear_extrude(height = 2) polygon(points = [[0, 0], [10, 0], [10, 10], [0, 10], [2, 2], [8, 2], [8, 8], [2, 8]], paths = [[0, 1, 2, 3], [4, 5, 6, 7]]);');
    expect(node).toMatchObject({ kind: 'svg', width: 10, depth: 10 });
    expect((node as Shape2DNode & { contours: unknown[] }).contours).toHaveLength(2);
  });

  it('offset: r arrotonda, delta lascia gli angoli vivi', () => {
    expect(first('linear_extrude(height = 2) offset(r = 1) square(10);').node).toMatchObject({ kind: 'square', offset: 1 });
    expect(first('linear_extrude(height = 2) offset(delta = 2) square(10);').node).toMatchObject({ offset: 2, offsetJoin: 'sharp' });
    expect(importScad('offset(1) square(1);').warnings.join(' ')).toMatch(/offset/);
  });

  it("rotate_extrude di un cerchio spostato dall'asse", () => {
    const { node } = first('rotate_extrude($fn = 48) translate([5, 0, 0]) circle(r = 1);');
    expect(node).toMatchObject({ type: 'shape2d', kind: 'circle', extrusion: 'rotate', revolveRadius: 5, radius: 1, revolveSegments: 48 });
    near(node.position, [0, 0, 0]);
  });

  it('rotate_extrude con angolo, profilo rettangolare e trasformazione di fuori', () => {
    const { node } = first('translate([0, 0, 3]) rotate_extrude(angle = 90) translate([4, 2]) square([2, 1]);');
    expect(node).toMatchObject({ kind: 'square', extrusion: 'rotate', revolveAngle: 90, revolveRadius: 5, width: 2, depth: 1 });
    near(node.position, [0, 0, 5.5]);
  });

  it('text: font del catalogo, dimensione e posizione', () => {
    const r = importScad('linear_extrude(height = 2) text("Ciao", size = 8, font = "Roboto:style=Bold", halign = "center", valign = "center");');
    expect(r.nodes[r.plates[0].rootIds[0]]).toMatchObject({ kind: 'text', text: 'Ciao', font: 'roboto-bold', size: 8 });
    near(r.nodes[r.plates[0].rootIds[0]].position, [0, 0, 1]);
    expect(r.warnings.join(' ')).toMatch(/posizione/);
    expect(first('linear_extrude(height = 2) text("A", font = "Pacifico");').node).toMatchObject({ font: 'pacifico' });
    expect(first('linear_extrude(height = 2) text("A", font = "Inesistente");').node).toMatchObject({ font: 'roboto-bold' });
  });

  it('le variabili $ hanno scope dinamico: valgono nei moduli e nelle funzioni chiamati', () => {
    // $fn impostato nel chiamante arriva al modulo richiamato
    expect(first('module m() { circle(5); } linear_extrude(1) { $fn = 24; m(); }').node).toMatchObject({ segments: 24 });
    // Passato come argomento vince sul dinamico
    expect(first('module m() { circle(5); } linear_extrude(1) { $fn = 24; m($fn = 12); }').node).toMatchObject({ segments: 12 });
    // Attraverso due livelli di moduli
    expect(first('module a() { b(); } module b() { circle(5); } linear_extrude(1) { $fn = 20; a(); }').node).toMatchObject({ segments: 20 });
    // Una funzione utente legge $fn di chi la chiama
    expect(first('function f() = $fn; module m() { $fn = 30; cylinder(h = 1, r = f()); } m();').node).toMatchObject({ radius: 30 });
    // Le variabili normali restano lessicali: una variabile locale del chiamante non è visibile nel modulo
    const r = importScad('module m() { cube(x); } module c() { x = 5; m(); } c();');
    expect(r.warnings.join(' ')).toMatch(/Variabile non definita: x/);
  });

  it('text: la spaziatura si importa e il codice di Construct la riscrive uguale', () => {
    const r = importScad('linear_extrude(height = 2) text("Ciao", spacing = 1.5);');
    expect(r.nodes[r.plates[0].rootIds[0]]).toMatchObject({ kind: 'text', spacing: 1.5 });
    expect(r.warnings.join(' ')).not.toMatch(/spaziatura/);
    // Senza spacing, o con spacing = 1, il campo non c'è
    expect(first('linear_extrude(height = 2) text("A");').node).not.toHaveProperty('spacing');
    expect(first('linear_extrude(height = 2) text("A", spacing = 1);').node).not.toHaveProperty('spacing');
    // Fuori dai limiti: si limita e lo si dice
    const wild = importScad('linear_extrude(height = 2) text("A", spacing = 50);');
    expect(wild.nodes[wild.plates[0].rootIds[0]]).toMatchObject({ spacing: 10 });
    expect(wild.warnings.join(' ')).toMatch(/spaziatura/);
    // Roundtrip: scena → codice → import
    const back = importScad(sceneToOpenScad({ nodes: r.nodes, rootIds: r.plates[0].rootIds }));
    expect(back.nodes[back.plates[0].rootIds[0]]).toMatchObject({ kind: 'text', text: 'Ciao', spacing: 1.5 });
  });

  it("resize porta l'ingombro alla misura chiesta, anche con auto", () => {
    expect(first('resize([20, 0, 0], auto = true) cube([10, 5, 2]);').node).toMatchObject({ size: [20, 10, 4] });
    near(first('resize([20, 0, 0], auto = true) cube([10, 5, 2]);').node.position, [10, 5, 2]);
    expect(first('resize([10, 10, 10]) sphere(2);').node).toMatchObject({ kind: 'sphere', radius: 5 });
    expect(first('resize([0, 6, 0]) cube(3);').node).toMatchObject({ size: [3, 6, 3] });
  });
});

describe('import di file OpenSCAD: colori, intersection_for e rapporto dei problemi', () => {
  it('color: nomi CSS completi e alfa scartato', () => {
    expect(first('color("tomato") cube(1);').node.color).toBe('#ff6347');
    expect(first('color("RebeccaPurple") cube(1);').node.color).toBe('#663399');
    expect(first('color("#ff000080") cube(1);').node.color).toBe('#ff0000');
    expect(first('color("#f008") cube(1);').node.color).toBe('#ff0000');
    expect(first('color([0, 1, 0, 0.5]) cube(1);').node.color).toBe('#00ff00');
    expect(importScad('color("inesistente") cube(1);').warnings.join(' ')).toMatch(/colore non riconosciuto/);
  });

  it('intersection_for: intersezione dei risultati di ogni iterazione', () => {
    const { r, node } = first('intersection_for (i = [0 : 1]) translate([i * 2, 0, 0]) cube(4);');
    expect(node).toMatchObject({ type: 'group', op: 'intersection' });
    expect((node as GroupNode).children).toHaveLength(2);
    expect(r.count).toBe(3);
  });

  it('ogni problema porta la riga del codice e il livello', () => {
    const r = importScad('cube(1);\n\nprojection() cube(2);\nb = foo(2);\nx = 1;\nx = 2;');
    const at = (text: RegExp) => r.issues.find((i) => text.test(i.message));
    expect(at(/projection/)).toMatchObject({ line: 3, level: 'error' });
    expect(at(/foo\(\)/)).toMatchObject({ line: 4, level: 'error' });
    expect(at(/più volte/)).toMatchObject({ line: 6, level: 'note' });
  });

  it('le note nate nella conversione si riferiscono alla riga della forma', () => {
    const r = importScad('cube(1);\nlinear_extrude(height = 2, twist = 10) square(3);');
    expect(r.issues.find((i) => /torsione/.test(i.message))).toMatchObject({ line: 2, level: 'note' });
  });

  it('un errore di sintassi è un problema con la sua riga', () => {
    const r = importScad('cube(10);\ncube(;');
    expect(r.issues).toEqual([expect.objectContaining({ line: 2, level: 'error' })]);
  });
});

describe('import di file OpenSCAD: intervalli, $fa e $fs nei profili', () => {
  const xs = (code: string) => {
    const r = importScad(code);
    return r.plates[0].rootIds.map((id) => r.nodes[id].position[0]);
  };

  it('un intervallo [inizio:passo:fine] usa il passo (non la fine come passo)', () => {
    expect(xs('for (i = [0 : 2 : 6]) translate([i, 0, 0]) sphere(0.5);')).toEqual([0, 2, 4, 6]);
    expect(xs('for (i = [10 : -3 : 0]) translate([i, 0, 0]) sphere(0.5);')).toEqual([10, 7, 4, 1]);
    expect(xs('for (i = [0 : 1 : 2]) translate([i, 0, 0]) sphere(0.5);')).toEqual([0, 1, 2]);
  });

  it('le pale di Bauble: sette quadrati ruotati di 360/7 gradi', () => {
    const r = importScad('count = 7; linear_extrude(10) for (a = [0 : 1 : count - 1]) rotate(a * 360 / count) square([20, 2], center = true);');
    expect(r.plates[0].rootIds).toHaveLength(7);
    // Gli angoli sopra 180° tornano come negativi: si confrontano modulo 360
    const angles = r.plates[0].rootIds.map((id) => ((r.nodes[id].rotation[2] % 360) + 360) % 360);
    expect(angles[1]).toBeCloseTo(360 / 7, 1);
    expect(angles[6]).toBeCloseTo(6 * (360 / 7), 1);
  });

  it('rotate_extrude con $fa e $fs: i segmenti si calcolano dal raggio del profilo', () => {
    // Raggio massimo 32: min(360 / 2 = 180, 2π · 32 / 0.2 = 1005) = 180
    expect(first('$fa = 2; $fs = 0.2; rotate_extrude() translate([30, 0]) circle(2);').node).toMatchObject({ extrusion: 'rotate', revolveSegments: 180 });
    // Raggio piccolo: lo limita $fs (2π · 12 / 2 = 37,7 → 38)
    expect(first('$fa = 2; $fs = 2; rotate_extrude() translate([10, 0]) circle(2);').node).toMatchObject({ revolveSegments: 38 });
    // Con $fn vince $fn; senza nulla resta il predefinito
    expect(first('$fa = 2; rotate_extrude($fn = 24) translate([10, 0]) circle(2);').node).toMatchObject({ revolveSegments: 24 });
    expect((first('rotate_extrude() translate([10, 0]) circle(2);').node as Shape2DNode).revolveSegments).toBeUndefined();
  });

  it('una torsione negativa si rilegge con il segno invertito', () => {
    expect(first('linear_extrude(height = 120, twist = -160) square([120, 5], center = true);').node).toMatchObject({ kind: 'square', twist: 160 });
  });
});

describe('import di file OpenSCAD: Profilo di Bézier (andata e ritorno)', () => {
  const corner = (p: [number, number]) => ({ p, kind: 'corner' as const });
  /** Foro e contorno esterno curvi, con numeri a 4 decimali come li scrive lo store. */
  const PATHS = [
    { closed: true, nodes: [{ p: [0, 0] as [number, number], in: [-3.5, 0] as [number, number], out: [3.5, 0.0001] as [number, number], kind: 'smooth' as const }, { p: [20.1234, 5] as [number, number], in: [0, -4] as [number, number], out: [0, 4] as [number, number], kind: 'symmetric' as const }, corner([10, 18.5])] },
    { closed: true, nodes: [corner([8, 6]), corner([12, 6]), corner([10, 9])] },
  ];
  const node = (patch: Partial<Shape2DNode> = {}) => ({ ...shape2dDefaults('path'), id: 'p', name: 'Profilo', position: [10, 20, 5], paths: PATHS, width: 20.1234, depth: 18.5, ...patch }) as Shape2DNode;
  const codeOf = (n: Shape2DNode) => sceneToOpenScad({ nodes: { [n.id]: n }, rootIds: [n.id] });
  const back = (code: string) => first(code).node as Shape2DNode;

  it('lineare con torsione e offset: torna un Profilo con gli stessi contorni', () => {
    const original = node({ height: 8, twist: 45, scaleTop: 0.8, offset: 1.5, offsetJoin: 'sharp' } as Partial<Shape2DNode>);
    const result = back(codeOf(original)) as Extract<Shape2DNode, { kind: 'path' }>;
    expect(result).toMatchObject({ type: 'shape2d', kind: 'path', name: 'Profilo', tolerance: 0.05, width: 20.1234, depth: 18.5, height: 8, twist: 45, scaleTop: 0.8, offset: 1.5, offsetJoin: 'sharp' });
    expect(result.paths).toStrictEqual(PATHS);
    near(result.position, [10, 20, 5]);
  });

  it('rotazione: torna un Profilo senza revolveRadius', () => {
    const original = node({ extrusion: 'rotate', revolveAngle: 270, revolveSegments: 48, paths: [{ closed: false, nodes: [corner([25, 0]), corner([35, 0]), corner([35, 20])] }], width: 10, depth: 20 } as Partial<Shape2DNode>);
    const result = back(codeOf(original)) as Extract<Shape2DNode, { kind: 'path' }>;
    expect(result).toMatchObject({ kind: 'path', extrusion: 'rotate', revolveAngle: 270, revolveSegments: 48, width: 10, depth: 20 });
    expect(result).not.toHaveProperty('revolveRadius');
    expect(result.paths).toStrictEqual(original.type === 'shape2d' && original.kind === 'path' ? original.paths : []);
    near(result.position, [10, 20, 5]);
  });

  it('lineare dentro scale(2): le misure raddoppiano, i contorni restano', () => {
    const result = back(`scale([2, 2, 2]) {\n${codeOf(node())}\n}`) as Extract<Shape2DNode, { kind: 'path' }>;
    expect(result.kind).toBe('path');
    expect(result.paths).toStrictEqual(PATHS);
    expect(result.width).toBeCloseTo(2 * 20.1234, 2);
    expect(result.depth).toBeCloseTo(37, 2);
  });

  it('rotazione dentro scale(): il raggio non si imposta, torna un Poligono', () => {
    const original = node({ extrusion: 'rotate', paths: [{ closed: true, nodes: [corner([25, 0]), corner([35, 0]), corner([35, 20])] }], width: 10, depth: 20 } as Partial<Shape2DNode>);
    expect(back(`scale([2, 2, 2]) {\n${codeOf(original)}\n}`)).toMatchObject({ kind: 'svg', name: 'Poligono' });
  });

  it('un punto modificato a mano, un commento staccato o un JSON rovinato: Poligono, senza eccezioni', () => {
    const code = codeOf(node());
    expect(back(code.replace(/(polygon\(points = \[\s*\[)(-?[\d.]+)/, (_m, a, b) => `${a}${Number(b) + 0.5}`))).toMatchObject({ kind: 'svg' });
    expect(back(code.replace(/(\/\/ construct:path [^\n]*\n)/, '$1\n'))).toMatchObject({ kind: 'svg' });
    expect(back(code.replace('"paths":', '"paths"'))).toMatchObject({ kind: 'svg' });
    expect(back(code.replace('"v":1', '"v":7'))).toMatchObject({ kind: 'svg' });
    // Senza commento resta il Poligono di sempre
    expect(back(code.split('\n').filter((l) => !l.includes('construct:path')).join('\n'))).toMatchObject({ kind: 'svg' });
  });

  it('rotazione oltre l asse: il ritaglio resta e il Profilo torna dentro l intersezione', () => {
    const across = node({ extrusion: 'rotate', paths: [{ closed: true, nodes: [corner([-5, 0]), corner([5, 0]), corner([5, 10]), corner([-5, 10])] }], width: 10, depth: 10 } as Partial<Shape2DNode>);
    const r = importScad(codeOf(across));
    const root = r.nodes[r.plates[0].rootIds[0]] as GroupNode;
    expect(root).toMatchObject({ type: 'group', op: 'intersection' });
    expect(root.children.map((id) => r.nodes[id])).toContainEqual(expect.objectContaining({ kind: 'path', extrusion: 'rotate' }));
  });

  it('600 nodi nel commento (oltre il limite): Poligono senza eccezioni, mentre con un commento valido nello stesso punto torna un Profilo', () => {
    // Stesso schema (commento sulla riga subito prima di polygon): cambia solo il commento
    const code = codeOf(node());
    expect(back(code)).toMatchObject({ kind: 'path' });
    const nodes = Array.from({ length: 600 }, (_, i) => corner([i, (i * 7) % 11]));
    const meta = JSON.stringify({ v: 1, w: 10, d: 10, t: 0.05, paths: [{ closed: true, nodes }] });
    const rows = code.split(/\r?\n/);
    const at = rows.findIndex((l) => l.startsWith('// construct:path '));
    expect(rows[at + 1]).toMatch(/^polygon\(/);
    rows[at] = `// construct:path ${meta}`;
    expect(back(rows.join(String.fromCharCode(10)))).toMatchObject({ kind: 'svg' });
  });

  it('un commento lecito ma enorme (100 contorni da 500 nodi, tetto di punti superato): Poligono senza eccezioni', () => {
    const paths = Array.from({ length: 100 }, (_, k) => ({ closed: true, nodes: Array.from({ length: 500 }, (_, i) => ({ p: [i * 0.01, 50 * k], out: [10, 20], in: [10, -5], kind: 'corner' })) }));
    const meta = JSON.stringify({ v: 1, w: 100, d: 100, t: 0.05, paths });
    const code = `linear_extrude(height = 10, center = true)
// construct:path ${meta}
polygon([[0, 0], [10, 0], [0, 10]]);`;
    expect(back(code)).toMatchObject({ kind: 'svg' });
  }, 20000);
});
