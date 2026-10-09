// Modello dati della scena. Unità: millimetri, asse Z verso l'alto (come slicer e OpenSCAD).

export type Vec3 = [number, number, number];

/** Un oggetto "solid" aggiunge materiale, un "hole" lo sottrae dal gruppo che lo contiene. */
export type NodeMode = 'solid' | 'hole';

interface BaseNode {
  id: string;
  name: string;
  /** Posizione del centro dell'oggetto, in mm. */
  position: Vec3;
  /** Rotazioni in gradi, applicate in ordine X, poi Y, poi Z (come OpenSCAD). */
  rotation: Vec3;
  /**
   * Specchio sugli assi X, Y, Z del sistema locale dell'oggetto, applicato prima della rotazione (assente = nessuno).
   * Gli oggetti specchiati si ottengono con il comando Specchia.
   */
  mirror?: [boolean, boolean, boolean];
  mode: NodeMode;
  /** Colore esadecimale, usato anche come materiale nel 3MF. */
  color: string;
  /** Oggetto bloccato: non si sposta, ruota, modifica, elimina o raggruppa per errore. */
  locked?: boolean;
  /**
   * Proporzioni bloccate: le misure indipendenti (larghezza e profondità, i tre lati del cubo, i due raggi) cambiano
   * insieme. Assente = bloccate per gli SVG e libere per le altre forme (vedi `isRatioLocked` in resize.ts).
   */
  lockRatio?: boolean;
}

/** Solidi dei dadi: ottaedro (d8), decaedro (d10, trapezoedro pentagonale), dodecaedro (d12), icosaedro (d20). */
export type PolyhedronKind = 'octahedron' | 'decahedron' | 'dodecahedron' | 'icosahedron';

export type PrimitiveKind = 'box' | 'cylinder' | 'cone' | 'sphere' | 'torus' | PolyhedronKind;

export type PrimitiveNode = BaseNode & { type: 'primitive' } & (
  | { kind: 'box'; size: Vec3; /** Raggio di arrotondamento di tutti gli spigoli in mm (0 o assente = spigoli vivi). */ cornerRadius?: number }
  | { kind: PolyhedronKind; /** Distanza tra due facce opposte in mm (la misura dei dadi). */ size: number; /** Raggio di arrotondamento di spigoli e vertici in mm (0 = vivi). */ cornerRadius: number }
  | { kind: 'cylinder'; radius: number; /** Raggio lungo Y in mm (assente = uguale a `radius`: cilindro tondo). */ radiusY?: number; height: number; segments: number }
  | {
      kind: 'cone';
      radiusBottom: number;
      radiusTop: number;
      /** Raggio lungo Y dell'estremità più larga in mm; l'altra mantiene lo stesso rapporto Y/X (assente = cono tondo). */
      radiusY?: number;
      height: number;
      segments: number;
    }
  | { kind: 'sphere'; radius: number; /** Raggi lungo Y e Z in mm (assenti = uguali a `radius`: sfera tonda). */ radiusY?: number; radiusZ?: number; segments: number }
  | { kind: 'torus'; majorRadius: number; minorRadius: number; segments: number }
);

/** Profilati con ali e anima: sezione a L, a T, a H e a U (contorni in src/scene/profiles.ts). */
export type BarKind = 'profileL' | 'profileT' | 'profileH' | 'profileU';
/** Tubolari: sezione cava rettangolare o tonda. */
export type TubeKind = 'tubeRect' | 'tubeRound';
/** Profilati strutturali: ali e anima oppure tubolari. */
export type ProfileKind = BarKind | TubeKind;

export type Shape2DKind = 'circle' | 'square' | 'ring' | 'heart' | 'star5' | 'star6' | 'egg' | 'trapezoid' | 'cross' | 'drop' | 'crescent' | 'text' | 'svg' | ProfileKind;

/**
 * Forma 2D estrusa (come linear_extrude di OpenSCAD): il profilo sta sul piano XY e si estrude
 * lungo Z per `height` mm, con torsione e scala della cima opzionali.
 */
