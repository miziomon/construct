import { unzipSync, strFromU8 } from 'fflate';
import { ImportError, type ImportedMesh } from './types';

/** Fattore di conversione di ogni unità di misura 3MF in millimetri. */
const UNIT_TO_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

/** Matrice 3MF 4x3 per vettori riga: [m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32]. */
type Matrix = number[];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Composizione: prima `a`, poi `b` (convenzione vettore riga: v * a * b). */
function multiply(a: Matrix, b: Matrix): Matrix {
  const r: Matrix = new Array(12).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      // La quarta colonna implicita è (0, 0, 0, 1)
      let sum = i === 3 ? b[9 + j] : 0;
      for (let k = 0; k < 3; k++) sum += (i === 3 ? a[9 + k] : a[i * 3 + k]) * b[k * 3 + j];
      r[i * 3 + j] = sum;
    }
  }
  return r;
}

function parseMatrix(attr: string | null): Matrix {
  if (!attr) return IDENTITY;
  const m = attr.trim().split(/\s+/).map(Number);
  return m.length === 12 && m.every(Number.isFinite) ? m : IDENTITY;
}

interface ObjectDef {
  name: string;
  color?: string;
  mesh?: { positions: number[]; triangles: number[] };
  components: { objectId: string; transform: Matrix }[];
}

/** "#RRGGBBAA" → "#rrggbb" */
const cssColor = (displaycolor: string | null) => (displaycolor && /^#[0-9a-f]{6}/i.test(displaycolor) ? displaycolor.slice(0, 7).toLowerCase() : undefined);

/**
 * Legge un file 3MF: ogni voce di `<build>` diventa una mesh (componenti e trasformazioni incluse),
 * con unità convertite in millimetri e il colore del materiale se presente.
 * Limiti: niente estensioni di produzione (oggetti in file separati), niente texture.
 */
export function parse3mf(buffer: ArrayBuffer, fileName: string, parser: DOMParser = new DOMParser()): ImportedMesh[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new ImportError('Il file 3MF non è un archivio valido.');
  }
  const modelPath = Object.keys(files).find((p) => /^3d\/[^/]*\.model$/i.test(p));
  if (!modelPath) throw new ImportError('Il file 3MF non contiene un modello (3D/3dmodel.model).');

  const doc = parser.parseFromString(strFromU8(files[modelPath]), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ImportError('Il modello 3MF contiene XML non valido.');
  const model = doc.documentElement;
  const scale = UNIT_TO_MM[model.getAttribute('unit') ?? 'millimeter'] ?? 1;

  // Materiali di base: id → elenco dei colori
  const materials = new Map<string, (string | undefined)[]>();
  for (const bm of Array.from(doc.getElementsByTagName('basematerials'))) {
    materials.set(bm.getAttribute('id') ?? '', Array.from(bm.getElementsByTagName('base')).map((b) => cssColor(b.getAttribute('displaycolor'))));
  }

  const objects = new Map<string, ObjectDef>();
  for (const obj of Array.from(doc.getElementsByTagName('object'))) {
    const id = obj.getAttribute('id') ?? '';
    const def: ObjectDef = {
      name: obj.getAttribute('name') || `${fileName} ${id}`,
      color: materials.get(obj.getAttribute('pid') ?? '')?.[Number(obj.getAttribute('pindex') ?? 0)],
      components: [],
    };
    const meshEl = obj.getElementsByTagName('mesh')[0];
    if (meshEl) {
      const positions: number[] = [];
      for (const v of Array.from(meshEl.getElementsByTagName('vertex'))) {
        positions.push(Number(v.getAttribute('x')), Number(v.getAttribute('y')), Number(v.getAttribute('z')));
      }
      const triangles: number[] = [];
      for (const t of Array.from(meshEl.getElementsByTagName('triangle'))) {
        triangles.push(Number(t.getAttribute('v1')), Number(t.getAttribute('v2')), Number(t.getAttribute('v3')));
      }
      def.mesh = { positions, triangles };
    }
    for (const c of Array.from(obj.getElementsByTagName('component'))) {
      def.components.push({ objectId: c.getAttribute('objectid') ?? '', transform: parseMatrix(c.getAttribute('transform')) });
    }
    objects.set(id, def);
  }

  /** Appiattisce un oggetto (e i suoi componenti) in un'unica mesh nel sistema del chiamante. */
  const flatten = (id: string, matrix: Matrix, out: { positions: number[]; indices: number[] }, depth = 0): void => {
    const def = objects.get(id);
    if (!def || depth > 16) return;
    if (def.mesh) {
      const base = out.positions.length / 3;
      for (let i = 0; i < def.mesh.positions.length; i += 3) {
        const [x, y, z] = [def.mesh.positions[i], def.mesh.positions[i + 1], def.mesh.positions[i + 2]];
        out.positions.push(
          (x * matrix[0] + y * matrix[3] + z * matrix[6] + matrix[9]) * scale,
          (x * matrix[1] + y * matrix[4] + z * matrix[7] + matrix[10]) * scale,
          (x * matrix[2] + y * matrix[5] + z * matrix[8] + matrix[11]) * scale,
        );
      }
      for (const t of def.mesh.triangles) out.indices.push(base + t);
    }
    for (const c of def.components) flatten(c.objectId, multiply(c.transform, matrix), out, depth + 1);
  };

  // Una mesh per ogni voce di build; senza build, una per ogni oggetto con geometria
  const items = Array.from(doc.getElementsByTagName('item')).map((it) => ({ id: it.getAttribute('objectid') ?? '', transform: parseMatrix(it.getAttribute('transform')) }));
  const roots = items.length ? items : [...objects.keys()].filter((id) => objects.get(id)?.mesh).map((id) => ({ id, transform: IDENTITY }));

  const result: ImportedMesh[] = [];
  for (const root of roots) {
    const out = { positions: [] as number[], indices: [] as number[] };
    flatten(root.id, root.transform, out);
    if (!out.indices.length) continue;
    const bad = out.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= out.positions.length / 3);
    if (bad) throw new ImportError('Il modello 3MF contiene triangoli con indici di vertice non validi.');
    const def = objects.get(root.id)!;
    result.push({ name: def.name, color: def.color, positions: new Float32Array(out.positions), indices: new Uint32Array(out.indices) });
  }
  if (!result.length) throw new ImportError('Il file 3MF non contiene geometria.');
  return result;
}
