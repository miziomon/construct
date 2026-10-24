/**
 * SVG come sorgente di una texture (Pattern «Immagine»): si rasterizza nel thread principale a 512 px al massimo (decisione: raster,
 * le sfumature sono ammesse) e poi si segue la strada di PNG e JPG (grigio Rec. 601, trasparenza sul bianco).
 *
 * Sicurezza: l'SVG si disegna caricandolo come `Blob` URL in un `<img>`, che non esegue script e non carica risorse esterne;
 * in più il testo si pulisce prima (`sanitizeSvg`: script, foreignObject, attributi `on...`, riferimenti esterni, `@import`) e le
 * entità (`<!ENTITY`) si rifiutano. Questo modulo è puro (testabile in Node); `rasterizeSvg` è la sola parte che usa il browser.
 */

/** File SVG più grande di così non si apre. */
export const MAX_SVG_BYTES = 2 * 1024 * 1024;
/** Tempo massimo (ms) per disegnare l'SVG in un `<img>`. */
export const SVG_TIMEOUT_MS = 10_000;
/** Lato lungo (pixel) a cui si rasterizza. */
export const SVG_RASTER_SIDE = 512;
/** Proporzioni massime (lato lungo / lato corto): oltre, il lato corto sarebbe meno di un pixel o l'immagine una striscia inutile. */
const MAX_ASPECT = 100;

/**
 * Toglie dall'inizio del testo ciò che può precedere l'elemento radice: BOM, spazi, dichiarazione XML, commenti e DOCTYPE senza
 * sottoinsieme interno. Si ripete finché cambia (ordine qualunque); ogni passo è ancorato all'inizio e senza backtracking pesante.
 */
