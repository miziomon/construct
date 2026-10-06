import { SquaresIntersect, SquaresSubtract, SquaresUnite } from 'lucide-react';
import { isLocked, useSceneStore } from '../../scene/store';
import './SelectionActions.scss';

/**
 * Barra flottante nel viewport: con due o più oggetti selezionati propone Unione, Differenza e Intersezione.
 * La base della differenza è il primo oggetto selezionato; gli altri vengono sottratti.
 */
export function SelectionActions() {
  const scene = useSceneStore((s) => s.scene);
  const selection = useSceneStore((s) => s.selection);
  const combine = useSceneStore((s) => s.combineSelected);

  // Solo oggetti alla radice e non bloccati, in ordine di selezione
  const ids = selection.filter((id) => scene.rootIds.includes(id) && !isLocked(scene, id));
  if (ids.length < 2) return null;

  const [base, ...others] = ids.map((id) => scene.nodes[id].name);
  return (
    <div className="selection-actions" role="toolbar" aria-label="Operazioni sugli oggetti selezionati">
      <button type="button" className="selection-actions__button" onClick={() => combine('union')} title="Unisce gli oggetti selezionati">
        <SquaresUnite size={16} />
        Unione
      </button>
      <button
        type="button"
        className="selection-actions__button"
        onClick={() => combine('difference')}
        title={`Sottrae dal primo selezionato (${base}) tutti gli altri`}
      >
        <SquaresSubtract size={16} />
        Differenza
      </button>
      <button type="button" className="selection-actions__button" onClick={() => combine('intersection')} title="Tiene solo la parte comune">
        <SquaresIntersect size={16} />
        Intersezione
      </button>
      <span className="selection-actions__hint">
        Base: <strong>{base}</strong>
        {others.length > 0 && <> − {others.length === 1 ? others[0] : `${others.length} oggetti`}</>}
      </span>
    </div>
  );
}
