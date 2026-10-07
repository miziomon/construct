# Changelog

Tutte le modifiche rilevanti di WebCAD sono documentate in questo file.

Il formato segue [Keep a Changelog 1.1.0](https://keepachangelog.com/it-IT/1.1.0/) e il progetto
adotta il [Semantic Versioning](https://semver.org/lang/it/). Finché la versione maggiore è 0, le nuove
funzionalità incrementano la minor (0.x.0) e le correzioni la patch (0.x.y).

## Come si rilascia una versione

1. Sposta le voci di `[Non rilasciato]` in una nuova sezione `[x.y.z] - AAAA-MM-GG`.
2. Aggiorna `version` in `package.json`.
3. Verifica con `npm run typecheck && npm test && npm run build`.
4. Commit `chore(release): x.y.z` e tag annotato `vx.y.z` (`git tag -a vx.y.z -m "WebCAD x.y.z"`).

I messaggi di commit seguono i [Conventional Commits](https://www.conventionalcommits.org/it/v1.0.0/)
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).

## [Non rilasciato]

## [0.22.0] - 2026-10-07

### Aggiunto
- **Dimensioni del piano di stampa** nella barra di stato, prima dell'ingombro ("Piano 256 × 256 mm"). Un clic apre una finestra per cambiare larghezza (X) e profondità (Y), da 20 a 2000 mm, con il pulsante "Predefinito 256 × 256". Piano, griglia, bordo e limiti dei cursori della posizione seguono le nuove misure, che restano salvate nel browser.
- **Ridimensiona (R) su qualsiasi gruppo**: Raggruppa, Unione, Differenza, Intersezione, Inviluppo convesso, Guscio, Ripetizione e Pattern si ridimensionano con il gizmo come una forma primitiva, applicando la scala a tutto il contenuto (anche per un solo asse). Il centro della base resta fermo e le misure si arrotondano a 0,5 mm (0,01 mm con Maiusc). Un solo passo di Annulla.
- Nuova sezione **Dimensioni del gruppo** nelle proprietà di ogni gruppo: scala per asse in percentuale e pulsante "Ripristina 100%".
- Nel codice OpenSCAD un gruppo ridimensionato ha `scale([sx, sy, sz])` come modificatore più interno; un Raggruppa ridimensionato esce come blocco con la sua trasformazione e i figli dentro.

### Modificato
- Un nodo non può essere trascinato dentro o fuori da un gruppo ridimensionato, e Separa lascia com'è un gruppo ridimensionato: prima si riporta la scala al 100%, altrimenti i figli salterebbero.

### Corretto
- Il ridimensionamento di un gruppo con risultato vuoto non produce più posizioni non valide.

## [0.21.0] - 2026-10-07

### Aggiunto
- **Pattern su più facce**: i sei pulsanti dei lati (+Z, -Z, +X, -X, +Y, -Y) sono interruttori, e "Scegli facce" permette di cliccare sul pezzo le facce piane da forare (un secondo clic le toglie, Esc o "Fine scelta" chiude la scelta). Ogni faccia ha il proprio disegno (il seme cresce di uno per faccia) e nel codice OpenSCAD ha il proprio elenco `cells_N`. Durante la scelta la vista mostra il pezzo intero, con le facce già scelte evidenziate.
- **Rombi e Triangoli** (passo e rotazione): due nuove griglie regolari, accanto a Voronoi, Esagoni e Cerchi.
- **Avviso di calcolo lento** nel Pattern: compare quando il calcolo supera 700 ms o quando celle per facce superano 300. L'**anteprima semplificata** (angoli arrotondati con meno segmenti) si attiva da sola se il calcolo è lento e si cambia con la casella; dopo l'OK il risultato è sempre a qualità piena e il parametro non viene salvato.
- **Tooltip dettagliati** per tutti i pulsanti della barra: nome e scorciatoia, cosa fa, come si applica e, per i comandi più complessi (Raccordo, Smusso, Smusso angolare, Guscio, Unisci, Inviluppo, Serie, Pattern, Misura, Appoggia su una faccia, Operandi in trasparenza), un'immagine di esempio. Compaiono dopo un breve ritardo al passaggio del mouse o con il focus da tastiera, anche sui pulsanti disabilitati, e Esc li chiude. Le immagini sono in `public/help` e si rigenerano con `DOC_IMAGES=1 npx playwright test e2e/docs-images.spec.ts`.
- Repository pubblico con `README.md` e licenza MIT.

### Rimosso
- **Reticolo 3D** del Pattern (troppo lento per un risultato poco utile). I progetti salvati con un reticolo si aprono come Voronoi; quelli con la faccia unica della 0.20.0 si convertono da soli nelle nuove `faces`.

### Modificato
- I pulsanti della barra non hanno più l'attributo `title` nativo: il nome accessibile resta l'`aria-label` e la descrizione è nel nuovo tooltip.

## [0.20.0] - 2026-10-07

### Aggiunto
- **Pattern** (pulsante nella barra, tasto Z): applica un disegno all'oggetto selezionato. **Voronoi** casuale con **seme** (lo stesso seme dà sempre lo stesso disegno, anche nel codice OpenSCAD; "Nuovo seme" ne propone un altro), numero di celle (3 a 500) e **regolarità** (da celle del tutto casuali a quasi uniformi). **Esagoni** e **Cerchi** su una griglia con passo e rotazione. **Reticolo 3D**: struttura di puntoni (diametro a scelta) dentro il pezzo, con 4 a 40 celle Voronoi 3D.
- Parametri comuni: modo **Fori** (si tolgono le celle e restano le pareti) o **Solchi** (si tolgono le pareti), spessore della **parete**, **arrotondamento** delle celle, **margine** (cornice piena attorno al disegno), **profondità** (0 = passante, altrimenti tasca di quella profondità) e, con la tasca, taglio da una faccia o da entrambe. Un avviso segnala le pareti sotto 0,8 mm, difficili da stampare.
- **Faccia di partenza**: i sei lati dell'ingombro oppure "Scegli faccia" (clic su una faccia piana dell'oggetto in anteprima, evidenziata al passaggio del puntatore). Il disegno segue la faccia scelta anche se inclinata.
- Mentre il pannello è aperto la vista mostra l'anteprima dal vivo; OK conferma in un solo passo di Annulla, Esc annulla (durante la scelta della faccia interrompe solo la scelta), Invio conferma.
- Il risultato è un gruppo **"Pattern tipo: nome"** con dentro il solo originale: seme, celle, parete, faccia e profondità si modificano dal pannello delle proprietà, dove "Aggiorna all'ingombro" ricalcola l'area del disegno se il pezzo è cambiato. Il gruppo si sposta, ruota, specchia o si usa in una booleana come ogni altro oggetto.
- Nel codice OpenSCAD il Pattern esce con le celle già calcolate in un elenco `cells` e le stesse operazioni del kernel (`offset` per parete e arrotondamento, `projection` per la regione, `linear_extrude` per il taglio); il reticolo esce come elenco `edges` con `hull()` di sfere.

### Modificato
- Il pannello delle proprietà del gruppo Pattern non mostra la riga "Operazione" delle booleane, e non si possono trascinare altri oggetti dentro un gruppo Pattern.
- Aprire un altro strumento (Raccordo, Smusso, Guscio, Misura, Appoggia, Serie) chiude il Pattern e viceversa.

## [0.19.0] - 2026-10-07

### Aggiunto
- **Serie** (pulsante nella barra, tasto O): ripete l'oggetto selezionato in tre modi. **Lineare**: una fila con un numero di copie e un passo su X, Y, Z (o lo spazio totale dalla prima all'ultima copia). **Griglia**: copie su X, Y e Z con il passo di ogni asse. **Circolare**: attorno a un asse X, Y o Z, con angolo totale (giro completo o arco), centro di rotazione, e la scelta di ruotare le copie con la serie o lasciarle orientate come l'originale. In tutti i tipi si può togliere l'originale (lineare e circolare) e il pannello indica il numero totale di copie (al massimo 200). Mentre il pannello è aperto la vista mostra l'anteprima dal vivo; OK conferma in un solo passo di Annulla, Esc annulla.
- Il risultato è un gruppo **"Ripetizione: nome"** nell'elenco oggetti, con dentro il solo originale: le copie non sono oggetti, quindi si modificano i parametri (tipo, copie, distanze, angolo, asse, centro) dal pannello delle proprietà del gruppo e non le singole copie. Il gruppo si sposta, ruota, specchia, si ripete o si usa in una booleana come ogni altro oggetto; l'originale si modifica selezionandolo nell'elenco. Separa scioglie il gruppo lasciando l'originale.
- Nel codice OpenSCAD la Ripetizione esce come veri `for()` (uno per la fila e per il cerchio, uno per asse nella griglia) con `translate` e `rotate`, non come un elenco di copie.

