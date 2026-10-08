import { useState } from 'react';
import { ChevronLeft, FileBox, FileCode, FileDown, Shapes, Upload } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import { allRootIds, platesOf } from '../../scene/plates';
import { export3mf, exportScad, exportStl } from '../fileActions';
import { pickAndImport } from '../../import/importFile';
import changelogSource from '../../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog';
import { SettingsPanel } from '../Settings/SettingsPanel';
import { useUiStore, type AppPanel } from '../uiStore';

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
      ['G', 'Guscio: svuota il solido selezionato (Invio conferma, Esc annulla)'],
      ['Doppio clic', 'Seleziona l\'oggetto e passa a Sposta'],
      ['Ctrl+G', 'Raggruppa (gli oggetti restano separati)'],
      ['U', 'Unisci in un solo solido (unione booleana)'],
      ['Z', 'Pattern: fora l\'oggetto con celle Voronoi casuali (seme), esagoni, cerchi, rombi o triangoli, da una o più facce; Invio conferma, Esc annulla; il risultato è un gruppo Pattern modificabile'],
      ['O', 'Serie: ripete l\'oggetto in fila, in griglia o in cerchio (Invio conferma, Esc annulla); il risultato è un gruppo Ripetizione modificabile'],
      ['J', 'Inviluppo convesso: la forma più piccola e senza concavità che contiene gli oggetti selezionati'],
      ['F2', 'Rinomina l\'oggetto selezionato'],
      ['Alt+clic', 'Seleziona il singolo oggetto di un gruppo'],
      ['Clic destro su un oggetto', 'Menu con i soli comandi applicabili alla selezione (se l\'oggetto non è selezionato lo seleziona)'],
      ['Clic destro nel vuoto', 'Menu con sottomenu per aggiungere una forma 3D, 2D, un simbolo o un\'emoji nel punto cliccato, più Importa, Esporta, Dimensioni del piano e Benvenuto'],
      ['Scheda Piatti', 'Un progetto può avere più piatti, ciascuno con i suoi oggetti: si vede un piatto alla volta; 3MF esporta tutti i piatti, STL chiede quale'],
      ['Clic su una quota', 'Le quote X, Y e Z dell\'oggetto selezionato: si digita la misura in mm (Invio applica, Esc annulla); il lucchetto accanto fa scalare tutti gli assi insieme'],
      ['Ctrl+Maiusc+G', 'Separa il gruppo o l\'unione'],
      ['H', 'Solido / Foro'],
      ['L', 'Blocca / Sblocca'],
      ['B', 'Appoggia sul piatto'],
      ['V', 'Appoggia su una faccia: clic sulla faccia che deve poggiare sul piatto (Esc o V per uscire)'],
      ['K', 'Allinea gli oggetti selezionati: apre la tendina con asse e lato (min, centro, max)'],
      ['Y', 'Specchia gli oggetti selezionati: apre la tendina con gli assi X, Y e Z'],
      ['I', 'Misura: due clic (partenza e arrivo) per la distanza in mm, con aggancio a vertici e spigoli (Esc chiude)'],
      ['X', 'Operandi delle booleane in trasparenza, come # di OpenSCAD'],
      ['Canc o Backspace', 'Elimina'],
      ['Frecce', 'Sposta di 1 mm (Maiusc: 10 mm; Ctrl+Su/Giù: asse Z)'],
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
      ['P', 'Piatto: visibile, senza base, nascosto'],
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

export default function AppMenuPanels({ panel, run }: { panel: Panel; run: (action: () => void | Promise<void>) => () => void }) {
  const scene = useSceneStore((s) => s.scene);
  const setPanel = useUiStore((s) => s.setAppPanel);
  // Con più piatti si esporta anche se il piatto in vista è vuoto: conta ogni piatto
  const hasObjects = allRootIds(scene).length > 0;
  const plates = platesOf(scene);
  // Passo "Quale piatto?" dell'STL: serve solo con più di un piatto
  const [choosingPlate, setChoosingPlate] = useState(false);
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

      {panel === 'export' && !choosingPlate && (
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
              <li>Esportare in STL e 3MF, con i colori e tutti i piatti.</li>
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
