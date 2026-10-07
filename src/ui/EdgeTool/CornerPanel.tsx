import { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { round } from '../../scene/math';
import { cornerSphere } from '../../scene/cornerProfile';
import { MAX_SEGMENTS, MIN_SPHERE_SEGMENTS } from '../../scene/defaults';
import { CORNER_ICONS } from '../groupIcons';
import { SliderField } from '../SliderField/SliderField';
import { cornerParams, useEdgeTool, type CornerType } from './edgeToolStore';
import './EdgeToolPanel.scss';

const TYPES: { type: CornerType; label: string; title: string }[] = [
  { type: 'chamfer', label: 'Piano', title: 'Taglio piatto: un piano passa per i punti a distanza d lungo ogni spigolo' },
  { type: 'fillet', label: 'Sferico', title: 'Calotta arrotondata: una sfera tangente agli spigoli, con i segmenti scelti' },
];

/**
 * Pannello dello Smusso angolare: si fa clic vicino a un angolo (il vertice più vicino si evidenzia), poi si sceglie
 * il tipo (Piano o Sferico), la distanza e, per lo sferico, i segmenti. Anteprima dal vivo, OK e Annulla come per gli
 * altri strumenti. Flottante e non modale: la vista 3D resta utilizzabile.
 */
export function CornerPanel() {
  const state = useEdgeTool();
  const { tool, corners, cornerPicks, error, preview, cornerType, cornerSegments, cancel, commit, changeFaces, setOption } = state;

  // Cursore a croce sulla vista 3D mentre si sceglie il vertice
  useEffect(() => {
    if (tool !== 'corner') return;
    document.body.dataset.edgeTool = tool;
    return () => {
      delete document.body.dataset.edgeTool;
    };
  }, [tool]);

  if (tool !== 'corner') return null;
  const Icon = CORNER_ICONS[cornerType];
  const params = cornerParams(state);
  // Con almeno un vertice scelto l'anteprima c'è già: gli slider si possono usare subito
  const ready = corners.length > 0;
  // La distanza non può superare lo spigolo più corto tra quelli che partono dai vertici scelti
  const maxDistance = corners.length ? Math.min(...corners.flatMap((c) => c.lengths)) : 20;
  const sphere = corners.length === 1 && cornerType === 'fillet' ? cornerSphere(corners[0].directions, params.distance) : null;

  return (
    <section className="edge-panel" aria-label="Smusso angolare">
      <h2 className="edge-panel__title">
        <Icon size={16} aria-hidden="true" />
        Smusso angolare
      </h2>

      <div className="edge-panel__section">
        <div className="edge-panel__row">
          <span className="edge-panel__label">Vertici</span>
          <span className={`edge-panel__chip${cornerPicks.length ? ' edge-panel__chip--chosen' : ''}`}>{cornerPicks.length > 1 ? `${cornerPicks.length} scelti` : cornerPicks.length === 1 ? '1 scelto' : 'da scegliere'}</span>
        </div>
        {!error && (
          <p className="edge-panel__hint">
            {cornerPicks.length
              ? "Maiusc+clic aggiunge o toglie altri vertici: l'anteprima si aggiorna subito."
              : "Fai clic vicino a un angolo del pezzo: si sceglie il vertice più vicino al puntatore. Maiusc+clic per sceglierne più d'uno."}
          </p>
        )}
        {error && (
          <p className="edge-panel__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="edge-panel__section">
        <div className="edge-panel__row">
          <span className="edge-panel__label">Tipo</span>
          <div className="edge-panel__segmented" role="group" aria-label="Tipo di smusso angolare">
            {TYPES.map(({ type, label, title }) => (
              <button key={type} type="button" title={title} aria-pressed={cornerType === type} className={cornerType === type ? 'is-active' : undefined} onClick={() => setOption({ cornerType: type })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <SliderField
          label="Distanza"
          unit="mm"
          min={0.1}
          max={Math.max(0.2, round(maxDistance, 2))}
          step={0.1}
          hardMin={0.01}
          hardMax={Math.max(0.2, maxDistance)}
          tooltip="Distanza dal vertice, lungo ogni spigolo, dove il taglio incontra lo spigolo, in mm. Il massimo è lo spigolo più corto."
          disabled={!ready}
          history={false}
          value={params.distance}
          onCommit={(v) => setOption({ cornerDistance: v })}
        />
        {cornerType === 'fillet' && (
          <SliderField
            label="Segmenti"
            min={MIN_SPHERE_SEGMENTS}
            max={MAX_SEGMENTS}
            step={4}
            hardMin={MIN_SPHERE_SEGMENTS}
            hardMax={MAX_SEGMENTS}
            tooltip="Risoluzione della calotta, come per la sfera: pochi segmenti danno sfaccettature, molti una superficie liscia. Sono sempre multipli di 4."
            disabled={!ready}
            history={false}
            value={cornerSegments}
            onCommit={(v) => setOption({ cornerSegments: Math.max(MIN_SPHERE_SEGMENTS, Math.round(v / 4) * 4) })}
          />
        )}
      </div>

      {corners.length > 0 && (
        <p className="edge-panel__info">
          {corners.length === 1 ? `Angolo convesso con ${corners[0].directions.length} spigoli` : `${corners.length} angoli convessi`}, lo spigolo più corto è di {round(maxDistance, 2)} mm
          {sphere && `, raggio della sfera ${round(sphere.radius, 2)} mm`}
        </p>
      )}

      <div className="edge-panel__actions">
        <button type="button" className="edge-panel__link" disabled={cornerPicks.length === 0} onClick={changeFaces}>
          Cambia vertici
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
