import type { PolyhedronKind, Vec3 } from './types';

/** Rapporto aureo: serve per i vertici di icosaedro e dodecaedro. */
const PHI = (1 + Math.sqrt(5)) / 2;

/** Vertici del solido (a meno di scala) e tre vertici di una sua faccia, per appoggiarlo su quella faccia. */
interface Base {
  vertices: Vec3[];
  /** Indici di tre vertici non allineati della stessa faccia. */
  face: [number, number, number];
}

/** Segni +/- di tutte le combinazioni, per generare i vertici simmetrici. */
const SIGNS = [-1, 1];

function base(kind: PolyhedronKind): Base {
  switch (kind) {
    case 'octahedron':
      return {
        vertices: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
        face: [0, 2, 4],
      };
    case 'icosahedron': {
      // Permutazioni cicliche di (0, ±1, ±φ)
      const vertices: Vec3[] = [];
      for (const a of SIGNS) for (const b of SIGNS) vertices.push([0, a, b * PHI], [a, b * PHI, 0], [b * PHI, 0, a]);
      // Faccia: (0, 1, φ), (0, -1, φ), (φ, 0, 1)
      return { vertices, face: [vertices.findIndex((v) => v[0] === 0 && v[1] === 1 && v[2] === PHI), vertices.findIndex((v) => v[0] === 0 && v[1] === -1 && v[2] === PHI), vertices.findIndex((v) => v[0] === PHI && v[1] === 0 && v[2] === 1)] };
    }
    case 'dodecahedron': {
      const inv = 1 / PHI;
      const vertices: Vec3[] = [];
      for (const a of SIGNS) for (const b of SIGNS) {
        for (const c of SIGNS) vertices.push([a, b, c]);
        vertices.push([0, a * inv, b * PHI], [a * inv, b * PHI, 0], [b * PHI, 0, a * inv]);
      }
      // Faccia pentagonale che contiene (0, 1/φ, φ), (0, -1/φ, φ) e (1, 1, 1)
      const at = (x: number, y: number, z: number) => vertices.findIndex((v) => v[0] === x && v[1] === y && v[2] === z);
      return { vertices, face: [at(0, inv, PHI), at(0, -inv, PHI), at(1, 1, 1)] };
    }
    case 'decahedron': {
      // Trapezoedro pentagonale: due apici e due anelli di 5 vertici sfasati di 36°.
      // La quota degli anelli rende piane le facce a aquilone: a = (1 - cos36°) / (1 + cos36°) con apici a ±1
      const c36 = Math.cos(Math.PI / 5);
      const a = (1 - c36) / (1 + c36);
      const vertices: Vec3[] = [[0, 0, 1], [0, 0, -1]];
      for (let k = 0; k < 5; k++) {
        const up = (2 * Math.PI * k) / 5;
        const low = up + Math.PI / 5;
        vertices.push([Math.cos(up), Math.sin(up), a], [Math.cos(low), Math.sin(low), -a]);
      }
      // Faccia: apice alto e due vertici consecutivi dell'anello alto (indici 2 e 4)
      return { vertices, face: [0, 2, 4] };
    }
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/**
 * Vertici del solido con una faccia appoggiata sul piano XY (come sul piatto di stampa) e centro nell'origine.
 * `size` è la distanza tra due facce opposte: l'altezza dell'ingombro è quindi esattamente `size`.
 */
export function polyhedronVertices(kind: PolyhedronKind, size: number): Vec3[] {
  const { vertices, face } = base(kind);
  const [a, b, c] = face.map((i) => vertices[i]);
  // Normale uscente della faccia
  let n = cross(sub(b, a), sub(c, a));
  if (dot(n, a) < 0) n = [-n[0], -n[1], -n[2]];
  const l = len(n);
  n = [n[0] / l, n[1] / l, n[2] / l];
  // Inraggio (distanza del centro dalla faccia): uguale per tutte le facce di questi solidi
  const inradius = dot(n, a);
  const scale = size / 2 / inradius;

  // Rotazione che porta la normale della faccia su -Z (formula di Rodrigues)
  const d = -n[2];
  const rotate = (v: Vec3): Vec3 => {
    if (d > 1 - 1e-9) return v;
    if (d < -1 + 1e-9) return [v[0], -v[1], -v[2]];
    // Asse = n × (-Z), coseno dell'angolo = n · (-Z)
    const k = cross(n, [0, 0, -1]);
    const kv = cross(k, v);
    const kkv = cross(k, kv);
    const f = 1 / (1 + d);
    return [v[0] + kv[0] + kkv[0] * f, v[1] + kv[1] + kkv[1] * f, v[2] + kv[2] + kkv[2] * f];
  };

  return vertices.map((v) => rotate(v).map((x) => x * scale) as Vec3);
}

/**
 * Vertici delle sfere che, unite con un involucro convesso, danno il solido arrotondato:
 * il solido ridotto (inraggio size/2 - r) più r di raggio ha le facce ancora a size/2.
 */
export function roundedPolyhedronCenters(kind: PolyhedronKind, size: number, radius: number): Vec3[] {
  const half = size / 2;
  const k = (half - radius) / half;
  return polyhedronVertices(kind, size).map((v) => v.map((x) => x * k) as Vec3);
}

/** Raggio di arrotondamento massimo: poco meno dell'inraggio, dove il solido diventa una sfera. */
export const maxPolyhedronRadius = (size: number) => Math.max(0, size / 2 - 0.01);

/** Inraggio di un poligono regolare di raggio R (distanza del centro dai lati). Con meno di 3 lati si usa R. */
const polygonInradius = (radius: number, sides: number) => (sides >= 3 ? radius * Math.cos(Math.PI / sides) : radius);

/** Raggio di arrotondamento massimo degli angoli di un poligono regolare: poco meno dell'inraggio. */
export const polygonMaxRadius = (radius: number, sides: number) => Math.max(0, polygonInradius(radius, sides) - 0.01);

/**
 * Raggio del poligono ridotto che, allargato di `rounding` con un offset arrotondato, mantiene i lati
 * alla distanza originale: l'inraggio scende di `rounding`, quindi il raggio scala nello stesso rapporto.
 */
export function polygonShrunkRadius(radius: number, sides: number, rounding: number): number {
  const ri = polygonInradius(radius, sides);
  return (radius * (ri - rounding)) / ri;
}