export function stripPreamble(text: string): string {
  let current = text.replace(/^﻿/, '');
  for (;;) {
    const next = current.replace(/^\s+/, '').replace(/^<\?xml[^>]*\?>/, '').replace(/^<!--[\s\S]*?-->/, '').replace(/^<!DOCTYPE[^>[]*>/i, '');
    if (next === current) return next;
    current = next;
  }
}

/** Vero se il contenuto (non l'estensione) è un documento SVG: dopo BOM, spazi, XML, commenti e DOCTYPE comincia con `<svg`. */
export const looksLikeSvg = (text: string): boolean => /^<svg[\s/>]/.test(stripPreamble(text));

/** Elementi che disegnano qualcosa: senza nessuno l'SVG è vuoto. */
const DRAWING = /<(path|rect|circle|ellipse|line|polyline|polygon|text|image|use)[\s/>]/;

/** Rifiuta l'SVG con entità XML (`<!ENTITY`): si possono espandere a dismisura (miliardi di risate). */
function rejectEntities(text: string): void {
  if (/<!ENTITY/i.test(text)) throw new Error('SVG non supportato: contiene entità XML, che non si possono caricare in sicurezza.');
}

/**
 * Pulisce un SVG: toglie `<script>`, `<foreignObject>`, gli attributi di evento (`onload=...`), gli `href` che non puntano dentro il
 * documento (`#id`) o a un'immagine `data:`, gli `url(...)` esterni degli stili e gli `@import`. Rifiuta l'SVG con entità
 * (`<!ENTITY`, che si possono espandere a dismisura). Restituisce il testo e che cosa ha tolto.
 */
export function sanitizeSvg(text: string): { svg: string; removed: string[] } {
  rejectEntities(text);
  const removed: string[] = [];
  const strip = (pattern: RegExp, label: string, svg: string) => {
    const result = svg.replace(pattern, '');
    if (result !== svg) removed.push(label);
    return result;
  };
  let svg = text;
  svg = strip(/<script\b[\s\S]*?<\/script\s*>/gi, 'script', svg);
  svg = strip(/<script\b[^>]*\/>/gi, 'script', svg);
  svg = strip(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, 'foreignObject', svg);
  svg = strip(/<foreignObject\b[^>]*\/>/gi, 'foreignObject', svg);
  // Attributi di evento: onload, onclick...
  svg = strip(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, 'eventi', svg);
  // Riferimenti: restano solo quelli interni (#id) e le immagini data:
  svg = svg.replace(/\s(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*')/gi, (all, value: string) => {
    const target = value.slice(1, -1).trim();
    if (target.startsWith('#') || /^data:image\/(png|jpeg|gif|webp)[;,]/i.test(target)) return all;
    if (!removed.includes('riferimenti esterni')) removed.push('riferimenti esterni');
    return '';
  });
  svg = strip(/@import[^;]*;/gi, 'riferimenti esterni', svg);
  // url(...) negli stili: solo #id e data:
  svg = svg.replace(/url\(\s*(['"]?)(?!#|data:image\/)[^)]*\)/gi, () => {
    if (!removed.includes('riferimenti esterni')) removed.push('riferimenti esterni');
    return 'none';
  });
  return { svg, removed };
}

/** Lunghezza CSS (numero con unità) in pixel a 96 dpi; null se è una percentuale, manca o non è valida. */
function cssLength(value: string | undefined): number | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(value ?? '');
  if (!m) return null;
  const factor = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[(m[2] ?? 'px').toLowerCase() as 'px'];
  const result = Number(m[1]) * factor;
  return Number.isFinite(result) && result > 0 ? result : null;
}

/** Tag di apertura dell'elemento radice `<svg ...>` (dopo il preambolo) e valore di un suo attributo. */
const rootTag = (text: string): string => /^<svg\b[^>]*>/.exec(stripPreamble(text))?.[0] ?? '';
const attribute = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined);

/**
 * Dimensioni dell'SVG (pixel CSS, per le proporzioni): `width` e `height` se sono lunghezze, altrimenti il `viewBox`; le proporzioni
 * sono quelle del `viewBox` se c'è. Lancia un errore chiaro se non si ricavano.
 */
export function svgDimensions(text: string): { w: number; h: number } {
  const tag = rootTag(text);
  const box = attribute(tag, 'viewBox')?.trim().split(/[\s,]+/).map(Number);
  const viewBox = box && box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? { w: box[2], h: box[3] } : null;
  const width = cssLength(attribute(tag, 'width'));
  const height = cssLength(attribute(tag, 'height'));
  if (viewBox) return { w: width ?? viewBox.w, h: height ?? viewBox.h };
  if (width && height) return { w: width, h: height };
  throw new Error('SVG senza dimensioni: servono un viewBox oppure width e height in unità fisse (non percentuali).');
}

/** Dimensioni (pixel) a cui rasterizzare: lato lungo `SVG_RASTER_SIDE`, proporzioni dell'SVG (anche se piccolo: è vettoriale, si ingrandisce). */
export function svgRasterSize(w: number, h: number): { w: number; h: number } {
  const ratio = Math.max(w, h) / Math.min(w, h);
  if (!(ratio <= MAX_ASPECT)) throw new Error(`SVG troppo allungato (proporzioni oltre ${MAX_ASPECT}:1): non si può usare come texture.`);
  const scale = SVG_RASTER_SIDE / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/**
 * Prepara l'SVG per essere disegnato: pulizia, controlli (non vuoto, ben formato, dimensioni), e la radice riscritta con `width` e
 * `height` della dimensione di rasterizzazione, `viewBox` (se mancava, delle dimensioni originali) e lo spazio dei nomi: un `<img>`
 * disegna l'SVG alla sua dimensione intrinseca, che altrimenti sarebbe quella (arbitraria) dichiarata nel file.
 */
export function prepareSvg(text: string): { svg: string; w: number; h: number; removed: string[] } {
  // Prima delle entità: un DOCTYPE con sottoinsieme interno non si riconoscerebbe come preambolo
  rejectEntities(text);
  const body = stripPreamble(text);
  if (!/^<svg[\s/>]/.test(body)) throw new Error('Il file non è un SVG valido: manca l\'elemento <svg>.');
  const { svg: clean, removed } = sanitizeSvg(body);
  // Ben formato in modo grossolano: l'elemento radice si chiude (o è vuoto e si chiude da sé)
  const tag = rootTag(clean);
  if (!tag || !(tag.endsWith('/>') || /<\/svg\s*>\s*$/.test(clean))) throw new Error('Il file non è un SVG valido: il documento è incompleto.');
  if (tag.endsWith('/>') || !DRAWING.test(clean)) throw new Error('L\'SVG è vuoto: non contiene forme da disegnare.');
  const intrinsic = svgDimensions(clean);
  const { w, h } = svgRasterSize(intrinsic.w, intrinsic.h);
  // Radice riscritta: via width, height e (se c'è già) l'xmlns, poi gli attributi nostri
  const hasViewBox = attribute(tag, 'viewBox') !== undefined;
  const bare = tag.replace(/\s(?:width|height|xmlns)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '').replace(/>$/, '');
  const root = `${bare} xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"${hasViewBox ? '' : ` viewBox="0 0 ${intrinsic.w} ${intrinsic.h}"`}>`;
  return { svg: root + clean.slice(tag.length), w, h, removed };
}

/**
 * Disegna l'SVG preparato su un canvas bianco di `w` × `h` pixel e ne restituisce i pixel RGBA. Browser: `<img>` con un `Blob` URL
 * (nessuno script, nessuna risorsa esterna), con un tempo massimo.
 */
export async function rasterizeSvg(svg: string, w: number, h: number): Promise<{ rgba: Uint8ClampedArray; w: number; h: number }> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`L'SVG è troppo complesso: il disegno ha superato ${SVG_TIMEOUT_MS / 1000} secondi.`)), SVG_TIMEOUT_MS);
      image.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error('SVG non valido: il browser non riesce a disegnarlo.'));
      };
      image.src = url;
    });
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const context = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new Error('Il browser non permette di leggere i pixel dell\'immagine.');
    // Fondo bianco: la trasparenza dell'SVG conta come carta
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, w, h);
    context.drawImage(image, 0, 0, w, h);
    return { rgba: context.getImageData(0, 0, w, h).data, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
