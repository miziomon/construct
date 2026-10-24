import { apply, eulerToMatrix, matrixToEuler, round, transpose } from './math';
import type { Mat3, Transform } from './math';
import { rotationToDown } from './layFlat';
import { BRICK_DESIGNS, HAMMERED_DESIGNS, STUD_SHAPES, WOOD_DESIGNS, brickModule, fitBrick, gridNodeCount, hammerCapped, MAX_GRID_NODES, normalizeRelief, reliefDefaults, scaleSize, studCentersFor, studInnerRect } from './relief';
import type { BrickParams, HammeredParams, ReliefDesign, ReliefParams, StudParams, WoodParams } from './relief';
import { normalizeTexture } from './textureMap';
import type { TextureParams } from './textureMap';
import { SAMPLE_KINDS, SAMPLE_VARIANTS } from './textureSamples';
import type { SampleKind } from './textureSamples';
import { imageOf, pixelSize } from './textureImage';
import type { ImageLookup } from './textureImage';
import { PATTERN_ALGORITHM, randomVoronoi } from './voronoi';
import type { Rect, Vec2 } from './voronoi';
import type { PatternFace, PatternParams, Vec3 } from './types';

/**
 * Applica pattern: calcoli puri condivisi da kernel, generatore OpenSCAD, pannello e test. Un pattern è un disegno 2D di
 * celle (Voronoi casuale con seme, esagoni, cerchi, rombi o triangoli) calcolato nel riferimento di una faccia del pezzo e
 * tagliato verso l'interno; con più facce ognuna ha il suo disegno.
 */

/** Celle massime per il Voronoi 2D e per le griglie (oltre il disegno non serve e il calcolo rallenta). */
export const PATTERN_MAX_CELLS = 500;

/** Direzione di una faccia dell'ingombro: asse e verso della normale uscente. */
export type FaceDirection = 'z+' | 'z-' | 'x+' | 'x-' | 'y+' | 'y-';

export const FACE_DIRECTIONS: FaceDirection[] = ['z+', 'z-', 'x+', 'x-', 'y+', 'y-'];

type Bounds = { min: Vec3; max: Vec3 };

const sizeOf = (b: Bounds): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];

/** La faccia dell'ingombro nella direzione data (al centro di quel lato), con lo spessore lungo l'asse. */
export function faceFromBounds(bounds: Bounds, direction: FaceDirection): PatternFace {
  const axis = 'xyz'.indexOf(direction[0]);
  const positive = direction[1] === '+';
  const origin: Vec3 = [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2) as Vec3;
  origin[axis] = positive ? bounds.max[axis] : bounds.min[axis];
  const normal: Vec3 = [0, 0, 0];
  normal[axis] = positive ? 1 : -1;
  return { origin: origin.map((v) => round(v, 3)) as Vec3, normal, thickness: round(sizeOf(bounds)[axis], 3) };
}

/** Vero per i Pattern in rilievo (gruppo «Rilievo» della tendina): una texture sulla faccia invece di celle forate. */
export const isReliefKind = (kind: PatternParams['kind']) => kind === 'brick' || kind === 'studs' || kind === 'hammered' || kind === 'wood' || kind === 'texture';

/** Vero per i rilievi additivi (borchie): il solido cresce sulla normale della faccia invece di essere scavato. */
export const isAdditiveKind = (kind: PatternParams['kind']) => kind === 'studs';

/** Versione corrente del rumore e delle liste dei rilievi (`PatternParams.reliefAlgorithm`). */
export const RELIEF_ALGORITHM = 1;

/** Sotto questa fuga (circa due passate di un ugello da 0,4 mm) la fuga si chiude in stampa. */
export const MIN_PRINTABLE_MORTAR = 0.8;

/** Borchie: spazio minimo tra due basi, raggio minimo e altezza minima (due strati da 0,2 mm) per una stampa FDM affidabile. */
export const MIN_STUD_GAP = 0.8;
export const MIN_STUD_RADIUS = 1;
export const MIN_STUD_HEIGHT = 0.4;

/** I disegni ammessi di ogni rilievo: il primo è quello di partenza. */
const DESIGNS: Record<'brick' | 'studs' | 'hammered' | 'wood', ReliefDesign[]> = { brick: BRICK_DESIGNS, studs: STUD_SHAPES, hammered: HAMMERED_DESIGNS, wood: WOOD_DESIGNS };

/**
 * Disegno e parametri del rilievo (Mattoni o Borchie), entro i limiti e con i valori di partenza per ciò che manca (progetti
 * nuovi e vecchi). Il disegno sta solo in `p.design`: qui viene copiato nei parametri (`design` dei Mattoni, `shape` delle
 * Borchie) perché kernel e codice OpenSCAD li leggono da lì, ma non si salva. Nessun limite sulla profondità (vedi `brickRelief`).
 */
function reliefBase(p: PatternParams): { design: ReliefDesign; relief: BrickParams | StudParams | HammeredParams | WoodParams } {
  const kind = isReliefKind(p.kind) ? (p.kind as 'brick' | 'studs' | 'hammered' | 'wood') : 'brick';
  const designs = DESIGNS[kind];
  const design = designs.includes(p.design as ReliefDesign) ? (p.design as ReliefDesign) : designs[0];
  const own = p.relief?.kind === kind ? p.relief : {};
  const relief = normalizeRelief({ ...reliefDefaults(kind), ...own, kind, [kind === 'studs' ? 'shape' : 'design']: design } as ReliefParams) as BrickParams | StudParams | HammeredParams | WoodParams;
  return { design, relief };
}

