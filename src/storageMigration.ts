/**
 * Migrazione dei dati salvati dal vecchio nome dell'app (WebCAD) a quello nuovo (Construct).
 * Le chiavi di localStorage si copiano una volta sola; la vecchia resta dov'è, così nulla va perso.
 */

/** Chiavi di localStorage con il nome attuale e con quello precedente. */
export const STORAGE = {
  ui: { now: 'construct:ui', legacy: 'webcad:ui' },
  last: { now: 'construct:last', legacy: 'webcad:last' },
  seen: { now: 'construct:lastSeenVersion', legacy: 'webcad:lastSeenVersion' },
  welcomed: 'construct:welcomed',
} as const;

/** Copia il valore della chiave vecchia in quella nuova, se la nuova non esiste ancora. localStorage può non esserci. */
export function migrateLocalKey(legacyKey: string, key: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  try {
    // localStorage si legge qui dentro: nei test (ambiente node) e in navigazione privata può non esistere
    storage ??= localStorage;
    if (storage.getItem(key) !== null) return;
    const old = storage.getItem(legacyKey);
    if (old !== null) storage.setItem(key, old);
  } catch {
    // Senza localStorage non c'è nulla da migrare
  }
}
