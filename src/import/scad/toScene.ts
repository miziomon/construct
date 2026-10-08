import { randomColor } from '../../scene/color';
import { FONTS } from '../../scene/fontCatalog';
import { DEFAULT_SEGMENTS, MAX_SEGMENTS, MIN_SEGMENTS, MIN_SPHERE_SEGMENTS, PRIMITIVE_LABELS, SHAPE2D_LABELS, primitiveDefaults, shape2dDefaults } from '../../scene/defaults';
import { matrixToEuler, round } from '../../scene/math';
import type { Mat3 } from '../../scene/math';
import { newId } from '../../scene/store';
import type { GroupNode, PrimitiveNode, SceneNode, Shape2DNode, Vec3 } from '../../scene/types';
import { evaluateScad, transformItems } from './evaluate';
import type { GroupOp, Item, Mat, PrimItem, ScadIssue } from './evaluate';
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
  /** Problemi con la riga del codice e il livello (errore = parte saltata, nota = approssimazione). */
  issues: ScadIssue[];
  /** Quanti oggetti (primitive, forme e gruppi) sono stati creati. */
  count: number;
}

const GROUP_NAMES: Record<GroupOp, string> = { union: 'Unione', difference: 'Differenza', intersection: 'Intersezione', hull: 'Inviluppo convesso', minkowski: 'Minkowski' };

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

/** Contorni di un poligono (i `paths` di OpenSCAD, oppure tutti i punti in ordine) centrati su `c`. */
function contoursOf(paths: number[][] | undefined, points: [number, number][], c: [number, number]): [number, number][][] {
  const lists = paths ?? [points.map((_, i) => i)];
  return lists.map((path) => path.map((i) => [r3(points[i][0] - c[0]), r3(points[i][1] - c[1])] as [number, number]));
}

