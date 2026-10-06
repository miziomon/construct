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
