import { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { round } from '../../scene/math';
import { maxFilletRadius } from '../../scene/edgeProfile';
import { MAX_SEGMENTS, MIN_SEGMENTS } from '../../scene/defaults';
import { EDGE_ICONS } from '../groupIcons';
import { SliderField } from '../SliderField/SliderField';
import { currentParams, useEdgeTool, type ChamferMode } from './edgeToolStore';
import './EdgeToolPanel.scss';

const CHAMFER_MODES: { mode: ChamferMode; label: string }[] = [
  { mode: 'equal', label: 'Distanza uguale' },
  { mode: 'two', label: 'Due distanze' },
  { mode: 'angle', label: 'Distanza e angolo' },
];

/** Stato di una delle due facce da scegliere. */
function FaceRow({ label, chosen }: { label: string; chosen: boolean }) {
  return (
    <div className="edge-panel__row">
      <span className="edge-panel__label">{label}</span>
      <span className={`edge-panel__chip${chosen ? ' edge-panel__chip--chosen' : ''}`}>{chosen ? 'scelta' : 'da scegliere'}</span>
    </div>
  );
}

/**
 * Pannello delle opzioni di Raccordo e Smusso, come in Fusion 360: facce scelte, misure con anteprima dal vivo,
 * informazioni sullo spigolo e pulsanti OK e Annulla. Flottante e non modale: la vista 3D resta utilizzabile.
 */
export function EdgeToolPanel() {
  const state = useEdgeTool();
  const { tool, geometry, picks, error, preview, chamferMode, angle, cancel, commit, changeFaces, setOption } = state;

  // Cursore a croce sulla vista 3D mentre si scelgono le facce
  useEffect(() => {
    if (!tool) return;
    document.body.dataset.edgeTool = tool;
    return () => {
      delete document.body.dataset.edgeTool;
    };
  }, [tool]);

  // Lo smusso angolare ha un pannello suo (CornerPanel)
  if (!tool || tool === 'corner') return null;
  const isFillet = tool === 'fillet';
  const Icon = EDGE_ICONS[tool];
  const params = currentParams(state);
  const ready = geometry !== null;
  // Il raccordo e lo smusso non possono superare la larghezza delle facce
  const maxRadius = geometry ? maxFilletRadius(geometry) : 20;
  const maxDistance = geometry ? geometry.reach : 20;

  return (
    <section className="edge-panel" aria-label={isFillet ? 'Raccordo' : 'Smusso'}>
      <h2 className="edge-panel__title">
        <Icon size={16} aria-hidden="true" />
        {isFillet ? 'Raccordo' : 'Smusso'}
      </h2>

      <div className="edge-panel__section">
        <FaceRow label="Superficie 1" chosen={picks.length > 0} />
        <FaceRow label="Superficie 2" chosen={picks.length > 1} />
        {picks.length < 2 && !error && <p className="edge-panel__hint">Fai clic su due superfici piane che si incontrano in uno spigolo.</p>}
        {error && (
          <p className="edge-panel__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="edge-panel__section">
        {isFillet ? (
          <>
            <div className="edge-panel__row">
              <span className="edge-panel__label">Tipo</span>
              <span className="edge-panel__value">Raggio costante</span>
            </div>
            <SliderField
              label="Raggio"
              unit="mm"
              min={0.1}
              max={Math.max(0.2, round(maxRadius, 2))}
              step={0.1}
              hardMin={0.01}
              hardMax={Math.max(0.2, maxRadius)}
              tooltip="Raggio del raccordo: quanto è morbido l'arrotondamento, in mm. Il massimo dipende dalla larghezza delle due superfici."
              disabled={!ready}
              history={false}
              value={params.radius}
              onCommit={(v) => setOption({ radius: v })}
            />
            <SliderField
              label="Segmenti"
              min={MIN_SEGMENTS}
              max={MAX_SEGMENTS}
              step={1}
              hardMin={MIN_SEGMENTS}
              hardMax={MAX_SEGMENTS}
              tooltip="Risoluzione del raccordo, come per i cerchi: pochi segmenti danno un arrotondamento a sfaccettature, molti un raccordo liscio. Conta il cerchio intero."
              disabled={!ready}
              history={false}
              value={state.segments}
              onCommit={(v) => setOption({ segments: Math.round(v) })}
            />
          </>
        ) : (
          <>
            <div className="edge-panel__row">
              <span className="edge-panel__label">Tipo</span>
              <div className="edge-panel__segmented" role="group" aria-label="Tipo di distanza">
                {CHAMFER_MODES.map(({ mode, label }) => (
                  <button key={mode} type="button" aria-pressed={chamferMode === mode} className={chamferMode === mode ? 'is-active' : undefined} onClick={() => setOption({ chamferMode: mode })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <SliderField
              label={chamferMode === 'equal' ? 'Distanza' : 'Distanza 1'}
              unit="mm"
              min={0.1}
              max={Math.max(0.2, round(maxDistance, 2))}
              step={0.1}
              hardMin={0.01}
              hardMax={Math.max(0.2, maxDistance)}
              tooltip="Distanza dello smusso dallo spigolo, misurata lungo la prima superficie, in mm."
              disabled={!ready}
              history={false}
              value={params.distance1}
              onCommit={(v) => setOption({ distance1: v })}
            />
            {chamferMode === 'two' && (
              <SliderField
                label="Distanza 2"
                unit="mm"
                min={0.1}
                max={Math.max(0.2, round(maxDistance, 2))}
                step={0.1}
                hardMin={0.01}
                hardMax={Math.max(0.2, maxDistance)}
                tooltip="Distanza dello smusso dallo spigolo, misurata lungo la seconda superficie, in mm."
                disabled={!ready}
                history={false}
                value={state.distance2}
                onCommit={(v) => setOption({ distance2: v })}
              />
            )}
            {chamferMode === 'angle' && (
              <SliderField
                label="Angolo"
                unit="°"
                min={1}
                max={89}
                step={1}
                hardMin={1}
                hardMax={89}
                tooltip="Angolo tra il piano dello smusso e la prima superficie, in gradi."
                disabled={!ready}
                history={false}
                value={angle}
                onCommit={(v) => setOption({ angle: v })}
              />
            )}
          </>
        )}
      </div>

      {geometry && (
        <p className="edge-panel__info">
          {geometry.convex ? 'Spigolo convesso' : 'Spigolo concavo'}, apertura {round(geometry.angle, 1)}°, lunghezza {round(geometry.length, 2)} mm
        </p>
      )}

      <div className="edge-panel__actions">
        <button type="button" className="edge-panel__link" disabled={picks.length === 0} onClick={changeFaces}>
          Cambia superfici
        </button>
        <span className="edge-panel__spacer" />
        <button type="button" className="edge-panel__button" onClick={cancel}>
          <X size={14} />
          Annulla
        </button>
        <button type="button" className="edge-panel__button edge-panel__button--primary" disabled={!preview} onClick={commit}>
          <Check size={14} />
          OK
        </button>
      </div>
    </section>
  );
}
