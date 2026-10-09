import { Check, Scissors, X } from 'lucide-react';
import { SliderField } from '../SliderField/SliderField';
import { useSplitTool } from './splitToolStore';
import type { SplitAxis } from './splitToolStore';
// Stesso aspetto del pannello di Raccordo, Smusso e Guscio
import '../EdgeTool/EdgeToolPanel.scss';

const AXES: [SplitAxis, string][] = [[0, 'X'], [1, 'Y'], [2, 'Z']];

/**
 * Pannello di Dividi: asse del piano e sua posizione lungo l'asse (dentro l'ingombro del pezzo), con le due metà in
 * anteprima dal vivo; OK e Annulla. Flottante e non modale: la vista 3D resta utilizzabile.
 */
export function SplitPanel() {
  const { active, axis, offset, bounds, error, ids, cancel, commit, setOption } = useSplitTool();
  if (!active || !bounds) return null;
  const [min, max] = [bounds.min[axis], bounds.max[axis]];

  return (
    <section className="edge-panel" aria-label="Dividi">
      <h2 className="edge-panel__title">
        <Scissors size={16} aria-hidden="true" />
        Dividi
      </h2>

      <div className="edge-panel__section">
        <div className="edge-panel__row">
          <span className="edge-panel__label">Piano</span>
          <div className="edge-panel__segmented" role="group" aria-label="Asse del piano di taglio">
            {AXES.map(([value, label]) => (
              <button key={label} type="button" aria-pressed={axis === value} className={axis === value ? 'is-active' : undefined} title={`Piano perpendicolare all'asse ${label}`} onClick={() => setOption({ axis: value })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <SliderField
          label="Posizione"
          unit="mm"
          min={Math.round(min * 10) / 10}
          max={Math.round(max * 10) / 10}
          step={0.5}
          hardMin={min}
          hardMax={max}
          tooltip={`Quota del piano lungo l'asse ${AXES[axis][1]}, in mm (nel mondo): da un bordo all'altro dell'oggetto.`}
          history={false}
          value={offset}
          onCommit={(v) => setOption({ offset: v })}
        />
        <p className="edge-panel__hint">Il risultato sono due oggetti (1 e 2), ciascuno un'intersezione con un cubo di taglio: spostando il cubo si sposta il taglio.</p>
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
        <button type="button" className="edge-panel__button edge-panel__button--primary" disabled={!ids} onClick={commit}>
          <Check size={14} />
          OK
        </button>
      </div>
    </section>
  );
}
