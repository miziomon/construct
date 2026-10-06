# Valutazione dei raccordi tra due superfici (stile Fusion 360)

Data: 6 ottobre 2026. Domanda: si può offrire in WebCAD un comando "Raccordo" in cui l'utente seleziona due superfici
di un solido e l'app arrotonda lo spigolo tra le due con un raggio scelto (come in Fusion 360), mantenendo le quote
esatte, tempi da editor interattivo (sotto 300 ms) e un codice OpenSCAD coerente?

**Esito: fattibile.** Con le facce piane è una operazione booleana da pochi millisecondi, esatta fino alla sfaccettatura
del cerchio. Si consiglia una versione dedicata con un primo prodotto limitato a spigoli rettilinei tra due facce piane
(circa 8-9 giorni di lavoro, rischio medio). Lo spike di questa valutazione è nei test (`src/kernel/fillet.spike.test.ts`).

## Come funziona un raccordo tra due facce piane

Su uno spigolo rettilineo tra due piani con angolo β (misurato nel materiale per uno spigolo convesso, nell'aria per uno
concavo) la sezione del raccordo è il triangolo tra l'apice dello spigolo e i due punti di tangenza, meno il cerchio:

- distanza dei punti di tangenza dallo spigolo: d = r / tan(β/2);
- centro del cerchio sulla bisettrice, a r / sin(β/2) dallo spigolo;
- area della sezione (per unità di lunghezza): **A = r² · (cot(β/2) − (π − β)/2)**. Per β = 90° vale r² · (1 − π/4).

