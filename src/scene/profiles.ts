import type { BarKind, ProfileKind, Shape2DNode } from './types';

/**
 * Profilati strutturali: sezioni con ali e anima (L, T, H, U) e tubolari (rettangolare, tondo). Funzioni pure
 * condivise da kernel e generatore OpenSCAD, così le due uscite non divergono. La sezione sta sul piano XY, centrata
 * nell'origine, e si estrude lungo Z come le altre forme 2D.
 */

type Vec2 = [number, number];

/** Nodo di un profilato, di qualunque sezione. */
export type ProfileShape = Extract<Shape2DNode, { kind: ProfileKind }>;
/** Profilato con ali e anima (L, T, H, U): ingombro, due spessori, raccordo interno. */
export type BarShape = Extract<Shape2DNode, { kind: BarKind }>;
/** Tubolare rettangolare. */
export type TubeRectShape = Extract<Shape2DNode, { kind: 'tubeRect' }>;
/** Tubolare tondo. */
export type TubeRoundShape = Extract<Shape2DNode, { kind: 'tubeRound' }>;

export const BAR_KINDS: BarKind[] = ['profileL', 'profileT', 'profileH', 'profileU'];
/** Tutti i profilati, nell'ordine della libreria. */
export const PROFILE_KINDS: ProfileKind[] = [...BAR_KINDS, 'tubeRect', 'tubeRound'];

export const isProfileKind = (kind: string): kind is ProfileKind => (PROFILE_KINDS as string[]).includes(kind);
export const isBarKind = (kind: string): kind is BarKind => (BAR_KINDS as string[]).includes(kind);

/** Vero se la forma 2D è un profilato (ali e anima oppure tubolare). */
export const isProfileShape = (node: Shape2DNode): node is ProfileShape => isProfileKind(node.kind);
/** Vero se la forma 2D è un profilato con ali e anima. */
export const isBarShape = (node: Shape2DNode): node is BarShape => isBarKind(node.kind);

/** Etichette e spiegazioni dei due spessori, diverse per tipo (nella L sono due ali, nelle altre ala e anima). */
export const PROFILE_INFO: Record<BarKind, { flangeLabel: string; webLabel: string; flangeTip: string; webTip: string }> = {
  profileL: {
    flangeLabel: 'Spessore ala X',
    webLabel: 'Spessore ala Y',
    flangeTip: "Spessore dell'ala orizzontale (quella lunga quanto la larghezza), in mm.",
    webTip: "Spessore dell'ala verticale (quella lunga quanto la profondità), in mm.",
  },
  profileT: {
    flangeLabel: 'Spessore ala',
    webLabel: 'Spessore anima',
    flangeTip: "Spessore dell'ala, la barra orizzontale in cima alla T, in mm.",
    webTip: "Spessore dell'anima, la barra verticale al centro della T, in mm.",
  },
  profileH: {
    flangeLabel: 'Spessore ali',
    webLabel: 'Spessore anima',
    flangeTip: 'Spessore delle due ali, le barre verticali ai lati della H, in mm.',
    webTip: "Spessore dell'anima, la barra orizzontale che unisce le ali, in mm.",
  },
  profileU: {
    flangeLabel: 'Spessore ali',
    webLabel: 'Spessore fondo',
    flangeTip: 'Spessore delle due ali, le barre verticali ai lati della U, in mm.',
    webTip: 'Spessore del fondo, la barra orizzontale in basso che unisce le ali, in mm.',
  },
};

/** Asse (0 = X, 1 = Y) lungo cui si misurano ala e anima: serve a scalarli con il fattore giusto nel ridimensionamento. */
export function thicknessAxes(kind: BarKind): { flange: 0 | 1; web: 0 | 1 } {
  // Nella H e nella U le ali sono verticali (spessore lungo X) e l'anima orizzontale; nelle altre è il contrario
  return kind === 'profileH' || kind === 'profileU' ? { flange: 0, web: 1 } : { flange: 1, web: 0 };
}

/** Spessore minimo di una parete e margine che le pareti lasciano all'ingombro (mm). */
const MIN_WALL = 0.1;

/** Raggio massimo del raccordo interno: la parte dritta più corta tra quelle che toccano un angolo concavo. */
export function maxRootRadius(p: Pick<BarShape, 'kind' | 'width' | 'depth' | 'flange' | 'web'>): number {
  const { width: w, depth: d, flange: f, web: t } = p;
  let limit: number;
  switch (p.kind) {
    case 'profileL': limit = Math.min(w - t, d - f); break;
    // Nella T l'ala sporge metà per lato; nella H l'anima ha un raccordo a ciascun capo
    case 'profileT': limit = Math.min((w - t) / 2, d - f); break;
    case 'profileH': limit = Math.min((w - 2 * f) / 2, (d - t) / 2); break;
    // Nella U il fondo ha un raccordo a ciascun capo e le ali uno solo, in basso
    case 'profileU': limit = Math.min((w - 2 * f) / 2, d - t); break;
  }
  // Un po' meno della parte dritta, così gli archi non si toccano e il contorno resta semplice
  return Math.max(0, Math.round((limit - 0.01) * 1e3) / 1e3);
}

