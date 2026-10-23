# Studio di fattibilità: texture da immagine (JPG, PNG, SVG) come superficie in rilievo

Data: 23 ottobre 2026. Domanda: si può applicare a un oggetto di Construct una **texture da immagine** (una foto di pelle, una zigrinatura, un
logo SVG) per produrre una superficie in rilievo, come fanno il modificatore Displace di Blender e BumpMesh di CNC Kitchen, mantenendo tempi da
editor interattivo, la rigenerazione deterministica e il codice OpenSCAD esportabile? Lo studio ricalca quello dei rilievi procedurali
(`docs/studio-pattern-rilievo.md`) e finisce con un confronto tra le due soluzioni.

**Esito: fattibilità alta per le facce piane (motore F, riuso quasi totale del codice dei rilievi), media per la mesh intera (motore M, con limiti
chiari sugli spigoli e sull'ampiezza), alta per l'SVG vettoriale quando basta una quota sola.** Il prototipo (solo studio, **non collegato all'app**)
calcola entrambi i motori nel kernel, scrive il codice OpenSCAD e il volume del solido esportato coincide con quello del kernel (verificato con
OpenSCAD su 16 casi, vedi più sotto; **non** verificati il margine reale e le facce inclinate). Raccomandazione in fondo: **soluzione ibrida**, procedurale/CSG per i casi geometrici (mattoni, borchie, fughe), immagine per
il resto, e il motore M solo come funzione a parte con avvertenze.

## Cosa c'è nel prototipo

| File | Contenuto |
|---|---|
| `src/scene/textureMap.ts` | Calcoli puri e deterministici: da RGBA a grigio con formula intera, riduzione e sfocatura, campionatore bilineare, quota (livello medio, ampiezza, modi rilievo, incavo, entrambi), scala in mm per piastrella, rotazione, scostamento, inversione, ripetizione; proiezioni planare, triplanare e cilindrica |
| `src/scene/textureSamples.ts` | Sei texture di esempio generate nel codice (zigrinatura, fibra di carbonio, pelle, mattoni, onde, rumore) e un SVG di prova |
| `src/kernel/textureMap.ts` | Motore F (`faceSurface`, `applyTextureFace`), motore M (`displaceSolid`, `selfOverlapVolume`), SVG vettoriale (`svgReliefSolid`), chiave di cache per impronta (`textureCacheKey`) |
| `src/codegen/textureScad.ts` | Codice OpenSCAD: `zmap` (motore F), `surface()` con PNG, `polyhedron` (motore M), `polygon` per l'SVG |
| `src/scene/textureMap.test.ts`, `src/kernel/textureMap.test.ts`, `src/codegen/textureScad.test.ts`, `src/kernel/textureCore.test.ts` | Test: determinismo, valori ai bordi, ripetizione, inversione, rotazione, validità dei solidi (`NoError`, volume, un solo solido), volume uguale all'integrale della quota, cubo, cilindro e pannello del motore M, SVG, chiave di cache, CORE del prototipo uguale ai sorgenti |
| `src/kernel/bench.test.ts` | In coda, dietro `BENCH=1`: righe immagine nella stessa tabella dei rilievi, peso delle immagini, rischi del motore M |
| `docs/prototipi/texture-immagine.html` | Prototipo in un file solo (tema chiaro e scuro, manifold-3d 3.5.4 e three 0.186.1 da jsDelivr) |
| `scripts/texture-core.mjs`, `scripts/texture-prototype-check.mjs`, `scripts/texture-decode-check.mjs`, `scripts/texture-render.mjs` | Generazione del blocco CORE dell'HTML dai sorgenti, prova del prototipo in Chrome, misura della decodifica delle immagini, foto degli STL |
| `docs/studio-texture/` | Immagini PNG (schermate del prototipo e foto degli STL, circa 1,7 MB). Gli STL non sono nel repository |

L'unica modifica a file dell'altro studio è l'aggiunta di `export` a `ABOVE`, `EMBED`, `FLOOR`, `prism`, `clipToRegion` (in `src/kernel/relief.ts`) e a
`polyhedronLines` (in `src/codegen/reliefScad.ts`). Come per i rilievi, tutto lavora nel **riferimento della faccia** (faccia su z = 0, pezzo sotto) e
riceve la regione come `CrossSection`; il chiamante possiede regione e solidi.

## Come lo fanno gli altri

**Blender, modificatore Displace** (descrizione dalla conoscenza del programma: la pagina del manuale non si è caricata in questa sessione, vedi la lista
di ciò che non è verificato). Sposta ogni vertice della mesh di `(valore della texture − Midlevel) × Strength`, lungo la normale del vertice (oppure
lungo X, Y, Z, o con la direzione presa dai colori RGB). Il valore 0,5 di grigio è il livello medio: bianco sale, nero scende. Le coordinate della texture
sono le UV, oppure le coordinate locali, globali, di un oggetto o della mesh originale. Serve **una mesh già abbastanza fitta** (Subdivision Surface o
Subdivide prima del Displace): il modificatore sposta solo i vertici che ci sono. Un gruppo di vertici può mascherare l'effetto. Agli spigoli vivi
usa le normali dei vertici (mediate), quindi lo spigolo si sposta in diagonale.

**BumpMesh (stlTexturizer)**, dal README del progetto (https://github.com/CNCKitchen/stlTexturizer): programma nel browser, nessun dato va in rete.
Proiezioni: triplanare (predefinita, "migliore per forme complesse"), cubica con fusione alle cuciture, cilindrica con angolo del tappo, sferica,
planare XY, XZ, YZ; scala U/V, scostamento U/V, rotazione. **Ampiezza** da 0 a 100 %, spostamento **simmetrico** (50 % di grigio neutro, bianco verso
fuori, nero verso dentro, "preserva il volume"); un avviso compare quando la profondità supera il 10 % della dimensione minima del modello. Suddivisione
**adattiva** fino a una lunghezza target del lato, con rispetto degli spigoli (angolo diedro oltre 30 gradi), decimazione QEM, tetto di sicurezza a 10 milioni
di triangoli. Maschere per angolo (togliere la texture sulle facce quasi orizzontali) e pennello. 101 texture incluse, **immagine personalizzata** come mappa di
spostamento con sfocatura facoltativa; fino a quattro livelli per modello. Ingresso STL, OBJ, 3MF, STEP; uscita principale STL binario (le novità recenti elencano anche l'export 3MF, che la sezione Export non descrive). Il README non descrive la
matematica delle normali.

**OpenSCAD `surface(file = "x.png")`**: legge nativamente un PNG (oppure un file di numeri) e produce un solido chiuso. Vedi la rivalutazione qui sotto.

### `surface()` rivalutato

Il primo studio lo aveva scartato perché richiede un file esterno e rompe l'export in un solo file. Con una texture da immagine il file esterno esiste comunque
(l'immagine), quindi la domanda vale la pena. **Provato davvero con OpenSCAD 2025.11.30** (backend Manifold) con un PNG asimmetrico di 4 × 3 pixel e valori
noti, e poi con la griglia di una faccia di 80 × 60 mm.

- **Mappatura misurata.** Il nodo (colonna i, riga dal basso j) sta in (i, j): **y = 0 è l'ultima riga del PNG** (il PNG appare capovolto rispetto a come lo si
  guarda), i pixel sono nodi e non celle, quindi un'immagine di w × h pixel copre (w − 1) × (h − 1) unità. L'altezza va da 0 a 100 per il grigio da 0 a 255
  (`gray / 255 × 100`). `invert = true` non fa 100 meno il valore: **cambia segno** e porta il fondo a −100,6 (il valore di partenza diventa −(gray − 1)/255 × 100).
- **Il fondo del solido sta a (quota minima − 1)**, non a zero: in un PNG senza pixel neri il solido resta sottile e, se si toglie la colonna del pezzo
  (modo "entrambi"), resta un vuoto. La soluzione provata è una **cornice di un pixel a 0 fuori dal rettangolo** e un `intersection()` per ritagliare.
- **Nessuna ripetizione, rotazione, scala o ritaglio sulla regione**: tutto si deve "cuocere" nel PNG (griglia già campionata dal kernel) e poi scalare con
  `scale([passo, passo, ampiezza/100])`. In pratica il PNG non è più l'immagine dell'utente ma la mappa di altezze del kernel in 8 bit.
- **Triangolazione a ventaglio** (un nodo al centro di ogni cella): 4 triangoli per cella contro 2 della `zmap`. A 0,5 mm su 80 × 60: 77.300 triangoli in OpenSCAD
  contro 39.190.
- **Risultato.** Codice OpenSCAD di **0,4 KB** (contro 60 a 73 KB della `zmap` a 0,5 mm) più un PNG di 0,5 a 0,8 KB per la zigrinatura (163 × 123 pixel,
  molto comprimibile; una pelle è più pesante). Volume: scarto da −1,7 a +6,4 mm³ (0,007 a 0,03 %) rispetto a una **"pelle" del kernel** sulla stessa griglia (quantizzazione a 8 bit
  e triangolazione), contro 0,00 mm³ della `zmap`. **Contro il risultato reale del kernel** in modo rilievo e incavo `surface()` differisce di **+27,7 mm³ (rilievo) e −90,0 mm³ (incavo)**, perché non riproduce le
  convenzioni `FLOOR` del kernel (0,02 mm su tutta la faccia: 4800 × 0,02 ≈ 96 mm³), fisicamente trascurabili; in modo "entrambi" lo scarto è −1,7 mm³. Tempo di rendering 0,8 a 0,9 s, simile alla `zmap` (0,8 a 1,2 s).
- **Pro:** file `.scad` minuscolo e leggibile, si può aprire il PNG e cambiare la mappa a mano, il dato più compatto (1 byte per nodo). **Contro:** due file da
  tenere insieme (se il PNG non sta accanto, il rendering fallisce), orientamento invertito, fondo a min − 1, niente ritaglio né ripetizione, la quantizzazione a
  8 bit limita l'ampiezza utile (con 0,6 mm sono 0,0024 mm per livello: ok), un formato "grafico" che nasconde l'ampiezza dentro una `scale`.
- **Giudizio:** da offrire come **seconda opzione di export** per il motore F ("con file PNG a fianco", due scaricamenti o un archivio), non come predefinita.
  La predefinita resta la `zmap` in un file solo, già verificata a 0,00 mm³.

## Come si ricava la quota dall'immagine

Convenzioni fissate in `src/scene/textureMap.ts` (e provate dai test): immagine `w × h` a 8 bit, riga 0 in alto, il centro del pixel `(i, j)` sta in
`s = (i + 0,5) / w` e `t = 1 − (j + 0,5) / h` della piastrella (`t` verso l'alto, come l'asse Y della faccia, perché la riga 0 è in alto). Una piastrella è larga `tile` mm e alta `tile × h / w` mm.
Il campionatore è **bilineare**, con ripetizione (indici modulo `w` e `h`, quindi sul bordo si mescolano l'ultimo e il primo pixel) oppure, senza ripetizione, con
quota 0 fuori dalla piastrella. Rotazione antioraria attorno al punto di scostamento, inversione, sfocatura a scatola separabile (raggio in pixel).

| Modo | Quota (mm) con `v` grigio 0 a 1, `m` livello medio, `A` ampiezza | Intervallo |
|---|---|---|
| Entrambi (come Blender e BumpMesh) | `(v − m) × A` | da `−m A` a `(1 − m) A` |
| Rilievo | `max(0, v − m) / (1 − m) × A` | da 0 ad A |
| Incavo | `−max(0, m − v) / m × A` | da −A a 0 |

Con `m` agli estremi la divisione non avviene (quota 0), i parametri hanno limiti obbligatori (`normalizeTexture`: scala da 0,5 mm, ampiezza al più 20 mm,
sfocatura al più 20 pixel, valori non finiti riportati al valore di partenza).

**Grigio.** Formula **intera sui valori sRGB come sono**, senza linearizzare e senza profilo colore: `Y = (77 R + 150 G + 29 B + 128) >> 8` (pesi di Rec. 601
arrotondati, somma 256, il bianco resta 255; il rosso puro dà 77, il verde 149, il blu 29). I pixel semitrasparenti si compongono prima sul **bianco** (la carta),
con aritmetica intera; con `invert` si cambia verso. Scelta documentata e provata (vedi la sezione sul determinismo): è la stessa per ogni browser, a parità dei
canali RGBA decodificati.

## Motore F: faccia piana

L'immagine campionata è la `f(x, y)` di `sampleGrid`; la griglia passa a `heightSolid` come per i rilievi procedurali. Cambia solo **cosa si fa del solido**,
perché la quota ha anche il segno: `faceSurface` sceglie una di tre operazioni.

- **Incavo (`subtract`)**: solido sopra la superficie `FLOOR + h` fino a 1,5 mm sopra la faccia, ritagliato sulla regione e tolto dal pezzo (come `depthMapCutter`).
- **Rilievo (`add`)**: solido sotto la superficie `max(h, −FLOOR)` che entra di `EMBED` = 0,2 mm nel pezzo, unito (come le borchie, `reliefAddition`).
- **Entrambi (`skin`)**: la quota cambia segno e un solo solido non basta. Si toglie dal pezzo la **colonna** della regione fino a 0,4 mm sotto l'incavo più
  profondo e si unisce la "pelle" (superficie intera chiusa 0,2 mm più in basso): **due booleane** invece di una. Provata su pannello e cilindro (il ritaglio su una regione ridotta solo in modo rilievo).
  Il primo schema, con un cutter e una addizione indipendenti, ricoprirebbe gli incavi (l'addizione entra di 0,2 mm sotto la faccia): scartato senza misurarlo.

Il volume del solido risultante coincide con l'integrale esatto della quota sulle facce della griglia (test, tolleranza 0,2 %); rilievo e incavo non superano mai
la faccia più di `A` e di 0 rispettivamente. Il passo ha un tetto di 250.000 nodi (quello di `sampleGrid`) e i valori della griglia sono arrotondati al centesimo
di mm: con ampiezze piccole i livelli visibili sono pochi (0,6 mm danno 60 livelli, 0,2 mm solo 20).

### Misure (faccia 80 × 60 mm su pannello di 5 mm)

Stessa procedura e stesse colonne del primo studio: mediana di 7 esecuzioni (più 2 di riscaldamento) di costruzione del solido, booleana sul pannello ed
estrazione della mesh; STL = 84 + 50 byte per triangolo; codice OpenSCAD = lunghezza della stringa del modulo (quote in centesimi interi). **I tempi variano fino a
circa ±30 %** e nella sessione di questa misura il computer era più carico che nel primo studio (le stesse righe procedurali, rieseguite, sono più lente del 30
a 50 % rispetto al primo documento): contano l'ordine di grandezza e i rapporti. Parametri: scala 20 mm per piastrella, ampiezza 0,6 mm, immagine di 256 × 256
pixel. Comando: `$env:BENCH='1'; $env:BENCH_OUT='bench.txt'; npx vitest run src/kernel/bench.test.ts -t "texture in rilievo"`.

| Immagine (motore F) | Modo | Passo | Tempo (ms) | Triangoli | STL (KB) | OpenSCAD (KB) |
|---|---|---|---:|---:|---:|---:|
| Pelle | rilievo | 0,8 | 153 | 32.068 | 1.566 | 24 |
| Pelle | rilievo | 0,5 | 468 | 77.666 | 3.792 | 58 |
| Pelle | rilievo | 0,3 | 1.310 | 182.254 | 8.899 | 158 |
| Zigrinatura | rilievo | 0,8 | 121 | 15.500 | 757 | 24 |
| Zigrinatura | rilievo | 0,5 | 204 | 33.832 | 1.652 | 59 |
| Zigrinatura | rilievo | 0,3 | 600 | 56.976 | 2.782 | 157 |
| Pelle | incavo | 0,5 | 366 | 66.276 | 3.236 | 53 |
| Pelle | entrambi | 0,5 | 170 | 39.438 | 1.926 | 63 |
| Rumore (caso peggiore per la compressione) | rilievo | 0,5 | 516 | 77.494 | 3.784 | 57 |

Letture:

- **I triangoli del rilievo dipendono da quanta area sporge.** La pelle è chiara quasi ovunque, quindi quasi tutta la superficie sta sopra la faccia e sopravvive
  alla booleana (32.000 a 0,8 mm); la zigrinatura è per metà sotto il livello medio, quella parte resta dentro il pannello e sparisce (15.500). Il modo "entrambi"
  ha 39.400 triangoli perché il pannello perde la parte alta della colonna.
- **Il tempo cresce con 1/passo²** come per la mappa di altezze procedurale, ma con più triangoli: una texture da immagine ha dettaglio dappertutto, i rilievi
  procedurali no. A 0,8 mm (anteprima) sono 120 a 150 ms su questa macchina in modo rilievo (tabella). Il prototipo in Chrome misura 46 a 91 ms, ma **non è la stessa prova**: parte in modo "entrambi" (pelle, 91 ms; le onde del PNG e del JPG, 46 a 50 ms), che costa molto meno del rilievo (a 0,5 mm: entrambi 170 ms contro rilievo 468 ms, tabella), quindi la differenza viene dal modo e dall'immagine, non dal browser.
- **Il codice OpenSCAD** è quello della `zmap` (24 KB a 0,8, 58 a 0,5, 158 a 0,3 mm): dipende dai nodi, non dall'immagine. Il PNG sorgente non c'entra.
- **Il passo dev'essere comparabile al pixel.** A 20 mm per piastrella e 256 pixel un pixel è 0,078 mm: il passo di 0,3 a 0,8 mm lo campiona molto
  più grossolano e, per immagini con dettaglio fine, **fa aliasing** (moiré). Rimedio proposto (non implementato): sfocare di circa `passo / (2 × pixel)`
  pixel prima del campionamento, o ridurre l'immagine a un pixel pari al passo.

![Passo 0,8 mm](studio-texture/F-passo-0.8.png)
![Passo 0,5 mm](studio-texture/F-passo-0.5.png)
![Passo 0,3 mm](studio-texture/F-passo-0.3.png)

Foto degli STL della pelle in rilievo a 0,8, 0,5 e 0,3 mm (luce radente, vista ravvicinata, normali piatte per mostrare la griglia). A 0,8 mm la griglia
si vede, a 0,3 mm la superficie è già vicina all'immagine.

## Motore M: mesh intera, stile Blender e BumpMesh

### Che cosa offre davvero manifold-3d 3.5.4

Prima di progettare si è provato con un piccolo script (cubo di 30 mm, `refineToLength(1)`, 13.836 triangoli) e letto `manifold.d.ts`.

| Funzione | Risultato della prova |
|---|---|
| `refineToLength(L)` | Funziona senza tangenti: divide gli spigoli (anche di facce piane) in pezzi lunghi circa `L`, aggiunge vertici interni e restituisce `NoError`. Cubo di 30 mm a L = 1: 14 ms. Il tempo è lineare nei triangoli (pannello 80 × 60 × 5 a 0,8 mm: 33 a 43 ms; a 0,3 mm: 153 ms). La stima di circa 0,4 L² di superficie per triangolo ha permesso un tetto dei triangoli |
| `refine(n)` | Ogni spigolo in `n` parti (n = 8: 768 triangoli): non adatta la lunghezza al modello |
| `warp(f)`, `warpBatch(f)` | La funzione riceve **solo la posizione** (`warp`) o un array piatto `xyz` (`warpBatch`), per i **vertici unici** (cubo raffinato: 6.920 su 6.920): un vertice geometrico si sposta una volta sola. Quindi con `warp` non si possono aprire fessure tra facce, e per sapere la normale in ogni punto serve una tabella calcolata prima. **`status()` resta `NoError` anche quando la superficie si sovrappone**: il controllo è solo topologico (la documentazione lo dice: "it is up to the user to choose their function with discretion") |
| `calculateNormals(0, angolo)` | Aggiunge tre proprietà per vertice (`numProp` 6) e **duplica le righe di `getMesh()` sugli spigoli** (7.296 righe contro 6.920 vertici sul cubo raffinato, con o senza angolo). Utile per un renderer, ma le righe non coincidono con i vertici di `warpBatch` e non si può usare per spostare in modo controllato |
| `setProperties(n, f)` | Crea proprietà per vertice (`numProp` 7 nella prova): non sposta la geometria |
| `new Manifold(mesh)` | Con una mesh **aperta** (vertici staccati) **lancia `ManifoldError: Not manifold`** invece di restituire uno stato: la costruzione va in `try`/`catch` |

Da qui la scelta: **normali e spostamenti calcolati in JavaScript sulla mesh di `getMesh()`**, nuova `Mesh` con le posizioni spostate e `new Manifold(mesh)`
(`displaceSolid` in `src/kernel/textureMap.ts`). Così le varianti sono nostre e misurabili. Passi: raffinamento a lato massimo `edge` (tetto di 400.000 triangoli,
oltre si allarga il lato), normali di faccia e normale media del vertice **pesata per l'angolo**, spostamento `h(p, n)` lungo la direzione scelta (la
quota è quella delle proiezioni di `makeDisplacement`), ricostruzione. Controlli aggiuntivi che `status()` non fa: **triangoli rovesciati** (la normale del
triangolo dopo lo spostamento ha prodotto scalare negativo con quella di prima) e **sovrapposizione** (`selfOverlapVolume`: volume dell'unione del solido con se stesso
meno il suo volume, nullo se la superficie è valida; il rumore a 32 bit arriva a circa 0,05 mm³, quindi sotto 0,1 mm³ vale zero).

### Varianti delle normali agli spigoli

- **Medie** (come Blender): lo spigolo si sposta in diagonale, il cubo si **arrotonda e si deforma** agli spigoli (fotografia sotto, a sinistra).
- **Squadrate (miter)**: sugli spigoli vivi la direzione che sposta di `h` ogni piano adiacente (`(n1 + n2) / (1 + n1 · n2)`, tetto 2 h). Sulle facce sposta bene,
  ma sul vertice di spigolo la quota unica `h` vale per due piani diversi: **non ha dato risultati migliori** (anzi, più triangoli rovesciati, vedi tabella).
- **Separate per faccia**: ogni triangolo con vertici propri e normale propria. Le facce si staccano agli spigoli e **manifold rifiuta la mesh** in tutti i casi
  provati (cubo, pannello, cilindro, L, scatola, ampiezze 0,6 a 2 mm). Metodo **non utilizzabile** così: per chiudere le fessure servirebbe un nastro di triangoli
  lungo ogni spigolo (non implementato).
- **Spigoli fermi** (`fadeSharp`, analogo delle maschere angolari di BumpMesh e della soglia di 30 gradi): sui vertici dove due facce vicine formano un angolo
  diedro oltre 30 gradi l'ampiezza è **0**; la texture sfuma verso lo spigolo nel giro di un lato di triangolo. Lo spigolo resta esatto.

![Normali medie](studio-texture/cubo-medie.png)
![Spigoli fermi](studio-texture/cubo-fermi.png)
![Normali squadrate](studio-texture/cubo-miter.png)

Cubo di 30 mm, zigrinatura a rombi, ampiezza 1,2 mm, lato 0,8 mm, triplanare: normali medie (lo spigolo e l'angolo escono dal profilo e si sfrangiano), spigoli
fermi (spigolo dritto), squadrate (simili alle medie).

### Misure: rischio per solido e per ampiezza

Cinque solidi: pannello 80 × 60 × 5 (triplanare), cilindro Ø30 × 40 (**proiezione cilindrica** con tappi planari), cubo 30 mm (triplanare), **profilo a L**
40 × 40 × 10 con parete 10 × 40 × 40 e **scatola** 40 × 40 × 20 con cavità 30 × 30 (per gli **spigoli concavi**). Zigrinatura (scala 10 mm), modo "entrambi", lato
0,8 mm. Per ogni variante: triangoli rovesciati / sovrapposizione in mm³ a tre ampiezze (0,6 · 1,2 · 2 mm; lo spostamento massimo è la metà dell'ampiezza).
`status()` è `NoError` in **tutte** le righe tranne "separate" (errore). Ogni cella dà, per le tre ampiezze, **triangoli rovesciati / sovrapposizione**; la sovrapposizione è il volume dell'unione del solido con se stesso
meno il volume del solido, quindi **un valore negativo indica sovrapposizione** (più è negativo, più superficie si incrocia) e valori entro circa ±0,1 sono **rumore** numerico (per esempio +0,02 nel profilo a L). Comando: `-t "rischi del motore M"`.
I test unitari fissano solo ampiezza 0,6 con lato 0,8 mm; quanto si dice a 1,2 e 2 mm viene dal benchmark (senza asserzioni, escluso da `npm test`).

| Solido | Medie | Medie + spigoli fermi | Squadrate | Squadrate + spigoli fermi |
|---|---|---|---|---|
| Pannello | 8 / −0,02 · 48 / −0,09 · 224 / −11,6 | 0 / −0,02 · 0 / −0,03 · 0 / −11,1 | 16 / −0,03 · 124 / −0,18 · 548 / −13,9 | 0 / −0,02 · 0 / −0,03 · 0 / −11,1, identica alle medie con spigoli fermi |
| Cilindro | 44 / −0,04 · 90 / −0,50 · 332 / −7,1 | 0 / −0,02 · 0 / −0,33 · 192 / −5,3 | 56 · 110 · 514 / −8,1 | come le medie con spigoli fermi |
| Cubo | 0 / 0,00 · 60 / −0,23 · 228 / −21,0 | 0 / 0,00 · 0 / −0,58 · 0 / −26,3 | 36 / 0,00 · 144 / −0,32 · 372 / −22,5 | come le medie con spigoli fermi |
| L (concavo) | 0 / 0,00 · 42 / −0,02 · 121 / −10,2 | 0 / 0,02 · 0 / −0,01 · 0 / −8,8 | 4 / 0,00 · 92 / −0,04 · 415 / −11,0 | come le medie con spigoli fermi |
| Scatola (concavo) | 0 / 0,00 · 42 / −0,07 · 188 / −12,7 | 0 / 0,00 · 0 / −0,01 · 0 / −11,2 | 6 / 0,00 · 126 / −0,12 · 606 / −14,0 | come le medie con spigoli fermi |

Letture:

- **Fino a 0,6 mm di ampiezza (spostamento massimo 0,3 mm, meno della metà del lato di 0,8 mm) tutto è valido** con spigoli fermi; senza spigoli fermi restano pochi triangoli rovesciati su pannello (8) e cilindro (44),
  senza sovrapposizione misurabile. A 1,2 mm le varianti **senza** spigoli fermi hanno già triangoli rovesciati (da 42 a 144, medie e squadrate) ma una sovrapposizione piccola: da −0,02 a −0,18 mm³ in sei casi su dieci (soglia di rumore 0,1), con le eccezioni
  del cubo (−0,23 e −0,32) e del cilindro (−0,50 e −0,62). Le sovrapposizioni più nette a 1,2 mm sono proprio **con** spigoli fermi sul cubo (−0,58) e sul cilindro (−0,33): i rovesciati spariscono, la sovrapposizione no. A 2 mm la
  sovrapposizione è di 5 a 26 mm³ **in tutte le varianti, anche con gli spigoli fermi**, e `status()` non se ne accorge. **Regola proposta: spostamento massimo (metà dell'ampiezza nel modo "entrambi") non oltre circa
  la metà del lato dei triangoli. È un'estrapolazione**: in tutte le prove il lato è sempre 0,8 mm, quindi i dati non distinguono questa regola da un limite assoluto di circa 0,3 mm di spostamento; per
  distinguerle servirebbe variare il lato (non fatto). BumpMesh usa un'altra regola (avviso oltre il 10 % della dimensione minima del modello) e raffina in modo adattivo, qui il raffinamento è uniforme.
- **`selfOverlapVolume` è un'euristica, non una garanzia**: unisce il solido con se stesso con le booleane di manifold, che su un ingresso autointersecante hanno comportamento non definito (la documentazione di `warp`
  lo avverte). Dà un segnale coerente con i triangoli rovesciati e con l'ampiezza, ma un valore nullo non dimostra che la superficie sia valida.
- **Gli spigoli concavi non hanno dato problemi aggiuntivi** a ampiezze valide (L e scatola si comportano come cubo e pannello): in un angolo concavo gli spostamenti
  verso l'esterno dei due piani si avvicinano, ma il metodo con lo spigolo fermo e lo spostamento ridotto dentro un lato di triangolo non ha prodotto autointersezioni
  misurabili sotto i limiti sopra. Resta il rischio in angoli molto acuti o con rientranze strette (non provate).
- **Con le normali medie senza spigoli fermi l'ingombro cambia agli spigoli** (la crescita misurata del riquadro è la stessa ovunque, 0,28 mm a 0,6 di ampiezza, ma la forma dello
  spigolo no, vedi la fotografia): per un pezzo che deve incastrarsi i bordi sono da tenere fermi.
- **Le squadrate non migliorano le medie**: più triangoli rovesciati in tutti i solidi. Si propone di non implementarle.
- **Il volume cambia come l'integrale della quota** sulle facce: sul cubo, scarto tra il volume del kernel e quello atteso (integrale su 300 × 300 punti per sei facce) entro l'8 % (tolleranza del test, scarto effettivo non riportato)
  (test), perché le fasce accanto agli spigoli restano a zero. Con la zigrinatura e il livello medio 0,5 il pezzo **perde volume** (media del grigio 0,33): il livello medio è
  da tarare.

### Costo del motore M

Il tempo comprende raffinamento, normali, spostamento, ricostruzione ed estrazione della mesh (**tutto l'oggetto**: i triangoli non sono confrontabili 1 a 1 con quelli del
motore F, che tocca una faccia sola). Pelle, ampiezza 0,6 mm, "entrambi", spigoli fermi, normali medie.

| Oggetto | Lato (mm) | Tempo (ms) | di cui raffinamento | Triangoli | STL (KB) | OpenSCAD (KB) |
|---|---:|---:|---:|---:|---:|---:|
| Pannello 80 × 60 × 5 | 0,8 | 145 | 43 | 40.380 | 1.972 | 1.165 |
| Pannello | 0,5 | 305 | 74 | 101.564 | 4.959 | 3.033 |
| Pannello | 0,3 | 705 | 153 | 275.564 | 13.455 | 8.570 |
| Cubo 30 | 0,8 | 49 | 12 | 21.408 | 1.045 | 587 |
| Cubo 30 | 0,5 | 115 | 29 | 53.580 | 2.616 | 1.573 |
| Cilindro Ø30 × 40 (cilindrica) | 0,8 | 125 | 35 | 42.784 | 2.089 | 1.242 |
| Cilindro | 0,5 | 186 | 47 | 66.764 | 3.260 | 1.974 |

Il costo cresce con l'area totale e con 1/lato²; il codice OpenSCAD è un `polyhedron` con tutti i punti e tutte le facce (coordinate a tre decimali): **da 0,6 a 8,6 MB**.
Il volume coincide con quello del kernel entro 0,00 mm³ (cubo, pannello, cilindro), ma a questa dimensione è un esercizio di verifica, non un export praticabile.
Nel prototipo in Chrome (zigrinatura, ampiezza 0,8 mm, "entrambi", spigoli fermi, lato 0,8 mm, non la pelle a 0,6 mm della tabella): pannello 100 ms, cubo 49 ms e **cilindro Ø30 × 20** (non × 40 come nel benchmark: 28.192 triangoli contro 42.784) 73 ms.

### Dove il motore M fallisce o va limitato

1. **Ampiezza**: oltre circa metà lato di spostamento massimo la superficie si sovrappone senza che manifold lo segnali (servono `flipped` e `selfOverlapVolume`).
2. **Spigoli**: senza vertici fermi si arrotondano e si sfrangiano; con le normali separate la mesh si rompe.
3. **Raffinamento uniforme**: una mesh con molti triangoli piccoli o già fitta cresce senza controllo (tetto 400.000); BumpMesh raffina in modo adattivo e rispetta gli spigoli.
4. **Facce piccole, superfici sottili e pareti** sotto il doppio dell'ampiezza: le due superfici di una parete si possono incrociare (non misurato su pareti sottili).
5. **Perdita della catena parametrica** in OpenSCAD (solo `polyhedron` da megabyte) e peso nel progetto: l'operazione va tenuta come nodo con i parametri e ricalcolata (il risultato non si salva).
6. **Facce rivolte al piatto e sbalzi** nella stampa (vedi la sezione FDM).

## SVG in due modi

L'SVG di prova è uno stemma (anello e stella, `SAMPLE_SVG`), portato a 16 × 16 mm per piastrella con passo 20 mm, rilievo di 0,6 mm, su 80 × 60 mm.

**(a) Strada vettoriale.** `parseSvg` (già esistente, ha bisogno del DOM: thread principale, o `happy-dom` nei test) dà i contorni, `svgContours` li porta in mm, una `CrossSection`
con riempimento pari-dispari viene copiata nei centri delle piastrelle (`CrossSection.compose`, senza booleane quando le copie sono disgiunte), ritagliata sulla regione ed
estrusa come le celle dei mattoni (`svgReliefSolid`). **Bordi esatti, un solo livello di quota.** Il codice OpenSCAD è un `polygon(points, paths)` più un ciclo sui centri.

**(b) Rasterizzazione a scala di grigi.** L'SVG si disegna in un canvas (qui, in Node, con `sharp`/librsvg al posto del canvas del thread principale), si converte a grigio con
la formula intera e si usa come qualunque immagine nel motore F (livello medio 0,5, `invert`). **Sfumature possibili**, bordi a gradini della griglia.

| Strada | Passo | Tempo (ms) | Triangoli | STL (KB) | OpenSCAD (KB) | Note |
|---|---:|---:|---:|---:|---:|---|
| Vettoriale (celle estruse) | | 13 | 3.078 | 150 | 1,8 | volume = OpenSCAD entro 0,00 mm³ (rilievo e incavo), rendering 0,2 s |
| Raster 256 px, motore F | 0,8 | 62 | 6.680 | 326 | 24 | rasterizzazione e grigio: 13 a 28 ms (Node, sharp) |
| Raster 256 px | 0,5 | 167 | 13.858 | 677 | 59 | |
| Raster 256 px | 0,3 | 433 | 35.314 | 1.724 | 160 | |
| Raster 512 px | 0,8 | 73 | 6.712 | 328 | 24 | |
| Raster 512 px | 0,5 | 161 | 12.282 | 600 | 59 | |
| Raster 512 px | 0,3 | 387 | 32.538 | 1.589 | 160 | |

(I tempi hanno la variabilità del benchmark, circa ±30 %.) La differenza è di **5 a 30 volte in tempo, di 2 a 11 volte nei triangoli e di 13 a 90 volte nel
codice OpenSCAD** a favore della strada vettoriale; a parità di risoluzione dell'immagine (256 o 512 pixel) il raster non cambia in modo significativo, il vincolo è il passo
della griglia. Le fotografie qui sotto mostrano il bordo: netto e a spigoli con la vettoriale, a gradini di 0,5 mm con la raster.

![SVG vettoriale](studio-texture/svg-vettoriale.png)
![SVG raster](studio-texture/svg-raster-256.png)

Scelta: **offrire entrambe** quando l'immagine è un SVG, con la vettoriale come predefinita se i tracciati sono pieni e un solo livello basta (logo, sigla, marchio) e la raster quando serve
il grado di grigio (la vettoriale non vede le sfumature: `parseSvg` scarta solo i tracciati con `fill: none`, quindi un tracciato riempito con una sfumatura diventa un pieno a una quota sola). Limiti: il numero di punti
(`MAX_POINTS` di `parseSvg`), e il disegno ripetuto a passo fisso (nessuna rotazione né scostamento nel prototipo vettoriale, che sarebbero banali da aggiungere con `rotate` e `translate`).

## Asset e persistenza

**Oggi** `src/import/assets.ts` conosce solo le mesh: `MeshAsset {id, positions, indices}`, id = SHA-256 (primi 16 esadecimali) del contenuto, IndexedDB sotto `construct:asset:<id>`, codifica
per il file di progetto con zlib e base64 (`encodeAsset`); la scena tiene solo l'`assetId`, il kernel (worker) riceve la mesh con `registerAsset`, il ripristino (`restore.ts`)
la ri-registra. Non c'è alcuna gestione di immagini raster in `src` (nessun `createImageBitmap`, `OffscreenCanvas`, `getImageData`).

**Come si estende** (proposta, non implementata):

1. `ImageAsset { id, w, h, gray: Uint8Array }` accanto a `MeshAsset`, nello stesso registro o in uno parallelo (per non toccare il codice delle mesh). L'`id` è l'impronta SHA-256 di `w`,
   `h` e dei byte del **grigio già decodificato**, non del file. IndexedDB come per le mesh; codifica di progetto: intestazione (tipo, `w`, `h`) e zlib del grigio, base64.
2. **Decodifica una volta sola, all'importazione.** PNG e JPG con `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })` e `OffscreenCanvas` **anche nel
   worker** (provato in Chrome: riesce); **SVG nel thread principale** con un elemento `img` e un canvas (nel worker fallisce: `InvalidStateError: The source image could not be decoded`).
   Poi `rgbaToGray` (formula intera) e `resizeGray` (media sull'area) fino a **512 pixel sul lato maggiore**.
3. Il kernel riceve il grigio con un metodo `registerImage(id, gray)` (buffer trasferito con `Comlink.transfer`) e lo tiene in una mappa; `restore.ts` lo ri-registra come le mesh.
4. **Chiave di cache del kernel per impronta, non per pixel**: `evaluate.ts` oggi fa `JSON.stringify(node.pattern)` (riga 93 circa); con `textureCacheKey(id, params, proiezione)` la chiave resta
   sotto i 300 caratteri e non scorre mai l'immagine (test). Il nodo porta solo `imageId` e i parametri.

**Peso nel file di progetto** (misurato; grigio a 8 bit; zlib livello 6 come `encodeAsset`; base64 = +33 %; PNG da `sharp` al livello 9 per confronto). Comando:
`-t "peso delle immagini"`.

| Immagine | Lato | Grezzo | zlib | base64 | PNG |
|---|---:|---:|---:|---:|---:|
| Zigrinatura (regolare) | 256 | 64 KB | 1,2 KB | 1,5 KB | 1,9 KB |
| | 512 | 256 KB | 3,4 KB | 4,5 KB | 7,3 KB |
| | 1024 | 1.024 KB | 10,1 KB | 13,5 KB | 23,4 KB |
| Onde (liscia) | 256 | 64 KB | 3,4 KB | 4,6 KB | 8,0 KB |
| | 512 | 256 KB | 10,6 KB | 14,2 KB | 25,9 KB |
| | 1024 | 1.024 KB | 37,3 KB | 49,7 KB | 99,7 KB |
| Pelle (organica) | 256 | 64 KB | 48 KB | 64 KB | 68 KB |
| | 512 | 256 KB | 165 KB | 220 KB | 230 KB |
| | 1024 | 1.024 KB | 507 KB | 676 KB | 695 KB |
| Rumore (caso peggiore) | 256 | 64 KB | 64 KB | 85 KB | 94 KB |
| | 512 | 256 KB | 256 KB | 341 KB | 373 KB |
| | 1024 | 1.024 KB | 1.024 KB | 1.366 KB | 1.486 KB |

Una foto di una superficie reale (pelle, legno, tessuto) sta tra la "pelle" e il "rumore". **Ridimensionamento massimo consigliato: 512 pixel sul lato maggiore**
(zlib da 165 a 256 KB, base64 da 220 a 341 KB nei casi duri: accettabile per un progetto, come una mesh importata di media grandezza); 1024 solo su richiesta, con un avviso. Più importante
del peso è il rapporto con il passo: **un pixel più piccolo di metà passo è ridondante** (a 0,5 mm di passo bastano 0,25 mm per pixel, cioè 80 mm per piastrella in 320 pixel), e con
immagini dettagliate serve una sfocatura prima del campionamento per non fare aliasing.

**Determinismo tra browser.** Misurato in Chrome contro Node (libvips e librsvg) con `node scripts/texture-decode-check.mjs`, immagine di 256 × 256 pixel, formula intera del
prototipo, tre modi di decodifica in Chrome (senza conversione, predefinito, elemento img):

| Immagine | Differenza massima | Pixel diversi |
|---|---|---|
| PNG grigio, PNG RGB, PNG con alfa | 0/255 in tutti i modi | 0 % |
| JPG qualità 90 e 60 | 0/255 in tutti i modi | 0 % |
| PNG con profilo Display P3 | 1/255 | 0,1 % (predefinito), 9,9 % (senza conversione di colore) |
| SVG (antialiasing del rasterizzatore) | **63/255**, media 0,23 | 2,3 % |

PNG e JPG coincidono con libvips alla nostra formula, **su questa macchina e in Chrome**: non è una garanzia per Firefox e Safari (altri decodificatori JPEG, altro trattamento del colore e
dell'alfa, **non provato**). Il profilo colore sposta al più un livello. L'SVG dipende dal rasterizzatore e **non è riproducibile tra motori**. Da qui la scelta che risolve tutto: **si salva e
si identifica con l'hash il grigio decodificato** (sorgente di verità del progetto), mai il file originale: dopo l'importazione il risultato è identico ovunque, e riaprire il progetto non rifà la
decodifica. Il file originale si può tenere come allegato facoltativo per rifare l'importazione.

## Anteprima nella vista 3D

`PatternOverlay` (`src/viewport`) oggi evidenzia solo le facce con `FaceHighlight`. Un overlay per la texture si può fare in R3F con un **piano suddiviso** nel riferimento della faccia
(`PlaneGeometry` con un segmento ogni 0,8 mm, cioè circa 100 × 75 per 80 × 60 mm) e un `MeshStandardMaterial` con `displacementMap` (una `DataTexture` del grigio a 8 bit, `LinearFilter`) e
`displacementScale` = ampiezza, `displacementBias` per il livello medio. Scala, rotazione e scostamento si applicano alla matrice della texture (`repeat`, `rotation`, `offset`,
`center` di three) e la ripetizione con `RepeatWrapping`. Il costo è quello di una mesh da circa 15.000 triangoli: la GPU lo assorbe senza problemi, contro i 50 a 150 ms di un ricalcolo
del kernel a passo 0,8 mm (misurati qui: 120 a 150 ms nel benchmark carico in modo rilievo; 46 a 91 ms nel prototipo in Chrome, ma in modo "entrambi", vedi sopra). **Vantaggio**: il trascinamento dei cursori (ampiezza, scala, rotazione, scostamento) è
a 60 fotogrammi al secondo; il kernel lavora solo al rilascio, come per gli altri overlay. **Limiti**: (1) **non mostra gli incavi** sotto la faccia (il piano sta sopra il pezzo), quindi per
incavo e "entrambi" serve il mesh del kernel o un taglio con `clippingPlanes`; (2) il filtro bilineare e la conversione 8 bit in virgola mobile della GPU non coincidono bit per bit con il
campionatore del kernel (differenza di aspetto minima, ma non uguale); (3) la sfocatura, il livello medio nei modi "rilievo" e "incavo" (non lineare) vanno riscritti in un piccolo
shader; (4) per il motore M la proiezione triplanare in uno shader di vertici richiede la normale a ogni vertice e una mesh già fitta, quindi conviene mostrare direttamente il risultato del kernel.
**Valutato, non implementato e non misurato su GPU.** Proposta: overlay solo per il motore F in modo "rilievo" (e per "entrambi" con la faccia leggermente sotto), kernel per il resto.

## Export OpenSCAD per motore

| Motore | Codice | Dimensione | Verifica con OpenSCAD 2025.11.30 (volume contro kernel) |
|---|---|---|---|
| F, `zmap` + `polyhedron` | un file, quote in centesimi interi; per le regioni non rettangolari il parametro `clip` (un solido 3D che copre la regione) ritaglia sia la colonna tolta dal pezzo sia il rilievo | 24 KB a 0,8 mm, 58 a 0,5, 158 a 0,3 (pelle); 60 a 73 KB nei test a 0,5 mm con il pannello | **0,00 mm³** su rilievo, incavo, entrambi (pannello 80 × 60 × 5), su entrambi sul cilindro Ø30 (regione = faccia) e su rilievo, incavo, entrambi con un **cerchio r = 20 dentro il pannello** 80 × 60 (regione più piccola della faccia), rendering 0,3 a 1,2 s |
| F, `surface()` + PNG | `.scad` di 0,4 KB e PNG a fianco (163 × 123 pixel a 0,5 mm) | 0,4 KB più 0,5 a 0,8 KB (zigrinatura) | vedi sotto: da −1,7 a +6,4 mm³ contro una pelle del kernel, +27,7 (rilievo) e −90,0 mm³ (incavo) contro il risultato reale; cerchio nel pannello, entrambi: −0,45 mm³; rendering 0,5 a 0,9 s |
| M, `polyhedron` dell'oggetto | tutti i punti (3 decimali) e tutte le facce, **catena parametrica persa** | cubo 587 KB, cilindro 1,2 MB, pannello 1,2 MB a lato 0,8 mm; fino a 8,6 MB a 0,3 mm | **0,00 mm³** su cubo, pannello, cilindro (volume atteso della mesh arrotondata a tre decimali), rendering 2,0 a 3,9 s |
| SVG vettoriale | `polygon(points, paths)`, ciclo sui centri, ritaglio con `intersection()` | 1,8 KB | **0,00 mm³** su rilievo e incavo, rendering 0,2 s |

Verifica con `scripts/relief-openscad-check.mjs` (procedura in fondo): 16 casi su 16 renderizzati da OpenSCAD senza errori (stato `NoError` dove OpenSCAD lo riporta), con le differenze di volume indicate sopra. **Correzione dopo la revisione**: la prima versione
del modo "entrambi" toglieva dal pezzo un cubo grande quanto il **rettangolo** della regione e non la colonna della **regione**: con un cerchio r = 20 dentro il pannello 80 × 60 e la zigrinatura
OpenSCAD dava 23.620,6 mm³ contro 23.861,5 del kernel (−241 mm³); ora `clip` ritaglia anche la colonna e lo scarto è 0,00 mm³ (il caso è nei test e nel generatore della verifica). Le regioni verificate
sono quindi rettangolare, circolare uguale alla faccia (cilindro) e circolare più piccola della faccia (cerchio nel pannello); **non** si è verificata una regione con un **margine reale** (faccia ridotta con
`offset`, di forma qualunque: servirà scrivere il `clip` con `offset()` e `projection()`) né una faccia inclinata. Il motore F in `zmap` sulle facce curve non esiste (solo piane); il motore M scrive una mesh e basta.

## Stampabilità FDM (ugello 0,4 mm, strato 0,2 mm)

Valgono le regole del primo studio (`docs/studio-pattern-rilievo.md`: rilievo minimo, larghezze minime, orientamento). In più, per le texture da immagine:

- **Ampiezza minima.** Con strati da 0,2 mm una quota sulla faccia superiore ha **un livello ogni 0,2 mm**: ampiezza 0,6 mm = 3 gradini visibili, 0,4 mm = 2, sotto 0,3 mm la
  texture è quasi invisibile (come per le venature del primo studio). Per una texture "organica" a sfumature continue conviene **0,5 a 1,0 mm**, con strati da 0,1 mm o altezza strato variabile. Nel modo
  "entrambi" l'ampiezza si divide attorno al livello medio: 0,6 mm sono ±0,3 mm.
- **Risoluzione dell'immagine contro l'ugello.** Il più piccolo dettaglio che si stampa è circa 0,4 a 0,5 mm (una linea di estrusione). Quindi il **passo della griglia utile è 0,25 mm** (due campioni
  per dettaglio) e un pixel più fine di 0,1 mm non si vede. A scala 20 mm per piastrella bastano 200 pixel; a 80 mm per piastrella, 320. Dettagli sotto 0,4 mm di larghezza (tratti fini di una foto o di
  un SVG) **spariscono o diventano rumore**: sfocare o semplificare prima.
- **Facce laterali.** Su una faccia verticale la quota si forma nel piano XY e la risoluzione è quella dell'ugello (0,4 mm) più i segni degli strati (0,2 mm), che si sovrappongono alla texture: ampiezza
  almeno 0,5 mm. Una texture a quota continua sulle facce laterali ha **pendenze che guardano in basso**: oltre circa 45 gradi dalla verticale servono supporti o ponti, quindi per le pareti si preferiscono pendenze
  dolci (ampiezza piccola rispetto alla scala) o un'ampiezza che non superi circa la metà del lato (limite già imposto al motore M).
- **Facce rivolte al piatto.** La texture si imprime contro il piatto e perde nitidezza; il rilievo (aggiunta) non si stampa proprio senza supporti. Orientare il pezzo con la texture verso l'alto o di lato.
- **Motore M su tutto l'oggetto**: le facce rivolte verso il basso hanno sbalzi che l'immagine non conosce (BumpMesh offre una maschera per angolo; qui lo spigolo fermo copre solo gli spigoli vivi,
  non le facce orizzontali). Proposta: una maschera angolare come in BumpMesh (soglia 0 a 90 gradi sulle facce orizzontali).
- **Sono regole pratiche, non misurate con una stampa.**

## Come integrare nell'app

1. **Tipi** (`src/scene/types.ts`): per il motore F, un nuovo `kind: 'texture'` del Pattern (o gruppo "Rilievo" del selettore) con `imageId` e `TextureParams`; per il motore M un **nodo operazione**
   separato (come le deformazioni: opera su un figlio, non su una faccia). Versione dell'algoritmo (`textureAlgorithm: 1`) per bloccare la formula di grigio e il campionamento.
2. **`normalizePattern`**: usare `normalizeTexture` (limiti obbligatori già nel prototipo). Il passo ha il tetto di 250.000 nodi di `sampleGrid`, il motore M il tetto di triangoli (`maxTriangles`) e la regola dell'ampiezza.
3. **Kernel**: `cutterFor` calcola già il riferimento della faccia e la regione ridotta del margine. Il motore F produce **utensili** invece di un solido finito, così si inserisce nel `buildPattern` esistente e nel
   ramo additivo previsto per le borchie: incavo = un cutter (`difference`); rilievo = una addizione (`union`, come `reliefAddition`); "entrambi" = un cutter (la colonna) più una addizione (la pelle), nell'ordine
   differenza poi unione. Il lavoro in più rispetto ai rilievi procedurali è **solo la gestione delle immagini** (punto seguente): la geometria è `sampleGrid` e `heightSolid`, già nel primo studio.
4. **Asset** (`src/import/assets.ts`, `restore.ts`, `kernel.worker.ts`): `ImageAsset`, impronta del grigio, `registerImage`, ripristino (sezione "Asset e persistenza").
5. **Codegen** (`src/codegen/openscad.ts`): `textureFaceScad` dentro `translate(origine) rotate(inverseEuler)` come i Pattern; opzione di export `surface()` con PNG; il motore M scrive il `polyhedron` (con un avviso
   sulla dimensione) o, meglio, si esporta in STL/3MF.
6. **UI**: caricamento del file (PNG, JPG, SVG; trascinamento), scelta tra le texture di esempio, cursori (ampiezza, livello medio, scala, rotazione, scostamento X e Y, sfocatura), interruttori (inversione, ripetizione),
   modo (rilievo, incavo, entrambi), proiezione e normali per il motore M; avvisi (ampiezza troppo alta rispetto al lato, immagine oltre 512 pixel, spigoli).
7. **Test e documentazione**: quelli del prototipo, più un e2e (importa un PNG, applica, controlla il solido e l'export) e l'aggiornamento di README e tooltip.

## Il prototipo `docs/prototipi/texture-immagine.html`

File unico con tema chiaro e scuro (stessi token di `deformazioni.html`), manifold-3d 3.5.4 e three 0.186.1 da jsDelivr. Funzioni: caricare PNG, JPG, SVG (decodifica con canvas) o scegliere una delle sei texture di
esempio; oggetto pannello, cilindro o cubo; motore F o M; ampiezza, livello medio, scala in mm per piastrella, rotazione, scostamento, inversione, ripetizione, sfocatura, passo o lato, modo (rilievo, incavo, entrambi),
proiezione, normali e spigoli fermi; vista 3D con luce radente (direzione regolabile); metriche in tempo reale (tempo, triangoli, stato di manifold, triangoli rovesciati, volume, KB di STL e di OpenSCAD); scarico di
STL e `.scad`. Il blocco `CORE-BEGIN`/`CORE-END` è **generato dai sorgenti TypeScript** con `node scripts/texture-core.mjs write` e un test (`src/kernel/textureCore.test.ts`) lo estrae, lo esegue in Node e lo
confronta bit per bit con le funzioni TypeScript (texture di esempio, grigio, quota, spostamento per ogni proiezione, solidi del motore F e M, codice OpenSCAD, STL).

Provato in Chrome con Playwright (`node scripts/texture-prototype-check.mjs`): **nessun errore né avviso in console**, tema chiaro e scuro, caricamento di un PNG, di un JPG e di un SVG, cambio di motore e di oggetto,
normali separate (il prototipo mostra che manifold rifiuta la mesh), scarico dei due file. Esiti: pannello F, pelle, modo "entrambi", passo 0,8 mm: 15.620 triangoli in 91 ms; motore M con zigrinatura, ampiezza 0,8 mm, "entrambi", lato 0,8 mm, spigoli fermi: pannello 40.380 triangoli in 100 ms, cilindro
Ø30 × 20 28.192 in 73 ms, cubo 21.408 in 49 ms, nessun triangolo rovesciato. I tempi non sono omogenei con quelli del benchmark (modo, oggetto e texture diversi).

![Pannello, motore F, pelle](studio-texture/01-pannello-F-pelle-light.png)
![Pannello, motore F, tema scuro](studio-texture/01-pannello-F-pelle-dark.png)
![PNG caricato](studio-texture/02-pannello-F-png-light.png)
![JPG caricato](studio-texture/03-pannello-F-jpg-light.png)
![SVG caricato](studio-texture/04-pannello-F-svg-light.png)
![Pannello, motore M](studio-texture/05-pannello-M-light.png)
![Cilindro, motore M, proiezione cilindrica](studio-texture/06-cilindro-M-light.png)
![Cubo, motore M](studio-texture/07-cubo-M-light.png)
![Cubo, normali separate: nessun solido](studio-texture/08-cubo-M-separate-light.png)
![Cilindro, motore F](studio-texture/09-cilindro-F-light.png)

Le sei texture di esempio, come immagini in scala di grigi:

![Texture di esempio](studio-texture/campioni.png)

## Confronto con i rilievi procedurali

### Tabella omogenea (stessa faccia 80 × 60 mm su pannello di 5 mm, stessa sessione di misura)

Le righe procedurali sono **rieseguite nella stessa sessione** delle righe immagine (stesso benchmark, stesse colonne): per questo sono più lente (circa 30 a 50 %) dei numeri del primo documento. Contano
l'ordine di grandezza e i rapporti, non il millisecondo (variabilità fino a circa ±30 %).

| Soluzione | Motore | Passo (mm) | Tempo (ms) | Triangoli | STL (KB) | OpenSCAD (KB) |
|---|---|---|---:|---:|---:|---:|
| **Mattoni** (procedurale) | CSG | | 7 | 456 | 22 | 0,3 |
| Mattoni | mappa | 0,5 | 166 | 6.596 | 322 | 47 |
| **Borchie** (procedurale, additiva) | CSG | | 56 | 10.162 | 496 | 0,3 |
| **Rame battuto** (procedurale) | CSG | | 303 | 18.312 | 894 | 3,2 |
| Rame battuto | mappa | 0,8 | 64 | 15.700 | 767 | 31 |
| Rame battuto | mappa | 0,5 | 157 | 39.246 | 1.916 | 77 |
| **Ruggine** (procedurale) | mappa | 0,8 | 62 | 15.354 | 750 | 32 |
| Ruggine | mappa | 0,5 | 214 | 38.958 | 1.902 | 78 |
| **Legno** (procedurale) | ibrido | 0,5 | 274 | 38.328 | 1.872 | 62 |
| **Immagine, pelle** | motore F, rilievo | 0,8 | 153 | 32.068 | 1.566 | 24 |
| Immagine, pelle | motore F, rilievo | 0,5 | 468 | 77.666 | 3.792 | 58 |
| Immagine, zigrinatura | motore F, rilievo | 0,5 | 204 | 33.832 | 1.652 | 59 |
| Immagine, pelle | motore F, entrambi | 0,5 | 170 | 39.438 | 1.926 | 63 |
| **Immagine, SVG** | vettoriale (celle) | | 13 | 3.078 | 150 | 1,8 |
| Immagine, SVG | raster, motore F | 0,5 | 167 | 13.858 | 677 | 59 |
| **Immagine, pelle** | **motore M** (oggetto intero) | 0,8 | 145 | 40.380 | 1.972 | 1.165 |

Il motore M tocca tutte le facce: i suoi triangoli e il suo codice OpenSCAD non sono confrontabili 1 a 1 con quelli del motore F.

Il motore F con l'immagine **costa come la mappa di altezze procedurale** (stessa geometria, `sampleGrid` e `heightSolid`) con un fattore da 1 a 2 in più nei triangoli, perché l'immagine ha dettaglio ovunque. I casi
geometrici (mattoni, borchie, rame) **in CSG restano molto più economici nel codice OpenSCAD** (0,3 a 3,2 KB contro 24 a 59 KB) e nei triangoli quando la forma è semplice.

### Criteri qualitativi

| Criterio | Rilievi procedurali (CSG, mappa, ibrido) | Texture da immagine |
|---|---|---|
| **Qualità dei bordi** | Esatti in CSG (mattoni, fughe, borchie); a gradini nella mappa di altezze | A gradini della griglia (motore F), eccetto l'SVG vettoriale (esatto, un livello). Il motore M dipende dal lato dei triangoli |
| **Determinismo e seme** | Seme intero e rumore con hash intero: stesso disegno ovunque (campo di versione dell'algoritmo) | Nessun seme: determinismo dato dal grigio salvato (hash). Decodifica di PNG e JPG uguale in Chrome e Node (provato); SVG dipende dal rasterizzatore: si salva il grigio |
| **Peso del progetto** | Solo i parametri (poche centinaia di byte) | I parametri più il grigio: 165 a 256 KB zlib per 512 × 512 pixel (da 1 a 10 KB per texture regolari) |
| **Superfici supportate** | Solo facce piane | F: facce piane. M: **mesh intera**, curva o piana, con proiezioni (triplanare, cilindrica, planare). Prima del motore M nessuna superficie curva |
| **Libertà creativa** | Cinque disegni scelti e parametrici, ognuno con la sua geometria; ampliare significa scrivere codice | Qualunque immagine dell'utente: foto, scansioni, loghi, texture scaricate (come BumpMesh e le sue 101 texture) |
| **Export OpenSCAD** | Piccolo e leggibile in CSG (0,3 a 3 KB), polyhedron da 30 a 200 KB nella mappa | F: `zmap` 24 a 160 KB, oppure `surface()` con PNG (0,4 KB più PNG); M: polyhedron da 0,6 a 8,6 MB (catena persa); SVG vettoriale 1,8 KB |
| **Parametri esposti** | Per tipo (larghezza mattone, fuga, profondità, seme, diametro delle martellate) | Uniformi: ampiezza, livello medio, scala, rotazione, scostamento, inversione, ripetizione, sfocatura, modo, passo; M aggiunge proiezione e spigoli |
| **Costo di integrazione** | 9 a 10 giorni per cinque texture (primo studio), di cui 2 di infrastruttura (tipi, normalize, ramo additivo, `patternLines`, UI) | Motore F: 4 a 5 giorni **sopra** l'infrastruttura già fatta per i rilievi (la geometria è già scritta), SVG vettoriale 1,5 a 2, M 4 a 5 (nodo operazione con avvertenze) |
| **Rischi** | Qualità della ruggine e del legno a 0,4 mm, `.scad` da 78 KB (ruggine), tetti sui cicli | Aliasing con immagini dettagliate, grigio e alfa non identici tra browser (Firefox e Safari non provati), peso dell'immagine nel progetto, ampiezza oltre il limite del motore M, dettagli sotto l'ugello che non si stampano |

### Raccomandazione

**Soluzione ibrida, con un'unica interfaccia "Rilievo".** Procedurale/CSG per i casi **geometrici e periodici** (mattoni, fughe, borchie, rame battuto): bordi esatti, codice OpenSCAD di pochi byte, nessuna dipendenza da
file, progetto leggero, seme riproducibile. **Immagine per il resto**: texture organiche (pelle, tessuto, fibra), marchi e loghi, qualunque disegno portato dall'utente. Non una cosa al posto dell'altra: il motore F con
l'immagine **riusa** `sampleGrid`, `heightSolid` e il ramo additivo dei rilievi, quindi costa poco sopra l'infrastruttura già prevista. Ordine consigliato, ognuno con una versione minor:

1. **Rilievi procedurali, tappe 1 e 2 del primo studio** (mattoni, borchie con il ramo additivo; rame): invariate, danno l'infrastruttura (tipi, `normalizePattern`, additivo, `patternLines`, UI). Prima di tutto, dopo il branch
   B sulla regione e sul selettore.
2. **Texture da immagine, motore F** (PNG, JPG, esempi; rilievo, incavo, entrambi; asset immagine con grigio salvato, registrazione nel worker, chiave di cache per impronta; export `zmap`): **stima 4 a 5 giorni** (1 per
   l'asset e la decodifica con il test di determinismo, 1,5 per tipi, `normalize` e kernel come utensili, 1 per la UI, 0,5 per l'export con `intersection()` per le regioni non rettangolari, 1 per test, e2e e documentazione). Più
   0,5 giorni per l'export opzionale con `surface()` e PNG.
3. **SVG**: vettoriale (celle estruse, `parseSvg` già esistente) e raster (stessa strada del grigio): **1,5 a 2 giorni**; la vettoriale è il predefinito per i tracciati pieni.
4. **Anteprima GPU** (`displacementMap` su un piano suddiviso, per rilievo): **circa 2 giorni**, facoltativa; rende fluido il trascinamento dei cursori.
5. **Motore M** come nodo operazione (come le deformazioni) con spigoli fermi, controllo dell'ampiezza (spostamento massimo non oltre circa metà lato), triangoli rovesciati e sovrapposizione, avviso sull'export
   OpenSCAD: **4 a 5 giorni**, **solo se emerge la richiesta** (mesh importate, oggetti curvi): è la parte con più limiti e senza export OpenSCAD praticabile. Non implementare le normali squadrate né quelle separate.

Totale: **6 a 7 giorni** per il nucleo (2 e 3), **circa 13 giorni** con anteprima e motore M. Il motore F su **più facce** si ottiene ripetendo la chiamata per faccia, come per i rilievi.

**Miglioramenti proposti** (non implementati): (a) **sfocatura automatica anti-aliasing** pari a circa `passo / (2 × pixel)` prima del campionamento; (b) **livello medio automatico** (media del grigio) per non perdere o
guadagnare volume senza volerlo; (c) i rilievi procedurali (ruggine, legno, rame) **come generatori di immagine** in 512 pixel che passano per lo stesso motore F e lo stesso asset: unifica codice e UI, e dà l'export
`surface()` anche a loro; (d) **maschera angolare** sul motore M come in BumpMesh (soglia sulle facce orizzontali), e raffinamento **adattivo** dei lati vicino agli spigoli; (e) un **controllo di ripetibilità** (la texture è senza
cucitura?) con un'anteprima 2 × 2; (f) per l'SVG, scostamento e rotazione del disegno nella strada vettoriale; (g) un nastro di triangoli sugli spigoli per rendere usabili le normali separate, solo se servisse davvero.

### Decisioni ancora aperte

1. **Peso nel progetto**: va bene salvare il grigio decodificato (165 a 256 KB zlib per 512 × 512, fino a 350 KB in base64 nei casi duri), oppure si preferisce un riferimento al file con ricalcolo? (Il grigio è la sola scelta che dà
   lo stesso risultato ovunque.)
2. **Formula del grigio e trasparenza**: la formula intera di Rec. 601 sui valori sRGB, trasparenza composta sul **bianco**: da confermare (con un fondo nero un logo trasparente invertirebbe il rilievo).
3. **Lato massimo dell'immagine**: 512 pixel come predefinito, 1024 su richiesta?
4. **Modo predefinito e livello medio**: "entrambi" con 0,5 (come Blender e BumpMesh, perde volume con una texture scura) oppure "rilievo" da 0 ad A?
5. **Export OpenSCAD del motore F**: `zmap` in un file solo come predefinito e `surface()` con PNG come opzione, o il contrario? E per il motore M, un `polyhedron` da megabyte con avviso o solo STL e 3MF?
6. **Ampiezza troppo alta sul motore M**: avviso oppure blocco?
7. **SVG**: strada vettoriale o raster come predefinita per i file con tracciati pieni?
8. **Motore M adesso o poi**: se non c'è richiesta di texture sui pezzi curvi, si può lasciare fuori dalla prima versione.

## Limiti di questo studio

- **Solo facce piane per il motore F** (facce inclinate funzionerebbero come per i Pattern con `faceFrame`, non provate), regione con un margine reale (offset della faccia) non verificata in OpenSCAD: verificate solo regioni rettangolare e circolare (cilindro, cerchio dentro il pannello), che si esprimono con `clip`.
- Una sola immagine per oggetto, un solo livello (BumpMesh ne ha quattro).
- La quota usa il grigio, non i canali colore; niente mappe di normali né di rugosità.
- Nel motore M il raffinamento è uniforme; l'ampiezza ha una regola empirica (spostamento massimo non oltre circa metà lato) estrapolata da cinque solidi con un solo lato (0,8 mm), non una garanzia.
- **Precisione numerica tra motori JavaScript**: `Math.sin`, `Math.cos`, `Math.atan2` e `**` non sono garantiti identici al bit tra browser; la quota arrotondata al centesimo di mm può cambiare di un livello in pochi punti.
  Il codice OpenSCAD contiene valori già calcolati e non ne risente.

## Cosa non è stato verificato

- **Firefox e Safari**: decodifica di PNG, JPG, profili colore e alfa, canvas, prototipo. Solo Chrome (e libvips/librsvg in Node).
- **Stampa reale**: tutte le regole di stampabilità sono pratiche, non provate con una stampa.
- **Documentazione di Blender**: la pagina del modificatore Displace non si è caricata; la descrizione è dalla conoscenza del programma. Il funzionamento interno di BumpMesh (matematica delle normali) non è descritto dal suo README e non si è letto il codice.
- **`createImageBitmap` nel worker dell'app** (provato solo in una pagina di prova in Chrome), e il ripristino da IndexedDB delle immagini: l'estensione di `assets.ts` non è implementata.
- **Anteprima GPU** con `displacementMap`: valutata, non realizzata e non misurata.
- **Immagini grandi** (oltre 1024 pixel) e memoria: non provate. Il prototipo riduce a 512 pixel.
- **Margine e facce inclinate** del motore F nel codice OpenSCAD; faccia a regione non convessa.
- **Mesh importate** (STL, 3MF) e solidi non convessi con rientranze strette o pareti sottili nel motore M (provati: pannello, cilindro, cubo, profilo a L, scatola).
- **Esportazione 3MF** del risultato e apertura in uno slicer.
- **Integrazione nell'app**: nessun collegamento a store, worker, UI; nessun test e2e (come il primo studio).
- **Differenze tra l'anteprima in tempo reale e il risultato** del kernel (per l'overlay).

## Riproducibilità: comandi

Dalla radice del repository, in PowerShell:

```
# Test del prototipo (funzioni pure, kernel, codice OpenSCAD, blocco CORE dell'HTML)
npx vitest run src/scene/textureMap.test.ts src/kernel/textureMap.test.ts src/codegen/textureScad.test.ts src/kernel/textureCore.test.ts src/scene/relief.test.ts src/kernel/relief.test.ts
npx tsc --noEmit

# Benchmark: tabella dei rilievi con le righe immagine, motore M, SVG, peso delle immagini, rischi del motore M
$env:BENCH='1'; $env:BENCH_OUT='bench.txt'; npx vitest run src/kernel/bench.test.ts -t "texture in rilievo"
$env:BENCH='1'; $env:BENCH_OUT='bench.txt'; npx vitest run src/kernel/bench.test.ts -t "peso delle immagini"
$env:BENCH='1'; $env:BENCH_OUT='bench.txt'; npx vitest run src/kernel/bench.test.ts -t "rischi del motore M"

# Verifica del codice OpenSCAD: .scad, PNG e volumi attesi, poi OpenSCAD su ciascuno
$env:TEXTURE_SCAD_DIR='C:\temp\texture'; npx vitest run src/codegen/textureScad.test.ts -t "verifica OpenSCAD"
node scripts/relief-openscad-check.mjs C:\temp\texture

# Blocco CORE del prototipo: rigenerarlo dai sorgenti e controllarlo
node scripts/texture-core.mjs write
node scripts/texture-core.mjs check

# Prototipo in Chrome: console, caricamento di PNG, JPG, SVG, schermate in docs/studio-texture (serve la rete per jsDelivr)
node scripts/texture-prototype-check.mjs

# Decodifica delle immagini in Chrome contro Node, anche nel worker
node scripts/texture-decode-check.mjs

# Foto degli STL (cubo con normali medie e spigoli fermi, passi del motore F, SVG vettoriale e raster) fuori dal repository
$env:TEXTURE_SAMPLES='C:\temp\texture-img'; npx vitest run src/kernel/textureMap.test.ts -t esempi
node scripts/texture-render.mjs C:\temp\texture-img C:\temp\texture-img\png
```

`scripts/relief-openscad-check.mjs` usa OpenSCAD con `--backend=manifold` (percorso predefinito `C:/Program Files/OpenSCAD/openscad.com`, variabile `OPENSCAD`) e confronta il volume dell'STL di OpenSCAD con `expected.json`.
