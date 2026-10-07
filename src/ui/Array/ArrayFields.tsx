import { ARRAY_MAX_COPIES, arrayCopyCount } from '../../scene/arrayPattern';
import type { ArrayParams, Vec3 } from '../../scene/types';
import { NumberField } from '../NumberField/NumberField';
import { SliderField } from '../SliderField/SliderField';
import './ArrayFields.scss';

interface Props {
  params: ArrayParams;
  /** Modifica uno o più parametri. */
  onChange: (patch: Partial<ArrayParams>) => void;
  disabled?: boolean;
  /** Falso quando la cronologia è già gestita da chi usa i campi (anteprima dello strumento, in pausa). */
  history?: boolean;
}

const AXES = ['X', 'Y', 'Z'] as const;
const KIND_LABELS: Record<ArrayParams['kind'], string> = { linear: 'Lineare', grid: 'Griglia', circular: 'Circolare' };

/**
 * Campi di una Ripetizione: tipo (lineare, griglia, circolare), copie, distanze, asse e angolo. Li usano il pannello dello
 * strumento Serie (con anteprima dal vivo) e il pannello delle proprietà del gruppo "Ripetizione" già creato.
 */
export function ArrayFields({ params: p, onChange, disabled, history = true }: Props) {
  /** Riga con tre campi X, Y, Z (mm o numero di copie). */
  const vector = (label: string, tip: string, key: 'step' | 'gridStep' | 'center' | 'counts', opts: { min?: number; max?: number; step?: number } = {}) => (
    <div className="array-fields__row" title={tip}>
      <span className="array-fields__label">{label}</span>
      <div className="array-fields__vector">
        {AXES.map((axis, i) => (
          <NumberField
            key={axis}
            label={axis}
            value={p[key][i]}
            min={opts.min}
            max={opts.max}
            step={opts.step}
            disabled={disabled}
            onCommit={(v) => onChange({ [key]: p[key].map((old, j) => (j === i ? v : old)) as Vec3 })}
          />
        ))}
      </div>
    </div>
  );
  /** Pulsanti alternativi (come i selettori del pannello proprietà). */
  const choice = <T extends string | number>(label: string, tip: string, value: T, options: [T, string][], set: (v: T) => void) => (
    <div className="array-fields__row" title={tip}>
      <span className="array-fields__label">{label}</span>
      <div className="array-fields__segmented" role="group" aria-label={label}>
        {options.map(([option, text]) => (
          <button key={String(option)} type="button" className={option === value ? 'is-active' : undefined} aria-pressed={option === value} disabled={disabled} onClick={() => set(option)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  const check = (label: string, tip: string, key: 'rotateCopies' | 'includeOriginal') => (
    <label className="array-fields__row array-fields__check" title={tip}>
      <span className="array-fields__label">{label}</span>
      <input type="checkbox" checked={p[key]} disabled={disabled} onChange={(e) => onChange({ [key]: e.target.checked })} />
    </label>
  );
  const copies = (
    <SliderField
      label="Copie"
      tooltip="Numero totale di copie, originale compreso (al massimo 200)."
      value={p.count}
      min={1}
      max={30}
      step={1}
      hardMin={1}
      hardMax={ARRAY_MAX_COPIES}
      disabled={disabled}
      history={history}
      onCommit={(v) => onChange({ count: v })}
    />
  );
  const total = arrayCopyCount(p);

  return (
    <div className="array-fields">
      {choice('Tipo', 'Lineare: una fila; Griglia: righe, colonne e livelli; Circolare: attorno a un asse.', p.kind, (Object.keys(KIND_LABELS) as ArrayParams['kind'][]).map((k) => [k, KIND_LABELS[k]]), (kind) => onChange({ kind }))}

      {p.kind === 'linear' && (
        <>
          {copies}
          {vector(p.spacing === 'step' ? 'Passo (mm)' : 'Totale (mm)', p.spacing === 'step' ? 'Spostamento tra due copie, su X, Y e Z.' : 'Spostamento dalla prima all\'ultima copia, su X, Y e Z.', 'step')}
          {choice('Distanza', 'Passo: la distanza vale tra due copie. Totale: dalla prima all\'ultima.', p.spacing, [['step', 'Passo'], ['total', 'Totale']], (spacing) => onChange({ spacing }))}
          {check('Con l\'originale', 'L\'originale è la prima copia. Senza, restano solo le copie.', 'includeOriginal')}
        </>
      )}

      {p.kind === 'grid' && (
        <>
          {vector('Copie', 'Quante copie su X, Y e Z (il prodotto non supera 200).', 'counts', { min: 1, max: ARRAY_MAX_COPIES, step: 1 })}
          {vector('Passo (mm)', 'Distanza tra due copie su X, Y e Z.', 'gridStep')}
        </>
      )}

      {p.kind === 'circular' && (
        <>
          {copies}
          <SliderField
            label="Angolo"
            tooltip="Angolo totale in gradi: 360 è il giro completo, meno gradi danno un arco dalla prima all'ultima copia."
            value={p.angle}
            min={1}
            max={360}
            step={1}
            unit="°"
            disabled={disabled}
            history={history}
            onCommit={(v) => onChange({ angle: v })}
          />
          {choice('Asse', 'Asse di rotazione della serie.', p.axis, [[0, 'X'], [1, 'Y'], [2, 'Z']], (axis) => onChange({ axis: axis as ArrayParams['axis'] }))}
          {vector('Centro (mm)', 'Punto per cui passa l\'asse, relativo al centro dell\'oggetto.', 'center')}
          {check('Ruota le copie', 'Le copie ruotano con la serie; senza, restano orientate come l\'originale.', 'rotateCopies')}
          {check('Con l\'originale', 'L\'originale è la prima copia. Senza, restano solo le copie.', 'includeOriginal')}
        </>
      )}

      <p className="array-fields__total" role="status">
        {total === 1 ? '1 copia' : `${total} copie`} in totale{p.kind !== 'grid' && p.count > ARRAY_MAX_COPIES ? ` (limite ${ARRAY_MAX_COPIES})` : ''}
      </p>
    </div>
  );
}