### Modificato
- Il pannello delle proprietà del gruppo Ripetizione non mostra la riga "Operazione" delle booleane (non ne ha), e non si possono trascinare altri oggetti dentro un gruppo Ripetizione.

## [0.18.0] - 2026-10-07

### Aggiunto
- **Appoggia su una faccia** (pulsante nella barra, tasto V): attivato lo strumento, passando sull'oggetto si evidenzia la faccia sotto il puntatore e un clic ruota l'oggetto perché quella faccia poggi sul piatto, poi lo appoggia (un solo passo di Annulla). La rotazione avviene attorno al centro dell'ingombro, rispetta gli oggetti specchiati e salta quelli bloccati (con un avviso). Esc o V escono senza toccare la scena.
- **Contorno (offset 2D)** per tutte le forme 2D, anche testo, SVG, simboli ed emoji: nel Profilo 2D uno slider in mm (positivo ingrandisce, negativo restringe) e, con un contorno diverso da zero, la scelta **Angoli arrotondati / vivi**. Si applica al profilo prima dell'estrusione (lineare o rotazionale), ad esempio per ispessire un testo o dare gioco a un incastro; in OpenSCAD esce `offset(r)` o `offset(delta)`. Un contorno negativo che fa sparire il profilo dà un solido vuoto. Il Guscio sulle forme con contorno usa la cavità scalata.
- **Inviluppo convesso** (pulsante nella barra e nella barra sugli oggetti, tasto J): con due o più oggetti selezionati crea un gruppo "Inviluppo convesso" (`hull()` in OpenSCAD) che riempie la forma più piccola e senza concavità che li contiene; i fori si sottraggono, il gruppo si modifica e si separa come gli altri.
- Il nuovo documento `docs/da-fare.md` raccoglie le funzioni ancora da aggiungere in ordine di priorità, con il confronto con OpenSCAD, Fusion 360, Blender e Tinkercad e lo studio di fattibilità delle Serie di copie con l'ipotesi di interfaccia.

