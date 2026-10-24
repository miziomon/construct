import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  /** Nome accessibile quando l'etichetta visibile è troppo breve per distinguere il campo (es. «Valore» in un elenco). */
  ariaLabel?: string;
  unit?: string;
  /** Il valore (valutato): quello che il disegno ha. */
  value: number;
  /** L'espressione da cui deriva, se c'è: il campo la mostra al posto del numero, con ƒ e il valore calcolato. */
  expr?: string;
  /** Il testo scritto, alla conferma (Invio o uscita dal campo): lo legge chi chiama, con i parametri del profilo. */
  onCommit: (text: string) => void;
  disabled?: boolean;
  /** Più elementi con valori diversi: il campo è vuoto con «—» e scrivere un valore lo dà a tutti. */
  mixed?: boolean;
}

/** Numero con al più 3 decimali, come lo mostra `NumberField`. */
const fmt = (n: number): string => String(Number(n.toFixed(3)));

/**
 * Campo di un valore che può essere un numero o un'espressione con i parametri locali del profilo (`larghezza/2 + 3`). Come
 * `NumberField` conferma solo alla fine (Invio o uscita dal campo, Esc annulla) e dà il testo così com'è: non lo interpreta
 * (lo fa chi chiama, che conosce i parametri). Con un'espressione mostra ƒ e il valore calcolato accanto. Non è un
 * `NumberField` perché quello non conosce i parametri del profilo (non ha il `FormulaContext`, che esiste solo nelle Proprietà).
 */
export function ExprField({ label, ariaLabel, unit, value, expr, onCommit, disabled, mixed }: Props) {
  const shown = mixed ? '' : (expr ?? fmt(value));
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  // Esc annulla: il blur parte nello stesso gestore, prima che il testo si aggiorni
  const cancelled = useRef(false);
  // Fuori dal campo il testo segue il valore (dopo una risoluzione, un Annulla...)
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);

  return (
    <label className="number-field" data-expr-field={expr ? '' : undefined}>
      <span className="number-field__label">{label}</span>
      <input
        className="number-field__input"
        type="text"
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
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          // Vuoto o uguale a prima: niente da confermare (con valori diversi, mixed, un valore scritto vale per tutti)
          if (e.target.value.trim() === shown || e.target.value.trim() === '') setText(shown);
          else onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            setText(shown);
            e.currentTarget.blur();
          }
        }}
      />
      {expr && (
        <span className="number-field__unit" data-expr-value="" title={`Espressione: vale ${fmt(value)}${unit ? ` ${unit}` : ''}`}>
          ƒ = {fmt(value)}
        </span>
      )}
      {unit && <span className="number-field__unit">{unit}</span>}
    </label>
  );
}
