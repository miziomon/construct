import { describe, expect, it } from 'vitest';
import { addAsset, decodeAsset, encodeAsset, getAsset } from './assets';

const positions = new Float32Array([0, 0, 0, 1.5, 0, 0, 0, 2.25, 0, 0, 0, -3]);
const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]);

describe('assets', () => {
  it('codifica e decodifica un asset senza perdite', () => {
    const copy = decodeAsset('abc', encodeAsset({ id: 'abc', positions, indices }));
    expect(copy.id).toBe('abc');
    expect(Array.from(copy.positions)).toEqual(Array.from(positions));
    expect(Array.from(copy.indices)).toEqual(Array.from(indices));
  });

  it("l'id dipende dal contenuto: lo stesso file importato due volte dà lo stesso asset", async () => {
    const a = await addAsset(positions.slice(), indices.slice());
    const b = await addAsset(positions.slice(), indices.slice());
    const other = positions.slice();
    other[11] = 99;
    const c = await addAsset(other, indices.slice());
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.id).toMatch(/^[0-9a-f]{16}$/);
    expect(getAsset(a.id)).toBeDefined();
  });

  it('regge mesh grandi nella codifica base64 (nessun limite di stack)', () => {
    const big = new Float32Array(300_000).map((_, i) => i % 977);
    const idx = new Uint32Array(150_000).map((_, i) => i % 100_000);
    const back = decodeAsset('big', encodeAsset({ id: 'big', positions: big, indices: idx }));
    expect(back.positions.length).toBe(big.length);
    expect(back.indices[149_999]).toBe(idx[149_999]);
  });
});