/** I parametri del rilievo come si salvano in `PatternParams.relief`: normalizzati, senza il disegno e senza limiti di spessore. */
export function reliefToStore(p: PatternParams): ReliefParams {
  const { design: _design, shape: _shape, ...stored } = reliefBase(p).relief as unknown as Record<string, unknown>;
  return stored as unknown as ReliefParams;
}

/** Materiale che una fuga lascia comunque sotto di sé (mm): con la profondità uguale allo spessore i mattoni si staccherebbero. */
const RELIEF_FLOOR = 0.2;

/**
 * Profondità massima delle fughe (mm): lo spessore del pezzo lungo la normale della faccia (l'ingombro, `thicknessAlong`: non
 * la parete vera di un pezzo cavo o di un Guscio), meno `RELIEF_FLOOR`. Se tra le facce ce n'è una opposta (z+ e z- insieme)
 * lo spessore si divide a metà, così le due incisioni non si attraversano. Infinito senza facce.
 */
export function reliefDepthLimit(p: PatternParams): number {
  const thickness = reliefThickness(p);
  return Number.isFinite(thickness) ? Math.max(0.05, thickness - RELIEF_FLOOR) : Infinity;
}

/**
 * Spessore (mm) di cui dispone il rilievo di una faccia: lo spessore dell'ingombro lungo la normale (come in `reliefDepthLimit`),
 * dimezzato se c'è una faccia opposta; il minimo tra le facce. Infinito senza facce.
 */
export function reliefThickness(p: PatternParams): number {
  const faces = (p.faces?.length ? p.faces : p.face ? [p.face] : []).map(normalizeFace);
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const limits = faces.map((f) => f.thickness / (faces.some((o) => o !== f && dot(o.normal, f.normal) < -0.999) ? 2 : 1));
  return limits.length ? Math.min(...limits) : Infinity;
}

/**
 * Quota più bassa (z della faccia, negativa) che il solido della texture può toccare: 0,02 mm sopra il fondo del pezzo. Nel modo
 * «entrambi» il piano di base della pelle sta sotto l'incavo più profondo e non deve uscire dalla faccia opposta, nemmeno su un
 * pannello sottile (`faceSurface` lo limita qui).
 */
export const textureFloor = (p: PatternParams): number => 0.02 - reliefThickness(p);

/** Rilievo Mattoni per kernel, codice e pannello: parametri normalizzati e profondità limitata allo spessore (`reliefDepthLimit`). */
export function brickRelief(p: PatternParams): { design: ReliefDesign; relief: BrickParams & { kind: 'brick' } } {
  const { design, relief } = reliefBase({ ...p, kind: 'brick' });
  return { design, relief: { ...(relief as BrickParams), kind: 'brick', depth: Math.min(Math.max(0.05, (relief as BrickParams).depth), reliefDepthLimit(p)) } };
}

/** Rilievo Borchie per kernel, codice e pannello: parametri normalizzati (le borchie non hanno profondità da limitare). */
export function studRelief(p: PatternParams): { design: ReliefDesign; relief: StudParams } {
  const { design, relief } = reliefBase({ ...p, kind: 'studs' });
  return { design, relief: relief as StudParams };
}

/**
 * Profondità massima (mm) del parametro `depth` del Rame battuto: ogni cella scende fino a `depth` · (1 + `jitter`), quindi il
 * limite dello spessore (`reliefDepthLimit`) si divide per 1 + `jitter`, altrimenti le calotte più profonde lo supererebbero.
 */
export const hammeredDepthLimit = (p: PatternParams, jitter: number): number => reliefDepthLimit(p) / (1 + jitter);

/**
 * Profondità massima (mm) della venatura del Legno: doghe e listelli arrivano a `grainDepth`, la tavola unica ha i nodi che
 * scendono fino a 2 volte la venatura (`woodMaxDepth`), quindi il limite dello spessore si dimezza.
 */
export const woodGrainLimit = (p: PatternParams, design: ReliefDesign): number => reliefDepthLimit(p) / (design === 'single' ? 2 : 1);

/** Rilievo Rame battuto: parametri normalizzati e profondità delle calotte limitata (`hammeredDepthLimit`: vale anche con la variazione massima). */
export function hammeredRelief(p: PatternParams): { design: ReliefDesign; relief: HammeredParams & { kind: 'hammered' } } {
  const { design, relief } = reliefBase({ ...p, kind: 'hammered' });
  const r = relief as HammeredParams;
  return { design, relief: { ...r, kind: 'hammered', depth: Math.min(Math.max(0.05, r.depth), hammeredDepthLimit(p, r.jitter)) } };
}

/** Rilievo Legno: parametri normalizzati, fughe limitate allo spessore (`reliefDepthLimit`) e venatura limitata come `woodGrainLimit`. */
export function woodRelief(p: PatternParams): { design: ReliefDesign; relief: WoodParams & { kind: 'wood' } } {
  const { design, relief } = reliefBase({ ...p, kind: 'wood' });
  const r = relief as WoodParams;
  const limit = reliefDepthLimit(p);
  return { design, relief: { ...r, kind: 'wood', gapDepth: Math.min(Math.max(0.05, r.gapDepth), limit), grainDepth: Math.min(r.grainDepth, woodGrainLimit(p, design)) } };
}

