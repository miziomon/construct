import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileBox, FileCode, FileDown, Info, Menu, Sparkles, Upload } from 'lucide-react';
import { useSceneStore } from '../../scene/store';
import { export3mf, exportScad, exportStl } from '../fileActions';
import { pickAndImport } from '../../import/importFile';
import { Modal } from '../Modal/Modal';
import changelogSource from '../../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog';
import './AppMenu.scss';

type Panel = 'import' | 'export' | 'news' | 'about';

const ITEMS: { panel: Panel; label: string; icon: ReactNode }[] = [
  { panel: 'import', label: 'Importa', icon: <Upload size={16} /> },
  { panel: 'export', label: 'Esporta', icon: <FileDown size={16} /> },
  { panel: 'news', label: 'Novità', icon: <Sparkles size={16} /> },
  { panel: 'about', label: 'About', icon: <Info size={16} /> },
];

const TITLES: Record<Panel, string> = { import: 'Importa', export: 'Esporta', news: 'Novità', about: 'About' };

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
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
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
        title="Menu"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Menu size={18} />
      </button>

      {open && (
        <div className="app-menu__list" role="menu">
          {ITEMS.map((item) => (
            <button
              key={item.panel}
              type="button"
              role="menuitem"
              className="app-menu__item"
              onClick={() => {
                setOpen(false);
                setPanel(item.panel);
              }}
            >
              {item.icon}
              {item.label}
            </button>
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
