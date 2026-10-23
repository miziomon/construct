import { faceSurface, svgTileCenters } from '../kernel/textureMap';
import type { SvgReliefOptions } from '../kernel/textureMap';
import { EMBED } from '../kernel/relief';
import { polyhedronLines } from './reliefScad';
import { heightRange, makeTextureHeight, normalizeTexture } from '../scene/textureMap';
import type { GrayImage, TextureParams } from '../scene/textureMap';
import { sampleGrid } from '../scene/relief';
import type { Rect } from '../scene/voronoi';

/**
 * Codice OpenSCAD delle texture da immagine (studio di fattibilità, non collegato al generatore dell'app). Tre strade:
 * - `textureFaceScad`: motore F, `zmap` in centesimi di mm e `polyhedron` (come i rilievi procedurali), un file solo;
 * - `textureSurfaceScad`: motore F con `surface(file = "x.png")`: l'immagine è un PNG a 8 bit scritto accanto al `.scad`;
 * - `meshScad`: motore M, `polyhedron` dell'oggetto intero già spostato (la catena parametrica è persa);
 * - `svgReliefScad`: strada vettoriale, un `polygon` con i contorni e un ciclo sulle copie.
 * Il codice è nel riferimento della faccia (faccia su z = 0), come `reliefScad`.
 */

const n = (v: number) => String(Math.round(v * 100) / 100);
const n4 = (v: number) => String(Math.round(v * 10000) / 10000);

/**
 * Motore F con `zmap`. Restituisce il modulo `relief()` (e `texture_column()` per il modo "entrambi") e, se `piece` è il
 * codice OpenSCAD del pezzo (una espressione 3D), anche l'operazione che lo combina; `clip` ritaglia il rilievo sulla regione.
 */
export function textureFaceScad(rect: Rect, img: GrayImage, params: Partial<TextureParams>, step = 0.5, piece?: string, clip?: string): string {
  const surface = faceSurface(img, params, rect, step);
  const out = [`// Texture da immagine, motore F, modo ${normalizeTexture(params).mode}, passo ${step} mm`];
  if (!surface) return [...out, 'module relief() {}'].join('\n');
  // `clip` (facoltativo): solido 3D che copre la regione quando non è il rettangolo (per esempio un cilindro): come nel kernel, il rilievo si ritaglia
  out.push(clip ? 'module relief_raw() {' : 'module relief() {', ...polyhedronLines(surface.grid, surface.planeZ, surface.side).map((l) => `  ${l}`), '}');
  if (clip) out.push(`module relief() intersection() { relief_raw(); ${clip} }`);
  if (piece) out.push(...combine(surface.op, surface.column, rect, piece, clip));
  return out.join('\n');
}

/** Come si combina il solido della texture con il pezzo, secondo l'operazione di `faceSurface`. */
function combine(op: 'subtract' | 'add' | 'skin', column: [number, number] | null, rect: Rect, piece: string, clip?: string): string[] {
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  if (op === 'subtract') return ['difference() {', `  ${piece}`, '  relief();', '}'];
  if (op === 'add') return ['union() {', `  ${piece}`, '  relief();', '}'];
  // Pelle: si toglie la colonna della REGIONE (il rettangolo, ritagliato con `clip` se la regione è più piccola, come `prism(region)` del kernel) fino a un
  // piano sotto l'incavo più profondo e si unisce la superficie, anch'essa ritagliata sulla regione
  const cube = `translate([${n(rect.minX)}, ${n(rect.minY)}, ${n(column![0])}]) cube([${n(w)}, ${n(h)}, ${n(column![1] - column![0])}]);`;
  const column3d = clip ? ['    intersection() {', `      ${cube}`, `      ${clip}`, '    }'] : [`    ${cube}`];
  return ['union() {', '  difference() {', `    ${piece}`, ...column3d, '  }', '  relief();', '}'];
}

/**
 * Motore F con `surface()`. L'immagine è la griglia di quote del kernel, riscalata a 0..255 e scritta come PNG a 8 bit
 * (`png`: righe dall'alto, cioè la riga 0 è l'ultima riga della griglia); `surface()` legge 0..100 per 0..255, con il nodo
 * (colonna i, riga dal basso j) in (i, j), e la scala riporta tutto in mm. Costruisce sempre la "pelle": togliere la colonna
 * e unire la superficie, per qualunque modo (un incavo è una pelle con quote negative).
 */
