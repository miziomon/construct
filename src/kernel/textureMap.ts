import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { ABOVE, EMBED, FLOOR, clipToRegion, heightSolid, prism } from './relief';
import { sampleGrid } from '../scene/relief';
import { heightRange, makeDisplacement, makeTextureHeight, normalizeTexture } from '../scene/textureMap';
import type { HeightGrid } from '../scene/relief';
import type { HeightSide } from './relief';
import type { GrayImage, Projection, TextureParams } from '../scene/textureMap';
import type { Rect, Vec2 } from '../scene/voronoi';

/**
 * Texture da immagine nel kernel (studio di fattibilità, non collegato all'app; docs/studio-texture-immagine.md).
 *
 * Motore F (faccia piana): l'immagine campionata è la `f(x, y)` di `sampleGrid`, poi `heightSolid` come per i rilievi
 * procedurali. Tutto nel riferimento della faccia (faccia su z = 0, pezzo sotto). Il chiamante possiede regione e solidi.
 *
 * Motore M (mesh intera, stile BumpMesh): raffinamento dei lati, spostamento di ogni vertice lungo la normale con una
 * proiezione planare, triplanare o cilindrica, ricostruzione del solido.
 *
 * SVG vettoriale: i contorni di `parseSvg` come celle estruse (un solo livello di quota, bordi esatti).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Chiave di cache
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Chiave di cache del kernel per una texture: l'impronta dell'immagine (l'id dell'asset, come per le mesh importate) più i
 * parametri. Non contiene i pixel: la chiave resta corta e `JSON.stringify` di `evaluate.ts` non scorre mai l'immagine.
 */
export const textureCacheKey = (imageId: string, params: Partial<TextureParams>, projection?: Partial<Projection>, extra: unknown = null): string =>
  JSON.stringify([imageId, normalizeTexture(params), projection ?? null, extra]);

// ---------------------------------------------------------------------------------------------------------------------
// Motore F: faccia piana
// ---------------------------------------------------------------------------------------------------------------------

export interface TextureFaceOptions {
  /** Passo della griglia di campioni (mm): 0,8 anteprima, 0,5 normale, 0,3 fine. */
  step?: number;
  /** Rettangolo a cui ancorare l'immagine; se manca, il riquadro della regione. */
  rect?: Rect;
}

function regionRect(region: CrossSection): Rect {
  const b = region.bounds();
  return { minX: b.min[0], minY: b.min[1], maxX: b.max[0], maxY: b.max[1] };
}

/**
 * La superficie da costruire per una faccia piana: griglia di quote, piano di chiusura del solido e che cosa farne. Serve
 * sia al kernel (`applyTextureFace`) sia al generatore OpenSCAD, così i due scrivono gli stessi numeri.
 * - 'subtract' (incavo): solido sopra la superficie, da togliere dal pezzo;
 * - 'add' (rilievo): solido sotto la superficie che entra di `EMBED` nel pezzo, da unire;
 * - 'skin' (entrambi): come 'add' ma sotto l'incavo più profondo, dopo aver tolto dal pezzo la colonna `column` (da z a z).
 */
export interface FaceSurface {
  op: 'subtract' | 'add' | 'skin';
  grid: HeightGrid;
  planeZ: number;
  side: HeightSide;
  /** Quota minima e massima del solido (per ritagliarlo sulla regione). */
  zFrom: number;
  zTo: number;
  column: [number, number] | null;
}

/**
 * Superficie della texture sul rettangolo; null se la quota è nulla ovunque (ampiezza 0, livello medio agli estremi). `embed` è
 * quanto la pelle (rilievo) entra nel pezzo: `EMBED`, ma il Pattern lo limita a metà dello spessore (come per le borchie);
 * `floorZ` è la quota più bassa che il solido può toccare (vedi `textureFloor`), per il modo «entrambi».
 */
