import { suspendAutosave } from '../../scene/persistence';

/** Chiavi di localStorage dell'app, con il nome attuale (construct:) e con quello precedente (webcad:). */
const isOurKey = (key: string) => key.startsWith('construct:') || key.startsWith('webcad:');

/** Quante chiavi di localStorage ha salvato l'app e quanti byte occupano (per dirlo nel pannello). */
export function localDataSummary(): { keys: number; bytes: number } {
  let keys = 0;
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isOurKey(key)) continue;
      keys++;
      bytes += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
  } catch {
    // Senza localStorage non c'è nulla da contare
  }
  return { keys, bytes };
}

/** Spazio usato dall'app nel browser (progetto, mesh importate, cache offline), se il browser lo sa dire. */
export async function storageUsage(): Promise<number | null> {
  try {
    return (await navigator.storage?.estimate?.())?.usage ?? null;
  } catch {
    return null;
  }
}

/** Elimina un database IndexedDB: se è aperto da questa pagina l'eliminazione parte alla chiusura, non si aspetta oltre. */
const deleteDatabase = (name: string) =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });

/**
 * Pulizia completa: cancella tutto ciò che l'app ha salvato nel browser (localStorage e IndexedDB, quindi preferenze,
 * scena salvata automaticamente e mesh importate) e ricarica la pagina, che riparte come al primo avvio. I file di
 * progetto salvati sul computer non si toccano.
 */
export async function wipeAllData(): Promise<void> {
  // Il salvataggio automatico non deve riscrivere la scena mentre si cancella
  suspendAutosave();
  try {
    for (const key of Object.keys(localStorage).filter(isOurKey)) localStorage.removeItem(key);
  } catch {
    // niente localStorage
  }
  try {
    const databases = (await indexedDB.databases?.()) ?? [];
    await Promise.all(databases.map((d) => (d.name ? deleteDatabase(d.name) : undefined)));
  } catch {
    // IndexedDB non disponibile: resta solo localStorage, già pulito
  }
  location.reload();
}