/**
 * Il rilievo del Pattern (Mattoni, Borchie, Rame battuto o Legno) con i parametri effettivi. Rame e Legno hanno un seme: per la
 * faccia `faceIndex` vale il seme più l'indice (la prima faccia usa il seme così com'è), come il Voronoi.
 */
export function patternRelief(p: PatternParams, faceIndex = 0): { design: ReliefDesign; relief: BrickParams | StudParams | HammeredParams | WoodParams } {
  if (p.kind === 'studs') return studRelief(p);
  // L'Immagine non ha un rilievo parametrico (usa `textureOf`): per chi lo chiede comunque, quello dei Mattoni di partenza
  if (p.kind === 'brick' || p.kind === 'texture') return brickRelief(p);
  const found = p.kind === 'hammered' ? hammeredRelief(p) : woodRelief(p);
  return { design: found.design, relief: { ...found.relief, seed: found.relief.seed + faceIndex } };
}

/**
 * Centri delle borchie di una faccia: la griglia centrata nel rettangolo esatto della faccia (senza il margine di 1 mm di
 * `frameRect`) ridotto del margine, con le borchie intere dentro. Restituisce anche quel rettangolo ridotto (`rect`): è quello
 * da cui nasce la griglia, quindi anche il passo effettivo (che si allarga oltre un tetto di borchie) si deve leggere lì.
 * Calcolo puro: il kernel e il codice OpenSCAD usano la stessa lista e ritagliano poi sul contorno vero della faccia.
 */
export function studCentersOf(p: PatternParams, face: PatternFace) {
  const relief = studRelief(p).relief;
  const rect = studInnerRect(frameRect(p, face, 0), p.margin);
  return { rect, centers: studCentersFor(frameRect(p, face, 0), relief, p.margin) };
}

/** Quanto il piede di una borchia entra nel pezzo (mm) e dove si ferma al massimo: metà dello spessore dell'ingombro. */
export const STUD_EMBED = 0.2;

/** Piede della borchia su una faccia: `STUD_EMBED`, ma non più di metà dello spessore (sotto 0,2 mm uscirebbe dalla faccia opposta). */
export const studEmbedOf = (face: PatternFace) => Math.min(STUD_EMBED, face.thickness / 2);

/** Oltre questi nodi la mappa di altezze (passo 0,5 mm) rende pesante il codice OpenSCAD: il pannello avvisa (il tetto è `MAX_GRID_NODES`). */
export const GRID_WARN_NODES = 200_000;

/** Circa quanti byte occupa un nodo della mappa nel codice OpenSCAD (quota in centesimi di mm, tre cifre e la virgola): 780 KB per 250.000 nodi. */
const SCAD_BYTES_PER_NODE = 3.1;