Spigolo **convesso**: si sottrae il solido ottenuto estrudendo questa sezione lungo lo spigolo (toglie materiale).
Spigolo **concavo**: si unisce lo stesso solido (aggiunge materiale nell'angolo). Con questo schema si riusano
valutazione, cache, annulla e codice OpenSCAD già esistenti (`linear_extrude` + `difference`).

## Opzioni valutate

| Opzione | Cosa fa | Precisione | Costo | Esito |
|---|---|---|---|---|
| A. Parametrica sulle primitive | Raggio per spigolo su cubo, cilindro, cono (profilo 2D arrotondato e booleane) | Esatta | 1-2 giorni per famiglia di forme | Non risponde alla richiesta: non vale per un solido qualsiasi |
| **B. Taglierino booleano su uno spigolo tra due facce piane** | Sezione triangolo meno cerchio, estrusa lungo lo spigolo, sottratta (convesso) o unita (concavo) | Esatta (errore solo di sfaccettatura) | 2-26 ms | **Consigliata** |
| C. Smoothing di tutta la mesh | `smoothOut`, `Manifold.smooth` con spigoli netti e `refine` | Non è un raggio costante: dipende dalla dimensione dei triangoli e le facce piane si gonfiano | Medio | Non adatta a pezzi tecnici |
| D. Minkowski | Già valutato in `valutazione-smussi.md` | Buona ma perde dettagli | Fino a 35 s | Scartata |

## Misure dello spike

Misurato con manifold-3d 3.5.4 in Node, un solo thread. Cubo da 20 mm, raggio 3 mm, lunghezza dello spigolo 20 mm,
volume teorico rimosso (1 − π/4) · r² · L = 38,63 mm³.

| Segmenti del cerchio | Volume rimosso | Scarto dal teorico | Tempo (taglierino più sottrazione) |
|---|---|---|---|
| 32 | 39,535 | +2,35% | 9 ms (compresa la partenza a freddo) |
| 64 | 38,855 | +0,59% | 2 ms |
| 128 | 38,685 | +0,15% | 5 ms |

Lo scarto viene tutto dalle sfaccettature del cerchio: il volume coincide con quello del cerchio poligonale. Con 64-128
segmenti è trascurabile. Un caso realistico, la barra 60 × 12 × 10 con 10 fori che con Minkowski costava 16 s, con un
raccordo lungo tutto uno spigolo lungo (r = 2) impiega **26 ms** e passa da 2612 a 2678 triangoli.

I test di `fillet.spike.test.ts` verificano, con stato `NoError` in ogni caso:

- spigolo convesso con diedro di **60°, 90° e 120°**: volume rimosso uguale ad A · L;
- spigolo **concavo** di una L: volume aggiunto uguale ad A · L, risultato in un solo pezzo;
- **estremità non perpendicolare**: il taglierino si ritaglia sul piano della faccia di fondo con `trimByPlane` e il volume
  resta quello atteso;
- il taglierino si posiziona con `rotate` e `translate` su uno spigolo qualsiasi del cubo.

## Selezione delle due facce

- manifold assegna già a ogni triangolo un `faceID` che raggruppa i triangoli complanari (su un cubo con uno spigolo
  raccordato a 64 segmenti: 22 id, cioè 6 facce piane più 16 sfaccettature del cilindro). Basta trasportare `faceIds`
  nella `NodeMesh` (4 byte per triangolo, nella lista dei buffer trasferiti dal worker);
- il clic in R3F restituisce `faceIndex`; una tabella faccia → triangoli (costruita in O(triangoli), pochi millisecondi)
  dà la zona da evidenziare con una mesh sovrapposta;
- lo spigolo comune si trova tra le semi-spigoli condivise dai triangoli delle due facce (devono essere allineate); se le
  facce non sono adiacenti l'app lo dice e non fa nulla;
- convesso o concavo: segno di `(n1 × n2) · e` con lo spigolo orientato in modo coerente.

Le superfici curve (cilindro, sfera) hanno un `faceID` per ogni sfaccettatura: richiederebbero un raggruppamento in più e
restano fuori dal primo prodotto.

## Modello dati consigliato

Gli id delle facce cambiano a ogni valutazione, quindi il raccordo non si può memorizzare come "facce 12 e 15". Si
memorizza come **nodo con geometria esplicita**: un nuovo tipo di primitiva "taglierino di raccordo" con raggio, lunghezza,
angolo diedro e verso (convesso o concavo), posizionato sullo spigolo nel sistema del pezzo. Il nodo sta in un gruppo
insieme al pezzo (come foro per lo spigolo convesso, come solido per il concavo). Si ottiene senza codice nuovo:

- valutazione e cache (`evaluate.ts`);
- annulla, duplica, blocca, sposta;
- esportazione nel codice OpenSCAD: `translate/rotate` → `linear_extrude(height = L)` di un
  `difference(){ polygon(...); translate(c) circle(r, $fn = ...); }`, dentro il `difference()` del gruppo. Niente
  `polyhedron` e niente `minkowski`.

Se il pezzo cambia, le due facce si ricercano per piano (normale e distanza entro una tolleranza); se non si trovano il
raccordo viene segnato come "interrotto" nell'elenco, come fa Fusion 360, senza perdere il raggio.

## Cosa resta difficile

- **Estremità dello spigolo che finiscono contro altre facce.** Un taglierino della lunghezza dello spigolo è giusto solo
  se le due estremità sono perpendicolari. Per le altre si ritaglia con `trimByPlane` sul piano della faccia (provato nello
  spike). Quando l'estremità cade su una faccia curva o su un altro raccordo, il risultato non è lo stesso di Fusion 360.
- **Angoli con tre spigoli raccordati.** Tre taglierini separati lasciano una punta dove si incontrano i tre cilindri: su un
  cubo il volume rimosso è inferiore di circa l'1% rispetto alla sfera di raccordo ideale (110,30 contro 111,37 mm³) e
  l'angolo non è liscio. Servirebbe un raccordo d'angolo (sfera o patch) calcolato a parte.
- **Raccordi con superfici curve** (cilindro-piano, spigoli circolari): servono taglierini ottenuti per rivoluzione e il
  riconoscimento dell'arco; possibili in un secondo momento per i casi con asse allineato.
- **Raggio troppo grande per le facce vicine**: il raggio massimo va limitato alla larghezza minima delle facce
  adiacenti, misurata perpendicolarmente allo spigolo.
- **Raggio variabile e catene di spigoli tangenti**: fuori dal primo prodotto.

## Stima e raccomandazione

Primo prodotto: uno spigolo rettilineo tra due facce piane di una forma singola o di una mesh importata, convesso o
concavo, slider del raggio con anteprima dal vivo, evidenziazione delle facce sotto il puntatore.

| Lavoro | Giorni |
|---|---|
| `faceIds` nella `NodeMesh`, tabella delle facce, evidenziazione, modalità "Raccordo" con due clic | 2 |
| Spigolo condiviso, verso, riferimento locale, profilo, ritaglio delle estremità, limite del raggio | 2-3 |
| Modello dati (taglierino come primitiva), inserimento automatico in un gruppo, pannello con slider | 1,5 |
| Codice OpenSCAD e relativi test | 1 |
| Test (volumi, L, diedro non retto, STL importato) | 1 |
| **Totale** | **circa 8-9** |

**Raccomandazione: procedere** con questo primo prodotto, in una versione dedicata.

## Esito dell'implementazione (versione 0.8.0)

Raccordo (tasto F) e Smusso (tasto S) sono nell'app, con il pannello delle opzioni come in Fusion 360.

- **Dati:** un nodo `edge` (il taglierino) dentro un gruppo Differenza (spigolo convesso) o Unione (concavo) con il pezzo. Più
  raccordi si annidano.
- **Facce:** `faceID` di manifold non basta (si ripete tra forme sorgenti dopo una booleana: la L ha 8 facce piane e 11
  chiavi). Le facce si ricavano nel thread principale con un riempimento di triangoli complanari adiacenti.
- **Estremità oblique:** il taglierino si ritaglia con `trimByPlane` nel kernel e con `intersection()` e `multmatrix` nel codice.
- **Codice OpenSCAD:** un comando per riga, senza `polyhedron` né `minkowski`. Il codice generato è stato reso con OpenSCAD
  2025.11.30 (backend Manifold) e confrontato con il kernel:

| Caso | OpenSCAD (mm³) | Kernel (mm³) | Scarto |
|---|---|---|---|
| Raccordo su un cubo (r = 3) | 7961,148 | 7961,145 | +0,003 |
| Smusso su un cubo (d = 3) | 7940,001 | 7940,000 | +0,001 |
| Raccordo concavo su una L | 20038,852 | 20038,855 | −0,003 |
| Raccordo con estremità oblique | 7961,148 | 7961,145 | +0,003 |

- **Limiti rimasti:** facce piane e spigoli rettilinei; angoli con tre raccordi, raggio variabile e catene di spigoli tangenti
  non sono supportati; se il pezzo cambia dopo il raccordo, il taglierino non si ricalcola da solo (si modifica a mano
  dalle proprietà).
