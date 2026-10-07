import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, confirmDialog, confirmWithOption, dismissToast, notify, promptDialog, setConfirmOption, setPromptText, useNotifyStore } from './notifyStore';

afterEach(() => {
  vi.useRealTimers();
  useNotifyStore.setState({ toasts: [], confirm: undefined });
});

describe('notifyStore', () => {
  it('aggiunge un toast e lo rimuove da solo dopo la sua durata', () => {
    vi.useFakeTimers();
    notify.info('Fatto');
    expect(useNotifyStore.getState().toasts.map((t) => t.text)).toEqual(['Fatto']);
    vi.advanceTimersByTime(4001);
    expect(useNotifyStore.getState().toasts).toHaveLength(0);
  });

  it('gli errori durano più a lungo e si possono chiudere a mano', () => {
    vi.useFakeTimers();
    notify.error('Ops');
    vi.advanceTimersByTime(4001);
    const [toast] = useNotifyStore.getState().toasts;
    expect(toast.kind).toBe('error');
    dismissToast(toast.id);
    expect(useNotifyStore.getState().toasts).toHaveLength(0);
  });

  it('confirmDialog si risolve con la risposta e una nuova richiesta annulla la precedente', async () => {
    const first = confirmDialog('Primo?');
    const second = confirmDialog('Secondo?');
    expect(await first).toBe(false);
    answerConfirm(true);
    expect(await second).toBe(true);
    expect(useNotifyStore.getState().confirm).toBeUndefined();
  });

  it('promptDialog restituisce il testo scritto, il valore proposto se non si cambia, null se si annulla', async () => {
    const typed = promptDialog('Nome?', 'proposto.json', 'Salva');
    expect(useNotifyStore.getState().confirm?.text).toBe('proposto.json');
    setPromptText('scelto.json');
    answerConfirm(true);
    expect(await typed).toBe('scelto.json');

    const untouched = promptDialog('Nome?', 'proposto.json');
    answerConfirm(true);
    expect(await untouched).toBe('proposto.json');

    const cancelled = promptDialog('Nome?', 'proposto.json');
    setPromptText('qualcosa');
    answerConfirm(false);
    expect(await cancelled).toBeNull();
  });

  it('confirmWithOption restituisce lo stato della casella solo se si conferma', async () => {
    const checked = confirmWithOption('Svuotare?', 'Svuota', 'Anche la cronologia');
    // All'apertura la casella non è spuntata
    expect(useNotifyStore.getState().confirm?.option).toEqual({ label: 'Anche la cronologia', checked: false });
    setConfirmOption(true);
    answerConfirm(true);
    expect(await checked).toEqual({ ok: true, checked: true });

    // Annullando, la casella spuntata non conta
    const cancelled = confirmWithOption('Svuotare?', 'Svuota', 'Anche la cronologia');
    setConfirmOption(true);
    answerConfirm(false);
    expect(await cancelled).toEqual({ ok: false, checked: false });
  });
});