## [0.17.0] - 2026-10-07

### Aggiunto
- **Estrusione rotazionale** per tutte le forme 2D (cerchio, quadrato, anello, stelle, testo, SVG, simboli, emoji, ...): nella sezione Estrusione un selettore **Lineare | Rotazionale** sceglie il tipo. Il rotazionale simula `rotate_extrude` di OpenSCAD: il profilo gira attorno all'asse Z (la sua Y diventa l'altezza, la X il raggio) con tre parametri: **Angolo** (1–360°, da +X in senso antiorario), **Raggio** (distanza del centro della forma dall'asse) e **Segmenti** (come `$fn`). Un cerchio lontano dall'asse dà un toro, con meno di 360° un arco o un gancio; la parte del profilo oltre l'asse viene tagliata. Nel codice OpenSCAD esce `rotate_extrude(angle, $fn)` con la stessa parte x ≥ 0, quindi anteprima e codice coincidono. Tornando a Lineare i parametri della rotazione restano.
- **Lucchetto delle proporzioni e slider Scala per tutte le forme 2D e per il cubo** (finora solo per gli SVG). Con il lucchetto chiuso le misure indipendenti (larghezza e profondità, i tre lati del cubo, i due raggi del cerchio) e la maniglia Ridimensiona (R) cambiano insieme; la Scala è in percentuale della misura iniziale della forma (per gli SVG, di quella del file) e ridimensiona sempre in proporzione. Le forme esistenti restano libere finché non si chiude il lucchetto.
- **Preferiti e Recenti** nelle tab Simboli ed Emoji: la stella in alto a destra di ogni carattere lo mette tra i Preferiti, un clic lo aggiunge ai Recenti (gli ultimi 12). Si salvano in localStorage e compaiono in cima alla tab.
- **Apri tutto / Chiudi tutto** per le categorie delle tab Simboli ed Emoji.

### Modificato
- Un oggetto creato dalla tab Simboli o Emoji non si chiama più "Testo": si chiama "Simbolo: Stella piena" o "Emoji 😂", ha un'icona propria nell'elenco oggetti e il pannello delle proprietà lo intitola "Simbolo" o "Emoji" (con il campo "Carattere").
- La modalità Estrudi (T) non agisce sulle forme con estrusione rotazionale, che non hanno un'altezza da trascinare. Il Guscio le tratta con la cavità scalata.

## [0.16.0] - 2026-10-07

### Aggiunto
- **Tab Emoji** nella libreria: 413 emoji in 12 categorie (Facce e gesti, Animali e fantasy, Piante e cielo, Cibo e bevande, Sport e giochi, Veicoli, Edifici e luoghi, Feste e regali, Abbigliamento, Musica e media, Oggetti e strumenti, Simboli), tratte dall'elenco fornito. Un clic aggiunge una forma Testo estrusa con quell'emoji nella versione monocromatica a contorno (Noto Emoji): le emoji a colori non hanno un contorno da estrudere, quindi vale il colore dell'oggetto. Le sequenze con genere o variante (come la persona che si allena o il mago) sono ridotte al glifo base neutro. Un test confronta il catalogo con l'elenco originale (457 voci, 44 ripetizioni, 413 uniche) e controlla che ogni emoji abbia il suo contorno.
- **SVG: lucchetto delle proporzioni** nella sezione Profilo 2D della barra di destra (attivo di default): con il lucchetto chiuso Larghezza, Profondità e la maniglia Ridimensiona (R) mantengono il rapporto del disegno; aperto, i due lati si cambiano separatamente. Lo stato si salva nel progetto.
- **SVG: slider Scala** in percentuale della dimensione del file (100% = come nel disegno originale): ridimensiona sempre in proporzione.

### Modificato
- Nella tab **Simboli** i gruppi sono accordion: si aprono e si chiudono con un clic sul titolo (con il numero di simboli) e lo stato si ricorda; con una ricerca in corso si aprono i gruppi con risultati. Vale anche per le categorie delle Emoji.
- Le tab della libreria hanno **la stessa altezza**: cambiando tab la sezione Oggetti sotto non si sposta più (il contenuto della tab scorre da solo).
- Un'emoji incollata con il selettore di variante o con la legatura ZWJ dà un solo glifo nel Testo.

## [0.15.0] - 2026-10-07

### Aggiunto
- **Nuovo** con la casella "Svuota anche la cronologia" nella finestra di conferma: se spuntata la timeline riparte da zero (e Ctrl+Z non ripristina nulla); senza spunta tutto resta annullabile come prima.
- **Libreria a tab** nella barra laterale sinistra: Forme 3D, Forme 2D e Simboli al posto delle sezioni una sotto l'altra. La tab aperta si ricorda dopo il ricaricamento; le frecce sinistra e destra passano da una tab all'altra.
- **Tab Simboli**: 166 simboli Unicode (frecce, stelle e forme, cuori e carte, segni, meteo e musica, matematica e lettere greche, oggetti) con l'anteprima del carattere, raggruppati e con una ricerca per nome. Un clic aggiunge una forma Testo estrusa con quel simbolo. I tre font di simboli (Noto Sans Symbols 2, Noto Sans Symbols, Noto Sans Math) contengono solo i glifi del catalogo; un test controlla che ogni simbolo abbia il suo glifo. Un testo con un carattere che il font scelto non ha ripiega sui font di simboli (e l'esportazione OpenSCAD include quei font).
- **Ultimi valori usati**: le misure inserite su una forma (dimensioni, raggi, altezza, segmenti, torsione, font e dimensione del testo, ...) e nei pannelli degli strumenti (raggio del raccordo, distanze dello smusso, distanza e tipo dello smusso angolare, spessori del Guscio) diventano il punto di partenza delle forme e degli strumenti nuovi. Si salvano in localStorage (`webcad:last`), si validano a ogni lettura e restano dentro i limiti della geometria scelta; nome, colore, posizione e contenuto del testo non si ricordano.
- **Dieci nuovi font** per il Testo, per un totale di venti in cinque gruppi nel menu: Sans (Poppins Bold, Varela Round), Serif (PT Serif Bold, Roboto Slab Bold, UnifrakturMaguntia), Display (Righteous, Stardos Stencil Bold), A mano (Caveat Bold) e Fantasia (Bangers, Press Start 2P). Sono nel precache della PWA, quindi l'installazione pesa qualche centinaio di KB in più.
- **Anteprima di Allinea e Specchia** nella vista 3D: passando sopra un pulsante della tendina (o con il focus) compaiono i box degli oggetti nella posizione finale, tratteggiati, e il piano su cui avviene l'operazione. Si toglie uscendo dal pulsante, con Esc o al clic.
- **Specchia** ha ora la stessa tendina di Allinea (X, Y, Z per Min, Centro, Max): il piano di specchio passa dal lato scelto dell'ingombro della selezione, non solo dal centro.

