import type { Shape2DNode } from './types';

type SvgShape = Extract<Shape2DNode, { kind: 'svg' }>;

/**
 * Profili delle forme 2D poligonali (anello, cuore, stelle, uovo, trapezio, croce, goccia, mezzaluna).
 * Funzioni pure condivise da kernel e generatore OpenSCAD, così le due uscite non divergono. Ogni forma si costruisce
 * su una misura unitaria e poi si porta a `width × depth` mm, centrata nell'origine (come le altre forme 2D).
 */

type Vec2 = [number, number];

/** Forme poligonali: hanno `width`, `depth` e un parametro `ratio` che dipende dalla forma. */
export type PolygonShape = Extract<Shape2DNode, { ratio: number }>;
export type PolygonKind = PolygonShape['kind'];

/** Valore di `ratio` e intervallo consentito per forma (il significato è nella colonna `label`, usata dal pannello). */
export const RATIO_INFO: Record<PolygonKind, { default: number; min: number; max: number; label: string; tip: string } | null> = {
  ring: { default: 0.6, min: 0.1, max: 0.95, label: 'Foro', tip: 'Diametro del foro rispetto a quello esterno (in %).' },
  heart: null,
  star5: { default: 0.4, min: 0.1, max: 0.9, label: 'Raggio interno', tip: 'Raggio delle punte rientranti rispetto a quello delle punte (in %): più basso = punte più sottili.' },
  star6: { default: 0.5, min: 0.1, max: 0.9, label: 'Raggio interno', tip: 'Raggio delle punte rientranti rispetto a quello delle punte (in %): più basso = punte più sottili.' },
  egg: { default: 0.25, min: 0, max: 0.6, label: 'Punta', tip: 'Quanto si restringe la parte alta: 0 è un\'ellisse, più alto = uovo più appuntito (in %).' },
  trapezoid: { default: 0.6, min: 0.05, max: 1.5, label: 'Larghezza cima', tip: 'Larghezza del lato alto rispetto alla base (in %).' },
  cross: { default: 0.33, min: 0.1, max: 0.9, label: 'Spessore braccia', tip: 'Spessore delle braccia rispetto al lato più corto (in %).' },
  drop: null,
  crescent: { default: 0.45, min: 0.25, max: 0.95, label: 'Spessore', tip: 'Spostamento del cerchio che scava la luna: più alto = luna più spessa (in %).' },
};

/** Vero se la forma 2D è una di quelle poligonali (non cerchio, quadrato o testo). */
export const isPolygonShape = (node: Shape2DNode): node is Shape2DNode & PolygonShape => 'ratio' in node;

/** Punti su un'ellisse unitaria, in senso antiorario a partire da +X. */
const circle = (n: number): Vec2[] => Array.from({ length: n }, (_, i) => [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n)]);

/** Arco di cerchio di raggio r centrato in (cx, 0), da `from` a `to` radianti (anche decrescente), con `n` passi. */
function arc(cx: number, r: number, from: number, to: number, n: number): Vec2[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return [cx + r * Math.cos(a), r * Math.sin(a)];
  });
}

/** Area con segno (positiva se il contorno è antiorario). */
const signedArea = (c: Vec2[]) => c.reduce((sum, [x, y], i) => sum + (x * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * y), 0) / 2;

/** Orienta il contorno in senso antiorario (esterno) o orario (foro). */
const orient = (c: Vec2[], counterClockwise: boolean): Vec2[] => ((signedArea(c) > 0) === counterClockwise ? c : [...c].reverse());

