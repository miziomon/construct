import { describe, expect, it } from 'vitest';
import { applyScale, hasScale, isRatioLocked, lockedPatch, scalePatch, scalePercent } from './resize';
import { halfHeight, primitiveDefaults, shape2dDefaults } from './defaults';
import { maxRootRadius } from './profiles';
import type { PrimitiveNode, Shape2DNode } from './types';

const prim = (kind: Parameters<typeof primitiveDefaults>[0], patch: Partial<PrimitiveNode> = {}) =>
  ({ ...primitiveDefaults(kind), id: 'a', name: 'a', position: [0, 0, 0], ...patch }) as PrimitiveNode;
const shape = (kind: Parameters<typeof shape2dDefaults>[0], patch: Partial<Shape2DNode> = {}) =>
  ({ ...shape2dDefaults(kind), id: 'a', name: 'a', position: [0, 0, 0], ...patch }) as Shape2DNode;

describe('applyScale', () => {
  it('cubo: ogni asse scala per conto suo', () => {
    expect(applyScale(prim('box'), [2, 1, 0.5]).size).toEqual([40, 20, 10]);
  });

  it('cubo: il raccordo non supera la nuova metà del lato minore', () => {
    const r = applyScale(prim('box', { cornerRadius: 8 } as Partial<PrimitiveNode>), [1, 1, 0.5]);
    expect(r.cornerRadius).toBeCloseTo(4.99, 2);
  });

  it('cilindro: i raggi X e Y scalano in modo indipendente, l altezza con Z', () => {
    expect(applyScale(prim('cylinder'), [1.5, 1.2, 2])).toMatchObject({ radius: 15, radiusY: 12, height: 40 });
  });

  it('cilindro: con lo stesso fattore su X e Y resta tondo (radiusY tolto)', () => {
    const patch = applyScale(prim('cylinder', { radiusY: 5 }), [2, 4, 1]);
    // Il raggio X passa a 20 e il raggio Y a 20: coincidono, quindi il campo opzionale sparisce
    expect(patch.radius).toBe(20);
    expect(patch.radiusY).toBeUndefined();
  });

  it('un asse con fattore 1 non cambia nemmeno per l arrotondamento', () => {
    expect(applyScale(prim('cylinder', { radius: 10.3 }), [1, 1, 2]).radius).toBe(10.3);
  });

  it('cono: il raggio superiore a zero resta zero', () => {
    expect(applyScale(prim('cone'), [2, 2, 1])).toMatchObject({ radiusBottom: 20, radiusTop: 0 });
  });

  it('sfera: ellissoide con un raggio per asse', () => {
    expect(applyScale(prim('sphere'), [1, 1.5, 1.2])).toMatchObject({ radius: 10, radiusY: 15, radiusZ: 12 });
  });

  it('sfera: scala uniforme torna tonda', () => {
    const patch = applyScale(prim('sphere', { radiusY: 5, radiusZ: 20 }), [3, 6, 1.5]);
    expect(patch.radius).toBe(30);
    expect(patch.radiusY).toBeUndefined();
    expect(patch.radiusZ).toBeUndefined();
  });

  it('toro e solidi dei dadi: scala uniforme sul fattore più lontano da 1', () => {
    expect(applyScale(prim('icosahedron'), [1, 1, 2]).size).toBe(40);
    expect(applyScale(prim('torus'), [1, 1.5, 1.2]).majorRadius).toBe(18);
  });

  it('profilati: gli spessori seguono l\'asse lungo cui si misurano e il raccordo resta entro il massimo', () => {
    // L: l'ala verticale (web) si misura lungo X, quella orizzontale (flange) lungo Y
    expect(applyScale(shape('profileL'), [2, 1, 1])).toMatchObject({ width: 40, depth: 20, flange: 3, web: 6, height: 10 * 4 });
    expect(applyScale(shape('profileL'), [1, 2, 3])).toMatchObject({ width: 20, depth: 40, flange: 6, web: 3, height: 120 });
    // H: le ali sono verticali, quindi si misurano lungo X
    expect(applyScale(shape('profileH'), [2, 1, 1])).toMatchObject({ flange: 6, web: 3 });
    // Un raccordo grande si riduce se la sezione si restringe
    const r = applyScale(shape('profileT', { rootRadius: 8 } as Partial<Shape2DNode>), [0.5, 0.5, 1]);
    expect(r.rootRadius).toBeLessThanOrEqual(maxRootRadius({ kind: 'profileT', width: 10, depth: 10, flange: 1.5, web: 1.5 }));
    // U: come la H, ali lungo X
    expect(applyScale(shape('profileU'), [2, 1, 1])).toMatchObject({ flange: 6, web: 3 });
  });

  it('lucchetto sui profilati: cambiando una misura a mano scalano anche pareti, raccordi e punte', () => {
    const l = shape('profileL', { rootRadius: 2, tipSize: 1 } as Partial<Shape2DNode>);
    expect(lockedPatch(l, 'width', 40)).toMatchObject({ width: 40, depth: 40, flange: 6, web: 6, rootRadius: 4, tipSize: 2 });
    expect(lockedPatch(l, 'depth', 10)).toMatchObject({ width: 10, depth: 10, flange: 1.5, web: 1.5, rootRadius: 1, tipSize: 0.5 });
    // Tubo rettangolare: parete e raggio degli angoli
    expect(lockedPatch(shape('tubeRect', { cornerRadius: 3 } as Partial<Shape2DNode>), 'width', 40)).toMatchObject({ width: 40, depth: 40, wall: 4, cornerRadius: 6 });
    // Le altre forme poligonali legano solo l'ingombro
    expect(lockedPatch(shape('cross'), 'width', 40)).toEqual({ width: 40, depth: 40 });
  });

  it('tubolari: la parete del rettangolare segue il fattore minore, il tondo resta tondo', () => {
    expect(applyScale(shape('tubeRect', { cornerRadius: 4 } as Partial<Shape2DNode>), [2, 1, 1])).toMatchObject({ width: 40, depth: 20, wall: 2, cornerRadius: 4 });
    expect(applyScale(shape('tubeRect'), [2, 2, 1])).toMatchObject({ width: 40, depth: 40, wall: 4 });
    expect(applyScale(shape('tubeRound'), [2, 2, 3])).toMatchObject({ radius: 20, wall: 4, height: 120 });
    // Il tondo non ha lucchetto (una sola misura), il rettangolare sì
    expect(lockedPatch(shape('tubeRound'), 'radius', 20)).toBeNull();
    expect(lockedPatch(shape('tubeRect'), 'width', 40)).toMatchObject({ width: 40, depth: 40 });
  });

  it('arrotonda al passo e rispetta il minimo', () => {
    expect((applyScale(prim('box'), [1.012, 1, 1]).size as number[])[0]).toBe(20);
    expect((applyScale(prim('box'), [1.012, 1, 1], 0.01).size as number[])[0]).toBe(20.24);
    expect((applyScale(prim('box'), [0.001, 1, 1]).size as number[])[0]).toBe(0.1);
  });

  it('forme 2D: cambia l altezza con Z e le misure del profilo con X e Y', () => {
    expect(applyScale(shape('square'), [2, 0.5, 3])).toMatchObject({ width: 40, depth: 10, height: 30 });
    expect(applyScale(shape('circle'), [1, 1, 2])).toMatchObject({ radius: 10, height: 20 });
    // Cerchio non proporzionale: raggio Y a parte
    expect(applyScale(shape('circle'), [2, 1, 1])).toMatchObject({ radius: 20, radiusY: 10 });
  });

  it('con la sola scala Z (estrusione) il profilo non cambia e la base resta ferma', () => {
    const node = shape('square', { position: [0, 0, 5] });
    const patch = applyScale(node, [1, 1, 2]);
    expect(patch.width).toBe(20);
    // L'altezza passa da 10 a 20: il centro sale di 5 mm per tenere la base a z = 0
    const dz = halfHeight({ ...node, ...patch } as Shape2DNode) - halfHeight(node);
    expect(dz).toBe(5);
  });

  it('forme 2D poligonali: scalano ingombro e altezza, il parametro ratio non cambia', () => {
    const star = shape('star5', { width: 20, depth: 20, ratio: 0.4, height: 10 } as Partial<Shape2DNode>);
    const patch = applyScale(star, [2, 1, 0.5]);
    expect(patch).toEqual({ height: 5, width: 40, depth: 20 });
    expect('ratio' in patch).toBe(false);
  });

  it('testo: la dimensione segue la media dei due assi del piano, altezza lo Z', () => {
    const text = shape('text', { size: 10, height: 4 } as Partial<Shape2DNode>);
    expect(applyScale(text, [2, 2, 1])).toEqual({ height: 4, size: 20 });
    expect(applyScale(text, [1, 1, 2])).toEqual({ height: 8, size: 10 });
  });

  describe('SVG importato', () => {
    const svg = (patch: Partial<Shape2DNode> = {}) =>
      shape('svg', { contours: [[[-20, -10], [20, -10], [20, 10], [-20, 10]]], width: 40, depth: 20, fileName: 'a.svg', ...patch } as Partial<Shape2DNode>);

    it('con le proporzioni bloccate (predefinito) larghezza e profondità seguono lo stesso fattore, quello trascinato', () => {
      expect(applyScale(svg(), [2, 1, 1])).toMatchObject({ width: 80, depth: 40 });
      expect(applyScale(svg(), [1, 0.5, 1])).toMatchObject({ width: 20, depth: 10 });
      // Il fattore più lontano da 1 vince e l'altezza resta libera
      expect(applyScale(svg(), [1.1, 1.5, 2])).toMatchObject({ width: 60, depth: 30, height: 20 });
    });

    it('la profondità non si arrotonda per conto suo: il rapporto resta quello del disegno', () => {
      const r = applyScale(svg({ width: 30, depth: 20 } as Partial<Shape2DNode>), [1.3, 1, 1]);
      expect(r.width).toBe(39);
      expect(r.depth).toBeCloseTo(26, 3);
    });

    it('con il lucchetto aperto gli assi sono indipendenti', () => {
      expect(applyScale(svg({ lockRatio: false } as Partial<Shape2DNode>), [2, 1, 1])).toMatchObject({ width: 80, depth: 20 });
    });
  });
});

