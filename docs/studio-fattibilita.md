# WebCAD: studio di fattibilità

Data: 5 ottobre 2026
Stato: fase 1 (ricerca e valutazione), nessun codice scritto.
Obiettivo: una SPA web per creare rapidamente oggetti 3D (stampa 3D e uso maker) partendo da forme semplici, con somme, sottrazioni e intersezioni di solidi, deformazioni e anteprima ruotabile in tempo reale. Sono esclusi animazione e rendering.

---

## 1. Sintesi e verdetto di fattibilità

**Verdetto: una SPA accessibile da web è sufficiente per il nucleo del prodotto.** Primitive, operazioni booleane, trasformazioni, deformazioni, anteprima e export (STL, 3MF, OBJ, GLB) girano interamente nel browser, senza backend, grazie a WebAssembly.

Il componente decisivo è **manifold-3d**, un kernel geometrico C++ compilato in WASM (licenza Apache-2.0, circa 1 MB di WASM, da verificare per la 3.5.x). Produce sempre mesh chiuse e "manifold", cioè esattamente ciò che serve agli slicer. È lo stesso kernel adottato da OpenSCAD (backend predefinito negli snapshot di sviluppo da agosto 2025) e da Blender (solver booleano esatto), con prestazioni da 5 a 100 volte superiori a CGAL.

Il compromesso proposto, in una riga:

| Da chi | Cosa prendiamo |
|---|---|
| TinkerCAD | Manipolazione diretta, solid/hole, gruppi come CSG non distruttivo, snap, align, mirror, duplicate-and-repeat |
| OpenSCAD | Albero parametrico serializzabile, valori numerici esatti, parametri nominati, export come codice, hull, extrude |
| Blender | Modifier stack ordinato per oggetto (array, mirror, twist, bend, taper, smooth, decimate, shell) |

**Dove servirebbe un backend:** account e sincronizzazione cloud, collaborazione in tempo reale, funzioni AI (proxy per le chiavi API), B-rep pesante (STEP, fillet su assiemi complessi). Nessuno di questi punti serve al ciclo di modellazione principale.

**Limite onesto:** un kernel mesh non offre fillet e smussi esatti come un kernel B-rep. Si compensa con parametri di arrotondamento sulle primitive e con un nodo SDF per le fusioni morbide. Se in futuro servissero fillet veri o STEP, si può caricare a richiesta replicad/OpenCascade (da 2,4 a 9 MB compressi) come modulo opzionale.

---

## 2. Analisi di TinkerCAD

### Modello di interazione
- **Libreria di forme:** box, cilindro, sfera, cono, tetto, cuneo, piramide, semisfera, toro, tubo, paraboloide, poligono, stella, anello, testo e forme scribble. Ogni forma ha un pannello di parametri (lati/segmenti, raggio, bevel, passi, spessore parete).
- **Solid e Hole:** ogni forma può essere un solido o un "foro". Il raggruppamento è l'operazione CSG: i solidi si uniscono, i fori si sottraggono. Dalla fine del 2025 esiste anche il gruppo di intersezione. Il gruppo si può sciogliere in qualsiasi momento, quindi l'albero resta non distruttivo.
- **Workplane, griglia, righello:** piano di lavoro spostabile, snap della griglia da 0,1 a 10 mm, righello per inserire quote numeriche.
- **Allinea, specchia, duplica e ripeti:** Ctrl+D ripete l'ultima trasformazione, quindi si costruiscono array rapidamente.
- **Nudge da tastiera:** frecce per X/Y, Ctrl+frecce per Z, Shift per passi più grandi. Maniglie per scala, sollevamento e rotazione a scatti di 22,5°.
- **Altre modalità:** Sketch (profili 2D estrusi), Codeblocks (blocchi in stile Scratch), Sim Lab, Circuits. Gli Shape Generators in JavaScript sono ormai legacy e in sola lettura.

### Formati
- Export: STL, OBJ, glTF/GLB, SVG (proiezione 2D). Nessuna evidenza di export 3MF nativo (**da verificare**).
- Import: STL, OBJ, SVG (fino a 25 MB, SVG sotto i 4 MB, solo vettoriali).