/** Contorni della forma su misura unitaria (le proporzioni giuste, ma non ancora la misura in mm). */
function rawContours(p: PolygonShape): Vec2[][] {
  const r = p.ratio;
  switch (p.kind) {
    case 'ring': {
      // Esterno antiorario e foro orario: lo stesso foro in OpenSCAD con `paths`
      const hole = circle(64).map(([x, y]): Vec2 => [x * r, y * r]);
      return [circle(64), orient(hole, false)];
    }
    case 'heart': {
      // Curva classica del cuore (x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t)
      const pts = Array.from({ length: 96 }, (_, i): Vec2 => {
        const t = (2 * Math.PI * i) / 96;
        return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)];
      });
      return [orient(pts, true)];
    }
    case 'star5':
    case 'star6': {
      // Punte e rientranze alternate, con una punta rivolta verso l'alto
      const points = p.kind === 'star5' ? 5 : 6;
      return [
        Array.from({ length: points * 2 }, (_, i): Vec2 => {
          const a = Math.PI / 2 + (i * Math.PI) / points;
          const radius = i % 2 === 0 ? 1 : r;
          return [radius * Math.cos(a), radius * Math.sin(a)];
        }),
      ];
    }
    case 'egg':
      // Ellisse con la parte alta ristretta: più larga in basso
      return [circle(72).map(([x, y]): Vec2 => [x * (1 - r * y), y])];
    case 'trapezoid':
      return [[[-1, -1], [1, -1], [r, 1], [-r, 1]]];
    case 'cross': {
      // Due barre unite: spessore = r × lato più corto (in mm), poi la forma si porta a width × depth
      const w = p.width / 2;
      const d = p.depth / 2;
      const a = (Math.min(1, r) * Math.min(p.width, p.depth)) / 2;
      return [[[-a, -d], [a, -d], [a, -a], [w, -a], [w, a], [a, a], [a, d], [-a, d], [-a, a], [-w, a], [-w, -a], [-a, -a]]];
    }
    case 'drop': {
      // Cerchio unitario con la punta in alto a 2,5 raggi dal centro: la punta tocca il cerchio con due tangenti
      const tip = 2.5;
      const theta = Math.acos(1 / tip);
      return [[[0, tip], ...arc(0, 1, Math.PI / 2 + theta, Math.PI / 2 - theta + 2 * Math.PI, 64)]];
    }
    case 'crescent': {
      // Cerchio esterno (raggio 1) meno un cerchio di raggio 0,8 spostato di d verso destra: si calcolano i due punti
      // in cui le circonferenze si incontrano e si uniscono l'arco esterno (a sinistra) e quello interno
      const inner = 0.8;
      const d = Math.min(1.79, Math.max(0.21, r));
      const x = (1 - inner * inner + d * d) / (2 * d);
      const y = Math.sqrt(Math.max(0, 1 - x * x));
      const outer = Math.atan2(y, x);
      const innerAngle = Math.atan2(y, x - d);
      return [[...arc(0, 1, outer, 2 * Math.PI - outer, 48), ...arc(d, inner, 2 * Math.PI - innerAngle, innerAngle, 48)]];
    }
  }
}

/** Contorni della forma in mm: ingombro esattamente `width × depth`, centro nell'origine. */
export function shapeContours(p: PolygonShape): Vec2[][] {
  const contours = rawContours(p);
  const all = contours.flat();
  const [minX, maxX] = [Math.min(...all.map((q) => q[0])), Math.max(...all.map((q) => q[0]))];
  const [minY, maxY] = [Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[1]))];
  const sx = Math.max(0.01, p.width) / (maxX - minX);
  const sy = Math.max(0.01, p.depth) / (maxY - minY);
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  // Arrotondamento a 4 decimali: il codice OpenSCAD resta corto e il kernel usa gli stessi numeri
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return contours.map((c, i) => {
    const scaled = c.map(([x, y]): Vec2 => [round((x - cx) * sx), round((y - cy) * sy)]);
    // Il primo contorno è l'esterno (antiorario); gli altri, se ci sono, sono fori (orari)
    return orient(scaled, i === 0);
  });
}