/** Numero con il punto delle migliaia (250.000), per i testi. */
const thousands = (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Avviso sulla mappa di altezze di una faccia grande (`nodes` al passo del risultato): il codice OpenSCAD arriva a centinaia di KB,
 * e oltre `MAX_GRID_NODES` il passo si allarga. Vuoto sotto `GRID_WARN_NODES`.
 */
export function gridWarning(nodes: number): string[] {
  if (nodes <= GRID_WARN_NODES) return [];
  return [`Mappa di altezze di circa ${thousands(nodes)} nodi: il codice OpenSCAD pesa circa ${thousands((nodes * SCAD_BYTES_PER_NODE) / 1024)} KB (oltre ${thousands(MAX_GRID_NODES)} nodi il passo si allarga).`];
}

/**
 * Cosa scrivere nel Pattern scegliendo una texture di esempio: l'esempio, la sua PRIMA variante in modo esplicito (non «assente»: nel
 * dato salvato, nella chiave di cache e nell'interfaccia la variante predefinita è sempre scritta) e nessuna immagine caricata.
 */
export const samplePatch = (sample: SampleKind): Pick<PatternParams, 'sample' | 'sampleDesign' | 'imageId'> => ({ sample, sampleDesign: SAMPLE_VARIANTS[sample][0], imageId: undefined });

/**
 * Campi salvati del Pattern «Immagine»: `imageId` (se c'è), la texture di esempio e la sua variante (di partenza 'knurl' e la prima),
 * i parametri della texture normalizzati (modo di partenza incavo) e la versione della formula del grigio. Non c'è `design`.
 */
function textureFields(p: PatternParams): Partial<PatternParams> {
  const imageId = typeof p.imageId === 'string' && p.imageId ? p.imageId : undefined;
  // I mattoni di una versione precedente della libreria si leggono come pietra; un esempio sconosciuto torna a knurl
  const sample: SampleKind = (p.sample as string) === 'bricks' ? 'stone' : SAMPLE_KINDS.includes(p.sample as never) ? (p.sample as SampleKind) : 'knurl';
  return {
    // Senza immagine (anche una stringa vuota) vale la texture di esempio
    imageId,
    sample,
    sampleDesign: SAMPLE_VARIANTS[sample].includes(p.sampleDesign ?? '') ? p.sampleDesign : SAMPLE_VARIANTS[sample][0],
    texture: normalizeTexture({ mode: 'groove', ...p.texture }),
    textureAlgorithm: p.textureAlgorithm ?? 1,
  };
}

/**
 * Ampiezza massima (mm) della texture di un Pattern «Immagine» perché la parte sotto la faccia non superi il limite di profondità
 * (`reliefDepthLimit`): l'incavo scende fino a `amplitude`, «entrambi» fino a `amplitude` · livello medio e in più il kernel
 * toglie la colonna fino a 0,4 mm sotto l'incavo più profondo e mette il piano della pelle un piede più in basso (`faceSurface`),
 * quindi il limite per «entrambi» è 0,4 mm più stretto; il rilievo non scende (nessun limite, 20 mm come massimo di `normalizeTexture`).
 */
export function textureAmplitudeLimit(p: PatternParams, texture: Pick<TextureParams, 'mode' | 'midlevel'>): number {
  const down = texture.mode === 'groove' ? 1 : texture.mode === 'both' ? texture.midlevel : 0;
  if (!(down > 0)) return 20;
  const limit = texture.mode === 'both' ? Math.max(0.05, reliefDepthLimit(p) - 0.4) : reliefDepthLimit(p);
  return limit / down;
}

/**
 * Parametri effettivi della texture di un Pattern «Immagine»: quelli salvati, con l'ampiezza limitata (`textureAmplitudeLimit`).
 * Il valore salvato non si riduce.
 */
export function textureOf(p: PatternParams): TextureParams {
  const t = normalizeTexture({ mode: 'groove', ...p.texture });
  return { ...t, amplitude: Math.min(t.amplitude, textureAmplitudeLimit(p, t)) };
}

/** Misura in mm per i testi (una cifra decimale, virgola). */
const mm = (v: number) => String(round(v, 1)).replace('.', ',');

/**
 * Avvisi del rilievo (testi per il pannello); vuoto per i Pattern a celle. Mattoni: fuga troppo stretta, profondità ridotta
 * allo spessore dell'ingombro, mattone arrotondato dal disegno (spina di pesce e cesto) o ingrandito dal tetto di mattoni della
 * faccia. Borchie: troppo vicine tra loro o troppo piccole per la stampa.
 */
export function reliefWarnings(p: PatternParams, lookup?: ImageLookup): string[] {
  if (!isReliefKind(p.kind)) return [];
  const q = normalizePattern(p);
  const out: string[] = [];
  if (q.kind === 'texture') {
    const stored = q.texture as TextureParams;
    const texture = textureOf(q);
    const image = imageOf(q, lookup);
    if (!image) {
      // Solo con una funzione di ricerca: senza, il chiamante non sa dire se l'immagine c'è
      if (lookup) out.push('Immagine non disponibile: caricala di nuovo, finché manca il Pattern non ha effetto.');
    } else if (pixelSize(texture.tile, image) > 0.3) {
      out.push(`I pixel dell'immagine misurano ${mm(pixelSize(texture.tile, image))} mm sulla faccia: l'aspetto sarà a gradini. Riduci la piastrella o aumenta la sfocatura.`);
    }
    if (stored.mode !== 'relief' && stored.amplitude > texture.amplitude + 1e-9) out.push(`Profondità ridotta a ${mm(texture.amplitude)} mm (sull'ingombro del pezzo): l'incavo non deve attraversare il pezzo.`);
    if (texture.amplitude > 0 && texture.amplitude < 0.2) out.push(`Ampiezza sotto ${mm(0.2)} mm, lo spessore di uno strato: la texture non si vede in stampa.`);
    out.push(...gridWarning(q.faces.reduce((sum, face) => sum + gridNodeCount(frameRect(q, face), 0.5), 0)));
    return out;
  }
  if (q.kind === 'studs') {
    const { relief } = studRelief(q);
    if (relief.pitch < 2 * relief.radius + MIN_STUD_GAP) out.push(`Borchie troppo vicine: tra una base e l'altra servono almeno ${mm(MIN_STUD_GAP)} mm (passo di almeno ${mm(2 * relief.radius + MIN_STUD_GAP)} mm).`);
    if (relief.shape === 'dome' && relief.height > relief.radius + 1e-9) out.push(`Altezza della cupola ridotta al raggio (${mm(relief.radius)} mm): più alta avrebbe un sottosquadro.`);
    if (q.faces.every((face) => studCentersOf(q, face).centers.length === 0)) out.push('Nessuna borchia: la faccia, o la faccia meno il margine, è più stretta del diametro di una borchia.');
    if (relief.radius < MIN_STUD_RADIUS || relief.height < MIN_STUD_HEIGHT) out.push(`Borchie troppo piccole per la stampa: servono un raggio di almeno ${mm(MIN_STUD_RADIUS)} mm e un'altezza di almeno ${mm(MIN_STUD_HEIGHT)} mm.`);
    return out;
  }
  if (q.kind === 'hammered') {
    const { relief } = hammeredRelief(q);
    const requested = (q.relief as HammeredParams).depth;
    if (requested > relief.depth + 1e-9) out.push(`Profondità ridotta a ${mm(relief.depth)} mm (sull'ingombro del pezzo): le martellate non devono attraversare il pezzo.`);
    // Troppe celle sulla faccia più grande: il tetto di martellate le allarga
    const widest = q.faces.map((face) => frameRect(q, face)).sort((a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY))[0];
    if (widest && hammerCapped(widest, relief)) {
      const area = (widest.maxX - widest.minX) * (widest.maxY - widest.minY);
      out.push(`Troppe martellate per la faccia: le celle salgono a circa ${mm(relief.design === 'scales' ? scaleSize(widest, relief.size) : Math.sqrt(area / (0.785 * 500)))} mm.`);
    }
    return out;
  }
  if (q.kind === 'wood') {
    const { design, relief } = woodRelief(q);
    const stored = q.relief as WoodParams;
    if (design !== 'single' && relief.gap < MIN_PRINTABLE_MORTAR) out.push(`Fuga sotto ${mm(MIN_PRINTABLE_MORTAR)} mm: tende a chiudersi in stampa.`);
    if ((design !== 'single' && stored.gapDepth > relief.gapDepth + 1e-9) || stored.grainDepth > relief.grainDepth + 1e-9) out.push(`Profondità ridotta a ${mm(Math.max(relief.gapDepth, relief.grainDepth))} mm (sull'ingombro del pezzo): fughe e venatura non devono attraversare il pezzo.`);
    if (design === 'parquet') {
      // Come per la spina di pesce dei mattoni: la lunghezza è un multiplo del passo corto (larghezza più fuga)
      const u = relief.plankW + relief.gap;
      const length = Math.max(2, Math.round((relief.plankL + relief.gap) / u)) * u - relief.gap;
      if (Math.abs(length - relief.plankL) > 0.05) out.push(`Il listello misura ${mm(length)} × ${mm(relief.plankW)} mm: la lunghezza si arrotonda a un multiplo della larghezza (fuga compresa).`);
    }
    // La venatura è una mappa di altezze a 0,5 mm: su una faccia grande il codice OpenSCAD diventa enorme
    if (relief.grainDepth > 0) out.push(...gridWarning(q.faces.reduce((sum, face) => sum + gridNodeCount(frameRect(q, face), 0.5), 0)));
    return out;
  }
  const { design, relief } = brickRelief(q);
  if (relief.mortar < MIN_PRINTABLE_MORTAR) out.push(`Fuga sotto ${mm(MIN_PRINTABLE_MORTAR)} mm: tende a chiudersi in stampa.`);
  // Profondità salvata (senza limite) contro quella effettiva: oltre lo spessore dell'ingombro la fuga attraverserebbe il pezzo
  const requested = (q.relief as BrickParams).depth;
  if (requested > relief.depth + 1e-9) out.push(`Profondità ridotta a ${mm(relief.depth)} mm (sull'ingombro del pezzo): le fughe non devono attraversare il pezzo.`);
  // Misure effettive sulla faccia più grande: il tetto di mattoni le ingrandisce, il disegno arrotonda la lunghezza
  const fitted = q.faces.map((face) => fitBrick(frameRect(q, face), relief)).sort((a, b) => b.brickW * b.brickH - a.brickW * a.brickH)[0];
  if (fitted && (fitted.brickW > relief.brickW + 1e-6 || fitted.brickH > relief.brickH + 1e-6)) {
    out.push(`Troppi mattoni per la faccia: le misure salgono a ${mm(fitted.brickW)} × ${mm(fitted.brickH)} mm.`);
  }
  if (fitted && design !== 'running') {
    const { u, n } = brickModule(fitted);
    const length = n * u - fitted.mortar;
    if (Math.abs(length - fitted.brickW) > 0.05) out.push(`Il mattone misura ${mm(length)} × ${mm(fitted.brickH)} mm: la lunghezza si arrotonda a un multiplo dell'altezza (fuga compresa).`);
  }
  return out;
}

/** Quanto una normale può scostarsi da un asse per contare come allineata (cos ≈ 1,8°, come per la faccia aperta del Guscio). */
const AXIS_ALIGNED = 0.9995;

/** Vero se la normale della faccia è parallela a un asse del pezzo (cima, fondo o uno dei lati); falso per le facce inclinate. */
export function isAxisFace(face: PatternFace): boolean {
  const length = Math.hypot(...face.normal);
  return length > 0 && Math.max(...face.normal.map(Math.abs)) / length >= AXIS_ALIGNED;
}

/** Nome della faccia per i pannelli: l'asse con il verso (+Z, −X...) oppure l'inclinazione rispetto a +Z. */
export function faceName(face: PatternFace): string {
  const length = Math.hypot(...face.normal) || 1;
  if (isAxisFace(face)) {
    const axis = face.normal.reduce((best, v, i) => (Math.abs(v) > Math.abs(face.normal[best]) ? i : best), 0);
    return `${face.normal[axis] < 0 ? '−' : '+'}${'XYZ'[axis]}`;
  }
  return `inclinata (${Math.round((Math.acos(Math.min(1, Math.max(-1, face.normal[2] / length))) * 180) / Math.PI)}° da +Z)`;
}

/** Lo spessore del pezzo lungo la normale di una faccia: la differenza tra gli estremi dell'ingombro proiettati sulla normale. */
export function thicknessAlong(bounds: Bounds, normal: Vec3): number {
  const projections = [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => normal[0] * bounds[a ? 'max' : 'min'][0] + normal[1] * bounds[b ? 'max' : 'min'][1] + normal[2] * bounds[c ? 'max' : 'min'][2])));
  return Math.max(...projections) - Math.min(...projections);
}

