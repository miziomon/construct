import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { CORNER_SPHERE_SEGMENTS, twistDivisions } from '../scene/defaults';
import { stretchFactors } from '../scene/ellipse';
import { maxPolyhedronRadius, polygonMaxRadius, polygonShrunkRadius, polyhedronVertices, roundedPolyhedronCenters } from '../scene/polyhedra';
import type { MeshNode, PrimitiveNode, Scene, SceneNode, Shape2DNode, Vec3 } from '../scene/types';

/** Risultato del calcolo per un oggetto (mesh in mm, Z verso l'alto). Un Raggruppa produce una mesh per ogni figlio. */
export interface NodeMesh {
  id: string;
  /** Oggetto alla radice che contiene questo nodo (è il nodo stesso se sta alla radice). */
  rootId: string;
  /** Id degli antenati dalla radice al nodo, nodo incluso: serve a selezione e contorni. */
  path: string[];
  color: string;
  /** Un hole alla radice non sottrae nulla: si mostra traslucido e non si esporta. */
  isHole: boolean;
  /** Coordinate xyz consecutive. */
  positions: Float32Array;
  /** Indici dei triangoli, orientati in senso antiorario. */
  indices: Uint32Array;
  /** Volume in mm³. */
  volume: number;
  bbox: { min: Vec3; max: Vec3 };
  /** "NoError" se la mesh è valida e manifold. */
  status: string;
  empty: boolean;
}

/** Esito della registrazione di una mesh importata. */
export interface AssetCheck {
  ok: boolean;
  /** "NoError" oppure il motivo del rifiuto, già leggibile. */
  status: string;
  triangles: number;
  volume: number;
}

export interface EvalResult {
  meshes: NodeMesh[];
  /** Durata del calcolo in millisecondi. */
  ms: number;
}

/** Raggio/dimensione minima accettata dal kernel: evita geometrie degeneri. */
const EPS = 0.01;
/** Segmenti per giro intero degli angoli arrotondati dei quadrati 2D (8 per ogni angolo retto). */
const CORNER_SEGMENTS = 32;


/**
 * Valuta la scena con manifold-3d. Mantiene una cache dei Manifold per sottoalbero:
 * modificando un nodo si ricalcolano solo lui e i suoi antenati.
 * Gli oggetti WASM non sono gestiti dal garbage collector: ogni handle va liberato con delete().
 */
export class Evaluator {
  private cache = new Map<string, Manifold>();
  /** Mesh importate: restano per tutta la sessione, non fanno parte della cache a scansione. */
  private assets = new Map<string, Manifold>();
  /** Chiavi toccate nella valutazione corrente, per liberare le altre a fine giro. */
  private touched = new Set<string>();

  constructor(private readonly wasm: ManifoldToplevel) {}

  /** Chiave di cache: dipende dai soli parametri geometrici e trasformazione, non da id, nome, colore, modo. */
  private key(scene: Scene, node: SceneNode): string {
    if (node.type === 'group') {
      const kids = node.children.map((c) => {
        const k = this.key(scene, scene.nodes[c]);
        return `${scene.nodes[c].mode === 'hole' ? '-' : '+'}${k}`;
      });
      return `G(${node.op},${node.position},${node.rotation})[${kids.join('|')}]`;
    }
    const { id: _id, name: _name, color: _color, mode: _mode, locked: _locked, ...geometry } = node;
    // Il tipo resta nella chiave: primitive e forme 2D hanno campi diversi
    return `P${JSON.stringify(geometry)}`;
  }

  /**
   * Rende ellittica una forma costruita con il raggio X: scala Y e Z dei fattori di `stretchFactors`
   * (cilindri, coni e sfere non proporzionali). Libera la forma originale.
   */
  private stretch(m: Manifold, p: PrimitiveNode): Manifold {
    const f = stretchFactors(p);
    if (!f) return m;
    const scaled = m.scale(f);
    m.delete();
    return scaled;
  }