### Tecnologia
- Client JavaScript con rendering WebGL.
- Kernel geometrico "Core" (ex Gen6) di Autodesk, progettato per cluster server. Storicamente il calcolo CSG avviene lato server, per questo il raggruppamento è lento e richiede la connessione. La ripartizione attuale client/server non è documentata pubblicamente.
- Tutto è mesh, con tassellazione bassa (cilindri a 20 lati di default, massimo 64).

### Limiti e lamentele ricorrenti
- Raggruppamento lento con molti oggetti o gruppi annidati.
- Cerchi sfaccettati a causa del tetto di 64 lati.
- Nessun fillet o chamfer (solo il bevel dei box), nessun vincolo, nessuna storia parametrica oltre l'albero dei gruppi.
- Inserimento numerico di precisione scomodo.
- Solo cloud, account obbligatorio, nessun lavoro offline.
- Pensato per la didattica: si raggiunge presto il soffitto.

**Cosa ne ricaviamo:** la semplicità d'uso è tutta nella manipolazione diretta e nel concetto solid/hole. I punti deboli (server, tassellazione, precisione) sono esattamente quelli che un kernel WASM locale risolve.

---

## 3. Analisi di OpenSCAD

### Modello del linguaggio
Linguaggio dichiarativo e funzionale, le variabili sono immutabili e risolte in compilazione.
- **Primitive 3D:** `cube`, `sphere`, `cylinder` (con `r1`/`r2` per i coni), `polyhedron`.
- **Primitive 2D:** `square`, `circle`, `polygon`, `text`, più `import` (STL, OFF, 3MF, AMF, DXF, SVG).
- **Trasformazioni:** `translate`, `rotate`, `scale`, `mirror`, `multmatrix`, `color`, `resize`, `offset`, `projection`.
- **Booleane e derivate:** `union`, `difference`, `intersection`, `hull()`, `minkowski()`.
- **Estrusioni:** `linear_extrude` (con twist, scale, slices) e `rotate_extrude`.
- **Programmazione:** moduli, funzioni, cicli, list comprehension, `$fn`/`$fa`/`$fs` per la risoluzione.
- **Customizer:** commenti speciali sulle variabili generano un pannello di parametri (slider, menu a tendina), lo stesso modello usato da Thingiverse.
- **Librerie:** BOSL2 è lo standard di fatto (ancoraggi, arrotondamenti, filettature, ingranaggi, sweep).

### Kernel geometrici
- **Release stabile:** ancora la 2021.01 con CGAL (poliedri di Nef esatti, ma lentissimi, con render da minuti).
- **Manifold:** non più sperimentale dallo snapshot 2024.09.28 e backend predefinito negli snapshot di sviluppo dal 17 agosto 2025. Speedup riportati da 10 a 100 volte, con casi reali da 2 minuti a 2 secondi.
- **Preview e render:** la preview (F5) usa OpenCSG, una tecnica basata su immagini nella GPU che non produce una mesh vera. Il render (F6) calcola la mesh con CGAL o Manifold. Con Manifold il render completo è spesso abbastanza rapido da sostituire la preview.

### Versione web
- `openscad-wasm`: build Emscripten da 9 a 13 MB non compressi, circa 3 MB sulla rete.
- `openscad-playground`: React, Monaco, esecuzione in Web Worker, Manifold di default, Customizer, librerie incluse, PWA, export STL/glTF/OFF/X3D/3MF.

### Limiti
- Nessuna manipolazione diretta: si scrive codice e si rigenera, non si può cliccare una faccia.
- Curva di apprendimento ripida (semantica funzionale, nessuna interrogazione della geometria).
- Nessun fillet o chamfer nativo (serve BOSL2, oppure minkowski, lento).
- Mesh e non B-rep: niente STEP, curve approssimate con `$fn`.

**Cosa ne ricaviamo:** la potenza sta nell'albero parametrico e nella precisione. La si può offrire senza obbligare l'utente a scrivere codice: l'albero della scena è il programma, e si può esportare come `.scad`.

---

## 4. Analisi di Blender (solo modellazione e deformazione)

