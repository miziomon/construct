import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileBox, FileCode, FileDown, FilePlus, FolderOpen, Info, Keyboard, Menu, Save, Sparkles, Upload } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import { useUiStore } from '../uiStore';
import { export3mf, exportScad, exportStl, newProject, openProject, saveProject } from '../fileActions';
import { pickAndImport } from '../../import/importFile';
import { Modal } from '../Modal/Modal';
import changelogSource from '../../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog';
import './AppMenu.scss';

type Panel = 'import' | 'export' | 'shortcuts' | 'news' | 'about';

/** Voce del menu: apre una modale (panel) oppure esegue subito un'azione. */
type Item = { label: string; icon: ReactNode; panel: Panel; action?: undefined } | { label: string; icon: ReactNode; action: () => void; panel?: undefined };

/** Gruppi di voci, separati da una linea. */
const GROUPS: Item[][] = [
  [
    { label: 'Nuovo progetto', icon: <FilePlus size={16} />, action: () => void newProject() },
    { label: 'Apri progetto…', icon: <FolderOpen size={16} />, action: openProject },
    { label: 'Salva progetto', icon: <Save size={16} />, action: saveProject },
  ],
  [
    { panel: 'import', label: 'Importa', icon: <Upload size={16} /> },
    { panel: 'export', label: 'Esporta', icon: <FileDown size={16} /> },
  ],
  [
    { panel: 'shortcuts', label: 'Scorciatoie da tastiera', icon: <Keyboard size={16} /> },
    { panel: 'news', label: 'Novità', icon: <Sparkles size={16} /> },
    { panel: 'about', label: 'About', icon: <Info size={16} /> },
  ],
];

const TITLES: Record<Panel, string> = { import: 'Importa', export: 'Esporta', shortcuts: 'Scorciatoie da tastiera', news: 'Novità', about: 'About' };

/** Scorciatoie da tastiera (le stesse di src/hooks/useShortcuts.ts), raggruppate per argomento. */
const SHORTCUTS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Strumenti',
    rows: [
      ['Q', 'Seleziona'],
      ['W', 'Sposta'],
      ['E', 'Ruota'],
      ['R', 'Ridimensiona con il mouse'],
      ['T', 'Estrudi forme 2D con il mouse'],
    ],
  },
  {
    title: 'Oggetti',
    rows: [
      ['Ctrl+D', 'Duplica'],
      ['F', 'Raccordo tra due superfici (Invio conferma, Esc annulla)'],
      ['S', 'Smusso tra due superfici (Invio conferma, Esc annulla)'],
      ['Ctrl+G', 'Raggruppa (gli oggetti restano separati)'],
      ['U', 'Unisci in un solo solido (unione booleana)'],
      ['F2', 'Rinomina l\'oggetto selezionato'],
      ['Alt+clic', 'Seleziona il singolo oggetto di un gruppo'],
      ['Ctrl+Maiusc+G', 'Separa il gruppo o l\'unione'],
      ['H', 'Solido / Foro'],
      ['L', 'Blocca / Sblocca'],
      ['B', 'Appoggia sul piatto'],
      ['Canc o Backspace', 'Elimina'],
      ['Frecce', 'Sposta di 1 mm (Maiusc: 10 mm; Ctrl+Su/Giù: asse Z)'],
    ],
  },
  {
    title: 'Generale',
    rows: [
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

/** Ultima versione le cui Novità sono state viste: serve al badge "nuovo". */
const SEEN_KEY = 'webcad:lastSeenVersion';

/** True se dopo l'ultimo accesso c'è stato un aggiornamento (al primo avvio no). Il localStorage può non essere disponibile. */
function hasUnseenNews(): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    if (seen === null) {
      localStorage.setItem(SEEN_KEY, __APP_VERSION__);
      return false;
    }
    return seen !== __APP_VERSION__;
  } catch {
    return false;
  }
}

function markNewsSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, __APP_VERSION__);
  } catch {
    // Senza localStorage il badge torna a ogni avvio: nessun danno
  }
}

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

/** Menu hamburger dell'header: ogni voce apre una modale. */
export function AppMenu() {
  const open = useUiStore((s) => s.menuOpen);
  const setOpen = useUiStore((s) => s.setMenuOpen);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [news, setNews] = useState(hasUnseenNews);
  const root = useRef<HTMLDivElement>(null);
  const hasObjects = useSceneStore((s) => s.scene.rootIds.length > 0);

  // Il menu a tendina si chiude con un click fuori o con Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setPanel(null);

  /** Esegue l'azione e chiude la modale. */
  const run = (action: () => void | Promise<void>) => () => {
    close();
    void action();
  };

  return (
    <div className="app-menu" ref={root}>
      <button
        type="button"
        className="app-menu__toggle"
        title="Menu (M)"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Menu size={18} />
        {news && <span className="app-menu__dot" aria-label="Ci sono novità" />}
      </button>

      {open && (
        <div className="app-menu__list" role="menu">
          {GROUPS.map((group, g) => (
            <div key={g} className="app-menu__group" role="none">
              {group.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className="app-menu__item"
                  onClick={() => {
                    setOpen(false);
                    if (item.action) return item.action();
                    if (item.panel === 'news') {
                      markNewsSeen();
                      setNews(false);
                    }
                    setPanel(item.panel);
                  }}
                >
                  {item.icon}
                  {item.label}
                  {item.panel === 'news' && news && <span className="app-menu__new">nuovo</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <Modal open={panel !== null} title={panel ? TITLES[panel] : ''} onClose={close}>
        {panel === 'import' && (
          <>
            <p>Importa file <strong>STL</strong> (binario o ASCII) e <strong>3MF</strong>. Le mesh devono essere solidi chiusi. Puoi anche trascinare i file direttamente nella finestra.</p>
            <div className="modal__actions">
              <button type="button" className="modal__button modal__button--primary" onClick={run(pickAndImport)}>
                <Upload size={14} />
                Scegli file STL o 3MF…
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
                <span>Codice <code>.scad</code> generato dalla scena.</span>
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
            <p>Modellazione 3D da primitive con operazioni booleane, pensata per chi stampa in 3D. Piatto di stampa 256 × 256 mm, export STL e 3MF.</p>
            <p>Costruito con React, three.js e manifold-3d. Sviluppato da MAVIDA.</p>
          </>
        )}
      </Modal>
    </div>
  );
}
