import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { useResultStore } from '../../kernel/useKernel';
import { GROUP_ICONS } from '../groupIcons';
import { SLOW_PREVIEW_MS, usePatternTool } from './patternToolStore';
import { PatternFields } from './PatternFields';
// Stesso aspetto del pannello di Raccordo, Smusso, Guscio e Serie
import '../EdgeTool/EdgeToolPanel.scss';

/**
 * Pannello del Pattern: tipo, seme, celle, parete e profondità con anteprima dal vivo nella vista 3D, OK e Annulla.
 * Flottante e non modale: la vista 3D resta utilizzabile. Dopo l'OK il risultato è un gruppo "Pattern" con gli stessi
 * campi nel pannello delle proprietà.
 */
export function PatternPanel() {
  const { active, params, error, groupId, picking, simplified, cancel, commit, setParams, setPicking, setSimplified } = usePatternTool();
  const ms = useResultStore((s) => s.ms);
  // Se l'utente ha deciso lui sull'anteprima semplificata, non la si cambia più da sola
  const decided = useRef(false);
  useEffect(() => {
    if (active && !decided.current && !simplified && ms > SLOW_PREVIEW_MS) setSimplified(true);
  }, [active, ms, simplified, setSimplified]);
  useEffect(() => {
    if (!active) decided.current = false;
  }, [active]);
  if (!active || !params) return null;

  return (
    <section className="edge-panel" aria-label="Pattern">
      <h2 className="edge-panel__title">
        <GROUP_ICONS.pattern size={16} aria-hidden="true" />
        Pattern
      </h2>

      <div className="edge-panel__section">
        <PatternFields params={params} onChange={setParams} history={false} picking={picking}
          onPickFace={() => setPicking(!picking)}
          simplified={simplified}
          onSimplified={(value) => {
            decided.current = true;
            setSimplified(value);
          }}
        />
        <p className="edge-panel__hint">Il pattern è un solo gruppo "Pattern": dopo l'OK si modificano seme e parametri, non le singole celle.</p>
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
