import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { CORNER_SPHERE_SEGMENTS, twistDivisions } from '../scene/defaults';
import { edgeProfile, endMargin, endOvershoot, endPlanesOf, hasPerpendicularEnds } from '../scene/edgeProfile';
import { resolveEnds } from '../scene/edgeEnds';
import { stretchFactors } from '../scene/ellipse';
import { buildPattern } from './pattern';
import { subdivideContours, twistPieceLength } from './twist';
import { minkowskiOf } from './minkowski';
import { arrayCopies } from '../scene/arrayPattern';
import type { CopyTransform } from '../scene/arrayPattern';
import { isRotational, revolveParams, shapeContours, svgContours } from '../scene/shapes2d';
import { textContours } from '../scene/fontOutline';
import { fontInfo } from '../scene/fontCatalog';
import { cavityOf, SHELL_OPEN_MARGIN } from '../scene/shell';
import { cornerCutter } from '../scene/cornerProfile';
import { maxPolyhedronRadius, polygonMaxRadius, polygonShrunkRadius, polyhedronVertices, roundedPolyhedronCenters } from '../scene/polyhedra';
import type { Transform } from '../scene/math';
import type { CornerNode, EdgeNode, GroupNode, MeshNode, PrimitiveNode, Scene, SceneNode, Shape2DNode, ShellParams, Vec3 } from '../scene/types';

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
      // La chiave di un gruppo contiene quella dei figli (con il segno: '+' solid, '-' hole) in ordine:
      // cambiando un figlio, l'ordine, il modo o l'operazione cambia la chiave e il gruppo si ricalcola.
      const kids = node.children.map((c) => {
        const k = this.key(scene, scene.nodes[c]);
        return `${scene.nodes[c].mode === 'hole' ? '-' : '+'}${k}`;
      });
      // Il Guscio ha in più i suoi spessori (e l'ingombro usato dalla cavità scalata)
      const shell = node.op === 'shell' ? `,${JSON.stringify(node.shell ?? null)}` : node.op === 'array' ? `,${JSON.stringify(node.array ?? null)}` : node.op === 'pattern' ? `,${JSON.stringify(node.pattern ?? null)}` : '';
      return `G(${node.op},${node.position},${node.rotation}${node.mirror ? `,m${node.mirror.map(Number)}` : ''}${node.groupScale ? `,s${node.groupScale}` : ''}${shell})[${kids.join('|')}]`;
    }
    const { id: _id, name: _name, color: _color, mode: _mode, locked: _locked, lockRatio: _lockRatio, ...geometry } = node;
    // Il taglierino che chiude l'estremità su uno smusso dipende anche dai valori correnti di quello smusso
    const live = node.type === 'edge' && node.endVia ? `|${JSON.stringify(resolveEnds(scene, node))}` : '';
    // Il tipo resta nella chiave: primitive e forme 2D hanno campi diversi
    return `P${JSON.stringify(geometry)}${live}`;
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

  /**
   * Porta un Manifold dal sistema locale di un nodo a quello del genitore: prima la scala (solo gruppi), poi lo specchio (per asse), la
   * rotazione e infine la traslazione. Restituisce un nuovo Manifold; `m` resta del chiamante.
   */
  private place(m: Manifold, t: Transform): Manifold {
    let current = m;
    // Un gruppo ridimensionato: la scala per asse è la prima operazione, nel suo sistema locale
    if (t.groupScale?.some((v) => v !== 1)) current = current.scale(t.groupScale);
    t.mirror?.forEach((on, axis) => {
      if (!on) return;
      // Manifold::Mirror rovescia anche il verso dei triangoli: il solido resta valido
      const next = current.mirror([axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]);
      if (current !== m) current.delete();
      current = next;
    });
    const rotated = current.rotate(t.rotation);
    if (current !== m) current.delete();
    const placed = rotated.translate(t.position);
    rotated.delete();
    return placed;
  }

  /**
   * Copia di una Ripetizione: l'originale (di proprietà della cache, non si libera) ruotato attorno al pivot e traslato.
   * Restituisce sempre un nuovo Manifold, anche per la copia che non si muove.
   */
  private copyOf(original: Manifold, t: CopyTransform): Manifold {
    let current = original;
    if (t.rotation.some((v) => v !== 0)) {
      const toPivot = current.translate([-t.pivot[0], -t.pivot[1], -t.pivot[2]]);
      const turned = toPivot.rotate(t.rotation);
      toPivot.delete();
      current = turned.translate(t.pivot);
      turned.delete();
    }
    if (t.translate.some((v) => v !== 0)) {
      const moved = current.translate(t.translate);
      if (current !== original) current.delete();
      return moved;
    }
    // Nessuno spostamento: una copia vera, perché chi chiama libera tutte le copie
    return current === original ? original.translate([0, 0, 0]) : current;
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

  /**
   * Taglierino di un raccordo o di uno smusso: sezione 2D (triangolo, meno il cerchio per il raccordo) estrusa lungo Z
   * da 0 alla lunghezza dello spigolo. Con le estremità oblique si estrude più a lungo e si ritaglia con i piani.
   */
  private edgeCutter(p: EdgeNode): Manifold {
    const { Manifold, CrossSection } = this.wasm;
    const profile = edgeProfile(p);
    let section = new CrossSection([profile.polygon]);
    if (profile.circle) {
      const disc = CrossSection.circle(profile.circle.radius, profile.circle.segments).translate(profile.circle.center);
      const cut = section.subtract(disc);
      section.delete();
      disc.delete();
      section = cut;
    }
    const length = Math.max(EPS, p.length);
    if (hasPerpendicularEnds(p)) {
      // Un po' di abbondanza da entrambe le parti: il taglio non si ferma sulla faccia del pezzo (vedi END_OVERSHOOT)
      const over = endOvershoot(p);
      const extruded = Manifold.extrude(section, length + 2 * over);
      section.delete();
      const prism = extruded.translate([0, 0, -over]);
      extruded.delete();
      return prism;
    }
    const margin = endMargin(p);
    const long = Manifold.extrude(section, length + 2 * margin);
    section.delete();
    let prism = long.translate([0, 0, -margin]);
    long.delete();
    for (const plane of endPlanesOf(p)) {
      // trimByPlane tiene il lato verso cui punta la normale: per tenere normale·p ≤ offset si inverte
      const trimmed = prism.trimByPlane([-plane.normal[0], -plane.normal[1], -plane.normal[2]], -plane.offset);
      prism.delete();
      prism = trimmed;
    }
    return prism;
  }

  /**
   * Cavità del Guscio di `child`, già nel sistema del gruppo (stessa posizione e rotazione del figlio), oppure null
   * se le pareti non entrano nel solido. Il Manifold restituito è del chiamante, che lo deve liberare.
   */
  private shellCavity(scene: Scene, child: SceneNode, shell: ShellParams): Manifold | null {
    const cavity = cavityOf(scene, child, shell);
    if (cavity.kind === 'error') return null;

    if (cavity.kind === 'exact') {
      // Cavità esatta: la forma ridotta si costruisce centrata, si alza dello `offset` e si porta dove sta il figlio
      const shape = cavity.node.type === 'primitive' ? this.primitive(cavity.node) : this.shape2d(cavity.node);
      const lifted = shape.translate(cavity.offset);
      shape.delete();
      const placed = this.place(lifted, child);
      lifted.delete();
      return placed;
    }

    if (cavity.kind === 'parts') {
      // Cavità per figlio: ogni solido dell'unione ha la sua cavità esatta, nella sua posizione; poi si uniscono.
      // Tra due solidi uniti resta una parete interna (le cavità non si toccano), come dichiarato nel pannello
      const placed = cavity.parts.map((part) => {
        const shape = part.node.type === 'primitive' ? this.primitive(part.node) : this.shape2d(part.node);
        const lifted = shape.translate(part.offset);
        shape.delete();
        const moved = this.place(lifted, part);
        lifted.delete();
        return moved;
      });
      const union = this.wasm.Manifold.union(placed);
      placed.forEach((m) => m.delete());
      return union;
    }

    if (cavity.kind === 'prism') {
      // Cavità a prisma: la sezione del solido (già nel sistema del guscio) si restringe di w con un offset 2D e si
      // estrude dal fondo alla cima, più il margine di apertura. Pareti uniformi anche ai giunti e attorno ai fori
      const solid = this.build(scene, child);
      const section = solid.slice(cavity.zMid);
      const eroded = section.offset(-shell.wall, 'Miter', 2);
      section.delete();
      if (eroded.isEmpty()) {
        eroded.delete();
        return null;
      }
      const floor = cavity.z0 + shell.bottom;
      const prism = this.wasm.Manifold.extrude(eroded, cavity.z1 + SHELL_OPEN_MARGIN - floor).translate([0, 0, floor]);
      eroded.delete();
      return prism;
    }

    // Cavità scalata: il figlio senza posizione né rotazione (in cache, non si libera) viene scalato attorno al perno
    // (centro della base), alzato dello spessore del fondo e poi portato dove sta il figlio
    const bare = { ...child, position: [0, 0, 0], rotation: [0, 0, 0], mirror: undefined } as SceneNode;
    const base = this.build(scene, bare);
    const [px, py, pz] = cavity.pivot;
    const steps: ((m: Manifold) => Manifold)[] = [
      (m) => m.translate([-px, -py, -pz]),
      (m) => m.scale(cavity.scale),
      (m) => m.translate([px, py, pz + cavity.lift]),
      (m) => this.place(m, child),
    ];
    let current = base;
    for (const step of steps) {
      const next = step(current);
      // Il primo handle è della cache: solo gli intermedi si liberano
      if (current !== base) current.delete();
      current = next;
    }
    return current;
  }

  /**
   * Taglierino di uno smusso angolare, con il vertice nell'origine: involucro convesso del vertice e dei punti sugli
   * spigoli; per lo sferico si sottrae la sfera tangente agli spigoli (resta il materiale dentro la sfera).
   */
  private cornerCutter(p: CornerNode): Manifold {
    const { Manifold } = this.wasm;
    const cutter = cornerCutter(p);
    const hull = Manifold.hull(cutter.points);
    if (!cutter.sphere) return hull;
    const sphere = Manifold.sphere(cutter.sphere.radius, cutter.sphere.segments).translate(cutter.sphere.center);
    const cut = Manifold.difference([hull, sphere]);
    hull.delete();
    sphere.delete();
    return cut;
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
    } else if (p.kind === 'text') {
      // Contorni delle lettere: i buchi (O, A, 8) sono contorni con verso opposto, quindi regola NonZero
      const contours = textContours({ ...p, font: fontInfo(p.font).id });
      // Testo vuoto (o solo spazi): forma vuota, non un errore
      section = contours.length ? new CrossSection(contours, 'NonZero') : CrossSection.compose([]);
    } else if (p.kind === 'svg') {
      // Disegno importato: contorni scalati a width × depth, riempimento pari-dispari (i tracciati interni sono fori)
      const contours = svgContours(p);
      section = contours.length ? new CrossSection(contours, 'EvenOdd') : CrossSection.compose([]);
    } else if (p.kind !== 'square') {
      // Forme poligonali (anello, cuore, stelle, ...): il foro dell'anello è un secondo contorno, quindi regola pari-dispari
      section = new CrossSection(shapeContours(p), 'EvenOdd');
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
    // Contorno (offset 2D): ingrandisce o restringe il profilo prima di estruderlo. Se si restringe fino a farlo sparire
    // resta una sezione vuota, quindi un solido vuoto (come il testo vuoto), non un errore
    const offset = p.offset ?? 0;
    if (offset !== 0) {
      const sharp = p.offsetJoin === 'sharp';
      // Angoli vivi con un limite alto (come offset(delta) di OpenSCAD), arrotondati con gli stessi segmenti degli angoli arrotondati
      const grown = section.offset(offset, sharp ? 'Miter' : 'Round', sharp ? 1000 : 2, CORNER_SEGMENTS);
      section.delete();
      section = grown;
    }
    if (isRotational(p)) {
      // Estrusione rotazionale (rotate_extrude): il profilo si sposta di `radius` dall'asse e gira attorno a Z; la Y del
      // profilo diventa Z e la X il raggio. Manifold tiene solo la parte con x > 0 (quella oltre l'asse si scarta)
      const { angle, radius, segments } = revolveParams(p);
      const moved = section.translate([radius, 0]);
      section.delete();
      const revolved = Manifold.revolve(moved, segments, angle);
      moved.delete();
      return revolved;
    }
    const divisions = twistDivisions(p.twist);
    const height = Math.max(EPS, p.height);
    // Con la torsione i lati lunghi del profilo si spezzano in tratti corti: altrimenti i quadrilateri laterali, torti e
    // divisi in due triangoli, gonfiano o svuotano il solido (fino al 14% su un profilo sottile)
    const profile = divisions > 0 ? new CrossSection(subdivideContours(section.toPolygons(), twistPieceLength(height, divisions), divisions + 1), 'EvenOdd') : section;
    // La scala va passata come vettore [x, y]: con un numero singolo manifold 3.5 produce un prisma dimezzato
    const scale = Math.max(0, p.scaleTop);
    const solid = Manifold.extrude(profile, height, divisions, p.twist, [scale, scale], true);
    if (profile !== section) profile.delete();
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
    } else if (node.type === 'corner') {
      local = this.cornerCutter(node);
    } else if (node.type === 'edge') {
      // I piani di chiusura seguono lo smusso che chiude l'estremità, se ce n'è uno
      local = this.edgeCutter({ ...node, ends: resolveEnds(scene, node) });
    } else {
      // GRUPPO. I figli sono costruiti (o presi dalla cache) già posizionati nel sistema del gruppo; qui si
      // combinano con l'operazione del gruppo. Le mesh dei figli restano di proprietà della cache: non si liberano.
      const kids = node.children.map((c) => scene.nodes[c]);
      const { Manifold } = this.wasm;
      if (node.op === 'difference') {
        // DIFFERENZA: il primo figlio è la base, tutti gli altri vengono sottratti (il modo solid/hole è ignorato)
        const parts = kids.map((k) => this.build(scene, k));
        const result = parts.length ? Manifold.difference(parts) : Manifold.union([]);
        const placed = this.place(result, node);
        result.delete();
        this.cache.set(key, placed);
        return placed;
      }
      if (node.op === 'shell' && node.shell && kids.length === 1) {
        // GUSCIO: è una differenza automatica `figlio − cavità`, dove la cavità (stessa forma ridotta, oppure il
        // solido scalato) la ricava `shellCavity`. Se le pareti non entrano più nel solido (misure cambiate dopo la
        // creazione) non c'è cavità e il solido resta pieno invece di dare un errore a metà valutazione.
        const solid = this.build(scene, kids[0]);
        const cavity = this.shellCavity(scene, kids[0], node.shell);
        const result = cavity ? Manifold.difference([solid, cavity]) : solid.translate([0, 0, 0]);
        cavity?.delete();
        const placed = this.place(result, node);
        result.delete();
        this.cache.set(key, placed);
        return placed;
      }
      if (node.op === 'array' && node.array && kids.length === 1) {
        // RIPETIZIONE: l'originale si costruisce una volta (cache) e si piazzano le copie, poi si uniscono
        const original = this.build(scene, kids[0]);
        const copies = arrayCopies(node.array).map((t) => this.copyOf(original, t));
        const merged = copies.length ? Manifold.union(copies) : Manifold.union([]);
        copies.forEach((c) => c.delete());
        const placed = this.place(merged, node);
        merged.delete();
        this.cache.set(key, placed);
        return placed;
      }
      if (node.op === 'pattern' && node.pattern && kids.length === 1) {
        // PATTERN: il pezzo con le celle (Voronoi, esagoni, cerchi) tagliate da una faccia, oppure il reticolo 3D
        const original = this.build(scene, kids[0]);
        const result = buildPattern(this.wasm, original, node.pattern);
        const placed = this.place(result, node);
        result.delete();
        this.cache.set(key, placed);
        return placed;
      }
      // Il Raggruppa (op 'group') dentro una booleana equivale a una unione di tutti i figli: non ha fori
      const isGroup = node.op === 'group';
      // I solid sono i figli che aggiungono materiale; i hole quelli che lo tolgono dal risultato
      const solids = kids.filter((k) => isGroup || k.mode === 'solid').map((k) => this.build(scene, k));
      const holes = isGroup ? [] : kids.filter((k) => k.mode === 'hole').map((k) => this.build(scene, k));
      // UNIONE (o Raggruppa): somma di tutti i solid. INTERSEZIONE: solo la parte comune a tutti i solid.
      // INVILUPPO CONVESSO: la forma convessa più piccola che li contiene tutti (senza solidi, un insieme vuoto).
      // MINKOWSKI: somma dei solid uno dopo l'altro (il primo si espande del volume di ogni successivo)
      const base =
        node.op === 'union' || isGroup
          ? Manifold.union(solids)
          : node.op === 'hull'
            ? solids.length ? Manifold.hull(solids) : Manifold.union([])
            : node.op === 'minkowski'
              ? minkowskiOf(Manifold, solids)
              : solids.length ? Manifold.intersection(solids) : Manifold.union([]);
      // I hole si sottraggono dopo aver combinato i solid
      local = holes.length ? Manifold.difference([base, ...holes]) : base;
      // Se nessuna sottrazione è avvenuta, base è già il risultato: niente da liberare
      if (local !== base) base.delete();
    }

    const placed = this.place(local, node);
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
      const next = this.place(m, ancestors[i]);
      if (temporary) m.delete();
      m = next;
      temporary = true;
    }
    visitor(node, m, [...ancestors.map((a) => a.id), node.id]);
    if (temporary) m.delete();
  }

  /**
   * Valuta tutti gli oggetti alla radice e libera dalla cache i nodi non più presenti.
   * Passi: 1) ogni radice produce una mesh (una per figlio se è un Raggruppa); 2) le booleane (unione, intersezione,
   * differenza, guscio) sono già state calcolate da `build`, che riusa i sottoalberi non cambiati dalla cache;
   * 3) mark and sweep: si liberano i Manifold dei nodi non toccati in questo giro.
   */
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

  /**
   * Operandi "fantasma" degli oggetti indicati, come il modificatore # di OpenSCAD: i pezzi che una booleana usa ma che
   * non compaiono nel risultato (i sottratti di una differenza, i fori, la cavità del guscio) e, in un'intersezione,
   * tutti gli operandi. Le mesh sono in coordinate mondo. Usa i sottoalberi già in cache, quindi costa poco.
   */
  ghosts(scene: Scene, rootIds: string[]): NodeMesh[] {
    const out: NodeMesh[] = [];
    /** `chain` = gruppi dal più esterno a quello che contiene gli operandi. */
    const visitGroup = (group: GroupNode, chain: GroupNode[], rootId: string) => {
      const kids = group.children.map((c) => scene.nodes[c]);
      const operands = group.op === 'difference' ? kids.slice(1) : group.op === 'intersection' ? kids.filter((k) => k.mode === 'solid') : [];
      // Fori di unione e intersezione (nella differenza sono già tutti operandi sottratti)
      const holes = group.op === 'union' || group.op === 'intersection' || group.op === 'hull' || group.op === 'minkowski' ? kids.filter((k) => k.mode === 'hole') : [];
      /** Porta un Manifold dal sistema del gruppo al mondo e lo converte in mesh. */
      const emit = (node: SceneNode, m: Manifold, owned: boolean) => {
        let current = m;
        let temporary = owned;
        for (let i = chain.length - 1; i >= 0; i--) {
          const next = this.place(current, chain[i]);
          if (temporary) current.delete();
          current = next;
          temporary = true;
        }
        out.push(toMesh(node, current, rootId, [...chain.map((g) => g.id), node.id]));
        if (temporary) current.delete();
      };
      for (const k of [...operands, ...holes]) emit(k, this.build(scene, k), false);
      if (group.op === 'shell' && group.shell && kids.length === 1) {
        const cavity = this.shellCavity(scene, kids[0], group.shell);
        if (cavity) emit({ id: `${group.id}:cavity`, color: group.color, mode: 'solid' } as SceneNode, cavity, true);
      }
      // Le booleane annidate hanno i loro operandi
      for (const k of kids) if (k.type === 'group') visitGroup(k, [...chain, k], rootId);
    };
    for (const id of rootIds) {
      const root = scene.nodes[id];
      if (root?.type === 'group') visitGroup(root, [root], id);
    }
    return out;
  }

  /**
   * Unione di tutti i solid (per export STL), compresi i figli dei Raggruppa: l'esportazione è un solo solido, quindi
   * qui il Raggruppa si fonde davvero. I fori alla radice non entrano. L'handle restituito va liberato dal chiamante.
   */
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
