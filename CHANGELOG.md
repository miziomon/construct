# Changelog

Tutte le modifiche rilevanti di Construct sono documentate in questo file.

Il formato segue [Keep a Changelog 1.1.0](https://keepachangelog.com/it-IT/1.1.0/) e il progetto
adotta il [Semantic Versioning](https://semver.org/lang/it/). Finché la versione maggiore è 0, le nuove
funzionalità incrementano la minor (0.x.0) e le correzioni la patch (0.x.y).

## Come si rilascia una versione

1. Sposta le voci di `[Non rilasciato]` in una nuova sezione `[x.y.z] - AAAA-MM-GG`.
2. Aggiorna `version` in `package.json`.
3. Verifica con `npm run typecheck && npm test && npm run build`.
4. Commit `chore(release): x.y.z` e tag annotato `vx.y.z` (`git tag -a vx.y.z -m "Construct x.y.z"`).

I messaggi di commit seguono i [Conventional Commits](https://www.conventionalcommits.org/it/v1.0.0/)
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).

## [Non rilasciato]

## [0.60.0] - 2026-10-15

### Aggiunto
- Profilo di Bézier, fase 1 (modello, kernel, codice OpenSCAD e ritorno): nuovo tipo di forma 2D `path` con contorni di nodi di Bézier (maniglie relative, tipo di nodo, più contorni con fori pari-dispari), estrusione lineare e rotazionale. `src/scene/bezier.ts` campiona le curve entro una tolleranza (predefinita 0,05 mm, tetti di punti con raddoppio deterministico), calcola area e autointersezioni e valida i dati non fidati; `pathContours` li porta a Larghezza × Profondità riusando `svgContours`, e in rotazione chiude sull'asse i contorni aperti.
- Il codice OpenSCAD del Profilo scrive un commento `// construct:path` con i nodi sulla riga prima di `polygon()`; rileggendo il file, se il poligono coincide ancora (entro 0,001 mm) con i nodi, torna un Profilo con gli stessi contorni, altrimenti resta un Poligono. Dati rovinati o oltre i limiti (600 nodi) non causano errori.
- `store.addPath` crea un Profilo in un solo passo ("Aggiungi Profilo"); nelle Proprietà si mostra con Larghezza, Profondità, lucchetto delle proporzioni e Scala. In rotazione lo slider Raggio non c'è: il raggio è la x del centro del disegno. In rotazione, un Profilo tutto a destra dell'asse non ha l'`intersection()` di ritaglio nel codice. Non c'è ancora un pulsante in libreria né un editor di disegno (fase 2).

## [0.59.3] - 2026-10-14

### Corretto
- Studio dei profili con curve di Bézier: tolta l'ipotesi del doppio clic in vista per "Modifica profilo" (oggi passa alla modalità Sposta, `SceneObject.tsx:327`) e sostituita da menu contestuale e pulsante nelle proprietà; il ritorno da OpenSCAD si appoggia al precedente del commento dei piatti nel lexer (`parse.ts`); la descrizione dell'anteprima approssimata corrisponde al prototipo; le righe su Tinkercad e Blender dichiarano ciò che le fonti confermano (aggiunte le fonti di Blender in `docs/fonti.md`); la domanda sul profilo oltre l'asse è neutra.
- CHANGELOG 0.59.2: le schermate del prototipo sono cinque, non sei.

## [0.59.2] - 2026-10-14

### Aggiunto
- Documentazione: studio di fattibilità del disegno di profili con curve di Bézier (`docs/studio-profili-bezier.md`): confronto con Fusion, Shapr3D, Figma, Inkscape e Tinkercad, modello dati del nuovo tipo di forma `path` (nodi con maniglie relative, più contorni e fori, profili aperti chiusi sull'asse), campionamento adattivo per tolleranza, coerenza con kernel e codice OpenSCAD, UX della modale (Penna, Seleziona, forme base, import SVG con curve), tre disposizioni dell'interfaccia (A consigliata), rischi, fasi e stima.
- Prototipo interattivo `docs/prototipi/profilo-bezier.html`: modale funzionante con Penna, nodi e maniglie, fori, import SVG, annulla e ripeti e anteprima 3D approssimata (three.js, non il kernel); cinque schermate in `docs/images/profilo-bezier-*.png`.
- `docs/fonti.md`: fonti della ricerca sugli strumenti di disegno delle curve.

### Modificato
- `docs/da-fare.md` (funzione 6): rimando allo studio e al prototipo.

## [0.59.1] - 2026-10-14

### Modificato
- Documentazione: in `docs/da-fare.md` (Idee minori) sono state aggiunte tre idee emerse con la 0.59.0: parametri del Pattern ereditati dal precedente, "Cambia faccia" nelle proprietà del gruppo Pattern e miniatura della timeline da ingrandire o salvare.

## [0.59.0] - 2026-10-14

### Aggiunto
- **Timeline: miniatura isometrica nel tooltip.** Passando il mouse su un passo della timeline, sotto il nome dell'operazione compare una miniatura della scena in quel punto, ripresa con la vista isometrica (stesse luci e inquadratura dell'immagine con le 4 viste, sfondo trasparente). Le miniature si scattano da sole a ogni calcolo finito del kernel; se per un passo manca (per esempio dopo un salto di più passi) il worker calcola quella scena al volo, senza toccare la cache della scena in vista, e il tooltip mostra "Anteprima…" finché non è pronta. Con uno strumento aperto (Raccordo, Guscio, Pattern...) o con il kernel occupato il tooltip resta solo testo. La miniatura mostra il piatto attivo del passo.
- **Pattern su facce inclinate.** "Scegli faccia" accetta qualsiasi faccia piana, anche obliqua: il disegno si genera nel riferimento di quella faccia. Il nome della faccia compare nel pannello (+Z, −X... oppure "inclinata (55° da +Z)").
- Il Pattern si può applicare più volte: un secondo Pattern su un oggetto già forato avvolge il primo in un nuovo gruppo, ognuno con la sua faccia.

### Modificato
- **Pattern: una sola faccia, scelta con il clic.** Come nel Guscio, "Scegli faccia" mostra il pezzo intero e un clic sulla faccia la sceglie e chiude la scelta; sono stati tolti i sei pulsanti ±X, ±Y, ±Z e la scelta di più facce. Per forare altre facce si applica di nuovo il Pattern. I progetti salvati con più facce restano validi e si leggono come prima ("N facce" nel pannello).
- Con una faccia inclinata la regione da forare è sempre il contorno della faccia (la silhouette del pezzo lungo la normale invaderebbe le facce vicine) e il taglio parte da quella faccia soltanto: "Entrambe" non vale e il selettore non compare. Il codice OpenSCAD segue la stessa regola. Le facce sugli assi restano come prima.

## [0.58.0] - 2026-10-14

### Aggiunto
- **Guscio: la faccia aperta la sceglie l'utente.** Il pannello mostra la faccia aperta (all'inizio la cima, come prima) e il pulsante **Scegli faccia**: la vista mostra il solido intero, la faccia sotto il puntatore si evidenzia e un clic la lascia aperta. Valgono le facce piane perpendicolari a un asse dell'oggetto (±X, ±Y, ±Z, nel sistema locale, quindi anche con l'oggetto ruotato); le facce oblique o curve sono rifiutate con un avviso. Esc interrompe la scelta senza chiudere lo strumento, Invio durante la scelta non fa nulla. La scelta si legge e si vede anche nelle proprietà del guscio e nel commento del codice OpenSCAD.
- Cavità esatta sulla faccia scelta: il cubo su tutti e sei i lati; cilindro, cono, forme 2D dritte e profilati aperti in cima o sul fondo (cavità specchiata). Su tutte le altre combinazioni (cilindro aperto di lato, sfera, mesh, unioni con una faccia diversa dalla cima) si usa la cavità scalata, ora centrata sulla faccia opposta a quella aperta.
- Un cono che si allarga verso l'apertura (per esempio la base aperta di un cono a punta) ora si svuota: la cavità comincia dove il suo raggio si annulla e la punta resta piena, invece di dare l'errore "pareti troppo spesse".

### Modificato
- Il campo **Inferiore** del guscio si chiama **Fondo** (la parete opposta alla faccia aperta) e i messaggi d'errore lo dicono di conseguenza. I progetti salvati restano validi: `ShellParams.open` è facoltativo e, se manca, la faccia aperta è la cima.