describe('lucchetto delle proporzioni sulle altre forme', () => {
  it('di default solo gli SVG sono bloccati', () => {
    expect(isRatioLocked(shape('square'))).toBe(false);
    expect(isRatioLocked(prim('box'))).toBe(false);
    expect(isRatioLocked(shape('square', { lockRatio: true } as Partial<Shape2DNode>))).toBe(true);
  });

  it('cubo bloccato: la maniglia scala tutti i lati dello stesso fattore, anche se i lati sono diversi', () => {
    const box = prim('box', { size: [20, 10, 40], lockRatio: true } as Partial<PrimitiveNode>);
    const r = applyScale(box, [2, 1, 1]);
    expect(r.size).toEqual([40, 20, 80]);
    // Libero: solo l'asse trascinato
    expect(applyScale(prim('box', { size: [20, 10, 40] } as Partial<PrimitiveNode>), [2, 1, 1]).size).toEqual([40, 10, 40]);
  });

  it('quadrato e cerchio bloccati: i due assi seguono lo stesso fattore', () => {
    expect(applyScale(shape('square', { width: 20, depth: 10, lockRatio: true } as Partial<Shape2DNode>), [2, 1, 1])).toMatchObject({ width: 40, depth: 20 });
    const circle = applyScale(shape('circle', { radius: 10, radiusY: 5, lockRatio: true } as Partial<Shape2DNode>), [1.5, 1, 1]);
    expect(circle).toMatchObject({ radius: 15, radiusY: 7.5 });
  });

  it('lockedPatch: la misura modificata trascina le altre dello stesso fattore', () => {
    expect(lockedPatch(prim('box', { size: [20, 10, 40] } as Partial<PrimitiveNode>), 'size', 40, 0)).toEqual({ size: [40, 20, 80] });
    expect(lockedPatch(prim('box', { size: [20, 10, 40] } as Partial<PrimitiveNode>), 'size', 5, 1)).toEqual({ size: [10, 5, 20] });
    expect(lockedPatch(shape('square', { width: 20, depth: 10 } as Partial<Shape2DNode>), 'depth', 20)).toEqual({ depth: 20, width: 40 });
    expect(lockedPatch(shape('circle', { radius: 10, radiusY: 5 } as Partial<Shape2DNode>), 'radiusY', 10)).toEqual({ radius: 20, radiusY: 10 });
    // Cerchio tondo: il raggio Y resta assente
    expect(lockedPatch(shape('circle'), 'radius', 12)).toEqual({ radius: 12, radiusY: undefined });
    // Nessun compagno: testo e cilindro usano la modifica semplice
    expect(lockedPatch(shape('text'), 'size', 20)).toBeNull();
    expect(lockedPatch(prim('cylinder'), 'radius', 5)).toBeNull();
  });
});

