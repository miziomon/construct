import { describe, expect, it } from 'vitest';
import { MAX_SVG_BYTES, SVG_RASTER_SIDE, looksLikeSvg, prepareSvg, sanitizeSvg, stripPreamble, svgDimensions, svgRasterSize } from './svgImage';

const CIRCLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30"/></svg>';

describe('riconoscimento dal contenuto', () => {
  it('SVG anche dopo BOM, spazi, dichiarazione XML, commenti e DOCTYPE; non dall\'estensione', () => {
    expect(looksLikeSvg(CIRCLE)).toBe(true);
    expect(looksLikeSvg('﻿  \n' + CIRCLE)).toBe(true);
    expect(looksLikeSvg('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + CIRCLE)).toBe(true);
    expect(looksLikeSvg('<?xml version="1.0"?>\n<!-- creato da un editor -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- altro -->' + CIRCLE)).toBe(true);
    expect(looksLikeSvg('<svg/>')).toBe(true);
    expect(stripPreamble('﻿<?xml version="1.0"?><!-- a --> <svg></svg>')).toBe('<svg></svg>');
  });

  it('non è SVG: HTML, testo, XML di altro tipo, un elemento che inizia con svg, vuoto', () => {
    for (const text of ['<html><body><svg></svg></body></html>', 'questo non è un SVG', '<?xml version="1.0"?><note>ciao</note>', '<svgfoo></svgfoo>', '', '   ', '<!-- solo un commento -->']) expect(looksLikeSvg(text)).toBe(false);
  });
});

describe('pulizia', () => {
  it('toglie script, foreignObject, attributi di evento, riferimenti esterni e @import, e dice che cosa', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
      <script>window.__pwned = true</script><script href="x.js"/>
      <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>
      <style>@import url(http://example.com/a.css); .a { fill: url(http://example.com/x.svg#p); stroke: url(#grad) }</style>
      <image href="http://example.com/x.png" width="5" height="5"/>
      <image xlink:href="https://example.com/y.png" width="5" height="5"/>
      <image href="data:image/png;base64,AAAA" width="5" height="5"/>
      <use xlink:href="#shape" onclick='steal()'/>
      <a href="javascript:alert(1)"><rect width="3" height="3" onmouseover=evil()/></a>
    </svg>`;
    const { svg, removed } = sanitizeSvg(dirty);
    for (const bad of ['<script', 'foreignObject', 'onload', 'onclick', 'onmouseover', 'alert(1)', '__pwned', '@import', 'example.com', 'javascript:']) expect(svg, bad).not.toContain(bad);
    // Restano i riferimenti interni, le immagini data: e gli stili legati a un id
    expect(svg).toContain('xlink:href="#shape"');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('url(#grad)');
    expect(svg).toContain('<rect width="3" height="3"');
    expect([...new Set(removed)].sort()).toEqual(['eventi', 'foreignObject', 'riferimenti esterni', 'script']);
  });

  it('un SVG pulito non cambia e non segnala nulla', () => {
    const { svg, removed } = sanitizeSvg(CIRCLE);
    expect(svg).toBe(CIRCLE);
    expect(removed).toEqual([]);
  });

  it('rifiuta le entità XML (espansione a dismisura), anche dentro un DOCTYPE', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&b;</text></svg>';
    expect(() => sanitizeSvg(bomb)).toThrow(/entità XML/);
    expect(() => prepareSvg(bomb)).toThrow(/entità XML/);
  });
});

describe('dimensioni e rasterizzazione', () => {
  it('dal viewBox, da width e height (unità CSS), con le proporzioni del viewBox se c\'è', () => {
    expect(svgDimensions(CIRCLE)).toEqual({ w: 100, h: 100 });
    expect(svgDimensions('<svg xmlns="x" width="200" height="100"></svg>')).toEqual({ w: 200, h: 100 });
    expect(svgDimensions('<svg width="10mm" height="5mm" viewBox="0 0 400 200"></svg>')).toEqual({ w: (10 * 96) / 25.4, h: (5 * 96) / 25.4 });
    expect(svgDimensions('<svg width="1in" height="2in"></svg>')).toEqual({ w: 96, h: 192 });
    expect(svgDimensions("<svg viewBox='10 20 300.5 150.25'></svg>")).toEqual({ w: 300.5, h: 150.25 });
    expect(svgDimensions('<svg viewBox="0,0,50,25"></svg>')).toEqual({ w: 50, h: 25 });
    // Con un solo lato in unità fisse e il viewBox: l'altro viene dal viewBox
    expect(svgDimensions('<svg width="300" viewBox="0 0 10 10"></svg>')).toEqual({ w: 300, h: 10 });
  });

  it('senza dimensioni utili: errore chiaro (percentuali, niente attributi, viewBox non valido, nessuno o negativo)', () => {
    for (const svg of ['<svg width="100%" height="100%"></svg>', '<svg></svg>', '<svg viewBox="0 0 0 10"></svg>', '<svg viewBox="a b c d"></svg>', '<svg width="-5" height="10"></svg>', '<svg width="10"></svg>']) expect(() => svgDimensions(svg), svg).toThrow(/SVG senza dimensioni/);
  });

  it('rasterizza con il lato lungo a 512 pixel (anche un SVG piccolo si ingrandisce) e rifiuta le proporzioni estreme', () => {
    expect(svgRasterSize(100, 100)).toEqual({ w: 512, h: 512 });
    expect(svgRasterSize(10, 5)).toEqual({ w: 512, h: 256 });
    expect(svgRasterSize(3000, 1000)).toEqual({ w: 512, h: 171 });
    expect(svgRasterSize(1, 100)).toEqual({ w: 5, h: 512 });
    expect(SVG_RASTER_SIDE).toBe(512);
    expect(() => svgRasterSize(1000, 5)).toThrow(/troppo allungato/);
    expect(() => svgRasterSize(Number.NaN, 5)).toThrow();
  });

  it('prepareSvg: radice riscritta con la dimensione di rasterizzazione, viewBox e xmlns; il contenuto resta', () => {
    const out = prepareSvg('<?xml version="1.0"?>\n<svg width="40mm" height="20mm" viewBox="0 0 200 100" onload="x()"><rect width="200" height="100" fill="white"/><circle cx="100" cy="50" r="30"/></svg>');
    expect([out.w, out.h]).toEqual([512, 256]);
    expect(out.svg).toMatch(/^<svg viewBox="0 0 200 100" xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="512" height="256">/);
    expect(out.svg).toContain('<circle cx="100" cy="50" r="30"/></svg>');
    expect(out.svg).not.toContain('onload');
    expect(out.removed).toEqual(['eventi']);
    // Senza viewBox lo aggiunge con le dimensioni originali; con lo xmlns già presente non lo duplica
    const bare = prepareSvg('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40"/></svg>');
    expect(bare.svg).toContain('viewBox="0 0 80 40"');
    expect(bare.svg.match(/xmlns="/g)).toHaveLength(1);
    expect([bare.w, bare.h]).toEqual([512, 256]);
    // Con xmlns:xlink resta (serve ai riferimenti interni)
    expect(prepareSvg('<svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 4 4"><use xlink:href="#a"/></svg>').svg).toContain('xmlns:xlink=');
  });

  it('SVG vuoto, incompleto o non SVG: messaggi in italiano', () => {
    expect(() => prepareSvg('<svg viewBox="0 0 10 10"></svg>')).toThrow(/vuoto/);
    expect(() => prepareSvg('<svg viewBox="0 0 10 10"/>')).toThrow(/vuoto/);
    expect(() => prepareSvg('<svg viewBox="0 0 10 10"><g></g></svg>')).toThrow(/vuoto/);
    expect(() => prepareSvg('<svg viewBox="0 0 10 10"><rect width="5" height="5"/>')).toThrow(/incompleto/);
    expect(() => prepareSvg('<html></html>')).toThrow(/non è un SVG valido/);
    // Dopo la pulizia non resta niente da disegnare: vuoto (uno script non disegna)
    expect(() => prepareSvg('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>')).toThrow(/vuoto/);
  });

  it('un SVG con script si pulisce e si prepara lo stesso (il disegno resta)', () => {
    const out = prepareSvg('<svg viewBox="0 0 10 10"><script>window.__pwned = true</script><rect width="5" height="5" onload="evil()"/><image href="http://example.com/x.png" width="2" height="2"/></svg>');
    expect(out.svg).not.toMatch(/script|__pwned|onload|example\.com/);
    expect(out.svg).toContain('<rect width="5" height="5"/>');
    expect([...out.removed].sort()).toEqual(['eventi', 'riferimenti esterni', 'script']);
  });

  it('il limite di dimensione del file è 2 MB', () => {
    expect(MAX_SVG_BYTES).toBe(2 * 1024 * 1024);
  });
});
