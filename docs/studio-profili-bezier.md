# Studio di fattibilità: disegno di profili con curve di Bézier

Data: 14 ottobre 2026. Domanda: si può aggiungere a Construct una **modale di disegno** in cui tracciare un profilo 2D con
linee e curve di Bézier sempre editabili, scegliere tra estrusione lineare e rotazionale e vedere subito un'anteprima 3D,
mantenendo la coerenza con il kernel, con il codice OpenSCAD esportabile e con il resto dell'interfaccia?

**Esito: fattibilità alta** per la modale con il nuovo tipo di forma "Profilo" (nodi di Bézier, più contorni, fori,
estrusione lineare e rotazionale, anteprima con il kernel vero). **Media** per l'import SVG che conserva le curve (serve un
parser dei path scritto in casa, perché `SVGLoader` restituisce solo polilinee) e per il ritorno dal codice OpenSCAD
(le curve si ritrovano solo grazie a un commento di servizio). **Bassa, e quindi esclusa dalla prima versione**, la modifica
delle curve direttamente nella vista 3D e un risolutore di vincoli geometrici in stile Fusion.

Il lavoro vero è tutto nell'interfaccia: il kernel e il generatore OpenSCAD riutilizzano quasi per intero ciò che esiste.

Il prototipo interattivo di tutte le schermate citate è in [`docs/prototipi/profilo-bezier.html`](prototipi/profilo-bezier.html)
(si apre con un doppio clic, senza server): vale la pena provarlo prima di leggere la sezione 6.

## 1. Che cosa c'è oggi e che cosa manca

| Elemento | Stato | Riferimento |
|---|---|---|
| Da contorni chiusi a solido | **Pronto**: `CrossSection(contours, 'EvenOdd')` poi `Manifold.extrude` oppure `Manifold.revolve` | `src/kernel/evaluate.ts:378-460` |
| Codice OpenSCAD dei contorni | **Pronto**: `polygon(points, paths)` dentro `linear_extrude` o `rotate_extrude` | `src/codegen/openscad.ts:134-193` |
| Forma con contorni liberi | **Parziale**: il kind `svg` salva solo polilinee già campionate, quindi le curve sono perse | `src/scene/types.ts:193-198` |
| Campionamento delle curve | **Non adatto**: `SVGLoader` con 12 divisioni fisse per segmento, non adattivo; esiste anche `flatten` per i font | `src/import/svg.ts:17`, `src/scene/fontOutline.ts:39` |
| Estrusione rotazionale | **Pronta**, ma il profilo viene traslato di `revolveRadius` e la parte con x negativa è scartata da Manifold | `src/scene/shapes2d.ts:201-207`, `evaluate.ts:439-448` |
| Modale riusabile | **Pronta**: `<dialog>` nativo, `size="large"` (80vw per 80vh), Esc, sfondo, focus trap | `src/ui/Modal/Modal.tsx` |
| Campi numerici e slider | **Pronti**: `NumberField` (formule, virgola, Esc, frecce), `SliderField` | `src/ui/NumberField`, `src/ui/SliderField` |
| Editor di punti 2D | **Assente**: niente maniglie trascinabili, niente snap su griglia 2D | `src/viewport` ha solo drag del gizmo |
| Anteprima 3D secondaria | **Assente**: esiste un solo `<Canvas>`; le miniature sono offscreen | `src/viewport/thumbnail.ts` |
| Parser dei path SVG con curve | **Assente** | da scrivere |

Il precedente più vicino come azione dello store è `addSvg` (`src/scene/store.ts:291-304`), che crea un nodo da contorni
passati dall'esterno. Lo studio generale (`docs/da-fare.md`, riga 6) già indica il disegno libero come la funzione
strategica più grande ancora da fare.

## 2. Come lo fanno gli altri

Sono stati confrontati gli strumenti che l'utente di Construct probabilmente conosce. Le affermazioni su Fusion, Shapr3D,
Figma, Inkscape e Blender si appoggiano alle fonti elencate in `docs/fonti.md`; per Tinkercad la ricerca non ha trovato
dettagli sul disegno delle curve, quindi la riga è prudente e da ricontrollare.

