// Benchmark del kernel: non gira con `npm test`, si attiva con `BENCH=1 npx vitest run src/kernel/bench.test.ts`.
// Stampa i tempi mediani (ms) di scenari ripetibili, per verificare se un'ottimizzazione porta un guadagno vero.
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { Evaluator } from './evaluate';
import { faceMap } from '../scene/edgeTool';
import { writeStl } from './export/stl';
import { write3mf } from './export/threemf';
import { primitiveDefaults } from '../scene/defaults';
import type { GroupNode, PrimitiveNode, Scene } from '../scene/types';
import { reliefAddition, reliefCutter } from './relief';
import type { ReliefEngine } from './relief';
import { reliefScad } from '../codegen/reliefScad';
import { reliefDefaults } from '../scene/relief';
import type { ReliefKind } from '../scene/relief';
import sharp from 'sharp';
import { Window } from 'happy-dom';
import type { Manifold } from 'manifold-3d';
import { applyTextureFace, displaceSolid, svgReliefSolid } from './textureMap';
import { meshScad, svgReliefScad, textureFaceScad } from '../codegen/textureScad';
import { rgbaToGray, textureDefaults } from '../scene/textureMap';
import { SAMPLE_SVG, makeSample } from '../scene/textureSamples';
import type { SampleKind } from '../scene/textureSamples';
import { svgContours } from '../scene/shapes2d';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

const prim = (id: string, kind: Parameters<typeof primitiveDefaults>[0], patch: Partial<PrimitiveNode> = {}): PrimitiveNode =>
  ({ ...primitiveDefaults(kind), id, name: id, position: [0, 0, 0], ...patch }) as PrimitiveNode;

const group = (id: string, children: string[], op: GroupNode['op'] = 'union', patch: Partial<GroupNode> = {}): GroupNode => ({
  id, name: id, type: 'group', op, children, position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: '#fff', ...patch,
});

/** Mediana di `runs` esecuzioni (con `warmup` giri scartati). */
function median(fn: () => void, runs = 15, warmup = 3): number {
  for (let i = 0; i < warmup; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
}

// I tempi vanno anche su file (BENCH_OUT): Vitest non mostra sempre la console dei test riusciti
const report = (label: string, ms: number) => {
  const line = `BENCH ${label.padEnd(62)} ${ms.toFixed(2).padStart(9)} ms`;
  console.log(line);
  if (process.env.BENCH_OUT) appendFileSync(process.env.BENCH_OUT, `${line}
`);
};

/** Scena ad albero: `leaves` primitive raggruppate a cinque a cinque in gruppi annidati (unione e differenza alternate). */
function nestedScene(leaves: number): Scene {
  const nodes: Record<string, PrimitiveNode | GroupNode> = {};
  let level: string[] = [];
  for (let i = 0; i < leaves; i++) {
    const id = `p${i}`;
    nodes[id] = prim(id, i % 3 === 0 ? 'cylinder' : 'box', { position: [(i % 10) * 12, Math.floor(i / 10) * 12, 0], segments: 24 } as Partial<PrimitiveNode>);
    level.push(id);
  }
  let depth = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 5) {
      const id = `g${depth}_${i}`;
      nodes[id] = group(id, level.slice(i, i + 5), depth % 2 ? 'difference' : 'union');
      next.push(id);
    }
    level = next;
    depth++;
  }
  return { nodes, rootIds: level };
}