/** Riferimento di una faccia: la rotazione che porta la normale su +Z e il punto del piano che diventa l'origine. */
export interface FaceFrame {
  /** Rotazione Q: `x' = Q·(x − origin)`; il pezzo sta sotto il piano (z' ≤ 0). */
  matrix: Mat3;
  /** Angoli X, Y, Z di Q (gradi) e della sua inversa, per `rotate()` del kernel e di OpenSCAD. */
  euler: Vec3;
  inverseEuler: Vec3;
  origin: Vec3;
}

export function faceFrame(face: PatternFace): FaceFrame {
  const n = face.normal;
  // rotationToDown porta una normale su -Z: con la normale opposta si porta la faccia su +Z
  const matrix = rotationToDown([-n[0], -n[1], -n[2]]);
  const round4 = (v: Vec3) => v.map((x) => round(x, 4)) as Vec3;
  return { matrix, euler: round4(matrixToEuler(matrix)), inverseEuler: round4(matrixToEuler(transpose(matrix))), origin: face.origin };
}

/** Rettangolo (nel riferimento della faccia) che contiene tutto l'ingombro del pezzo: dove si generano le celle. */
export function frameRect(p: PatternParams, face: PatternFace = p.faces[0], pad = 1): Rect {
  const frame = faceFrame(face);
  const corners = [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => [p.bounds[a ? 'max' : 'min'][0], p.bounds[b ? 'max' : 'min'][1], p.bounds[c ? 'max' : 'min'][2]] as Vec3)));
  // Si usa la stessa rotazione (con i soli angoli arrotondati) del kernel, così le celle coprono la stessa area
  const turned = corners.map((c) => apply(frame.matrix, [c[0] - frame.origin[0], c[1] - frame.origin[1], c[2] - frame.origin[2]]));
  const xs = turned.map((t) => t[0]);
  const ys = turned.map((t) => t[1]);
  return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
}

