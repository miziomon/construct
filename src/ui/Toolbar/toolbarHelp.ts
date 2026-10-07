/**
 * Testi dei tooltip dettagliati della barra: cosa fa il comando e come si applica. I comandi complessi hanno anche
 * un'immagine di esempio (public/help/<nome>.webp, generata da e2e/docs-images.spec.ts).
 */
export interface ToolbarHelp {
  /** Nome breve del comando (anche nome accessibile del pulsante). */
  name: string;
  /** Cosa fa. */
  what: string;
  /** Come si applica, passo per passo. */
  how: string;
  /** Nome del file immagine in public/help (senza estensione), se il comando è complesso. */
  image?: string;
}

export type HelpKey =
  | 'new' | 'undo' | 'redo' | 'select' | 'translate' | 'rotate' | 'resize' | 'extrude'
  | 'group' | 'union' | 'hull' | 'ungroup' | 'hole' | 'lock' | 'unlock'
  | 'fillet' | 'chamfer' | 'corner' | 'shell' | 'align' | 'mirror' | 'measure' | 'array' | 'pattern'
  | 'layflat' | 'drop' | 'duplicate' | 'delete' | 'ghost' | 'bed' | 'theme' | 'code';

export const TOOLBAR_HELP: Record<HelpKey, ToolbarHelp> = {
  new: { name: 'Nuovo progetto', what: 'Svuota la scena per ricominciare da zero.', how: 'Chiede conferma e, se vuoi, svuota anche la cronologia. Il progetto attuale si può salvare prima dal menu.' },
  undo: { name: 'Annulla', what: 'Torna indietro di un passo.', how: 'Ogni operazione conta un solo passo, anche quelle con anteprima (Raccordo, Guscio, Serie, Pattern). La cronologia si vede nella linea del tempo.' },
  redo: { name: 'Ripeti', what: 'Rifà il passo appena annullato.', how: 'Disponibile finché non fai una nuova modifica dopo l\'Annulla.' },
  select: { name: 'Seleziona', what: 'Modalità di selezione senza maniglie di trasformazione.', how: 'Clic su un oggetto per sceglierlo, Maiusc+clic per aggiungerne altri, clic nel vuoto per deselezionare.' },
  translate: { name: 'Sposta', what: 'Mostra le frecce per spostare l\'oggetto lungo X, Y e Z.', how: 'Seleziona un oggetto e trascina una freccia; con Maiusc il movimento si aggancia a passi regolari. Le frecce della tastiera lo muovono di 1 mm.' },
  rotate: { name: 'Ruota', what: 'Mostra gli anelli per ruotare l\'oggetto attorno agli assi.', how: 'Seleziona un oggetto e trascina un anello. La rotazione è in gradi e si legge anche nel pannello delle proprietà.' },
  resize: { name: 'Ridimensiona', what: 'Cambia le dimensioni dell\'oggetto trascinando le maniglie.', how: 'Seleziona un oggetto e trascina una maniglia: con il lucchetto attivo le proporzioni restano fisse. Le misure esatte si digitano nelle proprietà.' },
  extrude: { name: 'Estrudi', what: 'Dà spessore a una forma 2D trascinando una maniglia verso l\'alto.', how: 'Seleziona una forma 2D (cerchio, quadrato, testo, SVG) e trascina la maniglia: l\'altezza dell\'estrusione segue il mouse.' },
  group: { name: 'Raggruppa', what: 'Unisce più oggetti in un gruppo che si muove insieme, senza fonderli.', how: 'Seleziona almeno due oggetti e premi il pulsante: restano separati (colori e codice propri). Separa scioglie il gruppo.' },
  union: { name: 'Unisci', what: 'Fonde più oggetti in un solo solido con una unione booleana.', how: 'Seleziona almeno due oggetti: il risultato è un solo pezzo, appoggiato sul piatto. Un oggetto impostato come Foro viene invece sottratto.', image: 'union' },
  hull: { name: 'Inviluppo convesso', what: 'Crea la forma più piccola e senza concavità che contiene tutti gli oggetti.', how: 'Seleziona almeno due oggetti e premi il pulsante: è come tendere un elastico attorno a loro. Nel codice diventa hull().', image: 'hull' },
  ungroup: { name: 'Separa', what: 'Scioglie un gruppo o un\'unione e riporta gli oggetti separati.', how: 'Seleziona un gruppo alla radice e premi il pulsante: i figli tornano oggetti indipendenti nella posizione in cui sono.' },
  hole: { name: 'Solido o Foro', what: 'Trasforma l\'oggetto in un Foro: invece di aggiungere materiale lo toglie.', how: 'Seleziona l\'oggetto e premi il pulsante, poi uniscilo o mettilo in una Differenza con un solido: dove si sovrappongono il materiale sparisce.' },
  lock: { name: 'Blocca', what: 'Impedisce di spostare o modificare l\'oggetto per errore.', how: 'Seleziona l\'oggetto e premi il pulsante; un oggetto bloccato si riconosce nell\'elenco e si sblocca con lo stesso pulsante.' },
  unlock: { name: 'Sblocca', what: 'Permette di nuovo di spostare e modificare l\'oggetto.', how: 'Seleziona l\'oggetto bloccato e premi il pulsante.' },
  fillet: { name: 'Raccordo', what: 'Arrotonda lo spigolo tra due superfici con un raggio a scelta.', how: 'Premi il pulsante, clicca le due superfici che formano lo spigolo, regola il raggio nel pannello (l\'anteprima è dal vivo) e conferma con OK.', image: 'fillet' },
  chamfer: { name: 'Smusso', what: 'Taglia lo spigolo tra due superfici con un piano inclinato.', how: 'Premi il pulsante, clicca le due superfici, scegli la distanza (anche diversa sui due lati) e conferma con OK.', image: 'chamfer' },
  corner: { name: 'Smusso angolare', what: 'Taglia o arrotonda un angolo del solido, dove si incontrano tre facce.', how: 'Premi il pulsante e clicca il vertice (Maiusc+clic per sceglierne più d\'uno), scegli piano o sferico e la distanza, poi OK.', image: 'corner' },
  shell: { name: 'Guscio', what: 'Svuota il solido lasciando pareti di spessore costante, utile per risparmiare materiale.', how: 'Seleziona un solido, premi il pulsante e imposta spessore delle pareti e del fondo: la cavità si vede dal vivo. Invio conferma, Esc annulla.', image: 'shell' },
  align: { name: 'Allinea', what: 'Allinea più oggetti su un asse a uno dei loro lati.', how: 'Seleziona almeno due oggetti e apri la tendina: scegli l\'asse e il lato (minimo, centro, massimo). Passando sopra una voce vedi l\'anteprima del risultato.' },
  mirror: { name: 'Specchia', what: 'Riflette gli oggetti rispetto a un piano.', how: 'Seleziona uno o più oggetti e apri la tendina: scegli l\'asse e se il piano passa dal lato minimo, dal centro o dal lato massimo dell\'ingombro.' },
  measure: { name: 'Misura', what: 'Legge la distanza in millimetri tra due punti della scena.', how: 'Premi il pulsante e clicca un punto di partenza e uno di arrivo: il puntatore si aggancia a vertici, spigoli e superfici. Un terzo clic ricomincia, Esc chiude.', image: 'measure' },
  array: { name: 'Serie', what: 'Ripete l\'oggetto in fila, in griglia o in cerchio.', how: 'Seleziona un oggetto, premi il pulsante, scegli il tipo, il numero di copie e le distanze. Il risultato è un gruppo Ripetizione: si modificano i parametri, non le singole copie.', image: 'array' },
  pattern: { name: 'Pattern', what: 'Fora l\'oggetto con un disegno ripetuto: celle Voronoi casuali, esagoni, cerchi, rombi o triangoli.', how: 'Seleziona un oggetto, premi il pulsante e scegli il tipo; regola seme, celle, parete, margine e profondità. Attiva più facce dai pulsanti dei lati o con "Scegli facce" (clic sulle facce del pezzo). OK crea un gruppo Pattern modificabile.', image: 'pattern' },
  layflat: { name: 'Appoggia su una faccia', what: 'Ruota l\'oggetto in modo che la faccia scelta poggi sul piatto.', how: 'Premi il pulsante, passa sopra l\'oggetto (la faccia si evidenzia) e clicca quella che deve stare in basso: l\'oggetto si ruota e si appoggia, ideale per la stampa.', image: 'layflat' },
  drop: { name: 'Appoggia sul piatto', what: 'Porta gli oggetti selezionati a toccare il piano di stampa.', how: 'Seleziona uno o più oggetti alla radice e premi il pulsante: si spostano in verticale fino a z = 0.' },
  duplicate: { name: 'Duplica', what: 'Crea una copia dell\'oggetto selezionato.', how: 'Seleziona uno o più oggetti alla radice e premi il pulsante: la copia compare accanto all\'originale e si seleziona.' },
  delete: { name: 'Elimina', what: 'Toglie dalla scena gli oggetti selezionati.', how: 'Seleziona e premi il pulsante (o Canc). Si può sempre annullare con Ctrl+Z.' },
  ghost: { name: 'Operandi in trasparenza', what: 'Mostra in trasparenza ciò che una booleana sottrae o interseca, come il # di OpenSCAD.', how: 'Attivalo e guarda i gruppi Differenza e Intersezione: i pezzi tolti compaiono come fantasmi, utili per capire un modello.', image: 'ghost' },
  bed: { name: 'Piatto', what: 'Cambia come si vede il piatto di stampa: completo, solo griglia e bordo, nascosto.', how: 'Ogni clic passa allo stato successivo; il tooltip dice quello attuale.' },
  theme: { name: 'Tema', what: 'Passa dal tema chiaro a quello scuro.', how: 'Un clic cambia tema; la scelta resta salvata nel browser.' },
  code: { name: 'Codice OpenSCAD', what: 'Mostra il codice OpenSCAD generato dalla scena.', how: 'Il codice si aggiorna a ogni modifica; si può copiare o scaricare e aprire in OpenSCAD per ottenere lo stesso risultato.' },
};
