import { lazy } from 'react';
import type { ComponentType } from 'react';
import { notify } from './notify/notifyStore';

/**
 * `React.lazy` che non manda in crash l'app se il file non si scarica (rete assente, o un aggiornamento della PWA ha
 * sostituito i file mentre la pagina era aperta): mostra una notifica e il componente resta vuoto.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyLoad<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().catch(() => {
      notify.error('Una parte dell\'app non si è caricata (connessione assente o nuova versione): ricarica la pagina.');
      return { default: (() => null) as unknown as T };
    }),
  );
}
