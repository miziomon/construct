import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './ToolTip.scss';

interface Props {
  /** Testo del tooltip (una riga). */
  text: string;
  /** Ritardo prima che compaia (ms). */
  delay?: number;
  /** Il controllo a cui il tooltip è collegato; riceve l'id per `aria-describedby`. */
  children: (describedBy: string) => ReactNode;
}

/**
 * Tooltip leggero di una riga, sopra il controllo (per gli elementi in basso nella finestra, come la timeline).
 * Stessa logica di `ToolTip` (ritardo, mouse e tastiera, Esc, funziona anche sui pulsanti disabilitati) ma senza la scheda
 * di aiuto della barra strumenti.
 */
export function HoverTip({ text, delay = 150, children }: Props) {
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect) return;
      // Centrato sopra il controllo, senza uscire dai lati della finestra (il testo è centrato con una traslazione)
      const half = Math.min(150, window.innerWidth / 2 - 8);
      setPos({ left: Math.min(Math.max(half + 8, rect.left + rect.width / 2), window.innerWidth - half - 8), top: rect.top - 8 });
    }, delay);
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
        <span id={id} role="tooltip" className="tooltip tooltip--compact" style={{ left: pos.left, top: pos.top }}>
          {text}
        </span>
      )}
    </span>
  );
}
