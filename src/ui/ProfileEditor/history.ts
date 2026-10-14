/**
 * Cronologia locale della modale del Profilo (Ctrl+Z / Ctrl+Maiusc+Z sul disegno): una pila di istantanee. Un
 * trascinamento è un solo passo: chi chiama fa `push` al rilascio, non a ogni movimento. Le istantanee sono immutabili
 * (vedi model.ts), quindi si tengono per riferimento senza copiarle.
 */
export interface History<T> {
  /** Aggiunge lo stato dopo una modifica: i passi da ripetere si perdono e, oltre il limite, si scorda il più vecchio. */
  push: (state: T) => void;
  /** Torna allo stato precedente, oppure `undefined` se si è all'inizio. */
  undo: () => T | undefined;
  /** Ripete lo stato successivo, oppure `undefined` se non c'è nulla da ripetere. */
  redo: () => T | undefined;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Riparte da `state` come unico stato (apertura della modale, ripristino di una bozza). */
  reset: (state: T) => void;
}

/** Crea una cronologia che tiene al massimo `limit` istantanee (lo stato corrente compreso). */
export function createHistory<T>(limit = 200): History<T> {
  // Le istantanee e la posizione di quella corrente
  let states: T[] = [];
  let index = -1;
  return {
    push: (state) => {
      // Una modifica dopo un Annulla cancella i passi da ripetere
      states = [...states.slice(0, index + 1), state];
      // Oltre il limite si scorda lo stato più vecchio
      if (states.length > limit) states = states.slice(states.length - limit);
      index = states.length - 1;
    },
    undo: () => (index > 0 ? states[--index] : undefined),
    redo: () => (index < states.length - 1 ? states[++index] : undefined),
    canUndo: () => index > 0,
    canRedo: () => index < states.length - 1,
    reset: (state) => {
      states = [state];
      index = 0;
    },
  };
}
