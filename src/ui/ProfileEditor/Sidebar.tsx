import { NumberField } from '../NumberField/NumberField';
import type { PathNode } from '../../scene/types';
import type { Draft } from './model';

interface Props {
  draft: Draft;
  /** Nodo selezionato, solo se è uno (con più nodi si mostra solo il conteggio). */
  node: PathNode | null;
  selectedCount: number;
  onExtrusion: (mode: Draft['extrusion']) => void;
  onKind: (kind: PathNode['kind']) => void;
  /** Porta il nodo selezionato alla coordinata indicata (asse 0 = X, 1 = Y). */
  onCoordinate: (axis: 0 | 1, value: number) => void;
}

/** Tipi di nodo: il simbolo ripete la forma che il nodo ha nel disegno. */
const KINDS: { kind: PathNode['kind']; label: string; symbol: string }[] = [
  { kind: 'corner', label: 'Spigolo', symbol: '■' },
  { kind: 'smooth', label: 'Liscio', symbol: '●' },
  { kind: 'symmetric', label: 'Simmetrico', symbol: '◆' },
];

/** Colonna di destra della modale (versione essenziale: estrusione e punto selezionato). */
export function Sidebar({ draft, node, selectedCount, onExtrusion, onKind, onCoordinate }: Props) {
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
      </section>
      <section className="profile-editor__section">
        <h3 className="profile-editor__section-title">Punto selezionato</h3>
        {node ? (
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
          </>
        ) : (
          <p className="profile-editor__hint">{selectedCount > 1 ? `${selectedCount} nodi selezionati.` : 'Seleziona un nodo per leggerne e cambiarne le coordinate. Doppio clic su un nodo: cambia il tipo.'}</p>
        )}
      </section>
    </aside>
  );
}
