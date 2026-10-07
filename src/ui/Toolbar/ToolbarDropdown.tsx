import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useUiStore } from '../uiStore';
import type { ToolbarMenu } from '../uiStore';

interface Props {
  /** Identificatore della tendina: lo stato aperto/chiuso sta nello store, così si apre anche con la scorciatoia. */
  id: ToolbarMenu;
  title: string;
  /** Scorciatoia da tastiera, mostrata in piccolo sopra l'icona. */
  shortcut?: string;
  /** Icona del pulsante. */
  icon: ReactNode;
  disabled?: boolean;
  /** Contenuto della tendina; `close` la chiude dopo la scelta. */
  children: (close: () => void) => ReactNode;
}

/** Pulsante della toolbar che apre una piccola tendina; si chiude con un clic fuori o con Esc. */
export function ToolbarDropdown({ id, title, shortcut, icon, disabled, children }: Props) {
  const open = useUiStore((s) => s.toolbarMenu === id);
  const setToolbarMenu = useUiStore((s) => s.setToolbarMenu);
  const setOpen = (value: boolean) => setToolbarMenu(value ? id : null);
  const ref = useRef<HTMLDivElement>(null);

  // Se il pulsante si disabilita (la selezione è cambiata) la tendina non deve restare aperta in attesa
  useEffect(() => {
    if (disabled && open) setToolbarMenu(null);
  }, [disabled, open, setToolbarMenu]);

  useEffect(() => {
    if (!open) return;
    // Clic fuori dalla tendina oppure Esc: si chiude
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setToolbarMenu]);

  const isOpen = open && !disabled;

  return (
    <div className="toolbar__dropdown" ref={ref}>
      <button
        type="button"
        className={`toolbar__button${isOpen ? ' toolbar__button--active' : ''}`}
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {shortcut && <span className="toolbar__shortcut" aria-hidden="true">{shortcut}</span>}
        {icon}
      </button>
      {isOpen && (
        <div className="toolbar__dropdown-panel" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