### Test
- Unit test della faccia aperta (cubo ±X e ±Y, cilindro e cono sul fondo, ripiego scalato su ±Y, unioni, limiti sull'asse aperto, codice OpenSCAD) e un e2e della scelta con il clic e di Esc durante la scelta.

## [0.57.0] - 2026-10-13

### Modificato
- **Lucchetto delle proporzioni con misure legate.** Se una misura di una forma è legata a un parametro (posizione e rotazione non contano), il lucchetto delle proporzioni non può valere: nelle proprietà e accanto alle quote resta **aperto e disattivato**, con un tooltip che lo spiega ("togli il parametro per riattivare il lucchetto"), e ogni misura libera cambia da sola, anche con il gizmo e le quote. Il valore del lucchetto resta salvato: tolto il parametro, il lucchetto torna com'era.

### Test
- `isRatioLocked` e `hasBoundDimension` (con e senza misure legate, SVG compresi) e un e2e del lucchetto disattivato, della misura legata ferma e del ritorno dopo "Togli parametro".

## [0.56.1] - 2026-10-13

### Modificato
- **"Visualizza tutti" per gli avvisi ignorati.** Accanto a "Ignorati (N)" c'è ora il pulsante **Visualizza tutti**, sempre visibile anche con l'elenco chiuso, che rimette tutti gli avvisi ignorati (prima si trovava solo dentro l'elenco aperto, come "Ripristina tutti").

## [0.56.0] - 2026-10-13

### Modificato
- **Avvisi chiusi all'avvio.** La sezione Avvisi della colonna destra parte chiusa e si apre solo quando lo decide l'utente (intestazione o contatore nella barra di stato).
- **Parametri a sinistra.** La scheda Parametri (elenco in sola lettura, con il pulsante per la finestra di gestione) torna sulla barra sinistra, accanto a Oggetti e Piatti; la colonna destra ha di nuovo solo le Proprietà e gli Avvisi.
- **Anteprima del ridimensionamento con campi legati.** Trascinando il gizmo di ridimensionamento (anche quello proporzionale su tutti gli assi) di un oggetto con campi legati a un parametro, l'anteprima mostra già il risultato del rilascio: gli assi che dipendono da campi legati restano fermi e gli altri scalano (prima l'oggetto si allargava su tutti gli assi durante il trascinamento e tornava corretto solo al rilascio). Vale per forme 3D e profili 2D con una misura per asse; per le altre forme si ferma l'asse che cambierebbe solo campi legati.

### Test
- `previewScale`: senza campi legati, lato legato (anche con proporzioni bloccate), cilindro con raggio o altezza legati; e2e aggiornati alla scheda a sinistra e alla sezione Avvisi chiusa.

## [0.55.0] - 2026-10-13

### Aggiunto
- **Icona fx nell'elenco degli oggetti.** Un oggetto con campi legati a un parametro porta l'icona fx nella sua riga; il tooltip elenca i parametri usati.
- **Nuovo parametro dal selettore.** Il selettore del parametro ha "Nuovo parametro…" (e "Crea un parametro" quando non ce ne sono): nome e valore, con controllo di nomi non validi, doppi e valori che non si calcolano; il parametro creato è subito scelto nella formula.
- **Seleziona chi usa un parametro.** Nella scheda Parametri a destra, un clic sul nome del parametro seleziona nella vista gli oggetti che lo usano (con un avviso se nessuno lo usa).
- **Rinomina con anteprima.** Rinominare un parametro usato dalla finestra Parametri chiede conferma elencando gli oggetti e i parametri le cui formule vengono aggiornate; la riga mostra anche "usato da" con i nomi.

### Corretto
- Premendo Invio nel nome di un parametro usato, il tasto si ripeteva sul pulsante della conferma e la annullava subito.

### Test
- `paramsUsedBy` e `usersOf`; e2e della creazione al volo (anche nomi rifiutati), dell'icona fx, della selezione dal nome e della rinomina con conferma e annullamento.

## [0.54.0] - 2026-10-13

### Aggiunto
- **Ignora un avviso.** Ogni avviso di stampabilità ha un'icona per ignorarlo; finisce nell'elenco **Ignorati (N)** in fondo alla sezione, da cui si ripristina uno alla volta o tutti ("Ripristina tutti"). La scelta sta nel progetto (`ignoredWarnings`, tipo e oggetto dell'avviso), si annulla con Ctrl+Z e gli avvisi ignorati non contano nel contatore né si evidenziano.
- **Barra sinistra ridimensionabile.** Una maniglia tra la libreria e la sezione Oggetti/Piatti si trascina per cambiarne le altezze (da 25% a 80% della barra); con il fuoco funzionano le frecce su e giù, Home ed End, e il doppio clic riporta alla misura iniziale. La misura si ricorda nelle preferenze.
- **Finestra Parametri.** Aggiungere, modificare ed eliminare i parametri avviene in una finestra grande come la documentazione (menu, voce Parametri…, o pulsante Gestisci parametri…).
- **Scheda Parametri a destra.** La barra destra ha le schede Proprietà e Parametri; la seconda elenca i parametri in sola lettura (nome, formula, valore, uso).
- **Selettore del parametro.** Un doppio clic sul nome di un campo nel pannello Proprietà apre un piccolo selettore con i parametri e la riga Formula (anche un calcolo come `2 * spessore`), con anteprima del valore, Applica, Annulla e, per un campo già legato, **Togli parametro**.

### Modificato
- **Campi legati non modificabili.** Un campo legato a un parametro non mostra più lo slider né il campo: al loro posto l'icona **fx** con il valore, non editabile (la formula è nel tooltip). Non cambia nemmeno con il gizmo, le quote o il ridimensionamento proporzionale (tasto R): quei campi restano com'erano e gli altri scalano; un avviso lo spiega (al massimo ogni 3 secondi). Prima la modifica a mano scioglieva la formula.
- I campi numerici non accettano più una formula con i parametri scritta a mano (si usa il selettore); i calcoli senza parametri (`10 / 2`) restano.
- La scheda Parametri esce dall'Outliner (restano Oggetti e Piatti).

### Test
- Campi legati che non cambiano (patch, vettori, oggetti annidati, scala proporzionale), Togli parametro, e2e della finestra Parametri e del selettore (anche con formula non valida o senza parametri), del separatore (mouse, tastiera, persistenza), delle schede a destra e di Ignora e Ripristina.

## [0.53.0] - 2026-10-13

### Aggiunto
- **Pareti sottili.** Il kernel taglia ogni oggetto in 24 sezioni per asse (X, Y e Z) e da ogni sezione toglie, con un'apertura morfologica (erosione di metà parete e dilatazione), ciò che è più stretto della **parete minima** (0,8 mm di default, modificabile dalle Impostazioni). Ciò che sparisce è una parete sottile: l'avviso dice dove ("Pareti sotto 0,8 mm su «Scatola» (quota Z 2–5 mm, 4 sezioni)") e il clic mostra nella vista le zone come scatole traslucide. Le punte e le curve non danno falsi allarmi (si ignora ciò che è sotto 0,5 mm²).
- **Parti staccate e sospese.** Dentro un oggetto che per il resto sta sul piano, il kernel separa le parti non connesse (`decompose`) e segnala quelle che non toccano il piano né stanno sopra un'altra parte ("Una parte staccata e sospesa in «Lampada»").
- **Analisi nel worker.** Il kernel ha il nuovo metodo `analyze`, richiamato 1,2 secondi dopo l'ultima modifica e a calcolo finito; l'esito di ogni oggetto si ricorda per chiave geometrica e parete minima, quindi dopo una modifica si rianalizzano solo gli oggetti cambiati. Un giro che supera i 6 secondi si ferma e un avviso dice che il controllo è incompleto.
- **Impostazione Parete minima** (0,1-5 mm) nella sezione Stampabilità.

### Modificato
- Il ponte di prova `window.__construct` espone anche l'`ui` store (solo nella build e2e).

### Test
- Kernel su geometria reale: blocco pieno, lastra sottile in X e in Z con le quote giuste (verifica del passaggio dalle sezioni ruotate al mondo), parete al limite, guscio da 2 mm e da 0,5 mm, memoria dell'analisi, parti sospese e impilate; avvisi (testi, singolare, oggetti spariti, ordine); e2e con parete sottile (evidenziazione e cambio della parete minima) e parte staccata.

## [0.52.0] - 2026-10-13

### Aggiunto
- **Sezione Avvisi di stampabilità.** In fondo alla colonna destra, sotto le proprietà, un elenco richiudibile dei problemi di stampa, con un contatore ("3 avvisi", rosso se c'è un errore) nella barra di stato che apre la sezione. Un clic su un avviso seleziona l'oggetto. I controlli leggono le mesh già calcolate dal kernel e si aggiornano 0,4 secondi dopo l'ultima modifica, così non rallentano gli slider.
- **Controlli.** Errori: mesh non valida, oggetto che affonda sotto il piano ("affonda sotto il piano di stampa di 5 mm"), oggetto fuori dal volume di stampa con lo scarto per asse ("esce dal volume di stampa (X +12 mm)", Z oltre l'altezza utile) e formule o parametri che non si calcolano. Attenzioni: oggetto vuoto, oggetto sospeso (non tocca il piano né un altro oggetto) e **sbalzi**, cioè le superfici rivolte in basso con inclinazione dalla verticale oltre l'angolo scelto, con la loro area ("Sbalzi oltre 45° su «Gancio» (38 mm²)"). Non contano la faccia appoggiata al piano, quella sulla cima di un altro oggetto, i fori e le superfici sotto 1 mm².
- **Evidenziazione degli sbalzi.** Il clic su un avviso di sbalzo disegna le superfici coinvolte nella vista 3D (arancione, nuovo colore `warning` nelle palette dei due temi); un secondo clic le nasconde.
- **Impostazioni, sezione Stampabilità.** Interruttore dei controlli, angolo di sbalzo (20-80°, 45° di default) e altezza utile della stampante (256 mm di default, il piano non aveva un'altezza).

### Test
- Controlli su mesh sintetiche (cubo appoggiato, sospeso, impilato, sotto il piano, fuori piano su X e Z, mesh non valida o vuota, fori, angoli di sbalzo, formule errate, ordine degli avvisi) e tre test e2e: avvisi e contatore, evidenziazione e impostazione, formula che non si calcola.

## [0.51.0] - 2026-10-13

### Aggiunto
- **Parametri e formule.** Nuova scheda **Parametri** accanto a Oggetti e Piatti: variabili del progetto con nome, formula, nota e valore calcolato (`spessore = 2`, `altezza = 2 * spessore`), valide per tutti i piatti. I nomi sono variabili OpenSCAD valide (niente accenti né parole riservate); il pannello segnala nomi doppi, riferimenti mancanti e circolari. Eliminare un parametro usato chiede conferma e lascia i campi con il loro valore.
- **Formule nei campi numerici.** Posizione, rotazione, dimensioni di forme 3D e profili 2D, altezza di estrusione, Guscio, Ripetizione, Raccordo e Smusso accettano un numero, un calcolo (`10 / 2`) o una formula con i parametri (`2 * spessore + 1`), con gli operatori, `PI`, `min`, `max`, `abs`, `sqrt`, `round`, `floor`, `ceil`, le funzioni trigonometriche in gradi e il condizionale `?:`, con la stessa sintassi delle espressioni OpenSCAD. Il campo legato mostra il riquadro **fx** e la formula al fuoco; cambiando il parametro si ricalcola e l'oggetto si ridimensiona, con la base che resta sul piatto. Scrivere un numero a mano o usare gizmo, slider e quote scioglie la formula del campo (con un avviso).
- **Codice OpenSCAD con variabili.** I parametri escono in testa come variabili, in ordine di dipendenza e nel blocco `/* [Parametri] */` del Customizer, con la nota come commento; i campi legati usano i nomi (`cube([20, 20, (2 * spessore)])`, `for (i = [0 : copie - 1])`). Dove il valore è derivato (posizione dentro un Raggruppa, Raccordi e Smussi, cavità del Guscio) esce il numero. Una formula con un parametro rotto esce come numero, così il file resta valido. Il codice esportato si rilegge con gli stessi valori.

### Modificato
- Il formato del file di progetto passa alla **versione 5** (`params` nella scena, `exprs` nei nodi); i progetti precedenti si aprono senza cambiamenti.
- `NumberField` e `SliderField` hanno le proprietà opzionali `path` e `integer`; fuori dal pannello Proprietà (Impostazioni, strumenti) i campi restano numerici, ma accettano anche un calcolo senza parametri.

### Test
- Formule (precedenza, funzioni, errori, istruzioni estranee), nomi, ordine di dipendenza, cicli, rinomina, ricalcolo con limiti, un solo passo di Annulla, scioglimento della formula, codice generato e rilettura, versione 5 del file; e2e con parametro, formula nel campo, ricalcolo, codice e Annulla.

## [0.50.0] - 2026-10-13

### Aggiunto
- **Connettori di Dividi.** Il pannello ha una sezione **Connettori** per rimontare le due metà dopo la stampa. Il tipo **Perno** unisce un maschio a una metà (a scelta la prima o la seconda) e scava la sede nell'altra; il tipo **Spine** fa un foro in ciascuna metà e crea un oggetto "Spine" a parte, con le spine sdraiate sul piatto accanto al pezzo (lunghe il doppio della profondità). La forma è **tonda** (cilindro a 48 lati) o **quadrata**. Si imposta diametro o lato, **profondità**, **tolleranza**, **numero**, **distanza** tra i centri, la direzione della **fila** (uno dei due assi del piano) e lo spostamento del centro della fila rispetto al centro del taglio, su entrambi gli assi del piano. Funziona anche con il piano inclinato: i connettori restano perpendicolari al piano.
- **Tolleranza per l'incastro.** Perno e spina hanno la misura scelta; sede e fori sono più larghi del doppio della tolleranza (predefinita 0,2 mm) e più profondi della tolleranza, così l'incastro entra anche dopo la stampa. Il perno affonda di 0,5 mm nella propria metà e la sede sfora di 0,5 mm oltre il piano, per non lasciare facce coincidenti né pellicole.
- **Avviso del kernel.** Se un connettore (con la sua tolleranza) esce dal pezzo, il pannello lo dice ("Il connettore 2 esce dal pezzo") e nella vista 3D la sagoma del connettore diventa rossa. Non blocca OK. Le sagome, sulla lastra del piano, mostrano sempre posizione e misura di perno e sede.
- Le ultime misure usate (forma, diametro, profondità, tolleranza, numero, distanza) si ricordano per la prossima volta; il tipo riparte sempre da Nessuno.

### Modificato
- Le metà con connettori sono gruppi **Unione** (intersezione con il cubo di taglio, più perni, meno sedi): restano parametriche e il codice OpenSCAD è un `difference()` con `cylinder` o `cube`, senza nuovi tipi di nodo. Con tipo Nessuno il risultato è identico a prima.
- Il pannello di Dividi scorre se è più alto della vista.

### Test
- Volumi esatti di perno e sede (tondi e quadrati), Perno sulla seconda metà, Spine, fila e spostamenti, piano inclinato, pezzo ruotato, codice OpenSCAD, misure non valide e il controllo `fitInside` del kernel; un test e2e con Perno, avviso, Spine, Esc e un solo passo di Annulla.

## [0.49.1] - 2026-10-13

### Modificato
- **`docs/da-fare.md` aggiornato alla 0.49.0.** L'elenco di ciò che c'è già comprende profilati, Dividi (anche inclinato), piatti, viste, Nascondi, Sdraia, modelli di esempio e immagine delle 4 viste; il punto 4 (Dividi) non cita più il piano inclinato tra le cose mancanti; nelle idee minori compaiono i connettori di Dividi, le opzioni dell'immagine, Nascondi nei gruppi e altri modelli di esempio.

## [0.49.0] - 2026-10-12

### Aggiunto
- **Dividi con un piano inclinato.** Oltre all'asse e alla quota, il pannello ha ora l'**angolo** (da −90° a 90°) e l'asse attorno a cui il piano ruota (uno dei due diversi dall'asse del piano; passa da solo all'altro se cambi asse del piano): con 45° si taglia in diagonale. Il piano passa dal punto scelto (il centro dell'ingombro alla quota indicata) e l'anteprima 3D mostra la lastra inclinata. Il cubo di taglio è ruotato (nel codice un `cube` dentro `rotate([0, 45, 0])`), quindi le due metà restano parametriche. Con angolo 0 il risultato è identico a prima.
- **Dividi nella documentazione dell'app e nel tooltip.** La modale Documentazione elenca Dividi (sezione Modificare, con una nota sull'angolo) e il tooltip del pulsante ha l'immagine di esempio.
- **Opzioni dell'immagine delle 4 viste.** Esporta → Immagine apre un passo con lo **sfondo** (come il tema attuale, bianco per documenti e stampa, trasparente) e, con più piatti, il **piatto** da fotografare: un altro piatto si porta in vista solo per il tempo dell'esportazione (senza passi di Annulla) e poi si torna a quello di prima; il file porta il nome del piatto.
- **Tendina Altro nella barra stretta.** Sotto i 1440 px Ortografica, Operandi, Piatto, Tema e Codice OpenSCAD stanno in una tendina verticale, con le stesse funzioni, il segno di spunta degli interruttori e i tasti. La barra completa e la tendina Viste restano dentro la finestra fino a 1280 px (la tendina si apre verso sinistra).
- **Un clic sul marchio** in alto a sinistra riapre la schermata di benvenuto.

### Modificato
- **Con uno strumento a pannello aperto la barra si ferma**: Raccordo, Smusso, Smusso angolare, Guscio, Serie, Pattern, Dividi, Appoggia su una faccia e Misura lasciano attivo solo il proprio pulsante (per chiuderlo; con i tre strumenti di bordo si passa liberamente dall'uno all'altro), come già facevano le scorciatoie. Anche Nuovo, Annulla e Ripeti si fermano finché lo strumento è aperto.
- **Il tasto destro su un oggetto con uno strumento aperto non apre più il menu** in nessun caso (con Dividi aperto prima si apriva), né dalla vista né dall'elenco Oggetti.
- Le voci delle tendine Viste e Altro hanno un nome accessibile pulito (senza il tasto) e la scorciatoia dichiarata.

### Corretto
- **Dividi: il campo Posizione.** Cambiando asse il campo passa da solo a metà ingombro e, se si scriveva subito dopo, il nuovo testo si accodava al vecchio (per esempio "10" + "5" = "105", ridotto al massimo e piano fuori dall'oggetto). I test ora aspettano l'aggiornamento del campo.

## [0.48.1] - 2026-10-12

### Corretto
- **L'immagine delle 4 viste è divisa esattamente in 4 sezioni uguali.** Prima tra le viste c'erano 8 px di sfondo (immagine di 1608 px) e le sezioni non erano quattro quadrati identici. Ora il PNG è di 1600 × 1600 px, con quattro viste da 800 px a contatto, una sottile linea di divisione al centro e le etichette sopra le linee. Le viste restano allineate come in un disegno tecnico: Alto e Fronte hanno lo stesso centro in orizzontale, Fronte e Lato la stessa quota del piano.
- **Il tooltip del pulsante Viste mostra i tasti dei preset** (7 · 1 · 3 · 0), come gli altri pulsanti mostrano la loro scorciatoia.

### Test
- Resi stabili i test che fallivano a intermittenza: Dividi aspettava il ricalcolo del kernel con un controllo che passava subito, e i test di importazione OpenSCAD controllavano la scena prima che l'importazione asincrona avesse creato gli oggetti. Ora aspettano la condizione vera (volumi delle metà, numero di oggetti o di piatti). Anche il test dei tooltip della toolbar, che falliva dalla 0.39, ora passa.

## [0.48.0] - 2026-10-12

### Aggiunto
- **Esportazione dell'immagine con le 4 viste.** Nel menu Esporta la nuova voce **Immagine** scarica un PNG quadrato (1608 px) con quattro viste in una griglia 2×2: Alto e Fronte sopra, Lato e Isometrica sotto, ciascuna con la sua etichetta. Le viste sono ortografiche, con la stessa scala, e mostrano l'intero piatto in vista (gli altri piatti non compaiono) con lo sfondo e i colori del tema attuale e, se è visibile, il piano di stampa con la griglia. Non compaiono selezione, quote, gizmo né overlay degli strumenti, e nemmeno gli oggetti nascosti o i fori sciolti (traslucidi, non si stampano). La vista 3D non viene toccata: l'immagine si disegna con un renderer fuori schermo, con le stesse luci e lo stesso tone mapping. Con più piatti il file porta il nome del piatto (`construct-viste-piatto-2.png`).

## [0.47.0] - 2026-10-12

### Aggiunto
- **Icona dei tre piani e tendina verticale per Viste.** Il pulsante Viste ha una nuova icona (il piano orizzontale con le due pareti verticali, i tre piani cartesiani) al posto della macchina fotografica. La tendina elenca le voci una sotto l'altra, ciascuna con icona e tasto: Alto (7), Fronte (1), Lato (3), Isometrica (0), Inquadra selezione (.) e Inquadra tutto (Home).

### Modificato
- **Tema scuro come predefinito** per chi non ha ancora preferenze e dopo "Ripristina le impostazioni". Chi ha già salvato il tema chiaro lo mantiene. Anche la schermata di caricamento (colore della barra del browser e del manifest PWA) parte scura.
- **Il piano di stampa si distingue dallo sfondo** nel tema scuro: la base è più chiara e la griglia è tarata di conseguenza.
- **Il tasto P alterna il piano tra visibile e nascosto.** Lo stato intermedio "solo griglia e bordo" non esiste più (anche dalle Impostazioni); chi lo aveva salvato vede il piano visibile.
- **Estrudi (T) passa dalla sezione Trasforma alla sezione Modifica**, primo della fila: agisce solo sulle forme 2D e cambia la geometria, a differenza di Sposta, Ruota e Ridimensiona che valgono per qualsiasi oggetto.
- **I pulsanti si accendono solo quando sono utilizzabili sull'oggetto selezionato.** I modi del gizmo (Sposta, Ruota, Ridimensiona, Estrudi) sono disabilitati e spenti quando il gizmo non compare (nessuna selezione, più oggetti, oggetto bloccato o dentro un gruppo, strumento aperto) e, per Ridimensiona ed Estrudi, quando il tipo di oggetto non lo permette (mesh importate, primitive per Estrudi, estrusioni rotazionali); il modo scelto resta salvato e il pulsante si riaccende con un oggetto adatto. Raggruppa, Unisci, Inviluppo e Minkowski chiedono almeno due oggetti non bloccati; Separa non agisce su un gruppo bloccato o ridimensionato; Solido/Foro e Elimina ignorano i bloccati; Appoggia sul piatto vuole un oggetto non bloccato; Allinea vuole almeno un oggetto libero da spostare (i bloccati fanno da riferimento); Raccordo, Smusso, Smusso angolare e Appoggia su una faccia hanno bisogno di un oggetto non bloccato nella scena.
- **Il marchio della schermata di benvenuto** è lo stesso della barra laterale: icona della favicon e nome Construct con una tinta per lettera.

## [0.46.0] - 2026-10-12

### Modificato
- **Nuova struttura dell'interfaccia.** La barra laterale sinistra ora sale fino in cima alla finestra e ospita il marchio come prima cosa, centrato; la barra strumenti parte subito alla sua destra. Il marchio è l'icona della favicon (il cubo azzurro sul quadrato scuro) seguita dal nome Construct, con una tinta per lettera: le cinque delle sezioni della barra strumenti (blu, viola, verde acqua, ambra, ardesia) a rotazione. L'intestazione è alta quanto la barra strumenti, così i bordi inferiori restano allineati.
- **Barra strumenti più compatta sulle finestre strette.** Avendo 240 px in meno, sotto i 1760 px i pulsanti si stringono, così il gruppo Vista con il menu resta visibile fino a circa 1440 px di larghezza (senza questa correzione la barra si sarebbe tagliata già sotto i 1670 px).
 - 2026-10-12

### Aggiunto
- **Menu contestuale nell'elenco Oggetti.** Il clic destro su una riga seleziona l'oggetto (se non lo è già) e apre lo stesso menu dei comandi della vista 3D, Nascondi compreso. Su un oggetto nascosto, che non si può selezionare, il menu offre la sola voce **Mostra**. I figli di un gruppo nascosto non aprono nulla: si mostrano dal gruppo.

## [0.45.0] - 2026-10-12

### Modificato
- **Duplica non sposta più la copia.** Prima la copia compariva sfalsata di 10 mm in X e Y; ora nasce esattamente nelle coordinate dell'originale (sovrapposta), è già selezionata e in cima all'elenco, pronta da muovere con il gizmo o le frecce. Vale per il pulsante, il menu contestuale e `Ctrl+D`.

## [0.44.0] - 2026-10-12

### Aggiunto
- **Comando Nascondi** (pulsante nella sezione Oggetto, menu contestuale e `Maiusc+H`): toglie gli oggetti selezionati dalla vista 3D per ripulire l'area di lavoro ed evitare modifiche accidentali. Un oggetto nascosto non si seleziona né dalla vista né dall'elenco; nell'elenco Oggetti compare attenuato con l'icona dell'occhio barrato (come il lucchetto), e un clic sull'icona lo mostra di nuovo. Senza nulla di selezionato, il pulsante e `Maiusc+H` diventano **Mostra tutti**. Si nascondono gli oggetti alla radice; i figli di un gruppo nascosto lo sono per eredità. Resta nel calcolo e nelle esportazioni (STL, 3MF, OpenSCAD) e si salva con il progetto; ogni azione è un solo passo di Annulla.

### Modificato
- **Barra strumenti meno piatta**: ogni sezione (Trasforma, Combina, Modifica, Disponi, Oggetto) ha una sua tinta su icone, nome della sezione, passaggio del mouse e pulsante attivo. Le tinte sono token (`tool-*`) con contrasto verificato nei due temi.

## [0.43.0] - 2026-10-12

### Corretto
- **"Aggiorna ora" non faceva nulla.** Il ricaricamento automatico del plugin PWA scatta solo se la pagina era già controllata da un service worker all'apertura; alla prima visita o dopo una ricarica forzata (Ctrl+F5) il service worker nuovo si attivava ma la pagina restava com'era, e serviva F5. Ora il pulsante ascolta direttamente `controllerchange` e ricarica, con un ricarico di riserva dopo 4 secondi, e mostra "Aggiornamento in corso…" mentre lavora. Riprodotto e verificato con un service worker vero in Chrome (prima visita e pagina già controllata).
- **Impossibile spostare un oggetto racchiuso in un altro.** Il gizmo di un oggetto dentro un altro sta dietro la sua superficie: il clic per afferrare la maniglia selezionava invece l'oggetto davanti, il gizmo spariva e il trascinamento passava alla rotazione della vista. Ora, se il tasto viene premuto su una maniglia del gizmo, il clic non seleziona nulla (e un clic fermo sulla maniglia non deseleziona più).

### Modificato
- **La selezione con il clic avviene al rilascio del tasto**, e solo se il puntatore non si è mosso. Trascinare la vista partendo da sopra un oggetto non lo seleziona più. Doppio clic, Maiusc+clic e Alt+clic funzionano come prima.
- **Un oggetto bloccato è trasparente ai clic** nella vista 3D: se dietro c'è un oggetto libero, il clic seleziona quello. Un bloccato da solo (o con dietro solo altri bloccati) si seleziona ancora, per poterlo sbloccare; dall'elenco Oggetti si sceglie sempre.

### Aggiunto
- **Clic ripetuto nello stesso punto.** Con oggetti sovrapposti, un secondo clic entro 4 pixel e dopo 350 ms (prima sarebbe un doppio clic, entro 3 secondi) passa all'oggetto successivo lungo il raggio, in modo circolare, con i bloccati in fondo. Un oggetto completamente racchiuso in uno pieno non è raggiungibile col raggio: per quello restano l'elenco Oggetti e il lucchetto.

## [0.42.0] - 2026-10-12

### Modificato
- **Raggruppamento in facce più rapido (`faceMap`).** Il calcolo che serve a Raccordo, Smusso, Pattern, Appoggia su una faccia e agli agganci passa da vettori temporanei a aritmetica scalare, da una `Map` a una tabella hash su typed array per gli spigoli e da una `Map` a un array per le facce: circa il 30% in meno su una mesh da 74 000 triangoli (da 69 a 47 ms; 15 ms circa a 18 000 triangoli). Il risultato è identico a quello di prima, verificato su sfera, piastra con foro, toro, cubo e un triangolo degenere.

### Aggiunto
- **Indicatore di calcolo sopra la vista 3D.** Finora il calcolo del kernel si vedeva solo come "Calcolo…" nella barra di stato. Ora, se dura più di 300 ms, al centro dell'area di rendering compare una scheda con uno spinner e "Calcolo in corso…" (con un velo leggero sulla vista), che sparisce appena il kernel ha finito. Non blocca i clic e non compare per i calcoli brevi: durante il trascinamento di uno slider ogni passo avvia un calcolo, e un modale che blocca l'interfaccia renderebbe lo slider inutilizzabile. Con la riduzione del movimento attiva lo spinner resta fermo.
- **Benchmark del kernel** (`src/kernel/bench.test.ts`, solo con `BENCH=1`): cache calda su scene ad albero, estrazione delle mesh, `faceMap`, Minkowski, forme curve ad alta risoluzione ed export. È servito a decidere dove ottimizzare: a cache calda una scena da 400 foglie si rivaluta in meno di 1 ms, `volume()` e `boundingBox()` costano meno di 0,4 ms su 74 000 triangoli e il Minkowski è per il 94% dentro il WASM, quindi la chiave di cache, `toMesh` e il codice JavaScript del Minkowski non sono stati toccati.

## [0.41.1] - 2026-10-09

### Corretto
- **Anteprime dei modelli di esempio.** Le immagini della galleria erano piccole e poco leggibili (inquadratura generica con il piatto in vista, il biglietto fotografato dall'alto). Ora lo script delle immagini calcola la sfera dell'ingombro delle mesh, mette la camera in prospettiva a tre quarti a una distanza scelta per ogni modello (il biglietto da un lato in cui il testo si legge dritto), nasconde piatto e notifiche e ritaglia la vista in 8:5 attorno all'oggetto, fuori dalla terna degli assi.

## [0.41.0] - 2026-10-09

### Aggiunto
- **Modelli di esempio.** Nuova modale dal menu (voce **Modelli di esempio…**) e dalla quarta scheda del benvenuto, che ora è attiva: una galleria con anteprima, descrizione e crediti. Tre modelli: il biglietto da visita (testi, forme 2D e booleane), il gioco a incastri di Ulrich Bär (Minkowski, differenza e unione) e la pallina di Natale di Torsten Paul (rivoluzione, torsione, inviluppo e intersezione), entrambi CC0 e convertiti una volta per tutte dai `.scad` di esempio in progetti nativi di Construct (`src/examples/*.json`). Una scheda sostituisce la scena (un solo passo di Annulla), chiude la modale e inquadra il modello appena calcolato. I JSON si scaricano solo quando si sceglie l'esempio e le anteprime (`public/examples/*.webp`) nascono dallo script delle immagini della documentazione.

## [0.40.2] - 2026-10-09

### Modificato
- **Deploy doppio.** Oltre a GitHub Pages (che serve `construct.mavida.com` con certificato automatico) il workflow copia di nuovo `dist/` via rsync nell'hosting cPanel, come prima, finché il vecchio host non viene dismesso.

## [0.40.1] - 2026-10-09

### Modificato
- **Deploy su GitHub Pages.** Il workflow non copia più `dist/` via rsync sull'hosting cPanel: pubblica il sito con `actions/deploy-pages` (sorgente "GitHub Actions" del repo), con `404.html` uguale alla pagina dell'app per i link profondi e `public/CNAME` che fissa il dominio `construct.mavida.com`. Il DNS del sottodominio va puntato con un record CNAME a `miziomon.github.io`; i secret SSH non servono più. Resta la mail di esito via Resend.

## [0.40.0] - 2026-10-09

### Aggiunto
- **Dividi con un piano** (sezione Modifica della barra, menu contestuale, Maiusc+S): taglia l'oggetto selezionato in due con un piano perpendicolare a X, Y o Z, alla quota scelta dentro il suo ingombro, con le due metà in anteprima dal vivo e il piano evidenziato nella vista. Il risultato sono due oggetti, "Nome (1)" e "Nome (2)", ciascuno un gruppo Intersezione tra una copia del pezzo e un cubo "Taglio": restano parametrici (spostando il cubo si sposta il taglio) e nel codice OpenSCAD sono `intersection()` con un `cube`. Invio conferma in un solo passo di Annulla, Esc rimette l'originale; un piano fuori dal pezzo viene segnalato. Serve per i pezzi più grandi del piatto; i connettori tra le metà arriveranno in seguito.

## [0.39.0] - 2026-10-09

### Aggiunto
- **Viste**: tendina Viste nella sezione Vista della barra con i preset Alto (`7`), Fronte (`1`), Lato (`3`) e Isometrica (`0`), che tengono il centro inquadrato e la distanza, e con Inquadra selezione (`.`, gli oggetti selezionati o tutta la scena) e Inquadra tutto (`Home`, anche dal menu contestuale del vuoto; con la scena vuota inquadra il piatto).
- **Proiezione ortografica** (pulsante Ortografica, tasto `5`): alterna prospettica e ortografica mantenendo la stessa inquadratura (lo zoom ortografico si ricava dalla distanza e viceversa), per allineare e misurare senza deformazione di prospettiva. La scelta resta salvata nel browser; la griglia del piatto non si dissolve con la distanza in ortografica.

## [0.38.0] - 2026-10-09

### Modificato
- **Lucchetto delle proporzioni sui profilati**: con le proporzioni bloccate, cambiando a mano Larghezza o Profondità scalano dello stesso fattore anche gli spessori di ali e anima, il raccordo interno e le punte (nel tubolare rettangolare la parete e il raggio degli angoli), così la sezione resta simile a sé stessa; prima scalava solo l'ingombro. Il gizmo Ridimensiona e la Scala in percentuale lo facevano già.

## [0.37.0] - 2026-10-09

### Aggiunto
- **Comando Sdraia** (sezione Disponi della barra, menu contestuale, Maiusc+V): ruota di 90° gli oggetti selezionati attorno al centro del loro ingombro e li riappoggia sul piatto. Una trave in piedi si stende lungo X; premendo di nuovo gira lungo Y e la terza volta torna in piedi; un oggetto inclinato in modo qualsiasi si rimette in piedi al primo colpo. Un solo passo di Annulla per pressione.

## [0.36.0] - 2026-10-09

### Modificato
- **Guscio con cavità esatta sui profilati** (L, T, H, U e tubolari): la cavità è la stessa sezione con ogni parete ristretta dello spessore, invece del ripiego scalato che su una forma concava dava pareti irregolari. Il raccordo interno della cavità cresce dello spessore e le punte e gli angoli esterni calano dello spessore, così le pareti restano costanti anche in curva; con pareti più sottili del doppio dello spessore il pannello avvisa invece di produrre una cavità degenere. Nel codice OpenSCAD la cavità è un `polygon` come il pezzo. Con torsione, scala della cima, contorno o estrusione rotazionale resta la cavità scalata.

## [0.35.0] - 2026-10-09

### Aggiunto
- **Punte delle ali smussate o arrotondate** nei profilati a L, T, H e U: il campo Punte nelle Proprietà (mm, 0 = vive) lavora sui due angoli di ogni estremità libera delle ali e dell'anima, con lo stile Arrotondate (arco tangente) o Smussate (taglio a 45°). Il massimo è metà dello spessore più sottile e la parte dritta che resta accanto al raccordo interno. Stessi vertici nel kernel e nel `polygon` del codice OpenSCAD; il valore si ricorda per la forma successiva e si limita da solo quando la sezione si restringe.

## [0.34.0] - 2026-10-09

### Aggiunto
- **Profilato a U, tubolare rettangolare e tubolare tondo**, accanto a L, T e H nella tab Forme 3D e nel menu contestuale. La U ha il fondo in basso e due ali verticali (spessori di ali e fondo, raccordo interno). Il tubolare rettangolare ha larghezza, profondità, parete e raccordo degli angoli esterni (quelli interni seguono con il raggio ridotto della parete, così lo spessore resta costante). Il tubolare tondo ha raggio esterno, parete e numero di lati, con lo spessore in mm (l'Anello 2D lo esprime in percentuale). Tutti con lunghezza iniziale di 40 mm, pannello dedicato, misure ricordate, ridimensionamento che scala anche le pareti e codice OpenSCAD con `polygon` a due tracciati per i tubolari.

## [0.33.0] - 2026-10-09

### Aggiunto
- **Profilati strutturali a L, a T e a H.** Tre nuove forme nella tab Forme 3D della libreria (dopo i solidi dei dadi) e nel sottomenu Forme 3D del menu contestuale. Sono sezioni estruse (come le forme 2D, con torsione, scala della cima, contorno ed estrusione rotazionale), ma si usano come solidi: nascono in piedi, con la sezione sul piano XY e la lunghezza lungo Z (40 mm iniziali, sezione 20 × 20 mm con pareti di 3 mm). La L ha l'ala orizzontale in basso e quella verticale a sinistra; la T l'ala in cima e l'anima al centro; la H le due ali verticali ai lati e l'anima orizzontale al centro, come la lettera (per un profilo a I basta ruotarla di 90° su Z).
- **Pannello Profilato** nelle Proprietà: Larghezza e Profondità della sezione, i due spessori con etichette diverse per tipo (ala X e ala Y nella L, ala e anima nella T, ali e anima nella H), **Raccordo interno** (raggio dell'arco tra ala e anima, come nei profilati laminati, 0 = spigolo vivo) e la **Lunghezza** al posto dell'altezza nell'estrusione. Gli spessori non superano mai l'ingombro (un valore troppo grande si riduce da solo) e il raccordo si ferma alla parte dritta più corta.
- Il gizmo Ridimensiona e la Scala in percentuale scalano anche gli spessori lungo l'asse in cui si misurano, così la sezione non si deforma. Le misure si ricordano per la forma successiva come per le altre forme.
- Il codice OpenSCAD scrive `linear_extrude` di un `polygon` con gli stessi vertici del kernel (raccordo compreso); un profilato reimportato da `.scad` diventa un poligono generico, come le altre forme poligonali. Il Guscio usa la cavità scalata, come per croce e anello.

## [0.32.0] - 2026-10-09

### Modificato
- **Minkowski su forme concave molto più veloce.** Il controllo che decide se una toppa della superficie è convessa non usa più una booleana sull'intera mesh ma un test geometrico (nessun triangolo estraneo entra nell'inviluppo della toppa, cercato in una griglia): sul corpo della tazza di `import/coffe-cup.scad` la scomposizione passa da 7,5 s a 1,5 s, con meno toppe e lo stesso risultato.
- **Pennellata a tolleranza.** Dal secondo operando in poi, una sfera, un cilindro o un cono si costruiscono con i segmenti che tengono l'errore di corda entro 0,01 mm (una sfera di raggio 2 a 140 lati scende a 32: 258 vertici invece di 4902). Il risultato differisce al massimo di 0,01 mm, sotto la risoluzione di qualsiasi stampante; il codice OpenSCAD esportato conserva il `$fn` del nodo.
- Tempi con gli esempi della cartella `import/` (kernel in Node): `coffe-cup.scad` da 16 s a 2,2 s, `BabyToy.scad` da 0,19 s a 0,08 s; `Bauble` e `Bauble2` invariati.

### Corretto
- **Import OpenSCAD: le variabili speciali hanno scope dinamico.** `$fn`, `$fa` e `$fs` impostate in un modulo valgono anche nei moduli e nelle funzioni che quello richiama, come in OpenSCAD (prima si leggevano solo nello scope lessicale: in `coffe-cup.scad` i cerchi del manico uscivano a 64 segmenti invece di 140). Passate come argomento (`m($fn = 12)`) continuano ad avere la precedenza; le variabili normali restano lessicali.

## [0.31.0] - 2026-10-08

### Aggiunto
- **Spaziatura del testo** (`spacing` di OpenSCAD): il Testo ha il campo Spaziatura nelle Proprietà (moltiplicatore della distanza tra le lettere, 1 = normale), il codice esportato scrive `spacing = ...` e l'importazione la legge, quindi l'avviso "la spaziatura non si importa" non compare più. Valori fuori da 0,1-10 si limitano con una nota.

### Modificato
- **Minkowski molto più veloce**. La somma si distribuisce sull'unione (si sommano le componenti connesse una a una) e i solidi concavi con facce piane si scompongono in toppe convesse. Misure con gli stessi solidi del kernel: `BabyToy` da 12-18 s a 0,2 s, forma a L 217 ms → 15 ms, scatola con guscio 212 ms → 51 ms, cilindro con guscio a 64 lati 3,6 s → 1,5 s. Il risultato coincide con quello di prima (differenza sotto 0,01% del volume). Con superfici concave molto curve e fitte (una sfera cava a 48 lati) il guadagno è modesto (circa 8-10 s): è annotato in `docs/da-fare.md`.

## [0.30.0] - 2026-10-08

### Aggiunto
- **Comando Minkowski** sulla barra (gruppo Combina), nel menu contestuale e con la scorciatoia Maiusc+J: con due o più oggetti selezionati crea il gruppo Minkowski (il primo selezionato è la base). Tooltip con spiegazione e immagine di esempio.
- **Documentazione**: sezione "OpenSCAD" con i comandi supportati, quelli supportati con limiti e quelli non ancora supportati; sezione "Font" con l'elenco dei font disponibili e il link alla pagina di ciascuno su Google Fonts. La sezione "Codice OpenSCAD" resta per la vista del codice e l'esportazione.
- **Undici font** di Google Fonts: Bilbo Swash Caps, Boogaloo, Calistoga, Dancing Script Regular, Marck Script, Meow Script, Modak, Niconne, Playfair Display Regular, Roboto Black e Sriracha (ora sono 32 di testo).

### Modificato
- `docs/da-fare.md`: elenco dei font della cartella openscad/fonts di Dropbox che non sono su Google Fonts (da verificare per la licenza prima di includerli).

## [0.29.0] - 2026-10-08

### Aggiunto
- **Somma di Minkowski**: nuovo tipo di gruppo "Minkowski" (`minkowski()` di OpenSCAD) calcolato dal kernel con `minkowskiSum` di manifold-3d: il primo oggetto si espande del volume di ogni successivo (con una sfera, arrotonda gli spigoli di qualsiasi solido). Si crea importando un file OpenSCAD e si può scegliere tra le operazioni di un gruppo nel pannello Proprietà; il codice esportato ha `minkowski()` e si rilegge. Non c'è ancora un comando di barra.
- **Stampanti Anycubic ed Elegoo** nei preset del piano di stampa: Anycubic i3 Mega, Kobra 2, Kobra 2 Pro, Kobra 2 Neo, Kobra 2 Plus, Kobra 2 Max, Kobra 3, Kobra 3 V2, Kobra 3 Max e Kobra S1; Elegoo Neptune 3 Pro, Neptune 3 Max, Neptune 4, Neptune 4 Pro, Neptune 4 Plus, Neptune 4 Max e Centauri Carbon. Le misure di i3 Mega, Kobra 2, Kobra 2 Pro, Kobra 2 Neo, Kobra 2 Plus e Neptune 4 Plus vengono dalla conoscenza comune dei modelli e non da una verifica sul sito del produttore.
- **Confronto con OpenSCAD** dei tre esempi della cartella `import/`: volume e ingombro del solido importato coincidono con quelli di OpenSCAD (ingombro entro 0,03 mm, volume entro l'1%). Il dettaglio è in `docs/da-fare.md`.

### Corretto
- **Intervalli con passo** (`[0:1:6]`): il passo veniva scambiato con la fine, quindi un `for` su un intervallo a tre parti faceva una sola iterazione (in `Bauble.scad` mancavano sei pale su sette).
- **Estrusione con torsione di profili sottili**: il volume usciva gonfio o svuotato fino al 14% secondo il verso della torsione (i quadrilateri laterali lunghi e storti, divisi in due triangoli). Ora i lati del profilo si spezzano in tratti lunghi quanto uno strato e l'errore scende sotto l'1%. Vale per tutte le forme 2D con torsione, non solo per l'importazione.
- **Giro di `rotate_extrude` con `$fa` e `$fs`**: i segmenti si calcolano dal raggio massimo del profilo come fa OpenSCAD (prima restavano 64).
- **`translate` fuori da `minkowski`**: il risultato si sposta una volta sola (non anche con l'operando), perché i figli stanno nel sistema locale del gruppo.

### Modificato
- `minkowskiSum` di manifold-3d sbaglia quando il secondo solido non contiene l'origine (il risultato comprende anche il primo): Construct porta i due solidi con il centro nell'origine, li somma e rimette il risultato al suo posto. Se il secondo è concavo e il primo no, i due si scambiano.
- La somma di Minkowski tra solidi con molti lati è lenta: in `BabyToy.scad` (cilindro a 251 lati con una sfera) il calcolo dura circa 12 s, nel worker e con il risultato in cache.

## [0.28.0] - 2026-10-08

### Aggiunto
- **Rapporto dell'importazione OpenSCAD**: quando un file ha parti saltate, comandi non gestiti, errori di sintassi o non produce nulla, si apre una modale con ogni problema, la riga e un frammento del codice originale (due righe prima e dopo, con la riga evidenziata e il codice colorato). Le approssimazioni (come la posizione stimata di un testo) compaiono come note nello stesso elenco; se ci sono solo note basta un messaggio.
- **Colori OpenSCAD**: ora si riconoscono tutti i nomi CSS (`color("tomato")`, `"RebeccaPurple"`, ...) e gli esadecimali con trasparenza (`#rgba`, `#rrggbbaa`: l'alfa si scarta, perché le forme non hanno trasparenza).
- **`intersection_for`** nell'importazione OpenSCAD.
- **Documentazione**: indice in una sidebar a sinistra con la voce attiva evidenziata, e nuova sezione "Cos'è Construct" prima dei Primi passi.

### Modificato
- Benvenuto: Documentazione e About sono due pulsanti ben visibili sotto le schede.
- La modale About è larga il 60% della finestra, con le sezioni su due colonne.
- Nel pannello Importa i pulsanti si chiamano "STL e 3MF", "SVG" e "OpenSCAD".
- Piano delle parti ancora da leggere aggiornato in `docs/da-fare.md` (aggiunti `fill`, `use`/`include` locali, `parent_module` e dizionari).

## [0.27.0] - 2026-10-08

### Aggiunto
- **Importa OpenSCAD molto più completo.** Ora si leggono anche `rotate_extrude` (angolo, `$fn`, profili di cerchio, quadrato e poligono, con le trasformazioni di dentro e di fuori), `offset` (`r` arrotonda, `delta` lascia gli angoli vivi), `text` (font cercato nel catalogo, posizione stimata), `resize` (anche con `auto`), `multmatrix` e `polygon` con `paths` (il secondo contorno è un foro). Nel linguaggio: `let` (istruzione, espressione e `assign`), liste per comprensione complete (`for` annidati, `if`/`else`, `each`, `let`, forma del C, elementi misti), operatore `^`, funzioni anonime, `echo` e `assert` dentro le espressioni, `children(i)` e `children([...])`, `$children`, `$preview`, `$fa` e `$fs` (quando il file li imposta). Nuove funzioni: `lookup`, `search`, `rands` (sequenza ripetibile ma diversa da quella di OpenSCAD), `cross`, `chr`, `ord`, `is_string`, `is_bool`, `is_function`, `version`, `version_num`, `log` con due argomenti, prodotto tra vettori e matrici e confronto tra stringhe.
- **Benvenuto**: casella "Mostra ogni volta" (spuntata di default, come l'impostazione già presente in Impostazioni) e collegamenti ad About e Documentazione.
- **Documentazione** nel menu: manuale d'uso in una modale grande come quella del codice, con indice, sezioni per ogni gruppo di strumenti, cosa legge l'importazione OpenSCAD e in fondo le FAQ.
- **About** più ricco e meglio organizzato: cosa si può fare, dove stanno i dati, tecnologie, progetto e autore.

### Corretto
- **Torsione di `linear_extrude`**: importando il codice, il verso era opposto a quello che scrive l'esportazione; ora il giro esporta e importa lascia la torsione com'era.
- **Variabili assegnate più volte**: come in OpenSCAD vale l'ultima assegnazione (`x = 1; cube(x); x = 2;` fa un cubo di lato 2), con un avviso.
- **Modificatore `%` davanti a `for`, `if` e blocchi**: ora disattiva l'istruzione intera, come `*`. Il modificatore `!` ("solo questo") importa soltanto gli oggetti marcati.
- `round()` arrotonda la metà allontanandosi dallo zero (`round(-2.5)` vale -3), come OpenSCAD.

### Modificato
- La schermata di benvenuto compare a ogni avvio finché non si toglie la spunta (chi aveva già salvato l'impostazione spenta la mantiene).
- Restano da leggere `polyhedron`, `import`, `minkowski`, `projection`, `surface` e `roof`: il piano è in `docs/da-fare.md`.

## [0.26.1] - 2026-10-08

### Aggiunto

- Deploy automatico su construct.mavida.com: la GitHub Action `.github/workflows/deploy.yml` costruisce l'app e la pubblica via rsync su SSH ad ogni push su `main`, con mail di esito.

## [0.26.0] - 2026-10-08

### Aggiunto
- **Importazione di file OpenSCAD (.scad)** da Importa (menu, trascinamento o benvenuto): un interprete di un sottoinsieme del linguaggio trasforma il codice in oggetti veri. Capisce `cube`, `sphere`, `cylinder` (anche coni), `translate`, `rotate` (anche asse e angolo), `scale`, `mirror`, `color`, `union`, `difference`, `intersection`, `hull`, `linear_extrude` di `circle`, `square` e `polygon`, variabili, espressioni, funzioni, `for`, `if`, liste per comprensione, moduli con parametri e `children()`. Le trasformazioni si compongono e si assorbono in posizione, rotazione e misure di ogni forma. Quello che non si capisce (`rotate_extrude`, `minkowski`, `offset`, `polyhedron`, `import`, librerie con `use`) si salta con un avviso e il resto si importa; un errore di sintassi dice la riga e non importa nulla. È un solo passo di Annulla e ci sono limiti contro file enormi o cicli infiniti.
- **Impostazioni** nel menu hamburger: tema, schermata di benvenuto a ogni avvio, visualizzazione e dimensioni del piano, quote sull'oggetto, operandi in trasparenza, passo delle frecce, aggancio di spostamento e di rotazione del gizmo, salvataggio automatico. In fondo **Ripristina le impostazioni** (anche tema e piano) e **Pulisci tutti i dati…**, che cancella con conferma localStorage e IndexedDB (preferenze, scena salvata, mesh importate) e riparte come al primo avvio; i progetti salvati sul computer non si toccano. Il pannello dice quanto spazio usano i dati.
- **Codice OpenSCAD di tutti i piatti**: con più piatti il codice (modale e file `.scad`) ha un `module piatto_N()` per piatto, con il commento `// === Piatto N: nome ===`, e li richiama affiancati lungo X come nel 3MF. Riletto con l'importazione ricrea i piatti con i loro nomi.
- **Metadati dei piatti nel 3MF** (`Metadata/model_settings.config`, con oggetti e piatti con i loro nomi) per Bambu Studio e Orca. Non si può provare senza gli slicer: i programmi che non li conoscono li ignorano e leggono i piatti dalla posizione degli oggetti.
- **About** con il link al repository GitHub e le informazioni sull'autore con il suo sito.

### Modificato
- La modale **Novità** è grande come quella del codice, l'elenco scorre e le versioni non mostrano più la data.
- Con il salvataggio automatico spento (Impostazioni) la scena resta solo nel progetto salvato a mano.

## [0.25.0] - 2026-10-08

### Aggiunto
- **Piatti**: un progetto può avere più piatti di stampa, ciascuno con i suoi oggetti (per esempio "Piatto 1: scatola", "Piatto 2: coperchio"). Nuova scheda **Piatti** accanto a **Oggetti** nella barra laterale sinistra: elenco dei piatti con nome (doppio clic o matita per rinominare), numero di oggetti e primi nomi, piatto attivo evidenziato, "Aggiungi piatto", cestino (con conferma se contiene oggetti, l'ultimo non si elimina) e, per ogni altro piatto, "Sposta qui" gli oggetti selezionati. Nel menu contestuale di un oggetto compare "Sposta nel piatto ▸". Si vede e si modifica un piatto alla volta: vista, elenco Oggetti, barra di stato e codice OpenSCAD riguardano il piatto attivo. Cambiare piatto non è un passo di Annulla; aggiungere, spostare, rinominare ed eliminare sì.
- **Esportazione con i piatti**: il **3MF** contiene tutti i piatti, affiancati lungo X (larghezza del piano più 20 mm) con la trasformazione degli item, e i nomi portano il piatto ("Piatto 2 – Coperchio"); l'**STL** chiede quale piatto esportare quando ce n'è più di uno (il file si chiama per esempio `construct-piatto-2.stl`) e con un piatto solo parte subito.
- **Menu del vuoto con sottomenu a destra**: *Forme 3D*, *Forme 2D*, *Simboli* ed *Emoji* (le ultime due con griglia di glifi scorrevole, Preferiti e Recenti in cima; tutto si crea nel punto cliccato), poi Importa…, Esporta…, Dimensioni del piano… e Schermata di benvenuto. I sottomenu si aprono con il mouse, il clic o la freccia destra e si chiudono con la sinistra.
- Voce **Schermata di benvenuto** nel menu hamburger, per riaprirla in qualsiasi momento.
- **Orbitron Bold** tra i font del Testo.
- **Icona "Svuota la cronologia"** nella timeline (chiede conferma; la scena resta com'è).

### Modificato
- **Il nome dell'app è in maiuscolo con Orbitron** (barra strumenti, benvenuto, About): testo vero con `@font-face`, quindi segue il tema e non richiede immagini.
- **Timeline più leggera**: ogni passo è un piccolo indicatore (rombo per l'inizio, pallino pieno con anello per il passo corrente, pallino tratteggiato per i passi annullati) e il nome dell'operazione sta nel tooltip sopra l'indicatore. Con Serie e Pattern aperti i salti sono disattivati, come già con Raccordo, Smusso e Guscio.
- **Quote**: il lucchetto delle proporzioni compare accanto a tutte e tre le quote (X, Y, Z), che sono lo stesso interruttore.
- **Scorciatoie da tastiera**: la modale è grande come quella del codice e l'elenco scorre.
- **Tendina delle stampanti**: la marca compare una volta sola, seguita dai modelli ("256 × 256 mm · Bambu Lab: A1, P1S, P1P, X1C"; con marche diverse sulla stessa misura "180 × 180 mm · Bambu Lab: A1 mini · Prusa: MINI+").
- **Barra strumenti** un po' più compatta (spazi e margini dei pulsanti) per far posto al nome più largo.
- Il formato dei progetti passa alla versione 4 (i piatti); i file delle versioni precedenti si aprono come progetti con un piatto solo.

## [0.24.0] - 2026-10-08

### Aggiunto
- **Schermata di benvenuto** al primo avvio (nessun dato salvato dall'app, né con il nome attuale né con il vecchio, e nessuna scena da ripristinare): marchio, tagline e quattro schede, cioè Nuovo progetto (vuoto), Parti da un cubo, Importa (STL, 3MF, SVG) e Modelli di esempio, quest'ultima visibile ma non ancora selezionabile ("Presto"). Si chiude con la X o con Esc e non ricompare più. Funziona in chiaro e in scuro.
- **Menu contestuale sul vuoto**: il tasto destro fuori dagli oggetti apre un menu per aggiungere una forma 3D o 2D **nel punto cliccato** sul piano di stampa (il clic deseleziona).
- **Lucchetto delle quote**: accanto alla quota dell'altezza, chiuso fa scalare tutti gli assi dello stesso fattore. Usa lo stesso campo del pulsante Proporzioni delle proprietà; sui gruppi vale solo qui, sulle mesh è sempre chiuso.

### Modificato
- **WebCAD si chiama ora Construct**: nome nell'app (titolo, barra, About, aggiornamenti, manifest della PWA), nei file scaricati (`construct.stl`, `.3mf`, `.scad`, `.zip`, `construct-progetto.json`), nell'intestazione del codice OpenSCAD, dell'STL e del 3MF, nel repo GitHub (`miziomon/construct`) e nei documenti. Le voci storiche di questo file restano com'erano.
- **Migrazione dei dati**: preferenze, ultimi valori usati, scena salvata nel browser e mesh importate passano alle chiavi `construct:*` al primo avvio, senza perdere nulla (le vecchie chiavi restano). I progetti `.json` salvati come `webcad-scene` si aprono ancora; i nuovi hanno formato `construct-scene`.
- Il **numero di versione non sta più accanto al logo** nella barra (resta nel titolo, nella barra di stato e in About): più spazio per i comandi.
- I nomi delle sezioni della barra stanno **sopra** i pulsanti.
- **Piano di stampa**: i preset sono una tendina con la misura per prima e poi le stampanti che la hanno (ad esempio "256 × 256 mm · Bambu Lab A1, P1S, P1P, X1C"), una voce per misura anche tra marche diverse (la Prusa MINI+ sta con la A1 mini); con misure diverse da ogni preset la tendina mostra "Misure personalizzate".
- **Menu contestuale sull'oggetto più intelligente**: mostra solo ciò che ha senso. Raggruppa, Unisci, Inviluppo e Allinea con due o più oggetti; Separa solo su un gruppo; Raccordo, Smusso, Smusso angolare e Appoggia su una faccia solo con un oggetto singolo che ha facce piane (non sfere, tori, raccordi o smussi); Appoggia sul piatto solo se l'oggetto non ci poggia già; un oggetto bloccato offre solo Sblocca, Duplica e Misura.

### Corretto
- I cursori delle misure, delle altezze e della posizione Z non hanno più il limite fisso di 256 mm: seguono il lato maggiore del piano di stampa configurato.

## [0.23.0] - 2026-10-08

### Aggiunto
- **Preset delle stampanti** nella finestra delle dimensioni del piano, divisi per marca e con nome e misure: Bambu Lab (A1 mini 180 × 180, A1 / P1S / P1P / X1C 256 × 256, H2D 350 × 320), Prusa (MK4S 250 × 210, CORE One 250 × 220, XL 360 × 360) e Creality (Ender-3 V3 / K1 220 × 220, K1 Max 300 × 300, K2 Plus 350 × 350). Un clic compila i due campi, il preset che coincide con le misure attuali è evidenziato e la conferma resta "Applica". Le aree già presenti in un'altra marca non si ripetono (la Prusa MINI+ è 180 × 180 come la A1 mini).
- **Quote cliccabili nella vista**: con un oggetto selezionato compaiono le misure X, Y e Z del suo ingombro, nel sistema dell'oggetto. Un clic su una quota apre un campo dove si digita la misura in mm: Invio applica, Esc annulla. Vale per forme, forme 2D, gruppi (scala per asse, centro della base fermo) e mesh importate (scala uniforme); con le proporzioni bloccate gli altri assi seguono. La base resta dov'era e l'operazione è un solo passo di Annulla. Con l'oggetto bloccato le quote sono di sola lettura e durante il trascinamento del gizmo si nascondono.
- **Menu contestuale** con il tasto destro su un oggetto: lo seleziona (se non lo è già, così una selezione multipla resta) e mostra soltanto i comandi applicabili, negli stessi gruppi della barra, con icona e scorciatoia. Si chiude con Esc, un clic fuori, la rotellina o un cambio di selezione e si naviga con le frecce. Un trascinamento con il tasto destro resta il movimento della vista.
- Registro dei comandi condiviso (`src/ui/commands.tsx`): la barra e il menu leggono le stesse definizioni di nome, scorciatoia, abilitazione e azione.

### Modificato
- **Barra strumenti riorganizzata in sezioni** con il nome sotto i pulsanti: File, Trasforma, Combina, Modifica, Disponi, Oggetto e Vista. Prima 19 comandi stavano in un solo blocco. Nomi, scorciatoie e tooltip non cambiano; la barra è alta 62 px invece di 54 e i divisori sono più stretti.
- Le etichette dei campi nella finestra del piano ("Larghezza X", "Profondità Y") non sono più tagliate.
- Il menu Scorciatoie e il tooltip di Ridimensiona citano il clic destro e le quote.

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