describe.skipIf(!process.env.BENCH)('benchmark kernel', { timeout: 300_000 }, () => {
  it('cache calda su una scena ad albero (punti 1 e 2)', () => {
    for (const leaves of [25, 125, 400]) {
      const scene = nestedScene(leaves);
      const ev = new Evaluator(wasm);
      const cold = performance.now();
      ev.evaluate(scene);
      report(`albero ${leaves} foglie: prima valutazione (cache fredda)`, performance.now() - cold);
      report(`albero ${leaves} foglie: rivalutazione a cache calda`, median(() => ev.evaluate(scene)));
      // Trascinamento di uno slider: cambia una foglia a ogni giro, il resto è in cache
      let step = 0;
      report(
        `albero ${leaves} foglie: modifica di una foglia`,
        median(() => {
          step++;
          const edited = { ...scene, nodes: { ...scene.nodes, p0: { ...scene.nodes.p0, position: [step * 0.1, 0, 0] } } } as Scene;
          ev.evaluate(edited);
        }),
      );
      ev.dispose();
    }
  });

  it('estrazione delle mesh da un solido grande (punti 2 e 3)', () => {
    for (const segments of [64, 192, 384]) {
      const scene: Scene = { nodes: { s: prim('s', 'sphere', { radius: 20, segments } as Partial<PrimitiveNode>) }, rootIds: ['s'] };
      const ev = new Evaluator(wasm);
      const [m] = ev.evaluate(scene).meshes;
      report(`sfera ${segments} segmenti (${m.indices.length / 3} triangoli): rivalutazione`, median(() => ev.evaluate(scene)));
      ev.dispose();
    }
  });

  it('faceMap su mesh grandi (punto 6)', () => {
    for (const segments of [64, 192, 384]) {
      const scene: Scene = { nodes: { s: prim('s', 'sphere', { radius: 20, segments } as Partial<PrimitiveNode>) }, rootIds: ['s'] };
      const ev = new Evaluator(wasm);
      const [m] = ev.evaluate(scene).meshes;
      // faceMap tiene una cache per oggetto mesh: si copia la mesh a ogni giro per misurare il calcolo vero
      report(`faceMap sfera ${segments} segmenti (${m.indices.length / 3} triangoli)`, median(() => faceMap({ ...m }), 9, 2));
      ev.dispose();
    }
  });

  it('copia della scena verso il worker (punto 1 e 4)', () => {
    for (const leaves of [25, 125, 400]) {
      const scene = nestedScene(leaves);
      report(`structuredClone scena ${leaves} foglie`, median(() => structuredClone(scene), 30));
    }
  });

  it('Minkowski di un solido concavo con una sfera (punto 5)', () => {
    // Cilindro cavo (differenza) arrotondato da una sfera: forza la scomposizione in toppe convesse
    for (const seg of [24, 48]) {
      const scene: Scene = {
        nodes: {
          base: prim('base', 'box', { size: [30, 30, 10], position: [0, 0, 5] } as Partial<PrimitiveNode>),
          cut: prim('cut', 'cylinder', { radius: 8, height: 12, segments: seg, position: [0, 0, 6] } as Partial<PrimitiveNode>),
          d: group('d', ['base', 'cut'], 'difference'),
          ball: prim('ball', 'sphere', { radius: 1.5, segments: 32 } as Partial<PrimitiveNode>),
          m: group('m', ['d', 'ball'], 'minkowski'),
        },
        rootIds: ['m'],
      };
      const ev = new Evaluator(wasm);
      report(`minkowski piastra con foro (${seg} lati), cache fredda`, median(() => {
        ev.dispose();
        ev.evaluate(scene);
      }, 7, 2));
      ev.dispose();
    }
  });

  it('forme curve ad alta risoluzione: costo di una modifica (punto 4)', () => {
    for (const segments of [64, 128, 256]) {
      const nodes = {
        s: prim('s', 'sphere', { radius: 20, segments } as Partial<PrimitiveNode>),
        c: prim('c', 'cylinder', { radius: 12, height: 60, segments, mode: 'hole' } as Partial<PrimitiveNode>),
        g: group('g', ['s', 'c'], 'difference'),
      };
      const ev = new Evaluator(wasm);
      let step = 0;
      report(
        `sfera − cilindro, ${segments} segmenti: modifica`,
        median(() => {
          step++;
          ev.evaluate({ nodes: { ...nodes, c: { ...nodes.c, position: [step * 0.05, 0, 0] } } as Scene['nodes'], rootIds: ['g'] });
        }, 9, 2),
      );
      ev.dispose();
    }
  });

  it('dettaglio di toMesh e degli export su un solido grande (punti 2, 3 e 7)', () => {
    const scene: Scene = { nodes: { s: prim('s', 'sphere', { radius: 20, segments: 384 } as Partial<PrimitiveNode>) }, rootIds: ['s'] };
    const ev = new Evaluator(wasm);
    const [m] = ev.evaluate(scene).meshes;
    const solid = wasm.Manifold.sphere(20, 384);
    solid.numTri();
    report('getMesh() (73728 triangoli)', median(() => solid.getMesh()));
    const mesh = solid.getMesh();
    report('slice() dei due buffer', median(() => { mesh.vertProperties.slice(); mesh.triVerts.slice(); }));
    report('volume()', median(() => solid.volume()));
    report('boundingBox()', median(() => solid.boundingBox()));
    report('status()', median(() => solid.status()));
    report('writeStl (73728 triangoli)', median(() => writeStl(m.positions, m.indices), 9, 2));
    report('write3mf (73728 triangoli, un oggetto)', median(() => write3mf([{ name: 's', color: '#fff', positions: m.positions, indices: m.indices, plate: 0 }], ['Piatto 1']), 9, 2));
    solid.delete();
    ev.dispose();
  });
});

