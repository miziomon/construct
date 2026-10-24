import { useState } from 'react';
import type { ProfileParams } from '../../scene/types';
import { ExprField } from './ExprField';
import { resolveLocal } from './profileParams';

export interface ParamsPanelProps {
  /** Parametri locali del profilo (numeri o espressioni); assente = nessuno. */
  params: ProfileParams | undefined;
  /** Quante quote e quanti altri parametri usano il parametro `name`. */
  usedBy: (name: string) => number;
  /** Aggiunge un parametro: nome e valore come scritti. Restituisce vero se è stato aggiunto (allora i campi si svuotano). */
  onAdd: (name: string, text: string) => boolean;
  /** Cambia il valore (numero o espressione) di un parametro. */
  onSet: (name: string, text: string) => void;
  onDelete: (name: string) => void;
}

/**
 * Sezione «Parametri» della colonna di destra: i parametri locali del profilo, con nome, valore (numero o espressione, che può
 * usare gli altri parametri) ed eliminazione, e la riga per aggiungerne uno. Le quote e il raggio dei nodi li usano scrivendo
 * un'espressione (`larghezza/2 + 3`); cambiando un parametro le quote si rileggono e il disegno si risolve in un solo passo.
 */
export function ParamsPanel({ params, usedBy, onAdd, onSet, onDelete }: ParamsPanelProps) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const entries = Object.entries(params ?? {});
  const { values } = resolveLocal(params);
  const add = () => {
    if (onAdd(name, value)) {
      setName('');
      setValue('');
    }
  };
  return (
    <section className="profile-editor__section" data-params-panel="">
      <h3 className="profile-editor__section-title">Parametri</h3>
      {entries.length === 0 ? (
        <p className="profile-editor__hint">Nessun parametro. Un parametro (per esempio larghezza) si può usare nelle quote scrivendo un&apos;espressione come larghezza/2 + 3.</p>
      ) : (
        <ul className="profile-editor__params">
          {entries.map(([key, v]) => {
            const users = usedBy(key);
            return (
              <li key={key} className="profile-editor__param" data-param={key}>
                <div className="profile-editor__constraint-head">
                  <span className="profile-editor__param-name" title={users ? `Usato da ${users} ${users === 1 ? 'quota o parametro' : 'quote o parametri'}` : 'Non usato'}>
                    {key}
                  </span>
                  <button type="button" className="profile-editor__mini" aria-label={`Elimina il parametro ${key}`} title={users ? 'Eliminabile solo se nessuna quota lo usa' : 'Elimina'} onClick={() => onDelete(key)}>
                    ×
                  </button>
                </div>
                <ExprField label="Valore" ariaLabel={`Valore del parametro ${key}`} value={values[key] ?? 0} expr={typeof v === 'string' ? v : undefined} onCommit={(text) => onSet(key, text)} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="profile-editor__param-add" role="group" aria-label="Nuovo parametro">
        <input
          type="text"
          className="number-field__input"
          aria-label="Nome del nuovo parametro"
          placeholder="nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            e.stopPropagation();
          }}
        />
        <input
          type="text"
          className="number-field__input"
          aria-label="Valore del nuovo parametro"
          placeholder="valore"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            e.stopPropagation();
          }}
        />
        <button type="button" className="profile-editor__mini" data-param-add="" title="Aggiunge il parametro: il nome è una parola senza spazi (lettere, cifre, trattino basso), il valore un numero o un'espressione" onClick={add}>
          Aggiungi
        </button>
      </div>
    </section>
  );
}
