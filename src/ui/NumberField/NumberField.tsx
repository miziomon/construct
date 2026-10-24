import { useContext, useEffect, useRef, useState } from 'react';
import { round } from '../../scene/math';
import { evalFormula, formulaDeps } from '../../scene/params';
import { notify } from '../notify/notifyStore';
import { BoundValue } from './BoundValue';
import { FormulaContext } from './formulaContext';
import './NumberField.scss';

interface Props {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  /** Percorso del campo nel nodo ("size.2"): se c'è, un doppio clic sul nome apre il selettore dei parametri (vedi formulaContext). */
  path?: string;
  /** Nome del campo per il selettore dei parametri, se l'etichetta da sola non basta ("X" diventa "Posizione X"). */
  pickLabel?: string;
  /** Il campo vuole un numero intero (conteggi): il risultato di un calcolo si arrotonda. */
  integer?: boolean;
  /** Più elementi con valori diversi: il campo è vuoto con «—» e scrivere un valore lo dà a tutti. */
  mixed?: boolean;
  /** Nome accessibile del campo quando l'etichetta visibile è troppo breve per distinguerlo da altri (es. «Valore» in un elenco). */
  ariaLabel?: string;
}

/**
 * Campo numerico che modifica la scena solo alla conferma (Invio o uscita dal campo):
 * ogni modifica è così una singola voce di undo e non si ricalcola la geometria a ogni tasto.
 * Accetta anche un calcolo senza parametri ("10 / 2"). Nel pannello Proprietà un doppio clic sul nome lo lega a un
 * parametro: il campo diventa allora un'icona fx con il valore, non modificabile.
 */
export function NumberField({ label, value, onCommit, min = -Infinity, max = Infinity, step = 1, unit, disabled, path, pickLabel, integer, ariaLabel, mixed }: Props) {
  const [text, setText] = useState(mixed ? '' : String(value));
  const [focused, setFocused] = useState(false);
  // Esc annulla: all'uscita dal campo (blur) il testo scritto non si conferma. Serve un flag perché il blur parte nello
  // stesso gestore di Esc, prima che `setText` abbia aggiornato il valore che `onBlur` legge dal DOM
  const cancelled = useRef(false);
  const formulas = useContext(FormulaContext);
  // Formula legata a questo campo (solo dentro il pannello Proprietà e con un percorso)
  const formula = path ? formulas?.exprs?.[path]?.expr : undefined;

  // Allinea il testo al valore esterno (es. dopo un trascinamento del gizmo) quando non si sta scrivendo
  useEffect(() => {
    if (!focused) setText(mixed ? '' : String(round(value, 3)));
  }, [value, focused, mixed]);

  const commit = (raw: string) => {
    // Accetta la virgola decimale italiana
    const parsed = Number(raw.replace(',', '.'));
    if (raw.trim() === '') return setText(mixed ? '' : String(round(value, 3)));
    let number = parsed;
    if (!Number.isFinite(parsed)) {
      // Non è un numero semplice: un calcolo senza parametri ("10 / 2")
      const result = evalFormula(raw, {});
      if (!result.ok) {
        notify.error(formulaDeps(raw).length ? 'Per usare un parametro fai doppio clic sul nome del campo' : `Calcolo non valido: ${result.error}`);
        return setText(String(round(value, 3)));
      }
      number = result.value;
    }
    const clamped = Math.min(max, Math.max(min, number));
    const next = integer ? Math.round(clamped) : round(clamped, 3);
    setText(String(next));
    if (mixed || next !== value) onCommit(next);
  };

  /** Doppio clic sul nome: apre il selettore dei parametri (solo se il campo ha un percorso e c'è un oggetto). */
  const pickable = !!path && !!formulas && !disabled;
  const labelProps = pickable
    ? { onDoubleClick: () => formulas.pick(path, pickLabel ?? label, { ...(min > -Infinity && { min }), ...(max < Infinity && { max }), ...(integer && { int: true }) }), title: 'Doppio clic: usa un parametro', 'data-pickable': true }
    : {};

  if (formula) {
    return (
      <div className="number-field number-field--bound">
        <span className="number-field__label" {...labelProps}>{label}</span>
        <BoundValue value={value} formula={formula} />
        {unit && <span className="number-field__unit">{unit}</span>}
      </div>
    );
  }

  return (
    <label className="number-field">
      <span className="number-field__label" {...labelProps}>{label}</span>
      <input
        className="number-field__input"
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder={mixed ? '—' : undefined}
        disabled={disabled}
        value={text}
        onFocus={(e) => {
          cancelled.current = false;
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          setFocused(false);
          if (cancelled.current) cancelled.current = false;
          else commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
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