/** Lunghezza del prisma di un taglio passante: molto più del pezzo, per bucarlo comunque lo si orienti. */
export function cutReach(p: PatternParams, face: PatternFace = p.faces[0]): number {
  return 2 * (Math.hypot(p.bounds.max[0] - p.bounds.min[0], p.bounds.max[1] - p.bounds.min[1], p.bounds.max[2] - p.bounds.min[2]) + face.thickness) + 20;
}

/** Parametri di partenza per un pezzo con questo ingombro: Voronoi di celle da circa 15 mm, passante, dal lato di +Z. */
export function defaultPatternParams(bounds: Bounds, seed: number): PatternParams {
  const size = sizeOf(bounds);
  const face = faceFromBounds(bounds, 'z+');
  const area = size[0] * size[1];
  const smallest = Math.min(size[0], size[1]);
  return {
    algorithm: PATTERN_ALGORITHM,
    kind: 'voronoi',
    mode: 'holes',
    seed,
    cells: Math.min(80, Math.max(8, Math.round(area / 225))),
    regularity: 40,
    size: 12,
    angle: 0,
    wall: 1.6,
    rounding: 1,
    // Cornice piena: circa un decimo del lato minore, tra 2 e 6 mm
    margin: Math.min(6, Math.max(2, round(smallest / 10, 1))),
    faces: [face],
    depth: 0,
    sides: 'one',
    bounds: { min: [...bounds.min], max: [...bounds.max] },
  };
}

/** Faccia con normale unitaria e spessore positivo. */
function normalizeFace(f: PatternFace): PatternFace {
  const n = f.normal;
  const length = Math.hypot(n[0], n[1], n[2]);
  const normal: Vec3 = length > 1e-9 ? [n[0] / length, n[1] / length, n[2] / length] : [0, 0, 1];
  return { origin: f.origin, normal, thickness: Math.max(0.1, Number.isFinite(f.thickness) ? f.thickness : 1) };
}

/** Due facce coincidono se hanno la stessa normale e lo stesso piano. */
export function sameFace(a: PatternFace, b: PatternFace): boolean {
  const na = normalizeFace(a).normal;
  const nb = normalizeFace(b).normal;
  const offset = (f: PatternFace, n: Vec3) => f.origin[0] * n[0] + f.origin[1] * n[1] + f.origin[2] * n[2];
  return [0, 1, 2].every((i) => Math.abs(na[i] - nb[i]) < 1e-3) && Math.abs(offset(a, na) - offset(b, nb)) < 1e-2;
}

/** I campi dei gruppi «rilievo» e «immagine» del Pattern: `normalizePattern` tiene solo quelli del tipo scelto. */
const GROUP_KEYS = ['design', 'relief', 'reliefAlgorithm', 'imageId', 'sample', 'sampleDesign', 'texture', 'textureAlgorithm'] as const;

/**
 * Come `normalizePattern`, ma conserva i campi dei gruppi che quel tipo non usa (il disegno e le misure del rilievo, l'immagine
 * caricata e la sua texture), da `raw`: passando a un tipo a celle e tornando non si perdono. Per lo stato di uno strumento che si
 * modifica a ogni passo; il Pattern salvato, la chiave di cache e il kernel usano `normalizePattern`, che li toglie.
 */
