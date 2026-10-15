import { useState } from 'react';
import { ChevronLeft, FileBox, FileCode, FileDown, Image as ImageIcon, Shapes, Upload } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import { allRootIds, platesOf } from '../../scene/plates';
import { export3mf, exportScad, exportStl, exportViewsPng } from '../fileActions';
import { pickAndImport } from '../../import/importFile';
import changelogSource from '../../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog';
import { SettingsPanel } from '../Settings/SettingsPanel';
import { useUiStore, type AppPanel } from '../uiStore';
import type { ImageBackground } from '../../viewport/snapshot';

/**
 * Corpo delle modali del menu (Importa, Esporta, Scorciatoie, Novità, About). Sta in un modulo a parte, caricato solo
 * quando si apre una modale: la tabella delle scorciatoie e il changelog incorporato non pesano sull'avvio dell'app.
 */
export type Panel = AppPanel;

/** Scorciatoie da tastiera (le stesse di src/hooks/useShortcuts.ts), raggruppate per argomento. */
const SHORTCUTS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Strumenti',
    rows: [
      ['Q', 'Seleziona'],
      ['W', 'Sposta'],
      ['E', 'Ruota'],
      ['R', 'Ridimensiona con il mouse (anche un gruppo di qualsiasi tipo, con scala per asse)'],
      ['T', 'Estrudi forme 2D con il mouse'],
    ],
  },
  {
    title: 'Oggetti',
    rows: [
      ['Ctrl+D', 'Duplica'],
      ['F', 'Raccordo tra due superfici (Invio conferma, Esc annulla)'],
      ['S', 'Smusso tra due superfici (Invio conferma, Esc annulla)'],
      ['A', 'Smusso angolare: clic su un vertice, Maiusc+clic per sceglierne altri (Invio conferma, Esc annulla)'],
      ['G', 'Guscio: svuota il solido selezionato, con la faccia aperta a scelta (Invio conferma, Esc annulla)'],
      ['Maiusc+P', 'Modifica profilo: apre la modale di disegno del Profilo selezionato (anche dal menu contestuale e dalle Proprietà)'],
      ['Maiusc+S', 'Dividi: taglia l\'oggetto in due con un piano perpendicolare a un asse, anche inclinato di un angolo, con connettori per rimontarlo (Invio conferma, Esc annulla)'],
      ['Doppio clic', 'Seleziona l\'oggetto e passa a Sposta'],
      ['Ctrl+G', 'Raggruppa (gli oggetti restano separati)'],
      ['U', 'Unisci in un solo solido (unione booleana)'],
      ['Z', 'Pattern: fora l\'oggetto con celle Voronoi casuali (seme), esagoni, cerchi, rombi o triangoli, da una faccia scelta con il clic (anche inclinata; per altre facce si applica di nuovo); Invio conferma, Esc annulla; il risultato è un gruppo Pattern modificabile'],
      ['O', 'Serie: ripete l\'oggetto in fila, in griglia o in cerchio (Invio conferma, Esc annulla); il risultato è un gruppo Ripetizione modificabile'],
      ['J', 'Inviluppo convesso: la forma più piccola e senza concavità che contiene gli oggetti selezionati'],
      ['Maiusc+J', 'Minkowski: il primo oggetto selezionato si allarga della forma degli altri (somma di Minkowski)'],
      ['F2', 'Rinomina l\'oggetto selezionato'],
      ['Alt+clic', 'Seleziona il singolo oggetto di un gruppo'],
      ['Clic ripetuto', 'Con oggetti sovrapposti, un secondo clic nello stesso punto (dopo mezzo secondo) passa all\'oggetto che sta dietro; un oggetto bloccato viene attraversato dal clic se dietro ce n\'è uno libero'],
      ['Clic destro su un oggetto', 'Menu con i soli comandi applicabili alla selezione (se l\'oggetto non è selezionato lo seleziona)'],
      ['Clic destro nell\'elenco', 'Sulla riga di un oggetto seleziona l\'oggetto e apre lo stesso menu dei comandi; su un oggetto nascosto offre Mostra'],
      ['Clic destro nel vuoto', 'Menu con sottomenu per aggiungere una forma 3D, 2D, un simbolo o un\'emoji nel punto cliccato, più Importa, Esporta, Dimensioni del piano e Benvenuto'],
      ['Sezione Avvisi', 'In fondo alla colonna destra: sbalzi, pareti sottili, parti staccate, oggetti sospesi o fuori dal piano, mesh non valide e formule errate; un clic sull\'avviso seleziona l\'oggetto (sugli sbalzi mostra le zone nella vista); l\'icona a destra lo ignora. Si regola dalle Impostazioni'],
      ['Maniglia tra libreria e oggetti', 'Trascinala per cambiare l\'altezza delle due sezioni della barra sinistra (doppio clic: misura iniziale; frecce su e giù con il fuoco)'],
      ['Doppio clic sul nome di un campo', 'Nel pannello Proprietà apre il selettore del parametro: il campo diventa fx con il valore e si ricalcola al cambio del parametro; per tornare alla modifica manuale, doppio clic e Togli parametro'],
      ['Menu Parametri…', 'Finestra per aggiungere, modificare ed eliminare i parametri del progetto (spessore = 2, altezza = 2 * spessore); la scheda Parametri della barra sinistra li elenca in sola lettura'],
      ['Scheda Piatti', 'Un progetto può avere più piatti, ciascuno con i suoi oggetti: si vede un piatto alla volta; 3MF esporta tutti i piatti, STL chiede quale'],
      ['Clic su una quota', 'Le quote X, Y e Z dell\'oggetto selezionato: si digita la misura in mm (Invio applica, Esc annulla); il lucchetto accanto fa scalare tutti gli assi insieme'],
      ['Ctrl+Maiusc+G', 'Separa il gruppo o l\'unione'],
      ['H', 'Solido / Foro'],
      ['L', 'Blocca / Sblocca'],
      ['Maiusc+H', 'Nascondi la selezione alla radice; senza selezione mostra tutti gli oggetti nascosti'],
      ['B', 'Appoggia sul piatto'],
      ['V', 'Appoggia su una faccia: clic sulla faccia che deve poggiare sul piatto (Esc o V per uscire)'],
      ['Maiusc+V', 'Sdraia: ruota di 90° e riappoggia (in piedi → lungo X → lungo Y → in piedi)'],
      ['K', 'Allinea gli oggetti selezionati: apre la tendina con asse e lato (min, centro, max)'],
      ['Y', 'Specchia gli oggetti selezionati: apre la tendina con gli assi X, Y e Z'],
      ['I', 'Misura: due clic (partenza e arrivo) per la distanza in mm, con aggancio a vertici e spigoli (Esc chiude)'],
      ['X', 'Operandi delle booleane in trasparenza, come # di OpenSCAD'],
      ['Canc o Backspace', 'Elimina'],
      ['Frecce', 'Sposta di 1 mm (Maiusc: 10 mm; Ctrl+Su/Giù: asse Z)'],
    ],
  },
  {
    title: 'Vista',
    rows: [
      ['7', 'Vista dall\'alto'],
      ['1', 'Vista dal fronte'],
      ['3', 'Vista di lato (da destra)'],
      ['0', 'Vista isometrica'],
      ['5', 'Prospettica / ortografica'],
      ['.', 'Inquadra la selezione (o tutta la scena se non c\'è selezione)'],
      ['Home', 'Inquadra tutta la scena (o il piatto se è vuota)'],
    ],
  },
  {
    title: 'Disegno del Profilo (nella modale)',
    rows: [
      ['V / P / H', 'Strumento Seleziona / Penna / Sposta vista (la mano: trascinando si sposta la vista)'],
      ['Penna', 'Clic: spigolo. Clic e trascina: nodo simmetrico con le maniglie. Clic su una curva esistente (senza un contorno in corso): inserisce un nodo, la forma non cambia (Ctrl o ⌘ lo sospende). Clic su un estremo aperto: riprende quel contorno (il trascinamento disegna la maniglia in uscita, liscia); con un contorno in corso lo unisce all\'altro. Clic sul primo nodo: chiude il contorno, anche con due soli punti se uno dei segmenti è curvo (trascinando ne disegni la maniglia, liscia; spigolo con Alt). Invio, doppio clic o Esc: termina. Backspace: toglie l\'ultimo nodo'],
      ['Seleziona', 'Clic o riquadro per scegliere i nodi (Maiusc aggiunge), trascina nodi e maniglie (Alt: finché è premuto il nodo è uno spigolo), clic su una curva per selezionare tutto il contorno (Canc lo elimina, trascinandola lo sposti), doppio clic su un nodo per cambiarne il tipo'],
      ['Canc / Frecce', 'Elimina i nodi selezionati / li sposta di un passo di griglia (Maiusc: dieci passi)'],
      ['Ctrl+Z / Ctrl+Maiusc+Z', 'Annulla e ripeti sul disegno (la scena cambia solo con OK, in un passo)'],
      ['Spazio, tasto centrale o destro', 'Panoramica tenendoli premuti e trascinando; la rotella ingrandisce sul puntatore'],
      ['Inverti asse di simmetria', 'In rotazione, pulsante nella parte non ruotata: specchia la vista in orizzontale (i dati e il solido non cambiano)'],
      ['Maiusc / Ctrl', 'Penna: vincola a 45° / sospende l\'aggancio'],
      ['Alt (Opzione su Mac)', 'Mentre trascini una maniglia, della Penna o di Seleziona, tieni premuto Alt: il nodo diventa uno spigolo e l\'altra maniglia resta ferma. Rilasciandolo prima del mouse il nodo torna al tipo di prima; rilasciando il mouse con Alt premuto resta uno spigolo'],
      ['Esc', 'Termina il contorno della Penna; altrimenti chiede conferma se ci sono modifiche e chiude'],
    ],
  },
  {
    title: 'Generale',
    rows: [
      ['N', 'Nuovo progetto (chiede conferma se la scena non è vuota)'],
      ['Ctrl+Z', 'Annulla'],
      ['Ctrl+Y o Ctrl+Maiusc+Z', 'Ripeti'],
      ['C o Ctrl+J', 'Apre o chiude il codice OpenSCAD'],
      ['D', 'Tema chiaro o scuro'],
      ['M', 'Apre il menu'],
      ['P', 'Piatto: visibile / nascosto'],
      ['Maiusc', 'Durante il trascinamento nella vista 3D: disattiva lo snap'],
    ],
  },
];