/**
 * Contorni di un disegno SVG portati a `width × depth` mm, centrati nell'origine. A differenza delle forme poligonali
 * non si cambia il verso dei contorni: il riempimento è pari-dispari (kernel `EvenOdd`, `polygon(paths)` di OpenSCAD),
 * quindi un tracciato dentro un altro è un foro in qualunque verso sia disegnato.
 */
export function svgContours(p: Pick<SvgShape, 'contours' | 'width' | 'depth'>): Vec2[][] {
  const all = p.contours.flat();
  if (all.length === 0) return [];
  const [minX, maxX] = [Math.min(...all.map((q) => q[0])), Math.max(...all.map((q) => q[0]))];
  const [minY, maxY] = [Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[1]))];
  // Un disegno senza altezza o larghezza (linea) non ha area: nessun contorno
  if (maxX - minX <= 0 || maxY - minY <= 0) return [];
  const sx = Math.max(0.01, p.width) / (maxX - minX);
  const sy = Math.max(0.01, p.depth) / (maxY - minY);
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return p.contours.map((c) => c.map(([x, y]): Vec2 => [round((x - cx) * sx), round((y - cy) * sy)]));
}

/** Ingombro naturale di un SVG importato, in mm: quello dei contorni così come sono stati letti dal file. */
export function svgNaturalSize(p: Pick<SvgShape, 'contours'>): { width: number; depth: number } {
  const all = p.contours.flat();
  if (all.length === 0) return { width: 0, depth: 0 };
  const xs = all.map((q) => q[0]);
  const ys = all.map((q) => q[1]);
  return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) };
}

/** Scala attuale di un SVG rispetto alla dimensione naturale, in percentuale (100 = come nel file). */
export function svgScalePercent(p: Pick<SvgShape, 'contours' | 'width'>): number {
  const natural = svgNaturalSize(p).width;
  return natural > 0 ? (p.width / natural) * 100 : 100;
}

/** Valori predefiniti dell'estrusione rotazionale. */
export const REVOLVE_DEFAULT_ANGLE = 360;
export const REVOLVE_DEFAULT_SEGMENTS = 64;

/** Vero se la forma 2D si estrude girando attorno all'asse Z (come `rotate_extrude` di OpenSCAD). */
export const isRotational = (node: Pick<Shape2DNode, 'extrusion'>): boolean => node.extrusion === 'rotate';

/**
 * Ingombro approssimato del profilo (mm): serve a scegliere un raggio di partenza sensato per l'estrusione
 * rotazionale e a conoscere la metà del profilo che diventa altezza. Il testo non ha un ingombro esatto fuori dal
 * kernel (servono i font): si stima dalla dimensione e dal numero di caratteri.
 */
export function profileExtent(node: Shape2DNode): { width: number; depth: number } {
  let width: number;
  let depth: number;
  switch (node.kind) {
    case 'circle':
      width = 2 * node.radius;
      depth = 2 * (node.radiusY ?? node.radius);
      break;
    case 'text':
      width = Math.max(1, [...node.text].length) * node.size * 0.6;
      depth = node.size;
      break;
    default:
      width = node.width;
      depth = node.depth;
  }
  // Il contorno (offset) sposta ogni lato di `offset` mm
  const grow = 2 * (node.offset ?? 0);
  return { width: Math.max(0, width + grow), depth: Math.max(0, depth + grow) };
}

/** Parametri dell'estrusione rotazionale con i valori predefiniti per quelli assenti (raggio: l'ingombro in X del profilo). */
export function revolveParams(node: Shape2DNode): { angle: number; radius: number; segments: number } {
  return {
    angle: Math.min(360, Math.max(1, node.revolveAngle ?? REVOLVE_DEFAULT_ANGLE)),
    radius: Math.max(0, node.revolveRadius ?? Math.round(profileExtent(node).width * 10) / 10),
    segments: Math.min(256, Math.max(3, Math.round(node.revolveSegments ?? REVOLVE_DEFAULT_SEGMENTS))),
  };
}
