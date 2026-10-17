# Studio di fattibilità: Pattern in rilievo (mattoni, legno, ruggine, borchie, rame battuto)

Data: 17 ottobre 2026. Domanda: si può estendere il sistema Pattern, oggi solo sottrattivo e 2.5D (celle 2D estruse con una
sola profondità e tolte con una differenza), con **texture in rilievo** su una faccia piana: muro di mattoni, tavole di legno
con venature, lamiera arrugginita, borchie (additive) e rame battuto, mantenendo tempi da editor interattivo, il seme
deterministico e il codice OpenSCAD esportabile?

**Esito: fattibilità alta per mattoni, borchie e rame battuto (CSG), media per il legno (motore ibrido), media con una
condizione per la ruggine (mappa di altezze, export OpenSCAD pesante).** Il prototipo (solo studio, **non collegato
all'app**) calcola tutte e cinque le texture nel kernel, le scrive in OpenSCAD e il risultato di OpenSCAD coincide con quello
del kernel (verificato, vedi più sotto).

## Cosa c'è nel prototipo

| File | Contenuto |
|---|---|
| `src/scene/relief.ts` | Calcoli puri e deterministici: value noise con fBm (hash intero, nessuna tabella), layout dei mattoni e delle doghe, crateri della ruggine, centri delle borchie, martellate del rame (riusa `randomVoronoi`, `mulberry32`, `polygonCentroid`), funzioni di profondità e di quota, griglia di campioni `sampleGrid` |
| `src/kernel/relief.ts` | `reliefCutter(wasm, region, params, opts)` (texture da togliere), `reliefAddition(...)` (borchie, da unire), `heightSolid` (mappa di altezze chiusa in un solido), `BEST_ENGINE` |
| `src/codegen/reliefScad.ts` | `reliefScad(rect, params, engine, step, centers?)`: codice OpenSCAD del motore scelto |
| `src/scene/relief.test.ts`, `src/kernel/relief.test.ts` | 68 test: determinismo, validità (`NoError`, volume > 0, un solo solido), ruvidità della lamiera in ogni riquadro di 5 × 5 mm, volumi delle borchie, pareti della mappa di altezze (nessun triangolo rovesciato o degenere), regione vuota e parametri estremi, ritaglio sulla regione, codice OpenSCAD |
| `src/kernel/bench.test.ts` | In coda, dietro `BENCH=1`: tempi, triangoli, STL e codice OpenSCAD per ogni texture e motore |
| `scripts/relief-render.mjs`, `scripts/relief-openscad-check.mjs` | Fotografia degli STL con three.js in Chrome e verifica del codice OpenSCAD con OpenSCAD (comandi in fondo al documento) |
| `docs/studio-rilievo/` | STL e immagini di esempio (pannello 40 × 30 × 4 mm, motore scelto). **Gli STL (circa 1,9 MB) vanno tolti prima di un eventuale merge** (si rigenerano con un comando, vedi in fondo); i PNG si possono tenere |

Tutte le funzioni lavorano nel **riferimento della faccia** (faccia su z = 0, pezzo sotto, come `cutterFor` in
`src/kernel/pattern.ts`) e ricevono la regione della faccia come `CrossSection` (già ridotta del margine), non la calcolano:
si potranno collegare dopo il branch che cambia la scelta della regione (campo `region` di `PatternParams`). L'opzione
`rect` ancora il disegno al rettangolo della faccia (`frameRect`), così i mattoni non si spostano quando cambia il margine.
Il chiamante possiede regione e solido restituito (`.delete()` come in `kernel/pattern.ts`).

## I due motori

**(a) CSG di celle.** Poligoni 2D (mattoni, doghe) composti con `CrossSection.compose` (nessuna booleana: le celle sono
disgiunte), sottratti alla regione per ottenere le fughe e estrusi una volta sola; calotte (martellate, crateri, borchie) per
**rivoluzione** di un profilo (`Manifold.revolve`) invece di `Manifold.sphere`, e unite in un'unica unione a lotto
(`Manifold.union`) o con `Manifold.compose` quando sono disgiunte (borchie). Vantaggi: bordi esatti, pochi triangoli dove la
forma è semplice, codice OpenSCAD di poche centinaia di byte. Limite: non si può scrivere una superficie continua e
irregolare (rumore).

**(b) Mappa di altezze.** Griglia regolare z = f(x, y) a passo 0,8 / 0,5 / 0,3 mm chiusa in un solido: i vertici sono quelli
della griglia più un gemello sul piano di chiusura per ogni vertice del bordo (pareti verticali a quadrilateri, che non si
rovesciano mai, qualunque sia la superficie) e il centro del piano (chiusura a ventaglio senza triangoli degeneri): mesh a
tenuta senza fusione di vertici, `status() === 'NoError'`, volume uguale all'integrale della superficie, pareti con la
normale verso l'esterno e nessun triangolo degenere, tutto verificato nei test (un primo schema con le pareti a ventaglio da un angolo
del piano produceva decine di triangoli rovesciati con il rumore: scartato). Poi si interseca con il prisma della regione.
Il verso del materiale rispetto alla superficie (`'below'` o `'above'`) è un parametro esplicito di `heightSolid`. Il numero
di nodi ha un tetto (250.000: oltre, il passo si allarga) e il passo minimo è 0,05 mm. Per le
texture sottrattive la superficie sta a `0,02 − profondità` e il piano di chiusura a 1,5 mm sopra la faccia (dove la
profondità è sotto 0,02 mm la superficie resta sopra la faccia: niente facce complanari con il pezzo); per le borchie il
solido va da −0,2 mm (entra nel pezzo, nessuna fessura nell'unione) alla superficie. Vantaggi: qualunque funzione di altezza
(rumore, venature). Limiti: bordi a gradini (si vede la griglia), triangoli proporzionali all'area / passo², **codice OpenSCAD
proporzionale ai punti** (un `polyhedron` con tutti i valori).

OpenSCAD offre anche `surface(file = "...dat")`, ma richiede un file separato e rompe l'export in un file solo: scartato.
Non si può nemmeno ricalcolare il rumore dentro OpenSCAD: manca l'aritmetica intera (`Math.imul` del hash) e non
garantirebbe lo stesso disegno del kernel.

## Misure (faccia 80 × 60 mm su pannello di 5 mm)

Tempo mediano di 7 esecuzioni (più 2 giri di riscaldamento) di: costruzione del solido, booleana sul pannello ed estrazione
della mesh. Il computer di sviluppo non era dedicato al benchmark: tra due esecuzioni complete i tempi
sono variati fino a circa ±30 % (la prima esecuzione, con 5 giri, dava per esempio 167 ms invece di 62 ms per il legno in mappa a
0,8 mm), i triangoli e le dimensioni non variano. Conta l'ordine di grandezza e i rapporti, non il millisecondo.
STL = 84 + 50 byte per triangolo (formato binario, come `writeStl`). Codice OpenSCAD = lunghezza della stringa generata da
`reliefScad`, con le quote della mappa scritte in centesimi di mm interi. Parametri: i predefiniti di `reliefDefaults`. Comando:
`$env:BENCH='1'; $env:BENCH_OUT='bench.txt'; npx vitest run src/kernel/bench.test.ts -t "texture in rilievo"`.

| Texture | Motore | Passo | Tempo (ms) | Triangoli | STL (KB) | OpenSCAD (KB) |
|---|---|---|---:|---:|---:|---:|
| Mattoni | **CSG** | | 4,0 | 456 | 22 | 0,3 |
| Mattoni | mappa | 0,8 | 54 | 2.688 | 131 | 19 |
| Mattoni | mappa | 0,5 | 122 | 6.596 | 322 | 47 |
| Mattoni | mappa | 0,3 | 288 | 18.222 | 890 | 126 |
| Legno | CSG (solo fughe, senza venatura) | | 1,2 | 196 | 10 | 0,6 |
| Legno | **ibrido** (fughe CSG, venatura mappa) | 0,8 | 94 | 17.450 | 852 | 25 |
| Legno | **ibrido** | 0,5 | 211 | 38.328 | 1.872 | 62 |
| Legno | ibrido | 0,3 | 564 | 98.772 | 4.823 | 168 |
| Legno | mappa (fughe incluse) | 0,8 | 64 | 15.908 | 777 | 26 |
| Legno | mappa | 0,5 | 142 | 37.862 | 1.849 | 64 |
| Legno | mappa | 0,3 | 385 | 100.460 | 4.905 | 174 |
| Ruggine | CSG (solo crateri, senza ruvidità) | | 274 | 27.002 | 1.319 | 4,6 |
| Ruggine | **mappa** | 0,8 | 53 | 15.354 | 750 | 32 |
| Ruggine | **mappa** | 0,5 | 128 | 38.958 | 1.902 | 78 |
| Ruggine | mappa | 0,3 | 356 | 107.698 | 5.259 | 212 |
| Borchie | **CSG** | | 35 | 10.162 | 496 | 0,3 |
| Borchie | mappa | 0,8 | 58 | 3.826 | 187 | 18 |
| Borchie | mappa | 0,5 | 136 | 7.484 | 366 | 44 |
| Borchie | mappa | 0,3 | 371 | 19.896 | 972 | 118 |
| Rame battuto | **CSG** | | 231 | 18.312 | 894 | 3,2 |
| Rame battuto | mappa | 0,8 | 58 | 15.700 | 767 | 31 |
| Rame battuto | mappa | 0,5 | 131 | 39.246 | 1.916 | 77 |
| Rame battuto | mappa | 0,3 | 345 | 107.284 | 5.239 | 209 |

Faccia grande (160 × 120 mm, 4 volte l'area; stesso benchmark, righe in coda): rame battuto CSG 1.060 ms (73.254 triangoli,
OpenSCAD 11,6 KB), rame battuto mappa a 0,5 mm 581 ms (156.932 triangoli, OpenSCAD 299 KB), ruggine mappa a 0,5 mm 515 ms
(154.716 triangoli, OpenSCAD 304 KB), legno ibrido a 0,5 mm 939 ms (151.254 triangoli, OpenSCAD 241 KB). Il CSG del rame cresce
con il numero di martellate (circa 95 su 80 × 60 mm, circa 380 su 160 × 120 mm), la mappa con l'area e con 1/passo²: **sulle
facce grandi la mappa a 0,5 mm diventa più veloce del CSG per le calotte** (ma il suo codice OpenSCAD è circa 26 volte più lungo).

**Verifica del codice OpenSCAD** (OpenSCAD 2025.11.30 con backend Manifold; tutti gli 11 casi mattoni, legno, ruggine, borchie
e rame in ogni motore, a passo 0,5 mm, pezzo = pannello 80 × 60 × 5 mm; il volume del solido esportato si misura sull'STL di
OpenSCAD; procedura in fondo al documento): il volume coincide con quello del kernel entro 0,01 mm³ in 9 casi su 11. Gli altri
due sono il CSG della ruggine (21.481,9 contro 21.481,8 mm³, differenza 0,07 mm³) e il CSG del rame (22.452,2 contro 22.451,5,
differenza 0,7 mm³, cioè 0,003 %), dovute ai dati (posizioni, raggi, profondità) scritti con due decimali nel codice. Le
borchie CSG coincidono (24.563,6 mm³) perché la griglia è centrata e tutte le borchie stanno dentro la faccia, e il profilo della
borchia è scritto con quattro decimali: con due decimali la differenza era 1,9 mm³. (Una versione precedente dello studio aveva
la griglia non centrata, con le borchie dell'ultima colonna 0,5 mm fuori dalla faccia: il kernel le ritagliava, il codice
OpenSCAD no, e il pezzo esportato sporgeva. Più di metà di quella differenza di volume veniva da lì, non dall'arrotondamento.)
Tempo di rendering in OpenSCAD tra 0,1 e 0,9 s per tutti i casi. Non si è verificato il ritaglio sulla regione con un margine
(nel test la regione è l'intera faccia): con il margine le borchie vengono scelte dal kernel e si scrivono come elenco
(`studsInRegion` e il parametro `centers` di `reliefScad`), le altre texture richiedono l'`intersection()` descritta più sotto.

### Scelta del motore per texture

| Texture | Motore | Perché |
|---|---|---|
| Mattoni | **CSG** | Sono rettangoli: bordi esatti, 456 triangoli, 0,3 KB di codice (un ciclo `for` a due indici, nemmeno una lista di dati). La mappa dà la stessa forma con bordi a gradini, da 6 a 14 volte i triangoli e da 130 a 330 volte il codice. |
| Tavola di legno | **Ibrido** | Le fughe (0,8 mm) sono rettangoli: in CSG sono esatte, in mappa a 0,5 mm sarebbero larghe 1 o 2 celle e frastagliate. La venatura è un campo continuo (anelli deformati dal rumore) e solo la mappa lo esprime. L'ibrido unisce i due: stessi triangoli della mappa e circa una volta e mezza il tempo (211 contro 142 ms a 0,5 mm, per l'unione in più), ma fughe pulite. |
| Ruggine | **Mappa** | Non esiste una versione CSG fedele: la ruvidità frattale è il rumore stesso, e i soli crateri (274 ms, 27.000 triangoli) lasciano la faccia liscia, esattamente ciò che si vuole evitare. |
| Borchie | **CSG** | Disgiunte: `Manifold.compose` senza booleane, 35 ms, 0,3 KB (un `for` e un profilo). Sfaccettature controllabili con i segmenti. La mappa a 0,8 mm rende le calotte a scalini. |
| Rame battuto | **CSG** (mappa a 0,8 mm come anteprima) | Il CSG dà calotte esatte e 3 KB di codice; la mappa è 4 volte più veloce a 0,8 mm (58 contro 231 ms) ma pesa 31 KB e le martellate sono meno nitide. Su facce grandi il CSG supera il secondo (1.060 ms a 160 × 120 mm) e conviene l'anteprima in mappa. |

Le sfere intere (`Manifold.sphere`) sono state scartate in partenza, senza misurarle: una calotta di raggio 4 mm e
profondità 0,5 mm ha un raggio di curvatura di 16 mm, quindi userebbe solo una piccola parte di una sfera, mentre il resto
starebbe sopra la faccia. La rivoluzione dell'arco (4 anelli × 24 segmenti, circa 200 triangoli a calotta) è più leggera e
controllabile.

## Le cinque texture

Esempi in `docs/studio-rilievo/` (STL e PNG; pannello 40 × 30 × 4 mm, motore scelto per la texture, mappe di altezze a
0,4 mm; luce radente da sinistra per far risaltare il rilievo). Comandi per rigenerarli in fondo al documento.

### 1. Muro di mattoni

![Mattoni](studio-rilievo/brick.png)

File di mattoni sfalsate di mezzo mattone, larghezza e altezza del mattone e spessore della fuga indipendenti, fughe incise. Il
mattone resta a quota 0 e la fuga scende di `depth`: la regione meno i rettangoli dei mattoni, estrusa una volta.

Parametri per la UI: **Larghezza mattone** (24 mm), **Altezza mattone** (8 mm), **Fuga** (1,2 mm), **Profondità fuga** (0,8 mm),
**Margine** (già esistente). Il layout parte dall'angolo del rettangolo della faccia e per ora non ruota (un campo **Angolo**
come quello degli esagoni richiederebbe di calcolare il layout nel rettangolo ruotato).

### 2. Tavola di legno

![Legno](studio-rilievo/wood.png)

Doghe lunghe (`plankL` ± 15 %) con giunti sfalsati: ogni fila parte da un multiplo del passo aureo 0,382 della lunghezza più un
piccolo scarto casuale, quindi i giunti di file vicine non coincidono mai (test). Fughe tra le doghe e **venatura**: la fase degli
anelli è `u / distanza anelli + 3 · rumore lento lungo la doga + scostamento per doga` (anelli deformati), resa come creste
strette (coseno al cubo) e sommata a una fibra fine (value noise lungo 25 mm e largo circa 0,4 mm). Profondità da 0 a
`grainDepth` (frazioni di mm).

Parametri per la UI: **Larghezza doga** (12 mm), **Lunghezza doga** (60 mm), **Fuga** (0,8 mm), **Profondità fuga** (0,8 mm),
**Venatura** (profondità 0,25 mm; 0 = nessuna), **Distanza anelli** (3 mm), **Seme**.

### 3. Lamiera o ferro arrugginito

![Ruggine](studio-rilievo/rust.png)

Profondità = **quota base** + ruvidità + crateri, diminuita di una quota fissa dove ci sono scaglie. La ruvidità è fBm di
value noise (4 ottave da 0,3 cicli/mm, guadagno 0,6) di ampiezza ±`roughness`, più una grana fine a 0,9 cicli/mm (40 % della
ruvidità) che garantisce un'escursione minima anche dove il rumore lento è quasi costante; i crateri (vaiolatura) sono conche a bordo liscio, raggio 0,6 a 2 mm e profondità 40 a
100 % del massimo, in posizioni casuali dal seme (`craterDensity` ogni 100 mm², cercati con cassetti spaziali); le
scaglie/pustole sono le zone in cui un rumore lento supera una soglia, e lì la profondità diminuisce di una quota fissa (metà
della quota base): le placche restano più alte ma con ruvidità e crateri interi (in una versione precedente la profondità si
moltiplicava per 0,25 e la ruvidità sulle placche si schiacciava). **Tutta la faccia viene abbassata di circa `baseDepth`** (0,5 mm predefiniti) e la profondità non scende mai sotto
0,05 mm: serve una quota base perché il rilievo, che lavora solo per sottrazione, possa salire e scendere attorno a un livello
senza lasciare piani lisci. I test misurano la ruvidità in due modi: in media (deviazione standard > 0,08 mm e oltre l'80 % dei campioni vicini
diversi di più di 1 µm) e **in ogni riquadro di 5 × 5 mm** (anche sfalsati di 2,5 mm, con 5 semi e con scaglie a 0, predefinite e
massime): l'escursione di quota è sempre almeno 0,2 mm, cioè uno strato FDM. La prima versione aveva 6 riquadri su 165 sotto
questa soglia e uscirebbero piatti in stampa.

Parametri per la UI: **Quota base** (0,5 mm), **Ruvidità** (0,35 mm), **Crateri ogni 100 mm²** (3), **Profondità crateri**
(0,5 mm), **Scaglie** (0 a 1, 0,4), **Seme**. Limite: a 0,4 mm di passo (quello dell'immagine) un cratere piccolo (diametro 1,2 mm) occupa 3
campioni e appare a scalini; a 0,3 mm migliora ma costa 107.000 triangoli e 5 MB di STL.

### 4. Borchie (additiva)

![Borchie](studio-rilievo/studs.png)

Griglia quadrata **centrata** nella faccia, con tutte le borchie intere dentro il rettangolo: `colonne = floor((larghezza −
2 · raggio) / passo) + 1` (nessuna borchia se il lato è più corto del diametro), partenza a metà dello spazio che avanza. Sulla
faccia di prova 80 × 60 mm con passo 12 mm sono 7 × 5 = 35 borchie, con 1,5 mm di margine a sinistra e a destra e 3,5 mm in alto e in basso. Il kernel scarta per
impostazione predefinita le borchie la cui base non sta tutta nella regione (il centro deve cadere nella regione ridotta del
raggio, `studsInRegion`): una mezza calotta lascia una parete sottile ed è brutta. Calotta sferica (altezza al massimo pari al
raggio, oltre ci sarebbe un sottosquadro) o cilindro con smusso. Il solido entra di 0,2 mm nel pezzo e va **unito**
(`Manifold.add`), non sottratto: è il solo modo additivo del prototipo, quindi `reliefAddition` è separato da `reliefCutter`.
La mappa di altezze prende il massimo tra le borchie vicine (come l'unione del CSG), quindi anche con borchie sovrapposte non
disegna spicchi che il CSG non ha.

Parametri per la UI: **Passo** (12 mm), **Raggio** (2,5 mm), **Altezza** (1,5 mm), **Forma** (calotta o cilindro), **Smusso**
(0,5 mm). Verificato: il volume aggiunto da 35 borchie a calotta è entro il 10 % di quello teorico (calotta sferica
π h (3 r² + h²) / 6), con entrambi i motori, e coincide con quello esportato da OpenSCAD.

### 5. Rame battuto

![Rame battuto](studio-rilievo/hammered.png)

Un Voronoi rilassato (`randomVoronoi`, regolarità 60) con una martellata per cella: centro = baricentro, raggio del bordo = 1,25
volte quello della cella (così si sovrappongono), raggio e profondità variati di ± `jitter` (25 %) con `mulberry32` in ordine
fisso (due estrazioni per cella). La profondità di un punto è la martellata più profonda tra quelle che lo coprono (la sfera
sotto il piano, `√(R² − d²) − (R − profondità)`), che coincide con l'unione dei solidi in CSG.

Parametri per la UI: **Diametro medio** (8 mm), **Profondità** (0,5 mm), **Variazione** (25 %), **Regolarità** (60 %), **Seme**.

## Stampabilità FDM (ugello 0,4 mm, strato 0,2 mm)

- **Rilievo minimo.** Sulla faccia superiore il rilievo è quantizzato in strati: 0,2 mm è un gradino, quindi sotto 0,4 mm
  (due strati) un rilievo si vede appena. Le venature a 0,25 mm sono visibili solo come un gradino sulla faccia superiore e
  vanno portate a 0,3 a 0,5 mm; la ruvidità della ruggine (±0,35 mm) è al limite ma funziona perché è irregolare; le martellate
  (0,5 mm su 4 mm di raggio) vengono a terrazze, che con strati da 0,1 mm o l'altezza strato variabile migliorano.
- **Faccia superiore o facce laterali.** Sulla faccia superiore la risoluzione verticale è lo strato (0,2 mm) e quella nel piano
  circa 0,4 mm: ottima per fughe, borchie e crateri, a scalini per le pendenze dolci. Su una faccia laterale (stampata in verticale) il
  rilievo si forma nel piano XY e la risoluzione è circa 0,1 a 0,4 mm: i dettagli fini (venatura, ruvidità) rendono meglio, ma si
  sovrappongono alle linee degli strati (0,2 mm), quindi la fibra della venatura va tenuta sopra i 0,3 mm di profondità.
- **Larghezze minime.** Una fuga si legge se è larga almeno 2 volte l'ugello (0,8 mm: valore predefinito delle fughe) e profonda
  almeno 0,4 mm; sotto circa 0,6 mm di larghezza tende a chiudersi. Per le borchie si consiglia un raggio di almeno 1 mm.
  Sono regole pratiche, non misurate in questo studio: vanno confermate con una stampa di prova.
- **Sbalzi delle borchie.** Sulla faccia superiore una calotta (altezza ≤ raggio) o un cilindro con smusso non hanno sbalzi:
  ogni strato è contenuto nel precedente. Su una faccia laterale le borchie sono sporgenze orizzontali: la metà superiore è uno
  sbalzo che oltre 45° dalla verticale richiede supporti o ponti. Suggerimento: per le facce laterali usare uno smusso grande
  (cono a 45°) o una calotta bassa (altezza minore di metà raggio). **Sulla faccia rivolta al piatto le borchie non si
  possono stampare** (il pezzo poggerebbe sulle borchie): orientare il pezzo con il rilievo additivo verso l'alto o di lato.
- **Orientamento.** Texture sottrattive (fughe, ruggine, rame) vanno bene verso l'alto e di lato. Sulla faccia rivolta al piatto
  la texture si imprime contro il piatto (finitura del piatto, primo strato schiacciato) e perde nitidezza. Sulla faccia
  superiore la qualità migliora con strati da 0,1 mm o altezza strato variabile e, per le superfici dolci, con la stiratura
  (ironing).
- **Dimensione dei file.** 5 MB di STL per 80 × 60 mm con mappe a 0,3 mm: ok per lo slicer, pesante per un progetto salvato
  (si salva solo la scena con i parametri, non la mesh) e per l'anteprima del worker (Comlink trasferisce i buffer).

## Codice OpenSCAD

Il motore scelto per texture scrive: mattoni, un ciclo `for` a due indici dentro un `difference() { square; ... }` estruso
(0,3 KB); doghe, l'elenco `planks` dei rettangoli (una riga per doga) e lo stesso schema (0,6 KB); borchie, un profilo e due
cicli con `rotate_extrude` sulla griglia centrata (0,3 KB; con un margine o una faccia non rettangolare, un elenco dei centri
rimasti, una riga per borchia); rame e crateri, un elenco `dents = [[x, y, r, d], ...]` (una riga per martellata) e un
modulo `dent(r, d)` che ricostruisce l'arco con la stessa formula del kernel (3,2 KB); ruggine e venatura, una
`zmap` con tutti i valori della griglia **in centesimi di mm interi** (un terzo di caratteri in meno: la ruggine passa da 114 a
78 KB a 0,5 mm) e un `polyhedron(pts, faces)` con `pts` e `faces` calcolati da cicli (32, 78 o 212 KB a 0,8, 0,5 o 0,3 mm). Nel codice finale si userebbe come per i Pattern: `translate(origine) rotate(inverseEuler) { ... }` dentro un
`difference()` (o un `union()` per le borchie), con la regione (margine) fatta da `offset`/`projection` e intersecata con
`intersection()`. Nel prototipo il modulo `relief()` copre tutto il rettangolo e non ritaglia sulla regione (margine): l'`intersection()`
con `offset(delta = -margine) projection()` come in `patternLines` va aggiunta in integrazione (e verificata, vedi sopra).

Il vincolo vero è la ruggine: **un polyhedron da 78 KB a 0,5 mm è accettabile, da 212 KB a 0,3 mm no** (rende il `.scad`
poco leggibile e il rendering in OpenSCAD tocca il secondo). Mitigazione proposta: la ruggine esporta sempre a 0,5 mm di
passo, qualunque sia il passo usato per l'anteprima, e il codice porta un commento `construct:relief` con i parametri per
rigenerare la mappa.

## Come integrare nel sistema Pattern

1. **Tipi** (`src/scene/types.ts`): estendere `PatternParams.kind` con `'brick' | 'wood' | 'rust' | 'studs' | 'hammered'` e
   aggiungere un campo `relief?: ReliefParams` (l'unione discriminata del prototipo) oppure campi piatti come quelli esistenti
   (`size`, `wall`, ...). Il modo additivo si può dedurre dal tipo (borchie) o diventare un terzo valore di `mode`
   (`'add'`). Aggiungere anche `reliefAlgorithm: 1` (versione del rumore e delle liste casuali: se cambia il rumore, i vecchi
   progetti cambierebbero disegno, come per `PATTERN_ALGORITHM`).
2. **`normalizePattern`** (`src/scene/pattern.ts`): limitare ogni misura, usare il tipo `voronoi` come ripiego per un `kind`
   sconosciuto e **non toccare i progetti esistenti** (i nuovi campi sono opzionali con default). Il prototipo ha già
   `normalizeRelief` con questi limiti **obbligatori**, perché senza di essi i cicli non finiscono o la memoria si esaurisce:
   larghezza e altezza del mattone, larghezza della doga, passo e diametro delle borchie almeno 2 mm (lunghezza della doga 5 mm,
   raggio delle borchie 0,5 mm, altezza 0,2 mm), fughe almeno 0,2 mm, profondità almeno 0,05 mm, densità dei crateri al più 20
   ogni 100 mm² (e al più 2.000 crateri), martellate al più 500 (diametro medio almeno 2 mm), variazione al più 0,9,
   borchie al più circa 2.000 (il passo si allarga), **mappa di altezze al più 250.000 nodi** (il passo si allarga: a 0,3 mm sono
   circa 22.000 mm² di faccia), passo minimo 0,05 mm. I valori non finiti tornano a quelli di partenza. Con le misure a zero le
   funzioni finiscono comunque (test), ma una faccia grande con tutti i minimi può costare secondi (500 martellate in CSG: circa 4 s).
3. **Kernel** (`src/kernel/pattern.ts`): estrarre da `cutterFor` il tratto "porta nel riferimento della faccia, calcola la
   regione, ridotta del margine" (è quello che cambia con il branch B) e farlo seguire da `reliefCutter` o `reliefAddition`;
   poi stessa rotazione e traslazione di ritorno dei cutter attuali. Per le borchie `buildPattern` fa
   `Manifold.union([risultato, ...aggiunte])` dopo la differenza degli altri tagli. Anteprima (`p.preview`): per il
   rame un CSG semplificato (opzione `segments` e meno anelli) fino a una soglia di martellate, e la mappa a 0,8 mm solo oltre
   quella soglia, così su facce normali anteprima e risultato coincidono; la ruggine usa la mappa a 0,8 mm. Le regioni vuote
   danno `null` (nessun taglio), il motore `'hybrid'` chiesto per una texture diversa dal legno è un errore. In integrazione
   conviene eliminare i percorsi scartati dallo studio (ruggine in CSG, legno in sola mappa).
4. **Codegen** (`src/codegen/openscad.ts`, `patternLines`): per i `kind` nuovi chiamare `reliefScad` (già nello stesso
   riferimento di faccia) dentro `translate(origine) rotate(inverseEuler)`; per le borchie `union()` al posto di `difference()`.
5. **UI** (`PatternFields.tsx`): il selettore del tipo di Pattern (branch B) guadagna un gruppo "Rilievo"; i campi cambiano per
   tipo come per Voronoi e griglie. Un comando in più di barra richiede scorciatoia e tooltip, ma qui il comando è sempre
   Pattern: non serve.
6. **Test e documentazione**: gli stessi del prototipo (determinismo, validità, volumi), un test del codice OpenSCAD (il
   confronto con il volume del kernel si può fare in locale con `openscad`, non in CI) e un e2e per tipo.

## Limiti

- **Solo facce piane**, come il Pattern attuale (le facce inclinate funzionano per `faceFrame`): niente superfici curve, nessuna
  parametrizzazione UV.
- Il rilievo sulla faccia **ritaglia sulla regione** (cornice del margine intatta); le borchie che non stanno intere nella regione
  vengono scartate.
- I mattoni hanno tutti la stessa altezza di rilievo: una variazione di rilievo per mattone (qualche decimo di mm) richiederebbe
  un'estrusione per mattone (circa 100 prismi: da misurare) oppure passare alla mappa.
- **Legno:** una sola specie di venatura (anelli di tavola segata tangenzialmente, senza nodi).
- **Ruggine:** la qualità dipende dal passo (scalini a 0,4 mm, vedi l'immagine) e il codice OpenSCAD è grande. Tutta la faccia
  scende di circa `baseDepth`: il pannello deve dichiararlo (conta per gli incastri).
- **Precisione numerica tra motori JavaScript:** `Math.cos`, `Math.pow` e `Math.asin` non sono garantiti identici al bit tra
  browser diversi, quindi l'arrotondamento a 0,01 mm può cambiare al limite tra due valori. Il codice OpenSCAD non è toccato
  (contiene i valori già calcolati); il kernel potrebbe differire di un centesimo di mm in pochi punti.
- **Stabilità nel tempo:** rumore, ordine delle estrazioni e arrotondamento a 0,01 mm sono parte del formato: vanno bloccati con
  un campo di versione (punto 1).

## Raccomandazione

Rilasciare in quattro tappe, dalla più sicura alla più costosa, ognuna con una versione minor di Construct:

1. **Mattoni e borchie** (la prima è sottrattiva, la seconda introduce il **modo additivo**): CSG puro, tempi sotto 40 ms,
   codice OpenSCAD di 0,3 KB, nessun rischio di compatibilità. Include tutto il lavoro di integrazione (tipi, normalize, branch
   additivo in `buildPattern`, `patternLines`, UI). **Stima: 3 a 4 giorni** (2 per l'integrazione e il modo additivo, 1 per ogni
   texture con test e documentazione). **Il modo additivo delle borchie conviene in una PR separata da quella dei mattoni**:
   cambia `buildPattern` e `patternLines` con una semantica nuova (unione dopo le differenze, interazione con `sides` e con altri
   Pattern) e merita una revisione a sé; i mattoni (sottrattivi) possono uscire per primi.
2. **Rame battuto** (CSG, anteprima in mappa a 0,8 mm sulle facce oltre circa 100 × 80 mm): 231 ms su 80 × 60 mm. **Stima:
   1,5 giorni** (la mappa di altezze come anteprima si può rimandare).
3. **Tavole di legno** (ibrido): richiede `heightSolid` e `sampleGrid`, già nel prototipo. **Stima: 2 giorni**, più la
   decisione sui parametri della venatura guardando stampe reali.
4. **Ruggine** (mappa di altezze): **da rilasciare solo dopo aver deciso l'export OpenSCAD** (78 KB a 0,5 mm con le quote in centesimi interi,
   commento con i parametri, passo fisso) e dopo una prova di stampa: il valore estetico è alto, il rischio di un `.scad` ingombrante e di
   texture poco leggibile a 0,4 mm di ugello è reale. **Stima: 2 a 3 giorni.**

Totale circa **9 a 10 giorni** per le cinque texture, di cui circa 2 per l'integrazione e il modo additivo, che
conviene fare **dopo** che il branch B ha chiuso la scelta della regione e del selettore del tipo, per non rifare due volte
`cutterFor`, `normalizePattern` e `PatternFields`.

Prima di partire con la tappa 1 servono due decisioni: se la **profondità** del rilievo si espone come parametro di ogni
texture (come nel prototipo) oppure riusa `depth`/`sides` del Pattern (nei rilievi `sides: 'both'` ha poco senso), e se la
fuga di mattoni e doghe vale in ogni caso minimo 0,8 mm con un avviso come per la parete del Voronoi.

## Pareri della revisione e decisioni

- **Codice OpenSCAD della ruggine** (114 KB a 0,5 mm nella prima versione): accettabile con il passo dell'export fisso a 0,5 mm;
  scrivere le quote in centesimi interi risparmia circa un terzo (fatto: 78 KB). A 0,3 mm (212 KB) no.
- **Ruggine che abbassa la faccia di 0,5 mm:** accettabile se il pannello lo dichiara (la revisione ha misurato una quota media di
  0,465 mm sulla prima versione). Alternativa più realistica da valutare in integrazione: pustole che salgono sopra la faccia
  (togliere il prisma della regione fino alla quota minima e unire il solido sotto la superficie, `heightSolid` con piano in
  basso, una booleana in più).
- **Rame, anteprima e risultato:** l'anteprima in CSG semplificato fino a un certo numero di martellate, e la mappa solo oltre
  quella soglia, così anteprima e risultato coincidono nei casi normali (punto 3 dell'integrazione).
- **Borchie:** prima si centra la griglia, poi si scartano per impostazione predefinita quelle non intere nella regione (fatto
  nel prototipo). Il modo additivo va in una PR separata da quella dei mattoni.
- **Domande ancora aperte:** il rilievo si applica a una faccia sola o a più facce come il Pattern attuale (il prototipo lavora su
  una faccia alla volta: con più facce basta ripetere la chiamata con `seed + indice`)? La profondità del rilievo è un parametro
  di ogni texture, o riusa `depth` e `sides` del Pattern?

## Riproducibilità: comandi

Dalla radice del repository, in PowerShell (su altre shell cambia solo come si impostano le variabili d'ambiente):

```
# Test del prototipo
npx vitest run src/scene/relief.test.ts src/kernel/relief.test.ts

# Benchmark della tabella (e delle righe sulla faccia grande)
$env:BENCH='1'; $env:BENCH_OUT='bench.txt'; npx vitest run src/kernel/bench.test.ts -t "texture in rilievo"

# STL di esempio in docs/studio-rilievo/ e relative immagini PNG (serve Chrome; three.js è già in node_modules)
$env:RELIEF_SAMPLES='1'; npx vitest run src/kernel/relief.test.ts -t esempi
node scripts/relief-render.mjs

# Verifica del codice OpenSCAD: i .scad e i volumi attesi del kernel, poi OpenSCAD su ciascuno
$env:RELIEF_SCAD_DIR='C:\temp\relief'; npx vitest run src/kernel/relief.test.ts -t "verifica OpenSCAD"
node scripts/relief-openscad-check.mjs C:\temp\relief
```

Lo script di verifica lancia OpenSCAD con `--backend=manifold`, esporta ogni `.scad` in STL ASCII, ne somma il volume con i
tetraedri sull'origine e lo confronta con `expected.json`; il percorso dell'eseguibile si può cambiare con la variabile
`OPENSCAD` (predefinito `C:/Program Files/OpenSCAD/openscad.com`).