// Le versioni si leggono una volta sola: il changelog è incorporato nella build
const releases = parseChangelog(changelogSource);

/** Rende in grassetto il testo tra ** e in monospazio quello tra apici inversi (senza HTML grezzo). */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
        if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
        return part;
      })}
    </>
  );
}

/** Sfondi dell'immagine delle 4 viste: valore, nome e a cosa serve. */
const IMAGE_BACKGROUNDS: [ImageBackground, string, string][] = [
  ['theme', 'Come il tema attuale', 'sfondo e colori come li vedi ora'],
  ['white', 'Bianco', 'per documenti e stampa'],
  ['transparent', 'Trasparente', 'da sovrapporre ad altri fondi'],
];

/** Ultime scelte dell'immagine, ricordate finché la pagina resta aperta. */
let lastImageBackground: ImageBackground = 'theme';

export default function AppMenuPanels({ panel, run }: { panel: Panel; run: (action: () => void | Promise<void>) => () => void }) {
  const scene = useSceneStore((s) => s.scene);
  const setPanel = useUiStore((s) => s.setAppPanel);
  // Con più piatti si esporta anche se il piatto in vista è vuoto: conta ogni piatto
  const hasObjects = allRootIds(scene).length > 0;
  const plates = platesOf(scene);
  // Passo "Quale piatto?" dell'STL: serve solo con più di un piatto
  const [choosingPlate, setChoosingPlate] = useState(false);
  // Passo "Immagine" (sfondo e piatto)
  const [imageStep, setImageStep] = useState(false);
  const [imageBackground, setImageBackground] = useState<ImageBackground>(lastImageBackground);
  const platesWithObjects = plates.filter((p) => p.rootIds.length > 0);
  const [imagePlate, setImagePlate] = useState<string | null>(null);
  // Piatto da fotografare: quello scelto, altrimenti il piatto in vista se ha oggetti, altrimenti il primo che ne ha
  const activeId = scene.activePlateId ?? plates[0]?.id;
  const chosenPlate = platesWithObjects.find((p) => p.id === imagePlate)?.id ?? platesWithObjects.find((p) => p.id === activeId)?.id ?? platesWithObjects[0]?.id;
  return (
    <>
      {panel === 'import' && (
          <>
            <p>Importa file <strong>STL</strong> (binario o ASCII) e <strong>3MF</strong>: le mesh devono essere solidi chiusi. Un file <strong>SVG</strong> diventa invece una forma 2D estrusa (le unità del disegno sono millimetri) e si può ridimensionare dal pannello. Un file <strong>OpenSCAD</strong> (<code>.scad</code>) si legge come codice: cubi, sfere, cilindri, trasformazioni, booleane, <code>for</code>, moduli e <code>linear_extrude</code> diventano oggetti veri; quello che non si capisce si salta con un avviso. Puoi anche trascinare i file direttamente nella finestra.</p>
            <div className="modal__actions">
              <button type="button" className="modal__button modal__button--primary" onClick={run(() => pickAndImport('.stl,.3mf'))}>
                <Upload size={14} />
                STL e 3MF
              </button>
              <button type="button" className="modal__button modal__button--primary" onClick={run(() => pickAndImport('.svg'))}>
                <Shapes size={14} />
                SVG
              </button>
              <button type="button" className="modal__button modal__button--primary" onClick={run(() => pickAndImport('.scad'))}>
                <FileCode size={14} />
                OpenSCAD
              </button>
            </div>
          </>
        )}

      {panel === 'export' && choosingPlate && (
          <>
            <p>L'STL contiene un solo piatto. Quale vuoi esportare?</p>
            <ul className="app-menu__formats" aria-label="Piatti da esportare">
              {plates.map((p) => (
                <li key={p.id}>
                  <button type="button" className="modal__button modal__button--primary" disabled={p.rootIds.length === 0} onClick={run(() => exportStl(p.id))}>
                    <FileDown size={14} />
                    {p.name}
                  </button>
                  <span>{p.rootIds.length === 0 ? 'Vuoto' : p.rootIds.length === 1 ? '1 oggetto' : `${p.rootIds.length} oggetti`}</span>
                </li>
              ))}
            </ul>
            <div className="modal__actions">
              <button type="button" className="modal__button" onClick={() => setChoosingPlate(false)}>
                <ChevronLeft size={14} />
                Indietro
              </button>
            </div>
          </>
        )}

      {panel === 'export' && imageStep && (
          <>
            <p>Un PNG quadrato con quattro viste (alto, fronte, lato, isometrica) in una griglia 2×2, tutte nella stessa scala.</p>
            <fieldset className="app-menu__options">
              <legend>Sfondo</legend>
              {IMAGE_BACKGROUNDS.map(([value, label, hint]) => (
                <label key={value}>
                  <input type="radio" name="image-background" checked={imageBackground === value} onChange={() => setImageBackground(value)} />
                  <span>{label}</span>
                  <small>{hint}</small>
                </label>
              ))}
            </fieldset>
            {plates.length > 1 && (
              <fieldset className="app-menu__options">
                <legend>Piatto</legend>
                {platesWithObjects.map((p) => (
                  <label key={p.id}>
                    <input type="radio" name="image-plate" checked={chosenPlate === p.id} onChange={() => setImagePlate(p.id)} />
                    <span>{p.name}</span>
                    <small>{p.rootIds.length === 1 ? '1 oggetto' : `${p.rootIds.length} oggetti`}</small>
                  </label>
                ))}
              </fieldset>
            )}
            <div className="modal__actions">
              <button type="button" className="modal__button" onClick={() => setImageStep(false)}>
                <ChevronLeft size={14} />
                Indietro
              </button>
              <button
                type="button"
                className="modal__button modal__button--primary"
                disabled={!chosenPlate}
                onClick={run(() => {
                  lastImageBackground = imageBackground;
                  return exportViewsPng({ background: imageBackground, plateId: chosenPlate });
                })}
              >
                <ImageIcon size={14} />
                Esporta
              </button>
            </div>
          </>
        )}

      {panel === 'export' && !choosingPlate && !imageStep && (
          <>
            {!hasObjects && <p>La scena è vuota: aggiungi almeno un oggetto per poter esportare.</p>}
            <ul className="app-menu__formats">
              <li>
                <button type="button" className="modal__button" disabled={!hasObjects} onClick={plates.length > 1 ? () => setChoosingPlate(true) : run(() => exportStl())}>
                  <FileDown size={14} />
                  STL
                </button>
                <span>{plates.length > 1 ? 'Mesh binaria unica di un piatto, a tua scelta: il formato più diffuso per gli slicer.' : 'Mesh binaria unica, il formato più diffuso per gli slicer.'}</span>
              </li>
              <li>
                <button type="button" className="modal__button" disabled={!hasObjects} onClick={run(export3mf)}>
                  <FileBox size={14} />
                  3MF
                </button>
                <span>{plates.length > 1 ? 'Tutti i piatti, affiancati, con un oggetto per ogni colore.' : 'Un oggetto per ogni colore, con i colori conservati.'}</span>
              </li>
              <li>
                <button type="button" className="modal__button" disabled={!hasObjects} onClick={run(exportScad)}>
                  <FileCode size={14} />
                  OpenSCAD
                </button>
                <span>Codice <code>.scad</code> generato dalla scena. Con il testo esce uno ZIP con i font.</span>
              </li>
              <li>
                <button type="button" className="modal__button" disabled={!hasObjects} onClick={() => setImageStep(true)}>
                  <ImageIcon size={14} />
                  Immagine
                </button>
                <span>PNG con 4 viste (alto, fronte, lato, isometrica) in una griglia 2×2; scegli lo sfondo (tema, bianco o trasparente) e il piatto.</span>
              </li>
            </ul>
          </>
        )}

      {panel === 'settings' && <SettingsPanel run={run} />}

      {panel === 'shortcuts' && (
          <div className="app-menu__shortcuts">
            {SHORTCUTS.map((group) => (
              <section key={group.title}>
                <h3>{group.title}</h3>
                <dl>
                  {group.rows.map(([keys, what]) => (
                    <div key={keys}>
                      <dt><kbd>{keys}</kbd></dt>
                      <dd>{what}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        )}

      {panel === 'news' && (
          <div className="app-menu__news">
            {releases.map((r) => (
              <section key={r.version}>
                <h3>v{r.version}</h3>
                {r.notes.map((n) => (
                  <p key={n}><Inline text={n} /></p>
                ))}
                {r.sections.map((sec) => (
                  <div key={sec.title}>
                    <h4>{sec.title}</h4>
                    <ul>
                      {sec.items.map((it) => (
                        <li key={it}><Inline text={it} /></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}

      {panel === 'about' && (
          <div className="app-menu__about">
            {/* Intestazione: nome e versione */}
            <header className="app-menu__about-head">
              <strong className="brand-name">Construct</strong> <span data-testid="about-version">v{__APP_VERSION__}</span>
            </header>
            <p>Un editor CAD 3D nel browser, pensato per chi stampa in 3D: si costruisce da forme semplici con operazioni booleane, raccordi e ripetizioni, e il risultato si esporta pronto per lo slicer o come codice OpenSCAD.</p>

            {/* Su finestre larghe le sezioni stanno su due colonne: elenco a sinistra, il resto a destra */}
            <div className="app-menu__about-cols">
              <div>
                <h4 className="app-menu__about-title">Cosa puoi fare</h4>
            <ul>
              <li>Comporre solidi da forme 3D e 2D, simboli, emoji e testo, e trasformarli con le quote in millimetri.</li>
              <li>Unire, sottrarre, intersecare e forare con le booleane, anche con l&apos;inviluppo convesso.</li>
              <li>Arrotondare e smussare spigoli e angoli, svuotare un solido con il guscio, specchiare e allineare.</li>
              <li>Ripetere un oggetto con serie e pattern (Voronoi, esagoni, cerchi, rombi, triangoli).</li>
              <li>Organizzare più piatti di stampa nello stesso progetto, sul piano della tua stampante.</li>
              <li>Generare il codice OpenSCAD dalla scena e importare file <code>.scad</code>, STL, 3MF e SVG.</li>
              <li>Esportare in STL e 3MF, con i colori e tutti i piatti, e in un\'immagine PNG con le 4 viste.</li>
            </ul>
              </div>
              <div>
                <h4 className="app-menu__about-title">I tuoi dati</h4>
            <p>Tutto resta sul tuo dispositivo: progetti, preferenze e file importati sono salvati nel browser e non vengono mai inviati a un server. Come app installabile (PWA) Construct funziona anche offline.</p>

            <h4 className="app-menu__about-title">Tecnologie</h4>
            <p>Interfaccia in <strong>React</strong>, vista 3D con <strong>React Three Fiber</strong> e <strong>three.js</strong>, geometria calcolata da <strong>manifold-3d</strong> (WebAssembly) in un Web Worker.</p>

            <h4 className="app-menu__about-title">Il progetto</h4>
            <p>
              Il codice è aperto, con licenza MIT: sorgenti, segnalazioni e novità sono su{' '}
              <a href="https://github.com/miziomon/construct" target="_blank" rel="noopener noreferrer">github.com/miziomon/construct</a>.
            </p>

            <h4 className="app-menu__about-title">L&apos;autore</h4>
            <p>
              <strong>Maurizio Pelizzone</strong>, sviluppatore senior PHP e WordPress, con una passione per JavaScript (React, Node, Vite) e Python, fondatore di MAVIDA. Su{' '}
              <a href="https://maurizio.mavida.com" target="_blank" rel="noopener noreferrer">maurizio.mavida.com</a> scrive di sviluppo web e dei suoi progetti.
            </p>
              </div>
            </div>

            <p className="app-menu__about-links">
              <button type="button" className="app-menu__about-link" onClick={() => setPanel('docs')}>Documentazione</button>
              <button type="button" className="app-menu__about-link" onClick={() => setPanel('news')}>Novità</button>
            </p>
          </div>
        )}
    </>
  );
}