/** Valore tra MIN_WALL e `max` (che a sua volta non scende sotto MIN_WALL). */
const wall = (v: number, max: number) => Math.min(Math.max(MIN_WALL, v), Math.max(MIN_WALL, max));

/** Misure valide: spessori tra MIN_WALL e l'ingombro, raccordi tra 0 e il massimo ammesso. */
export function clampProfile<T extends ProfileShape>(p: T): T {
  if (p.kind === 'tubeRound') {
    const radius = Math.max(2 * MIN_WALL, p.radius);
    return { ...p, radius, wall: wall(p.wall, radius - MIN_WALL) };
  }
  const w = Math.max(2 * MIN_WALL, p.width);
  const d = Math.max(2 * MIN_WALL, p.depth);
  if (p.kind === 'tubeRect') {
    // La parete sta dentro metà del lato minore; il raggio esterno al massimo arrotonda tutto il lato minore
    const thickness = wall(p.wall, Math.min(w, d) / 2 - MIN_WALL);
    const cornerRadius = Math.min(Math.max(0, p.cornerRadius ?? 0), Math.min(w, d) / 2);
    return { ...p, width: w, depth: d, wall: thickness, cornerRadius };
  }
  // Ali verticali (H, U): due ali dentro la larghezza; negli altri ogni spessore sta dentro la misura che attraversa
  const bar = p as BarShape;
  const vertical = bar.kind === 'profileH' || bar.kind === 'profileU';
  const flange = vertical ? wall(bar.flange, (w - MIN_WALL) / 2) : wall(bar.flange, d - MIN_WALL);
  const web = vertical ? wall(bar.web, d - MIN_WALL) : wall(bar.web, w - MIN_WALL);
  const next: BarShape = { ...bar, width: w, depth: d, flange, web };
  const rootRadius = Math.min(Math.max(0, bar.rootRadius ?? 0), maxRootRadius(next));
  return { ...next, rootRadius } as T;
}

/** Passi di un quarto di cerchio dei raccordi (interni e degli angoli dei tubolari). */
const ARC_STEPS = 8;

/** Vertice del contorno: `concave` segna gli angoli tra ala e anima, dove va il raccordo. */
interface Corner {
  p: Vec2;
  concave?: boolean;
}

/** Vertici della sezione con ali e anima, in senso antiorario, con le misure già valide. */
function corners(p: BarShape): Corner[] {
  const w = p.width / 2;
  const d = p.depth / 2;
  const f = p.flange;
  const t = p.web;
  switch (p.kind) {
    case 'profileL':
      // Angolo esterno in basso a sinistra: ala orizzontale sul fondo, ala verticale a sinistra
      return [{ p: [-w, -d] }, { p: [w, -d] }, { p: [w, -d + f] }, { p: [-w + t, -d + f], concave: true }, { p: [-w + t, d] }, { p: [-w, d] }];
    case 'profileT':
      // Ala in cima, anima al centro
      return [
        { p: [-w, d] },
        { p: [-w, d - f] },
        { p: [-t / 2, d - f], concave: true },
        { p: [-t / 2, -d] },
        { p: [t / 2, -d] },
        { p: [t / 2, d - f], concave: true },
        { p: [w, d - f] },
        { p: [w, d] },
      ];
    case 'profileH':
      // Due ali verticali ai lati, anima orizzontale al centro
      return [
        { p: [-w, -d] },
        { p: [-w + f, -d] },
        { p: [-w + f, -t / 2], concave: true },
        { p: [w - f, -t / 2], concave: true },
        { p: [w - f, -d] },
        { p: [w, -d] },
        { p: [w, d] },
        { p: [w - f, d] },
        { p: [w - f, t / 2], concave: true },
        { p: [-w + f, t / 2], concave: true },
        { p: [-w + f, d] },
        { p: [-w, d] },
      ];
    case 'profileU':
      // Fondo in basso, due ali verticali ai lati
      return [
        { p: [-w, -d] },
        { p: [w, -d] },
        { p: [w, d] },
        { p: [w - f, d] },
        { p: [w - f, -d + t], concave: true },
        { p: [-w + f, -d + t], concave: true },
        { p: [-w + f, d] },
        { p: [-w, d] },
      ];
  }
}

