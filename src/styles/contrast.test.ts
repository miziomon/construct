import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rgb = [number, number, number];
type Palette = Record<string, string>;

/** Legge dai token SCSS i colori di ogni tema: righe del tipo 'nome': #rrggbb oppure rgba(r, g, b, a). */
function readThemes(): Record<string, Palette> {
  const scss = readFileSync(new URL('./abstracts/_tokens.scss', import.meta.url), 'utf8');
  const themes: Record<string, Palette> = {};
  for (const name of ['light', 'dark']) {
    // Si parte dalla riga dopo l'apertura del tema, per non confondere il nome del tema con un colore
    const start = scss.indexOf('\n', scss.indexOf(`'${name}': (`));
    const end = scss.indexOf('\n  ),', start);
    const palette: Palette = {};
    for (const m of scss.slice(start, end).matchAll(/'([a-z-]+)':\s*(#[0-9a-fA-F]{6}|rgba\([^)]*\)),/g)) palette[m[1]] = m[2].trim();
    themes[name] = palette;
  }
  return themes;
}

/** Colore "#rrggbb" o "rgba(r, g, b, a)" come RGB; l'eventuale trasparenza si fonde su `over`. */
function parse(value: string, over?: Rgb): Rgb {
  if (value.startsWith('#')) return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
  const [r, g, b, a] = value.match(/[\d.]+/g)!.map(Number);
  const base = over ?? [255, 255, 255];
  return [r, g, b].map((c, i) => Math.round(c * a + base[i] * (1 - a))) as Rgb;
}

/** Luminanza relativa WCAG. */
function luminance([r, g, b]: Rgb): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Rapporto di contrasto WCAG (da 1 a 21). */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const themes = readThemes();

describe.each(['light', 'dark'])('contrasto del tema %s', (name) => {
  const p = themes[name];
  const c = (token: string, over?: Rgb) => parse(p[token], over);
  const surfaces = ['bg', 'panel', 'panel-raised'];

  it('legge tutti i token', () => {
    expect(Object.keys(p)).toEqual(expect.arrayContaining(['bg', 'panel', 'text', 'accent', 'syn-comment', 'code-bg']));
  });

  it.each(surfaces)('testo principale su %s: almeno 7:1', (surface) => {
    expect(contrast(c('text'), c(surface))).toBeGreaterThanOrEqual(7);
  });

  it.each(surfaces)('testo attenuato su %s: almeno 4,5:1', (surface) => {
    expect(contrast(c('text-muted'), c(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('accento (icone e testi attivi) su %s: almeno 4,5:1', (surface) => {
    expect(contrast(c('accent'), c(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('accento sullo sfondo dei pulsanti attivi (accent-soft sul pannello): almeno 4,5:1', () => {
    expect(contrast(c('accent'), c('accent-soft', c('panel')))).toBeGreaterThanOrEqual(4.5);
  });

  it('testo bianco sui pulsanti primari: almeno 4,5:1', () => {
    expect(contrast([255, 255, 255], c('accent-strong'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['danger', 'ok', 'warn'])('colore di stato %s sul pannello: almeno 4,5:1', (token) => {
    expect(contrast(c(token), c('panel'))).toBeGreaterThanOrEqual(4.5);
  });

  // Tinte delle sezioni della toolbar: icone ed etichette su pannello e rialzo, e sul fondino del pulsante attivo (16% della tinta sul pannello)
  const tones = ['tool-transform', 'tool-combine', 'tool-modify', 'tool-arrange', 'tool-object'];

  it.each(tones)('tinta %s su pannello e rialzo: almeno 4,5:1', (token) => {
    expect(contrast(c(token), c('panel'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c(token), c('panel-raised'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(tones)('tinta %s sul fondino del pulsante attivo: almeno 4,5:1', (token) => {
    const [r, g, b] = c(token);
    const soft = parse(`rgba(${r}, ${g}, ${b}, 0.16)`, c('panel'));
    expect(contrast(c(token), soft)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['syn-comment', 'syn-keyword', 'syn-function', 'syn-number', 'syn-param'])('colore di sintassi %s su code-bg: almeno 4,5:1', (token) => {
    expect(contrast(c(token), c('code-bg'))).toBeGreaterThanOrEqual(4.5);
  });

  // Disegno 2D della modale del Profilo: il canvas sta sul pannello. Nodi, maniglie e asse sono elementi grafici (almeno 3:1);
  // il testo dell'asse e dell'avviso nella zona non ruotata (sulla tinta rossa) segue la soglia dei testi (4,5:1)
  it.each(['profile-axis', 'profile-node', 'profile-handle', 'accent', 'hole'])('disegno del Profilo: %s sul pannello: almeno 3:1', (token) => {
    expect(contrast(c(token), c('panel'))).toBeGreaterThanOrEqual(3);
  });

  it('disegno del Profilo: asse sul pannello come testo (etichetta "asse di rotazione"): almeno 4,5:1', () => {
    expect(contrast(c('profile-axis'), c('panel'))).toBeGreaterThanOrEqual(4.5);
  });

  it('disegno del Profilo: testo principale (avviso) sulla zona non ruotata: almeno 4,5:1', () => {
    expect(contrast(c('text'), c('profile-outside', c('panel')))).toBeGreaterThanOrEqual(4.5);
  });

  it('disegno del Profilo: il contorno (accento) si distingue dal riempimento: almeno 3:1', () => {
    expect(contrast(c('accent'), c('profile-fill', c('panel')))).toBeGreaterThanOrEqual(3);
  });

  it('disegno del Profilo: il riempimento e la zona non ruotata si vedono sul pannello (almeno 1,1:1) e non si confondono', () => {
    expect(contrast(c('profile-fill', c('panel')), c('panel'))).toBeGreaterThanOrEqual(1.1);
    expect(contrast(c('profile-outside', c('panel')), c('panel'))).toBeGreaterThanOrEqual(1.05);
  });

  it('testo del codice su code-bg: almeno 7:1', () => {
    expect(contrast(c('text'), c('code-bg'))).toBeGreaterThanOrEqual(7);
  });
});
