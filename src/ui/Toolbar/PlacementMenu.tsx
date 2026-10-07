import { useEffect } from 'react';
import { alignSelection, mirrorSelection } from '../../kernel/placement';
import type { AlignTarget } from '../../kernel/placement';
import { useUiStore } from '../uiStore';

const AXES = ['X', 'Y', 'Z'] as const;
const TARGETS: [AlignTarget, string][] = [['min', 'Min'], ['center', 'Centro'], ['max', 'Max']];

/**
 * Contenuto delle tendine Allinea e Specchia: una riga per asse (X, Y, Z) e un pulsante per lato dell'ingombro della
 * selezione (Min, Centro, Max). Allinea porta gli oggetti su quel lato; Specchia fa passare il piano di specchio da lì.
 * Passando sopra un pulsante (o con il focus) nella vista 3D compare l'anteprima del risultato.
 */
export function PlacementMenu({ kind, close }: { kind: 'align' | 'mirror'; close: () => void }) {
  const setPreview = useUiStore((s) => s.setPlacementPreview);
  // L'anteprima non deve restare quando la tendina si chiude (clic su un pulsante, Esc, clic fuori)
  useEffect(() => () => setPreview(null), [setPreview]);

  const verb = kind === 'align' ? 'Allinea' : 'Specchia';
  return (
    <>
      {AXES.map((axisName, i) => {
        const axis = i as 0 | 1 | 2;
        return (
          <div key={axisName} className="toolbar__dropdown-row">
            <span className="toolbar__dropdown-label">{axisName}</span>
            {TARGETS.map(([target, label]) => {
              const show = () => setPreview({ kind, axis, target });
              const hide = () => setPreview(null);
              return (
                <button
                  key={target}
                  type="button"
                  role="menuitem"
                  className="toolbar__dropdown-item"
                  title={
                    kind === 'align'
                      ? `Allinea sull'asse ${axisName}: ${label.toLowerCase()} dell'ingombro della selezione`
                      : `Specchia sull'asse ${axisName}: il piano di specchio passa dal ${label === 'Centro' ? 'centro' : label.toLowerCase()} dell'ingombro della selezione`
                  }
                  aria-label={`${verb} ${axisName} ${label}`}
                  onMouseEnter={show}
                  onFocus={show}
                  onMouseLeave={hide}
                  onBlur={hide}
                  onClick={() => {
                    if (kind === 'align') alignSelection(axis, target);
                    else mirrorSelection(axis, target);
                    close();
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
