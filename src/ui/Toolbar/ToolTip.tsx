import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { TOOLBAR_HELP } from './toolbarHelp';
import type { HelpKey } from './toolbarHelp';
import './ToolTip.scss';

/** Ritardo prima che il tooltip compaia (ms): evita che lampeggi passando sopra la barra. */
const SHOW_DELAY = 400;
/** Larghezza del tooltip (px), per tenerlo dentro la finestra. */
const WIDTH = 300;

interface Props {
  /** Voce di aiuto da mostrare. */
  help: HelpKey;
  /** Scorciatoia da tastiera da mostrare accanto al nome (testo già pronto, per esempio "Ctrl+Z"). */
  keys?: string;
  /** Testo in più, per i pulsanti il cui stato cambia (per esempio il piatto). */
  extra?: string;
  /** Il pulsante (o la tendina) a cui il tooltip è collegato. */
  children: (describedBy: string) => ReactNode;
}

/**
 * Tooltip dettagliato di un pulsante della barra: nome e scorciatoia, cosa fa, come si applica ed eventuale immagine di
 * esempio. Compare dopo un breve ritardo al passaggio del mouse o con il focus da tastiera e sparisce con Esc.
 * Sta fuori dal pulsante (che può essere disabilitato e non riceve eventi): lo avvolge un contenitore.
 */
export function ToolTip({ help, keys, extra, children }: Props) {
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const entry = TOOLBAR_HELP[help];

  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect) return;
      // Sotto il pulsante, centrato, ma sempre dentro la finestra
      const left = Math.min(Math.max(8, rect.left + rect.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
      setPos({ left, top: rect.bottom + 8 });
    }, SHOW_DELAY);
  };

  // Esc chiude il tooltip; il timer non deve sopravvivere allo smontaggio
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pos]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span className="tooltip-host" ref={box} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onPointerDown={hide}>
      {children(id)}
      {pos && (
        <span id={id} role="tooltip" className="tooltip" style={{ left: pos.left, top: pos.top, width: WIDTH }}>
          <span className="tooltip__title">
            {entry.name}
            {keys && <kbd className="tooltip__keys">{keys}</kbd>}
          </span>
          <span className="tooltip__text">{entry.what}</span>
          <span className="tooltip__text tooltip__text--how">{entry.how}</span>
          {extra && <span className="tooltip__text tooltip__text--extra">{extra}</span>}
          {entry.image && <img className="tooltip__image" src={`${import.meta.env.BASE_URL}help/${entry.image}.webp`} alt={`Esempio: ${entry.name}`} width={WIDTH - 20} loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        </span>
      )}
    </span>
  );
}