  /** Costruisce la primitiva centrata nell'origine, senza trasformazioni. */
  private primitive(p: PrimitiveNode): Manifold {
    const { Manifold, CrossSection } = this.wasm;
    switch (p.kind) {
      case 'box': {
        const size = p.size.map((v) => Math.max(EPS, v)) as Vec3;
        // Raggio limitato a metà del lato minore, lasciando un minimo di spigolo
        const r = Math.min(Math.max(0, p.cornerRadius ?? 0), (Math.min(...size) - EPS) / 2);
        if (r <= 0) return Manifold.cube(size, true);
        // Scatola arrotondata esatta e veloce: involucro convesso di otto sfere agli angoli (circa 4 ms)
        const [hx, hy, hz] = size.map((v) => v / 2 - r);
        const corners = [-hx, hx].flatMap((x) => [-hy, hy].flatMap((y) => [-hz, hz].map((z) => Manifold.sphere(r, CORNER_SPHERE_SEGMENTS).translate([x, y, z]))));
        const hull = Manifold.hull(corners);
        corners.forEach((c) => c.delete());
        return hull;
      }
      case 'cylinder': {
        const r = Math.max(EPS, p.radius);
        return this.stretch(Manifold.cylinder(Math.max(EPS, p.height), r, r, p.segments, true), p);
      }
      case 'cone': {
        const h = Math.max(EPS, p.height);
        const rb = Math.max(0, p.radiusBottom);
        const rt = Math.max(0, p.radiusTop);
        // manifold richiede il raggio inferiore positivo: se è nullo si costruisce capovolto
        if (rb === 0 && rt > 0) return this.stretch(Manifold.cylinder(h, rt, 0, p.segments, true).rotate([180, 0, 0]), p);
        return this.stretch(Manifold.cylinder(h, Math.max(EPS, rb), rt, p.segments, true), p);
      }
      case 'sphere':
        return this.stretch(Manifold.sphere(Math.max(EPS, p.radius), p.segments), p);
      case 'torus': {
        // Cerchio di sezione spostato dall'asse e ruotato attorno a Z
        const section = CrossSection.circle(Math.max(EPS, p.minorRadius), p.segments).translate([p.majorRadius, 0]);
        const torus = section.revolve(p.segments);
        section.delete();
        return torus;
      }
      case 'octahedron':
      case 'decahedron':
      case 'dodecahedron':
      case 'icosahedron': {
        const size = Math.max(EPS, p.size);
        const r = Math.min(Math.max(0, p.cornerRadius), maxPolyhedronRadius(size));
        if (r <= 0) return Manifold.hull(polyhedronVertices(p.kind, size));
        // Solido arrotondato: involucro convesso di sfere sui vertici del solido ridotto (le facce restano a size/2)
        const spheres = roundedPolyhedronCenters(p.kind, size, r).map((c) => Manifold.sphere(r, CORNER_SPHERE_SEGMENTS).translate(c));
        const hull = Manifold.hull(spheres);
        spheres.forEach((m) => m.delete());
        return hull;
      }
    }
  }

  /**
   * Registra una mesh importata. Fonde i vertici coincidenti (l'STL non li condivide) e accetta
   * solo solidi chiusi e manifold con volume positivo, gli unici su cui le booleane sono affidabili.
   */
  registerAsset(id: string, positions: Float32Array, indices: Uint32Array): AssetCheck {
    const { Mesh, Manifold } = this.wasm;
    const reject = (status: string): AssetCheck => ({ ok: false, status, triangles: indices.length / 3, volume: 0 });
    let solid: Manifold | undefined;
    try {
      const mesh = new Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
      mesh.merge();
      solid = new Manifold(mesh);
    } catch (err) {
      return reject(err instanceof Error ? err.message : String(err));
    }
    const status = solid.status();
    if (status !== 'NoError' || solid.isEmpty()) {
      solid.delete();
      return reject(status !== 'NoError' ? status : 'EmptyMesh');
    }
    // Una mesh con le facce rivolte verso l'interno ha volume negativo
    if (solid.volume() <= 0) {
      solid.delete();
      return reject('NegativeVolume');
    }
    this.assets.get(id)?.delete();
    this.assets.set(id, solid);
    return { ok: true, status: 'NoError', triangles: solid.numTri(), volume: solid.volume() };
  }

  /** Mesh importata nelle sue dimensioni, già scalata e centrata sull'origine dell'asset. */
  private meshNode(p: MeshNode): Manifold {
    const base = this.assets.get(p.assetId);
    if (!base) throw new Error(`Mesh importata non disponibile (${p.fileName}): reimporta il file.`);
    const s = Math.max(0.001, p.scale);
    return base.scale([s, s, s]);
  }