/**
 * Raccordo di un angolo tra due lati paralleli agli assi: l'arco di raggio r tangente ai due lati (le direzioni `u`
 * in arrivo e `v` in uscita). Il centro sta a P − u·r + v·r, dalla parte interna della curva; l'arco va dal punto di
 * tangenza sul lato in arrivo a quello sul lato in uscita, nel verso della svolta (`cross(u, v)`: positivo a sinistra,
 * cioè angolo convesso di un contorno antiorario; negativo a destra, cioè angolo concavo).
 */
function cornerArc(corner: Vec2, u: Vec2, v: Vec2, r: number): Vec2[] {
  const center: Vec2 = [corner[0] - u[0] * r + v[0] * r, corner[1] - u[1] * r + v[1] * r];
  const start = Math.atan2(-v[1], -v[0]);
  const sweep = Math.sign(u[0] * v[1] - u[1] * v[0]) * (Math.PI / 2);
  return Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
    const a = start + sweep * (i / ARC_STEPS);
    return [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)];
  });
}

/** Direzione unitaria da `a` a `b` (i lati sono tutti paralleli agli assi). */
const direction = (a: Vec2, b: Vec2): Vec2 => [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];

/** Contorno con ali e anima: vertici, con gli angoli concavi raccordati se `rootRadius > 0`. */
function barContour(p: BarShape): Vec2[] {
  const list = corners(p);
  const r = p.rootRadius ?? 0;
  const points: Vec2[] = [];
  list.forEach((c, i) => {
    if (c.concave && r > 0) {
      const prev = list[(i + list.length - 1) % list.length].p;
      const next = list[(i + 1) % list.length].p;
      points.push(...cornerArc(c.p, direction(prev, c.p), direction(c.p, next), r));
    } else {
      points.push(c.p);
    }
  });
  return points;
}

/** Rettangolo `w × d` centrato nell'origine, antiorario, con gli angoli arrotondati di `r` (0 = vivi). */
function roundedRect(w: number, d: number, r: number): Vec2[] {
  const x = w / 2;
  const y = d / 2;
  if (r <= 0) return [[-x, -y], [x, -y], [x, y], [-x, y]];
  // Ogni angolo è un arco convesso tra il lato in arrivo e quello in uscita
  const cornersCcw: [Vec2, Vec2, Vec2][] = [
    [[x, -y], [1, 0], [0, 1]],
    [[x, y], [0, 1], [-1, 0]],
    [[-x, y], [-1, 0], [0, -1]],
    [[-x, -y], [0, -1], [1, 0]],
  ];
  return cornersCcw.flatMap(([corner, u, v]) => cornerArc(corner, u, v, r));
}

/** Punti su un cerchio, in senso antiorario a partire da +X (come `circle($fn = n)` di OpenSCAD). */
const circle = (radius: number, n: number): Vec2[] => Array.from({ length: n }, (_, i) => [radius * Math.cos((2 * Math.PI * i) / n), radius * Math.sin((2 * Math.PI * i) / n)]);

/**
 * Contorni della sezione in mm, centro nell'origine: uno solo, antiorario, per i profilati con ali e anima; per i
 * tubolari l'esterno antiorario e il foro orario (regola pari-dispari, come l'anello e gli SVG).
 */
export function profileContours(input: ProfileShape): Vec2[][] {
  const p = clampProfile(input);
  // Arrotondamento a 4 decimali: il codice OpenSCAD resta corto e il kernel usa gli stessi numeri
  const round = (c: Vec2[]) => c.map(([x, y]): Vec2 => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  if (p.kind === 'tubeRound') {
    const n = Math.max(3, Math.round(p.segments));
    return [round(circle(p.radius, n)), round(circle(p.radius - p.wall, n).reverse())];
  }
  if (p.kind === 'tubeRect') {
    const r = p.cornerRadius ?? 0;
    const outer = roundedRect(p.width, p.depth, r);
    // Il foro ha gli angoli con il raggio ridotto della parete: lo spessore resta costante anche in curva
    const inner = roundedRect(p.width - 2 * p.wall, p.depth - 2 * p.wall, Math.max(0, r - p.wall));
    return [round(outer), round(inner.reverse())];
  }
  return [round(barContour(p))];
}

/** Area della sezione senza raccordi (mm²): serve ai test e a chi vuole stimare il volume. */
export function profileArea(input: ProfileShape): number {
  const p = clampProfile(input);
  switch (p.kind) {
    case 'tubeRound': return Math.PI * (p.radius ** 2 - (p.radius - p.wall) ** 2);
    case 'tubeRect': return p.width * p.depth - (p.width - 2 * p.wall) * (p.depth - 2 * p.wall);
    case 'profileH': return 2 * p.depth * p.flange + (p.width - 2 * p.flange) * p.web;
    case 'profileU': return p.width * p.web + 2 * (p.depth - p.web) * p.flange;
    default: return p.width * p.flange + (p.depth - p.flange) * p.web;
  }
}
