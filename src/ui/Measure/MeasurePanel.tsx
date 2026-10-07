import { useEffect } from 'react';
import { RotateCcw, Ruler, X } from 'lucide-react';
import { formatMm } from '../../scene/format';
import { measure } from '../../scene/snap';
import type { SnapKind } from '../../scene/snap';
import { useMeasure } from './measureStore';
// Stesso aspetto del pannello di Raccordo, Smusso e Guscio
import '../EdgeTool/EdgeToolPanel.scss';

/** Nome del punto agganciato, mostrato sotto il puntatore. */
export const SNAP_LABELS: Record<SnapKind, string> = { vertex: 'Vertice', midpoint: 'Punto medio dello spigolo', edge: 'Spigolo', face: 'Superficie' };

/**
 * Pannello della Misura: guida i due clic (partenza e arrivo) e mostra la distanza e le sue componenti X, Y, Z.
 * Flottante e non modale: la vista 3D resta utilizzabile (si può ruotare tra un clic e l'altro).
 */
export function MeasurePanel() {
  const { active, points, hover, cancel, reset } = useMeasure();

  // Come per gli altri strumenti, il puntatore sulla vista 3D diventa una croce
  useEffect(() => {
    if (!active) return;
    document.body.dataset.edgeTool = 'measure';
    return () => {
      delete document.body.dataset.edgeTool;
    };
  }, [active]);

  if (!active) return null;
  const result = points.length === 2 ? measure(points[0].point, points[1].point) : null;
  const hint = points.length === 0 ? 'Clicca il punto di partenza.' : points.length === 1 ? 'Clicca il punto di arrivo.' : 'Un nuovo clic avvia un\'altra misura.';

  return (
    <section className="edge-panel" aria-label="Misura">
      <h2 className="edge-panel__title">
        <Ruler size={16} aria-hidden="true" />
        Misura
      </h2>

      <div className="edge-panel__section">
        <p className="edge-panel__hint">{hint}</p>
        <p className="edge-panel__hint">
          Il punto si aggancia a vertici (angoli e intersezioni di spigoli), al punto medio degli spigoli, agli spigoli e alle superfici.
          {hover && !result && (
            <>
              {' '}
              Sotto il puntatore: <strong>{SNAP_LABELS[hover.kind]}</strong>.
            </>
          )}
        </p>
        {result && (
          <>
            <div className="edge-panel__row">
              <span className="edge-panel__label">Distanza</span>
              <strong className="edge-panel__value" data-testid="measure-distance">{formatMm(result.distance)}</strong>
            </div>
            {(['ΔX', 'ΔY', 'ΔZ'] as const).map((label, i) => (
              <div key={label} className="edge-panel__row">
                <span className="edge-panel__label">{label}</span>
                <span className="edge-panel__value">{formatMm(result.delta[i])}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="edge-panel__actions">
        <button type="button" className="edge-panel__button" disabled={points.length === 0} onClick={reset}>
          <RotateCcw size={14} />
          Nuova
        </button>
        <span className="edge-panel__spacer" />
        <button type="button" className="edge-panel__button" onClick={cancel}>
          <X size={14} />
          Chiudi
        </button>
      </div>
    </section>
  );
}
