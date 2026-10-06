import { ImportError, type ImportedMesh } from './types';

/** Accumula triangoli "a zuppa" e li converte in una mesh con vertici condivisi. */
class MeshBuilder {
  private readonly lookup = new Map<string, number>();
  private readonly coords: number[] = [];
  private readonly tris: number[] = [];

  /** Aggiunge un vertice e restituisce il suo indice (un vertice identico esistente viene riusato). */
  private vertex(x: number, y: number, z: number): number {
    // Le coordinate sono già float32: la chiave testuale è esatta
    const key = `${x},${y},${z}`;
    let i = this.lookup.get(key);
    if (i === undefined) {
      i = this.coords.length / 3;
      this.lookup.set(key, i);
      this.coords.push(x, y, z);
    }
    return i;
  }

  triangle(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>): void {
    this.tris.push(this.vertex(a[0], a[1], a[2]), this.vertex(b[0], b[1], b[2]), this.vertex(c[0], c[1], c[2]));
  }

  build(name: string): ImportedMesh {
    return { name, positions: new Float32Array(this.coords), indices: new Uint32Array(this.tris) };
  }
}

/** Un STL binario ha 80 byte di header, il numero di triangoli e 50 byte per triangolo. */
function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const triangles = new DataView(buffer).getUint32(80, true);
  return 84 + triangles * 50 === buffer.byteLength;
}

function parseBinary(buffer: ArrayBuffer, name: string): ImportedMesh {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const builder = new MeshBuilder();
  const v = [new Float32Array(3), new Float32Array(3), new Float32Array(3)];
  for (let t = 0; t < count; t++) {
    // Salta la normale (12 byte): si ricalcola dai vertici
    const base = 84 + t * 50 + 12;
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++) v[k][c] = view.getFloat32(base + k * 12 + c * 4, true);
    }
    builder.triangle(v[0], v[1], v[2]);
  }
  return builder.build(name);
}

function parseAscii(text: string, name: string): ImportedMesh {
  const builder = new MeshBuilder();
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  const f32 = new Float32Array(1);
  const pts: Float32Array[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const p = new Float32Array(3);
    for (let c = 0; c < 3; c++) {
      f32[0] = Number(match[c + 1]);
      p[c] = f32[0];
    }
    pts.push(p);
    if (pts.length === 3) {
      builder.triangle(pts[0], pts[1], pts[2]);
      pts.length = 0;
    }
  }
  if (pts.length) throw new ImportError('File STL ASCII incompleto: un triangolo non ha tre vertici.');
  return builder.build(name);
}

/** Legge un file STL (binario o ASCII). */
export function parseStl(buffer: ArrayBuffer, name: string): ImportedMesh[] {
  const mesh = isBinaryStl(buffer) ? parseBinary(buffer, name) : parseAscii(new TextDecoder().decode(buffer), name);
  if (mesh.indices.length === 0) throw new ImportError('Il file STL non contiene triangoli.');
  return [mesh];
}