export type Shape2DNode = BaseNode & {
  type: 'shape2d';
  /** Altezza dell'estrusione in mm. */
  height: number;
  /** Torsione della cima rispetto alla base, in gradi. */
  twist: number;
  /** Fattore di scala della cima (1 = prisma, 0 = cono). */
  scaleTop: number;
  /**
   * Tipo di estrusione: 'linear' (assente) estrude lungo Z con `height`, `twist` e `scaleTop`; 'rotate' fa girare il
   * profilo attorno all'asse Z come `rotate_extrude` di OpenSCAD (la Y del profilo diventa Z, la X il raggio).
   */
  extrusion?: 'linear' | 'rotate';
  /**
   * Contorno (offset 2D) del profilo in mm, prima dell'estrusione: positivo ingrandisce, negativo restringe
   * (assente = 0). In OpenSCAD è `offset()` applicato al profilo.
   */
  offset?: number;
  /** Angoli del contorno: 'round' arrotondati (`offset(r)`, assente) o 'sharp' vivi (`offset(delta)`). */
  offsetJoin?: 'round' | 'sharp';
  /** Estrusione rotazionale: gradi di rotazione da +X in senso antiorario (1..360, assente = 360). */
  revolveAngle?: number;
  /** Estrusione rotazionale: distanza del centro della forma dall'asse, in mm (la parte oltre l'asse si taglia). */
  revolveRadius?: number;
  /** Estrusione rotazionale: segmenti del giro intero, come `$fn` (assente = 64). */
  revolveSegments?: number;
} & (
  | {
      kind: 'circle';
      radius: number;
      /** Numero di lati: 3 triangolo, 6 esagono, 64 quasi liscio ($fn di OpenSCAD). */
      segments: number;
      /** Raggio di arrotondamento degli angoli del poligono in mm (0 o assente = angoli vivi). */
      cornerRadius?: number;
      /** Raggio lungo Y in mm (assente = uguale a `radius`: cerchio o poligono regolare). */
      radiusY?: number;
    }
  | { kind: 'square'; width: number; depth: number; /** Raggio di arrotondamento degli angoli in mm (0 = vivi). */ cornerRadius: number }
  | {
      /** Forme poligonali (profili in src/scene/shapes2d.ts): ingombro `width × depth` mm centrato nell'origine. */
      kind: 'ring' | 'heart' | 'star5' | 'star6' | 'egg' | 'trapezoid' | 'cross' | 'drop' | 'crescent';
      width: number;
      depth: number;
      /** Parametro della forma (foro dell'anello, raggio interno della stella, ...): significato e limiti in `RATIO_INFO`. */
      ratio: number;
    }
  | {
      /**
       * Profilato strutturale: sezione di ingombro `width × depth` mm centrata nell'origine, estrusa per la sua lunghezza.
       * L: ala orizzontale in basso e ala verticale a sinistra; T: ala in alto e anima verticale al centro;
       * H: due ali verticali ai lati e anima orizzontale al centro (come la lettera); U: fondo in basso e due ali
       * verticali ai lati.
       */
      kind: BarKind;
      width: number;
      depth: number;
      /** Spessore delle ali in mm (L: dell'ala orizzontale). */
      flange: number;
      /** Spessore dell'anima in mm (L: dell'ala verticale; U: del fondo). */
      web: number;
      /** Raggio del raccordo interno tra ala e anima in mm (0 o assente = spigolo vivo). */
      rootRadius?: number;
    }
  | {
      /** Tubolare rettangolare (scatolato): ingombro `width × depth` mm, parete `wall`, angoli esterni arrotondati di `cornerRadius`. */
      kind: 'tubeRect';
      width: number;
      depth: number;
      wall: number;
      /** Raggio degli angoli esterni in mm (0 o assente = vivi); quelli interni hanno `cornerRadius − wall`. */
      cornerRadius?: number;
    }
  | {
      /** Tubolare tondo: raggio esterno `radius`, parete `wall`, `segments` lati come `$fn`. */
      kind: 'tubeRound';
      radius: number;
      wall: number;
      segments: number;
    }
  | {
      /** Testo con un font del catalogo (src/scene/fontCatalog.ts). `size` è come in OpenSCAD: maiuscole alte circa `size` mm. */
      kind: 'text';
      text: string;
      font: string;
      size: number;
      /** Moltiplicatore dell'avanzamento tra le lettere, come `spacing` di OpenSCAD (assente = 1, spaziatura normale). */
      spacing?: number;
      /** Se il testo è nato dalla tab Simboli o Emoji: l'oggetto si chiama e si mostra come tale, non come "Testo". */
      origin?: 'symbol' | 'emoji';
    }
  | {
      /**
       * Disegno importato da un file SVG. `contours` sono i tracciati chiusi in mm, già centrati nell'origine (Y verso
       * l'alto) e alla misura naturale del file; `width × depth` è l'ingombro attuale: i contorni si scalano per adattarlo.
       * Regola di riempimento pari-dispari: i tracciati dentro altri tracciati sono fori.
       */
      kind: 'svg';
      contours: [number, number][][];
      width: number;
      depth: number;
      /** Nome del file di origine, per l'interfaccia e il codice OpenSCAD. */
      fileName: string;
    }
);

