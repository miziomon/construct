import { Box, FilePlus, FolderOpen, Upload } from 'lucide-react';
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
  /** Scelta non ancora disponibile: la scheda si vede ma non si può premere. */
  soon?: boolean;
  run?: () => void | Promise<void>;
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

  const close = () => {
    markWelcomed();
    setOpen(false);
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
      soon: true,
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
          {choices.map(({ id, icon: Icon, title, text, soon, run }) => (
            <button
              key={id}
              type="button"
              className="welcome__card"
              data-choice={id}
              disabled={soon}
              // Il fuoco parte dalla prima scelta, non dalla X di chiusura
              autoFocus={id === 'empty'}
              onClick={() => {
                // Il file picker deve partire dal clic: si chiude e si esegue nello stesso gestore
                close();
                void run?.();
              }}
            >
              <span className="welcome__icon"><Icon size={22} strokeWidth={1.75} /></span>
              <span className="welcome__card-title">
                {title}
                {soon && <span className="welcome__soon">Presto</span>}
              </span>
              <span className="welcome__card-text">{text}</span>
            </button>
          ))}
        </div>

        <p className="welcome__foot">Tutto resta sul tuo dispositivo e Construct funziona anche offline.</p>
      </div>
    </Modal>
  );
}
