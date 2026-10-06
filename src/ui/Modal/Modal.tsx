import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './Modal.scss';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Se false Esc, la X e il click sullo sfondo non chiudono la finestra (es. aggiornamento obbligatorio). */
  dismissable?: boolean;
}

/** Finestra modale su <dialog> nativo: gestisce da sola focus, Esc e blocco dello sfondo. */
export function Modal({ open, title, onClose, children, dismissable = true }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  // Apre e chiude il dialog nativo in base alla prop "open"
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="modal-title"
      // Esc: chiude solo se consentito
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      // Click sullo sfondo (il target è il dialog stesso, non un suo figlio)
      onClick={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <header className="modal__header">
            <h2 className="modal__title" id="modal-title">{title}</h2>
            {dismissable && (
              <button type="button" className="modal__close" aria-label="Chiudi" onClick={onClose}>
                <X size={16} />
              </button>
            )}
          </header>
          <div className="modal__body">{children}</div>
        </>
      )}
    </dialog>
  );
}