| Programma | Come disegna le curve | Cosa prendere | Cosa evitare |
|---|---|---|---|
| **Fusion (Sketch)** | Spline "Fit Point" con maniglie di tangente e curvatura, oppure "Control Point" senza maniglie; lo schizzo si estrude o si ruota dopo, scegliendo un asse | Distinguere forme chiuse (solidi) da profili aperti (solo superfici); il profilo aperto che non si chiude è il problema più comune | Le maniglie delle fit spline spostano punti lontani: Autodesk stessa lo segnala. Vincoli e quote vincolanti: troppo costosi per un editor in modale |
| **Shapr3D** | Spline interpolate modificabili dopo la creazione; un solo livello di controllo sulla tangenza, per spezzarla bisogna creare il punto come spigolo | Disegno diretto e immediato, solidi da profili chiusi | Non poter cambiare tipo di punto dopo: in Construct il tipo di nodo si cambia sempre |
| **Figma e Illustrator (Penna)** | Bézier cubiche con maniglie. Figma ha tre modi di specchio: nessuno, solo angolo, angolo e lunghezza | Il modello a tre tipi di nodo è lo standard di fatto, comprensibile a chi usa programmi grafici | Il modo di specchio che si azzera a ogni nuovo punto (lamentela documentata sul forum di Figma) |
| **Inkscape (Bézier)** | Quattro tipi di nodo: spigolo (cuspide), liscio, simmetrico, auto liscio; Ctrl+clic scorre i tipi | Nomi e comportamento dei tipi di nodo; il tipo "auto liscio" per chi non vuole toccare le maniglie | Il numero di scorciatoie con maiuscole: in Construct bastano pulsanti e un doppio clic |
| **Tinkercad (Sketch)** | Profili 2D che si estrudono (dal blog di Tinkercad); i dettagli del disegno delle curve non sono verificati | Immediatezza, forme base come partenza | Da ricontrollare provando lo strumento |
| **Blender (curve)** | Maniglie Bézier con quattro tipi (Automatic, Vector, Aligned, Free); un'automatica diventa allineata appena la si sposta | Maniglie relative al nodo, tipo che cambia quando l'utente interviene | Edit mode nella vista 3D, fuori ambito |

I gesti della Penna che si ritrovano uguali ovunque, e che quindi conviene adottare senza inventare nulla:

- clic = punto con spigolo;
- clic e trascina = punto liscio con maniglie simmetriche;
- clic sul primo punto = chiude il contorno;
- Maiusc = vincola a multipli di 45 gradi;
- Invio o doppio clic = termina un percorso aperto;
- Canc = elimina il nodo selezionato.

Il tasto che "spezza" la tangenza durante il trascinamento (Alt in alcuni programmi, Ctrl in altri) cambia da programma a
programma e non è verificato in modo uniforme dalle fonti: in Construct la rottura si fa in modo esplicito dal pannello
("Punto selezionato", tipo Spigolo) e, come scorciatoia, con Alt durante il trascinamento di una maniglia: il tasto è momentaneo, il nodo è uno spigolo finché è premuto e torna al tipo di prima se lo si rilascia prima del mouse.

## 3. Modello dati

### Nuovo tipo di forma

Un nuovo `Shape2DKind` `'path'`, accanto a `svg`, con i campi comuni già esistenti (`height`, `twist`, `scaleTop`,
`extrusion`, `revolveAngle`, `revolveSegments`, `offset`):

```ts
type Vec2 = [number, number];

interface PathNode {
  p: Vec2;                       // posizione in mm nel sistema dell'editor
  in?: Vec2;                     // maniglia entrante, RELATIVA al nodo (assente = nessuna)
  out?: Vec2;                    // maniglia uscente, RELATIVA al nodo
  kind: 'corner' | 'smooth' | 'symmetric';
}

interface PathContour {
  closed: boolean;
  nodes: PathNode[];             // almeno 2 nodi
}

// aggiunto alla variante del nodo
{ kind: 'path'; paths: PathContour[]; tolerance: number /* mm, default 0.05 */; fileName?: string }
```

Scelte e motivazioni:

- **Maniglie relative al nodo.** Spostare un nodo sposta le sue maniglie senza altri calcoli; il tipo `smooth` impone solo
  l'allineamento, `symmetric` anche la stessa lunghezza. I tipi sono un vincolo applicato durante la modifica, non un dato da
  ricalcolare in lettura: le maniglie salvate sono sempre quelle vere.
- **Tipo "auto liscio" rimandato.** Aggiunge un calcolo (tangente da nodi vicini) e un quarto stato. Si può introdurre dopo
  senza cambiare il formato (basta un nuovo valore di `kind` senza maniglie salvate).
- **Segmento retto = nessuna maniglia da entrambi i lati.** Se almeno una delle due maniglie esiste, il segmento è una cubica
  (la maniglia mancante coincide con il nodo). Non esiste un tipo di segmento separato: meno stati, nessun caso incoerente.
