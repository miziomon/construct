import { NumberField } from '../NumberField/NumberField';
import { CONSTRAINT_GLYPHS, CONSTRAINT_NAMES, CONSTRAINT_NEEDS, SELECTION_CONSTRAINTS, describeConstraint, dimensionValue, isDimension, isPositionedDimension, nodeNames } from './dimensions';
import type { SelectionConstraint } from './dimensions';
import type { PathContour, ProfileConstraint } from '../../scene/types';

export interface ConstraintsPanelProps {
  paths: PathContour[];
  constraints: ProfileConstraint[];
  /** Quali vincoli si possono creare con ciò che è scelto (nodi con Seleziona, segmenti con Alt+clic): abilita i pulsanti. */
  can: Record<SelectionConstraint, boolean>;
  /** Che cosa è scelto, a parole («2 nodi e 1 segmento scelti»), o vuoto se non c'è nulla. */
  selectionText: string;
  /** Vincoli in conflitto o ridondanti (rossi). */
  bad: Set<string>;
  /** Vincolo scelto nell'elenco (anche l'icona o l'etichetta sul disegno lo sceglie). */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Aggiunge il vincolo ai nodi scelti. */
  onApply: (type: SelectionConstraint) => void;
  /** Cambia il valore di una quota. */
  onValue: (id: string, value: number) => void;
  onDelete: (id: string) => void;
  /** Ridispone tutte le quote di lunghezza fuori dal disegno e senza sovrapposizioni (un passo di cronologia). */
  onReposition: () => void;
}

/** Spiegazione di ogni pulsante: che nodi servono. */
const BUTTON_TIPS: Record<SelectionConstraint, string> = {
  horizontal: 'Orizzontale: i due estremi alla stessa altezza',
  vertical: 'Verticale: i due estremi sulla stessa verticale',
  fixed: 'Fisso: i nodi scelti restano dove sono quando si sposta il resto del disegno',
  coincident: 'Coincidente: i due nodi scelti nello stesso punto',
  parallel: 'Parallelo: i due segmenti hanno la stessa direzione',
  perpendicular: 'Perpendicolare: i due segmenti formano un angolo di 90 gradi',
  equal: 'Uguale: i due segmenti hanno la stessa lunghezza',
  collinear: 'Collineare: i due segmenti stanno sulla stessa retta',
  midpoint: 'Punto medio: il nodo sta a metà del segmento',
  symmetric: 'Simmetrico: i due nodi sono uno lo specchio dell\'altro rispetto al segmento',
};

/**
 * Sezione «Quote e vincoli» della colonna di destra: i pulsanti dei vincoli (Orizzontale, Verticale, Fisso, Coincidente,
 * Parallelo, Perpendicolare, Uguale, Punto medio, Simmetrico, Collineare) per ciò che è scelto e l'elenco di tutte le quote e i vincoli del disegno, con il valore modificabile delle quote.
 */
export function ConstraintsPanel({ paths, constraints, can, selectionText, bad, selected, onSelect, onApply, onValue, onDelete, onReposition }: ConstraintsPanelProps) {
  const names = nodeNames(paths);
  return (
    <section className="profile-editor__section" data-quotes-panel="">
      <h3 className="profile-editor__section-title">Quote e vincoli</h3>
      <div className="profile-editor__constraint-buttons" role="group" aria-label="Vincoli per i nodi scelti">
        {SELECTION_CONSTRAINTS.map((type) => (
          <button key={type} type="button" disabled={!can[type]} title={`${BUTTON_TIPS[type]}. Serve: ${CONSTRAINT_NEEDS[type]}`} data-constraint-button={type} onClick={() => onApply(type)}>
            <span aria-hidden="true">{CONSTRAINT_GLYPHS[type]}</span> {CONSTRAINT_NAMES[type]}
          </button>
        ))}
      </div>
      <p className="profile-editor__hint">
        {selectionText || 'Scegli dei nodi con Seleziona (Maiusc+clic per più nodi) e dei segmenti con Alt+clic (Maiusc+Alt+clic per un secondo segmento) per aggiungere un vincolo. Con Quota (D) clicca un segmento o due nodi, o due segmenti per l\'angolo.'}
      </p>
      {constraints.some(isPositionedDimension) && (
        <button type="button" className="profile-editor__mini" data-reposition="" title="Ridispone tutte le quote di lunghezza fuori dal disegno, senza sovrapposizioni. Si possono anche trascinare: l'etichetta lungo la linea, la linea più o meno lontana" onClick={onReposition}>
          Riposiziona quote
        </button>
      )}
      {constraints.length === 0 ? (
        <p className="profile-editor__hint">Nessuna quota né vincolo.</p>
      ) : (
        <ul className="profile-editor__constraints">
          {constraints.map((c) => {
            const label = describeConstraint(c, names);
            const dim = isDimension(c);
            const unit = c.t === 'angle' ? '°' : 'mm';
            const className = `profile-editor__constraint${selected === c.id ? ' profile-editor__constraint--selected' : ''}${bad.has(c.id) ? ' profile-editor__constraint--bad' : ''}`;
            return (
              <li key={c.id} className={className} data-constraint={c.id} data-constraint-type={c.t}>
                <div className="profile-editor__constraint-head">
                  <button type="button" className="profile-editor__constraint-name" title={label} onClick={() => onSelect(selected === c.id ? null : c.id)}>
                    <span aria-hidden="true">{CONSTRAINT_GLYPHS[c.t]}</span> {label}
                  </button>
                  <button type="button" className="profile-editor__mini" aria-label={`Elimina ${label}`} title="Elimina" onClick={() => onDelete(c.id)}>
                    ×
                  </button>
                </div>
                {dim &&
                  (c.ref ? (
                    <p className="profile-editor__hint">({String(Math.round(dimensionValue(c, paths) * 100) / 100).replace('.', ',')} {unit}) quota di riferimento</p>
                  ) : (
                    <NumberField label="Valore" ariaLabel={`Valore di ${label}`} unit={unit} value={c.v ?? 0} onCommit={(v) => onValue(c.id, v)} />
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
