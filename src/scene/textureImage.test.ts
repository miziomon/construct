import { describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { defaultPatternParams, normalizePattern, patternRelief, reliefWarnings, textureOf } from './pattern';
import { MAX_IMAGE_SIDE, SAMPLE_SIZE, grayFingerprint, imageOf, imageToGray, pixelSize, sampleImage, usedImageIds } from './textureImage';
import { textureCacheKey } from '../kernel/textureMap';
import type { GrayImage } from './textureMap';
import { SAMPLE_KINDS, makeSample } from './textureSamples';
import type { GroupNode, PatternParams, Scene, Vec3 } from './types';
import { decodeImage, encodeImage } from '../import/assets';

/** Immagine sintetica `w` × `h` con un gradiente orizzontale. */
const gradient = (w: number, h: number): GrayImage => ({ w, h, data: Uint8Array.from({ length: w * h }, (_, i) => Math.round(((i % w) / Math.max(1, w - 1)) * 255)) });

const bounds = { min: [-40, -30, -2.5] as Vec3, max: [40, 30, 2.5] as Vec3 };
const params = (patch: Partial<PatternParams>): PatternParams => ({ ...defaultPatternParams(bounds, 3), kind: 'texture', ...patch });

describe('immagini: decodifica e impronta', () => {
  it('RGBA sintetico: Rec. 601 intero sui valori sRGB, trasparenza composta sul bianco', () => {
    // Nero, bianco, rosso, verde, blu opachi; poi nero a metà trasparenza e nero del tutto trasparente
    const rgba = [0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 128, 0, 0, 0, 0];
    const gray = imageToGray(rgba, 7, 1);
    expect(Array.from(gray.data)).toEqual([0, 255, (77 * 255 + 128) >> 8, (150 * 255 + 128) >> 8, (29 * 255 + 128) >> 8, 127, 255]);
    expect([gray.w, gray.h]).toEqual([7, 1]);
  });

  it('riduce a 512 px sul lato maggiore mantenendo le proporzioni, e non tocca le immagini piccole', () => {
    // Grigio 200 opaco
    const opaque = (w: number, h: number) => Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : 200));
    const big = opaque(1024, 512);
    const reduced = imageToGray(big, 1024, 512);
    expect([reduced.w, reduced.h]).toEqual([MAX_IMAGE_SIDE, MAX_IMAGE_SIDE / 2]);
    expect(reduced.data.every((v) => v === 200)).toBe(true);
    const small = imageToGray(opaque(64, 32), 64, 32);
    expect([small.w, small.h]).toEqual([64, 32]);
  });

  it('impronta: stabile, con il prefisso img-, diversa se cambiano pixel o dimensioni (anche con gli stessi byte)', async () => {
    const a = gradient(16, 8);
    const id = await grayFingerprint(a);
    expect(id).toMatch(/^img-[0-9a-f]{16}$/);
    expect(await grayFingerprint({ ...a, data: a.data.slice() })).toBe(id);
    const other = a.data.slice();
    other[5] ^= 1;
    expect(await grayFingerprint({ ...a, data: other })).not.toBe(id);
    // Gli stessi 128 byte come 8 × 16 invece di 16 × 8: un'altra immagine
    expect(await grayFingerprint({ w: 8, h: 16, data: a.data })).not.toBe(id);
  });

  it('le texture di esempio si generano una volta sola, deterministiche, 256 px', () => {
    for (const kind of SAMPLE_KINDS) {
      const image = sampleImage(kind);
      expect([image.w, image.h]).toEqual([SAMPLE_SIZE, SAMPLE_SIZE]);
      expect(sampleImage(kind)).toBe(image);
    }
    expect(Array.from(sampleImage('knurl').data.slice(0, 8))).not.toEqual(Array.from(sampleImage('waves').data.slice(0, 8)));
  });

  it('imageOf: immagine caricata dalla funzione di ricerca (indefinita se manca), altrimenti la libreria con knurl di partenza', () => {
    const g = gradient(4, 4);
    expect(imageOf({ imageId: 'img-1' }, (id) => (id === 'img-1' ? g : undefined))).toBe(g);
    expect(imageOf({ imageId: 'img-2' }, () => undefined)).toBeUndefined();
    expect(imageOf({ imageId: 'img-2' })).toBeUndefined();
    expect(imageOf({})).toBe(sampleImage('knurl'));
    expect(imageOf({ sample: 'waves' })).toBe(sampleImage('waves'));
  });

  it('usedImageIds: le immagini dei Pattern Immagine, senza ripetizioni', () => {
    const group = (id: string, pattern: Partial<PatternParams>) => ({ id, type: 'group', op: 'pattern', children: [], pattern }) as unknown as GroupNode;
    const scene = { nodes: { a: group('a', { kind: 'texture', imageId: 'img-1' }), b: group('b', { kind: 'texture', imageId: 'img-1' }), c: group('c', { kind: 'texture', imageId: 'img-2' }), d: group('d', { kind: 'texture' }), e: group('e', { kind: 'brick', imageId: 'img-9' }) }, rootIds: [] } as unknown as Scene;
    expect(usedImageIds(scene).sort()).toEqual(['img-1', 'img-2']);
  });
});

