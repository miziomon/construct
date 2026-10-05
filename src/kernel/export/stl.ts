/**
 * STL binario: header da 80 byte, conteggio triangoli (uint32), poi per ogni triangolo
 * normale (3 float), tre vertici (9 float) e 2 byte di attributo. Little endian.
 */
export function writeStl(positions: Float32Array, indices: Uint32Array): Uint8Array<ArrayBuffer> {
  const triCount = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  // Header testuale (ignorato dagli slicer) e numero di triangoli
  new TextEncoder().encodeInto('WebCAD binary STL', new Uint8Array(buffer, 0, 80));
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    // Normale = prodotto vettoriale degli spigoli, normalizzata (vettore nullo per triangoli degeneri)
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz, positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2], positions[c], positions[c + 1], positions[c + 2]]) {
      view.setFloat32(offset, v, true);
      offset += 4;
    }
    // Attributo (2 byte) lasciato a zero
    offset += 2;
  }
  return new Uint8Array(buffer);
}