  /** Forma 2D estrusa lungo Z, centrata nell'origine. */
  private shape2d(p: Shape2DNode): Manifold {
    const { Manifold, CrossSection } = this.wasm;
    let section;
    if (p.kind === 'circle') {
      // Il primo vertice sta a +X, come circle($fn=n) di OpenSCAD
      const radius = Math.max(EPS, p.radius);
      const rc = Math.min(Math.max(0, p.cornerRadius ?? 0), polygonMaxRadius(radius, p.segments));
      if (rc > 0) {
        // Poligono ridotto (stesso inraggio meno rc) e offset arrotondato: angoli arrotondati senza booleane 3D
        const inner = CrossSection.circle(polygonShrunkRadius(radius, p.segments, rc), p.segments);
        section = inner.offset(rc, 'Round', 2, CORNER_SEGMENTS);
        inner.delete();
      } else {
        section = CrossSection.circle(radius, p.segments);
      }
    } else {
      const w = Math.max(EPS, p.width);
      const d = Math.max(EPS, p.depth);
      // Il raggio non può superare metà del lato minore
      const r = Math.min(Math.max(0, p.cornerRadius), (Math.min(w, d) - EPS) / 2);
      if (r > 0) {
        // Quadrato ridotto di r per lato, poi offset arrotondato: angoli esatti senza booleane 3D
        const inner = CrossSection.square([w - 2 * r, d - 2 * r], true);
        section = inner.offset(r, 'Round', 2, CORNER_SEGMENTS);
        inner.delete();
      } else {
        section = CrossSection.square([w, d], true);
      }
    }
    // Cerchio non proporzionale: l'ellisse si ottiene scalando il profilo (anche già arrotondato)
    const f = stretchFactors(p);
    if (f) {
      const stretched = section.scale([f[0], f[1]]);
      section.delete();
      section = stretched;
    }
    const divisions = twistDivisions(p.twist);
    // La scala va passata come vettore [x, y]: con un numero singolo manifold 3.5 produce un prisma dimezzato
    const scale = Math.max(0, p.scaleTop);
    const solid = Manifold.extrude(section, Math.max(EPS, p.height), divisions, p.twist, [scale, scale], true);
    section.delete();
    return solid;
  }

  /** Restituisce il Manifold del nodo (già trasformato nello spazio del genitore). Di proprietà della cache. */
  private build(scene: Scene, node: SceneNode): Manifold {
    const key = this.key(scene, node);
    this.touched.add(key);
    const cached = this.cache.get(key);
    if (cached) return cached;

    let local: Manifold;
    if (node.type === 'primitive') {
      local = this.primitive(node);
    } else if (node.type === 'shape2d') {
      local = this.shape2d(node);
    } else if (node.type === 'mesh') {
      local = this.meshNode(node);
    } else {
      // Gruppo: solid combinati con union/intersection, poi si sottrae l'unione degli hole
      const kids = node.children.map((c) => scene.nodes[c]);
      const { Manifold } = this.wasm;
      if (node.op === 'difference') {
        // Differenza: il primo figlio è la base, tutti gli altri vengono sottratti
        const parts = kids.map((k) => this.build(scene, k));
        const result = parts.length ? Manifold.difference(parts) : Manifold.union([]);
        const placed = result.rotate(node.rotation).translate(node.position);
        result.delete();
        this.cache.set(key, placed);
        return placed;
      }
      // Il Raggruppa (op 'group') dentro una booleana equivale a una unione di tutti i figli: non ha fori
      const isGroup = node.op === 'group';
      const solids = kids.filter((k) => isGroup || k.mode === 'solid').map((k) => this.build(scene, k));
      const holes = isGroup ? [] : kids.filter((k) => k.mode === 'hole').map((k) => this.build(scene, k));
      const base = node.op === 'union' || isGroup ? Manifold.union(solids) : solids.length ? Manifold.intersection(solids) : Manifold.union([]);
      local = holes.length ? Manifold.difference([base, ...holes]) : base;
      // Se nessuna sottrazione è avvenuta, base è già il risultato: niente da liberare
      if (local !== base) base.delete();
    }

    const placed = local.rotate(node.rotation).translate(node.position);
    local.delete();
    this.cache.set(key, placed);
    return placed;
  }