- **Più contorni, regola pari-dispari.** Come per gli SVG: un contorno dentro un altro diventa un foro, senza classificazione
  esplicita. È la regola già usata dal kernel (`'EvenOdd'`).

### Coordinate: editor assoluto, forma centrata

Qui c'è l'unica scelta davvero delicata. Tutto il resto del codice assume che i contorni di una forma 2D siano **centrati
nell'origine** (`profileExtent`, `halfHeight` per l'appoggio sul piatto, `resize.ts`, limiti del gizmo). Il disegno in modale
invece ha un sistema assoluto: l'asse di rotazione sta a x = 0 e la distanza dall'asse deve poter essere letta e digitata.

Soluzione consigliata:

1. I nodi si salvano nel **sistema dell'editor** (mm, asse di rotazione a x = 0, la Y del disegno è la Z del solido).
2. Una funzione pura `pathContours(node)` in `src/scene/bezier.ts` campiona le curve e **restituisce contorni centrati**
   sul centro del loro riquadro. Dal punto di vista di `profileExtent`, `resize.ts` e `halfHeight` il nodo si comporta
   come un `svg`.
3. In estrusione rotazionale il raggio non è più un parametro libero: `revolveRadius` si ricava dalla coordinata x del
   centro del riquadro nell'editor (`revolveParams` per questo kind). Il disegno e il solido coincidono quindi sempre.
4. Su OK, se il centro del riquadro è cambiato, la **posizione del nodo si compensa** (ruotata secondo la rotazione del
   nodo) nello stesso passo di Annulla, così modificare il profilo non fa "saltare" l'oggetto nella scena. In rotazione la
   compensazione riguarda solo la quota Z.

L'alternativa, tenere le coordinate assolute e adattare `profileExtent`, `halfHeight`, `resize.ts` e il gizmo, richiede di
toccare molti file stabili per un guadagno quasi nullo. Non è consigliata.

