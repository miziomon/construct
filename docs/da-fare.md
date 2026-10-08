# Cose da fare

Data: 7 ottobre 2026. Obiettivo: tenere in un solo posto le funzioni ancora da aggiungere a Construct, in ordine di priorità
per un uso orientato alla stampa 3D, dal confronto con OpenSCAD, Fusion 360, Blender e Tinkercad.
Si aggiorna a ogni funzione completata (colonna Stato) e a ogni nuova idea.

## Confronto con i programmi di riferimento

Fonti consultate: manuale di OpenSCAD (`rotate_extrude`, `offset`, `hull`), guida Revolve di Fusion 360, manuale Blender
(strumento Screw, modificatore Simple Deform), guide alle funzioni di Tinkercad (Duplica e Ripeti, Piano di lavoro, Righello,
Allinea, Capovolgi).

Cosa c'è già: Serie di copie (lineare, griglia, circolare) come gruppo Ripetizione, booleane (Unione, Differenza, Intersezione) e Foro, Raccordo, Smusso e Smusso angolare su spigoli scelti, Guscio,
Allinea, Specchia (con anteprima), Misura con aggancio, quote cliccabili X, Y e Z sull'oggetto selezionato, menu contestuale con il tasto destro, estrusione lineare e rotazionale delle forme 2D, Contorno (offset 2D),
testo, SVG, simboli ed emoji, Inviluppo convesso, Appoggia sul piatto e su una faccia, import STL, 3MF e SVG, export STL, 3MF e
OpenSCAD, timeline con Annulla.

## Funzioni prioritarie

| # | Funzione | Dove esiste | Perché serve | Stato |
|---|---|---|---|---|
| 1 | Serie di copie, lineare e circolare | Tinkercad (Duplica e Ripeti), Fusion (Pattern rettangolare e circolare), Blender (Array), OpenSCAD (`for`) | Ripetere un pezzo è la richiesta più frequente | **Fatta** in 0.19.0: strumento Serie (tasto O) con gruppo Ripetizione parametrico. Resta "Rendi indipendenti" (vedi sotto) |
| 2 | Appoggia su una faccia (piano di lavoro) | Tinkercad (Workplane), Blender, Fusion | Orientare il pezzo per stamparlo | **Fatta** in 0.18.0: strumento a clic sulla faccia (tasto V). Resta il piano di lavoro vero e proprio |
| 3 | Viste: ortografica, preset (alto, fronte, iso), zoom sulla selezione | Tutti e tre | Misurare e allineare con precisione | Da fare |
| 4 | Dividi con un piano, con eventuali connettori | Fusion (Split Body), Blender (Bisect) | Pezzi più grandi del piatto | Da fare |
| 5 | Offset 2D e inviluppo convesso | OpenSCAD (`offset`, `hull`), Fusion (Offset) | Spessori, giochi, forme che uniscono due oggetti | **Fatta** in 0.18.0: campo Contorno nel Profilo 2D e Inviluppo convesso (tasto J) |
| 6 | Disegno di profili con linee e curve | Fusion (Sketch), Tinkercad (Scribble) | Oggi i profili vengono solo da forme o SVG: è la funzione strategica più grande | Da fare |
| 7 | Deformazioni Twist, Bend e Taper su qualunque solido; elica (passo) per la rotazione | Blender (Simple Deform, Screw) | Molle, viti, forme organiche | Da fare |
| 8 | Parametri e formule; controlli di stampabilità (pareti sottili, sbalzi) | Fusion (Parameters), OpenSCAD (variabili) | Modelli riutilizzabili e meno stampe fallite | Da fare |
| 9 | Applica pattern (Voronoi casuale, poi esagoni e cerchi) con parametri modificabili | OpenSCAD (con librerie), Fusion (Emboss e Pattern), Blender (Voronoi texture) | Alleggerire e decorare pannelli, coperchi e lampade | **Fatta** in 0.20.0 e 0.21.0 (studio `docs/studio-pattern-voronoi.md`): strumento Pattern (tasto Z) con Voronoi con seme, esagoni, cerchi, rombi e triangoli, tasche da uno o due lati, scelta di più facce con il clic e anteprima semplificata. Il reticolo 3D è stato tolto |

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
- Schermata di benvenuto: modelli di esempio (la scheda c'è ma non è ancora selezionabile) e l'elenco dei progetti recenti.
- Preset del piano: altre stampanti (Anycubic, Elegoo, Voron) e preset salvati dall'utente.
- Ripetizione: "Rendi indipendenti" (Separa produce N oggetti veri, uno per copia), serie lungo un percorso o una curva, passo diverso per ogni asse nella lineare con angolo, copie che seguono un oggetto di riferimento, Ctrl+D che ripete l'ultimo spostamento (Duplica e ripeti di Tinkercad).
- Estrusione rotazionale: opzione simmetrica (come Fusion, da -angolo/2 a +angolo/2) e passo elicoidale (come Blender Screw).
- Inviluppo convesso anche per le forme 2D (prima dell'estrusione).
- Appoggio automatico sulla faccia piana più grande (pulsante senza scelta).
- Anteprima nella vista 3D anche per Misura e Appoggia sul piatto.
- Pulsante per ripristinare i valori ricordati (ultimi valori usati).
- Lucchetto delle proporzioni e Scala per le altre primitive (cilindro, cono, sfera, toro).
- Controllo automatico del peso dei chunk in build (`size-limit`).
- Nomi in italiano e ricerca per le emoji (scartati per ora).
