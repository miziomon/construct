import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { ImportError } from './types';

type Vec2 = [number, number];

/** Disegno letto da un SVG: tracciati chiusi in mm, centrati nell'origine con Y verso l'alto, e il loro ingombro. */
export interface ImportedSvg {
  name: string;
  contours: Vec2[][];
  width: number;
  depth: number;
}

/** Oltre questo numero di punti l'editor rallenta troppo: il file viene rifiutato. */
const MAX_POINTS = 200_000;
/** Passi con cui si appiattiscono le curve di ogni segmento. */
const CURVE_DIVISIONS = 12;
/** Millimetri per unità fisica di lunghezza (le unità senza dimensione fisica, px e assenti, non sono qui). */
const MM_PER_UNIT: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6 };

/**
 * Fattore che porta le unità utente del disegno in millimetri. Se l'SVG dichiara una larghezza fisica (es. "210mm")
 * e un viewBox, l'unità utente vale larghezza / viewBox. Altrimenti 1 unità = 1 mm (px e unità assenti non hanno una
 * dimensione fisica affidabile: la forma resta ridimensionabile dal pannello).
 */
function unitScale(root: Element): number {
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const declared = /^\s*([\d.]+)\s*([a-z]*)\s*$/i.exec(root.getAttribute('width') ?? '');
  const mmPerUnit = declared ? MM_PER_UNIT[declared[2].toLowerCase()] : undefined;
  if (!viewBox || viewBox.length !== 4 || !(viewBox[2] > 0) || !declared || !mmPerUnit) return 1;
  return (parseFloat(declared[1]) * mmPerUnit) / viewBox[2];
}

const round = (v: number) => Math.round(v * 1e3) / 1e3;

/**
 * Legge un SVG e ne ricava i contorni dei tracciati riempiti (curve appiattite in segmenti). I tracciati senza
 * riempimento (solo contorno) si ignorano; i fori sono i tracciati dentro altri tracciati. Lancia `ImportError`
 * con un messaggio leggibile se il file non è un SVG o non contiene aree riempite.
 */
export function parseSvg(text: string, baseName: string): ImportedSvg {
  const loader = new SVGLoader();
  // L'unità predefinita del loader resta 'px': così anche i numeri nudi di rect e circle (come quelli dei tracciati)
  // restano quelli del file, senza conversioni. Il passaggio a millimetri lo fa `unitScale`
  let data: ReturnType<SVGLoader['parse']>;
  try {
    data = loader.parse(text);
  } catch {
    throw new ImportError(`"${baseName}" non è un file SVG valido.`);
  }
  // I tipi di three dichiarano un documento, ma `xml` è l'elemento radice
  const root = data.xml as unknown as Element;
  // DOMParser non solleva eccezioni sui file rotti: restituisce un documento con <parsererror>
  if (root.nodeName.toLowerCase() !== 'svg' || root.getElementsByTagName('parsererror').length > 0) {
    throw new ImportError(`"${baseName}" non è un file SVG valido.`);
  }
  const scale = unitScale(root);

  // Y cresce verso il basso negli SVG, verso l'alto nella scena: si ribalta
  const raw: Vec2[][] = [];
  let points = 0;
  for (const path of data.paths) {
    // Il riempimento predefinito (nero) lo imposta già il loader: si scartano solo i tracciati senza riempimento
    if ((path.userData?.style as { fill?: string } | undefined)?.fill === 'none') continue;
    for (const shape of SVGLoader.createShapes(path)) {
      const { shape: outline, holes } = shape.extractPoints(CURVE_DIVISIONS);
      for (const ring of [outline, ...holes]) {
        // Un contorno chiuso ripete il primo punto in fondo, e due punti uguali di fila non servono a nulla
        const pts = ring.map((p): Vec2 => [p.x * scale, -p.y * scale]).filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
        if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
        if (pts.length < 3) continue;
        points += pts.length;
        if (points > MAX_POINTS) throw new ImportError(`"${baseName}" è troppo complesso (oltre ${MAX_POINTS.toLocaleString('it-IT')} punti): semplifica il disegno.`);
        raw.push(pts);
      }
    }
  }
  if (raw.length === 0) throw new ImportError(`"${baseName}" non contiene aree riempite: converti i contorni in tracciati con riempimento.`);

  // Ingombro e centratura nell'origine
  const xs = raw.flatMap((c) => c.map((p) => p[0]));
  const ys = raw.flatMap((c) => c.map((p) => p[1]));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [width, depth] = [maxX - minX, maxY - minY];
  if (!(width > 0) || !(depth > 0)) throw new ImportError(`"${baseName}" non ha un'area utilizzabile (larghezza o altezza nulla).`);
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const contours = raw.map((c) => c.map(([x, y]): Vec2 => [round(x - cx), round(y - cy)]));
  return { name: baseName, contours, width: round(width), depth: round(depth) };
}
