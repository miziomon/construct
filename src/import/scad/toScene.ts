import { randomColor } from '../../scene/color';
import { DEFAULT_SEGMENTS, MAX_SEGMENTS, MIN_SEGMENTS, MIN_SPHERE_SEGMENTS, PRIMITIVE_LABELS, SHAPE2D_LABELS, primitiveDefaults, shape2dDefaults } from '../../scene/defaults';
import { matrixToEuler, round } from '../../scene/math';
import type { Mat3 } from '../../scene/math';
import { newId } from '../../scene/store';
import type { GroupNode, PrimitiveNode, SceneNode, Shape2DNode, Vec3 } from '../../scene/types';
import { evaluateScad } from './evaluate';
import type { GroupOp, Item, Mat, PrimItem } from './evaluate';
import { ScadError } from './parse';

/** Piatto del risultato: nome e radici (id dei nodi creati). */
export interface ImportedPlate {
  name: string;
  rootIds: string[];
}

/** Ciò che si ricava da un file .scad, pronto da inserire nel progetto (`importScene` dello store). */
export interface ScadImport {
  nodes: Record<string, SceneNode>;
  /** Almeno un piatto; con un solo piatto non ha nome (finisce nel piatto in uso). */
  plates: ImportedPlate[];
  warnings: string[];
  /** Quanti oggetti (primitive, forme e gruppi) sono stati creati. */
  count: number;
}

const GROUP_NAMES: Record<GroupOp, string> = { union: 'Unione', difference: 'Differenza', intersection: 'Intersezione', hull: 'Inviluppo convesso' };

/** Misure minime accettate: sotto il kernel produrrebbe geometrie degeneri. */
const MIN = 0.01;
const r3 = (v: number) => round(v, 3);

/** Segmenti di un cerchio: `$fn` di OpenSCAD o il predefinito, entro i limiti dell'app. */
const segmentsOf = (fn: number) => Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, fn || DEFAULT_SEGMENTS));
/** Segmenti di una sfera: multipli di 4, almeno 8 (la sfera di manifold è geodetica). */
const sphereSegmentsOf = (fn: number) => Math.min(MAX_SEGMENTS, Math.max(MIN_SPHERE_SEGMENTS, Math.round((fn || DEFAULT_SEGMENTS) / 4) * 4));

/**
 * Scompone la trasformazione di un oggetto in scala per asse (da assorbire nelle misure), rotazione e posizione. Con
 * uno specchio (determinante negativo) la rotazione è ricavata con un ribaltamento su Z, che per le forme simmetriche non
 * cambia la geometria e per il cono si segnala con `mirrored`.
 */
function decompose(M: Mat, localCenter: Vec3): { scale: Vec3; rotation: Vec3; position: Vec3; mirrored: boolean; skewed: boolean } {
  const col = (j: number): Vec3 => [M[j], M[4 + j], M[8 + j]];
  const cols = [col(0), col(1), col(2)];
  const scale = cols.map((c) => Math.hypot(...c)) as Vec3;
  const unit = cols.map((c, i) => (scale[i] > 1e-12 ? c.map((v) => v / scale[i]) : [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0])) as Vec3[];
  // Colonne non perpendicolari: scala non uniforme applicata dopo una rotazione (si approssima)
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const skewed = Math.abs(dot(unit[0], unit[1])) > 1e-6 || Math.abs(dot(unit[0], unit[2])) > 1e-6 || Math.abs(dot(unit[1], unit[2])) > 1e-6;
  // Q ha le colonne unitarie: Q[i][j] = unit[j][i]
  const q: Mat3 = [
    [unit[0][0], unit[1][0], unit[2][0]],
    [unit[0][1], unit[1][1], unit[2][1]],
    [unit[0][2], unit[1][2], unit[2][2]],
  ];
  const det = q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
  const mirrored = det < 0;
  // R = Q · diag(1, 1, ±1): è sempre una rotazione propria
  const rot: Mat3 = mirrored ? [[q[0][0], q[0][1], -q[0][2]], [q[1][0], q[1][1], -q[1][2]], [q[2][0], q[2][1], -q[2][2]]] : q;
  // Posizione del centro: L · centro + traslazione (il centro è nelle misure non scalate)
  const position = [0, 1, 2].map((i) => M[i * 4] * localCenter[0] + M[i * 4 + 1] * localCenter[1] + M[i * 4 + 2] * localCenter[2] + M[i * 4 + 3]) as Vec3;
  return { scale, rotation: matrixToEuler(rot).map(r3) as Vec3, position: position.map(r3) as Vec3, mirrored, skewed };
}