### Il modifier stack
Ogni modifier è una funzione pura `Mesh → Mesh` con parametri, applicata in ordine all'oggetto. Si può riordinare, silenziare o "applicare" (fissare). L'ordine conta (Mirror poi Bevel è diverso da Bevel poi Mirror). Si adatta bene a un albero CSG: ogni nodo può avere una lista ordinata di modifier, con risultato in cache per nodo.

### Modifier di tipo Generate

| Modifier | Funzione | Difficoltà in JS/WASM | Preserva la manifoldness |
|---|---|---|---|
| Array | N copie con offset fisso o relativo, anche radiali | Bassa (trasformazioni più unione) | Sì, tramite unione |
| Mirror | Specchia su un asse con saldatura sulla giunzione | Bassa | Sì, tramite unione |
| Boolean | Unione, differenza, intersezione | Già disponibile in manifold-3d | Sì, garantita |
| Bevel | Smussa o arrotonda spigoli e vertici | Alta (una delle operazioni più difficili) | Spesso fallisce su topologie complesse |
| Screw | Spazza un profilo attorno a un asse con passo | Media | Sì, se il profilo è chiuso e non si auto-interseca |
| Solidify | Dà spessore a una superficie (guscio) | Medio-alta | No se fatto con offset naive; usare offset SDF |
| Subdivision Surface | Smussamento per suddivisione | Media | Sì |
| Remesh | Ricostruzione voxel dell'intera mesh | Media | Sì, ma perde gli spigoli vivi |
| Decimate | Riduce il numero di triangoli | Media (`simplify` di manifold) | Sì con la versione di manifold |
| Wireframe | Trasforma gli spigoli in travi | Media | Sì, se unito (lento con molti spigoli) |

### Modifier di tipo Deform
Spostano solo i vertici, la topologia non cambia.

| Modifier | Funzione | Difficoltà |
|---|---|---|
| Simple Deform (Twist, Bend, Taper, Stretch) | Rotazioni e scalature lungo un asse | Bassa (circa 20 righe ciascuno) |
| Lattice (FFD) | Deformazione tramite gabbia | Bassa-media |
| Cast | Avvicina la forma a sfera, cilindro o cubo | Bassa |
| Curve | Piega la mesh lungo una spline | Media |
| Displace / Wave | Spostamento lungo la normale (texture, onde) | Bassa, richiede mesh densa |
| Smooth / Corrective Smooth | Rilassa le posizioni dei vertici | Bassa-media |
| Shrinkwrap | Proietta i vertici su una superficie | Media |

Questo contratto coincide con `warp(fn)` di manifold-3d: sposta i vertici secondo una funzione arbitraria senza cambiare la topologia. Rischio: la funzione può produrre auto-intersezioni, e la libreria non lo verifica da sola.

### Geometry Nodes
È un grafo di nodi (DAG) valutato in modo procedurale, lo stesso paradigma funzionale di OpenSCAD, con in più i "fields" per elemento e un editor visuale. **Per l'MVP si sconsiglia un editor a nodi:** costo di UX e di ingegneria alto, e allontana l'utente di livello TinkerCAD. L'albero della scena parametrico, con variabili ed espressioni nei campi numerici, dà circa l'80% della potenza procedurale.

### Edit mode e sculpt: fuori scope
Extrude, inset, loop cut e knife richiedono una struttura half-edge e la selezione di facce e spigoli. Dopo ogni booleana la mesh viene ritriangolata e le selezioni non sopravvivono (il cosiddetto topological naming problem). Alternative realistiche:
- "Extrude" diventa estrusione/rivoluzione di uno sketch 2D (`CrossSection`) con twist e scala.
- "Inset/shell" diventa un nodo guscio basato su SDF.
- "Bevel" diventa un parametro di arrotondamento delle primitive, oppure una fusione morbida SDF.
- Lo sculpt (SculptGL esiste nel browser) si può considerare in futuro come passo finale "congela e scolpisci".

