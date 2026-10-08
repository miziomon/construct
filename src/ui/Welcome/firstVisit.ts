import { STORAGE } from '../../storageMigration';

/**
 * Primo avvio: nessun valore salvato dall'app, né con il nome attuale né con quello precedente. Si calcola una volta
 * sola, all'avvio, prima che gli store scrivano in localStorage (altrimenti la chiave `construct:ui` esisterebbe già).
 * In `main.tsx` questo modulo va importato prima di App.
 */
export const isFirstVisit: boolean = (() => {
  try {
    return [STORAGE.ui.now, STORAGE.ui.legacy, STORAGE.welcomed].every((key) => localStorage.getItem(key) === null);
  } catch {
    // Senza localStorage non si può ricordare che il benvenuto è stato visto: non lo si mostra ogni volta
    return false;
  }
})();

/** Segna il benvenuto come visto: dal prossimo avvio non compare più. */
export function markWelcomed(): void {
  try {
    localStorage.setItem(STORAGE.welcomed, '1');
  } catch {
    // Nessun danno: al prossimo avvio comparirà di nuovo
  }
}
