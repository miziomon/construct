import { BookOpen, Box, FilePlus, FolderOpen, Info, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { pickAndImport } from '../../import/importFile';
import { useSceneStore } from '../../scene/store';
import { newProject } from '../fileActions';
import { Modal } from '../Modal/Modal';
import { useUiStore } from '../uiStore';
import { markWelcomed } from './firstVisit';
import './WelcomeDialog.scss';

interface Choice {
  id: string;
  icon: LucideIcon;
  title: string;
  text: string;
  run: () => void | Promise<void>;
}

/** Marchio dell'app: lo stesso cubo del favicon, sul fondo scuro del logo. */
function Mark() {
  return (
    <svg className="welcome__mark" viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#14171c" />
      <path d="M32 10 52 21v22L32 54 12 43V21z" fill="none" stroke="#4da3ff" strokeWidth="4" strokeLinejoin="round" />
      <path d="M12 21l20 11 20-11M32 32v22" fill="none" stroke="#4da3ff" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Schermata di benvenuto del primo avvio (nessun dato salvato dall'app): propone da dove cominciare. Si chiude con la X,
 * con Esc o scegliendo una voce, e non ricompare più (vedi `firstVisit`).
 */
export function WelcomeDialog() {
  const open = useUiStore((s) => s.welcomeOpen);
  const setOpen = useUiStore((s) => s.setWelcomeOpen);
  const always = useUiStore((s) => s.welcomeAlways);
  const setSettings = useUiStore((s) => s.setSettings);
  const setAppPanel = useUiStore((s) => s.setAppPanel);

  const close = () => {
    markWelcomed();
    setOpen(false);
  };

  /** Chiude il benvenuto e apre una modale del menu (Modelli di esempio, Documentazione, About). */
  const openPanel = (panel: 'examples' | 'docs' | 'about') => {
    close();
    setAppPanel(panel);
  };

  const choices: Choice[] = [
    {
      id: 'empty',
      icon: FilePlus,
      title: 'Nuovo progetto',
      text: 'Parti da una scena vuota e costruisci con le forme della libreria.',
      run: async () => {
        await newProject();
      },
    },
    {
      id: 'cube',
      icon: Box,
      title: 'Parti da un cubo',
      text: 'Una scena con un cubo già pronto da ridimensionare, forare e modificare.',
      run: async () => {
        await newProject();
        useSceneStore.getState().addPrimitive('box');
      },
    },
    {
      id: 'import',
      icon: Upload,
      title: 'Importa',
      text: 'Apri un file STL, 3MF, SVG o OpenSCAD e lavoraci sopra.',
      run: () => pickAndImport('.stl,.3mf,.svg,.scad'),
    },
    {
      id: 'examples',
      icon: FolderOpen,
      title: 'Modelli di esempio',
      text: 'Una raccolta di modelli pronti da aprire e studiare.',
      run: () => openPanel('examples'),
    },
  ];

  return (
    <Modal open={open} title="Benvenuto in Construct" onClose={close} variant="welcome">
      <div className="welcome">
        <header className="welcome__hero">
          <Mark />
          <h1 className="welcome__title brand-name">Construct</h1>
          <p className="welcome__tagline">Modellazione 3D per la stampa 3D, direttamente nel tuo browser.</p>
        </header>

        <p className="welcome__lead">Da dove vuoi cominciare?</p>
        <div className="welcome__grid">
          {choices.map(({ id, icon: Icon, title, text, run }) => (
            <button
              key={id}
              type="button"
              className="welcome__card"
              data-choice={id}
              // Il fuoco parte dalla prima scelta, non dalla X di chiusura
              autoFocus={id === 'empty'}
              onClick={() => {
                // Il file picker deve partire dal clic: si chiude e si esegue nello stesso gestore
                close();
                void run();
              }}
            >
              <span className="welcome__icon"><Icon size={22} strokeWidth={1.75} /></span>
              <span className="welcome__card-title">{title}</span>
              <span className="welcome__card-text">{text}</span>
            </button>
          ))}
        </div>

        {/* Documentazione e About: due pulsanti ben visibili sotto le schede */}
        <div className="welcome__secondary">
          <button type="button" className="welcome__button" onClick={() => openPanel('docs')}>
            <BookOpen size={16} strokeWidth={1.75} />
            Documentazione
          </button>
          <button type="button" className="welcome__button" onClick={() => openPanel('about')}>
            <Info size={16} strokeWidth={1.75} />
            About
          </button>
        </div>

        <p className="welcome__foot">Tutto resta sul tuo dispositivo e Construct funziona anche offline.</p>

        <div className="welcome__bar">
          {/* Stessa impostazione del pannello Impostazioni */}
          <label className="welcome__always">
            <input type="checkbox" checked={always} onChange={(e) => setSettings({ welcomeAlways: e.target.checked })} />
            Mostra ogni volta
          </label>
        </div>
      </div>
    </Modal>
  );
}