### Punto chiave: deformazioni e CSG
- Un cubo ha 12 triangoli: piegandolo si spostano solo 8 vertici e le facce restano piane. **Serve `refineToLength` prima di `warp`**, eventualmente seguito da `simplify`.
- L'ordine conta: deformare dopo le booleane deforma anche i tagli (di solito è ciò che l'utente intende), deformare prima mantiene i tagli dritti.
- Il rischio reale è l'auto-intersezione (raggio di curvatura minore dello spessore, torsione troppo rapida). Mitigazioni: limiti sui parametri, controllo di auto-intersezione, avviso visivo.
- **Approccio SDF:** unione liscia e fillet sono quasi gratuiti (`smin` con raggio in unità reali), twist e bend sono deformazioni del dominio. Contro: spigoli vivi arrotondati dal meshing, precisione legata alla risoluzione del voxel, mesh dense. Anteprima via raymarching, meshing solo all'applicazione o all'export.
- **Soluzione ibrida consigliata:** booleane e primitive esatte in manifold-3d; deformazioni che preservano la topologia con `refine` più `warp`; operazioni "organiche" (fusione morbida, guscio) con un sotto-albero SDF convertito in mesh tramite `Manifold.levelSet`, che produce una mesh manifold garantita e rientra nel normale flusso CSG.

---

## 5. Panorama dei concorrenti e delle tecnologie affini

| Strumento | Cosa fa | Tecnologia | Rilevanza per WebCAD |
|---|---|---|---|
| ManifoldCAD (manifoldcad.org) | Playground di scripting JS/TS, export GLB e 3MF | manifold-3d | Riferimento diretto per il kernel |
| JSCAD / OpenJSCAD | CSG scritto in JS puro | BSP, V3 in alpha | Precedente JS, più lento e non manifold garantito |
| Replicad | CAD B-rep in JS con fillet e STEP | OpenCascade.js | Modulo opzionale per fillet reali |
| CadQuery / build123d | Code-CAD Python professionale | OpenCascade | Riferimento "pro", troppo pesante per una SPA leggera |
| Zoo Design Studio (KCL) | GUI e codice sincronizzati | Motore B-rep remoto su GPU | Modello di sincronia GUI e codice, ma dipende dal cloud |
| Onshape | CAD parametrico professionale | Parasolid lato server | Benchmark di precisione, fuori scope |
| BlocksCAD | Blocchi che generano OpenSCAD | Blockly | Simile a Codeblocks di TinkerCAD |
| SculptGL | Scultura nel browser | WebGL | Utile solo per forme organiche |
| Womp | Modellazione SDF con fusione morbida | SDF, rendering in cloud | Prova che l'SDF funziona per utenti consumer |
| RigCad | Solidi, mesh e SDF in un unico albero parametrico | Browser | Il più vicino al nostro "mix" |
| Spline, Vectary | Design 3D per il web e AR | WebGL | Riferimenti di UX per gizmo e materiali, deboli per la stampa |

---

## 6. Il compromesso proposto

**Principio guida:** l'utente manipola forme (stile TinkerCAD), ma sotto c'è sempre un albero parametrico esatto (stile OpenSCAD) a cui si possono applicare modifier (stile Blender).

1. **Esperienza di base (TinkerCAD):** aggiungi una primitiva, trascinala, imposta le quote numeriche, scegli solid o hole, raggruppa. Nessun codice richiesto.
2. **Precisione (OpenSCAD):** ogni campo numerico accetta valori in mm, variabili nominate ed espressioni. L'albero è serializzabile in JSON ed esportabile come codice OpenSCAD o ManifoldCAD.
3. **Deformazioni (Blender):** un pannello modifier per oggetto con stack ordinato. Il passo di `refine` viene inserito in automatico prima delle deformazioni e mostrato come cursore di qualità.
4. **Rotte avanzate:** nodo SDF per fusioni morbide e gusci, hull ed estrusioni da sketch 2D.
5. **Livelli di complessità progressivi:** la UI mostra all'inizio solo ciò che serve a un principiante (stile TinkerCAD), mentre parametri, espressioni e stack si scoprono con un pannello laterale.

---

## 7. Analisi tecnologica e stack

### Kernel geometrici a confronto

