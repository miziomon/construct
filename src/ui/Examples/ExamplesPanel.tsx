import { EXAMPLES, type Example } from '../../examples/catalog';
import { openExample } from '../fileActions';
import './ExamplesPanel.scss';

/**
 * Corpo della modale "Modelli di esempio": una scheda per esempio con anteprima, titolo, descrizione e crediti. La
 * scelta sostituisce la scena (si torna indietro con Annulla) e chiude la modale. Caricato solo all'apertura.
 */
export default function ExamplesPanel({ run }: { run: (action: () => void | Promise<void>) => () => void }) {
  return (
    <>
      <p>Modelli pronti da aprire e studiare: ogni scheda sostituisce la scena corrente (puoi tornare indietro con Ctrl+Z) e la inquadra. Apri l&apos;elenco degli oggetti e il codice OpenSCAD per vedere come sono costruiti.</p>
      <div className="examples" role="list">
        {EXAMPLES.map((example: Example) => (
          <button key={example.id} type="button" role="listitem" className="examples__card" data-example={example.id} onClick={run(() => openExample(example))}>
            {/* Anteprima generata da e2e/docs-images.spec.ts; se manca la scheda resta leggibile */}
            <img className="examples__image" src={`${import.meta.env.BASE_URL}examples/${example.id}.webp`} alt="" width="240" height="150" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            <span className="examples__title">{example.title}</span>
            <span className="examples__text">{example.text}</span>
            <span className="examples__credit">{example.credit}</span>
          </button>
        ))}
      </div>
    </>
  );
}