**Profilo che attraversa l'asse.** Manifold scarta la parte con x negativa. L'editor mostra la zona x < 0 in rosso con
l'avviso "Questa parte non viene ruotata", e l'OK resta possibile (l'effetto è dichiarato, non nascosto). Il codice OpenSCAD
omette l'`intersection()` quando il profilo sta tutto a x ≥ 0: così, per questo tipo di forma, il ritorno da OpenSCAD non
produce più i tre oggetti descritti in `docs/da-fare.md` (riga 147).

### Campionamento delle curve

`pathContours` suddivide ogni cubica con de Casteljau finché i punti di controllo distano dalla corda meno di `tolerance`
(errore massimo in mm, valore di partenza 0,05 mm), con un tetto di punti per contorno. Rispetto alle 12 divisioni fisse:

- le curve piccole non generano punti inutili, quelle grandi restano lisce;
- il numero di punti dipende da una grandezza fisica (mm) e non dal caso;
- lo stesso identico campionamento serve al kernel, al codegen e all'anteprima: nessuna possibilità di divergenza.

### Contorni aperti

| Modo | Lineare | Rotazionale |
|---|---|---|
| Contorno chiuso | Normale | Normale |
| Contorno aperto | Si chiude con un segmento retto tra ultimo e primo nodo, con avviso "profilo aperto, chiuso automaticamente" | Si chiude **sull'asse**: dall'ultimo nodo in orizzontale fino a x = 0, lungo l'asse, poi in orizzontale fino al primo nodo. È il modo naturale di disegnare vasi, bottiglie, pomelli e bicchieri |

Il secondo caso è la richiesta esplicita "profilo aperto per la rotazione" ed è il motivo per cui conviene mostrare l'asse
nell'editor in qualsiasi modalità.

## 4. Kernel e codice OpenSCAD

- **Kernel.** Nuovo ramo in `shape2d()` (`evaluate.ts:378+`): `new CrossSection(pathContours(p), 'EvenOdd')` e poi i
  passaggi comuni già esistenti (offset 2D, estrusione o rotazione, torsione con `subdivideContours`). Nessun cambiamento a
  `Manifold`.
- **Codegen.** Stesso ramo di `svg` in `linearShape2dLines` (`openscad.ts:174+`): `polygon(points, paths)` con gli stessi
  punti. Per la rotazione, `rotate_extrude` senza `intersection()` quando il profilo sta a x ≥ 0.
- **Ritorno da OpenSCAD.** Il codice contiene solo punti campionati. Per ritrovare le curve il codegen scrive, prima del
  `polygon`, un commento `// construct:path <JSON compatto dei nodi>`. `src/import/scad/toScene.ts` lo legge e crea un
  nodo `path` invece di un "Poligono" `svg`. Se il commento manca o non corrisponde ai punti (codice modificato a mano),
  vale il comportamento attuale. Il lexer (`src/import/scad/parse.ts:95-100`) scarta i commenti, ma ha già un
  precedente: riconosce `// === Piatto N: nome ===` e lo conserva in `plateNames`. Si estende nello stesso modo, con una mappa
  dalla riga del commento al JSON dei nodi, che `toScene.ts` associa al `polygon` successivo.
- **Salvataggio.** Il kind è nuovo e i campi opzionali: i progetti già salvati restano validi e non serve incrementare
  `VERSION` di `persistence.ts`. Un progetto con `path` aperto in una versione vecchia dell'app non si legge, come
  accade con ogni nuovo tipo di nodo.
- **Ridimensionamento.** Per `svg`, `resize.ts` riscala i contorni campionati (casi speciali a `resize.ts:27` e `:195`).
  Per `path` scalare solo i punti campionati farebbe perdere i nodi: il ridimensionamento deve **scalare i nodi**
  (posizioni e maniglie) e ricalcolare il riquadro. È l'unico punto dove `path` si discosta da `svg`.
  **Superato dalla fase 1 (0.60.0):** `path` ha `width` e `depth` come `svg` e non scala i nodi, vedi «Decisioni della fase 1» alla fine di questa sezione.

### Decisioni della fase 1 (0.60.0)

Prese realizzando il modello e il kernel; dove si discostano dal testo sopra, valgono queste.

- **D1. Il riquadro naturale è quello delle sole curve.** La chiusura sull'asse dei contorni aperti si aggiunge dopo la centratura: passare da Lineare a Rotazionale non cambia `width`, `depth` né la scala.
- **D2. Il riquadro non dipende dalla tolleranza.** Ogni cubica si spezza prima nei suoi estremi in x e in y, così il riquadro del poligono campionato è quello esatto della curva e cambiare la tolleranza non sposta l'oggetto.
- **D3. Scala e raggio.** I nodi stanno nel sistema dell'editor e non si scalano mai: `pathContours` campiona le curve e riusa `svgContours` (scala a `width × depth` attorno al centro del riquadro), quindi `resize.ts` tratta il `path` come l'`svg` (lucchetto chiuso di default, Scala rispetto alla larghezza naturale). In rotazione il raggio è la x del centro del riquadro naturale (`pathRadius`, anche negativa), il campo `revolveRadius` è ignorato e lo slider Raggio non si mostra; i punti di chiusura stanno a x = −raggio dopo la centratura, cioè sull'asse. Ingrandendo il profilo con il gizmo una curva vicina all'asse può superarlo: la parte oltre l'asse si scarta (l'avviso arriva con la modale di disegno).
- **D4 (fase 2).** Il nodo nuovo nasce solo con l'OK della modale: Annulla non lascia nodi vuoti e c'è un solo passo "Aggiungi Profilo".
- **D5 (fase 2).** `Modal` riceve una prop `onEscape`, così Esc chiede conferma anche con `dismissable={false}`.
- **D6 (fase 2).** Il comando "Modifica profilo" sta solo nel menu contestuale e nelle Proprietà (campo `toolbar?: false` nel registro dei comandi), con la scorciatoia Maiusc+P controllata prima del ramo di `p`.
- **D4-D7 in pratica (0.61.0).** Il nodo nuovo nasce solo con l'OK (D4); `Modal` ha `onEscape` e il disegno chiede conferma con Esc anche senza modifiche alla scena (D5); "Modifica profilo" sta nel menu contestuale, nelle Proprietà e su Maiusc+P, senza pulsante di barra (D6, campo `toolbar: false` nel registro dei comandi); bozza in `localStorage` per nodo, tetti a 500 nodi e 100 contorni (D7). L'anteprima 3D è il kernel vero (`evaluateDetached`, una richiesta in volo, al più una ogni 100 ms, subito al rilascio) in un secondo Canvas a richiesta, e usa gli stessi contorni arrotondati che l'OK scrive: dopo l'OK la mesh della scena ha gli stessi triangoli e lo stesso volume dell'ultima anteprima. L'anteprima sta nella colonna destra sopra le opzioni (a una colonna, sopra il disegno).
- **D7. Risposte alle domande aperte del §10.** Tolleranza predefinita 0,05 mm; profilo oltre l'asse accettato solo con un avviso; bozza in `localStorage` per nodo (`construct:profile-draft:<id>` o `:new`); al massimo 500 nodi per contorno (e 100 contorni); il nodo `svg` resta com'è.

## 5. Esperienza d'uso (UX)