export function textureSurfaceScad(
  rect: Rect,
  img: GrayImage,
  params: Partial<TextureParams>,
  step: number,
  pngName: string,
  piece?: string,
  clip?: string,
): { code: string; png: GrayImage; scaleZ: number } {
  const tex = normalizeTexture(params);
  const h = makeTextureHeight(img, tex);
  const [lo] = heightRange(tex);
  const grid = sampleGrid(rect, step, h);
  const base = lo - 0.4;
  const zBase = base - EMBED;
  const zTop = Math.max(...grid.z, 0) + 0.01;
  // `surface()` chiude il solido a (quota minima del PNG - 1 unità): senza un nodo a 0 il fondo sale fin quasi alla superficie e il
  // solido resta sottile. Si aggiunge una cornice di un pixel a 0 (il fondo vero, `zBase`) fuori dal rettangolo, poi si ritaglia.
  const w = grid.nx + 2;
  const hh = grid.ny + 2;
  const png = new Uint8Array(w * hh);
  // La riga 0 del PNG è l'alto: la riga dal basso j (con la cornice, j + 1) sta in riga hh - 1 - (j + 1)
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) png[(hh - 2 - j) * w + i + 1] = Math.round(((grid.z[j * grid.nx + i] - zBase) / (zTop - zBase)) * 255);
  const scaleZ = (zTop - zBase) / 100;
  const width = rect.maxX - rect.minX;
  const height = rect.maxY - rect.minY;
  const code = [
    `// Texture da immagine, motore F con surface(): il file ${pngName} (${w} x ${hh} pixel, 8 bit, cornice a 0) sta accanto a questo`,
    'module relief() intersection() {',
    `  translate([${n4(rect.minX - grid.dx)}, ${n4(rect.minY - grid.dy)}, ${n4(zBase)}]) scale([${n4(grid.dx)}, ${n4(grid.dy)}, ${n4(scaleZ)}]) surface(file = "${pngName}", center = false, convexity = 10);`,
    `  translate([${n4(rect.minX)}, ${n4(rect.minY)}, ${n4(zBase - 1)}]) cube([${n4(width)}, ${n4(height)}, ${n4(zTop - zBase + 2)}]);`,
    // Regione non rettangolare: anche la superficie si ritaglia, come nel kernel
    ...(clip ? [`  ${clip}`] : []),
    '}',
    ...(piece ? combine('skin', [base, Math.max(...grid.z, 0) + 1], rect, piece, clip) : []),
  ].join('\n');
  return { code, png: { w, h: hh, data: png }, scaleZ };
}

/**
 * Motore M: l'oggetto intero come `polyhedron` (coordinate a `decimals` decimali, facce rovesciate perché OpenSCAD le vuole
 * orarie viste da fuori). La catena parametrica (primitive, booleane, pattern) è persa: resta una mesh.
 */
export function meshScad(positions: ArrayLike<number>, indices: ArrayLike<number>, decimals = 3): string {
  const f = 10 ** decimals;
  const pts: string[] = [];
  for (let i = 0; i < positions.length; i += 3) pts.push(`[${[0, 1, 2].map((k) => Math.round(positions[i + k] * f) / f).join(',')}]`);
  const faces: string[] = [];
  for (let i = 0; i < indices.length; i += 3) faces.push(`[${indices[i]},${indices[i + 2]},${indices[i + 1]}]`);
  return ['// Texture da immagine, motore M: oggetto intero spostato (catena parametrica persa)', `polyhedron(points = [${pts.join(',')}], faces = [${faces.join(',')}], convexity = 10);`].join('\n');
}

/** Strada vettoriale: contorni (già in mm, centrati) con riempimento pari-dispari, copiati nei centri e estrusi. Rilievo o incavo secondo il segno di `height`. */
export function svgReliefScad(rect: Rect, o: SvgReliefOptions): string {
  const points = o.contours.flat();
  let start = 0;
  const paths = o.contours.map((c) => {
    const idx = c.map((_, i) => start + i);
    start += c.length;
    return `[${idx.join(', ')}]`;
  });
  const centers = svgTileCenters(rect, o);
  const z0 = o.height > 0 ? -EMBED : o.height;
  const h = o.height > 0 ? o.height + EMBED : -o.height + 0.5;
  return [
    '// Texture da SVG, strada vettoriale: un solo livello di quota, bordi esatti',
    `svg_points = [${points.map((p) => `[${n4(p[0])},${n4(p[1])}]`).join(',')}];`,
    `svg_paths = [${paths.join(', ')}];`,
    o.repeat
      ? `centers = [${centers.map((c) => `[${n(c[0])},${n(c[1])}]`).join(',')}];`
      : `centers = [[${n(centers[0][0])}, ${n(centers[0][1])}]];`,
    'module relief() {',
    // Come nel kernel le copie si ritagliano sul rettangolo
    '  intersection() {',
    `    for (c = centers) translate([c[0], c[1], ${n(z0)}]) linear_extrude(${n(h)}) polygon(points = svg_points, paths = svg_paths);`,
    `    translate([${n(rect.minX)}, ${n(rect.minY)}, ${n(z0 - 1)}]) cube([${n(rect.maxX - rect.minX)}, ${n(rect.maxY - rect.minY)}, ${n(h + 2)}]);`,
    '  }',
    '}',
  ].join('\n');
}