/** Font del catalogo che corrisponde al nome di OpenSCAD (`Famiglia:style=Stile`); senza corrispondenza, quello predefinito. */
function fontIdOf(name: string): string {
  const [family, style] = name.split(':style=').map((part) => part.trim().toLowerCase());
  const candidates = FONTS.filter((f) => f.family.toLowerCase() === family);
  return (candidates.find((f) => f.style.toLowerCase() === style) ?? candidates[0] ?? FONTS[0]).id;
}

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
      return { nodes: {}, plates: [{ name: '', rootIds: [] }], warnings: [e.line ? `Errore alla riga ${e.line}: ${e.message}` : e.message], issues: [{ message: e.message, line: e.line || null, level: 'error' }], count: 0 };
    }
    throw e;
  }

  const nodes: Record<string, SceneNode> = {};
  const issues: ScadIssue[] = [...result.issues];
  /** Riga della forma che si sta convertendo: le note che nascono qui si riferiscono ad essa. */
  let currentLine: number | null = null;
  const addNote = (message: string) => {
    if (!issues.some((i) => i.message === message && i.line === currentLine)) issues.push({ message, line: currentLine, level: 'note' });
  };
  let count = 0;

  const placeholder = (): Pick<PrimitiveNode, 'id' | 'name'> => ({ id: newId(), name: '' });

  /** Crea il nodo di una forma e lo restituisce (con la sua trasformazione assorbita). */
  function primNode(item: PrimItem): SceneNode | null {
    const sh = item.shape;
    currentLine = item.line ?? null;
    const color = item.color ?? randomColor();
    const note = (skewed: boolean) => skewed && addNote('Una scala non uniforme dopo una rotazione è stata approssimata.');

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

    // Forme 2D: estruse in linea retta (linear_extrude) oppure fatte girare attorno all'asse Z (rotate_extrude)
    const ext = sh.ext;
    const linear = !sh.rev;
    const heightOf = (scale: number) => r3(Math.max(MIN, Math.abs(ext.h * scale)));
    // OpenSCAD torce in senso orario e manifold in senso antiorario: il segno si inverte (come fa il codice esportato)
    const twist = linear && ext.twist ? { twist: r3(-ext.twist) } : {};
    const scaleTop = linear && ext.scale !== 1 ? { scaleTop: r3(ext.scale) } : {};
    if (linear && (ext.twist || ext.scale !== 1)) addNote('La torsione e la scala della cima di linear_extrude sono importate come parametri della forma.');
    /** Contorno (offset 2D) del profilo, nelle misure del profilo: segue la scala dell'oggetto. */
    const offsetOf = (k: number) => (sh.off ? { offset: r3(sh.off.v * k), ...(sh.off.join === 'sharp' ? { offsetJoin: 'sharp' as const } : {}) } : {});
    const base = { ...placeholder(), color } as const;

    if (sh.rev && sh.s !== 'text') {
      // Profilo di rotate_extrude: la X del profilo è il raggio, la Y diventa l'altezza (Z) del solido
      const P = sh.rev.profile;
      const sx = Math.hypot(P[0], P[4]);
      const sy = Math.hypot(P[1], P[5]);
      if (sh.s !== 'polygon' && (Math.abs(P[1]) > 1e-9 || Math.abs(P[4]) > 1e-9)) addNote('Una rotazione del profilo dentro rotate_extrude() è stata ignorata.');
      const at = (x: number, y: number): [number, number] => [P[0] * x + P[1] * y + P[3], P[4] * x + P[5] * y + P[7]];
      let c: [number, number];
      let width: number;
      let depth: number;
      let pts: [number, number][] = [];
      if (sh.s === 'circle') {
        c = at(0, 0);
        [width, depth] = [2 * sh.r * sx, 2 * sh.r * sy];
      } else if (sh.s === 'square') {
        c = sh.center ? at(0, 0) : at(sh.size[0] / 2, sh.size[1] / 2);
        [width, depth] = [sh.size[0] * sx, sh.size[1] * sy];
      } else {
        pts = sh.points.map(([x, y]) => at(x, y));
        const xs = pts.map((q) => q[0]);
        const ys = pts.map((q) => q[1]);
        c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
        [width, depth] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      }
      const d = decompose(item.M, [0, 0, c[1]]);
      note(d.skewed);
      if (!same(d.scale[0], d.scale[1])) addNote('Una scala diversa in X e in Y attorno a rotate_extrude() è stata approssimata.');
      if (c[0] < -1e-9) addNote('rotate_extrude(): una parte del profilo sta oltre l\'asse (X negativa) e si perde.');
      const [kx, kz] = [d.scale[0], d.scale[2]];
      // Segmenti del giro: $fn, oppure la formula di OpenSCAD con $fa e $fs sul raggio massimo del profilo
      const maxRadius = Math.max(0, c[0] + width / 2) * kx;
      const revolveSegments = sh.rev.fn || (sh.rev.auto ? Math.ceil(Math.max(Math.min(360 / sh.rev.auto.fa, (maxRadius * 2 * Math.PI) / sh.rev.auto.fs), 5)) : 0);
      const revolve = {
        extrusion: 'rotate' as const,
        ...(sh.rev.angle < 360 ? { revolveAngle: r3(sh.rev.angle) } : {}),
        revolveRadius: r3(Math.max(0, c[0]) * kx),
        ...(revolveSegments ? { revolveSegments: Math.min(256, Math.max(3, revolveSegments)) } : {}),
        ...offsetOf(kx),
        position: d.position,
        rotation: d.rotation,
      };
      if (sh.s === 'circle') {
        const radius = r3(Math.max(MIN, (width / 2) * kx));
        const radiusY = r3(Math.max(MIN, (depth / 2) * kz));
        return { ...shape2dDefaults('circle'), ...base, name: SHAPE2D_LABELS.circle, radius, ...(same(radius, radiusY) ? {} : { radiusY }), segments: segmentsOf(sh.fn), ...revolve } as Shape2DNode;
      }
      if (sh.s === 'square') {
        return { ...shape2dDefaults('square'), ...base, name: SHAPE2D_LABELS.square, width: r3(Math.max(MIN, width * kx)), depth: r3(Math.max(MIN, depth * kz)), cornerRadius: 0, ...revolve } as Shape2DNode;
      }
      return {
        ...shape2dDefaults('svg'), ...base, name: 'Poligono', kind: 'svg', fileName: 'OpenSCAD', contours: contoursOf(sh.paths, pts, c),
        width: r3(Math.max(MIN, width * kx)), depth: r3(Math.max(MIN, depth * kz)), ...revolve,
      } as Shape2DNode;
    }

    if (sh.s === 'circle') {
      const d = decompose(item.M, [0, 0, ext.center ? 0 : ext.h / 2]);
      note(d.skewed);
      const radius = r3(Math.max(MIN, Math.abs(sh.r * d.scale[0])));
      const radiusY = r3(Math.max(MIN, Math.abs(sh.r * d.scale[1])));
      return {
        ...shape2dDefaults('circle'), ...base, name: SHAPE2D_LABELS.circle, radius, ...(same(radius, radiusY) ? {} : { radiusY }), segments: segmentsOf(sh.fn), height: heightOf(d.scale[2]), ...twist, ...scaleTop,
        ...offsetOf(d.scale[0]), position: d.position, rotation: d.rotation,
      } as Shape2DNode;
    }
    if (sh.s === 'square') {
      const d = decompose(item.M, sh.center ? [0, 0, ext.center ? 0 : ext.h / 2] : [sh.size[0] / 2, sh.size[1] / 2, ext.center ? 0 : ext.h / 2]);
      note(d.skewed);
      return {
        ...shape2dDefaults('square'), ...base, name: SHAPE2D_LABELS.square, width: r3(Math.max(MIN, Math.abs(sh.size[0] * d.scale[0]))), depth: r3(Math.max(MIN, Math.abs(sh.size[1] * d.scale[1]))),
        cornerRadius: 0, height: heightOf(d.scale[2]), ...twist, ...scaleTop, ...offsetOf(d.scale[0]), position: d.position, rotation: d.rotation,
      } as Shape2DNode;
    }
    if (sh.s === 'text') {
      // Il font di OpenSCAD si cerca nel catalogo di Construct; la posizione è stimata perché i font non sono disponibili qui
      // (Construct centra il testo, OpenSCAD lo allinea a sinistra e sulla linea di base)
      const font = fontIdOf(sh.font);
      const advance = [...sh.text].length * sh.size * 0.6 * sh.spacing;
      const cx = sh.halign === 'center' ? 0 : sh.halign === 'right' ? -advance / 2 : advance / 2;
      const cy = sh.valign === 'top' ? -sh.size / 2 : sh.valign === 'center' ? 0 : sh.size / 2;
      const d = decompose(item.M, [cx, cy, ext.center ? 0 : ext.h / 2]);
      note(d.skewed);
      if (!same(d.scale[0], d.scale[1])) addNote('Un testo scalato in modo diverso in X e in Y è stato approssimato.');
      addNote('Testo: la posizione è stimata, perché il font di Construct può avere misure diverse da quello di OpenSCAD.');
      return {
        ...shape2dDefaults('text'), ...base, name: SHAPE2D_LABELS.text, kind: 'text', text: sh.text, font, size: r3(Math.max(MIN, sh.size * d.scale[1])), ...(sh.spacing !== 1 ? { spacing: sh.spacing } : {}), height: heightOf(d.scale[2]),
        ...twist, ...scaleTop, ...offsetOf(d.scale[0]), position: d.position, rotation: d.rotation,
      } as Shape2DNode;
    }
    // Poligono (anche con fori): diventa un disegno (contorni centrati nell'origine, come un SVG importato)
    const xs = sh.points.map((q) => q[0]);
    const ys = sh.points.map((q) => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const width = r3(Math.max(MIN, Math.max(...xs) - Math.min(...xs)));
    const depth = r3(Math.max(MIN, Math.max(...ys) - Math.min(...ys)));
    const d = decompose(item.M, [cx, cy, ext.center ? 0 : ext.h / 2]);
    note(d.skewed);
    return {
      ...shape2dDefaults('svg'), ...base, name: 'Poligono', kind: 'svg', fileName: 'OpenSCAD', contours: contoursOf(sh.paths, sh.points, [cx, cy]),
      width: r3(width * d.scale[0]), depth: r3(depth * d.scale[1]), height: heightOf(d.scale[2]), ...twist, ...scaleTop, ...offsetOf(d.scale[0]), position: d.position, rotation: d.rotation,
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
    // Minkowski: il gruppo porta posizione e rotazione, la scala (e lo specchio) si assorbono nei figli
    const placement = item.M ? decompose(item.M, [0, 0, 0]) : null;
    if (placement?.skewed) addNote('Una scala non uniforme dopo una rotazione è stata approssimata.');
    const kids = placement ? transformItems(item.children, [placement.scale[0], 0, 0, 0, 0, placement.scale[1], 0, 0, 0, 0, placement.mirrored ? -placement.scale[2] : placement.scale[2], 0, 0, 0, 0, 1]) : item.children;
    const childIds = kids.map(convert).filter((id): id is string => id !== null);
    if (!childIds.length) return null;
    // Un gruppo con un solo figlio è il figlio (una differenza senza sottrazioni, un'unione di un oggetto)
    if (childIds.length === 1 && item.op !== 'hull') return childIds[0];
    const id = newId();
    const group: GroupNode = {
      id, type: 'group', name: GROUP_NAMES[item.op], op: item.op, children: childIds,
      position: placement?.position ?? [0, 0, 0], rotation: placement?.rotation ?? [0, 0, 0], mode: 'solid', color: nodes[childIds[0]].color,
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
  return { nodes, plates, warnings: [...new Set(issues.map((i) => i.message))], issues, count };
}
