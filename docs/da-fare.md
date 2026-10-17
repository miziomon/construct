# Cose da fare

Data: 8 ottobre 2026, aggiornato il 16 ottobre 2026 alla versione 0.66.1. Obiettivo: tenere in un solo posto le funzioni ancora da aggiungere a Construct, in ordine di priorità
per un uso orientato alla stampa 3D, dal confronto con OpenSCAD, Fusion 360, Blender e Tinkercad.
Si aggiorna a ogni funzione completata (colonna Stato) e a ogni nuova idea.

## Confronto con i programmi di riferimento

Fonti consultate: manuale di OpenSCAD (`rotate_extrude`, `offset`, `hull`), guida Revolve di Fusion 360, manuale Blender
(strumento Screw, modificatore Simple Deform), guide alle funzioni di Tinkercad (Duplica e Ripeti, Piano di lavoro, Righello,
Allinea, Capovolgi).

Cosa c'è già: Serie di copie (lineare, griglia, circolare) come gruppo Ripetizione, booleane (Unione, Differenza, Intersezione) e Foro, Raccordo, Smusso e Smusso angolare su spigoli scelti, Guscio (con cavità esatta sui profilati),
Pattern (Voronoi, esagoni, cerchi, rombi, triangoli), Dividi con un piano (per asse e quota, anche inclinato),
Allinea, Specchia (con anteprima), Misura con aggancio, quote cliccabili X, Y e Z sull'oggetto selezionato, menu contestuale con il tasto destro (sulla vista, sul vuoto e nell'elenco Oggetti), estrusione lineare e rotazionale delle forme 2D, Contorno (offset 2D),
testo (32 font), SVG, simboli ed emoji, profilati strutturali (L, T, H, U, tubolari), Inviluppo convesso e Minkowski, Appoggia sul piatto e su una faccia, Sdraia, Nascondi e Mostra,
viste (alto, fronte, lato, isometrica, ortografica, Inquadra), più piatti di stampa, preset delle stampanti, modelli di esempio,
import STL, 3MF, SVG e OpenSCAD, export STL, 3MF, OpenSCAD e immagine PNG con le 4 viste, timeline con Annulla, impostazioni, documentazione nell'app e PWA.

## Funzioni prioritarie

