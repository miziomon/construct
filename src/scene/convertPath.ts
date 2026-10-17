import { MAX_PATH_CONTOURS, MAX_PATH_NODES, PATH_DEFAULT_TOLERANCE } from './bezier';
import { stretchFactors } from './ellipse';
import { round } from './math';
import { compensatePosition } from './pathPlacement';
import { ellipseContour, polygonContour, regularPolygon, roundedPolygonContour } from './pathShapes';
import { polygonMaxRadius, polygonShrunkRadius } from './polyhedra';
import { isProfileShape, profileContours } from './profiles';
import { isPolygonShape, isRotational, pathNaturalBox, revolveParams, shapeContours, svgContours } from './shapes2d';
import { isRatioLocked } from './resize';
import type { PathContour, SceneNode, Shape2DNode, Vec2, Vec3 } from './types';

type PathShape = Extract<Shape2DNode, { kind: 'path' }>;

/** Misura minima del kernel (`EPS` di evaluate.ts): le clamp del cerchio e del quadrato sono le sue. */
const EPS = 0.01;
/** Oltre questo numero di lati il cerchio diventa 4 nodi simmetrici (l'unica conversione approssimata). */
const MAX_EXACT_SIDES = 12;
/** Campi numerici del Profilo a cui può restare legata una formula (il resto non esiste nel Profilo). */
const KEPT_BINDINGS = ['position', 'rotation', 'height', 'twist', 'scaleTop', 'revolveAngle', 'revolveSegments', 'offset', 'width', 'depth'];

/** Una forma 2D che si può convertire: tutte tranne il testo e i Profili, che lo sono già. */
export const canConvertToPath = (node: SceneNode | undefined): node is Shape2DNode => node?.type === 'shape2d' && node.kind !== 'path' && node.kind !== 'text';

/** Contorno con ogni punto spostato di `fn` (le maniglie sono relative: seguono solo le scale). */
const mapContour = (c: PathContour, point: (p: Vec2) => Vec2, handle: (h: Vec2) => Vec2 = (h) => h): PathContour => ({
  closed: c.closed,
  nodes: c.nodes.map((n) => ({ p: point(n.p), ...(n.in ? { in: handle(n.in) } : {}), ...(n.out ? { out: handle(n.out) } : {}), kind: n.kind })),
});

/** Contorni della forma nel suo sistema locale (centrata nell'origine), oppure null per una forma senza contorni. */
function localContours(node: Exclude<Shape2DNode, { kind: 'path' | 'text' }>): PathContour[] {
  if (node.kind === 'circle') {
    // Stesse regole del kernel: raggio minimo, numero di lati intero, raccordo entro il massimo del poligono
    const radius = Math.max(EPS, node.radius);
    const sides = Math.max(3, Math.round(node.segments));
    const rc = Math.min(Math.max(0, node.cornerRadius ?? 0), polygonMaxRadius(radius, sides));
    // Fino a 12 lati la conversione è esatta (N spigoli, con il raccordo il poligono ridotto e gli archi); oltre, 4 nodi simmetrici
    const contour = sides <= MAX_EXACT_SIDES ? roundedPolygonContour(regularPolygon(sides, rc > 0 ? polygonShrunkRadius(radius, sides, rc) : radius), rc) : ellipseContour(0, 0, radius, radius);
    // Cerchio non proporzionale: la scala in Y è affine, quindi esatta anche sulle cubiche
    const f = stretchFactors(node);
    return [f ? mapContour(contour, (p) => [p[0], p[1] * f[1]], (h) => [h[0], h[1] * f[1]]) : contour];
  }
  if (node.kind === 'square') {
    const [w, d] = [Math.max(EPS, node.width), Math.max(EPS, node.depth)];
    // Il raggio non può superare metà del lato minore, come nel kernel
    const r = Math.min(Math.max(0, node.cornerRadius), (Math.min(w, d) - EPS) / 2);
    // Con il raccordo il rettangolo si riduce di r per lato e poi si gonfia di r (come l'offset arrotondato del kernel)
    const [hx, hy] = [w / 2 - r, d / 2 - r];
    return [roundedPolygonContour([[hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]], r)];
  }
  // Tutte le altre forme sono già poligoni: ogni punto diventa uno spigolo
  const polygons = node.kind === 'svg' ? svgContours(node) : isProfileShape(node) ? profileContours(node) : isPolygonShape(node) ? shapeContours(node) : [];
  return polygons.map(polygonContour);
}

/** Coordinate a 4 decimali (come il codice OpenSCAD): le stesse che scrive `roundPaths` nello store. */
const roundContour = (c: PathContour): PathContour => {
  const r4 = (v: number) => round(v, 4) || 0;
  return mapContour(c, (p) => [r4(p[0]), r4(p[1])], (h) => [r4(h[0]), r4(h[1])]);
};