// Studio delle texture in rilievo (docs/studio-pattern-rilievo.md): una faccia 80 x 60 mm su un pannello di 5 mm.
// Per ogni texture e motore: tempo del solido da togliere (o unire) più la booleana sul pannello e l'estrazione della mesh,
// triangoli del pezzo risultante, dimensione stimata dell'STL (84 + 50 byte per triangolo) e lunghezza del codice OpenSCAD.
describe.skipIf(!process.env.BENCH)('benchmark texture in rilievo', { timeout: 600_000 }, () => {
  const steps = [0.8, 0.5, 0.3];
  // `size`: lati della faccia in mm (predefinita 80 x 60); in coda quattro prove su una faccia grande 160 x 120
  const cases: { kind: ReliefKind; engine: ReliefEngine; step?: number; size?: [number, number]; patch?: Record<string, number> }[] = [
    { kind: 'brick', engine: 'csg' },
    ...steps.map((step) => ({ kind: 'brick' as const, engine: 'heightmap' as const, step })),
    { kind: 'wood', engine: 'csg' },
    ...steps.map((step) => ({ kind: 'wood' as const, engine: 'hybrid' as const, step })),
    ...steps.map((step) => ({ kind: 'wood' as const, engine: 'heightmap' as const, step })),
    { kind: 'rust', engine: 'csg' },
    ...steps.map((step) => ({ kind: 'rust' as const, engine: 'heightmap' as const, step })),
    { kind: 'studs', engine: 'csg' },
    ...steps.map((step) => ({ kind: 'studs' as const, engine: 'heightmap' as const, step })),
    { kind: 'hammered', engine: 'csg' },
    ...steps.map((step) => ({ kind: 'hammered' as const, engine: 'heightmap' as const, step })),
    { kind: 'hammered', engine: 'csg', size: [160, 120] },
    { kind: 'hammered', engine: 'heightmap', step: 0.5, size: [160, 120] },
    { kind: 'rust', engine: 'heightmap', step: 0.5, size: [160, 120] },
    { kind: 'wood', engine: 'hybrid', step: 0.5, size: [160, 120] },
    // Il caso peggiore del rame in CSG: diametro minimo (2 mm), cioè il tetto di 500 martellate, su 80 x 60 mm
    { kind: 'hammered', engine: 'csg', patch: { size: 2 } },
  ];

  it.each(cases)('$kind, motore $engine, passo $step, faccia $size', ({ kind, engine, step, size = [80, 60], patch }) => {
    const rect = { minX: -size[0] / 2, minY: -size[1] / 2, maxX: size[0] / 2, maxY: size[1] / 2 };
    const region = wasm.CrossSection.square(size, true);
    const params = { ...reliefDefaults(kind), ...patch } as ReturnType<typeof reliefDefaults>;
    const additive = kind === 'studs';
    const cube = wasm.Manifold.cube([size[0], size[1], 5], true);
    const panel = cube.translate([0, 0, -2.5]);
    cube.delete();
    let triangles = 0;
    const run = () => {
      const tool = additive ? reliefAddition(wasm, region, params, { engine, step }) : reliefCutter(wasm, region, params, { engine, step });
      const result = additive ? panel.add(tool!) : panel.subtract(tool!);
      // Come nel kernel vero: la mesh va estratta per mostrarla
      triangles = result.getMesh().triVerts.length / 3;
      tool!.delete();
      result.delete();
    };
    const ms = median(run, 7, 2);
    const scad = reliefScad(rect, params, engine, step ?? 0.5).length;
    const label = `rilievo ${kind} ${engine}${step ? ` ${step} mm` : ''}${size[0] > 80 ? ` ${size[0]}x${size[1]}` : ''}${patch ? ' 500 martellate' : ''}`;
    const line = `BENCH ${label.padEnd(36)} ${ms.toFixed(1).padStart(8)} ms  ${String(triangles).padStart(7)} tri  STL ${((84 + 50 * triangles) / 1024).toFixed(0).padStart(6)} KB  OpenSCAD ${(scad / 1024).toFixed(1).padStart(8)} KB`;
    console.log(line);
    if (process.env.BENCH_OUT) appendFileSync(process.env.BENCH_OUT, `${line}\n`);
    panel.delete();
    region.delete();
  });
});