| # | Funzione | Dove esiste | Perché serve | Stato |
|---|---|---|---|---|
| 1 | Serie di copie, lineare e circolare | Tinkercad (Duplica e Ripeti), Fusion (Pattern rettangolare e circolare), Blender (Array), OpenSCAD (`for`) | Ripetere un pezzo è la richiesta più frequente | **Fatta** in 0.19.0: strumento Serie (tasto O) con gruppo Ripetizione parametrico. Resta "Rendi indipendenti" (vedi sotto) |
| 2 | Appoggia su una faccia (piano di lavoro) | Tinkercad (Workplane), Blender, Fusion | Orientare il pezzo per stamparlo | **Fatta** in 0.18.0: strumento a clic sulla faccia (tasto V). Resta il piano di lavoro vero e proprio |
| 3 | Viste: ortografica, preset (alto, fronte, iso), zoom sulla selezione | Tutti e tre | Misurare e allineare con precisione | **Fatta** in 0.39.0: tendina Viste (7, 1, 3, 0), Inquadra selezione (.) e tutto (Home), ortografica (5) |
| 4 | Dividi con un piano, con eventuali connettori | Fusion (Split Body), Blender (Bisect) | Pezzi più grandi del piatto | **Fatta** in 0.40.0 (piano per asse e quota, due gruppi Intersezione parametrici) e 0.49.0 (piano inclinato con angolo e asse di rotazione). Connettori **fatti** in 0.50.0 (perni e sedi, oppure fori e spine, tondi o quadrati, con tolleranza, fila regolabile e avviso se escono dal pezzo); restano la griglia di connettori, la posizione automatica e gli incastri a coda di rondine |
| 5 | Offset 2D e inviluppo convesso | OpenSCAD (`offset`, `hull`), Fusion (Offset) | Spessori, giochi, forme che uniscono due oggetti | **Fatta** in 0.18.0: campo Contorno nel Profilo 2D e Inviluppo convesso (tasto J) |
| 6 | Disegno di profili con linee e curve | Fusion (Sketch), Tinkercad (Scribble) | Oggi i profili vengono solo da forme o SVG: è la funzione strategica più grande | **Disegno libero fatto a fasi**: modello, kernel, codice OpenSCAD e ritorno in 0.60.0, modale di disegno con Penna e Seleziona in 0.61.0 (rifinita fino alla 0.65.2); restano la fase 3 (forme base, import SVG con le curve, elenco dei fori) e i punti aperti nelle sezioni "Profili Bézier" qui sotto. In 0.33.0 e 0.34.0 sono arrivati i profilati strutturali a L, T, H e U e i tubolari rettangolari e tondi, con spessori e raccordi; mancano la Z e i preset commerciali. Studio di fattibilità con prototipo interattivo (modale con curve di Bézier editabili, estrusione lineare o rotazionale, anteprima 3D): `docs/studio-profili-bezier.md` e `docs/prototipi/profilo-bezier.html` |
| 7 | Deformazioni Twist, Bend e Taper su qualunque solido; elica (passo) per la rotazione | Blender (Simple Deform, Screw) | Molle, viti, forme organiche | Da fare. **Studio di fattibilità con prototipo** (kernel `manifold-3d` vero, misure su 16 casi): `docs/studio-deformazioni.md` e `docs/prototipi/deformazioni.html`. Esito alto. Fasi proposte: 1 elica (passo, giri e verso nella rotazionale, con filetti e molle come caso d'uso), 2 gruppo Deforma con Torsione e Rastremazione (Maiusc+D), 3 Piega (limitata a ±180°), 4 Filetto e Molla come preset o nodo (facoltativa). Decisioni aperte nello studio (sezione 10) |
| 8 | Parametri e formule; controlli di stampabilità (pareti sottili, sbalzi) | Fusion (Parameters), OpenSCAD (variabili) | Modelli riutilizzabili e meno stampe fallite | **Parametri e formule fatti** in 0.51.0 (scheda Parametri, formule nei campi, variabili e Customizer nel codice OpenSCAD). **Avvisi di stampabilità fatti** in 0.52.0 (piano, appoggio, sbalzi, mesh non valide, formule). **Pareti sottili e parti staccate e sospese fatte** in 0.53.0 (sezioni nel worker). **Ignora un avviso, finestra Parametri e selettore dei parametri fatti** in 0.54.0. Da fare: dettagli sotto l'ugello; import dei parametri da OpenSCAD, formule nei campi in percentuale |
| 9 | Applica pattern (Voronoi casuale, poi esagoni e cerchi) con parametri modificabili | OpenSCAD (con librerie), Fusion (Emboss e Pattern), Blender (Voronoi texture) | Alleggerire e decorare pannelli, coperchi e lampade | **Fatta** in 0.20.0 e 0.21.0 (studio `docs/studio-pattern-voronoi.md`): strumento Pattern (tasto Z) con Voronoi con seme, esagoni, cerchi, rombi e triangoli, tasche da uno o due lati, scelta di una faccia con il clic (dalla 0.59.0 anche inclinata, più facce applicando di nuovo il Pattern) e anteprima semplificata. Il reticolo 3D è stato tolto |

## Studio di fattibilità: Serie di copie (punto 1, realizzata in 0.19.0)

**Esito: fattibilità alta.** Il Guscio è già un gruppo con un parametro opzionale (`shell?: ShellParams`) e un solo figlio,
gestito dal kernel (`build`), dal generatore di codice (`groupLines`), da uno strumento con pannello e anteprima
(`shellToolStore`, `ShellPanel`) e da campi nel pannello delle proprietà. La Serie segue lo stesso schema.

### Architettura proposta

- Nuovo tipo di gruppo `op: 'array'` con `array?: ArrayParams`: tipo (lineare, circolare, griglia), numero di copie, passo o
  spazio totale, asse, angolo totale, centro, ruota le copie, includi l'originale.
- Kernel: il figlio si costruisce una volta (cache) e si piazzano N copie con `place()`, già usata per le trasformazioni, poi
  `Manifold.union`. Con copie che non si sovrappongono il costo di N fino a 200 è trascurabile.
- Codice OpenSCAD: un vero `for (i = [0 : n - 1]) translate(...) rotate(...) figlio;`, più leggibile di N copie scritte a mano.
- Parametrica e modificabile dopo la creazione (come i Pattern di Fusion), a differenza del Duplica e Ripeti di Tinkercad.
- Separa può "rendere indipendenti" le copie in N oggetti.

### Rischi e costo

- Copie sovrapposte: l'unione è più pesante e il risultato non coincide con N oggetti distinti.
- Maniglia Ridimensiona sul gruppo, selezione di una singola copia, limite del numero di copie.
- Strumenti che leggono i figli (Raccordo, Guscio sul figlio): sono già trattati come gruppo.
- Costo stimato: simile al Guscio (tipo di gruppo, pannello con anteprima, campi nelle proprietà, codice, test).

### Ipotesi di interfaccia

Pulsante "Serie" nella barra principale (tasto da scegliere tra Z e O) con un oggetto selezionato: pannello flottante come il
Guscio, anteprima fantasma delle copie, OK e Annulla.

```
Serie                                  [x]
Tipo   [ Lineare | Circolare | Griglia ]
-- Lineare ------------------------------
Copie        [ 5 ]  (con l'originale)
Passo X/Y/Z  [ 30 ] [ 0 ] [ 0 ] mm   (o "Spazio totale")
-- Circolare ----------------------------
Copie [ 8 ]   Angolo totale [ 360 ]
Asse [ Z ]   Centro [ origine | oggetto | scelto ]
[x] Ruota le copie
------------------------------------------
Include l'originale [x]        [Annulla] [OK]
```

Dopo l'OK il risultato è un gruppo "Serie" modificabile dal pannello delle proprietà (stessi campi) e separabile.
Primo passo economico alla Tinkercad: **Duplica e ripeti** (Ctrl+D ripete l'ultimo spostamento relativo).

## Idee minori

- Quote tra oggetti (distanza tra due oggetti o tra un oggetto e il piatto, da digitare per spostarli) e quote sulle singole facce o sui fori: oggi le quote sono solo le tre dimensioni dell'ingombro.
- Menu contestuale del vuoto con più voci (Incolla, viste, Importa) e menu sulle righe dell'elenco oggetti.
- Piatti: provare i metadati scritti nel 3MF (`Metadata/model_settings.config`) in Bambu Studio e Orca, perché non si possono verificare senza gli slicer (restano ignorati dai programmi che non li conoscono), trascinamento degli oggetti tra i piatti, piatti con misure diverse.
- Import OpenSCAD: quello che resta è nella sezione "Importa OpenSCAD" qui sotto (`polyhedron`, `import()`, `use`/`include` e librerie come BOSL2, booleane 2D vere).
- Impostazioni: lingua, unità, colori dei nuovi oggetti, qualità predefinita delle curve, scorciatoie personalizzabili.
- Schermata di benvenuto: l'elenco dei progetti recenti. I modelli di esempio ci sono dalla 0.41.0 (tre schede; altri esempi si aggiungono in `src/examples/catalog.ts` con il JSON del progetto e l'anteprima rigenerata da `e2e/docs-images.spec.ts`).
- Preset del piano: altre stampanti (Voron) e preset salvati dall'utente. Anycubic ed Elegoo ci sono dalla 0.29.0.
- Ripetizione: "Rendi indipendenti" (Separa produce N oggetti veri, uno per copia), serie lungo un percorso o una curva, passo diverso per ogni asse nella lineare con angolo, copie che seguono un oggetto di riferimento, Ctrl+D che ripete l'ultimo spostamento (Duplica e ripeti di Tinkercad).
- Estrusione rotazionale: opzione simmetrica (come Fusion, da -angolo/2 a +angolo/2) e passo elicoidale (come Blender Screw).
- Inviluppo convesso anche per le forme 2D (prima dell'estrusione).
- Appoggio automatico sulla faccia piana più grande (pulsante senza scelta).
- Anteprima nella vista 3D anche per Misura e Appoggia sul piatto.
- Pulsante per ripristinare i valori ricordati (ultimi valori usati).
- Lucchetto delle proporzioni e Scala per le altre primitive (cilindro, cono, sfera, toro).
- Controllo automatico del peso dei chunk in build (`size-limit`).
- Dividi, connettori: griglia (righe per colonne) oltre alla fila, posizione automatica dentro la sezione del taglio, incastri a coda di rondine o a tenone, smusso in punta al perno, scelta del punto con un clic sul piano di taglio.
- Immagine delle 4 viste: scelta delle viste e della risoluzione, e immagine singola della vista corrente (oggi solo PNG 1600 × 1600 con le quattro viste).
- Nascondi: nascondere anche gli oggetti dentro un gruppo (oggi solo quelli alla radice) e isolare l'oggetto selezionato.
- Modelli di esempio: altri progetti nel catalogo (`src/examples/catalog.ts`), per esempio una scatola con coperchio e un supporto parametrico.
- Nomi in italiano e ricerca per le emoji (scartati per ora).
- Pattern: applicando un secondo Pattern a un oggetto già forato, partire dagli stessi parametri del precedente (tipo, passo, parete, margine, arrotondamento) invece dei valori di default, così le facce forate in momenti diversi hanno lo stesso aspetto.
- Pattern: pulsante "Cambia faccia" nelle proprietà del gruppo Pattern, che riapre lo strumento sulla faccia già scelta (oggi la faccia si sceglie solo all'applicazione; dopo l'OK si può solo riapplicare il Pattern).
- Timeline: un clic sulla miniatura nel tooltip per ingrandirla o salvarla come PNG.
- **Torsione oltre 720°: il tetto di 360 strati resta** (misurato in 0.67.0 su un profilo 60 × 5 × 40 mm, volume esatto 12 000 mm³: errore -0,19% a 3600°, +0,03% a 1800°, +0,04% a 720°). Portare gli strati a 1800 darebbe +0,05% ma con 807 mila triangoli invece di 188 mila e il triplo del tempo: non è un difetto di qualità. Il budget di triangoli resta utile solo per il costo in memoria dei profili con molti punti (scatola con fori a 3600°: 793 mila triangoli, 711 MB, studio delle deformazioni, sezione 4.4); il test `una torsione fino a 3600°…` in `src/kernel/evaluate.test.ts` fissa l'errore sotto l'1%.

## Importa OpenSCAD: cosa non si legge ancora (aggiornato alla 0.49.0, nessun comando nuovo dalla 0.32.0)

### Esempi della cartella `import/` (0.29.0)

Tre esempi CC0 di prova, confrontati con OpenSCAD in locale (build con backend Manifold, `openscad --backend=manifold -o out.stl file.scad`): si legge l'STL, si calcolano volume e ingombro e si confrontano con quelli del solido importato e calcolato dal kernel di Construct.

| File | Comandi che servivano | Volume (Construct / OpenSCAD) | Ingombro | Tempo di calcolo |
|---|---|---|---|---|
| `Bauble.scad` | intervallo `[0:1:count-1]`, `rotate_extrude` di `polygon`, `linear_extrude` con torsione, `hull`, `$fa`/`$fs` | 114 896 / 115 946 mm³ (-0,9%) | uguale (±0,03 mm) | circa 2 s |
| `Bauble2.scad` | `offset` annidati, `linear_extrude` con torsione e scala, `rotate_extrude`, moduli con `$fs`/`$fa` | 60 166 / 60 159 mm³ (+0,01%) | uguale | circa 0,6 s |
| `BabyToy.scad` | `minkowski` (tre blocchi, anche con prisma triangolare e cilindro a 251 lati) | 38 885 / 38 809 mm³ (+0,2%) | uguale (±0,01 mm) | 0,08 s (0.32.0; 0,2 s nella 0.31.0, 12 s prima) |
| `coffe-cup.scad` | `minkowski` di un cono unito a un manico forato (profilo arrotondato, `$fn = 140`) con una sfera, 2D `hull` e `intersection` dentro `linear_extrude`, `$fn` dinamico nei moduli | 32 423 mm³ (non confrontato con OpenSCAD) | — | 2,2 s (0.32.0; 16 s nella 0.31.0) |

Che cosa non funzionava e come è stato risolto:
- **`Bauble`: le pale mancavano** (una su sette). Causa: un intervallo con il passo, `[0:1:6]`, veniva letto come "inizio 0, passo 6, fine 1", quindi il ciclo `for` faceva una sola iterazione. Corretto (con test).
- **`Bauble`: pale più sottili del vero** (-14% di volume per ogni pala). Causa: nell'estrusione con torsione manifold divide ogni quadrilatero laterale in due triangoli, e su un lato lungo (120 mm) il quadrilatero è molto storto: il solido esce gonfio o svuotato (fino al 14%) a seconda del verso della torsione. Ora il kernel spezza i lati del profilo in tratti lunghi quanto uno strato (come fa OpenSCAD, con molti più triangoli): errore sotto l'1%. Vale anche per le forme native con torsione.
- **`Bauble`: giro a 64 lati invece di 180.** Il profilo di `rotate_extrude` ora usa `$fa`/`$fs` del file con la formula di OpenSCAD sul raggio massimo.
- **`BabyToy`: nessun oggetto.** Mancava `minkowski`. Ora è un gruppo "Minkowski" (kernel con `Manifold.minkowskiSum`, codice `minkowski()` e importazione). Due cose da sapere: `minkowskiSum` di manifold-3d sbaglia se il secondo solido non contiene l'origine (il risultato comprende anche il primo), quindi gli operandi si portano al centro, si sommano e il risultato si risposta; inoltre in OpenSCAD `translate(t) minkowski() { A; B; }` sposta il risultato una volta sola, quindi i figli stanno nel sistema locale del gruppo.
- **`Bauble2`: unico scarto noto**, gli `offset(±.1) offset(1) offset(-1)` (apertura che arrotonda le punte della stella) si sommano in un contorno di ±0,1: il volume coincide, le punte restano un po' più vive (nota nel rapporto di importazione).

Risolto nella 0.31.0: la durata di `BabyToy` (era 12 s) scende a circa 0,2 s perché l'operando è l'unione di tre solidi separati, ciascuno convesso, e la somma di Minkowski si distribuisce sull'unione (si sommano le componenti una a una).

### Cosa non si legge ancora

Dalla 0.27.0 l'importazione legge anche `let`/`assign`, le liste per comprensione complete (`for` annidati, `if`/`else`, `each`, `let`, forma del C), `^`, le funzioni anonime, `children(i)`, `$children`, `$fa`/`$fs`, `multmatrix`, `polygon` con `paths`, `offset`, `rotate_extrude`, `text`, `resize` e molte funzioni (`lookup`, `search`, `rands`, `cross`, `chr`, `ord`, `is_string`, `is_bool`, `is_function`). Quello che resta è più difficile e va valutato insieme.

| Comando | Difficoltà | Cosa servirebbe |
|---|---|---|
| `polyhedron` | Media-alta | Non c'è un nodo di poliedro generico (il Dado ha solo cinque solidi fissi, uno per numero di facce). La via è una mesh importata (`MeshNode`), che richiede la registrazione asincrona dell'asset nel worker, un solido chiuso e a tenuta, e l'inversione dell'ordine delle facce (OpenSCAD le vuole in senso orario). Oggi `importScad` e lo store sono sincroni: andrebbe reso asincrono il percorso di importazione. |
| `import("file.stl")` | Alta | Il file sta accanto al `.scad`: bisogna far scegliere più file insieme (o una cartella), registrare ogni mesh e collegarla ai nodi. Come il `polyhedron`, richiede un flusso asincrono. |
| `offset` annidati (apertura e chiusura) | Media | `offset(r=-1) offset(r=1)`: oggi si sommano (contorno netto), ma non arrotondano le punte come OpenSCAD. Servirebbero operazioni 2D sul profilo prima dell'estrusione (unione, apertura, chiusura). |
| `minkowski` su superfici concave molto curve | Media | Dalla 0.32.0 il controllo di contenimento delle toppe è geometrico (senza booleane) e la pennellata si ricampiona a 0,01 mm di corda: la tazza passa da 16 s a 2,2 s. Resta lento un guscio con curve fitte (una sfera cava a 48 lati), dove il costo sta nell'unione di centinaia di inviluppi. Misura della 0.41.2 (piastra 30×30×10 con foro tondo a 48 lati e sfera di raggio 1,5, `BENCH=1 npx vitest run src/kernel/bench.test.ts`): 1,4 s a freddo, di cui circa il 94% dentro il WASM (hull e soprattutto l'unione finale delle toppe, che Manifold calcola in modo pigro al primo `getMesh`) e solo il 5% in JavaScript; con 24 lati scende a 0,45 s. Riscrivere in typed array il codice JS di `minkowski.ts` non servirebbe, conta il numero di toppe. Passi possibili: un quickhull in JavaScript per i controlli delle toppe (oggi ogni controllo passa dal WASM, circa 1 ms), toppe più grandi sulle facce piane (scomposizione convessa 2D del poligono invece della crescita a triangoli), offset 3D diretto per operandi sferici. |
| `projection` | Alta | Nessun corrispettivo: servirebbe una forma 2D ottenuta dalla sezione o dall'ombra di un solido (`slice` esiste nel kernel, usata solo dal Guscio). |
| `surface` | Alta | Legge un file di dati o un'immagine: stesso problema dei file esterni di `import`. |
| `roof` | Molto alta | È poco usato e richiede lo scheletro del poligono (straight skeleton). |
| `fill` | Media | Riempie i fori di una forma 2D: per un poligono singolo basta tenere solo il contorno esterno, per un'unione di forme serve un'operazione 2D vera. |
| `use` e `include` di file locali | Alta | Come `import`: servirebbe far scegliere più file insieme e leggere anche i loro moduli e funzioni. Oggi si avvisa e i moduli richiamati risultano sconosciuti. |
| `parent_module`, `is_object`, `object`, `has_key`, `textmetrics` | Bassa | Funzioni poco usate; i dizionari (`object`) sono recenti e richiedono un nuovo tipo di valore nell'interprete. |
| `color` con trasparenza (alpha) | Non rappresentabile | La scena non ha trasparenza per oggetto. |
| `linear_extrude` con `scale` diversa per X e Y | Non rappresentabile | Il parametro `scaleTop` è un solo numero: dalla 0.66.3 l'importazione usa quello di X e lo segnala con una nota. |
| `offset(chamfer = true)` | Non rappresentabile | Gli angoli sono arrotondati o vivi, non smussati. |
| `text` | Media | La posizione è stimata (il font di OpenSCAD non è nel catalogo e le misure dei glifi non sono disponibili in modo sincrono). Con le misure vere dei font si potrebbe calcolare l'allineamento esatto. |

## Profili Bézier: punti aperti dalla fase 1 (0.60.0)

- **Costo di un commento ostile ma lecito**: un `// construct:path` al limite dei dati (100 contorni da 500 nodi con cubiche piene di estremi) costa circa 1 s di thread principale per poligono (3 s prima della 0.67.0, che ha tolto i raddoppi inutili della tolleranza oltre 1 mm). Un file con molti poligoni così rallenta ancora l'interfaccia; si potrebbe portare il lavoro in un worker, abbassare i tetti o calcolare il riquadro dai soli estremi delle cubiche.
- **Linea aperta verticale in rotazione**: un tornio disegnato come un solo tratto verticale produce `[]`, perché `svgContours` scarta i disegni senza larghezza. Dalla 0.61.0 il piede della modale lo spiega ("tutti i punti stanno sulla stessa verticale... aggiungi un punto non allineato") e OK resta disattivato, ma il caso d'uso resta senza soluzione: servirà un modo di dare spessore o larghezza minima al disegno.

## Profili Bézier: punti aperti dalla fase 2 (0.61.0)

Chiusi dalla fase 2: modale di disegno con Penna e Seleziona, anteprima 3D, voce in libreria, menu del vuoto, Proprietà e comando `profile` (Maiusc+P), compensazione della posizione, scala incorporata, bozza, tolleranza effettiva e avviso dei troppi punti. Restano:

- **Fase 3 dello studio**: chiusa nella 0.69.0 (forme base, fori, Importa SVG con le curve, Converti in profilo). Restano i punti della sezione qui sotto.
- **Anteprima a ogni gesto**: durante un trascinamento il kernel ricalcola al massimo ogni 100 ms con una sola richiesta in volo; con profili molto fitti (migliaia di punti) l'anteprima può restare indietro. Si potrebbe campionare più grossolano durante il gesto.
- **Controlli dei componenti**: la modale si prova solo da e2e (Vitest gira in ambiente node): i gesti del canvas non hanno test unitari, solo le funzioni pure di `model.ts`.
- **Attese fisse negli e2e** (0.66.2: quelle che aspettavano il salvataggio automatico ora usano `sceneSaved` in `e2e/helpers.ts`): restano `waitForTimeout` che sono pause vere (distanza tra due clic, prove di assenza come "la bozza non torna", un frame dopo l'attivazione del gizmo, il generatore di immagini `docs-images.spec.ts`).
- **Screenshot dei due temi** della modale: il piano li voleva allegati alla PR; per ora c'è solo `docs/images/profilo-editor.png`.
- **Annulla della bozza ripristinata**: dopo "Ripristina" Ctrl+Z torna al disegno della scena, non ai singoli passi fatti prima della chiusura (la bozza salva solo lo stato finale).

## Profili Bézier: punti aperti dalla fase 3 (0.69.0)

- **Importa SVG**: `<style>` e `<use>` non si leggono (un tracciato che dipende da una classe CSS o da un simbolo riusato si perde). Un SVG oltre 500 nodi per contorno o 100 contorni si rifiuta per intero invece di semplificarsi; servirebbe una semplificazione dei punti (Ramer-Douglas-Peucker).
- **Converti in profilo**: il Testo non si converte (usa il riempimento NonZero e dipende dai font); un SVG della scena oltre i tetti si rifiuta (conviene importare il file nella modale); un poligono a lati dispari con torsione o scala della cima non si converte; il cerchio con più di 12 lati diventa 4 curve e il solido cambia di poco (area -0,16% a 64 lati, fino a circa +4% a 13).
- **Chunk della modale**: `svgPaths.ts` importa `unitScale` da `svg.ts` e con esso `SVGLoader` di three; spostare `unitScale` e `MM_PER_UNIT` in un modulo piccolo alleggerirebbe il chunk.
- **Fori**: `contourHoles` usa il primo punto campionato di ogni contorno; se due contorni si toccano proprio lì l'esito è ambiguo.
- **Chiusura dei sottotracciati SVG**: la tolleranza di 1e-4 della diagonale guarda solo i nodi e non le maniglie; una "goccia" fatta di una sola curva chiusa con un piccolo errore resta di 2 nodi.

## Font non presenti su Google Fonts

Dalla cartella `C:\Users\maurizio.MAVIDA\Dropbox\openscad\fonts` (0.30.0) sono entrati nel catalogo i font che si trovano su Google Fonts (Bilbo Swash Caps, Boogaloo, Calistoga, Dancing Script Regular, Marck Script, Meow Script, Modak, Niconne, Playfair Display Regular, Roboto Black, Sriracha; Pacifico c'era già). Questi no, perché non risultano su Google Fonts:

| File | Nota |
|---|---|
| `Be My Glittertine.ttf` | Font decorativo di terzi |
| `Chasing Hearts.ttf` | Font decorativo di terzi |
| `Chocolate.ttf` | Font decorativo di terzi |
| `Christmas Icons.ttf` | Icone natalizie (font di simboli, non di testo) |
| `Christmas Time.ttf` | Font decorativo di terzi |
| `Kid Games.ttf` | Font decorativo di terzi |
| `LovelyMelody.ttf` | Font decorativo di terzi |
| `Sweet Child.ttf` | Font decorativo di terzi |
| `Unicorn Calligraphy.ttf` | Font decorativo di terzi |

Prima di includerli nell'app va verificata la licenza (molti font di questo tipo sono "solo uso personale" e non si possono ridistribuire nell'app né nello ZIP dell'export), che siano statici (senza tabella `fvar`) e che famiglia e stile coincidano con quelli dichiarati. In alternativa si può cercare un font simile con licenza OFL su Google Fonts.
