import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { answerConfirm, dismissToast, useNotifyStore } from './notifyStore';
import './Notifications.scss';

/** Toast in basso a sinistra e finestra di conferma modale (elemento <dialog> nativo, gestisce focus e Esc). */
export function Notifications() {
  const toasts = useNotifyStore((s) => s.toasts);
  const confirm = useNotifyStore((s) => s.confirm);
  const dialog = useRef<HTMLDialogElement>(null);

  // Apre e chiude il dialog nativo in base alla richiesta di conferma
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (confirm && !el.open) el.showModal();
    if (!confirm && el.open) el.close();
  }, [confirm]);

  return (
    <>
      <div className="toast-list" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast__text">{t.text}</span>
            <button type="button" className="toast__close" aria-label="Chiudi" onClick={() => dismissToast(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <dialog ref={dialog} className="dialog" onCancel={(e) => { e.preventDefault(); answerConfirm(false); }}>
        <p className="dialog__message">{confirm?.message}</p>
        <div className="dialog__actions">
          <button type="button" className="dialog__button" onClick={() => answerConfirm(false)}>Annulla</button>
          <button type="button" className="dialog__button dialog__button--primary" onClick={() => answerConfirm(true)}>
            {confirm?.confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
