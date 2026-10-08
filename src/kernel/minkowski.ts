import type { Manifold, ManifoldToplevel } from 'manifold-3d';

type Vec3 = [number, number, number];

/** Centro del parallelepipedo che racchiude un solido. */
function centerOf(m: Manifold): Vec3 {
  const { min, max } = m.boundingBox();
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/** Vero se il solido è (quasi) convesso: coincide con il suo inviluppo. */
function isConvex(Class: ManifoldToplevel['Manifold'], m: Manifold): boolean {
  const hull = Class.hull([m]);
  const convex = m.volume() >= hull.volume() * 0.999;
  hull.delete();
  return convex;
}

/**
 * Somma di Minkowski di due solidi. `minkowskiSum` di manifold-3d sbaglia quando il secondo solido non contiene
 * l'origine: il risultato comprende anche il primo solido (un cubo con una sfera lontana "resta" dov'era). Per questo
 * i due solidi si portano con il centro nell'origine, si sommano, e il risultato si riporta al suo posto (la somma si
 * sposta della somma degli spostamenti). Se il secondo è concavo e il primo no, i ruoli si scambiano.
 */
function sumOf(Class: ManifoldToplevel['Manifold'], a: Manifold, b: Manifold): Manifold {
  const convexA = isConvex(Class, a);
  const convexB = isConvex(Class, b);
  const [first, second] = !convexB && convexA ? [b, a] : [a, b];
  const ca = centerOf(first);
  const cb = centerOf(second);
  const x = first.translate([-ca[0], -ca[1], -ca[2]]);
  const y = second.translate([-cb[0], -cb[1], -cb[2]]);
  const sum = x.minkowskiSum(y);
  x.delete();
  y.delete();
  const placed = sum.translate([ca[0] + cb[0], ca[1] + cb[1], ca[2] + cb[2]]);
  sum.delete();
  // La somma di due solidi convessi è convessa: l'inviluppo ripulisce gli errori di calcolo, così i passi seguenti
  // la riconoscono come convessa (altrimenti manifold la scompone in molte parti e diventa decine di volte più lento)
  if (convexA && convexB) {
    const hull = Class.hull([placed]);
    placed.delete();
    return hull;
  }
  return placed;
}

/**
 * Somma di Minkowski di più solidi (`minkowski()` di OpenSCAD): il primo si espande del volume di ogni successivo, uno
 * dopo l'altro. Con una sfera come secondo solido equivale ad arrotondare ogni spigolo del primo.
 * I solidi passati restano di chi li possiede (la cache): il risultato è sempre un Manifold nuovo, da liberare.
 */
export function minkowskiOf(Class: ManifoldToplevel['Manifold'], solids: Manifold[]): Manifold {
  if (solids.length === 0) return Class.union([]);
  // Un solo figlio: la somma è il figlio stesso (una copia, perché il chiamante libera il risultato)
  let result = solids[0].translate([0, 0, 0]);
  for (const next of solids.slice(1)) {
    const grown = sumOf(Class, result, next);
    result.delete();
    result = grown;
  }
  return result;
}
