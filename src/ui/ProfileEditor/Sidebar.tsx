import { PATH_MAX_TOLERANCE, PATH_MIN_TOLERANCE } from '../../scene/bezier';
import type { PathNode } from '../../scene/types';
import { NumberField } from '../NumberField/NumberField';
import { SliderField } from '../SliderField/SliderField';
import { TIPS } from '../PropertiesPanel/tooltips';
import type { GridSettings } from './DrawingCanvas';
import type { Draft, NodeRef } from './model';

interface Props {
  draft: Draft;
  selection: NodeRef[];
  grid: GridSettings;
  /** Campionamento del disegno: punti totali, tolleranza usata davvero e se si è dovuta alzare per i tetti di punti. */
  sampling: { points: number; tolerance: number; capped: boolean };
  /** Cambia il tipo di estrusione: un passo della cronologia. */
  onExtrusion: (mode: Draft['extrusion']) => void;
  /** Modifica in corso di un parametro (slider): il passo si chiude al rilascio. */
  onLive: (patch: Partial<Draft>) => void;
  /** Modifica conclusa di un parametro (campo numerico): un passo. */
  onPatch: (patch: Partial<Draft>) => void;
  onKind: (kind: PathNode['kind']) => void;
  /** Porta il nodo selezionato alla coordinata indicata (asse 0 = X, 1 = Y). */
  onCoordinate: (axis: 0 | 1, value: number) => void;
  /** Imposta lunghezza (mm) e angolo (gradi) di una maniglia del nodo selezionato. */
  onHandle: (side: 'in' | 'out', length: number, angle: number) => void;
  onGrid: (patch: Partial<GridSettings>) => void;
  onSelectPath: (index: number) => void;
  onClosePath: (index: number) => void;
  onDeletePath: (index: number) => void;
}

/** Tipi di nodo: il simbolo ripete la forma che il nodo ha nel disegno. */
const KINDS: { kind: PathNode['kind']; label: string; symbol: string }[] = [
  { kind: 'corner', label: 'Spigolo', symbol: '■' },
  { kind: 'smooth', label: 'Liscio', symbol: '●' },
  { kind: 'symmetric', label: 'Simmetrico', symbol: '◆' },
];

/** Passi della griglia (mm). */
const GRID_STEPS = [0.1, 0.5, 1, 5, 10];

/** Valore con la virgola decimale italiana. */
const comma = (n: number) => String(n).replace('.', ',');

