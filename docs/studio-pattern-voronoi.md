# Studio di fattibilità: Applica pattern (Voronoi)

Data: 7 ottobre 2026. Domanda: si può aggiungere a WebCAD un comando "Applica pattern" che tagli in un oggetto un pattern
Voronoi casuale, con i parametri principali modificabili (seme, numero di celle, spessore delle pareti, ...), mantenendo i
tempi di calcolo da editor interattivo e il codice OpenSCAD esportabile?

**Esito: fattibilità alta** per fori passanti o tasche lungo un asse (il caso scelto come primo risultato), **media**
per l'applicazione su una faccia qualunque, **bassa** per il reticolo Voronoi 3D e per l'avvolgimento su superfici curve.
Il risultato sarebbe un gruppo parametrico "Pattern: Voronoi" come la Ripetizione: il pezzo originale resta dentro il gruppo
e i parametri si modificano dal vivo.

## Opzioni valutate

| Opzione | Cosa fa | Costo | Esito |
|---|---|---|---|
| a. Fori o tasche lungo un asse | Celle di Voronoi (ridotte di metà spessore) tagliate nel pezzo in direzione X, Y o Z: restano le pareti | Basso: operazioni 2D e una sola differenza 3D | **Proposta** (fase 1) |
| b. Solchi | Si scavano solo le linee tra le celle: restano le celle in rilievo | Basso (stessa pipeline) | **Proposta** (modo del gruppo) |
| c. Sulla faccia scelta | Il disegno parte dal piano di una faccia e dal suo contorno (sistema di riferimento della faccia) | Medio: serve il contorno della faccia | Fase 3 |
| d. Reticolo 3D (provato in 0.20.0 e tolto in 0.21.0) | Voronoi volumetrico: ogni lato diventa un cilindro dentro il solido, per alleggerire | Alto: le celle crescono col cubo del volume, migliaia di cilindri e di unioni | Solo con poche decine di celle, fase 3 |
| e. Su superfici curve | Il pattern segue la superficie di un cilindro o di una sfera | Alto: richiede una parametrizzazione UV | Fuori ambito |

## Perché è fattibile

- **Geometria 2D già disponibile** in manifold-3d 3.5: `Manifold.project()` (silhouette del solido), `Manifold.slice(z)`,
  `CrossSection.compose`, `subtract`, `intersect`, `offset` (giunzioni Miter e Round) e `Manifold.extrude`.
  Si lavora in 2D, sulla regione da forare, e si fa una sola differenza 3D.
- **Architettura già provata**: lo stesso schema della Ripetizione (e prima del Guscio). Gruppo `op: 'pattern'` con
  `pattern?: PatternParams` e un solo figlio; il kernel lo costruisce in `build()`, il generatore OpenSCAD in `groupLines`,
  lo strumento ha un pannello con anteprima dal vivo e OK/Annulla (come `arrayToolStore` e `ArrayPanel`), e le proprietà del
  gruppo mostrano gli stessi campi (come `ArrayFields`).
- **Voronoi 2D semplice**: per qualche centinaio di punti basta una funzione propria. Ogni cella parte dal rettangolo che
  contiene la regione e si ritaglia con il mezzo piano di ogni altro punto vicino (ordinati per distanza, con uscita
  anticipata): nessuna dipendenza, deterministica e testabile. In alternativa `d3-delaunay` (circa 10 KB, licenza ISC), che
  però non serve.
- **Casualità riproducibile**: un generatore pseudo-casuale con seme (mulberry32) dà lo stesso disegno a ogni ricalcolo, nel
  salvataggio e nel codice. Il seme è un parametro, con il pulsante "Nuovo seme".

## Algoritmo proposto (kernel)

1. **Regione.** Silhouette del pezzo lungo l'asse scelto (`project()` del figlio, ruotato in modo che l'asse sia Z; per i
   pezzi cavi si può usare `slice` a una quota), ridotta del **margine** con `offset(-margine)`. Il margine lascia una cornice
   piena attorno al disegno.
2. **Punti.** `celle` punti casuali nel rettangolo che contiene la regione. La **regolarità** (0–100 %) decide quante
   iterazioni di rilassamento di Lloyd si fanno (0 = casuale puro, più alto = celle più uniformi) e la distanza minima tra i
   punti (campionamento a dardi), per evitare celle minuscole.
3. **Celle.** Poligoni di Voronoi ritagliati sul rettangolo. Ognuno si riduce di `spessore / 2` (`offset` negativo, Miter) e si
   arrotonda di `raggio` (riduzione maggiorata del raggio e poi `offset` positivo Round); poi si interseca con la regione.
4. **Taglio.** `Manifold.extrude(celle, profondità)` posizionato dal lato scelto (sopra o sotto) o passante su tutto lo
   spessore, poi `difference(pezzo, celle)`. Modo **Solchi**: si taglia la regione meno le celle.
