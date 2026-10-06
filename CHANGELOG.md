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
