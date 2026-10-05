import { create } from 'zustand';

export type ToastKind = 'info' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

interface NotifyState {
  toasts: Toast[];
  /** Richiesta di conferma in corso (una alla volta). */
  confirm?: ConfirmRequest;
}

export const useNotifyStore = create<NotifyState>(() => ({ toasts: [] }));

let nextId = 1;
// Gli errori restano visibili più a lungo delle informazioni
const LIFETIME_MS: Record<ToastKind, number> = { info: 4000, error: 8000 };

export function dismissToast(id: number): void {
  useNotifyStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

function push(kind: ToastKind, text: string): void {
  const id = nextId++;
  useNotifyStore.setState((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(() => dismissToast(id), LIFETIME_MS[kind]);
}

/** Notifiche non bloccanti, al posto di alert(). */
export const notify = {
  info: (text: string) => push('info', text),
  error: (text: string) => push('error', text),
};

/** Finestra di conferma, al posto di confirm(): restituisce true se l'utente conferma. */
export function confirmDialog(message: string, confirmLabel = 'Conferma'): Promise<boolean> {
  return new Promise((resolve) => {
    // Una nuova richiesta annulla quella ancora aperta
    useNotifyStore.getState().confirm?.resolve(false);
    useNotifyStore.setState({ confirm: { message, confirmLabel, resolve } });
  });
}

/** Chiude la finestra di conferma con la risposta dell'utente. */
export function answerConfirm(ok: boolean): void {
  const request = useNotifyStore.getState().confirm;
  useNotifyStore.setState({ confirm: undefined });
  request?.resolve(ok);
}