/**
 * Converte una forma 2D nel Profilo di Bézier equivalente. Il solido resta lo stesso (stesso id, colore, rotazione,
 * estrusione): cambiano solo i contorni, che diventano nodi modificabili. Restituisce il nodo nuovo e i legami a un
 * parametro che il Profilo non può tenere (`dropped`, nomi dei campi) e se la conversione è approssimata (`approximate`: il cerchio
 * oltre 12 lati diventa una curva), oppure un messaggio se non si può convertire.
 * Il nodo si costruisce campo per campo: i campi propri della forma (raggio, lati, raccordo...) non devono restare.
 */
export function convertToPath(node: Shape2DNode): { node: PathShape; dropped: string[]; approximate: boolean } | string {
  if (node.kind === 'path') return 'È già un Profilo';
  if (node.kind === 'text') return 'Il testo non si converte in Profilo: i contorni dei font dipendono dal font e dal testo';
  let paths = localContours(node);
  const rotational = isRotational(node);
  // Estrusione rotazionale: il disegno parte a distanza `raggio` dall'asse, come il kernel sposta la forma prima di ruotarla
  const radius = revolveParams(node).radius;
  if (rotational) paths = paths.map((c) => mapContour(c, (p) => [p[0] + radius, p[1]]));
  paths = paths.map(roundContour);
  // I tetti dei dati del Profilo: oltre, l'unica via è l'import nella modale, che conserva le curve
  const tooLong = Math.max(0, ...paths.map((c) => c.nodes.length));
  if (tooLong > MAX_PATH_NODES) return `Il disegno ha ${tooLong} punti in un contorno (massimo ${MAX_PATH_NODES}): importa il file SVG dentro la modale del Profilo, che conserva le curve`;
  if (paths.length > MAX_PATH_CONTOURS) return `Il disegno ha ${paths.length} contorni (massimo ${MAX_PATH_CONTOURS}): importa il file SVG dentro la modale del Profilo, che conserva le curve`;
  const box = pathNaturalBox({ paths });
  if (!box || !(box.width > 0) || !(box.depth > 0)) return 'La forma non ha un disegno da convertire';

  // L'origine del Profilo è il centro del riquadro: con una torsione o una scala in cima, che girano attorno all'origine, un centro diverso cambierebbe il solido
  const offCenter = Math.abs(box.cx) > 1e-3 || Math.abs(box.cy) > 1e-3;
  if (!rotational && offCenter && (node.twist !== 0 || node.scaleTop !== 1)) {
    return 'Il centro della forma non coincide con quello del riquadro: con torsione o scala in cima il solido cambierebbe. Azzerale prima di convertire';
  }
  // Il centro del disegno è passato da (0, 0) a quello del riquadro: la posizione compensa e il solido resta dov'è
  // (in rotazione la X è il raggio, che si adegua da sé: conta solo la quota)
  const position: Vec3 = compensatePosition(node, rotational ? 'rotate' : 'linear', [0, 0], [box.cx, box.cy]);

  // Legami a un parametro: restano quelli dei campi che il Profilo ha; un legame di posizione che la compensazione sposta si perde
  const dropped: string[] = [];
  const exprs: NonNullable<Shape2DNode['exprs']> = {};
  for (const [key, binding] of Object.entries(node.exprs ?? {})) {
    const [top, axis] = key.split('.');
    const moved = top === 'position' && Math.abs(position[Number(axis)] - node.position[Number(axis)]) > 1e-6;
    if (KEPT_BINDINGS.includes(top) && !moved) exprs[key] = binding;
    else dropped.push(key);
  }

  const converted: PathShape = {
    id: node.id,
    name: node.name,
    type: 'shape2d',
    kind: 'path',
    paths,
    tolerance: PATH_DEFAULT_TOLERANCE,
    // La misura naturale delle curve, come `addPath` e `commitProfile`: arrotondata, all'apertura della modale il disegno si scalerebbe
    width: box.width,
    depth: box.depth,
    position,
    rotation: node.rotation,
    mode: node.mode,
    color: node.color,
    height: node.height,
    twist: node.twist,
    scaleTop: node.scaleTop,
    // Il lucchetto delle proporzioni resta com'era (per le forme base è spento finché non lo si chiude)
    lockRatio: isRatioLocked(node),
    ...(node.mirror ? { mirror: node.mirror } : {}),
    ...(node.locked !== undefined ? { locked: node.locked } : {}),
    ...(node.hidden !== undefined ? { hidden: node.hidden } : {}),
    ...(node.extrusion !== undefined ? { extrusion: node.extrusion } : {}),
    ...(node.offset !== undefined ? { offset: node.offset } : {}),
    ...(node.offsetJoin !== undefined ? { offsetJoin: node.offsetJoin } : {}),
    ...(node.revolveAngle !== undefined ? { revolveAngle: node.revolveAngle } : {}),
    ...(node.revolveSegments !== undefined ? { revolveSegments: node.revolveSegments } : {}),
    ...(Object.keys(exprs).length ? { exprs } : {}),
  };
  // L'unico caso non esatto: il cerchio oltre 12 lati diventa 4 nodi simmetrici
  return { node: converted, dropped, approximate: node.kind === 'circle' && Math.max(3, Math.round(node.segments)) > MAX_EXACT_SIDES };
}