| Kernel | Robustezza e precisione | Velocità | Output manifold | Fillet | Bundle (circa) | Licenza |
|---|---|---|---|---|---|---|
| **manifold-3d** | Molto alta | Molto veloce | **Garantito** | Approssimati (smooth, SDF) | circa 1 MB (da verificare per la 3.5.x) | Apache-2.0 |
| three-bvh-csg | Media | Molto veloce (interattivo) | Non garantito | No | circa 50 KB più three-mesh-bvh | MIT |
| replicad / OCCT | B-rep esatta | Da lenta a media | Sì, dopo la tassellazione | **Reali** | da 2,4 a 9 MB compressi | MIT / LGPL-2.1 |
| JSCAD | Da bassa a media | Lenta | Non garantito | No | circa 300 KB | MIT |
| OpenSCAD WASM | Alta (Manifold dentro) | Veloce, con overhead dell'interprete | Sì | No | circa 3 MB compressi | GPL-2 |
| SDF (libfive, Fidget) | Dipende dalla risoluzione | Valutazione veloce, meshing fine lento | Sì con un buon mesher | Fusioni morbide | variabile | MPL/GPL (libfive) |

**Scelta: manifold-3d.** Un solo kernel copre primitive, booleane, `warp`, `hull`, smoothing, estrusione e rivoluzione, `levelSet`. È adottato da OpenSCAD e Blender, rilasciato di frequente (3.5.4 a inizio ottobre 2026) e non richiede alcuna configurazione di header COOP/COEP.

Dati di prestazione riportati: unione di 2 milioni di triangoli in 0,27 s contro 4,4 s di CGAL (benchmark meshlib.io 2026); modelli OpenSCAD reali da 540 s a 27 s e da 1132 s a 11 s.

### Viewport e interfaccia
- three.js (r186 al momento della ricerca) con `WebGPURenderer` consigliato dalla r171 e fallback automatico a WebGL2. Per un CAD conviene partire da WebGL, che è il default di React Three Fiber.
- `@react-three/fiber` (v9, React 19) e `drei`: `OrbitControls`/`CameraControls`, `TransformControls`/`PivotControls`, `Grid`, `GizmoHelper`, `Edges`, `Outlines` per l'evidenziazione.
- Picking su mesh pesanti con `three-mesh-bvh`. Con migliaia di oggetti: `InstancedMesh` o `BatchedMesh`.

### Architettura di esecuzione
- Kernel in **Web Worker** con Comlink. Le mesh tornano al thread principale come `Float32Array`/`Uint32Array` in modalità Transferable (zero copie).
- **Scena come DAG JSON** con nodi `primitive`, `boolean`, `transform`, `modifier`, `sdf`, `group`. Valutazione nel worker con memoizzazione per hash di nodo (parametri più hash dei figli) e cache LRU degli handle `Manifold`. Modificando una foglia si rivaluta solo la catena degli antenati.
- Le trasformazioni pure si applicano nel viewport come matrici durante il drag, senza rieseguire la booleana.
- **Stato:** zustand con immer, undo/redo con zundo o patch immer. Selezione e stato del gizmo restano fuori dalla cronologia.
- **Persistenza:** IndexedDB (idb-keyval o Dexie), import/export di progetto `.json` o `.zip`, File System Access API dove supportata.
- **PWA:** `vite-plugin-pwa` (Workbox) con precache dell'app e del `.wasm` per l'uso offline completo.

### Export
- **STL binario:** `STLExporter` di three oppure un writer proprio di circa 30 righe a partire dalla `Mesh` di Manifold.
- **3MF:** archivio OPC (zip) con `3dmodel.model` in XML, quindi `fflate` più circa 150 righe, oppure `three-3mf-exporter` (colori e materiali). Il progetto Manifold raccomanda 3MF o glTF con `EXT_mesh_manifold` rispetto a STL.
- **OBJ** con `OBJExporter`, **GLB** con `GLTFExporter`.
- Attenzione agli assi: Manifold usa mm con Z verso l'alto, glTF usa Y verso l'alto.

### Sincronia codice e GUI
- Generare codice dall'albero è facile e deterministico (OpenSCAD `difference(){...}`, ManifoldCAD JS). I nodi `warp` e SDF non hanno equivalente OpenSCAD.
- Il percorso inverso (codice verso GUI) è praticabile solo con un DSL ristretto o un sottoinsieme JSON-equivalente. **Raccomandazione:** prima solo export monodirezionale, round-trip limitato in futuro se richiesto.