describe('Scala in percentuale', () => {
  it('il 100 % è la misura iniziale della forma e vale per cubo e forme 2D, non per le altre primitive', () => {
    expect(scalePercent(prim('box'))).toBe(100);
    expect(scalePercent(prim('box', { size: [40, 40, 40] } as Partial<PrimitiveNode>))).toBe(200);
    expect(scalePercent(shape('circle', { radius: 5 } as Partial<Shape2DNode>))).toBe(50);
    expect(scalePercent(shape('text', { size: 30 } as Partial<Shape2DNode>))).toBe(300);
    expect(hasScale(prim('box'))).toBe(true);
    expect(hasScale(prim('sphere'))).toBe(false);
  });

  it('scalePatch ridimensiona in proporzione (anche se il lucchetto è aperto) e lascia invariata l altezza delle forme 2D', () => {
    expect(scalePatch(prim('box', { size: [20, 10, 40] } as Partial<PrimitiveNode>), 200).size).toEqual([40, 20, 80]);
    const r = scalePatch(shape('square', { width: 20, depth: 10, height: 7 } as Partial<Shape2DNode>), 50);
    expect(r).toMatchObject({ width: 10, depth: 5, height: 7 });
  });
});

describe('estrusione rotazionale e ridimensionamento', () => {
  it('l altezza lineare non si tocca e il raggio dall asse scala con X e Y', () => {
    const node = shape('circle', { radius: 10, extrusion: 'rotate', revolveRadius: 20 } as Partial<Shape2DNode>);
    const r = applyScale(node, [2, 2, 3]);
    expect(r).toMatchObject({ radius: 20, revolveRadius: 40 });
    expect(r).not.toHaveProperty('height');
  });
});