/** Mesh importata da un file STL o 3MF. La geometria sta in un asset (vedi src/import/assets.ts). */
export type MeshNode = BaseNode & {
  type: 'mesh';
  assetId: string;
  /** Nome del file di origine, per il codice OpenSCAD e per l'interfaccia. */
  fileName: string;
  /** Centro dell'ingombro nel file originale: la geometria dell'asset è stata ricentrata in questo punto. */
  origin: Vec3;
  /** Fattore di scala uniforme (1 = dimensioni del file). */
  scale: number;
  triangles: number;
};

/**
 * 'group' è il Raggruppa: concetto solo dell'app, gli oggetti restano separati (colori e codice propri) e si muovono insieme.
 * Le altre sono operazioni booleane vere, anche nel codice OpenSCAD; 'hull' è l'inviluppo convesso (hull() di OpenSCAD) e 'minkowski' la somma di Minkowski dei figli (minkowski()):
 * la forma si espande di tutto il volume del secondo oggetto, come arrotondare un solido con una sfera.
 */
export type GroupOp = 'group' | 'union' | 'intersection' | 'difference' | 'shell' | 'hull' | 'minkowski' | 'array' | 'pattern';

/** Misure del Guscio (vedi src/scene/shell.ts). */
export interface ShellParams {
  /** Spessore delle pareti laterali in mm. */
  wall: number;
  /** Spessore del fondo in mm (la cima resta sempre aperta). */
  bottom: number;
  /** Ingombro del figlio nel suo sistema locale: serve alla cavità scalata, usata per le forme senza cavità esatta. */
  bounds?: { min: Vec3; max: Vec3 };
}

/**
 * Parametri di una Ripetizione (serie di copie), nel sistema del gruppo: l'originale sta nell'origine e le copie si
 * calcolano da qui (vedi src/scene/arrayPattern.ts). I valori non usati dal tipo scelto restano nel nodo, così passando
 * da un tipo all'altro non si perdono.
 */
export interface ArrayParams {
  /** Lineare: una fila lungo un vettore; griglia: righe, colonne e livelli sugli assi; circolare: attorno a un asse. */
  kind: 'linear' | 'grid' | 'circular';
  /** Lineare e circolare: numero di copie, originale compreso. */
  count: number;
  /** Lineare: spostamento in X, Y, Z tra due copie (`spacing: 'step'`) oppure dalla prima all'ultima (`'total'`), in mm. */
  step: Vec3;
  spacing: 'step' | 'total';
  /** Griglia: copie su X, Y, Z. */
  counts: Vec3;
  /** Griglia: distanza tra due copie su X, Y, Z, in mm. */
  gridStep: Vec3;
  /** Circolare: asse di rotazione (0 = X, 1 = Y, 2 = Z). */
  axis: 0 | 1 | 2;
  /** Circolare: angolo totale in gradi (360 = giro completo, meno = arco dalla prima all'ultima copia). */
  angle: number;
  /** Circolare: punto per cui passa l'asse, relativo al centro dell'oggetto, in mm. */
  center: Vec3;
  /** Circolare: le copie ruotano con la serie (sì) oppure restano orientate come l'originale (no). */
  rotateCopies: boolean;
  /** Lineare e circolare: l'originale è la prima copia (no = restano solo le copie). */
  includeOriginal: boolean;
}

