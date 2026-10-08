import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, FileDown, FilePlus, FolderOpen, House, Info, Keyboard, Menu, Save, SaveAll, Settings, Sparkles, Upload } from 'lucide-react';
import { useUiStore } from '../uiStore';
import { newProject, openProject, saveProject, saveProjectAs } from '../fileActions';
import type { Panel } from './AppMenuPanels';
import { Modal } from '../Modal/Modal';
import { lazyLoad } from '../lazyLoad';
import { migrateLocalKey, STORAGE } from '../../storageMigration';
// Il corpo delle modali (scorciatoie, changelog, esportazione) si scarica solo alla prima apertura
const AppMenuPanels = lazyLoad(() => import('./AppMenuPanels'));
// La documentazione è un modulo a parte: il manuale e le sue immagini si scaricano solo aprendola
const DocsPanel = lazyLoad(() => import('../Docs/DocsPanel'));
import './AppMenu.scss';


/** Voce del menu: apre una modale (panel) oppure esegue subito un'azione. */
type Item = { label: string; icon: ReactNode; panel: Panel; action?: undefined } | { label: string; icon: ReactNode; action: () => void; panel?: undefined };

/** Gruppi di voci, separati da una linea. */
const GROUPS: Item[][] = [
  [
    { label: 'Nuovo progetto', icon: <FilePlus size={16} />, action: () => void newProject() },
    { label: 'Apri progetto…', icon: <FolderOpen size={16} />, action: openProject },
    { label: 'Salva progetto', icon: <Save size={16} />, action: () => void saveProject() },
    { label: 'Salva con nome…', icon: <SaveAll size={16} />, action: () => void saveProjectAs() },
  ],
  [
    { panel: 'import', label: 'Importa', icon: <Upload size={16} /> },
    { panel: 'export', label: 'Esporta', icon: <FileDown size={16} /> },
  ],
  [
    { panel: 'settings', label: 'Impostazioni', icon: <Settings size={16} /> },
    { label: 'Schermata di benvenuto', icon: <House size={16} />, action: () => useUiStore.getState().setWelcomeOpen(true) },
    { panel: 'docs', label: 'Documentazione', icon: <BookOpen size={16} /> },
    { panel: 'shortcuts', label: 'Scorciatoie da tastiera', icon: <Keyboard size={16} /> },
    { panel: 'news', label: 'Novità', icon: <Sparkles size={16} /> },
    { panel: 'about', label: 'About', icon: <Info size={16} /> },
  ],
];

const TITLES: Record<Panel, string> = { import: 'Importa', export: 'Esporta', settings: 'Impostazioni', shortcuts: 'Scorciatoie da tastiera', news: 'Novità', about: 'About', docs: 'Documentazione' };

/** Ultima versione le cui Novità sono state viste: serve al badge "nuovo". */
const SEEN_KEY = STORAGE.seen.now;
migrateLocalKey(STORAGE.seen.legacy, SEEN_KEY);

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

/** Menu hamburger dell'header: ogni voce apre una modale. */
export function AppMenu() {
  const open = useUiStore((s) => s.menuOpen);
  const setOpen = useUiStore((s) => s.setMenuOpen);
  // Il pannello aperto sta nello store: il menu contestuale della vista apre Importa ed Esporta da fuori
  const panel = useUiStore((s) => s.appPanel);
  const setPanel = useUiStore((s) => s.setAppPanel);
  const [news, setNews] = useState(hasUnseenNews);
  const root = useRef<HTMLDivElement>(null);

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

      <Modal open={panel !== null} title={panel ? TITLES[panel] : ''} onClose={close} size={panel === 'shortcuts' || panel === 'news' || panel === 'docs' ? 'large' : 'default'}>
        {panel && (
          <Suspense fallback={<p>Caricamento…</p>}>
            {panel === 'docs' ? <DocsPanel /> : <AppMenuPanels panel={panel} run={run} />}
          </Suspense>
        )}
      </Modal>
    </div>
  );
}
