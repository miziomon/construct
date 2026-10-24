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
/**
 * Tempo massimo (ms) per il caricamento dell'SVG in un `<img>` (decodifica del documento). Non copre il `drawImage` che segue: è
 * sincrono e non si può interrompere dal codice, quindi un SVG pesantissimo da disegnare (filtri enormi) può bloccare la pagina; lo
 * limitano la dimensione del file (2 MB) e il disegno a 512 px.
 */
export const SVG_TIMEOUT_MS = 10_000;
/** Lato lungo (pixel) a cui si rasterizza. */
export const SVG_RASTER_SIDE = 512;
/** Proporzioni massime (lato lungo / lato corto): oltre, il lato corto sarebbe meno di un pixel o l'immagine una striscia inutile. */
const MAX_ASPECT = 100;

/**
 * Toglie dall'inizio del testo ciò che può precedere l'elemento radice: BOM, spazi, dichiarazione XML, commenti e DOCTYPE (anche con
 * sottoinsieme interno). Si ripete finché cambia (ordine qualunque); ogni passo è ancorato all'inizio e senza backtracking pesante.
 */
export function stripPreamble(text: string): string {
  return preambleOf(text).body;
}

/** Come `stripPreamble`, e dice se il DOCTYPE aveva un sottoinsieme interno (`[ ... ]`: dichiarazioni di entità, attributi predefiniti). */
function preambleOf(text: string): { body: string; internalSubset: boolean } {
  let internalSubset = false;
  let current = text.replace(/^﻿/, '');
  for (;;) {
    // Il DOCTYPE può avere un sottoinsieme interno tra parentesi quadre (con le entità): si toglie anche quello, così l'SVG si riconosce e
    // poi si rifiuta con il suo messaggio (entità XML) invece di passare per un formato sconosciuto
    let next = current.replace(/^\s+/, '').replace(/^<\?xml[^>]*\?>/, '').replace(/^<!--[\s\S]*?-->/, '');
    // Prima di toglierlo si guarda se il DOCTYPE ha il sottoinsieme interno (`[ ... ]`)
    if (/^<!DOCTYPE[^>[]*\[/i.test(next)) internalSubset = true;
    next = next.replace(/^<!DOCTYPE[^>[]*(?:\[[\s\S]*?\]\s*)?>/i, '');
    if (next === current) return { body: next, internalSubset };
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
 *
 * È una SECONDA linea di difesa: la prima è l'`<img>` da `Blob` URL, che non esegue script né carica risorse esterne. Non vuole essere
 * completa: per esempio non decifra gli escape CSS (`u\72l(` per `url(`), che l'`<img>` comunque non seguirebbe.
 */
export function sanitizeSvg(text: string): { svg: string; removed: string[] } {
  rejectEntities(text);
  const removed: string[] = [];
  const strip = (pattern: RegExp, label: string, svg: string) => {
    const result = svg.replace(pattern, '');
    if (result !== svg && !removed.includes(label)) removed.push(label);
    return result;
  };
  let svg = text;
  // Anche con il prefisso dello spazio dei nomi (<svg:script>, <x:foreignObject>)
  svg = strip(/<(?:[\w-]+:)?script\b[\s\S]*?<\/(?:[\w-]+:)?script\s*>/gi, 'script', svg);
  svg = strip(/<(?:[\w-]+:)?script\b[^>]*\/>/gi, 'script', svg);
  svg = strip(/<(?:[\w-]+:)?foreignObject\b[\s\S]*?<\/(?:[\w-]+:)?foreignObject\s*>/gi, 'foreignObject', svg);
  svg = strip(/<(?:[\w-]+:)?foreignObject\b[^>]*\/>/gi, 'foreignObject', svg);
  // Attributi di evento: onload, onclick...
  svg = strip(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, 'eventi', svg);
  // Riferimenti (href con qualunque prefisso): restano solo quelli interni (#id) e le immagini data:
  svg = svg.replace(/\s(?:[\w-]+:)?href\s*=\s*("[^"]*"|'[^']*')/gi, (all, value: string) => {
    const target = value.slice(1, -1).trim();
    if (target.startsWith('#') || /^data:image\/(png|jpeg|gif|webp)[;,]/i.test(target)) return all;
    if (!removed.includes('riferimenti esterni')) removed.push('riferimenti esterni');
    return '';
  });
  svg = strip(/@import[^;<]*;?/gi, 'riferimenti esterni', svg);
  // url(...) negli stili: solo #id e le stesse immagini data: degli href
  svg = svg.replace(/url\(\s*(['"]?)(?!#|data:image\/(?:png|jpeg|gif|webp)[;,])[^)]*\)/gi, () => {
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
 * Dimensioni dell'SVG (pixel CSS, per le proporzioni): `width` e `height` se sono lunghezze; con il `viewBox` e un solo lato, l'altro
 * segue le proporzioni del `viewBox` (come fa il browser); senza lati, il `viewBox`. Lancia un errore chiaro se non si ricavano.
 */
export function svgDimensions(text: string): { w: number; h: number } {
  const tag = rootTag(text);
  const box = attribute(tag, 'viewBox')?.trim().split(/[\s,]+/).map(Number);
  const viewBox = box && box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? { w: box[2], h: box[3] } : null;
  const width = cssLength(attribute(tag, 'width'));
  const height = cssLength(attribute(tag, 'height'));
  if (viewBox) return { w: width ?? (height ? (height * viewBox.w) / viewBox.h : viewBox.w), h: height ?? (width ? (width * viewBox.h) / viewBox.w : viewBox.h) };
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
  // Prima delle entità (messaggio più preciso), poi il DOCTYPE con sottoinsieme interno senza entità (`<!ATTLIST ...>`: attributi
  // predefiniti che il documento potrebbe richiedere e che qui si ignorerebbero): rifiutato con il suo messaggio
  rejectEntities(text);
  if (preambleOf(text).internalSubset) throw new Error('SVG non supportato: il DOCTYPE ha un sottoinsieme interno (dichiarazioni tra parentesi quadre): riesporta l\'SVG senza.');
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
 * Dai byte di un file (i primi `MAX_SVG_BYTES`) all'SVG preparato, se il contenuto è un SVG; `null` se non lo è (il chiamante prova gli
 * altri formati o dice «Formato non supportato»). Rifiuta un file oltre `MAX_SVG_BYTES` (`fileSize` è la dimensione del file intero) e
 * gli SVG con entità (anche con DOCTYPE). Puro: la rasterizzazione è un passo a parte (`rasterizeSvg`).
 */
export function prepareSvgFile(bytes: Uint8Array, fileSize: number): ReturnType<typeof prepareSvg> | null {
  if (!looksLikeSvg(new TextDecoder('utf-8').decode(bytes.subarray(0, 8192)))) return null;
  if (fileSize > MAX_SVG_BYTES) throw new Error(`L'SVG è troppo grande (${Math.round(fileSize / 1024)} KB): il massimo è ${MAX_SVG_BYTES / 1024 / 1024} MB.`);
  return prepareSvg(new TextDecoder('utf-8').decode(bytes));
}

/**
 * Disegna l'SVG preparato su un canvas bianco di `w` × `h` pixel e ne restituisce i pixel RGBA. Browser: `<img>` con un `Blob` URL
 * (nessuno script, nessuna risorsa esterna), con un tempo massimo per il caricamento (non per il `drawImage` sincrono).
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