export function normalizeKeepingGroups(raw: PatternParams): PatternParams {
  const normalized = normalizePattern(raw);
  const kept: Record<string, unknown> = {};
  for (const key of GROUP_KEYS) if (normalized[key] === undefined && raw[key] !== undefined) kept[key] = raw[key];
  return { ...normalized, ...kept };
}

/**
 * Parametri entro i limiti: conteggi interi e massimi, misure positive, facce con normale unitaria (senza doppioni).
 * Converte anche i progetti della 0.20.0: la `face` unica diventa `faces` e il reticolo 3D (tolto) diventa Voronoi.
 */
export function normalizePattern(p: PatternParams): PatternParams {
  const num = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  const int = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(num(v, min))));
  // I campi dei rilievi (disegno, misure, versione) e dell'Immagine (immagine, esempio, texture, versione) si tolgono tutti e si
  // riscrivono sotto solo per il tipo scelto: cambiando tipo non restano quelli dell'altro gruppo (e la chiave di cache non li vede)
  const { face: legacy, design: _design, relief: _relief, reliefAlgorithm: _reliefAlgorithm, imageId: _imageId, sample: _sample, sampleDesign: _sampleDesign, texture: _texture, textureAlgorithm: _textureAlgorithm, ...rest } = p;
  const given = p.faces?.length ? p.faces : legacy ? [legacy] : [faceFromBounds(p.bounds, 'z+')];
  const faces = given.map(normalizeFace).filter((f, i, all) => all.findIndex((o) => sameFace(o, f)) === i);
  const kind = (['voronoi', 'hexagon', 'circle', 'diamond', 'triangle', 'brick', 'studs', 'hammered', 'wood', 'texture'] as string[]).includes(p.kind) ? p.kind : 'voronoi';
  // Disegno e misure dei rilievi: solo per i Pattern in rilievo, così gli altri progetti restano identici a prima
  // Il disegno si salva solo in `design` (non dentro `relief`) e la profondità senza il limite dello spessore (si applica in
  // `brickRelief`, così aggiungere e togliere una faccia opposta non cambia il valore salvato); la versione del rilievo già
  // salvata non si sovrascrive
  const reliefFields = kind === 'texture' ? textureFields(p) : isReliefKind(kind) ? { design: reliefBase({ ...p, kind }).design, relief: reliefToStore({ ...p, kind, faces }), reliefAlgorithm: p.reliefAlgorithm ?? (RELIEF_ALGORITHM as 1) } : {};
  return {
    ...rest,
    kind,
    ...reliefFields,
    seed: int(p.seed, 0, 2 ** 31),
    cells: int(p.cells, 3, PATTERN_MAX_CELLS),
    regularity: Math.min(100, Math.max(0, num(p.regularity, 0))),
    size: Math.max(2, num(p.size, 12)),
    angle: num(p.angle, 0),
    wall: Math.max(0.1, num(p.wall, 1.6)),
    rounding: Math.max(0, num(p.rounding, 0)),
    margin: Math.max(0, num(p.margin, 0)),
    depth: Math.max(0, num(p.depth, 0)),
    // Senza region (progetti salvati prima) l'ombra del pezzo, come allora
    region: p.region === 'face' ? 'face' : 'silhouette',
    faces,
  };
}

/**
 * Vero se tra le facce piane `faces` (di una mesh in coordinate mondo, vedi `faceMap`) ce n'è una sul piano e con la
 * normale di `face`, che è nel sistema del gruppo con trasformazione `world`, e nessun altro piano rivolto allo stesso
 * modo a un'altra quota: allora il Pattern può usare il contorno di quella faccia ('face'), altrimenti serve l'ombra del
 * pezzo ('silhouette': sfera, cilindro sdraiato, pezzi con gradini o rilievi).
 */
export function hasPlanarFace(faces: { normal: Vec3; offset: number; planar: boolean }[], face: PatternFace, world: Transform): boolean {
  // 1) La faccia dal sistema del gruppo al mondo: mondo = R · D · v (+ posizione per un punto), con D lo specchio del gruppo
  const toWorld = (v: Vec3, isPoint: boolean): Vec3 => {
    const mirrored = v.map((x, axis) => (world.mirror?.[axis] ? -x : x)) as Vec3;
    const rotated = apply(eulerToMatrix(world.rotation), mirrored);
    return isPoint ? (rotated.map((x, i) => x + world.position[i]) as Vec3) : rotated;
  };
  const n = normalizeFace(face).normal;
  const normal = toWorld(n, false);
  const point = toWorld(face.origin, true);
  const planeOffset = normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2];
  const facing = (f: { normal: Vec3 }) => f.normal[0] * normal[0] + f.normal[1] * normal[1] + f.normal[2] * normal[2];
  // 2) Una faccia piana con la stessa normale (circa 1,8°) e lo stesso piano (0,05 mm, come la tolleranza di planarità)
  if (!faces.some((f) => f.planar && facing(f) >= AXIS_ALIGNED && Math.abs(f.offset - planeOffset) < 0.05)) return false;
  // 3) E nessun altro piano rivolto allo stesso modo (normale quasi identica, così i triangoli di un raccordo suddiviso non
  // contano) a un'altra quota: con gradini, rilievi o bordi rialzati la faccia più alta non è tutto il pezzo e serve l'ombra
  return !faces.some((f) => facing(f) >= 1 - 1e-6 && Math.abs(f.offset - planeOffset) >= 0.05);
}

