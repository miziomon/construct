import { describe, expect, it } from 'vitest';
import { applyScale } from './resize';
import { halfHeight, primitiveDefaults, shape2dDefaults } from './defaults';
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
});
