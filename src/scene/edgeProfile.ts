import { MIN_SEGMENTS } from './defaults';
import type { EdgeNode, EndPlane, Vec3 } from './types';

/** Funzioni pure del taglierino di raccordo e smusso, condivise da kernel e generatore OpenSCAD (così non divergono). */

type Vec2 = [number, number];

/** Segmenti predefiniti del cerchio di un raccordo (stesso valore nel kernel e nel codice OpenSCAD). */
export const EDGE_SEGMENTS = 64;

/** Misura minima accettata: evita profili degeneri. */
export const MIN_EDGE_SIZE = 0.01;

/** Estremità dello spigolo tagliate da un piano obliquo oltre questa inclinazione non si estrudono più in modo sicuro. */
const MAX_TILT_RATIO = 50;

type ProfileSource = Pick<EdgeNode, 'treatment' | 'angle' | 'radius' | 'distance1' | 'distance2' | 'segments'>;

export interface EdgeProfile {
  /** Poligono in senso antiorario nel piano XY locale (apice nell'origine, bisettrice lungo +X). */
  polygon: Vec2[];
  /** Solo per il raccordo: cerchio da sottrarre al poligono. */
  circle?: { center: Vec2; radius: number; segments: number };
}

/** Semi-apertura dell'angolo tra le facce, in radianti, tenuta lontana da 0° e 90° per non degenerare. */
const halfAngle = (angleDeg: number) => (Math.min(179, Math.max(1, angleDeg)) * Math.PI) / 360;

/**
 * Sezione del taglierino. Raccordo: triangolo tra l'apice e i punti di tangenza, meno il cerchio del raggio
 * (area r²·(cot(β/2) − (π − β)/2)). Smusso: triangolo tra l'apice e i due punti a distanza d1 e d2 lungo le facce.
 */
export function edgeProfile(p: ProfileSource): EdgeProfile {
  // Semi-apertura dell'angolo: tutto il profilo è espresso rispetto alla bisettrice (asse +X)
  const h = halfAngle(p.angle);
  const [cos, sin] = [Math.cos(h), Math.sin(h)];
  if (p.treatment === 'fillet') {
    const r = Math.max(MIN_EDGE_SIZE, p.radius);
    // Distanza dall'apice ai punti di tangenza del cerchio con le due facce
    const d = r / Math.tan(h);
    // Il cerchio ha `segments` lati sull'intero giro (come $fn): meno lati = raccordo più sfaccettato.
    // Si tengono almeno MIN_SEGMENTS lati (un cerchio a 2 lati non esiste) e un numero intero.
    const segments = Math.max(MIN_SEGMENTS, Math.round(p.segments ?? EDGE_SEGMENTS));
    return {
      // Triangolo apice + due punti di tangenza: il cerchio verrà sottratto da questo poligono
      polygon: [[0, 0], [d * cos, -d * sin], [d * cos, d * sin]],
      // Centro del cerchio sulla bisettrice, a distanza r/sin(h) dall'apice
      circle: { center: [r / sin, 0], radius: r, segments },
    };
  }
  const d1 = Math.max(MIN_EDGE_SIZE, p.distance1);
  const d2 = Math.max(MIN_EDGE_SIZE, p.distance2);
  return { polygon: [[0, 0], [d1 * cos, -d1 * sin], [d2 * cos, d2 * sin]] };
}

/** Seconda distanza dello smusso "distanza e angolo": angolo α tra il piano dello smusso e la prima faccia (teorema dei seni). */
export function chamferSecondDistance(distance1: number, alphaDeg: number, openingDeg: number): number {
  const alpha = (alphaDeg * Math.PI) / 180;
  const beta = (openingDeg * Math.PI) / 180;
  const denominator = Math.sin(beta + alpha);
  // Con α + β ≥ 180° lo smusso non chiude il triangolo: si ripiega sulla distanza uguale
  return denominator > 1e-6 ? (distance1 * Math.sin(alpha)) / denominator : distance1;
}