export function faceSurface(img: GrayImage, params: Partial<TextureParams>, rect: Rect, step = 0.5, embed = EMBED, floorZ = -Infinity): FaceSurface | null {
  const tex = normalizeTexture(params);
  const h = makeTextureHeight(img, tex);
  const [lo, hi] = heightRange(tex);
  if (lo === 0 && hi === 0) return null;
  if (tex.mode === 'groove') {
    // Dove l'incavo è sotto FLOOR la superficie resta sopra la faccia: niente facce complanari con il pezzo
    return { op: 'subtract', grid: sampleGrid(rect, step, (x, y) => FLOOR + h(x, y)), planeZ: ABOVE + 1, side: 'above', zFrom: lo - 1, zTo: ABOVE + 1, column: null };
  }
  if (tex.mode === 'relief') {
    // Dove il rilievo è sotto FLOOR la superficie resta un po' sotto la faccia
    return { op: 'add', grid: sampleGrid(rect, step, (x, y) => (h(x, y) < FLOOR ? -FLOOR : h(x, y))), planeZ: -embed, side: 'below', zFrom: -embed, zTo: hi + 1, column: null };
  }
  // both: la quota cambia segno. Piano di base 0,4 mm sotto l'incavo più profondo; la pelle entra di EMBED sotto il piano
  // Il piano di base sta 0,4 mm sotto l'incavo più profondo, ma la pelle (un piede più in basso) non esce dal fondo del pezzo (`floorZ`)
  const base = Math.min(Math.max(lo - 0.4, floorZ + embed), lo);
  return { op: 'skin', grid: sampleGrid(rect, step, h), planeZ: base - embed, side: 'below', zFrom: base - embed, zTo: hi + 1, column: [base, hi + 1] };
}

/**
 * Applica la texture a una faccia piana (nel riferimento della faccia) e restituisce un nuovo solido (il pezzo resta del
 * chiamante): una booleana per rilievo e incavo, due per `both` (si toglie la colonna della regione e si unisce la pelle).
 */
