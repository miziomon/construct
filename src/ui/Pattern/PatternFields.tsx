import { useId } from 'react';
import { useResultStore } from '../../kernel/useKernel';
import { PATTERN_MAX_CELLS, faceName, isAxisFace } from '../../scene/pattern';
import type { PatternParams } from '../../scene/types';
import { NumberField } from '../NumberField/NumberField';
import { SliderField } from '../SliderField/SliderField';
import { SLOW_PREVIEW_CELLS, SLOW_PREVIEW_MS, estimatedCells } from './patternToolStore';
// Stesso aspetto dei campi della Ripetizione
import '../Array/ArrayFields.scss';

interface Props {
  params: PatternParams;
  /** Modifica uno o più parametri. */
  onChange: (patch: Partial<PatternParams>) => void;
  disabled?: boolean;
  /** Falso quando la cronologia è già gestita da chi usa i campi (anteprima dello strumento, in pausa). */
  history?: boolean;
  /** Se presente compare "Scegli faccia": si clicca la faccia sull'oggetto (solo nel pannello dello strumento). */
  onPickFace?: () => void;
  picking?: boolean;
  /** Se presente compare la casella "Anteprima semplificata" (solo nel pannello dello strumento). */
  onSimplified?: (simplified: boolean) => void;
  simplified?: boolean;
  /** Se presente compare "Aggiorna all'ingombro": ricalcola l'area del disegno sulle misure attuali del pezzo. */
  onRefreshBounds?: () => void;
  /** Se presente «Aggiorna all'ingombro» è spento e questo testo spiega perché. */
  refreshBlocked?: string;
}

const KIND_LABELS: Record<PatternParams['kind'], string> = { voronoi: 'Voronoi', hexagon: 'Esagoni', circle: 'Cerchi', diamond: 'Rombi', triangle: 'Triangoli' };
/** Sotto questa parete (circa due passate di un ugello da 0,4 mm) la stampa è inaffidabile. */
const MIN_PRINTABLE_WALL = 0.8;

/**
 * Campi di un Pattern: tipo, seme, celle, parete, margine, faccia e profondità. Li usano il pannello dello strumento
 * Pattern (con anteprima dal vivo) e il pannello delle proprietà del gruppo "Pattern" già creato.
 */