describe('immagini: codifica per il progetto e peso', () => {
  it('andata e ritorno senza perdite, con dimensioni e pixel', () => {
    const g = gradient(37, 11);
    const back = decodeImage('img-x', encodeImage({ id: 'img-x', w: g.w, h: g.h, gray: g.data }));
    expect([back.id, back.w, back.h]).toEqual(['img-x', 37, 11]);
    expect(Array.from(back.gray)).toEqual(Array.from(g.data));
  });

  it('un dato corrotto o con dimensioni sbagliate dà un errore chiaro', () => {
    const encoded = encodeImage({ id: 'img-y', w: 4, h: 4, gray: new Uint8Array(16) });
    expect(() => decodeImage('img-y', encoded)).not.toThrow();
    expect(() => decodeImage('img-z', 'non base64!!')).toThrow();
    // Intestazione 8 × 8 ma pixel per 4 × 4
    const raw = encodeImage({ id: 'img-w', w: 8, h: 8, gray: new Uint8Array(16) });
    expect(() => decodeImage('img-w', raw)).toThrow(/non valida/);
  });

  it('peso nel progetto di un\'immagine di 512 × 512 (zlib e base64): regolare, organica, caso peggiore', () => {
    const sizes: Record<string, number> = {};
    for (const kind of ['knurl', 'waves', 'leather', 'noise'] as const) {
      const image = makeSample(kind, 512);
      const w = 512;
      const data = image.data;
      const encoded = encodeImage({ id: 'img-peso', w, h: w, gray: data });
      sizes[kind] = Math.round(encoded.length / 1024);
    }
    appendFileSync('C:/tmp/peso-immagini.txt', `${JSON.stringify(sizes)}\n`);
    // Il grigio grezzo è 256 KB: la zigrinatura regolare comprime moltissimo, il rumore quasi niente (base64 = +33 %)
    expect(sizes.knurl).toBeLessThan(10);
    expect(sizes.waves).toBeLessThan(25);
    expect(sizes.leather).toBeLessThan(260);
    expect(sizes.noise).toBeLessThan(400);
  });
});

