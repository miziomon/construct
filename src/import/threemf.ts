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
  /** Nome dichiarato nel file (assente se l'oggetto non ne ha uno). */
  name?: string;
  color?: string;
  mesh?: { positions: number[]; triangles: number[] };
  /** `path` è il file dell'oggetto referenziato (estensione di produzione `p:path`); assente = stesso file. */
  components: { path?: string; objectId: string; transform: Matrix }[];
}

/** Un file `.model` dell'archivio, già letto. */
interface ModelFile {
  scale: number;
  objects: Map<string, ObjectDef>;
  items: { id: string; transform: Matrix }[];
}

/** Nome e colore di oggetti e parti dalle impostazioni di Bambu Studio (Metadata/model_settings.config). */
interface PartSettings {
  name?: string;
  extruder?: number;
}
interface ObjectSettings extends PartSettings {
  parts: Map<string, PartSettings>;
}

/** "#RRGGBBAA" → "#rrggbb" */
const cssColor = (displaycolor: string | null | undefined) => (displaycolor && /^#[0-9a-f]{6}/i.test(displaycolor) ? displaycolor.slice(0, 7).toLowerCase() : undefined);

/** Percorso normalizzato per il confronto: senza "/" iniziale e in minuscolo. */
const normalize = (path: string) => path.replace(/^\/+/, '').toLowerCase();

/** Legge nome ed estrusore dai `<metadata key=... value=...>` figli di un elemento. */
function readMetadata(el: Element): PartSettings {
  const out: PartSettings = {};
  for (const child of Array.from(el.children)) {
    if (child.tagName !== 'metadata') continue;
    const value = child.getAttribute('value');
    if (child.getAttribute('key') === 'name' && value) out.name = value;
    if (child.getAttribute('key') === 'extruder' && value && Number.isFinite(Number(value))) out.extruder = Number(value);
  }
  return out;
}

/**
 * Impostazioni di Bambu Studio, se presenti: nomi delle parti ed estrusore di ognuna, e colori dei filamenti.
 * Sono informazioni accessorie: qualunque problema di lettura le ignora, l'import della geometria prosegue.
 */
function readBambuSettings(files: Record<string, Uint8Array>, parser: DOMParser): { objects: Map<string, ObjectSettings>; filaments: string[] } {
  const objects = new Map<string, ObjectSettings>();
  let filaments: string[] = [];
  try {
    const settingsFile = files['Metadata/model_settings.config'];
    if (settingsFile) {
      const doc = parser.parseFromString(strFromU8(settingsFile), 'application/xml');
      for (const obj of Array.from(doc.getElementsByTagName('object'))) {
        const parts = new Map<string, PartSettings>();
        for (const part of Array.from(obj.children).filter((c) => c.tagName === 'part')) parts.set(part.getAttribute('id') ?? '', readMetadata(part));
        objects.set(obj.getAttribute('id') ?? '', { ...readMetadata(obj), parts });
      }
    }
    const projectFile = files['Metadata/project_settings.config'];
    if (projectFile) {
      const colours = (JSON.parse(strFromU8(projectFile)) as { filament_colour?: unknown }).filament_colour;
      if (Array.isArray(colours)) filaments = colours.map((c) => cssColor(String(c)) ?? '');
    }
  } catch {
    // Impostazioni illeggibili: restano senza nomi e colori
  }
  return { objects, filaments };
}

/**
 * Legge un file 3MF: ogni voce di `<build>` diventa una mesh (componenti e trasformazioni incluse),
 * con unità convertite in millimetri e il colore del materiale se presente.
 *
 * Estensione di produzione (Bambu Studio, Orca Slicer): le mesh stanno in file `.model` a parte e le voci di
 * build le richiamano con `p:path`. In quel caso ogni componente diventa una mesh separata, con nome e colore
 * letti dalle impostazioni di Bambu Studio quando ci sono: un assemblato resta un insieme di parti distinte.
 * Limiti: niente texture.
 */
export function parse3mf(buffer: ArrayBuffer, fileName: string, parser: DOMParser = new DOMParser()): ImportedMesh[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new ImportError('Il file 3MF non è un archivio valido.');
  }
  const mainPath = Object.keys(files).find((p) => /^3d\/[^/]*\.model$/i.test(p));
  if (!mainPath) throw new ImportError('Il file 3MF non contiene un modello (3D/3dmodel.model).');

  // Nomi dei file `.model` dell'archivio, cercati senza distinguere maiuscole e "/" iniziale
  const modelPaths = new Map(Object.keys(files).filter((p) => /\.model$/i.test(p)).map((p) => [normalize(p), p]));

  /** Legge un file `.model` (una sola volta) e ne indicizza gli oggetti. */
  const cache = new Map<string, ModelFile>();
  const readModel = (key: string): ModelFile | undefined => {
    const path = modelPaths.get(normalize(key));
    if (!path) return undefined;
    const cached = cache.get(path);
    if (cached) return cached;

    const doc = parser.parseFromString(strFromU8(files[path]), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new ImportError('Il modello 3MF contiene XML non valido.');
    const model = doc.documentElement;

    // Materiali di base: id → elenco dei colori
    const materials = new Map<string, (string | undefined)[]>();
    for (const bm of Array.from(doc.getElementsByTagName('basematerials'))) {
      materials.set(bm.getAttribute('id') ?? '', Array.from(bm.getElementsByTagName('base')).map((b) => cssColor(b.getAttribute('displaycolor'))));
    }

    const objects = new Map<string, ObjectDef>();
    for (const obj of Array.from(doc.getElementsByTagName('object'))) {
      const def: ObjectDef = {
        name: obj.getAttribute('name') || undefined,
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
        def.components.push({ path: c.getAttribute('p:path') || undefined, objectId: c.getAttribute('objectid') ?? '', transform: parseMatrix(c.getAttribute('transform')) });
      }
      objects.set(obj.getAttribute('id') ?? '', def);
    }

    const items = Array.from(doc.getElementsByTagName('item')).map((it) => ({ id: it.getAttribute('objectid') ?? '', transform: parseMatrix(it.getAttribute('transform')) }));
    const file: ModelFile = { scale: UNIT_TO_MM[model.getAttribute('unit') ?? 'millimeter'] ?? 1, objects, items };
    cache.set(path, file);
    return file;
  };

  const main = readModel(mainPath)!;

  /** Appiattisce un oggetto (e i suoi componenti) in un'unica mesh nel sistema del chiamante. */
  const flatten = (file: string, id: string, matrix: Matrix, out: { positions: number[]; indices: number[] }, depth = 0): void => {
    const model = readModel(file);
    const def = model?.objects.get(id);
    if (!model || !def || depth > 16) return;
    if (def.mesh) {
      const base = out.positions.length / 3;
      for (let i = 0; i < def.mesh.positions.length; i += 3) {
        const [x, y, z] = [def.mesh.positions[i], def.mesh.positions[i + 1], def.mesh.positions[i + 2]];
        out.positions.push(
          (x * matrix[0] + y * matrix[3] + z * matrix[6] + matrix[9]) * model.scale,
          (x * matrix[1] + y * matrix[4] + z * matrix[7] + matrix[10]) * model.scale,
          (x * matrix[2] + y * matrix[5] + z * matrix[8] + matrix[11]) * model.scale,
        );
      }
      for (const t of def.mesh.triangles) out.indices.push(base + t);
    }
    for (const c of def.components) flatten(c.path ?? file, c.objectId, multiply(c.transform, matrix), out, depth + 1);
  };

  const bambu = readBambuSettings(files, parser);
  /** Colore del filamento dell'estrusore indicato (numerato da 1), se la tavolozza lo conosce. */
  const filamentColor = (extruder: number | undefined) => (extruder ? bambu.filaments[extruder - 1] || undefined : undefined);

  // Mesh da produrre: file e oggetto di partenza, trasformazione, nome e colore
  interface Root { file: string; id: string; matrix: Matrix; name: string; color?: string }
  const roots: Root[] = [];
  const items = main.items.length ? main.items : [...main.objects.keys()].filter((id) => main.objects.get(id)?.mesh).map((id) => ({ id, transform: IDENTITY }));
  for (const item of items) {
    const def = main.objects.get(item.id);
    const objectSettings = bambu.objects.get(item.id);
    const itemName = def?.name ?? objectSettings?.name ?? `${fileName} ${item.id}`;
    if (def && !def.mesh && def.components.some((c) => c.path)) {
      // Estensione di produzione: una mesh per componente, con la sua trasformazione composta con quella della voce
      def.components.forEach((c, index) => {
        const file = c.path ?? mainPath;
        const part = objectSettings?.parts.get(c.objectId);
        roots.push({
          file,
          id: c.objectId,
          matrix: multiply(c.transform, item.transform),
          name: part?.name ?? readModel(file)?.objects.get(c.objectId)?.name ?? `${itemName} ${index + 1}`,
          color: readModel(file)?.objects.get(c.objectId)?.color ?? filamentColor(part?.extruder ?? objectSettings?.extruder),
        });
      });
    } else {
      roots.push({ file: mainPath, id: item.id, matrix: item.transform, name: itemName, color: def?.color });
    }
  }

  const result: ImportedMesh[] = [];
  for (const root of roots) {
    const out = { positions: [] as number[], indices: [] as number[] };
    flatten(root.file, root.id, root.matrix, out);
    if (!out.indices.length) continue;
    const bad = out.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= out.positions.length / 3);
    if (bad) throw new ImportError('Il modello 3MF contiene triangoli con indici di vertice non validi.');
    result.push({ name: root.name, color: root.color, positions: new Float32Array(out.positions), indices: new Uint32Array(out.indices) });
  }
  if (!result.length) throw new ImportError('Il file 3MF non contiene geometria.');
  return result;
}
