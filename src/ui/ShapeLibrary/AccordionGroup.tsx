import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUiStore } from '../uiStore';

interface Props {
  /** Chiave con cui si ricorda se il gruppo è aperto (es. `symbols:Frecce`). */
  id: string;
  title: string;
  /** Quanti elementi contiene, mostrato accanto al titolo. */
  count?: number;
  /** Aperto la prima volta (finché l'utente non lo cambia). */
  defaultOpen?: boolean;
  /** Forza l'apertura senza toccare lo stato salvato (es. mentre si cerca). */
  forceOpen?: boolean;
  children: ReactNode;
}

/**
 * Gruppo a fisarmonica delle tab Simboli ed Emoji: il titolo è un pulsante (`aria-expanded`) che apre e chiude il
 * contenuto. Lo stato aperto/chiuso si ricorda per gruppo (localStorage).
 */
export function AccordionGroup({ id, title, count, defaultOpen = false, forceOpen = false, children }: Props) {
  const stored = useUiStore((s) => s.libraryGroupsOpen[id]);
  const setOpen = useUiStore((s) => s.setLibraryGroupOpen);
  const open = forceOpen || (stored ?? defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  const bodyId = `accordion-${id.replace(/[^a-z0-9]+/gi, '-')}`;
  return (
    <section className="accordion">
      <h3 className="accordion__heading">
        <button type="button" className="accordion__title" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(id, !open)}>
          <Chevron size={14} aria-hidden="true" />
          <span className="accordion__label">{title}</span>
          {count !== undefined && <span className="accordion__count">{count}</span>}
        </button>
      </h3>
      {open && (
        <div id={bodyId} className="accordion__body">
          {children}
        </div>
      )}
    </section>
  );
}
