import { useRef } from 'react';
import { useSceneStore } from '../../scene/store';
import { NumberField } from '../NumberField/NumberField';
import './SliderField.scss';

interface Props {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  /** Spiegazione di cosa è e cosa fa il controllo: tooltip sulla riga e descrizione accessibile. */
  tooltip: string;
  /** Estremi dello slider. Il campo numerico accetta anche valori fuori range, entro min/max assoluti. */
  min: number;
  max: number;
  step?: number;
  /** Limiti assoluti del campo numerico (oltre gli estremi dello slider), se esistono. */
  hardMin?: number;
  hardMax?: number;
  unit?: string;
  disabled?: boolean;
}

/**
 * Slider con campo numerico accanto. Trascinando lo slider la scena si aggiorna dal vivo,
 * ma tutto il trascinamento vale un solo passo di Annulla (Ctrl+Z).
 */
export function SliderField({ label, value, onCommit, tooltip, min, max, step = 1, hardMin, hardMax, unit, disabled }: Props) {
  // Valore prima del trascinamento e ultimo valore raggiunto (null = nessun trascinamento in corso)
  const drag = useRef<{ start: number; last: number } | null>(null);

  /** Chiude il trascinamento: la cronologia registra un solo passo, dal valore iniziale a quello finale. */
  const finish = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const history = useSceneStore.temporal.getState();
    if (d.last !== d.start) {
      // Ancora in pausa: si torna al valore iniziale senza registrare, poi si riprende e si applica il finale
      onCommit(d.start);
      history.resume();
      onCommit(d.last);
    } else {
      history.resume();
    }
  };

  return (
    <div className="slider-field" title={tooltip}>
      <span className="slider-field__label">{label}</span>
      <input
        className="slider-field__range"
        type="range"
        aria-label={label}
        aria-description={tooltip}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        // Fuori range lo slider resta al limite più vicino
        value={Math.min(max, Math.max(min, value))}
        onPointerDown={() => {
          drag.current = { start: value, last: value };
          useSceneStore.temporal.getState().pause();
        }}
        // Dopo il trascinamento il fuoco torna alla pagina: le scorciatoie (Ctrl+Z) ignorano i campi in primo piano
        onPointerUp={(e) => {
          finish();
          e.currentTarget.blur();
        }}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (drag.current) drag.current.last = v;
          onCommit(v);
        }}
      />
      <NumberField label="" unit={unit} step={step} min={hardMin} max={hardMax} disabled={disabled} value={value} onCommit={onCommit} />
    </div>
  );
}