/**
 * Faccia da cui parte un pattern, nel sistema del gruppo (il pezzo sta all'origine): un punto del suo piano, la normale
 * uscente (il taglio entra nel pezzo in senso opposto) e lo spessore del pezzo lungo la normale, che serve al taglio da
 * entrambi i lati.
 */
export interface PatternFace {
  origin: Vec3;
  normal: Vec3;
  thickness: number;
}

/**
 * Parametri di "Applica pattern": un disegno (Voronoi casuale, esagoni, cerchi, rombi, triangoli) tagliato nel pezzo a
 * partire da una o più facce. Tutto si ricava da qui (vedi src/scene/pattern.ts), quindi il gruppo
 * resta modificabile e il codice OpenSCAD contiene le stesse celle del kernel.
 */
export interface PatternParams {
  /** Versione dell'algoritmo casuale (src/scene/voronoi.ts): se cambia, i vecchi progetti cambierebbero disegno. */
  algorithm: number;
  kind: 'voronoi' | 'hexagon' | 'circle' | 'diamond' | 'triangle';
  /** Fori: si tolgono le celle (restano le pareti); Solchi: si tolgono le pareti (restano le celle in rilievo). */
  mode: 'holes' | 'grooves';
  /** Seme del generatore casuale. */
  seed: number;
  /** Voronoi: numero di celle. */
  cells: number;
  /** Voronoi: 0 = casuale puro, 100 = celle uniformi. */
  regularity: number;
  /** Esagoni, cerchi, rombi e triangoli: passo tra i centri, in mm. */
  size: number;
  /** Esagoni, cerchi, rombi e triangoli: rotazione della griglia, in gradi. */
  angle: number;
  /** Spessore della parete tra due celle, in mm. */
  wall: number;
  /** Raggio di arrotondamento delle celle, in mm. */
  rounding: number;
  /** Cornice piena che resta attorno al disegno, in mm. */
  margin: number;
  /** Facce da cui parte il taglio (almeno una); ogni faccia ha il proprio disegno (seme + indice). */
  faces: PatternFace[];
  /** Solo nei progetti della 0.20.0: la faccia unica di allora (si converte in `faces`, vedi normalizePattern). */
  face?: PatternFace;
  /** Profondità del taglio dalla faccia, in mm (0 = passante). */
  depth: number;
  /** Da una faccia sola o anche dalla faccia opposta (stessa profondità). */
  sides: 'one' | 'both';
  /** Solo durante lo strumento: anteprima con meno segmenti (più veloce). Non si salva e non cambia il codice. */
  preview?: boolean;
  /** Ingombro del pezzo nel sistema del gruppo al momento dell'applicazione: dove si generano le celle. */
  bounds: { min: Vec3; max: Vec3 };
}

export type GroupNode = BaseNode & {
  type: 'group';
  /**
   * union: somma dei solid meno gli hole; intersection: parte comune dei solid meno gli hole;
   * difference: il primo figlio meno tutti gli altri (il modo solid/hole dei figli è ignorato);
   * shell: guscio, un solo figlio meno la sua cavità (la cavità non è un nodo: la ricava il kernel da `shell`).
   */
  op: GroupOp;
  children: string[];
  /** Solo per `op: 'shell'`. */
  shell?: ShellParams;
  /** Solo per `op: 'array'` (Ripetizione): l'unico figlio è l'originale. */
  array?: ArrayParams;
  /** Ridimensionamento del gruppo per asse (vedi groupScale.ts); assente = 1, 1, 1. */
  groupScale?: Vec3;
  /** Solo per `op: 'pattern'` (Applica pattern): l'unico figlio è il pezzo. */
  pattern?: PatternParams;
};

