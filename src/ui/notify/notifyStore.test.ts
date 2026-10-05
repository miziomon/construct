import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, confirmDialog, dismissToast, notify, useNotifyStore } from './notifyStore';

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
});