### Limiti del browser
- **Memoria WASM:** 4 GB per istanza in wasm32, molto più di quanto serva. Memory64 disponibile in Chrome 133+ e Firefox 134+, ma più lento. Gli oggetti WASM vanno liberati a mano con `.delete()`.
- **Multithreading:** richiede SharedArrayBuffer, quindi header COOP/COEP, che rompono embed e CDN di terze parti. La build npm di Manifold funziona senza e ripiega su algoritmi seriali. Più worker in parallelo (per esempio export e anteprima) sono la via più semplice.
- **Mobile:** Safari su iOS limita la memoria per scheda (crash tipici sopra circa 1-1,5 GB). Limitare `levelSet` e `refine` ad alta risoluzione e fissare un tetto ai triangoli. Modelli tipici sotto i 500.000 triangoli girano bene anche su telefoni di fascia media.

---

## 8. Architettura logica

```
+---------------------------------------------------------------+
|  UI React                                                     |
|  Toolbar | Libreria forme | Pannello proprietà | Modifier stack|
|  Viewport (R3F + drei: orbit, gizmo, griglia, selezione)      |
+-------------------------------+-------------------------------+
                                |
                      Store (zustand + immer + undo)
                      Scena = DAG JSON di nodi
                                |
                    Comlink (messaggi, Transferable)
                                |
+-------------------------------v-------------------------------+
|  Web Worker "kernel"                                          |
|  manifold-3d WASM | valutazione DAG | cache per hash di nodo  |
|  refine + warp | levelSet (SDF) | controllo auto-intersezioni |
+-------------------------------+-------------------------------+
                                |
              Mesh (buffer) verso il viewport e verso gli export
              STL | 3MF | OBJ | GLB | codice OpenSCAD / JS
```

### Modello dati del nodo (bozza)
```ts
type Node =
  | { id; type: 'primitive'; kind: 'box'|'cylinder'|'sphere'|'cone'|'torus'; params; mode: 'solid'|'hole' }
  | { id; type: 'boolean'; op: 'union'|'difference'|'intersection'; children: Id[] }
  | { id; type: 'transform'; matrix | { t, r, s }; child: Id }
  | { id; type: 'modifier'; kind: 'array'|'mirror'|'twist'|'bend'|'taper'|'smooth'|'decimate'|'shell'; params; child: Id }
  | { id; type: 'sdf'; tree; resolution }
  | { id; type: 'group'; children: Id[] };
```

---

## 9. Feature del POC

**Obiettivo:** validare kernel, anteprima e UX di base. Stima: 2 o 3 settimane.

| Area | Feature |
|---|---|
| Primitive | Cubo, cilindro, sfera, cono, toro con parametri numerici modificabili (mm) |
| Selezione e trasformazioni | Selezione, gizmo di traslazione, rotazione e scala, campi numerici precisi |
| Griglia | Snap configurabile |
| CSG | Toggle solid/hole, gruppo con unione e differenza, più intersezione |
| Anteprima | Viewport orbitabile (rotazione, zoom, pan), ricalcolo del risultato al rilascio |
| Cronologia | Undo e redo |
| File | Salvataggio locale automatico (IndexedDB), export STL binario |

