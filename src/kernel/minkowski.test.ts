import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { sceneToOpenScad } from '../codegen/openscad';
import { importScad } from '../import/scad/toScene';
import { primitiveDefaults, shape2dDefaults } from '../scene/defaults';
import type { GroupNode, PrimitiveNode, Scene, Shape2DNode } from '../scene/types';
import { Evaluator } from './evaluate';
import { brushSegments, minkowskiOf, segmentsForTolerance } from './minkowski';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const prim = (id: string, kind: Parameters<typeof primitiveDefaults>[0], patch: Partial<PrimitiveNode> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults(kind), id, name: id, position: [0, 0, 0], ...patch }) as PrimitiveNode;

const minkowski = (id: string, children: string[], patch: Partial<GroupNode> = {}): GroupNode => ({
  id, name: id, type: 'group', op: 'minkowski', children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#fff', ...patch,
});

/** Cubo da 10 mm con gli spigoli arrotondati da una sfera di raggio 2: a³ + 6a²r + 3πar² + 4/3πr³. */
const ROUNDED_CUBE = 1000 + 6 * 100 * 2 + 3 * Math.PI * 10 * 4 + (4 / 3) * Math.PI * 8;

const sceneOf = (group: Partial<GroupNode> = {}, sphere: Partial<PrimitiveNode> = {}): Scene => ({
  nodes: {
    cube: prim('cube', 'box', { size: [10, 10, 10], position: [5, 5, 5] } as Partial<PrimitiveNode>),
    ball: prim('ball', 'sphere', { radius: 2, segments: 48, ...sphere } as Partial<PrimitiveNode>),
    m: minkowski('m', ['cube', 'ball'], group),
  },
  rootIds: ['m'],
});

describe('Minkowski nel kernel', () => {
  it('un cubo e una sfera danno un cubo con gli spigoli arrotondati', () => {
    const [m] = new Evaluator(wasm).evaluate(sceneOf()).meshes;
    expect(m.status).toBe('NoError');
    // La sfera è un poligono: il volume è poco sotto quello ideale
    expect(m.volume).toBeGreaterThan(ROUNDED_CUBE * 0.97);
    expect(m.volume).toBeLessThan(ROUNDED_CUBE * 1.001);
    expect(m.bbox.min[0]).toBeCloseTo(-2, 1);
    expect(m.bbox.max[0]).toBeCloseTo(12, 1);
  });

  it('la posizione del gruppo si applica una volta sola, e lo spostamento di un operando sposta il risultato', () => {
    const moved = new Evaluator(wasm).evaluate(sceneOf({ position: [100, 0, 0] })).meshes[0];
    expect(moved.bbox.min[0]).toBeCloseTo(98, 1);
    expect(moved.bbox.max[0]).toBeCloseTo(112, 1);
    const lifted = new Evaluator(wasm).evaluate(sceneOf({}, { position: [0, 0, 3] })).meshes[0];
    expect(lifted.bbox.min[2]).toBeCloseTo(1, 1);
    expect(lifted.bbox.max[2]).toBeCloseTo(15, 1);
  });

  it('con tre figli la somma continua: un secondo arrotondamento', () => {
    const scene = sceneOf();
    scene.nodes.ball2 = prim('ball2', 'sphere', { radius: 1, segments: 32 } as Partial<PrimitiveNode>);
    (scene.nodes.m as GroupNode).children.push('ball2');
    const [m] = new Evaluator(wasm).evaluate(scene).meshes;
    expect(m.bbox.max[0]).toBeCloseTo(13, 1);
    expect(m.bbox.min[0]).toBeCloseTo(-3, 1);
  });

  it('un foro dentro il gruppo si sottrae dalla somma', () => {
    const scene = sceneOf();
    scene.nodes.hole = prim('hole', 'cylinder', { radius: 3, height: 40, position: [5, 5, 5], mode: 'hole' } as Partial<PrimitiveNode>);
    (scene.nodes.m as GroupNode).children.push('hole');
    const [m] = new Evaluator(wasm).evaluate(scene).meshes;
    expect(m.volume).toBeLessThan(ROUNDED_CUBE - 350);
  });

  it('senza figli il gruppo è vuoto', () => {
    const scene: Scene = { nodes: { m: minkowski('m', []) }, rootIds: ['m'] };
    expect(new Evaluator(wasm).evaluate(scene).meshes.every((x) => x.volume === 0)).toBe(true);
  });
});

