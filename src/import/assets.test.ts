import { describe, expect, it, vi } from 'vitest';
import { addAsset, addImage, decodeAsset, encodeAsset, getAsset, getImage, loadImages } from './assets';

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

describe('immagini del Pattern Immagine', () => {
  const gray = (seed: number) => ({ w: 6, h: 4, data: Uint8Array.from({ length: 24 }, (_, i) => (i * 7 + seed) % 256) });

  it('una sola copia per contenuto: la stessa immagine caricata due volte dà lo stesso asset', async () => {
    const a = await addImage(gray(1));
    const b = await addImage(gray(1));
    const c = await addImage(gray(2));
    expect(b).toBe(a);
    expect(c.id).not.toBe(a.id);
    expect(a.id).toMatch(/^img-[0-9a-f]{16}$/);
    expect([a.w, a.h]).toEqual([6, 4]);
  });

  it('getImage dà il grigio nel formato dei calcoli puri, indefinito per un id sconosciuto', async () => {
    const asset = await addImage(gray(3));
    const image = getImage(asset.id)!;
    expect([image.w, image.h]).toEqual([6, 4]);
    expect(Array.from(image.data)).toEqual(Array.from(gray(3).data));
    expect(getImage('img-0000000000000000')).toBeUndefined();
  });

  it('loadImages trova in memoria quelle registrate e salta le altre', async () => {
    const asset = await addImage(gray(4));
    const found = await loadImages([asset.id, 'img-ffffffffffffffff']);
    expect(found.map((f) => f.id)).toEqual([asset.id]);
  });

  it('ripristino dopo un riavvio: le immagini tornano da IndexedDB (simulato)', async () => {
    // Registro e archivio nuovi: simula un nuovo avvio con l'archivio già scritto
    const db = new Map<string, unknown>();
    vi.resetModules();
    vi.doMock('idb-keyval', () => ({ get: async (k: string) => db.get(k), set: async (k: string, v: unknown) => void db.set(k, v), del: async (k: string) => void db.delete(k) }));
    const first = await import('./assets');
    const asset = await first.addImage(gray(5));
    expect([...db.keys()]).toEqual([`construct:image:${asset.id}`]);
    vi.resetModules();
    const second = await import('./assets');
    expect(second.getImage(asset.id)).toBeUndefined();
    const restored = await second.loadImages([asset.id]);
    expect(Array.from(restored[0].gray)).toEqual(Array.from(gray(5).data));
    expect(second.getImage(asset.id)).toBeDefined();
    vi.doUnmock('idb-keyval');
  });
});