/** Numero massimo di celle a griglia: il passo si allarga se servirebbero di più. */
const MAX_GRID_CELLS = 1500;

/**
 * Celle di una griglia (esagoni, cerchi, rombi o triangoli) con il passo dato, ruotata di `angle` attorno al centro del
 * rettangolo, tenendo solo le celle che toccano il rettangolo. Le celle adiacenti si toccano: l'esagono ha lo spigolo
 * piatto a `pitch / 2` dal centro, il cerchio ha raggio `pitch / 2`, il rombo ha le diagonali lunghe `pitch`, il triangolo
 * equilatero ha il lato lungo `pitch` (punta su e punta giù alternati).
 */
function gridCells(p: PatternParams, rect: Rect): Vec2[][] {
  const width = rect.maxX - rect.minX;
  const height = rect.maxY - rect.minY;
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  const half = Math.hypot(width, height) / 2;
  // Area di una cella in unità di pitch², per non superare MAX_GRID_CELLS
  const unitArea = p.kind === 'hexagon' ? Math.sqrt(3) / 2 : p.kind === 'circle' ? Math.sqrt(3) / 2 : p.kind === 'diamond' ? 0.5 : Math.sqrt(3) / 4;
  const pitch = Math.max(p.size, Math.sqrt((width * height * unitArea) / MAX_GRID_CELLS));
  const rad = (p.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const circle: Vec2[] = Array.from({ length: 32 }, (_, k) => [(pitch / 2) * Math.cos((k * 2 * Math.PI) / 32), (pitch / 2) * Math.sin((k * 2 * Math.PI) / 32)]);
  const radius = pitch / Math.sqrt(3);
  const hexagon: Vec2[] = Array.from({ length: 6 }, (_, k) => [radius * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), radius * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)]);
  const diamond: Vec2[] = [[pitch / 2, 0], [0, pitch / 2], [-pitch / 2, 0], [0, -pitch / 2]];
  // Triangolo con la base su y = 0 e la punta in alto; quello capovolto ha la base in alto
  const h = (pitch * Math.sqrt(3)) / 2;
  const up: Vec2[] = [[-pitch / 2, 0], [pitch / 2, 0], [0, h]];
  const down: Vec2[] = [[-pitch / 2, h], [0, 0], [pitch / 2, h]];

  /** Cella di una riga e di una colonna: posizione del centro (prima della rotazione) e poligono relativo. */
  const cellAt = (row: number, col: number): { x: number; y: number; shape: Vec2[] } => {
    if (p.kind === 'diamond') return { x: (col + (Math.abs(row) % 2) / 2) * pitch, y: (row * pitch) / 2, shape: diamond };
    if (p.kind === 'triangle') {
      const pointsUp = Math.abs(col + row) % 2 === 0;
      return { x: (col * pitch) / 2, y: row * h, shape: pointsUp ? up : down };
    }
    // Esagoni e cerchi: griglia esagonale, file sfalsate di mezzo passo
    return { x: (col + (Math.abs(row) % 2) / 2) * pitch, y: (row * pitch * Math.sqrt(3)) / 2, shape: p.kind === 'hexagon' ? hexagon : circle };
  };
  const rowStep = p.kind === 'diamond' ? pitch / 2 : p.kind === 'triangle' ? h : (pitch * Math.sqrt(3)) / 2;
  const colStep = p.kind === 'triangle' ? pitch / 2 : pitch;
  const cells: Vec2[][] = [];
  const rows = Math.ceil(half / rowStep) + 1;
  const cols = Math.ceil(half / colStep) + 1;
  for (let row = -rows; row <= rows; row++) {
    for (let col = -cols; col <= cols; col++) {
      const { x, y, shape } = cellAt(row, col);
      const center: Vec2 = [cx + x * cos - y * sin, cy + x * sin + y * cos];
      // Si tengono le celle il cui centro dista meno del passo dal rettangolo
      const dx = Math.max(rect.minX - center[0], 0, center[0] - rect.maxX);
      const dy = Math.max(rect.minY - center[1], 0, center[1] - rect.maxY);
      if (Math.hypot(dx, dy) > pitch) continue;
      // La cella ruota con la griglia
      cells.push(shape.map(([sx, sy]) => [round(center[0] + sx * cos - sy * sin, 4), round(center[1] + sx * sin + sy * cos, 4)] as Vec2));
    }
  }
  return cells;
}

/** Le celle del pattern per la faccia `faceIndex` (poligoni nel riferimento della faccia, prima della riduzione per la parete). */
export function patternCells(params: PatternParams, rect: Rect, faceIndex = 0): Vec2[][] {
  const p = normalizePattern(params);
  // I rilievi non hanno celle: il disegno lo calcolano `reliefCutter` e `reliefScad`
  if (isReliefKind(p.kind)) return [];
  // Ogni faccia ha il suo disegno: il seme cambia con l'indice (la prima faccia usa il seme così com'è)
  if (p.kind === 'voronoi') return randomVoronoi(p.cells, rect, p.seed + faceIndex, p.regularity).map((cell) => cell.map(([x, y]) => [round(x, 4), round(y, 4)] as Vec2));
  return gridCells(p, rect);
}
