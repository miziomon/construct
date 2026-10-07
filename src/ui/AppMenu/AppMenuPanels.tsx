import { FileBox, FileCode, FileDown, Shapes, Upload } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import { export3mf, exportScad, exportStl } from '../fileActions';
import { pickAndImport } from '../../import/importFile';
import changelogSource from '../../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog';

/**
 * Corpo delle modali del menu (Importa, Esporta, Scorciatoie, Novità, About). Sta in un modulo a parte, caricato solo
 * quando si apre una modale: la tabella delle scorciatoie e il changelog incorporato non pesano sull'avvio dell'app.
 */
export type Panel = 'import' | 'export' | 'shortcuts' | 'news' | 'about';

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
  const hasObjects = useSceneStore((s) => s.scene.rootIds.length > 0);
  return (
    <>
      {panel === 'import' && (
          <>
            <p>Importa file <strong>STL</strong> (binario o ASCII) e <strong>3MF</strong>: le mesh devono essere solidi chiusi. Un file <strong>SVG</strong> diventa invece una forma 2D estrusa (le unità del disegno sono millimetri) e si può ridimensionare dal pannello. Puoi anche trascinare i file direttamente nella finestra.</p>
            <div className="modal__actions">
              <button type="button" className="modal__button modal__button--primary" onClick={run(() => pickAndImport('.stl,.3mf'))}>
                <Upload size={14} />
                Scegli file STL o 3MF…
              </button>
              <button type="button" className="modal__button modal__button--primary" onClick={run(() => pickAndImport('.svg'))}>
                <Shapes size={14} />
                Importa SVG…
              </button>
            </div>
          </>
        )}

      {panel === 'export' && (
          <>
            {!hasObjects && <p>La scena è vuota: aggiungi almeno un oggetto per poter esportare.</p>}
            <ul className="app-menu__formats">
              <li>
                <button type="button" className="modal__button" disabled={!hasObjects} onClick={run(exportStl)}>
                  <FileDown size={14} />
                  STL
                </button>
                <span>Mesh binaria unica, il formato più diffuso per gli slicer.</span>
              </li>
              <li>
                <button type="button" className="modal__button" disabled={!hasObjects} onClick={run(export3mf)}>
                  <FileBox size={14} />
                  3MF
                </button>
                <span>Un oggetto per ogni colore, con i colori conservati.</span>
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
                <h3>
                  v{r.version} <small>{r.date}</small>
                </h3>
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
          <>
            <p><strong>WebCAD</strong> <span data-testid="about-version">v{__APP_VERSION__}</span></p>
            <p>Modellazione 3D da primitive con operazioni booleane, pensata per chi stampa in 3D. Piatto di stampa modificabile dalla barra di stato (256 × 256 mm di default), export STL e 3MF.</p>
            <p>Costruito con React, three.js e manifold-3d. Sviluppato da MAVIDA.</p>
          </>
        )}
    </>
  );
}
