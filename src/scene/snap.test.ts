import { describe, expect, it } from 'vitest';
import { measure, snapToMesh } from './snap';
import type { MeshData } from './edgeTool';
import type { Vec3 } from './types';

/** Cubo di lato 20 con centro nell'origine: 8 vertici, 12 triangoli (due per faccia), facce con la diagonale. */
function cube(): MeshData {
  const positions = new Float32Array([
    -10, -10, -10, 10, -10, -10, 10, 10, -10, -10, 10, -10, // 0..3 base
    -10, -10, 10, 10, -10, 10, 10, 10, 10, -10, 10, 10, // 4..7 cima
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // fondo (-Z)
    4, 5, 6, 4, 6, 7, // cima (+Z)
    0, 1, 5, 0, 5, 4, // fronte (-Y)
    1, 2, 6, 1, 6, 5, // destra (+X)
    2, 3, 7, 2, 7, 6, // retro (+Y)
    3, 0, 4, 3, 4, 7, // sinistra (-X)
  ]);
  return { positions, indices };
}

/** Indice del triangolo della cima (+Z) che contiene (x, y): il primo è 4,5,6 (metà x ≥ y). */
const TOP_FIRST = 2;

describe('snapToMesh', () => {
  it('si aggancia a un vertice vicino', () => {
    const snap = snapToMesh(cube(), TOP_FIRST, [9.5, -9.4, 10], 2);
    expect(snap.kind).toBe('vertex');
    expect(snap.point).toEqual([10, -10, 10]);
  });

  it('si aggancia al punto medio di uno spigolo vero', () => {
    // Sullo spigolo cima-fronte (y = -10, z = 10), a metà tra x = -10 e x = 10
    const snap = snapToMesh(cube(), TOP_FIRST, [0.4, -9.6, 10], 2);
    expect(snap.kind).toBe('midpoint');
    expect(snap.point).toEqual([0, -10, 10]);
  });

  it('si aggancia a un punto qualunque dello spigolo vero', () => {
    const snap = snapToMesh(cube(), TOP_FIRST, [5, -9.5, 10], 1);
    expect(snap.kind).toBe('edge');
    expect(snap.point[0]).toBeCloseTo(5, 6);
    expect(snap.point[1]).toBeCloseTo(-10, 6);
  });

  it('la diagonale di una faccia piana non è uno spigolo: resta il punto sulla faccia', () => {
    // Il triangolo 4,5,6 ha la diagonale 4-6: un punto sulla diagonale, lontano dai vertici e dagli spigoli veri
    const snap = snapToMesh(cube(), TOP_FIRST, [2, 2, 10], 1);
    expect(snap.kind).toBe('face');
    expect(snap.point).toEqual([2, 2, 10]);
  });

  it('senza tolleranza dà sempre il punto sulla faccia', () => {
    expect(snapToMesh(cube(), TOP_FIRST, [9.9, -9.9, 10], 0).kind).toBe('face');
  });
});

describe('measure', () => {
  it('distanza e componenti tra due punti', () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [3, 4, 12];
    const { distance, delta } = measure(a, b);
    expect(distance).toBeCloseTo(13, 9);
    expect(delta).toEqual([3, 4, 12]);
  });

  it('misura lo spigolo di un cubo di 20 mm', () => {
    const mesh = cube();
    const a = snapToMesh(mesh, TOP_FIRST, [9.8, -9.8, 10], 2);
    const b = snapToMesh(mesh, TOP_FIRST, [-9.8, -9.8, 10], 2);
    expect(measure(a.point, b.point).distance).toBeCloseTo(20, 6);
  });
});