/** Colonna di destra della modale: estrusione, punto selezionato, percorsi, griglia e snap, qualità. */
export function Sidebar({ draft, selection, grid, sampling, onExtrusion, onLive, onPatch, onKind, onCoordinate, onHandle, onGrid, onSelectPath, onClosePath, onDeletePath }: Props) {
  // Il pannello del punto vale per un nodo solo (con più nodi si mostra il conteggio)
  const ref = selection.length === 1 ? selection[0] : null;
  const contour = ref ? draft.paths[ref.path] : undefined;
  const node = ref && contour ? contour.nodes[ref.node] : undefined;
  const rotate = draft.extrusion === 'rotate';

  return (
    <aside className="profile-editor__sidebar" aria-label="Opzioni del profilo">
      <section className="profile-editor__section">
        <h3 className="profile-editor__section-title">Estrusione</h3>
        <div className="profile-editor__segmented" role="group" aria-label="Tipo di estrusione">
          {(['linear', 'rotate'] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={draft.extrusion === mode} onClick={() => onExtrusion(mode)}>
              {mode === 'linear' ? 'Lineare' : 'Rotazionale'}
            </button>
          ))}
        </div>
        {/* Il cambio di valore è un passo solo per tutto il trascinamento: lo chiude la modale al rilascio (history={false}: niente cronologia della scena) */}
        {rotate ? (
          <>
            <SliderField label="Angolo" unit="°" min={1} max={360} step={1} hardMin={1} hardMax={360} tooltip={TIPS.revolveAngle} history={false} value={draft.revolveAngle} onCommit={(v) => onLive({ revolveAngle: v })} />
            <SliderField label="Segmenti" unit="" min={8} max={128} step={1} hardMin={3} hardMax={256} integer tooltip={TIPS.revolveSegments} history={false} value={draft.revolveSegments} onCommit={(v) => onLive({ revolveSegments: v })} />
            <p className="profile-editor__hint">Il raggio è la distanza del disegno dall&apos;asse: si cambia spostando il disegno.</p>
          </>
        ) : (
          <>
            <SliderField label="Altezza" unit="mm" min={0.5} max={200} step={0.5} hardMin={0.1} hardMax={2000} tooltip={TIPS.extrudeHeight} history={false} value={draft.height} onCommit={(v) => onLive({ height: v })} />
            <SliderField label="Torsione" unit="°" min={-360} max={360} step={5} hardMin={-3600} hardMax={3600} tooltip={TIPS.twist} history={false} value={draft.twist} onCommit={(v) => onLive({ twist: v })} />
            <SliderField label="Scala cima" unit="%" min={0} max={300} step={5} hardMin={0} hardMax={500} tooltip={TIPS.scaleTop} history={false} value={Math.round(draft.scaleTop * 100)} onCommit={(v) => onLive({ scaleTop: v / 100 })} />
          </>
        )}
      </section>

      <section className="profile-editor__section">
        <h3 className="profile-editor__section-title">Punto selezionato</h3>
        {node && ref && contour ? (
          <>
            <NumberField label="X" unit="mm" value={node.p[0]} onCommit={(v) => onCoordinate(0, v)} />
            <NumberField label="Y" unit="mm" value={node.p[1]} onCommit={(v) => onCoordinate(1, v)} />
            <div className="profile-editor__segmented" role="group" aria-label="Tipo di nodo">
              {KINDS.map((k) => (
                <button key={k.kind} type="button" aria-pressed={node.kind === k.kind} onClick={() => onKind(k.kind)}>
                  <span aria-hidden="true">{k.symbol}</span> {k.label}
                </button>
              ))}
            </div>
            {(['in', 'out'] as const).map((side) => {
              const h = node[side];
              const length = h ? Math.hypot(h[0], h[1]) : 0;
              const angle = h ? (Math.atan2(h[1], h[0]) * 180) / Math.PI : 0;
              // Il primo nodo di un contorno aperto non ha segmento prima di sé, l'ultimo non l'ha dopo: la maniglia non serve
              const unused = !contour.closed && (side === 'in' ? ref.node === 0 : ref.node === contour.nodes.length - 1);
              return (
                <div key={side} className="profile-editor__handle-row" role="group" aria-label={side === 'in' ? 'Maniglia di entrata' : 'Maniglia di uscita'} data-handle-row={side}>
                  <span className="profile-editor__handle-name">{side === 'in' ? 'Entrata' : 'Uscita'}</span>
                  <NumberField label="Lung." unit="mm" min={0} disabled={unused} value={length} onCommit={(v) => onHandle(side, v, angle)} />
                  <NumberField label="Ang." unit="°" disabled={unused} value={angle} onCommit={(v) => onHandle(side, length, v)} />
                </div>
              );
            })}
          </>
        ) : (
          <p className="profile-editor__hint">{selection.length > 1 ? `${selection.length} nodi selezionati.` : 'Seleziona un nodo per leggerne e cambiarne le coordinate. Doppio clic su un nodo: cambia il tipo.'}</p>
        )}
      </section>

      <section className="profile-editor__section">
        <h3 className="profile-editor__section-title">Percorsi</h3>
        {draft.paths.length === 0 ? (
          <p className="profile-editor__hint">Nessun percorso: scegli la Penna e disegna.</p>
        ) : (
          <ul className="profile-editor__paths">
            {draft.paths.map((c, i) => (
              <li key={i} className={selection.some((r) => r.path === i) ? 'profile-editor__path profile-editor__path--selected' : 'profile-editor__path'} data-path={i}>
                <button type="button" className="profile-editor__path-name" onClick={() => onSelectPath(i)}>
                  Percorso {i + 1}
                </button>
                <span className="profile-editor__badge">{c.closed ? 'Chiuso' : 'Aperto'}</span>
                {!c.closed && c.nodes.length >= 2 && (
                  <button type="button" className="profile-editor__mini" title="Chiudi il percorso: l'ultimo nodo si unisce al primo" onClick={() => onClosePath(i)}>
                    Chiudi
                  </button>
                )}
                <button type="button" className="profile-editor__mini" aria-label={`Elimina il percorso ${i + 1}`} title="Elimina il percorso" onClick={() => onDeletePath(i)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="profile-editor__section">
        <h3 className="profile-editor__section-title">Griglia e snap</h3>
        <div className="profile-editor__segmented" role="group" aria-label="Passo della griglia">
          {GRID_STEPS.map((s) => (
            <button key={s} type="button" aria-pressed={grid.step === s} title={`Passo della griglia: ${comma(s)} mm`} onClick={() => onGrid({ step: s })}>
              {comma(s)}
            </button>
          ))}
        </div>
        <label className="profile-editor__check">
          <input type="checkbox" checked={grid.snapGrid} onChange={(e) => onGrid({ snapGrid: e.target.checked })} />
          Aggancia alla griglia
        </label>
        <label className="profile-editor__check">
          <input type="checkbox" checked={grid.snapNodes} onChange={(e) => onGrid({ snapNodes: e.target.checked })} />
          Aggancia ai nodi
        </label>
        <label className="profile-editor__check">
          <input type="checkbox" checked={grid.snapOrtho} onChange={(e) => onGrid({ snapOrtho: e.target.checked })} />
          Allinea in orizzontale e verticale
        </label>
        <label className="profile-editor__check">
          <input type="checkbox" checked={grid.showAxis} onChange={(e) => onGrid({ showAxis: e.target.checked })} />
          Mostra asse
        </label>
        <p className="profile-editor__hint">Maiusc vincola a 45°, Ctrl sospende l&apos;aggancio.</p>
      </section>

      <section className="profile-editor__section">
        <details className="profile-editor__details">
          <summary>Qualità</summary>
          <div className="profile-editor__details-body">
            <NumberField label="Tolleranza" unit="mm" min={PATH_MIN_TOLERANCE} max={PATH_MAX_TOLERANCE} step={0.01} value={draft.tolerance} onCommit={(v) => onPatch({ tolerance: v })} />
            <p className="profile-editor__hint">Tolleranza: errore massimo tra la curva e il poligono, in mm. Più bassa = curve più lisce e più punti.</p>
            <p className="profile-editor__hint" data-points={sampling.points}>
              {sampling.points} {sampling.points === 1 ? 'punto campionato' : 'punti campionati'}
            </p>
            {sampling.capped && (
              <p className="profile-editor__hint profile-editor__hint--warn" role="status">
                Troppi punti: la tolleranza effettiva è {comma(Math.round(sampling.tolerance * 1000) / 1000)} mm. Alzala o semplifica il disegno.
              </p>
            )}
          </div>
        </details>
      </section>
    </aside>
  );
}
