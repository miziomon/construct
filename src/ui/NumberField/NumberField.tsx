import { useEffect, useState } from 'react';
import { round } from '../../scene/math';
import './NumberField.scss';

interface Props {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/**
 * Campo numerico che modifica la scena solo alla conferma (Invio o uscita dal campo):
 * ogni modifica è così una singola voce di undo e non si ricalcola la geometria a ogni tasto.
 */
export function NumberField({ label, value, onCommit, min = -Infinity, max = Infinity, step = 1, unit }: Props) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // Allinea il testo al valore esterno (es. dopo un trascinamento del gizmo) quando non si sta scrivendo
  useEffect(() => {
    if (!focused) setText(String(round(value, 3)));
  }, [value, focused]);

  const commit = (raw: string) => {
    // Accetta la virgola decimale italiana
    const parsed = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(parsed)) {
      setText(String(round(value, 3)));
      return;
    }
    const next = round(Math.min(max, Math.max(min, parsed)), 3);
    setText(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <label className="number-field">
      <span className="number-field__label">{label}</span>
      <input
        className="number-field__input"
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          setFocused(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(String(round(value, 3)));
            e.currentTarget.blur();
          }
          // Frecce su/giù incrementano di uno step (Shift: dieci step)
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            const current = Number(text.replace(',', '.'));
            commit(String((Number.isFinite(current) ? current : value) + dir * step * (e.shiftKey ? 10 : 1)));
          }
        }}
      />
      {unit && <span className="number-field__unit">{unit}</span>}
    </label>
  );
}