### Modificato
- **Caricamento a richiesta**: il chunk iniziale dell'app passa da 188 a 99 KB (da 61 a 32 KB compressi). Si scaricano solo quando servono: i pannelli di Raccordo, Smusso, Smusso angolare, Guscio e Misura, il corpo delle modali del menu (scorciatoie, novità, esportazione), l'elenco dei simboli, i lettori STL, 3MF e SVG (SVGLoader di three ha un chunk suo) e il generatore OpenSCAD. Se un file non si scarica (rete assente o nuova versione) compare una notifica invece di un errore.

### Rimosso
- Le sezioni richiudibili "Forme" e "Forme 2D" della 0.14.0, sostituite dalle tab.

## [0.14.0] - 2026-10-07

### Aggiunto
- **Allinea** nella barra strumenti (con due o più oggetti selezionati): una tendina con una riga per asse (X, Y, Z) e tre scelte (Min, Centro, Max) allinea gli oggetti al lato scelto dell'ingombro complessivo della selezione. Gli oggetti bloccati contano per l'ingombro ma non si spostano; è un solo passo di Annulla.
- **Specchia** nella barra strumenti: sceglie l'asse (X, Y o Z) e riflette gli oggetti selezionati rispetto al piano centrale della selezione. Lo specchio è memorizzato nell'oggetto (campo `mirror`, applicato prima della rotazione), quindi vale per ogni forma, testo, mesh importate e gruppi, e nel codice OpenSCAD esce come `mirror()`. Specchiare due volte lo stesso asse riporta l'oggetto com'era.
- **Misura** (pulsante righello, tasto I): due clic scelgono il punto di partenza e quello di arrivo e il pannello mostra la distanza in mm con le componenti ΔX, ΔY, ΔZ; la linea con la distanza compare anche nella vista 3D. I punti si agganciano da soli a vertici (angoli e intersezioni di spigoli), al punto medio degli spigoli, agli spigoli e alle superfici, con un marcatore di colore diverso per ogni tipo. Un terzo clic avvia una nuova misura; Esc chiude. Non modifica la scena.
- **Importa SVG** nel menu Importa (e con il trascinamento del file nella finestra): il disegno diventa una forma 2D estrusa (spessore iniziale 2 mm) con Larghezza, Profondità, Altezza, Torsione e Scala cima come le altre forme. Le unità del file sono millimetri (se l'SVG dichiara una misura fisica come `width="210mm"` con `viewBox` se ne tiene conto), i tracciati chiusi dentro altri tracciati diventano fori, le curve sono appiattite in segmenti e i tracciati senza riempimento si ignorano. Nel codice OpenSCAD esce come `polygon()`.
- Nella barra laterale sinistra le sezioni **Forme** e **Forme 2D** si aprono e si chiudono con un clic sul titolo; la scelta si ricorda anche dopo aver ricaricato la pagina (localStorage).

### Modificato
- Raccordo, Smusso, Smusso angolare e Guscio funzionano anche su oggetti specchiati: il gruppo del trattamento eredita lo specchio del pezzo.
- Il pulsante Importa del menu ora distingue le mesh (STL, 3MF) dai disegni SVG.

## [0.13.0] - 2026-10-07

### Aggiunto
- **Nove nuove forme 2D estrudibili** nella libreria: Anello (cerchio forato), Cuore, Stella a 5 punte, Stella a 6 punte, Uovo, Trapezio, Croce, Goccia e Mezzaluna. Ognuna ha Larghezza, Profondità e, dove serve, un parametro (foro dell'anello, raggio interno delle stelle, punta dell'uovo, larghezza della cima del trapezio, spessore delle braccia della croce e della luna), più Altezza, Torsione e Scala cima come le altre forme. Nel codice OpenSCAD escono come `polygon()`.
- **Testo**: una scritta estrusa con il font a scelta tra dieci di Google Fonts (Roboto Bold, Playfair Display Bold, Roboto Mono Bold, Bebas Neue, Anton, Oswald Bold, Pacifico, Lobster, Dancing Script Bold, Permanent Marker, licenza OFL, nell'app anche senza rete). Il testo si conferma con Invio o uscendo dal campo (Esc annulla), così ogni modifica è un solo passo di Annulla; la dimensione è quella di `text(size)` di OpenSCAD.
- Nel codice OpenSCAD il testo esce come `text()` con `use <Font.ttf>;` in testa (i file TTF stanno accanto al codice). **Esporta OpenSCAD** con del testo scarica uno ZIP con `webcad.scad` e i font usati, pronto da aprire in OpenSCAD.

### Modificato
- Il Guscio sulle nuove forme 2D usa la cavità scalata (non hanno una formula esatta come cerchio e quadrato).

## [0.12.0] - 2026-10-07

### Aggiunto
- **Nuovo** come primo pulsante della barra strumenti (tasto N): svuota la scena e chiede conferma se non è vuota; resta annullabile con Ctrl+Z.
- **Salva con nome…** nel menu. In Chrome ed Edge si apre la finestra del sistema dove scegliere nome e cartella; "Salva progetto" poi riscrive lo stesso file senza chiedere. Negli altri browser una finestra chiede il nome del file (che va nella cartella dei download). Il nome scelto si propone la volta dopo.
- Nell'elenco delle scorciatoie compaiono anche X (operandi in trasparenza) e N (nuovo).

### Modificato
- **Smusso angolare**: l'anteprima è sempre viva. Dopo il primo vertice gli slider sono attivi, e Maiusc+clic aggiunge o toglie altri vertici con l'anteprima che si aggiorna subito. Il pulsante Anteprima (e l'uso di Invio per mostrarla) non c'è più.

### Corretto
- Raccordi sulle facce del pezzo: il taglierino finiva esattamente sul piano della faccia e, per gli errori di arrotondamento, restava una lamina di materiale con lo spigolo vivo (una "linguetta" sugli angoli). Ora il taglio prosegue di 0,01 mm oltre le due estremità dei taglierini convessi, nella vista 3D e nel codice OpenSCAD. I file già salvati si correggono da soli.

## [0.11.0] - 2026-10-07

### Aggiunto
- **Timeline delle operazioni** sotto la vista 3D: un passo per ogni stato della cronologia (passati, corrente e annullati), con il nome dell'operazione ("Aggiungi Cubo", "Sposta Cubo", "Raccordo", "Guscio"...). Un clic su un passo ci salta direttamente, avanti o indietro, e una nuova modifica scarta i passi successivi. Le frecce a sinistra e a destra sono Annulla e Ripeti. La timeline vale per la sessione e si disattiva mentre è aperto uno strumento con anteprima.
- **Smusso angolare su più vertici**: Maiusc+clic aggiunge o toglie vertici dello stesso oggetto, poi Invio o il pulsante Anteprima. Tipo, distanza e segmenti sono uguali per tutti (la distanza non supera lo spigolo più corto tra quelli scelti). Il risultato è un solo gruppo Differenza con un taglierino per vertice e un solo passo di Annulla. Un clic semplice sceglie un solo vertice con anteprima immediata, come prima.
- Ogni pulsante della barra strumenti mostra in piccolo, in alto a sinistra, la lettera della sua scorciatoia; la barra è un po' più alta.
- **Operandi in trasparenza** (pulsante `#` a destra e tasto X), come il modificatore `#` di OpenSCAD: per l'oggetto selezionato mostra in rosso traslucido ciò che le booleane sottraggono o intersecano, i fori e la cavità del guscio.
- Appoggio automatico sul piatto dopo Unione, Differenza, Intersezione e Raggruppa. Cambiando misure o rotazione dal pannello la base dell'oggetto resta dov'era (sul piatto o impilata). Annulla resta un solo passo.

### Modificato
- Sposta: restano le frecce X, Y, Z e il quadrato del piano XY. La maniglia centrale libera e i piani XZ e YZ sono stati tolti, così lo Z cambia solo trascinando la freccia Z.

### Corretto
- Raccordi che si incontrano in un angolo: il secondo raccordo si fermava sulla linea di tangenza del primo e lasciava una pinna di materiale fino allo spigolo. Ora il taglierino prosegue fino all'angolo e l'incontro è quello di due cilindri, anche per uno smusso che incontra un raccordo. L'estensione è numerica: cambiando poi il raggio del primo raccordo il secondo non si riallinea da solo. Le scene già salvate vanno rifatte.
- All'avvio la scena ripristinata non è più un passo annullabile (Ctrl+Z non la svuota).
- Due smussi che si incontrano in un angolo lasciavano una pellicola a spessore zero oltre il secondo smusso (in WebCAD e in OpenSCAD): il piano di chiusura era complanare con la faccia del primo. Ora lo oltrepassa di 0,01 mm.

## [0.10.0] - 2026-10-06

### Aggiunto
- **Smusso angolare** (pulsante e tasto A): si fa clic vicino a un angolo e si sceglie il vertice più vicino al puntatore (evidenziato), non due superfici. Tipo **Piano** (taglio piatto a distanza d lungo ogni spigolo) o **Sferico** (calotta arrotondata tangente agli spigoli) con lo slider **Segmenti** (multipli di 4, come la sfera). Funziona su angoli convessi con tre o più spigoli (anche solidi dei dadi). Nel codice OpenSCAD esce come `hull()` di punti, con `sphere($fn)` sottratta per lo sferico.
- Guscio su solidi uniti, in tre livelli. **Prisma:** unioni, gruppi o differenze di prismi verticali della stessa altezza (due cubi affiancati, un cubo con un foro passante) usano la sezione dell'unione ristretta con un `offset` 2D ed estrusa: pareti uniformi anche ai giunti e attorno ai fori, nessuna parete interna. **Per figlio:** unioni con altezze diverse o coni hanno la cavità esatta di ogni solido (resta una parete interna al giunto). **Scalata:** il ripiego di prima per tutto il resto. Il pannello dice quale livello si usa.
- Test di andata e ritorno del file di progetto JSON: ordine, Raggruppa, nomi, blocchi, modi, guscio, smussi e angoli si conservano.

### Corretto
- Dopo Smusso, Raccordo o Guscio il gizmo di Sposta compariva nell'origine del mondo. Il gruppo del trattamento ora prende la posizione e la rotazione del pezzo. Le scene già salvate si sistemano all'apertura.
- Due smussi che si incontrano in un angolo: se si riduceva la misura del primo dopo aver creato il secondo, all'angolo restava del materiale, perché il piano che chiude il secondo smusso era salvato come numeri. Ora si ricalcola dalle misure correnti del primo, anche nel codice OpenSCAD.

## [0.9.0] - 2026-10-06

### Aggiunto
- **Guscio** (pulsante e tasto G): svuota il solido selezionato con uno spessore laterale e uno inferiore, con anteprima dal vivo (OK o Invio conferma, Annulla o Esc annulla). La cima resta sempre aperta.
- Il guscio è un gruppo con il solido e le sue misure: la cavità si ricalcola da sola se si cambia il solido e gli spessori si modificano dalla sidebar di destra. Nel codice OpenSCAD esce come `difference()` tra il solido e la sua cavità.
- Cubo, cilindro, cono, cerchio e quadrato 2D (senza torsione né scala) hanno pareti di spessore esatto, anche con angoli arrotondati e sui lati inclinati del cono. Le altre forme (sfera, toro, solidi dei dadi, mesh, gruppi) usano come cavità l'oggetto rimpicciolito: pareti approssimate, e il pannello lo segnala.
- **Segmenti del raccordo**: come per i cerchi, da 3 a 256 (predefinito 64), nel pannello dello strumento e nella sidebar di destra.
- **Doppio clic** su un oggetto: lo seleziona e passa a Sposta (W). Il clic singolo continua a selezionare soltanto.

### Modificato
- Più commenti nel codice sulle operazioni di raggruppamento, unione, intersezione, differenza, smusso e raccordo.

## [0.8.0] - 2026-10-06

### Aggiunto
- **Raccordo** (pulsante e tasto F) e **Smusso** (pulsante e tasto S) tra due superfici piane, con un pannello come in Fusion 360: si fa clic su due superfici (evidenziate al passaggio del mouse), il raggio o le distanze si regolano con anteprima dal vivo, OK conferma ed Esc annulla.
- Smusso a distanza uguale, a due distanze oppure con distanza e angolo.
- Funziona su spigoli convessi (toglie materiale) e concavi (ne aggiunge), anche con estremità oblique, su oggetti ruotati, dentro gruppi e su mesh importate.
- Il raccordo è un oggetto dell'elenco (gruppo Differenza o Unione con un "Raccordo" o "Smusso") e si modifica dalla sidebar di destra.
- Nel codice OpenSCAD esce come estrusione di una sezione 2D dentro `difference()` o `union()`, senza `polyhedron` né `minkowski`. Il volume del codice reso con OpenSCAD coincide con quello del kernel.

### Limiti
- Solo superfici piane e spigoli rettilinei; niente angoli con tre raccordi né raggio variabile.
- Se il pezzo cambia dopo il raccordo, il taglierino non si ricalcola da solo.

## [0.7.0] - 2026-10-06

### Aggiunto
- **Unisci** (pulsante e tasto U): unione booleana vera, con `union()` nel codice OpenSCAD e una sola mesh nell'export. Ha un'icona a parte da Raggruppa.
- Trascinamento nell'elenco degli oggetti: si riordinano, si mettono dentro un gruppo (anche a più livelli) e si portano fuori. La posizione nel mondo non cambia e un solo Annulla riporta tutto com'era.
- Rinomina dall'elenco con doppio clic o F2 (Invio conferma, Esc annulla).
- Il tipo del gruppo è visibile: icona e nome nell'elenco, e titolo "Differenza", "Unione", "Intersezione" o "Gruppo" nella sidebar di destra.
- Alt+clic sulla vista 3D seleziona il singolo oggetto di un gruppo.
- `docs/valutazione-raccordi.md`: valutazione della fattibilità dei raccordi tra due superfici (stile Fusion 360), con uno spike nei test.

### Modificato
- **Raggruppa** non fonde più gli oggetti: restano separati, con il colore originale, e per OpenSCAD e per l'export (3MF) sono oggetti distinti. Il gruppo serve a muoverli insieme. Un clic su un oggetto raggruppato seleziona il gruppo.
- Un foro messo in un Raggruppa diventa un solido: i fori hanno effetto solo dentro Unione, Differenza e Intersezione.
- Le scorciatoie F2 e U sono nell'elenco delle scorciatoie.

### Nota
- I gruppi salvati con le versioni precedenti restano unioni: erano già operazioni booleane.

## [0.6.0] - 2026-10-06

### Aggiunto
- Raggi per asse: Raggio Y per cerchio, cilindro e cono, Raggio Y e Raggio Z per la sfera. Le forme possono essere ovali (ellissi ed ellissoidi) con slider nel pannello, tooltip e maniglie di Ridimensiona indipendenti per asse. Il codice OpenSCAD usa `scale()`.
- Import dei file 3MF di Bambu Studio (e Orca Slicer): le mesh stanno in file separati dentro il pacchetto e prima il file veniva rifiutato. Ogni parte diventa una mesh con il suo nome, e il colore del filamento se indicato.
- Scorciatoie C (codice), D (tema) e M (menu), con i tasti nei tooltip di tutti i pulsanti della barra in alto.

### Modificato
- Il codice OpenSCAD va a capo dopo ogni comando (un modificatore per riga, elenchi lunghi su più righe). Vale anche per il file `.scad` scaricato.
- Ridimensiona (R) non arrotonda più gli assi che non cambiano.
- Con una modale aperta restano attive solo le scorciatoie che chiudono il codice (C e Ctrl+J).

### Corretto
- Il piatto nascosto (tasto P) restava disegnato finché non si orbitava la vista: la scena non veniva ridisegnata. Ora il piatto cambia aspetto subito, e un test confronta le immagini mostrate.

## [0.5.0] - 2026-10-06

### Aggiunto
- Tema chiaro con tinte pastello, predefinito, e interruttore sole/luna nella barra in alto (la scelta resta salvata). Il tema scuro resta disponibile. Il contrasto dei colori è verificato da un test.
- Il codice OpenSCAD si apre in una modale all'80% della finestra, con numeri di riga, indentazione e colori per funzioni, parole chiave, numeri, parametri e commenti.
- Pulsante e tasto P per il piatto di stampa: visibile, senza la base piena (restano griglia e bordo), nascosto.

### Modificato
- Le nuove forme compaiono in cima all'elenco degli oggetti e ricevono un colore casuale diverso dalla forma precedente.
- Il pulsante del codice mostra solo l'icona. Ctrl+J apre e chiude la modale.
- L'icona del Decaedro è un poligono a 10 lati.
- Con una modale aperta le scorciatoie da tastiera non agiscono più sulla scena (prima Canc cancellava la selezione).
- Il colore del pulsante primario e dell'avviso del tema scuro è leggermente più scuro, per il contrasto.

### Rimosso
- La scheda Codice della sidebar destra.

## [0.4.0] - 2026-10-06

### Aggiunto
- Slider con tooltip per posizione, rotazione, dimensioni, profilo 2D ed estrusione nella sidebar destra, accanto al campo numerico. Trascinare uno slider aggiorna la scena dal vivo e vale un solo passo di Annulla.
- Solidi dei dadi: Ottaedro (d8), Decaedro (d10), Dodecaedro (d12) e Icosaedro (d20). La misura è la distanza tra due facce opposte e il solido poggia su una faccia.
- Raccordo degli spigoli e dei vertici per i solidi dei dadi e degli angoli per il Cerchio con N lati (anche nel codice OpenSCAD).
- Modalità Ridimensiona (R) ed Estrudi (T) nella barra in alto: si trascinano le maniglie nella vista 3D e la base resta sul piatto. Estrudi agisce sulle sole forme 2D e cambia solo l'altezza.
- Nel menu: Nuovo progetto, Apri progetto, Salva progetto e la finestra Scorciatoie da tastiera.
- Badge "nuovo" sul menu e sulla voce Novità dopo un aggiornamento.

### Modificato
- La Scatola si chiama Cubo.
- I preset dei lati sono 3, 4, 5, 6, 8 e 12 (tolti 16 e 64); lo slider Segmenti resta.
- Nuovo, Apri e Salva progetto passano dalla barra in alto al menu.
- Durante un calcolo del kernel i risultati intermedi si mostrano subito, per un'anteprima fluida.

## [0.3.0] - 2026-10-06

### Aggiunto
- Menu hamburger nell'header con le voci Importa, Esporta, Novità e About, ognuna in una finestra modale. Esporta offre STL, 3MF e codice OpenSCAD; Novità mostra questo changelog.
- Numero di versione nel titolo della pagina e accanto al nome nell'header.
- Modalità Seleziona (tasto Q): selezionare un oggetto non mostra più il gizmo.
- Controllo degli aggiornamenti anche quando la scheda torna visibile.

### Modificato
- La modalità iniziale è Seleziona: il gizmo di spostamento compare solo premendo W (o il pulsante Sposta).
- Quando è disponibile una nuova versione compare una finestra bloccante con "Aggiorna ora" e "Salva progetto", al posto del banner con "Più tardi".
- I pulsanti Importa, STL e 3MF a destra dell'header passano nel menu hamburger.

## [0.2.0] - 2026-10-06

### Aggiunto
- Import di file STL (binario e ASCII) e 3MF (unità, componenti, trasformazioni e colori), con pulsante Importa e trascinamento nella finestra. Le mesh devono essere solidi chiusi: gli altri file vengono rifiutati con un messaggio che spiega il motivo.
- Blocco degli oggetti (tasto L): un oggetto bloccato non si sposta, ruota, elimina, raggruppa né cambia nelle misure. Resta selezionabile e modificabile nel nome e nel colore.
- Barra flottante con due o più oggetti selezionati: Unione, Differenza (primo selezionato meno gli altri, con "Scambia base") e Intersezione.
- Forme 2D estrudibili (cerchio e quadrato) con altezza, torsione e scala della cima.
- Numero di lati configurabile per cerchio, cilindro, cono e toro (da 3 a 256, come `$fn` di OpenSCAD) con preset: 3 triangolo, 4 quadrato, 5 pentagono, 6 esagono, 8 ottagono.
- Raggio di arrotondamento degli spigoli della scatola e degli angoli del quadrato 2D.
- Pulsante e tasto B per appoggiare gli oggetti selezionati sul piatto.
- Notifiche e finestra di conferma integrate nell'interfaccia, al posto di `alert` e `confirm`.
- Test end-to-end con Playwright (`npm run test:e2e`), compreso il trascinamento reale del gizmo.
- Numero di versione nella barra di stato e `CHANGELOG.md`.
- Valutazione degli smussi con benchmark in `docs/valutazione-smussi.md`.

### Modificato
- Il progetto JSON passa alla versione 2 e include le mesh importate; i file della versione 1 si aprono ancora.
- Il numero minimo di lati scende da 8 a 3 (la sfera resta a multipli di 4).
- Il codice OpenSCAD generato comprende `linear_extrude`, `offset`, `hull` e `import` per le nuove forme.

## [0.1.0] - 2026-10-05

Primo POC.

### Aggiunto
- Primitive 3D (scatola, cilindro, cono, sfera, toro) con parametri numerici in mm.
- Oggetti solidi e fori, gruppi con unione e intersezione, calcolo booleano con manifold-3d in un Web Worker.
- Viewport con piatto 256 × 256 mm, orbita, gizmo di spostamento e rotazione con snap, frecce da tastiera.
- Annulla e ripeti, outliner, pannello delle proprietà, barra di stato con ingombro, volume e validità della mesh.
- Export STL binario e 3MF (un oggetto per ogni solido, con colore).
- Pannello del codice OpenSCAD in sola lettura, mostrabile e nascondibile.
- Salvataggio automatico in IndexedDB e import/export del progetto in JSON.
- PWA con uso offline e avviso di nuova versione.
