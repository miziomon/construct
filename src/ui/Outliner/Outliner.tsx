import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CircleDashed, GripVertical, Lock, Package } from 'lucide-react';
import { isLocked, useSceneStore } from '../../scene/store';
import { useUiStore } from '../uiStore';
import { PRIMITIVE_ICONS, SHAPE2D_ICONS } from '../ShapeLibrary/ShapeLibrary';
import { GROUP_ICONS, GROUP_NAMES } from '../groupIcons';
import { dropTarget, zoneAt, type DropZone } from './dnd';
import './Outliner.scss';

/** Tipo MIME del trascinamento interno: i file trascinati dal sistema (importazione) restano un'altra cosa. */
const DRAG_TYPE = 'application/x-webcad-node';

/** Nodo trascinato in questo momento: durante il trascinamento il browser non permette di leggere il dataTransfer. */
let draggedId: string | null = null;

interface Hint {
  id: string;
  zone: DropZone;
}

interface RowProps {
  id: string;
  depth: number;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  hint: Hint | null;
  setHint: (hint: Hint | null) => void;
}

/** Campo di testo per cambiare il nome: Invio o perdita del fuoco confermano, Esc annulla. */
function RenameInput({ id, name }: { id: string; name: string }) {
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  /** Chiude la modifica; con `save` il nome cambia solo se non è vuoto e diverso (un solo passo di Annulla). */
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = draft.trim();
    if (save && next && next !== name) useSceneStore.getState().updateNode(id, { name: next });
    useUiStore.getState().setRenamingId(null);
  };

  return (
    <input
      ref={input}
      className="outliner__rename"
      aria-label="Nome dell'oggetto"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
    />
  );
}

/** Riga ricorsiva: i gruppi mostrano i figli sotto di sé. */
function Row({ id, depth, collapsed, toggle, hint, setHint }: RowProps) {
  const node = useSceneStore((s) => s.scene.nodes[id]);
  const selected = useSceneStore((s) => s.selection.includes(id));
  const select = useSceneStore((s) => s.select);
  const locked = useSceneStore((s) => isLocked(s.scene, id));
  const editing = useUiStore((s) => s.renamingId === id);
  const setRenamingId = useUiStore((s) => s.setRenamingId);
  const [dragging, setDragging] = useState(false);
  if (!node) return null;

  const isGroup = node.type === 'group';
  const isOpen = isGroup && !collapsed.has(id);
  const Icon = node.type === 'group' ? GROUP_ICONS[node.op] : node.type === 'mesh' ? Package : node.type === 'shape2d' ? SHAPE2D_ICONS[node.kind] : PRIMITIVE_ICONS[node.kind];
  const kindLabel = node.type === 'group' ? GROUP_NAMES[node.op] : undefined;
  const dropHere = hint?.id === id ? hint.zone : null;
  const cls = [
    'outliner__row',
    selected && 'outliner__row--selected',
    node.mode === 'hole' && 'outliner__row--hole',
    dragging && 'outliner__row--dragging',
    dropHere && `outliner__row--drop-${dropHere}`,
  ]
    .filter(Boolean)
    .join(' ');

  /** Zona e destinazione del rilascio sotto il puntatore, se il trascinamento in corso è valido qui. */
  const targetAt = (e: React.DragEvent<HTMLDivElement>) => {
    if (!draggedId) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const zone = zoneAt((e.clientY - rect.top) / rect.height, isGroup);
    const target = dropTarget(useSceneStore.getState().scene, draggedId, id, zone);
    return target ? { zone, target } : null;
  };

  return (
    <>
      <li>
        <div
          className={cls}
          style={{ paddingLeft: 8 + depth * 16 }}
          role="button"
          tabIndex={0}
          draggable={!editing && !locked}
          onClick={(e) => select([id], e.shiftKey || e.ctrlKey || e.metaKey)}
          onDoubleClick={() => setRenamingId(id)}
          onKeyDown={(e) => {
            if (editing) return;
            if (e.key === 'Enter' || e.key === ' ') select([id]);
            if (e.key === 'F2') setRenamingId(id);
          }}
          onDragStart={(e) => {
            draggedId = id;
            e.dataTransfer.setData(DRAG_TYPE, id);
            e.dataTransfer.effectAllowed = 'move';
            setDragging(true);
          }}
          onDragEnd={() => {
            draggedId = null;
            setDragging(false);
            setHint(null);
          }}
          onDragOver={(e) => {
            const hit = targetAt(e);
            // Senza trascinamento interno (es. un file dal sistema) o con una destinazione non valida non si fa nulla
            if (!hit) return setHint(null);
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            if (hint?.id !== id || hint.zone !== hit.zone) setHint({ id, zone: hit.zone });
          }}
          onDrop={(e) => {
            const hit = targetAt(e);
            if (!hit || !draggedId) return;
            e.preventDefault();
            e.stopPropagation();
            useSceneStore.getState().moveNode(draggedId, hit.target);
            draggedId = null;
            setHint(null);
          }}
        >
          <GripVertical size={12} className="outliner__grip" aria-hidden="true" />
          {isGroup ? (
            <button
              type="button"
              className="outliner__chevron"
              aria-label={isOpen ? 'Comprimi' : 'Espandi'}
              onClick={(e) => {
                e.stopPropagation();
                toggle(id);
              }}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="outliner__chevron" />
          )}
          <span title={kindLabel} className="outliner__icon-wrap">
            <Icon size={15} className="outliner__icon" />
          </span>
          {editing ? <RenameInput id={id} name={node.name} /> : <span className="outliner__name">{node.name}</span>}
          {locked && <Lock size={13} className={`outliner__lock${node.locked ? '' : ' outliner__lock--inherited'}`} aria-label="Bloccato" />}
          {node.mode === 'hole' && <CircleDashed size={14} className="outliner__hole-badge" aria-label="Foro" />}
        </div>
      </li>
      {isGroup && isOpen && node.children.map((c) => <Row key={c} id={c} depth={depth + 1} collapsed={collapsed} toggle={toggle} hint={hint} setHint={setHint} />)}
    </>
  );
}

export function Outliner() {
  const rootIds = useSceneStore((s) => s.scene.rootIds);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState<Hint | null>(null);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Rilasciare nello spazio vuoto dell'elenco porta l'oggetto alla radice, in fondo. */
  const emptyAreaTarget = () => {
    if (!draggedId) return null;
    const { scene } = useSceneStore.getState();
    const target = { parentId: null, index: scene.rootIds.length };
    return dropTarget(scene, draggedId, scene.rootIds[scene.rootIds.length - 1], 'after') && target;
  };

  return (
    <section className="outliner">
      <h2 className="outliner__title">Oggetti</h2>
      {rootIds.length === 0 ? (
        <p className="outliner__empty">La scena è vuota. Aggiungi una forma dalla libreria.</p>
      ) : (
        <ul
          className="outliner__list"
          onDragOver={(e) => {
            // Solo sullo spazio vuoto: le righe gestiscono il proprio rilascio e fermano l'evento
            if (!emptyAreaTarget()) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            const target = emptyAreaTarget();
            if (!target || !draggedId) return;
            e.preventDefault();
            useSceneStore.getState().moveNode(draggedId, target);
            draggedId = null;
            setHint(null);
          }}
        >
          {rootIds.map((id) => (
            <Row key={id} id={id} depth={0} collapsed={collapsed} toggle={toggle} hint={hint} setHint={setHint} />
          ))}
        </ul>
      )}
    </section>
  );
}
