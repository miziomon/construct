import type { ProfileKind, Shape2DNode } from './types';

/**
 * Profilati strutturali (sezione a L, a T e a H). Funzioni pure condivise da kernel e generatore OpenSCAD, così le
 * due uscite non divergono. La sezione sta sul piano XY, con ingombro `width × depth` mm centrato nell'origine, e
 * si estrude lungo Z come le altre forme 2D.
 */

type Vec2 = [number, number];

/** Nodo di un profilato: ingombro, spessori delle ali e dell'anima, raccordo interno opzionale. */
export type ProfileShape = Extract<Shape2DNode, { kind: ProfileKind }>;

export const PROFILE_KINDS: ProfileKind[] = ['profileL', 'profileT', 'profileH'];

export const isProfileKind = (kind: string): kind is ProfileKind => (PROFILE_KINDS as string[]).includes(kind);

/** Vero se la forma 2D è un profilato. */
export const isProfileShape = (node: Shape2DNode): node is ProfileShape => isProfileKind(node.kind);

/** Etichette e spiegazioni dei due spessori, diverse per tipo (nella L sono due ali, nelle altre ala e anima). */
export const PROFILE_INFO: Record<ProfileKind, { flangeLabel: string; webLabel: string; flangeTip: string; webTip: string }> = {
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
};

/** Asse (0 = X, 1 = Y) lungo cui si misurano ala e anima: serve a scalarli con il fattore giusto nel ridimensionamento. */
export function thicknessAxes(kind: ProfileKind): { flange: 0 | 1; web: 0 | 1 } {
  // Nella H le ali sono verticali (spessore lungo X) e l'anima orizzontale; nelle altre è il contrario
  return kind === 'profileH' ? { flange: 0, web: 1 } : { flange: 1, web: 0 };
}

/** Spessore minimo di una parete e margine che le pareti lasciano all'ingombro (mm). */
const MIN_WALL = 0.1;

/** Raggio massimo del raccordo interno: la parte dritta più corta tra quelle che toccano un angolo concavo. */
export function maxRootRadius(p: Pick<ProfileShape, 'kind' | 'width' | 'depth' | 'flange' | 'web'>): number {
  const { width: w, depth: d, flange: f, web: t } = p;
  let limit: number;
  switch (p.kind) {
    case 'profileL': limit = Math.min(w - t, d - f); break;
    // Nella T l'ala sporge metà per lato; nella H l'anima ha un raccordo a ciascun capo
    case 'profileT': limit = Math.min((w - t) / 2, d - f); break;
    case 'profileH': limit = Math.min((w - 2 * f) / 2, (d - t) / 2); break;
  }
  // Un po' meno della parte dritta, così gli archi non si toccano e il contorno resta semplice
  return Math.max(0, Math.round((limit - 0.01) * 1e3) / 1e3);
}

/** Misure valide: spessori tra MIN_WALL e l'ingombro, raccordo tra 0 e il massimo ammesso. */
export function clampProfile<T extends ProfileShape>(p: T): T {
  const w = Math.max(2 * MIN_WALL, p.width);
  const d = Math.max(2 * MIN_WALL, p.depth);
  const wall = (v: number, max: number) => Math.min(Math.max(MIN_WALL, v), Math.max(MIN_WALL, max));
  // Nella H le due ali stanno dentro la larghezza; negli altri ogni spessore sta dentro la misura che attraversa
  const flange = p.kind === 'profileH' ? wall(p.flange, (w - MIN_WALL) / 2) : wall(p.flange, d - MIN_WALL);
  const web = p.kind === 'profileH' ? wall(p.web, d - MIN_WALL) : wall(p.web, w - MIN_WALL);
  const next = { ...p, width: w, depth: d, flange, web };
  const rootRadius = Math.min(Math.max(0, p.rootRadius ?? 0), maxRootRadius(next));
  return { ...next, rootRadius };
}

/** Passi di un quarto di cerchio del raccordo interno. */
const ROOT_STEPS = 8;

/** Vertice del contorno: `concave` segna gli angoli tra ala e anima, dove va il raccordo. */
interface Corner {
  p: Vec2;
  concave?: boolean;
}

/** Vertici della sezione, in senso antiorario, con le misure già valide. */
function corners(p: ProfileShape): Corner[] {
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
  }
}

/**
 * Raccordo di un angolo concavo: l'arco di raggio r tangente ai due lati (le direzioni `u` in arrivo e `v` in
 * uscita sono assi), con il centro dalla parte dell'aria. In un contorno antiorario l'angolo concavo gira a destra,
 * quindi l'arco si percorre in senso orario dal punto di tangenza sul lato in arrivo a quello sul lato in uscita.
 */
function rootArc(corner: Vec2, u: Vec2, v: Vec2, r: number): Vec2[] {
  const center: Vec2 = [corner[0] - u[0] * r + v[0] * r, corner[1] - u[1] * r + v[1] * r];
  const start = Math.atan2(-v[1], -v[0]);
  return Array.from({ length: ROOT_STEPS + 1 }, (_, i) => {
    const a = start - (Math.PI / 2) * (i / ROOT_STEPS);
    return [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)];
  });
}

/** Direzione unitaria da `a` a `b` (i lati sono tutti paralleli agli assi). */
const direction = (a: Vec2, b: Vec2): Vec2 => [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];

/** Contorno della sezione in mm: ingombro esattamente `width × depth`, centro nell'origine, verso antiorario. */
export function profileContours(input: ProfileShape): Vec2[][] {
  const p = clampProfile(input);
  const list = corners(p);
  const r = p.rootRadius ?? 0;
  // Arrotondamento a 4 decimali: il codice OpenSCAD resta corto e il kernel usa gli stessi numeri
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  const points: Vec2[] = [];
  list.forEach((c, i) => {
    if (c.concave && r > 0) {
      const prev = list[(i + list.length - 1) % list.length].p;
      const next = list[(i + 1) % list.length].p;
      points.push(...rootArc(c.p, direction(prev, c.p), direction(c.p, next), r));
    } else {
      points.push(c.p);
    }
  });
  return [points.map(([x, y]): Vec2 => [round(x), round(y)])];
}

/** Area della sezione senza raccordi (mm²): serve ai test e a chi vuole stimare il volume. */
export function profileArea(input: ProfileShape): number {
  const p = clampProfile(input);
  const { width: w, depth: d, flange: f, web: t } = p;
  return p.kind === 'profileH' ? 2 * d * f + (w - 2 * f) * t : w * f + (d - f) * t;
}