/** Raggi uguali (entro la tolleranza)? Serve a tenere cilindri e sfere tondi dopo la scala. */
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Legge un file OpenSCAD e lo trasforma in oggetti di Construct. Le trasformazioni (translate, rotate, scale, mirror) si
 * compongono e si applicano a ogni forma; le booleane (difference, union, intersection, hull) diventano gruppi.
 * Ciò che non si capisce si salta e finisce nell'elenco degli avvisi. Un errore di sintassi non importa nulla.
 */
export function importScad(source: string): ScadImport {
  let result;
  try {
    result = evaluateScad(source);
  } catch (e) {
    if (e instanceof ScadError) {
      return { nodes: {}, plates: [{ name: '', rootIds: [] }], warnings: [e.line ? `Errore alla riga ${e.line}: ${e.message}` : e.message], count: 0 };
    }
    throw e;
  }

  const nodes: Record<string, SceneNode> = {};
  const warnings = new Set(result.warnings);
  let count = 0;

  const placeholder = (): Pick<PrimitiveNode, 'id' | 'name'> => ({ id: newId(), name: '' });

  /** Crea il nodo di una forma e lo restituisce (con la sua trasformazione assorbita). */
  function primNode(item: PrimItem): SceneNode | null {
    const sh = item.shape;
    const color = item.color ?? randomColor();
    const note = (skewed: boolean) => skewed && warnings.add('Una scala non uniforme dopo una rotazione è stata approssimata.');

    if (sh.s === 'cube') {
      const c: Vec3 = sh.center ? [0, 0, 0] : [sh.size[0] / 2, sh.size[1] / 2, sh.size[2] / 2];
      const d = decompose(item.M, c);
      note(d.skewed);
      const size = sh.size.map((v, i) => r3(Math.max(MIN, Math.abs(v * d.scale[i])))) as Vec3;
      return { ...primitiveDefaults('box'), ...placeholder(), name: PRIMITIVE_LABELS.box, size, position: d.position, rotation: d.rotation, color } as PrimitiveNode;
    }

    if (sh.s === 'sphere') {
      const d = decompose(item.M, [0, 0, 0]);
      note(d.skewed);
      const rx = r3(Math.max(MIN, Math.abs(sh.r * d.scale[0])));
      const ry = r3(Math.max(MIN, Math.abs(sh.r * d.scale[1])));
      const rz = r3(Math.max(MIN, Math.abs(sh.r * d.scale[2])));
      return {
        ...primitiveDefaults('sphere'), ...placeholder(), name: PRIMITIVE_LABELS.sphere, radius: rx, ...(same(ry, rx) ? {} : { radiusY: ry }), ...(same(rz, rx) ? {} : { radiusZ: rz }),
        segments: sphereSegmentsOf(sh.fn), position: d.position, rotation: d.rotation, color,
      } as PrimitiveNode;
    }

    if (sh.s === 'cylinder') {
      const d = decompose(item.M, [0, 0, sh.center ? 0 : sh.h / 2]);
      note(d.skewed);
      const height = r3(Math.max(MIN, Math.abs(sh.h * d.scale[2])));
      const rx = (r: number) => r3(Math.max(0, Math.abs(r * d.scale[0])));
      const ry = (r: number) => r3(Math.max(MIN, Math.abs(r * d.scale[1])));
      const segments = segmentsOf(sh.fn);
      if (same(sh.r1, sh.r2)) {
        const radius = Math.max(MIN, rx(sh.r1));
        return {
          ...primitiveDefaults('cylinder'), ...placeholder(), name: PRIMITIVE_LABELS.cylinder, radius, ...(same(ry(sh.r1), radius) ? {} : { radiusY: ry(sh.r1) }), height, segments,
          position: d.position, rotation: d.rotation, color,
        } as PrimitiveNode;
      }
      // Raggi diversi: è un cono. Il raggio Y è quello dell'estremità più larga
      const wide = Math.max(sh.r1, sh.r2);
      const base = Math.max(rx(sh.r1), rx(sh.r2));
      return {
        ...primitiveDefaults('cone'), ...placeholder(), name: PRIMITIVE_LABELS.cone, radiusBottom: rx(sh.r1), radiusTop: rx(sh.r2), ...(same(ry(wide), base) ? {} : { radiusY: ry(wide) }), height, segments,
        position: d.position, rotation: d.rotation, color, ...(d.mirrored ? { mirror: [false, false, true] as [boolean, boolean, boolean] } : {}),
      } as PrimitiveNode;
    }

    // Forme 2D estruse (linear_extrude)
    const ext = sh.ext;
    const heightOf = (scale: number) => r3(Math.max(MIN, Math.abs(ext.h * scale)));
    const twist = ext.twist ? { twist: r3(ext.twist) } : {};
    const scaleTop = ext.scale !== 1 ? { scaleTop: r3(ext.scale) } : {};
    if (ext.twist || ext.scale !== 1) warnings.add('La torsione e la scala della cima di linear_extrude sono importate come parametri della forma.');
    const base = { ...placeholder(), color } as const;
    if (sh.s === 'circle') {
      const d = decompose(item.M, [0, 0, ext.center ? 0 : ext.h / 2]);
      note(d.skewed);
      const radius = r3(Math.max(MIN, Math.abs(sh.r * d.scale[0])));
      const radiusY = r3(Math.max(MIN, Math.abs(sh.r * d.scale[1])));
      return {
        ...shape2dDefaults('circle'), ...base, name: SHAPE2D_LABELS.circle, radius, ...(same(radius, radiusY) ? {} : { radiusY }), segments: segmentsOf(sh.fn), height: heightOf(d.scale[2]), ...twist, ...scaleTop,
        position: d.position, rotation: d.rotation,
      } as Shape2DNode;
    }
    if (sh.s === 'square') {
      const d = decompose(item.M, sh.center ? [0, 0, ext.center ? 0 : ext.h / 2] : [sh.size[0] / 2, sh.size[1] / 2, ext.center ? 0 : ext.h / 2]);
      note(d.skewed);
      return {
        ...shape2dDefaults('square'), ...base, name: SHAPE2D_LABELS.square, width: r3(Math.max(MIN, Math.abs(sh.size[0] * d.scale[0]))), depth: r3(Math.max(MIN, Math.abs(sh.size[1] * d.scale[1]))),
        cornerRadius: 0, height: heightOf(d.scale[2]), ...twist, ...scaleTop, position: d.position, rotation: d.rotation,
      } as Shape2DNode;
    }
    // Poligono: diventa un disegno (contorno centrato nell'origine, come un SVG importato)
    const xs = sh.points.map((p) => p[0]);
    const ys = sh.points.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const width = r3(Math.max(MIN, Math.max(...xs) - Math.min(...xs)));
    const depth = r3(Math.max(MIN, Math.max(...ys) - Math.min(...ys)));
    const d = decompose(item.M, [cx, cy, ext.center ? 0 : ext.h / 2]);
    note(d.skewed);
    return {
      ...shape2dDefaults('svg'), ...base, name: 'Poligono', kind: 'svg', fileName: 'OpenSCAD', contours: [sh.points.map(([x, y]) => [r3(x - cx), r3(y - cy)] as [number, number])],
      width: r3(width * d.scale[0]), depth: r3(depth * d.scale[1]), height: heightOf(d.scale[2]), ...twist, ...scaleTop, position: d.position, rotation: d.rotation,
    } as Shape2DNode;
  }

  /** Converte un oggetto (e i suoi figli) in nodi; restituisce l'id del nodo creato. */
  function convert(item: Item): string | null {
    if (item.kind === 'prim') {
      const node = primNode(item);
      if (!node) return null;
      nodes[node.id] = node;
      count++;
      return node.id;
    }
    const childIds = item.children.map(convert).filter((id): id is string => id !== null);
    if (!childIds.length) return null;
    // Un gruppo con un solo figlio è il figlio (una differenza senza sottrazioni, un'unione di un oggetto)
    if (childIds.length === 1 && item.op !== 'hull') return childIds[0];
    const id = newId();
    const group: GroupNode = {
      id, type: 'group', name: GROUP_NAMES[item.op], op: item.op, children: childIds,
      position: [0, 0, 0], rotation: [0, 0, 0], mode: 'solid', color: nodes[childIds[0]].color,
    };
    nodes[id] = group;
    count++;
    return id;
  }

  const rootsOf = (items: Item[]) => items.map(convert).filter((id): id is string => id !== null);

  const rest = rootsOf(result.items);
  let plates: ImportedPlate[];
  if (result.plates.length) {
    plates = result.plates.map((p) => ({ name: p.name, rootIds: rootsOf(p.items) }));
    // Gli oggetti fuori dai moduli dei piatti restano nel primo
    plates[0].rootIds.push(...rest);
  } else {
    plates = [{ name: '', rootIds: rest }];
  }
  return { nodes, plates, warnings: [...warnings], count };
}