describe('Pattern Immagine: normalizzazione, limiti e avvisi', () => {
  it('kind texture: texture di esempio knurl, modo incavo, versione, nessun disegno né rilievo parametrico', () => {
    const n = normalizePattern(params({}));
    expect(n.kind).toBe('texture');
    expect(n.sample).toBe('knurl');
    expect(n.imageId).toBeUndefined();
    expect(n.textureAlgorithm).toBe(1);
    expect(n.texture).toMatchObject({ mode: 'groove', tile: 20, repeat: true, rotation: 0, offset: [0, 0], invert: false, midlevel: 0.5, amplitude: 0.6, blur: 0 });
    expect(n).not.toHaveProperty('design');
    expect(n).not.toHaveProperty('relief');
    // I tipi a celle non guadagnano campi dell'immagine
    const hex = normalizePattern(params({ kind: 'hexagon' }));
    for (const key of ['imageId', 'sample', 'texture', 'textureAlgorithm']) expect(hex).not.toHaveProperty(key);
  });

  it('imageId si conserva, un esempio sconosciuto torna a knurl, la versione salvata non si sovrascrive', () => {
    expect(normalizePattern(params({ imageId: 'img-abc', sample: undefined })).imageId).toBe('img-abc');
    expect(normalizePattern(params({ imageId: '' })).imageId).toBeUndefined();
    expect(normalizePattern(params({ sample: 'waves' })).sample).toBe('waves');
    expect(normalizePattern(params({ sample: 'nonesiste' as never })).sample).toBe('knurl');
    expect(normalizePattern(params({ textureAlgorithm: 2 as never })).textureAlgorithm).toBe(2);
  });

  it('limiti obbligatori della texture: piastrella, ampiezza, livello medio, sfocatura, scostamento', () => {
    const n = normalizePattern(params({ texture: { tile: 0, repeat: true, rotation: 725, offset: [Infinity, 1e9], invert: false, midlevel: 7, amplitude: -3, blur: 99, mode: 'zigzag' as never } }));
    expect(n.texture).toMatchObject({ tile: 0.5, rotation: 5, midlevel: 1, amplitude: 0, blur: 20, mode: 'relief' });
    expect(n.texture!.offset).toEqual([0, 10000]);
    // Un modo valido si conserva (anche relief: non c'è un ripiego silenzioso)
    expect(normalizePattern(params({ texture: { ...(n.texture as object), mode: 'relief' } as never })).texture!.mode).toBe('relief');
  });

  it('profondità limitata come gli altri rilievi: l\'incavo arriva a `amplitude`, «entrambi» a `amplitude` · livello medio, il rilievo non scende', () => {
    const base = { tile: 20, repeat: true, rotation: 0, offset: [0, 0] as [number, number], invert: false, midlevel: 0.5, blur: 0 };
    // Pannello di 5 mm: limite 4,8 mm
    expect(textureOf(params({ texture: { ...base, amplitude: 20, mode: 'groove' } })).amplitude).toBeCloseTo(4.8, 6);
    // «Entrambi»: la colonna scende 0,4 mm sotto l'incavo più profondo, quindi (4,8 - 0,4) / livello medio 0,5
    expect(textureOf(params({ texture: { ...base, amplitude: 20, mode: 'both' } })).amplitude).toBeCloseTo(8.8, 6);
    expect(textureOf(params({ texture: { ...base, amplitude: 20, mode: 'relief' } })).amplitude).toBe(20);
    // Il valore salvato non cambia e l'avviso lo dice
    const deep = normalizePattern(params({ texture: { ...base, amplitude: 20, mode: 'groove' } }));
    expect(deep.texture!.amplitude).toBe(20);
    expect(reliefWarnings(deep).some((w) => w.startsWith('Profondità ridotta a 4,8'))).toBe(true);
    // patternRelief non fallisce per l'Immagine (restituisce i Mattoni di partenza, che non si usano)
    expect(patternRelief(deep).relief.kind).toBe('brick');
  });

  it('avvisi: immagine mancante (solo con la funzione di ricerca), pixel grandi, ampiezza sotto lo strato, mappa grande', () => {
    const missing = params({ imageId: 'img-no', sample: undefined });
    expect(reliefWarnings(missing)).toEqual([]);
    expect(reliefWarnings(missing, () => undefined).some((w) => w.startsWith('Immagine non disponibile'))).toBe(true);
    // 256 px su una piastrella di 100 mm: pixel da 0,39 mm, sopra 0,3
    const lowSample = reliefWarnings(params({ texture: { tile: 100, repeat: true, rotation: 0, offset: [0, 0], invert: false, midlevel: 0.5, amplitude: 0.6, blur: 0, mode: 'groove' } }));
    expect(lowSample.some((w) => w.startsWith('I pixel dell\'immagine misurano 0,4 mm'))).toBe(true);
    expect(pixelSize(20, sampleImage('knurl'))).toBeCloseTo(20 / 256, 9);
    // Valori di partenza: nessun avviso
    expect(reliefWarnings(params({}))).toEqual([]);
    // Ampiezza sotto 0,2 mm
    expect(reliefWarnings(params({ texture: { tile: 20, repeat: true, rotation: 0, offset: [0, 0], invert: false, midlevel: 0.5, amplitude: 0.1, blur: 0, mode: 'groove' } })).some((w) => w.startsWith('Ampiezza sotto 0,2 mm'))).toBe(true);
    // Faccia grande: la mappa a 0,5 mm ha più di 200.000 nodi
    const bigBounds = { min: [-150, -150, -2.5] as Vec3, max: [150, 150, 2.5] as Vec3 };
    expect(reliefWarnings({ ...defaultPatternParams(bigBounds, 1), kind: 'texture' }).some((w) => w.startsWith('Mappa di altezze di circa'))).toBe(true);
  });

  it('chiave di cache: breve e stabile, dipende da id e parametri, mai dai pixel (anche quella dei nodi della scena)', () => {
    const tex = normalizePattern(params({})).texture!;
    const key = textureCacheKey('img-abc', tex);
    expect(key.length).toBeLessThan(300);
    expect(textureCacheKey('img-abc', tex)).toBe(key);
    expect(textureCacheKey('img-abd', tex)).not.toBe(key);
    expect(textureCacheKey('img-abc', { ...tex, tile: 30 })).not.toBe(key);
    // Il Pattern del nodo porta solo l'id e i parametri: `JSON.stringify` del kernel non scorre mai l'immagine
    expect(JSON.stringify(normalizePattern(params({ imageId: 'img-abc' }))).length).toBeLessThan(900);
  });
});
