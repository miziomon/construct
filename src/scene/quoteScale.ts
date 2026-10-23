import { pathNaturalBox } from './shapes2d';
import type { Shape2DNode } from './types';

type PathShape = Extract<Shape2DNode, { kind: 'path' }>;

/**
 * Ridimensionamento di un Profilo con quote (decisione 11a dello studio quote). Le quote sono in millimetri del disegno
 * (il sistema dell'editor), ma il solido è il disegno campionato scalato a `width × depth`: la Scala in percentuale, il
 * gizmo e i campi Larghezza e Profondità cambiano quelle due misure senza toccare i nodi né le quote. Qui si calcola di
 * quanto, e il testo dell'avviso che dice che le quote NON si aggiornano (nessuna riscrittura automatica dei valori).
 */

/** Fattori di scala di un Profilo rispetto alle misure naturali dei suoi nodi, o null se è alla misura naturale (o non si può dire). */
export function pathScaleFactors(node: PathShape): { sx: number; sy: number } | null {
  const box = pathNaturalBox(node);
  if (!box || box.width <= 0 || box.depth <= 0) return null;
  // Stesso minimo con cui il kernel scala il disegno
  const sx = Math.max(0.01, node.width) / box.width;
  const sy = Math.max(0.01, node.depth) / box.depth;
  return Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3 ? null : { sx, sy };
}

/** Numero con al più due decimali e la virgola italiana. */
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/**
 * Avviso se il Profilo ha quote e non è alla misura naturale: il fattore e il valore di una quota che non si aggiorna.
 * `subject` apre la frase («Il profilo», «Profilo 2»). Null senza quote pilotanti o senza ridimensionamento.
 */
export function quoteScaleWarning(node: PathShape, subject: string): string | null {
  const factors = pathScaleFactors(node);
  const quote = node.constraints?.find((c) => !c.ref && c.v !== undefined && (c.t === 'dist' || c.t === 'distX' || c.t === 'distY' || c.t === 'angle'));
  if (!factors || !quote || quote.v === undefined) return null;
  return `${subject}: ridimensionato ×${fmt(factors.sx)} in X e ×${fmt(factors.sy)} in Y. Le quote non si aggiornano: ${fmt(quote.v)} ${quote.t === 'angle' ? '°' : 'mm'} resta il valore salvato`;
}