export function applyTextureFace(
  wasm: ManifoldToplevel,
  solid: Manifold,
  region: CrossSection,
  img: GrayImage,
  params: Partial<TextureParams>,
  options: TextureFaceOptions = {},
): Manifold {
  if (region.isEmpty()) return solid.translate([0, 0, 0]);
  const surface = faceSurface(img, params, options.rect ?? regionRect(region), options.step);
  if (!surface) return solid.translate([0, 0, 0]);
  const tool = clipToRegion(wasm, heightSolid(wasm, surface.grid, surface.planeZ, surface.side), region, surface.zFrom, surface.zTo);
  if (!tool) return solid.translate([0, 0, 0]);
  if (surface.op === 'subtract') {
    const result = solid.subtract(tool);
    tool.delete();
    return result;
  }
  let base = solid;
  if (surface.column) {
    const column = prism(wasm, region, surface.column[0], surface.column[1]);
    base = solid.subtract(column);
    column.delete();
  }
  const result = base.add(tool);
  if (base !== solid) base.delete();
  tool.delete();
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Motore M: spostamento dei vertici lungo la normale
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Come si ricava la direzione di spostamento di un vertice:
 * - 'smooth': media delle normali delle facce (pesate per l'angolo): la mesh resta chiusa, gli spigoli vivi si arrotondano;
 * - 'miter': come 'smooth' sui vertici lisci, e sugli spigoli vivi la direzione che sposta di `h` ogni piano adiacente
 *   (spigolo a squadra: `n1 + n2` diviso `1 + n1 . n2`), con tetto `miterLimit` volte `h`;
 * - 'split': ogni triangolo si sposta lungo la propria normale con vertici propri (le facce si staccano agli spigoli).
 */
export type NormalMode = 'smooth' | 'miter' | 'split';

export interface DisplaceOptions {
  /** Lunghezza massima dei lati dopo il raffinamento (mm). */
  edge?: number;
  normals?: NormalMode;
  /** Angolo (gradi) sopra il quale due facce formano uno spigolo vivo. */
  sharpAngle?: number;
  /** Se vero, l'ampiezza è 0 sui vertici dello spigolo vivo: lo spigolo resta com'è e la texture sfuma verso di esso. */
  fadeSharp?: boolean;
  /** Tetto dei triangoli del raffinamento: oltre, il lato si allarga. */
  maxTriangles?: number;
  miterLimit?: number;
}

export interface DisplaceStats {
  status: string;
  triangles: number;
  refinedTriangles: number;
  edgeUsed: number;
  volume: number;
  volumeBefore: number;
  /** Triangoli la cui normale dopo lo spostamento ha prodotto scalare negativo con quella di prima: pieghe, autointersezioni locali. */
  flipped: number;
  /** Vertici su uno spigolo vivo. */
  sharpVertices: number;
  msRefine: number;
  msDisplace: number;
  msBuild: number;
}

const now = () => performance.now();

/** Normale unitaria e area (doppia) del triangolo; area nulla per i triangoli degeneri. */
function triangleNormal(p: Float64Array, a: number, b: number, c: number): [number, number, number, number] {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? [nx / len, ny / len, nz / len, len] : [0, 0, 0, 0];
}

/** Soluzione di G c = 1 (matrice k x k, k <= 4) con eliminazione di Gauss e pivot; null se è singolare. */
function solveOnes(g: number[][]): number[] | null {
  const k = g.length;
  const m = g.map((row, i) => [...row, 1 + 0 * i]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-6) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= k; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[k] / row[i]);
}

/**
 * Sposta ogni vertice di `solid` lungo la normale di `img` come texture secondo `projection`. Restituisce il nuovo solido
 * (da liberare) e le statistiche; `solid` resta del chiamante. Lo `status()` di manifold dopo lo spostamento controlla solo la
 * topologia: una superficie che si autointerseca resta 'NoError', quindi si contano anche i triangoli rovesciati.
 */
export function displaceSolid(
  wasm: ManifoldToplevel,
  solid: Manifold,
  img: GrayImage,
  params: Partial<TextureParams>,
  projection: Partial<Projection> = {},
  options: DisplaceOptions = {},
): { solid: Manifold | null; stats: DisplaceStats } {
  const mode = options.normals ?? 'smooth';
  const sharpCos = Math.cos(((options.sharpAngle ?? 30) * Math.PI) / 180);
  const miterLimit = options.miterLimit ?? 2;
  const volumeBefore = solid.volume();

  // 1) Raffinamento: lati al più `edge` mm. La superficie ha una stima dei triangoli (circa 0,4 L^2 a triangolo) e il tetto allarga il lato
  const t0 = now();
  const area = solid.surfaceArea();
  const maxTriangles = options.maxTriangles ?? 400_000;
  const edge = Math.max(options.edge ?? 0.8, Math.sqrt(area / (0.4 * maxTriangles)));
  const refined = solid.refineToLength(edge);
  const mesh = refined.getMesh();
  const msRefine = now() - t0;

  // 2) Posizioni (le prime tre colonne), triangoli, normali delle facce e normali medie dei vertici
  const t1 = now();
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const pos = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) pos.set([mesh.vertProperties[i * np], mesh.vertProperties[i * np + 1], mesh.vertProperties[i * np + 2]], i * 3);
  const tri = mesh.triVerts;
  const nt = tri.length / 3;

  const out = new Float64Array(nv * 3);
  const faceN = new Float64Array(nt * 3);
  let sharpVertices = 0;

  if (mode === 'split') {
    // Ogni triangolo è a sé: tre vertici propri spostati lungo la normale del triangolo
    const splitPos = new Float32Array(nt * 9);
    const splitTri = new Uint32Array(nt * 3);
    const disp = makeDisplacement(img, params, projection);
    for (let t = 0; t < nt; t++) {
      const [a, b, c] = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]];
      const [nx, ny, nz] = triangleNormal(pos, a, b, c);
      [a, b, c].forEach((v, k) => {
        const x = pos[v * 3];
        const y = pos[v * 3 + 1];
        const z = pos[v * 3 + 2];
        const d = disp(x, y, z, nx, ny, nz);
        splitPos.set([x + nx * d, y + ny * d, z + nz * d], (t * 3 + k) * 3);
        splitTri[t * 3 + k] = t * 3 + k;
      });
    }
    const msDisplace = now() - t1;
    const t2 = now();
    const built = buildSolid(wasm, splitPos, splitTri);
    const stats = finish(built, nt, edge, volumeBefore, 0, msRefine, msDisplace, now() - t2, splitPos, splitTri, pos, tri);
    refined.delete();
    return { solid: typeof built === 'string' ? null : built, stats };
  }

  // Normali medie (pesate per l'angolo al vertice) e, per 'miter', fino a 4 normali distinte per vertice
  const acc = new Float64Array(nv * 3);
  const needClusters = mode === 'miter' || options.fadeSharp === true;
  const clusters = needClusters ? new Float64Array(nv * 12) : null;
  const clusterCount = needClusters ? new Uint8Array(nv) : null;
  // Un cluster accetta una normale entro circa 5 gradi
  const CLUSTER_COS = Math.cos((5 * Math.PI) / 180);
  for (let t = 0; t < nt; t++) {
    const idx = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]];
    const [nx, ny, nz, len] = triangleNormal(pos, idx[0], idx[1], idx[2]);
    faceN.set([nx, ny, nz], t * 3);
    if (len === 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = idx[k];
      const p0 = idx[k] * 3;
      const p1 = idx[(k + 1) % 3] * 3;
      const p2 = idx[(k + 2) % 3] * 3;
      // Angolo del triangolo nel vertice v
      const e1 = [pos[p1] - pos[p0], pos[p1 + 1] - pos[p0 + 1], pos[p1 + 2] - pos[p0 + 2]];
      const e2 = [pos[p2] - pos[p0], pos[p2 + 1] - pos[p0 + 1], pos[p2 + 2] - pos[p0 + 2]];
      const cosA = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / (Math.hypot(...e1) * Math.hypot(...e2) || 1);
      const w = Math.acos(Math.min(1, Math.max(-1, cosA)));
      acc[v * 3] += nx * w;
      acc[v * 3 + 1] += ny * w;
      acc[v * 3 + 2] += nz * w;
      if (clusters && clusterCount) {
        const cnt = clusterCount[v];
        let found = false;
        for (let c = 0; c < cnt && !found; c++) found = clusters[v * 12 + c * 3] * nx + clusters[v * 12 + c * 3 + 1] * ny + clusters[v * 12 + c * 3 + 2] * nz > CLUSTER_COS;
        if (!found && cnt < 4) {
          clusters.set([nx, ny, nz], v * 12 + cnt * 3);
          clusterCount[v] = cnt + 1;
        }
      }
    }
  }

  // 3) Spostamento: direzione unitaria media (per la proiezione) e vettore di spostamento per unità di quota
  const disp = makeDisplacement(img, params, projection);
  for (let i = 0; i < nv; i++) {
    let nx = acc[i * 3];
    let ny = acc[i * 3 + 1];
    let nz = acc[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // Spigolo vivo: due normali di faccia distinte (cluster) con angolo oltre `sharpAngle`
    let dirX = nx;
    let dirY = ny;
    let dirZ = nz;
    let sharp = false;
    if (clusters && clusterCount) {
      const cnt = clusterCount[i];
      const ns: number[][] = [];
      for (let c = 0; c < cnt; c++) ns.push([clusters[i * 12 + c * 3], clusters[i * 12 + c * 3 + 1], clusters[i * 12 + c * 3 + 2]]);
      for (let a = 0; a < cnt && !sharp; a++) for (let b = a + 1; b < cnt && !sharp; b++) sharp = ns[a][0] * ns[b][0] + ns[a][1] * ns[b][1] + ns[a][2] * ns[b][2] < sharpCos;
      if (sharp && mode === 'miter') {
        const g = ns.map((u) => ns.map((v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
        const c = solveOnes(g);
        if (c) {
          let mx = 0;
          let my = 0;
          let mz = 0;
          c.forEach((ci, k) => {
            mx += ci * ns[k][0];
            my += ci * ns[k][1];
            mz += ci * ns[k][2];
          });
          // Tetto sulla lunghezza: spigoli molto acuti darebbero spostamenti enormi
          const ml = Math.hypot(mx, my, mz);
          const s = ml > miterLimit ? miterLimit / ml : 1;
          [dirX, dirY, dirZ] = [mx * s, my * s, mz * s];
        }
      }
    }
    if (sharp) sharpVertices++;
    const d = options.fadeSharp && sharp ? 0 : disp(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nx, ny, nz);
    out[i * 3] = pos[i * 3] + dirX * d;
    out[i * 3 + 1] = pos[i * 3 + 1] + dirY * d;
    out[i * 3 + 2] = pos[i * 3 + 2] + dirZ * d;
  }
  const msDisplace = now() - t1;

  // 4) Ricostruzione del solido dalle posizioni spostate (stessa topologia)
  const t2 = now();
  const vp = new Float32Array(out);
  const built = buildSolid(wasm, vp, new Uint32Array(tri));
  const stats = finish(built, nt, edge, volumeBefore, sharpVertices, msRefine, msDisplace, now() - t2, vp, tri, pos, tri);
  refined.delete();
  return { solid: typeof built === 'string' ? null : built, stats };
}

/** Solido dalla mesh spostata. Con mesh aperta (le facce 'split' staccate) il costruttore di manifold lancia `ManifoldError`: si restituisce il messaggio. */
function buildSolid(wasm: ManifoldToplevel, vertProperties: Float32Array, triVerts: Uint32Array): Manifold | string {
  try {
    return new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties, triVerts }));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Completa le statistiche: stato, triangoli, volume e triangoli rovesciati rispetto alla mesh di partenza. */
function finish(
  built: Manifold | string,
  refinedTriangles: number,
  edgeUsed: number,
  volumeBefore: number,
  sharpVertices: number,
  msRefine: number,
  msDisplace: number,
  msBuild: number,
  newPos: Float32Array,
  newTri: Uint32Array,
  oldPos: Float64Array,
  oldTri: Uint32Array,
): DisplaceStats {
  // Rovesciati: confronto tra la normale del triangolo prima e dopo (solo se la topologia è la stessa, cioè non 'split')
  let flipped = 0;
  if (newTri.length === oldTri.length && newPos.length === oldPos.length) {
    const np = Float64Array.from(newPos);
    for (let t = 0; t < oldTri.length / 3; t++) {
      const a = triangleNormal(oldPos, oldTri[t * 3], oldTri[t * 3 + 1], oldTri[t * 3 + 2]);
      const b = triangleNormal(np, newTri[t * 3], newTri[t * 3 + 1], newTri[t * 3 + 2]);
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) flipped++;
    }
  }
  const ok = typeof built !== 'string';
  return {
    status: ok ? built.status() : `Errore: ${built}`,
    triangles: ok ? built.numTri() : 0,
    refinedTriangles,
    edgeUsed,
    volume: ok ? built.volume() : 0,
    volumeBefore,
    flipped,
    sharpVertices,
    msRefine,
    msDisplace,
    msBuild,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// SVG vettoriale: celle estruse
// ---------------------------------------------------------------------------------------------------------------------

export interface SvgReliefOptions {
  /** Contorni già portati in mm e centrati nell'origine (come `svgContours`): la piastrella è il loro ingombro più `gap`. */
  contours: Vec2[][];
  /** Passo di ripetizione (mm) sui due assi: ingombro del disegno più la distanza tra le copie. */
  pitch: [number, number];
  /** Quota unica del disegno (mm): positiva = rilievo, negativa = incavo. */
  height: number;
  /** Ripetere il disegno su tutto il rettangolo o metterne uno solo al centro. */
  repeat: boolean;
}

/** Centri delle copie del disegno: una al centro del rettangolo e le altre a passi interi, finché la piastrella tocca il rettangolo. */
export function svgTileCenters(rect: Rect, o: Pick<SvgReliefOptions, 'pitch' | 'repeat'>): Vec2[] {
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  if (!o.repeat) return [[cx, cy]];
  const [px, py] = o.pitch;
  const nx = Math.ceil((rect.maxX - rect.minX + px) / (2 * px));
  const ny = Math.ceil((rect.maxY - rect.minY + py) / (2 * py));
  const out: Vec2[] = [];
  for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) out.push([cx + i * px, cy + j * py]);
  return out;
}

/**
 * Il disegno SVG come solido: `CrossSection` (riempimento pari-dispari) copiata nei centri, estrusa di |height|. Con
 * `height` > 0 va unito al pezzo (parte da `EMBED` sotto la faccia), con `height` < 0 va tolto. Ritagliato sulla regione.
 */
export function svgReliefSolid(wasm: ManifoldToplevel, region: CrossSection, o: SvgReliefOptions, rect: Rect): Manifold | null {
  if (region.isEmpty() || o.height === 0) return null;
  const CS = wasm.CrossSection;
  const one = new CS(o.contours, 'EvenOdd');
  const copies = svgTileCenters(rect, o).map(([x, y]) => one.translate([x, y]));
  one.delete();
  // Le copie sono disgiunte (il passo è maggiore dell'ingombro): si compongono senza booleane. Se si toccassero servirebbe l'unione.
  const all = CS.compose(copies);
  copies.forEach((c) => c.delete());
  const inside = all.intersect(region);
  all.delete();
  if (inside.isEmpty()) {
    inside.delete();
    return null;
  }
  // Rilievo: da -EMBED a +height. Incavo: da -|height| a +ABOVE (oltre la faccia)
  const solid = o.height > 0 ? prism(wasm, inside, -EMBED, o.height) : prism(wasm, inside, o.height, ABOVE);
  inside.delete();
  return solid;
}

/**
 * Differenza tra il volume dell'unione del solido con se stesso e il suo volume: nulla se la superficie è valida, negativa se
 * si sovrappone (l'integrale con segno conta due volte la zona doppia, la booleana una). `status()` non lo vede. Il rumore
 * numerico delle coordinate a 32 bit arriva a circa 0,05 mm³: sotto 0,1 mm³ si considera zero.
 */
export function selfOverlapVolume(solid: Manifold): number {
  const union = solid.add(solid);
  const delta = union.volume() - solid.volume();
  union.delete();
  return delta;
}