  /**
   * Visita i nodi che producono una mesh a partire da `node`: un Raggruppa non fonde i figli, quindi si scende
   * fino a ogni figlio, che viene portato nel sistema esterno con le trasformazioni di tutti i gruppi antenati
   * (dal più interno al più esterno). Booleane e forme singole sono una sola mesh. La mesh passata alla callback
   * va solo letta: se è una copia temporanea viene liberata subito dopo.
   */
  private visit(scene: Scene, node: SceneNode, ancestors: SceneNode[], visitor: (node: SceneNode, m: Manifold, path: string[]) => void): void {
    if (node.type === 'group' && node.op === 'group') {
      for (const c of node.children) this.visit(scene, scene.nodes[c], [...ancestors, node], visitor);
      return;
    }
    let m = this.build(scene, node);
    let temporary = false;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const next = m.rotate(ancestors[i].rotation).translate(ancestors[i].position);
      if (temporary) m.delete();
      m = next;
      temporary = true;
    }
    visitor(node, m, [...ancestors.map((a) => a.id), node.id]);
    if (temporary) m.delete();
  }

  /** Valuta tutti gli oggetti alla radice e libera dalla cache i nodi non più presenti. */
  evaluate(scene: Scene): EvalResult {
    const t0 = performance.now();
    this.touched.clear();
    const meshes: NodeMesh[] = [];

    for (const id of scene.rootIds) {
      // I figli di un Raggruppa sono sempre solidi: un foro ha senso solo come differenza tra oggetti
      this.visit(scene, scene.nodes[id], [], (node, m, path) => meshes.push(toMesh(node, m, id, path)));
    }

    // Mark and sweep: libera la memoria WASM dei sottoalberi non più usati
    for (const [key, handle] of this.cache) {
      if (!this.touched.has(key)) {
        handle.delete();
        this.cache.delete(key);
      }
    }
    return { meshes, ms: performance.now() - t0 };
  }

  /** Unione di tutti i solid (per export STL), compresi i figli dei Raggruppa. L'handle restituito va liberato dal chiamante. */
  unionOfSolids(scene: Scene): Manifold {
    this.touched.clear();
    const parts: Manifold[] = [];
    for (const id of scene.rootIds) {
      const root = scene.nodes[id];
      if (root.mode !== 'solid') continue;
      // La callback riceve una mesh che può essere temporanea: se ne tiene una copia leggera (condivide i dati)
      this.visit(scene, root, [], (_node, m) => parts.push(m.translate([0, 0, 0])));
    }
    const union = this.wasm.Manifold.union(parts);
    for (const p of parts) p.delete();
    return union;
  }

  /** Libera tutta la cache. */
  dispose(): void {
    for (const h of this.cache.values()) h.delete();
    this.cache.clear();
    for (const h of this.assets.values()) h.delete();
    this.assets.clear();
  }
}

/** Converte un Manifold in buffer pronti per three.js, esportatori e misure. */
export function toMesh(node: SceneNode, m: Manifold, rootId: string = node.id, path: string[] = [node.id]): NodeMesh {
  const mesh = m.getMesh();
  const stride = mesh.numProp;
  // Le prime tre proprietà sono xyz: se ne esistono altre le scartiamo
  let positions: Float32Array;
  if (stride === 3) {
    positions = mesh.vertProperties.slice();
  } else {
    positions = new Float32Array((mesh.vertProperties.length / stride) * 3);
    for (let i = 0, n = mesh.vertProperties.length / stride; i < n; i++) {
      positions.set(mesh.vertProperties.subarray(i * stride, i * stride + 3), i * 3);
    }
  }
  const empty = m.isEmpty();
  const box = empty ? { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 } : m.boundingBox();
  return {
    id: node.id,
    rootId,
    path,
    color: node.color,
    // Solo un foro alla radice si mostra come tale: dentro un Raggruppa tutto è solido
    isHole: node.mode === 'hole' && path.length === 1,
    positions,
    indices: mesh.triVerts.slice(),
    volume: empty ? 0 : m.volume(),
    bbox: { min: [...box.min] as Vec3, max: [...box.max] as Vec3 },
    status: m.status(),
    empty,
  };
}