export function PatternFields({ params: p, onChange, disabled, history = true, onPickFace, picking, onSimplified, simplified, onRefreshBounds, refreshBlocked }: Props) {
  const ms = useResultStore((s) => s.ms);
  // Id per collegare l'etichetta "Tipo" alla tendina
  const kindId = useId();
  /** Pulsanti alternativi (come i selettori della Ripetizione). */
  const choice = <T extends string>(label: string, tip: string, value: T | null, options: [T, string][], set: (v: T) => void) => (
    <div className="array-fields__row" title={tip}>
      <span className="array-fields__label">{label}</span>
      <div className="array-fields__segmented" role="group" aria-label={label}>
        {options.map(([option, text]) => (
          <button key={option} type="button" className={option === value ? 'is-active' : undefined} aria-pressed={option === value} disabled={disabled} onClick={() => set(option)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  const slider = (label: string, tip: string, key: 'cells' | 'regularity' | 'size' | 'angle' | 'wall' | 'rounding' | 'margin' | 'depth', range: { min: number; max: number; step: number; hardMin?: number; hardMax?: number; unit?: string }) => (
    <SliderField label={label} tooltip={tip} value={p[key]} disabled={disabled} history={history} onCommit={(v) => onChange({ [key]: v })} {...range} />
  );

  const partial = p.depth > 0;
  // Il taglio parte da una sola faccia (i progetti vecchi possono averne più di una)
  const faceLabel = p.faces.length === 1 ? faceName(p.faces[0]) : `${p.faces.length} facce`;
  // Con una faccia inclinata il taglio parte solo da quella (niente faccia opposta)
  const bothSides = p.faces.every(isAxisFace);
  const slow = ms > SLOW_PREVIEW_MS || estimatedCells(p) > SLOW_PREVIEW_CELLS;

  return (
    <div className="array-fields">
      {/* Il tipo è una tendina: cinque scelte non stanno bene in una riga di pulsanti */}
      <div className="array-fields__row" title="Voronoi: celle casuali riproducibili dal seme; Esagoni, Cerchi, Rombi e Triangoli: griglia regolare.">
        <label className="array-fields__label" htmlFor={kindId}>Tipo</label>
        <select id={kindId} className="array-fields__select" value={p.kind} disabled={disabled} onChange={(e) => onChange({ kind: e.target.value as PatternParams['kind'] })}>
          {(Object.keys(KIND_LABELS) as PatternParams['kind'][]).map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {p.kind === 'voronoi' && (
        <div className="array-fields__row" title="Il seme decide il disegno: lo stesso seme dà sempre lo stesso risultato, anche nel codice OpenSCAD.">
          <span className="array-fields__label">Seme</span>
          <div className="array-fields__vector">
            <NumberField label="Seme" value={p.seed} min={0} max={2 ** 31} step={1} disabled={disabled} onCommit={(seed) => onChange({ seed })} />
            <button type="button" className="array-fields__button" disabled={disabled} onClick={() => onChange({ seed: Math.floor(Math.random() * 100000) })}>
              Nuovo seme
            </button>
          </div>
        </div>
      )}

      {p.kind === 'voronoi' && slider('Celle', `Numero di celle per faccia (al massimo ${PATTERN_MAX_CELLS}).`, 'cells', { min: 3, max: 150, step: 1, hardMin: 3, hardMax: PATTERN_MAX_CELLS })}
      {p.kind === 'voronoi' && slider('Regolarità', '0 = celle del tutto casuali, 100 = celle quasi uniformi.', 'regularity', { min: 0, max: 100, step: 1, unit: '%' })}
      {p.kind !== 'voronoi' && (
        <>
          {slider('Passo', 'Distanza tra i centri di due celle, in mm.', 'size', { min: 4, max: 60, step: 0.5, hardMin: 2, unit: 'mm' })}
          {slider('Rotazione', 'Rotazione della griglia, in gradi.', 'angle', { min: 0, max: 90, step: 1, hardMin: -360, hardMax: 360, unit: '°' })}
        </>
      )}

      {choice('Modo', 'Fori: si tolgono le celle e restano le pareti. Solchi: si tolgono le pareti e restano le celle in rilievo.', p.mode, [['holes', 'Fori'], ['grooves', 'Solchi']], (mode) => onChange({ mode }))}
      {slider('Parete', 'Spessore della parete tra due celle, in mm.', 'wall', { min: 0.4, max: 6, step: 0.1, hardMin: 0.1, unit: 'mm' })}
      {slider('Arrotondamento', 'Raggio degli angoli delle celle, in mm.', 'rounding', { min: 0, max: 5, step: 0.1, hardMin: 0, unit: 'mm' })}
      {slider('Margine', 'Cornice piena che resta attorno al disegno, in mm.', 'margin', { min: 0, max: 20, step: 0.5, hardMin: 0, unit: 'mm' })}

      <div className="array-fields__row" title="Faccia da cui parte il taglio. Per forare altre facce applica di nuovo il Pattern.">
        <span className="array-fields__label">Faccia</span>
        <span>{faceLabel}</span>
        {onPickFace && (
          <button type="button" className={`array-fields__button${picking ? ' is-active' : ''}`} aria-pressed={picking} disabled={disabled} onClick={onPickFace} title="Poi clicca una faccia piana dell'oggetto, anche inclinata.">
            {picking ? 'Fine scelta' : 'Scegli faccia'}
          </button>
        )}
      </div>
      {picking && (
        <p className="array-fields__total" role="status">
          Clicca la faccia da forare (Esc per finire).
        </p>
      )}

      {slider('Profondità', 'Quanto entra il taglio dalla faccia, in mm. 0 = passante.', 'depth', { min: 0, max: Math.max(1, Math.round(Math.max(...p.faces.map((f) => f.thickness)))), step: 0.1, hardMin: 0, unit: 'mm' })}
      {partial && bothSides && choice('Lati', 'Il taglio parte dalla sola faccia scelta oppure anche da quella opposta, con la stessa profondità.', p.sides, [['one', 'Una faccia'], ['both', 'Entrambe']], (sides) => onChange({ sides }))}
      {p.wall < MIN_PRINTABLE_WALL && <p className="array-fields__total" role="status">Parete sotto {MIN_PRINTABLE_WALL} mm: difficile da stampare.</p>}

      {slow && (
        <p className="array-fields__total array-fields__warning" role="alert">
          {ms > SLOW_PREVIEW_MS ? `Calcolo lento (${Math.round(ms)} ms).` : `Molte celle (circa ${estimatedCells(p)}): il calcolo può essere lento.`} Riduci celle o facce, oppure aumenta il passo.
        </p>
      )}
      {onSimplified && (
        <label className="array-fields__row array-fields__check" title="Durante l'anteprima gli angoli arrotondati hanno meno segmenti: il calcolo è più veloce. Il risultato dopo l'OK è sempre a qualità piena.">
          <span className="array-fields__label">Anteprima semplificata</span>
          <input type="checkbox" checked={!!simplified} onChange={(e) => onSimplified(e.target.checked)} />
        </label>
      )}

      {onRefreshBounds && (
        <div className="array-fields__row" title={refreshBlocked ?? "Il disegno copre l'ingombro che il pezzo aveva quando è stato applicato: se il pezzo è cambiato, ricalcolalo."}>
          <span className="array-fields__label" />
          <button type="button" className="array-fields__button" disabled={disabled || !!refreshBlocked} onClick={onRefreshBounds}>
            Aggiorna all'ingombro
          </button>
        </div>
      )}
    </div>
  );
}
