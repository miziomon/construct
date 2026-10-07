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
  /** `text` è il contenuto del campo di testo e `checked` lo stato della casella, se la finestra li ha. */
  resolve: (ok: boolean, text?: string, checked?: boolean) => void;
  /** Testo del campo: se definito, la finestra mostra un campo di testo con questo valore. */
  text?: string;
  /** Casella opzionale sotto il messaggio (vedi `confirmWithOption`). */
  option?: { label: string; checked: boolean };
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
    useNotifyStore.setState({ confirm: { message, confirmLabel, resolve: (ok) => resolve(ok) } });
  });
}

/** Finestra di conferma con una casella da spuntare: restituisce la risposta e lo stato della casella (non spuntata all'apertura). */
export function confirmWithOption(message: string, confirmLabel: string, optionLabel: string): Promise<{ ok: boolean; checked: boolean }> {
  return new Promise((resolve) => {
    useNotifyStore.getState().confirm?.resolve(false);
    useNotifyStore.setState({
      confirm: { message, confirmLabel, option: { label: optionLabel, checked: false }, resolve: (ok, _text, checked) => resolve({ ok, checked: ok && !!checked }) },
    });
  });
}

/** Aggiorna lo stato della casella della finestra di conferma. */
export function setConfirmOption(checked: boolean): void {
  const request = useNotifyStore.getState().confirm;
  if (request?.option) useNotifyStore.setState({ confirm: { ...request, option: { ...request.option, checked } } });
}

/** Finestra con un campo di testo, al posto di prompt(): restituisce il testo, oppure null se si annulla. */
export function promptDialog(message: string, defaultValue: string, confirmLabel = 'Conferma'): Promise<string | null> {
  return new Promise((resolve) => {
    useNotifyStore.getState().confirm?.resolve(false);
    useNotifyStore.setState({ confirm: { message, confirmLabel, text: defaultValue, resolve: (ok, text) => resolve(ok ? (text ?? defaultValue) : null) } });
  });
}

/** Aggiorna il testo del campo mentre si scrive. */
export function setPromptText(text: string): void {
  const request = useNotifyStore.getState().confirm;
  if (request) useNotifyStore.setState({ confirm: { ...request, text } });
}

/** Chiude la finestra di conferma con la risposta dell'utente. */
export function answerConfirm(ok: boolean): void {
  const request = useNotifyStore.getState().confirm;
  useNotifyStore.setState({ confirm: undefined });
  request?.resolve(ok, request.text, request.option?.checked);
}
