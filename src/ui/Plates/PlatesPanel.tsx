import { useRef, useState } from 'react';
import { ArrowRightToLine, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { activePlateId, platesOf } from '../../scene/plates';
import { useSceneStore } from '../../scene/store';
import { activatePlate, createPlate, deletePlate, moveSelectionToPlate } from './plateActions';
import './PlatesPanel.scss';

/** Nome del piatto che si può cambiare: doppio clic o matita. Invio conferma, Esc annulla. */
function PlateName({ id, name, editing, setEditing }: { id: string; name: string; editing: boolean; setEditing: (editing: boolean) => void }) {
  // Invio e perdita del fuoco arrivano di seguito: il nome si salva una sola volta
  const settled = useRef(false);
  if (!editing) {
    return (
      <span className="plates__name" onDoubleClick={() => { settled.current = false; setEditing(true); }}>
        {name}
      </span>
    );
  }
  const finish = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    if (value !== null && value.trim() && value.trim() !== name) useSceneStore.getState().renamePlate(id, value);
  };
  return (
    <input
      className="plates__rename"
      aria-label={`Nome del piatto ${name}`}
      defaultValue={name}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

/**
 * Elenco dei piatti del progetto (scheda "Piatti" accanto a "Oggetti"). Un clic attiva il piatto, e la vista mostra solo
 * i suoi oggetti. Gli oggetti selezionati si spostano in un altro piatto con il pulsante di ogni scheda.
 */
export function PlatesPanel() {
  const scene = useSceneStore((s) => s.scene);
  const selection = useSceneStore((s) => s.selection);
  const [editingId, setEditingId] = useState<string | null>(null);
  const plates = platesOf(scene);
  const active = activePlateId(scene);
  // Si possono spostare solo gli oggetti del piatto attivo, alla radice
  const movable = selection.filter((id) => scene.rootIds.includes(id) && !scene.nodes[id]?.locked);

  return (
    <div className="plates">
      <ul className="plates__list" aria-label="Piatti">
        {plates.map((p) => {
          const names = p.rootIds.map((r) => scene.nodes[r]?.name).filter(Boolean) as string[];
          const isActive = p.id === active;
          return (
            <li key={p.id} className={`plates__card${isActive ? ' plates__card--active' : ''}`} data-plate={p.id}>
              <div className="plates__head">
                <button
                  type="button"
                  className="plates__select"
                  aria-label={`Attiva ${p.name}`}
                  aria-pressed={isActive}
                  title={isActive ? `${p.name} (piatto attivo)` : `Mostra ${p.name}`}
                  onClick={() => activatePlate(p.id)}
                >
                  <Layers size={14} />
                </button>
                <PlateName id={p.id} name={p.name} editing={editingId === p.id} setEditing={(e) => setEditingId(e ? p.id : null)} />
                <span className="plates__count">{p.rootIds.length === 0 ? 'vuoto' : p.rootIds.length === 1 ? '1 oggetto' : `${p.rootIds.length} oggetti`}</span>
                <button type="button" className="plates__icon" aria-label={`Rinomina ${p.name}`} title="Rinomina (o doppio clic sul nome)" onClick={() => setEditingId(p.id)}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="plates__icon" aria-label={`Elimina ${p.name}`} title={plates.length < 2 ? 'Serve almeno un piatto' : 'Elimina il piatto e i suoi oggetti'} disabled={plates.length < 2} onClick={() => void deletePlate(p.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
              {names.length > 0 && <p className="plates__objects">{names.slice(0, 4).join(', ')}{names.length > 4 ? '…' : ''}</p>}
              {!isActive && movable.length > 0 && (
                <button type="button" className="plates__move" aria-label={`Sposta qui la selezione in ${p.name}`} onClick={() => moveSelectionToPlate(p.id)}>
                  <ArrowRightToLine size={13} />
                  Sposta qui {movable.length === 1 ? "l'oggetto selezionato" : `i ${movable.length} oggetti selezionati`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="plates__add" onClick={createPlate}>
        <Plus size={14} />
        Aggiungi piatto
      </button>
    </div>
  );
}