/** Angolo α (gradi) tra lo smusso e la prima faccia, per mostrare nel pannello i valori di uno smusso a due distanze. */
export function chamferAngle(distance1: number, distance2: number, openingDeg: number): number {
  const beta = (openingDeg * Math.PI) / 180;
  // Triangolo con lati d1 e d2 attorno all'angolo β: il lato opposto chiude con l'angolo sulla prima faccia
  return (Math.atan2(distance2 * Math.sin(beta), distance1 - distance2 * Math.cos(beta)) * 180) / Math.PI;
}

/** Raggio massimo del raccordo: la distanza dei punti di tangenza dallo spigolo non può superare la larghezza delle facce. */
export const maxFilletRadius = (p: Pick<EdgeNode, 'angle' | 'reach'>) => p.reach * Math.tan(halfAngle(p.angle));

/**
 * Abbondanza (mm) del taglierino oltre le estremità perpendicolari. Un'estremità libera sta esattamente sulla faccia del
 * pezzo: con gli errori di arrotondamento della rotazione il taglio si ferma una frazione di micron prima e resta una
 * lamina di materiale con lo spigolo vivo. Solo per i taglierini convessi (differenza): oltre l'estremità c'è aria,
 * mentre un taglierino concavo aggiunge materiale e sporgerebbe.
 */
export const END_OVERSHOOT = 0.01;
export const endOvershoot = (p: Pick<EdgeNode, 'convex'>) => (p.convex ? END_OVERSHOOT : 0);

/** Piani di chiusura con i valori predefiniti (perpendicolari, a Z = 0 e Z = lunghezza, con l'abbondanza) al posto dei null. */
export function endPlanesOf(p: Pick<EdgeNode, 'ends' | 'length' | 'convex'>): [EndPlane, EndPlane] {
  const over = endOvershoot(p);
  return [p.ends[0] ?? { normal: [0, 0, -1], offset: over }, p.ends[1] ?? { normal: [0, 0, 1], offset: p.length + over }];
}

/** Vero se entrambe le estremità sono perpendicolari: basta estrudere la sezione per la lunghezza esatta. */
export const hasPerpendicularEnds = (p: Pick<EdgeNode, 'ends'>) => p.ends[0] === null && p.ends[1] === null;

/**
 * Quanto si estrude oltre le due estremità quando i piani di chiusura sono obliqui: abbastanza perché il piano ritagli
 * tutta la sezione, qualunque sia l'inclinazione (con limite, per i piani quasi paralleli allo spigolo).
 */
export function endMargin(p: EdgeNode): number {
  const profile = edgeProfile(p);
  const extent = Math.max(...profile.polygon.map(([x, y]) => Math.hypot(x, y)), (profile.circle?.center[0] ?? 0) + (profile.circle?.radius ?? 0));
  const tilt = Math.max(0, ...p.ends.filter((e): e is EndPlane => e !== null).map((e) => Math.min(MAX_TILT_RATIO, Math.hypot(e.normal[0], e.normal[1]) / Math.max(Math.abs(e.normal[2]), 1 / MAX_TILT_RATIO))));
  return extent * tilt + 1;
}

/**
 * Matrice 4×4 (righe) di un semispazio: le colonne sono due direzioni nel piano, la normale e un punto del piano.
 * Un cubo con la faccia alta in Z = 0, moltiplicato per questa matrice, occupa la parte con normale·p ≤ offset.
 */
export function halfSpaceMatrix(plane: EndPlane): number[][] {
  const n = plane.normal;
  // Una direzione qualunque non parallela alla normale per costruire una base ortonormale
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = normalize(cross(helper, n));
  const t2 = cross(n, t1);
  const point = n.map((v) => v * plane.offset);
  return [
    [t1[0], t2[0], n[0], point[0]],
    [t1[1], t2[1], n[1], point[1]],
    [t1[2], t2[2], n[2], point[2]],
    [0, 0, 0, 1],
  ];
}

const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