/** Piano di chiusura di un taglierino: si tiene la parte con normale·p ≤ offset, nel sistema locale del taglierino. */
export interface EndPlane {
  normal: Vec3;
  offset: number;
}

/**
 * Taglierino di un raccordo o di uno smusso: prisma che segue uno spigolo tra due facce piane. Nel suo sistema locale
 * l'asse Z corre lungo lo spigolo (da 0 a `length`), l'asse X lungo la bisettrice verso l'interno dell'angolo tra le facce
 * e l'apice del profilo sta nell'origine. Sta sempre in un gruppo con il pezzo: Differenza se lo spigolo è convesso
 * (toglie materiale), Unione se è concavo (ne aggiunge).
 */
export type EdgeNode = BaseNode & {
  type: 'edge';
  treatment: 'fillet' | 'chamfer';
  /** Spigolo convesso (il taglierino toglie) o concavo (aggiunge). */
  convex: boolean;
  /** Apertura tra le due facce in gradi: nel materiale se convesso, nell'aria se concavo. */
  angle: number;
  /** Lunghezza dello spigolo in mm. */
  length: number;
  /** Raggio del raccordo in mm. */
  radius: number;
  /** Raccordo: segmenti del cerchio intero, come `$fn` di OpenSCAD (assente = 64, valore delle scene salvate prima della 0.9.0). */
  segments?: number;
  /** Smusso: distanza lungo la prima faccia in mm. */
  distance1: number;
  /** Smusso: distanza lungo la seconda faccia in mm. */
  distance2: number;
  /** Larghezza minima delle due facce, perpendicolare allo spigolo: limite massimo delle misure. */
  reach: number;
  /** Piani che chiudono le due estremità (null = perpendicolari allo spigolo, a Z = 0 e Z = length). */
  ends: [EndPlane | null, EndPlane | null];
  /**
   * Smusso (id) la cui faccia chiude ciascuna estremità, se è un altro smusso: il piano si ricalcola dai suoi valori
   * correnti (vedi src/scene/edgeEnds.ts) invece di restare quello di quando è stato creato.
   */
  endVia?: [string | null, string | null];
};

/**
 * Taglierino di uno smusso angolare: taglia (Piano) o arrotonda con una calotta sferica (Sferico) il vertice dove
 * si incontrano tre o più superfici piane. Sta in un gruppo Differenza con il pezzo, come il taglierino degli spigoli.
 * La posizione del nodo è il vertice (nel sistema del gruppo) e la rotazione è nulla.
 */
export type CornerNode = BaseNode & {
  type: 'corner';
  treatment: 'chamfer' | 'fillet';
  /** Versori degli spigoli che partono dal vertice, nel sistema del gruppo. */
  directions: Vec3[];
  /** Lunghezza di ciascuno spigolo in mm, nello stesso ordine di `directions`: limite massimo della distanza. */
  lengths: number[];
  /** Distanza dal vertice, lungo ogni spigolo, dove il taglio incontra lo spigolo (mm). */
  distance: number;
  /** Solo sferico: segmenti della sfera (multipli di 4, la sfera di manifold è geodetica). Assente = 24. */
  segments?: number;
};

export type SceneNode = PrimitiveNode | Shape2DNode | MeshNode | GroupNode | EdgeNode | CornerNode;

/** Piatto di stampa: un gruppo di oggetti alla radice (vedi plates.ts). */
export interface Plate {
  id: string;
  name: string;
  /** Oggetti alla radice del piatto. Per il piatto attivo è vuoto: la sua lista è `Scene.rootIds`. */
  rootIds: string[];
}

export interface Scene {
  nodes: Record<string, SceneNode>;
  /** Ordine di presentazione degli oggetti alla radice **del piatto attivo**. */
  rootIds: string[];
  /** Piatti del progetto. Assente = un solo piatto (implicito). */
  plates?: Plate[];
  /** Id del piatto attivo, il cui elenco di oggetti è `rootIds`. */
  activePlateId?: string;
}