5. Il gruppo applica infine la sua trasformazione, come tutti gli altri.

## Parametri principali (tutti modificabili dal vivo)

| Parametro | Significato | Valori |
|---|---|---|
| Seme | Numero che fissa la disposizione casuale; "Nuovo seme" ne sceglie uno diverso | intero |
| Celle | Quanti punti casuali (e quindi celle) | 3–500 |
| Regolarità | Rilassamento di Lloyd e distanza minima tra i punti | 0–100 % |
| Parete | Spessore della parete tra due celle | mm (consigliato almeno 0,8) |
| Arrotondamento | Raggio degli angoli delle celle | mm |
| Margine | Cornice piena che resta attorno al disegno | mm |
| Asse e lato | Direzione del taglio e lato da cui parte (sopra, sotto) | X, Y, Z |
| Profondità | Passante oppure una profondità in mm | mm |
| Modo | Fori (si tolgono le celle) o Solchi (si tolgono le pareti) | |

## Codice OpenSCAD

OpenSCAD non ha il Voronoi, quindi si emettono le **celle già calcolate** (poligoni ritagliati sul rettangolo, prima della
riduzione) in un elenco `cells = [ [[x, y], ...], ... ];` e il resto lo fanno le funzioni di OpenSCAD:

```
difference() {
  <pezzo>;
  translate([0, 0, quota])
  linear_extrude(height = profondita)
  intersection() {
    offset(delta = -margine) projection() <pezzo>;
    for (c = cells) offset(r = raggio) offset(delta = -(parete / 2 + raggio)) polygon(c);
  }
}
```

Il disegno coincide con quello del kernel perché i calcoli sensibili (riduzione, arrotondamento, regione) li esegue OpenSCAD
con le stesse operazioni. Il codice resta compatto, una riga per cella.

## Interfaccia (ipotesi)

Pulsante "Pattern" nella barra principale (tasto Z, l'unica lettera ancora libera), attivo con un solo oggetto selezionato e
non bloccato. Pannello flottante come la Serie, con anteprima dal vivo e OK/Annulla:

```
Applica pattern                         [x]
Tipo       [ Voronoi v ]   (poi: Esagoni, Cerchi, ...)
Seme       [ 4821 ] [ Nuovo seme ]
Celle      [ 60 ]
Regolarità [ 40 % ]
Parete     [ 1.6 ] mm      Arrotondamento [ 1.0 ] mm
Margine    [ 4 ] mm
Asse       [ X | Y | Z ]   Lato [ Sopra | Sotto ]
Profondità [ Passante | 3 mm ]
Modo       [ Fori | Solchi ]
-----------------------------------------
Celle risultanti: 60            [Annulla] [OK]
```

Dopo l'OK compare nell'elenco oggetti il gruppo "Pattern: Voronoi" con dentro l'originale, e nel pannello delle proprietà
gli stessi campi (seme, celle, parete, ...). Il menu Tipo serve ad aggiungere in seguito altri pattern (esagoni, cerchi,
rombi) con lo stesso gruppo e parametri diversi.

## Rischi e limiti

- **Costo di calcolo.** Un Voronoi a 500 punti e 500 `offset` richiedono decine di millisecondi; l'operazione più pesante è la
  differenza 3D con migliaia di facce. Da misurare, con il limite di 500 celle e, se serve, un'anteprima semplificata.
- **Pezzi non prismatici.** La regione è la silhouette lungo l'asse: su pannelli, coperchi e pareti dritte il risultato è quello
  atteso; su pezzi curvi o inclinati il taglio è comunque diritto lungo l'asse e non segue la superficie.
- **Pezzi cavi** (scatola aperta). Con Lato e Profondità si taglia solo la parete scelta; serve una nota nel pannello.
- **Pareti troppo sottili per la stampa.** Avviso sotto 0,8 mm e controllo che la riduzione non cancelli le celle piccole.
- **Compatibilità nel tempo.** Cambiare l'algoritmo casuale cambierebbe il disegno dei vecchi progetti: il generatore resta
  fisso e versionato (campo `algorithm: 1` nei parametri).

## Stima e fasi

1. **Fase 1** (dimensione media, simile alla Serie): funzione Voronoi pura con test (le celle coprono il rettangolo, l'area
   totale è quella del rettangolo, il seme è riproducibile), gruppo `pattern` con parametri, kernel, codice OpenSCAD,
   strumento con pannello e anteprima, campi nelle proprietà, test e2e. Solo Voronoi, asse di taglio, modi Fori e Solchi.
2. **Fase 2**: altri pattern (esagoni, cerchi) e profondità parziale da entrambi i lati.
3. **Fase 3**: applicazione su una faccia scelta, anteprima fantasma più veloce, reticolo 3D a poche celle.
