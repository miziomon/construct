import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './UpdatePrompt.scss';

// Intervallo di controllo di una nuova versione mentre l'app resta aperta
const CHECK_EVERY_MS = 60 * 60 * 1000;

/** Avvisa quando c'è una nuova versione dell'app e quando è pronta per l'uso offline. */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Controllo periodico: senza, l'aggiornamento verrebbe rilevato solo al ricaricamento della pagina
      if (registration) setInterval(() => void registration.update(), CHECK_EVERY_MS);
    },
  });

  if (!needRefresh && !offlineReady) return null;

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <div className="update-prompt" role="status" aria-live="polite">
      <p className="update-prompt__text">{needRefresh ? 'Nuova versione disponibile.' : 'WebCAD è pronto per l’uso offline.'}</p>
      {needRefresh && (
        <button type="button" className="update-prompt__button update-prompt__button--primary" onClick={() => void updateServiceWorker(true)}>
          <RefreshCw size={14} />
          Aggiorna
        </button>
      )}
      <button type="button" className="update-prompt__button" onClick={close} aria-label={needRefresh ? 'Più tardi' : 'Chiudi'}>
        {needRefresh ? 'Più tardi' : <X size={14} />}
      </button>
    </div>
  );
}