// Studio delle texture da immagine (docs/studio-texture-immagine.md): stessa faccia 80 x 60 mm su pannello di 5 mm, stesse colonne
// della tabella dei rilievi procedurali. Motore F: solo la faccia; motore M: l'intero pannello (tutte le facce, raffinate
// alla stessa lunghezza), quindi i suoi triangoli non sono confrontabili 1 a 1 con quelli del motore F.
describe.skipIf(!process.env.BENCH)('benchmark texture in rilievo da immagine', { timeout: 600_000 }, () => {
  const steps = [0.8, 0.5, 0.3];
  const tex = { ...textureDefaults(), tile: 20, amplitude: 0.6 };
  const rect = { minX: -40, minY: -30, maxX: 40, maxY: 30 };
  const out = (label: string, ms: number, triangles: number, scadChars: number, extra = '') => {
    const line = `BENCH ${label.padEnd(36)} ${ms.toFixed(1).padStart(8)} ms  ${String(triangles).padStart(7)} tri  STL ${((84 + 50 * triangles) / 1024).toFixed(0).padStart(6)} KB  OpenSCAD ${(scadChars / 1024).toFixed(1).padStart(8)} KB${extra}`;
    console.log(line);
    if (process.env.BENCH_OUT) appendFileSync(process.env.BENCH_OUT, `${line}\n`);
  };
  const panelOf = () => {
    const cube = wasm.Manifold.cube([80, 60, 5], true);
    const moved = cube.translate([0, 0, -2.5]);
    cube.delete();
    return moved;
  };

  // Motore F: texture organica (pelle), regolare (zigrinatura) e rumore, nei tre modi e nei tre passi
  const faceCases: { kind: SampleKind; mode: 'relief' | 'groove' | 'both'; step: number; size?: number }[] = [
    ...steps.map((step) => ({ kind: 'leather' as const, mode: 'relief' as const, step })),
    ...steps.map((step) => ({ kind: 'knurl' as const, mode: 'relief' as const, step })),
    { kind: 'leather', mode: 'groove', step: 0.5 },
    { kind: 'leather', mode: 'both', step: 0.5 },
    { kind: 'noise', mode: 'relief', step: 0.5, size: 256 },
  ];
  it.each(faceCases)('F $kind $mode passo $step', ({ kind, mode, step, size = 256 }) => {
    const img = makeSample(kind, size);
    const region = wasm.CrossSection.square([80, 60], true);
    const panel = panelOf();
    let triangles = 0;
    const run = () => {
      const result = applyTextureFace(wasm, panel, region, img, { ...tex, mode }, { step });
      triangles = result.getMesh().triVerts.length / 3;
      result.delete();
    };
    const ms = median(run, 7, 2);
    out(`immagine ${kind} F ${mode} ${step} mm`, ms, triangles, textureFaceScad(rect, img, { ...tex, mode }, step).length);
    panel.delete();
    region.delete();
  });

  // Motore M: pannello, cubo e cilindro interi, normali medie con spigoli fermi, ampiezza 0,6 mm
  const meshCases: { solid: 'pannello' | 'cubo' | 'cilindro'; edge: number }[] = [
    ...steps.map((edge) => ({ solid: 'pannello' as const, edge })),
    { solid: 'cubo', edge: 0.8 },
    { solid: 'cubo', edge: 0.5 },
    { solid: 'cilindro', edge: 0.8 },
    { solid: 'cilindro', edge: 0.5 },
  ];
  it.each(meshCases)('M $solid lato $edge', ({ solid, edge }) => {
    const img = makeSample('leather', 256);
    const make = () =>
      solid === 'pannello' ? wasm.Manifold.cube([80, 60, 5], true) : solid === 'cubo' ? wasm.Manifold.cube([30, 30, 30], true) : wasm.Manifold.cylinder(40, 15, 15, 96, true);
    const base = make();
    const projection = solid === 'cilindro' ? ({ kind: 'cylindrical', axis: 2, radius: 15 } as const) : ({ kind: 'triplanar' } as const);
    let triangles = 0;
    let refineMs = 0;
    let status = '';
    let flipped = 0;
    let mesh: ReturnType<Manifold['getMesh']> | null = null;
    const run = () => {
      const { solid: result, stats } = displaceSolid(wasm, base, img, { ...tex, mode: 'both' }, projection, { edge, fadeSharp: true });
      mesh = result!.getMesh();
      triangles = mesh.triVerts.length / 3;
      refineMs = stats.msRefine;
      status = stats.status;
      flipped = stats.flipped;
      result!.delete();
    };
    const ms = median(run, 7, 2);
    out(`immagine leather M ${solid} ${edge} mm`, ms, triangles, meshScad(mesh!.vertProperties, mesh!.triVerts).length, `  (raffinamento ${refineMs.toFixed(0)} ms, ${status}, ${flipped} rovesciati)`);
    base.delete();
  });

  // SVG: strada vettoriale (celle estruse) contro rasterizzazione a 256 e 512 pixel come immagine; stemma 16 x 16 mm, passo 20 mm, rilievo 0,6 mm
  it('SVG vettoriale e raster', async () => {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = new Window().DOMParser;
    const { parseSvg } = await import('../import/svg');
    const contours = svgContours({ contours: parseSvg(SAMPLE_SVG, 'stemma').contours, width: 16, depth: 16 });
    const region = wasm.CrossSection.square([80, 60], true);
    const panel = panelOf();
    const opts = { contours, pitch: [20, 20] as [number, number], height: 0.6, repeat: true };
    let triangles = 0;
    const run = () => {
      const tool = svgReliefSolid(wasm, region, opts, rect)!;
      const result = panel.add(tool);
      triangles = result.getMesh().triVerts.length / 3;
      tool.delete();
      result.delete();
    };
    out('SVG vettoriale (celle estruse)', median(run, 7, 2), triangles, svgReliefScad(rect, opts).length);
    // Raster: sharp (librsvg) al posto del canvas del thread principale; il tempo di rasterizzazione e conversione a grigio si misura a parte
    for (const px of [256, 512]) {
      const t0 = performance.now();
      // Lo stemma occupa l'80 % della piastrella (16 mm su 20), il resto è bianco: come il passo del caso vettoriale
      const inner = 2 * Math.round(px * 0.4);
      const margin = (px - inner) / 2;
      const { data } = await sharp(Buffer.from(SAMPLE_SVG), { density: 300 }).resize(inner, inner).flatten({ background: '#ffffff' }).extend({ top: margin, bottom: margin, left: margin, right: margin, background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const gray = rgbaToGray(data, px, px);
      const rasterMs = performance.now() - t0;
      for (const step of steps) {
        const rasterRun = () => {
          const result = applyTextureFace(wasm, panel, region, gray, { ...tex, tile: 20, repeat: true, invert: true, midlevel: 0.5, mode: 'relief' }, { step });
          triangles = result.getMesh().triVerts.length / 3;
          result.delete();
        };
        out(`SVG raster ${px}px F relief ${step} mm`, median(rasterRun, 7, 2), triangles, textureFaceScad(rect, gray, { ...tex, tile: 20, invert: true, mode: 'relief' }, step).length, `  (rasterizzazione ${rasterMs.toFixed(0)} ms)`);
      }
    }
    panel.delete();
    region.delete();
  });
});
