import { useEffect } from 'react';
import { SquareArrowDown, X } from 'lucide-react';
import { useLayFlat } from './layFlatStore';
// Stesso aspetto del pannello di Raccordo, Smusso, Guscio e Misura
import '../EdgeTool/EdgeToolPanel.scss';

/**
 * Pannello di Appoggia su una faccia: dice cosa fare e permette di uscire. Flottante e non modale: la vista 3D resta
 * utilizzabile (si può ruotare la vista per raggiungere la faccia giusta).
 */
export function LayFlatPanel() {
  const { active, cancel } = useLayFlat();

  // Come per gli altri strumenti, il puntatore sulla vista 3D diventa una croce
  useEffect(() => {
    if (!active) return;
    document.body.dataset.edgeTool = 'layflat';
    return () => {
      delete document.body.dataset.edgeTool;
    };
  }, [active]);

  if (!active) return null;
  return (
    <section className="edge-panel" aria-label="Appoggia su una faccia">
      <h2 className="edge-panel__title">
        <SquareArrowDown size={16} aria-hidden="true" />
        Appoggia su una faccia
      </h2>
      <div className="edge-panel__section">
        <p className="edge-panel__hint">Clicca la faccia dell&apos;oggetto che deve poggiare sul piatto: l&apos;oggetto si ruota e si appoggia.</p>
        <p className="edge-panel__hint">Con Esc o con il tasto V si esce senza cambiare nulla.</p>
      </div>
      <div className="edge-panel__actions">
        <span className="edge-panel__spacer" />
        <button type="button" className="edge-panel__button" onClick={cancel}>
          <X size={14} />
          Chiudi
        </button>
      </div>
    </section>
  );
}