describe('Minkowski nel codice OpenSCAD e nell\'importazione', () => {
  it('il codice ha minkowski() e riletto ricrea il gruppo con i figli', () => {
    const code = sceneToOpenScad(sceneOf());
    expect(code).toContain('minkowski() {');
    const r = importScad(code);
    const group = r.nodes[r.plates[0].rootIds[0]] as GroupNode;
    expect(group).toMatchObject({ type: 'group', op: 'minkowski' });
    expect(group.children).toHaveLength(2);
  });

  it('il translate di fuori si applica al risultato, non agli operandi', () => {
    const r = importScad('translate([0, 30, 0]) minkowski() { cube(10); sphere(2); }');
    const group = r.nodes[r.plates[0].rootIds[0]] as GroupNode;
    expect(group).toMatchObject({ op: 'minkowski', position: [0, 30, 0], rotation: [0, 0, 0] });
    // I figli stanno nel sistema del gruppo: il cubo con il suo centro, la sfera nell'origine
    const [cube, ball] = group.children.map((id) => r.nodes[id]);
    expect(cube.position).toEqual([5, 5, 5]);
    expect(ball.position).toEqual([0, 0, 0]);
  });

  it('rotazione e scala di fuori: la rotazione resta al gruppo, la scala passa ai figli', () => {
    const rotated = importScad('rotate([0, 0, 90]) minkowski() { cube(10); sphere(1); }');
    expect((rotated.nodes[rotated.plates[0].rootIds[0]] as GroupNode).rotation[2]).toBeCloseTo(90, 2);
    const scaled = importScad('scale(2) minkowski() { cube(1); sphere(1); }');
    const group = scaled.nodes[scaled.plates[0].rootIds[0]] as GroupNode;
    expect(group.position).toEqual([0, 0, 0]);
    const [cube, ball] = group.children.map((id) => scaled.nodes[id]);
    expect(cube).toMatchObject({ kind: 'box', size: [2, 2, 2] });
    expect(ball).toMatchObject({ kind: 'sphere', radius: 2 });
  });

  it('un solo figlio non fa un gruppo, e minkowski dentro minkowski si legge', () => {
    const single = importScad('minkowski() cube(3);');
    expect(single.nodes[single.plates[0].rootIds[0]]).toMatchObject({ kind: 'box' });
    const nested = importScad('minkowski() { minkowski() { cube(4); sphere(1); } sphere(1); }');
    expect(nested.count).toBe(5);
    expect(nested.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('il solido importato ha il volume e l\'ingombro di OpenSCAD (translate di fuori una sola volta)', () => {
    const r = importScad('translate([0, 30, 0]) minkowski() { cube(10); sphere(2, $fn = 48); }');
    const scene: Scene = { nodes: r.nodes, rootIds: r.plates[0].rootIds };
    const [m] = new Evaluator(wasm).evaluate(scene).meshes;
    expect(m.bbox.min[1]).toBeCloseTo(28, 1);
    expect(m.bbox.max[1]).toBeCloseTo(42, 1);
    expect(m.volume).toBeGreaterThan(ROUNDED_CUBE * 0.97);
  });

  it('una forma 2D estrusa si usa come operando', () => {
    const star = { ...shape2dDefaults('circle'), id: 's', name: 's', position: [0, 0, 5], radius: 5, segments: 3, height: 10 } as Shape2DNode;
    const scene: Scene = { nodes: { s: star, ball: prim('ball', 'sphere', { radius: 1, segments: 16 } as Partial<PrimitiveNode>), m: minkowski('m', ['s', 'ball']) }, rootIds: ['m'] };
    const [m] = new Evaluator(wasm).evaluate(scene).meshes;
    expect(m.status).toBe('NoError');
    expect(m.bbox.max[2]).toBeCloseTo(11, 1);
  });
});

describe('minkowskiOf con operandi lontani dall\'origine o concavi', () => {
  const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 1));

  it('un cubo e una sfera lontana: il cubo non resta dov\'era', () => {
    const { Manifold } = wasm;
    const cube = Manifold.cube([10, 10, 10], false);
    const far = Manifold.sphere(2, 48).translate([100, 0, 0]);
    const sum = minkowskiOf(Manifold, [cube, far]);
    near(sum.boundingBox().min, [98, -2, -2]);
    near(sum.boundingBox().max, [112, 12, 12]);
    expect(sum.volume()).toBeGreaterThan(ROUNDED_CUBE * 0.97);
    // L'ordine degli operandi non cambia il risultato
    near(minkowskiOf(Manifold, [far, cube]).boundingBox().min, [98, -2, -2]);
  });

  it('una sfera in alto e due cubi staccati (concavo) danno lo stesso ingombro in ogni ordine', () => {
    const { Manifold } = wasm;
    const cube = Manifold.cube([10, 10, 10], false);
    const two = Manifold.union([cube, cube.translate([30, 0, 0])]);
    const ball = Manifold.sphere(2, 32).translate([0, 0, 5]);
    for (const list of [[two, ball], [ball, two]]) {
      const { min, max } = minkowskiOf(Manifold, list).boundingBox();
      near(min, [-2, -2, 3]);
      near(max, [42, 12, 17]);
    }
  });

  it('un anello (concavo, con l\'origine nel foro)', () => {
    const { CrossSection, Manifold } = wasm;
    const cube = Manifold.cube([10, 10, 10], false);
    const ring = Manifold.revolve(CrossSection.circle(2, 16).translate([8, 0]), 32);
    const { min, max } = minkowskiOf(Manifold, [cube, ring]).boundingBox();
    near(min, [-10, -10, -2]);
    near(max, [20, 20, 12]);
  });
});

describe('minkowskiOf: ottimizzazioni (componenti connesse e toppe convesse)', () => {
  /** Differenza simmetrica tra due solidi, in mm³. */
  const diff = (a: Manifold, b: Manifold) => a.subtract(b).volume() + b.subtract(a).volume();
  /** Riferimento: il calcolo di manifold, valido con la sfera centrata nell'origine. */
  const reference = (a: Manifold, ball: Manifold) => a.minkowskiSum(ball);

  it.each([
    ['forma a L', () => wasm.Manifold.union([wasm.Manifold.cube([30, 10, 10], false), wasm.Manifold.cube([10, 30, 10], false)])],
    ['scatola con guscio', () => wasm.Manifold.cube([40, 40, 30], true).subtract(wasm.Manifold.cube([36, 36, 40], true).translate([0, 0, 7]))],
    ['cilindro con guscio', () => wasm.Manifold.cylinder(30, 20, 20, 32).subtract(wasm.Manifold.cylinder(40, 18, 18, 32).translate([0, 0, 2]))],
  ])('%s con una sfera coincide con manifold', (_name, make) => {
    const solid = make();
    const ball = wasm.Manifold.sphere(2, 24);
    const result = minkowskiOf(wasm.Manifold, [solid, ball]);
    const expected = reference(solid, ball);
    expect(Math.abs(result.volume() - expected.volume())).toBeLessThan(expected.volume() * 1e-4);
    expect(diff(result, expected)).toBeLessThan(expected.volume() * 1e-3);
  });

  it('tre solidi separati (come BabyToy) si sommano a coppie, in fretta e con lo stesso risultato', () => {
    const { Manifold } = wasm;
    const solid = Manifold.union([
      Manifold.cube([16, 16, 16], true).translate([15, 15, 12]),
      Manifold.cylinder(20, 8, 8, 3).translate([45, 15, 4]),
      Manifold.cylinder(20, 8, 8, 40).translate([75, 15, 4]),
    ]);
    const ball = Manifold.sphere(2, 16);
    const started = performance.now();
    const result = minkowskiOf(Manifold, [solid, ball]);
    const ms = performance.now() - started;
    const expected = reference(solid, ball);
    expect(diff(result, expected)).toBeLessThan(expected.volume() * 1e-3);
    // Con il solo calcolo di manifold servirebbero molti secondi
    expect(ms).toBeLessThan(5000);
  }, 60000);

  it('operandi vuoti danno un solido vuoto, senza errori', () => {
    const { Manifold } = wasm;
    expect(minkowskiOf(Manifold, [Manifold.union([]), Manifold.sphere(2, 16)]).isEmpty()).toBe(true);
    expect(minkowskiOf(Manifold, [Manifold.cube([5, 5, 5], false), Manifold.union([])]).isEmpty()).toBe(true);
  });
});

describe('toppe convesse: controllo geometrico di contenimento', () => {
  const diff = (a: Manifold, b: Manifold) => a.subtract(b).volume() + b.subtract(a).volume();

  it('corpo della tazza (cono con manico forato) con una sfera: come manifold, in pochi secondi', () => {
    const { Manifold, CrossSection } = wasm;
    // Manico: profilo rettangolare arrotondato con un foro, estruso 6 mm e appoggiato al cono
    const rounded = (x: number, y: number, r: number) => CrossSection.square([x - 2 * r, y - 2 * r], true).offset(r, 'Round', 2, 64);
    const handle = Manifold.extrude(rounded(45, 40, 18).subtract(rounded(40, 35, 12)), 6).rotate([0, 90, 0]).translate([-3, -22.5, 22.5]);
    const body = Manifold.union([Manifold.cylinder(45, 18, 28, 96), handle]);
    const ball = Manifold.sphere(2, 32);
    const started = performance.now();
    const result = minkowskiOf(Manifold, [body, ball]);
    const ms = performance.now() - started;
    const expected = body.minkowskiSum(ball);
    expect(Math.abs(result.volume() - expected.volume())).toBeLessThan(expected.volume() * 1e-4);
    expect(diff(result, expected)).toBeLessThan(expected.volume() * 1e-4);
    expect(ms).toBeLessThan(6000);
  }, 60000);

  it('un ponte sottile tra due blocchi non viene inglobato dalle toppe: il risultato resta quello di manifold', () => {
    const { Manifold } = wasm;
    // Due blocchi uniti da una barra sottile: l'inviluppo delle facce esterne dei blocchi passerebbe sopra la barra
    const solid = Manifold.union([
      Manifold.cube([10, 10, 10], false),
      Manifold.cube([10, 10, 10], false).translate([20, 0, 0]),
      Manifold.cube([12, 2, 2], false).translate([9, 4, 4]),
    ]);
    const ball = Manifold.sphere(1.5, 16);
    const result = minkowskiOf(Manifold, [solid, ball]);
    const expected = solid.minkowskiSum(ball);
    expect(diff(result, expected)).toBeLessThan(expected.volume() * 1e-3);
  });
});

describe('pennellata a tolleranza', () => {
  it('segmentsForTolerance: corda entro 0,01 mm', () => {
    expect(segmentsForTolerance(2, 0.01)).toBe(32);
    expect(segmentsForTolerance(4, 0.01)).toBe(45);
    expect(segmentsForTolerance(10, 0.01)).toBe(71);
    // Raggio sotto la tolleranza: il minimo
    expect(segmentsForTolerance(0.005, 0.01)).toBe(3);
  });

  it('brushSegments riduce solo quando serve e rispetta i minimi', () => {
    expect(brushSegments(prim('s', 'sphere', { radius: 2, segments: 140 } as Partial<PrimitiveNode>))).toBe(32);
    expect(brushSegments(prim('s', 'sphere', { radius: 2, segments: 24 } as Partial<PrimitiveNode>))).toBeNull();
    expect(brushSegments(prim('s', 'sphere', { radius: 0.1, segments: 64 } as Partial<PrimitiveNode>))).toBe(8);
    expect(brushSegments(prim('c', 'cylinder', { radius: 2, segments: 140 } as Partial<PrimitiveNode>))).toBe(32);
    expect(brushSegments(prim('b', 'box', { segments: 1 } as Partial<PrimitiveNode>))).toBeNull();
  });

  it('nel kernel una sfera a 140 lati come pennellata dà lo stesso volume di una a 32, con meno triangoli', () => {
    const fine = new Evaluator(wasm).evaluate(sceneOf({}, { segments: 140 })).meshes[0];
    const coarse = new Evaluator(wasm).evaluate(sceneOf({}, { segments: 32 })).meshes[0];
    expect(Math.abs(fine.volume - coarse.volume)).toBeLessThan(coarse.volume * 5e-4);
    expect(fine.indices.length).toBe(coarse.indices.length);
    // Come primo operando la sfera resta com'è: un Minkowski di sola sfera e cubo piccolo ha molti più triangoli
    const asBase: Scene = { nodes: { ball: prim('ball', 'sphere', { radius: 2, segments: 140 } as Partial<PrimitiveNode>), cube: prim('cube', 'box', { size: [1, 1, 1] } as Partial<PrimitiveNode>), m: minkowski('m', ['ball', 'cube']) }, rootIds: ['m'] };
    expect(new Evaluator(wasm).evaluate(asBase).meshes[0].indices.length).toBeGreaterThan(coarse.indices.length * 4);
  });
});
