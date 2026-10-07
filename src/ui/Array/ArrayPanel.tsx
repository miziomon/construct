import { Check, Repeat2, X } from 'lucide-react';
import { useArrayTool } from './arrayToolStore';
import { ArrayFields } from './ArrayFields';
// Stesso aspetto del pannello di Raccordo, Smusso, Guscio e Misura
import '../EdgeTool/EdgeToolPanel.scss';

/**
 * Pannello della Serie: tipo, copie e distanze con anteprima dal vivo nella vista 3D, OK e Annulla.
 * Flottante e non modale: la vista 3D resta utilizzabile. Dopo l'OK il risultato è un gruppo "Ripetizione" con gli
 * stessi campi nel pannello delle proprietà.
 */
export function ArrayPanel() {
  const { active, params, error, groupId, cancel, commit, setParams } = useArrayTool();
  if (!active) return null;

  return (
    <section className="edge-panel" aria-label="Serie">
      <h2 className="edge-panel__title">
        <Repeat2 size={16} aria-hidden="true" />
        Serie
      </h2>

      <div className="edge-panel__section">
        <ArrayFields params={params} onChange={setParams} history={false} />
        <p className="edge-panel__hint">Le copie sono un solo gruppo "Ripetizione": dopo l'OK si modificano i parametri, non le singole copie.</p>
        {error && (
          <p className="edge-panel__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="edge-panel__actions">
        <span className="edge-panel__spacer" />
        <button type="button" className="edge-panel__button" onClick={cancel}>
          <X size={14} />
          Annulla
        </button>
        <button type="button" className="edge-panel__button edge-panel__button--primary" disabled={!groupId} onClick={commit}>
          <Check size={14} />
          OK
        </button>
      </div>
    </section>
  );
}