**Criteri di successo misurabili:**
- Booleana su 20 oggetti completata in meno di 200 ms (da calibrare sull'hardware di test).
- Il file STL esportato si apre in uno slicer senza errori di manifold.
- Interazione fluida (almeno 30 fps) con scene da circa 50 oggetti.
- Il WASM si carica in meno di 2 secondi su una connessione normale.

---

## 10. Feature dell'MVP

Include tutto il POC più:

| Area | Feature |
|---|---|
| Editing in stile TinkerCAD | Allinea, specchia, duplica e ripeti, righello, workplane |
| Array | Lineare e polare |
| Modifier stack | Twist, bend, taper, smooth (subdivision), decimate, con `refine` automatico e cursore di qualità |
| Operazioni organiche | Shell/hollow e fusione morbida (smooth blend) tramite nodo SDF e `levelSet` |
| 2D e solidi derivati | Sketch 2D, `linear_extrude` e `rotate_extrude` (con twist e scala), hull |
| Parametri | Pannello in stile Customizer con variabili nominate ed espressioni nei campi numerici |
| Import | STL e SVG |
| Export | 3MF (con colori), OBJ, GLB, codice OpenSCAD (e ManifoldCAD JS) |
| Prestazioni | Anteprima rapida durante il drag (eventuale three-bvh-csg), risultato definitivo Manifold al rilascio |
| Robustezza | Controllo di auto-intersezione con avviso, limiti sui parametri delle deformazioni |
| Piattaforma | PWA offline, import/export di progetto in zip |

---

## 11. Fuori scope e roadmap futura

- Fillet reali e STEP (replicad/OpenCascade caricato a richiesta).
- Editor a nodi in stile Geometry Nodes.
- Scultura e edit mode (extrude, inset, loop cut, knife).
- Lattice, Curve, Displace, Wave, Shrinkwrap, Remesh, Wireframe.
- Round-trip completo codice e GUI.
- Collaborazione in tempo reale (Yjs), account e cloud, galleria di modelli.
- Generazione della scena con AI (richiede un proxy per le chiavi API).
- Multithreading con COOP/COEP, solo se il profiling lo giustifica.

---

## 12. Rischi e mitigazioni

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Auto-intersezioni dopo bend o twist | Mesh non stampabile | Limiti sui parametri, controllo con verifica delle auto-intersezioni, badge di avviso |
| Densità della mesh dopo `refine` | Booleane lente, memoria | Lunghezza di raffinamento adattiva, `simplify` finale, tetto ai triangoli |
| Memoria WASM non liberata | Perdita di memoria, crash | Wrapper con gestione esplicita di `.delete()`, cache LRU con rilascio |
| Precisione float singola | Errori su quote molto piccole o molto grandi | Lavorare in mm, arrotondare i valori, limiti sulle dimensioni |
| Nessun fillet esatto | Delusione degli utenti "pro" | Arrotondamento nei parametri delle primitive, fusione morbida SDF, modulo replicad futuro |
| Mobile (iOS) con poca memoria | Crash della scheda | Limiti su `levelSet` e `refine`, avviso e riduzione automatica della qualità |
| Selezioni di facce e spigoli non stabili | Impossibile fare edit mode | Non offrirlo nell'MVP, usare operazioni a livello di oggetto |
| Sincronia bidirezionale codice e GUI | Costo alto, fragilità | Solo export monodirezionale nell'MVP |
| Dipendenza da un solo kernel | Rischio di vincolo tecnologico | Kernel isolato dietro un'interfaccia, ma senza astrazioni speculative finché non servono |

---

## 13. Domande aperte

1. **Target principale:** stampa 3D e maker, oppure uso generico (design, prototipi)?
2. **Dispositivi:** desktop prima di tutto, o il mobile deve funzionare bene fin dal POC?
3. **Codice contro GUI:** quanto pesa la vista codice (OpenSCAD) rispetto alla sola manipolazione visuale?
4. **Fillet reali:** servono davvero (e quindi STEP e B-rep), o bastano arrotondamenti approssimati?
5. **AI:** interessa generare o modificare la scena con prompt in linguaggio naturale?
6. **Distribuzione:** uso personale o prodotto pubblico (cambia account, cloud, licenze)?
7. **Interfaccia:** italiano e inglese fin da subito?

---

## Dati da verificare

- Dimensione esatta del WASM di manifold-3d 3.5.x (stimata circa 1 MB dalle versioni 2.x).
- Assenza di export 3MF in TinkerCAD (nessuna evidenza trovata, non confermata).
- Nome del writer 3MF usato da ManifoldCAD (probabile `@jscadui/3mf-export`, citato a memoria).
- Supporto Memory64 su Safari (fonte singola e dubbia).
- Nome dei componenti di drei e React Three Fiber v9 (da conoscenza propria, da controllare in fase di sviluppo).
- Le cifre sulle prestazioni vanno ricontrollate con un benchmark sul nostro caso d'uso nel POC.
