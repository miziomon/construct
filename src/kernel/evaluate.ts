import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { PrimitiveNode, Scene, SceneNode, Vec3 } from '../scene/types';

/** Risultato del calcolo per un oggetto alla radice della scena (mesh in mm, Z verso l'alto). */
export interface NodeMesh {
  id: string;
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

export interface EvalResult {
  meshes: NodeMesh[];
  /** Durata del calcolo in millisecondi. */
  ms: number;
}

/** Raggio/dimensione minima accettata dal kernel: evita geometrie degeneri. */
const EPS = 0.01;

/**
 * Valuta la scena con manifold-3d. Mantiene una cache dei Manifold per sottoalbero:
 * modificando un nodo si ricalcolano solo lui e i suoi antenati.
 * Gli oggetti WASM non sono gestiti dal garbage collector: ogni handle va liberato con delete().
 */
export class Evaluator {
  private cache = new Map<string, Manifold>();
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
    const { id: _id, name: _name, color: _color, mode: _mode, type: _type, ...geometry } = node;
    return `P${JSON.stringify(geometry)}`;
  }

  /** Costruisce la primitiva centrata nell'origine, senza trasformazioni. */
  private primitive(p: PrimitiveNode): Manifold {
    const { Manifold, CrossSection } = this.wasm;
    switch (p.kind) {
      case 'box':
        return Manifold.cube(p.size.map((v) => Math.max(EPS, v)) as Vec3, true);
      case 'cylinder': {
        const r = Math.max(EPS, p.radius);
        return Manifold.cylinder(Math.max(EPS, p.height), r, r, p.segments, true);
      }
      case 'cone': {
        const h = Math.max(EPS, p.height);
        const rb = Math.max(0, p.radiusBottom);
        const rt = Math.max(0, p.radiusTop);
        // manifold richiede il raggio inferiore positivo: se è nullo si costruisce capovolto
        if (rb === 0 && rt > 0) return Manifold.cylinder(h, rt, 0, p.segments, true).rotate([180, 0, 0]);
        return Manifold.cylinder(h, Math.max(EPS, rb), rt, p.segments, true);
      }
      case 'sphere':
        return Manifold.sphere(Math.max(EPS, p.radius), p.segments);
      case 'torus': {
        // Cerchio di sezione spostato dall'asse e ruotato attorno a Z
        const section = CrossSection.circle(Math.max(EPS, p.minorRadius), p.segments).translate([p.majorRadius, 0]);
        const torus = section.revolve(p.segments);
        section.delete();
        return torus;
      }
    }
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
      const solids = kids.filter((k) => k.mode === 'solid').map((k) => this.build(scene, k));
      const holes = kids.filter((k) => k.mode === 'hole').map((k) => this.build(scene, k));
      const base = node.op === 'union' ? Manifold.union(solids) : solids.length ? Manifold.intersection(solids) : Manifold.union([]);
      local = holes.length ? Manifold.difference([base, ...holes]) : base;
      // Se nessuna sottrazione è avvenuta, base è già il risultato: niente da liberare
      if (local !== base) base.delete();
    }

    const placed = local.rotate(node.rotation).translate(node.position);
    local.delete();
    this.cache.set(key, placed);
    return placed;
  }

  /** Valuta tutti gli oggetti alla radice e libera dalla cache i nodi non più presenti. */
  evaluate(scene: Scene): EvalResult {
    const t0 = performance.now();
    this.touched.clear();
    const meshes: NodeMesh[] = [];

    for (const id of scene.rootIds) {
      const node = scene.nodes[id];
      const m = this.build(scene, node);
      meshes.push(toMesh(node, m));
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

  /** Unione di tutti i solid alla radice (per export STL). L'handle restituito va liberato dal chiamante. */
  unionOfSolids(scene: Scene): Manifold {
    this.touched.clear();
    const parts = scene.rootIds
      .map((id) => scene.nodes[id])
      .filter((n) => n.mode === 'solid')
      .map((n) => this.build(scene, n));
    return this.wasm.Manifold.union(parts);
  }

  /** Libera tutta la cache. */
  dispose(): void {
    for (const h of this.cache.values()) h.delete();
    this.cache.clear();
  }
}

/** Converte un Manifold in buffer pronti per three.js, esportatori e misure. */
export function toMesh(node: SceneNode, m: Manifold): NodeMesh {
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
    color: node.color,
    isHole: node.mode === 'hole',
    positions,
    indices: mesh.triVerts.slice(),
    volume: empty ? 0 : m.volume(),
    bbox: { min: [...box.min] as Vec3, max: [...box.max] as Vec3 },
    status: m.status(),
    empty,
  };
}