### Punti di ingresso

1. **Libreria forme**: nuova voce "Profilo" in `ShapeLibrary`. Crea un nodo `path` vuoto e apre subito la modale.
2. **Menu contestuale e proprietà**: per un nodo `path`, "Modifica profilo" nel menu contestuale e come pulsante nelle
   proprietà. Il doppio clic sull'oggetto in vista **non è disponibile**: oggi passa alla modalità Sposta
   (`SceneObject.tsx:327`). La scorciatoia da tastiera si sceglie in fase di realizzazione, tra quelle libere di
   `useShortcuts.ts`.
3. **Converti in profilo**: per cerchio, quadrato e forme poligonali già presenti, e per gli SVG importati, "Converti in
   profilo modificabile". Il cerchio diventa quattro nodi con maniglie di cubica (costante 0,5523), il quadrato quattro
   spigoli, l'SVG i suoi punti come spigoli. Questa funzione dà un valore enorme a poco costo: ogni forma esistente diventa
   un punto di partenza.
4. **Importa SVG** dentro la modale, con le curve conservate.

### Strumenti della modale

Le scorciatoie valgono solo con la modale aperta (`useShortcuts.ts` già blocca quelle dell'app con `dialog[open]`).

| Strumento | Tasto | Come funziona |
|---|---|---|
| Sposta vista | H | La mano: trascinando si sposta la vista (panoramica anche con Spazio e con il tasto centrale o destro). |
| Seleziona | V | Trascina nodi e maniglie, riquadro di selezione, Maiusc per aggiungere, Canc per eliminare, clic su una curva per selezionare tutto il contorno (l'inserimento di un nodo con de Casteljau, a forma invariata, è della Penna), doppio clic su un nodo per scorrere i tipi |
| Penna | P | Clic = spigolo, clic e trascina = nodo liscio, clic sul primo nodo = chiude, Invio o doppio clic = termina aperto, Backspace = toglie l'ultimo nodo, Esc = termina senza aggiungere |
| Forme base | R, C, G | Rettangolo, cerchio, poligono regolare (con numero di lati): si trascinano dal centro e diventano contorni di nodi modificabili |
| Mano | spazio | Panoramica; rotella per lo zoom sul puntatore |

Regole trasversali:

- **Griglia e snap**: passo scelto tra 0,1, 0,5, 1, 5, 10 mm, adattato allo zoom; snap a griglia, a nodi esistenti e a
  orizzontale e verticale; Maiusc vincola a 45 gradi; Ctrl sospende lo snap.
- **Coordinate digitabili**: il nodo selezionato mostra X e Y in `NumberField` (formule e parametri compresi). Per le
  maniglie: lunghezza e angolo. È la sostituzione leggera dei vincoli di Fusion: precisione numerica senza risolutore.
- **Cronologia locale**: Ctrl+Z e Ctrl+Maiusc+Z dentro la modale agiscono sullo stato del disegno. Su OK **un solo passo**
  nella cronologia della scena (`op` etichettato "Profilo"), come ogni operazione utente.
- **Annulla**: Esc chiude solo se non ci sono modifiche; altrimenti chiede conferma. La modale usa `dismissable` falso, come
  le altre finestre di lavoro, così un clic sullo sfondo non fa perdere il disegno.
- **Stato vuoto**: il disegno vuoto mostra un suggerimento al centro ("Scegli la Penna e fai clic per iniziare, oppure parti
  da una forma base o da un SVG").
- **Salvataggio automatico di sicurezza**: durante il disegno lo stato locale si salva in `localStorage` (bozza), per non
  perdere il lavoro in caso di chiusura accidentale.

### Messaggi di errore e stati limite

| Situazione | Comportamento |
|---|---|
| Nessun contorno o meno di 2 nodi | OK disattivato, suggerimento |
| Contorno aperto in estrusione lineare | Si chiude da solo, avviso giallo con pulsante "Chiudi il contorno" |
| Autointersezione | Evidenziata in rosso con contatore; con EvenOdd il risultato resta valido ma può sorprendere |
| Profilo oltre l'asse in rotazione | Zona rossa a sinistra, avviso "Questa parte non viene ruotata" |
| Troppi punti dopo il campionamento | Avviso e proposta di alzare la tolleranza |
| SVG con archi (`A`) | Gli archi si convertono in cubiche (approssimazione standard con al più 4 cubiche per arco); in caso di difficoltà, avviso |

## 6. Interfaccia (UI)

### Layout valutati

**A. Disegno a sinistra, sidebar a destra con anteprima in alto e opzioni sotto** (la proposta di partenza)

```text
+----------------------------------------------------------------------------+
| Profilo                                                              [ X ] |
+----------------------------------------------------------+-----------------+
| [V][P] [R][C][G] | Griglia 1mm [x] snap  - 100% +        |  Anteprima 3D   |
|                                                          |  +-----------+  |
|            |                                             |  |   ___     |  |
|            |        .--~~~--.                            |  |  /   \    |  |
|  ----------+-------(         )-------- asse X            |  | | vaso |   |  |
|            |        '--...--'                            |  |  \___/    |  |
|            |                                             |  +-----------+  |
|            |                                             | Estrusione      |
|        asse di rotazione                                 |  (o) Lineare    |
|                                                          |  ( ) Rotazionale|
|                                                          |  Altezza  20 mm |
|                                                          | Punto selezion. |
|                                                          |  X 12  Y 30     |
|                                                          |  Tipo: Liscio   |
+----------------------------------------------------------+-----------------+
| 2 contorni, 9 nodi, 0 avvisi                        [ Annulla ]  [ OK ]    |
+----------------------------------------------------------------------------+
```

**B. Anteprima flottante nell'angolo del disegno, sidebar solo opzioni**

```text
+----------------------------------------------------------+-----------------+
| [V][P] [R][C][G]                                         | Estrusione      |
|                                          +-----------+   |  (o) Lineare    |
|                                          | anteprima |   |  Altezza        |
|                  disegno a tutta area    |  3D 200px |   |  Torsione       |
|                                          +-----------+   | Punto selezion. |
|                                                          | Percorsi        |
+----------------------------------------------------------+-----------------+
```

**C. Divisione verticale 50 e 50 tra disegno e 3D, con barra delle opzioni sotto**

```text
+-------------------------------+--------------------------------+
|  disegno 2D                   |  anteprima 3D grande           |
+-------------------------------+--------------------------------+
| Estrusione | Punto selezionato | Griglia                       |
+----------------------------------------------------------------+
```

| Criterio | A | B | C |
|---|---|---|---|
| Spazio per disegnare con precisione | Buono | **Ottimo** | Medio |
| Qualità dell'anteprima | Media (circa 300 px) | Scarsa (circa 200 px) | **Ottima** |
| Coerenza con il pannello Proprietà dell'app (sidebar destra, 320 px) | **Alta** | Alta | Bassa |
| Funziona a 1024 px di larghezza | **Sì** | Sì | Stretto |
| Complessità di realizzazione | **Bassa** | Media (finestra flottante ridimensionabile) | Bassa |

**Raccomandazione: A**, con due accorgimenti nati dal confronto con B e C: l'anteprima si può **ingrandire** (pulsante che
la porta a tutta altezza della sidebar, nascondendo le opzioni) e **comprimere** per chi vuole più spazio di disegno; sotto
i 900 px di larghezza l'anteprima passa sopra il disegno (layout a una colonna). Il prototipo permette di provare tutte e
tre le disposizioni.

### Schermate del prototipo

Le immagini vengono da [`prototipi/profilo-bezier.html`](prototipi/profilo-bezier.html). Il prototipo è un editor funzionante
(Penna, Seleziona, forme base, fori, import SVG con curve, annulla e ripeti, snap), ma l'anteprima 3D è un'approssimazione
costruita con three.js e non il kernel di manifold: serve a giudicare l'interfaccia, non la geometria finale.

| Schermata | Immagine |
|---|---|
| **Disposizione A**: contorno curvo con un foro, estrusione lineare | ![Disposizione A](images/profilo-bezier-a.png) |
| **Fori**: un cerchio disegnato dentro un contorno diventa un foro (bordo rosso, badge "Foro" nell'elenco dei percorsi) | ![Foro](images/profilo-bezier-foro.png) |
| **Rotazione**: profilo aperto chiuso sull'asse, zona rossa a sinistra dell'asse | ![Rotazione](images/profilo-bezier-rotazione.png) |
| **Disposizione B**: anteprima flottante nell'angolo del disegno | ![Disposizione B](images/profilo-bezier-b.png) |
| **Disposizione C**: disegno e 3D affiancati, opzioni in una fascia sotto | ![Disposizione C](images/profilo-bezier-c.png) |

Che cosa mostra il prototipo, rispetto ai mockup di testo:

- i nodi hanno forme diverse per tipo (quadrato per lo spigolo, cerchio per il liscio, rombo per il simmetrico);
- i contorni interni diventano fori da soli (regola pari-dispari) e cambiano colore;
- in rotazione la zona a sinistra dell'asse è colorata e compare l'avviso nel piede;
- il piede riassume contorni, nodi e avvisi (contorno aperto, autointersezione) con chip colorati;
- sotto i 900 px la modale diventa una colonna sola, con l'anteprima sotto il disegno.

Osservazioni emerse provandolo:

- Con il passo di griglia a 5 mm (lo zoom è basso) un clic può cadere a oltre 10 px dal nodo agganciato: per chiudere un contorno
  il prototipo accetta anche il clic che si aggancia al primo nodo, non solo quello entro 10 px.
- Nella disposizione C la fascia delle opzioni è bassa e le sezioni scorrono: funziona, ma è la meno comoda per il pannello
  del punto selezionato. Un altro motivo per preferire la A.
- L'anteprima flottante della B copre un angolo del disegno: serve il pulsante Comprimi sempre a portata.

### Sezioni della sidebar (da alto in basso)

1. **Anteprima 3D**: orbita con il mouse, pulsante Adatta, cerchio di stato "calcolo in corso".
2. **Estrusione**: interruttore Lineare / Rotazionale, poi i parametri già presenti in `Shape2DFields`
   (`PropertiesPanel.tsx:767`, `:968`):
   - Lineare: altezza, torsione, scala in cima.
   - Rotazionale: angolo (1 a 360), segmenti, opzione "Chiudi sull'asse" per i profili aperti.
3. **Punto selezionato**: X, Y, tipo (Spigolo, Liscio, Simmetrico), lunghezza e angolo delle maniglie.
4. **Percorsi**: elenco con nome, chiuso o aperto, contorno o foro (stato calcolato dall'annidamento), visibilità.
5. **Griglia e snap**: passo, snap a griglia, a nodi, a ortogonali; mostra o nascondi l'asse.
6. **Qualità**: tolleranza di campionamento (avanzata, ripiegata).

I testi sono in italiano, le unità in mm, i controlli numerici sono i `NumberField` esistenti (formule, virgola decimale,
parametri legati) e gli slider usano `SliderField`. I colori vengono dai token di `_tokens.scss` (`color('panel')`,
`color('accent')`...) e l'editor funziona nei temi chiaro e scuro.

### Accessibilità

- Tutta la modale si usa anche da tastiera: Tab tra i pannelli, frecce per spostare il nodo selezionato di un passo di
  griglia (Maiusc: dieci passi), Canc, Invio.
- I nodi hanno almeno 12 px di area attiva (24 px su schermi touch), con `touch-action: none` e Pointer Events con
  `setPointerCapture`.
- Il significato non è affidato solo al colore: i tipi di nodo hanno forme diverse (quadrato spigolo, cerchio liscio,
  rombo simmetrico), come in Inkscape.

### Anteprima: come si realizza

| Opzione | Descrizione | Esito |
|---|---|---|
| a. Secondo `<Canvas>` R3F nella modale, alimentato dal kernel (`evaluateDetached` in debounce) | Anteprima identica al risultato finale, orbitabile | **Proposta**: un secondo contesto WebGL, montato solo con la modale aperta (`frameloop="demand"`) |
| b. Riuso di `renderThumbnail` | Immagine statica isometrica | Utile come ripiego, ma non orbitabile |
| c. Anteprima approssimata con geometria propria in three.js (strati con torsione e scala, superficie di rotazione, tappi triangolati) | Veloce e senza kernel, ma è una seconda implementazione che può divergere (per esempio la parte oltre l'asse è tagliata a mano) | Sconsigliata nel prodotto: anteprima e risultato non coinciderebbero. È ciò che fa il prototipo, dichiarato |

Durante il trascinamento di un nodo l'anteprima si aggiorna al massimo ogni 100 ms (il kernel è in un Web Worker, quindi
l'interfaccia non si blocca) e subito al rilascio. Il disegno 2D mostra già il riempimento pari-dispari: il feedback sui fori
è immediato anche senza aspettare il kernel.

## 7. Miglioramenti proposti

| Idea | Valore | Costo |
|---|---|---|
| **Converti in profilo** da cerchio, quadrato, profilati e SVG | Alto: ogni forma diventa punto di partenza | Basso (funzioni pure) |
| **Linea con spessore** (un contorno aperto diventa una parete tramite `offset`): vasi sottili, clip, coperchi, scritte a bastoncino | Alto | Basso: `CrossSection.offset` esiste già |
| **Simmetria speculare** rispetto all'asse (per i profili di vasi) | Medio | Basso |
| **Raggio di raccordo per nodo** (spigolo arrotondato digitando il raggio) | Alto: sostituisce la quota vincolata di Fusion | Medio |
| **Immagine di riferimento** da ricalcare (con trasparenza e scala) | Medio | Medio (non entra nel progetto, solo nella bozza) |
| **Misure digitate durante la Penna** (lunghezza e angolo con Tab) | Medio | Medio |
| **Nodo "auto liscio"** | Medio | Basso (nuovo valore di `kind`) |
| **Coordinate legate ai parametri** (`ParamPicker`) | Alto per i progetti parametrici | Medio, a parte |

Prime due da fare subito dopo la prima versione; le altre secondo la richiesta degli utenti.

## 8. Rischi e limiti

| Rischio | Gravità | Mitigazione |
|---|---|---|
| **Nodi e maniglie piccoli, difficili da colpire** su schermi piccoli e touch | Media | Aree attive di almeno 12 px, zoom sul puntatore, snap, modifica numerica |
| **Autointersezioni** | Media | Rilevamento nell'editor (test segmento contro segmento), risultato valido grazie a EvenOdd, avviso |
| **Peso del codice OpenSCAD** con tolleranza bassa e molte curve | Bassa | Tetto di punti, tolleranza regolabile, stesso campionamento in kernel e codice |
| **Divergenza tra anteprima e risultato** | Media | Anteprima con il kernel vero (opzione a) |
| **Secondo contesto WebGL** | Bassa | Il browser consente molti contesti; il canvas della modale vive solo a modale aperta |
| **Ritorno da OpenSCAD** (commento di servizio) | Bassa | Se il commento non corrisponde ai punti, torna un "Poligono" come oggi |
| **Parser SVG scritto in casa** | Media | Gestire M, L, H, V, C, S, Q, T, A, Z, relativi e assoluti, con test; l'API `SVGPathElement` non espone i punti di controllo, quindi non è utilizzabile |
| **Profilo fuori dall'asse in rotazione** | Bassa | Zona rossa, avviso, codice senza `intersection()` |
| **Ridimensionamento** che deve scalare i nodi e non solo i punti campionati | Media | Caso speciale in `resize.ts`, con test |
| **Scorciatoie e conflitti** | Bassa | Valgono solo a modale aperta |
| **Mancanza di vincoli geometrici** (parallelo, tangente, uguale) | Dichiarata | Compensata con coordinate numeriche, snap e conversione da forme base. Un risolutore resta fuori ambito |

## 9. Fasi e stima

Le stime sono di ordine di grandezza (giornate di lavoro, con test e documentazione).

| Fase | Contenuto | Stima |
|---|---|---|
| 1. Modello e kernel | Tipo `path`, `bezier.ts` (campionamento, chiusura sull'asse, orientamento, rilevamento delle autointersezioni), ramo in `evaluate.ts` e in `openscad.ts`, `resize.ts`, test (errore di campionamento sotto la tolleranza, contorni a x ≥ 0, coerenza tra kernel e codice, salvataggio) | 3 giorni |
| 2. Modale | Stato locale con cronologia, canvas SVG (griglia, zoom, pan), Penna e Seleziona, maniglie, tipi di nodo, inserimento ed eliminazione, sidebar, anteprima con il kernel, OK in un solo passo, compensazione della posizione, test e2e | 6 a 8 giorni |
| 3. Contorni e fori, forme base, import SVG con curve, "Converti in profilo" | Parser SVG, forme base, fori con annidamento | 3 a 4 giorni |
| 4. Miglioramenti | Linea con spessore, simmetria, raccordo per nodo | a richiesta |

La fase 1 si può rilasciare da sola (nodi creati da "Converti in profilo" e importati da OpenSCAD) e riduce il rischio della
fase 2; il codice nuovo è quasi tutto puro e testabile con Vitest. La verifica end to end della fase 2 usa Playwright con gli
helper `openApp` e `settled` già esistenti.

## 10. Domande aperte

Le risposte scelte sono nella decisione D7 della sezione 4.

1. Il profilo rotazionale deve poter attraversare l'asse (e in quel caso la parte a sinistra va ruotata, specchiata o scartata) oppure basta l'avviso di oggi?
2. Quale tolleranza di campionamento offrire come predefinita, 0,05 mm o 0,1 mm, tenendo conto del peso del codice OpenSCAD?
3. La bozza in `localStorage` vale anche tra schede diverse del browser o solo nella stessa?
4. Serve un limite al numero di nodi per contorno per proteggere l'interfaccia (per esempio 500)?
5. Conviene mantenere il nodo `svg` così com'è, oppure far convergere l'import SVG sul nuovo `path` in una versione successiva?
