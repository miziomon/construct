import { useState } from 'react';
import { ChevronDown, ChevronRight, CircleDashed, Group, Lock } from 'lucide-react';
import { isLocked, useSceneStore } from '../../scene/store';
import { PRIMITIVE_ICONS } from '../ShapeLibrary/ShapeLibrary';
import './Outliner.scss';

interface RowProps {
  id: string;
  depth: number;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}

/** Riga ricorsiva: i gruppi mostrano i figli sotto di sé. */
function Row({ id, depth, collapsed, toggle }: RowProps) {
  const node = useSceneStore((s) => s.scene.nodes[id]);
  const selected = useSceneStore((s) => s.selection.includes(id));
  const select = useSceneStore((s) => s.select);
  const locked = useSceneStore((s) => isLocked(s.scene, id));
  if (!node) return null;

  const isGroup = node.type === 'group';
  const isOpen = isGroup && !collapsed.has(id);
  const Icon = node.type === 'group' ? Group : PRIMITIVE_ICONS[node.kind];
  const cls = ['outliner__row', selected && 'outliner__row--selected', node.mode === 'hole' && 'outliner__row--hole'].filter(Boolean).join(' ');

  return (
    <>
      <li>
        <div
          className={cls}
          style={{ paddingLeft: 8 + depth * 16 }}
          role="button"
          tabIndex={0}
          onClick={(e) => select([id], e.shiftKey || e.ctrlKey || e.metaKey)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && select([id])}
        >
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
          <Icon size={15} className="outliner__icon" />
          <span className="outliner__name">{node.name}</span>
          {locked && <Lock size={13} className={`outliner__lock${node.locked ? '' : ' outliner__lock--inherited'}`} aria-label="Bloccato" />}
          {node.mode === 'hole' && <CircleDashed size={14} className="outliner__hole-badge" aria-label="Foro" />}
        </div>
      </li>
      {isGroup && isOpen && node.children.map((c) => <Row key={c} id={c} depth={depth + 1} collapsed={collapsed} toggle={toggle} />)}
    </>
  );
}

export function Outliner() {
  const rootIds = useSceneStore((s) => s.scene.rootIds);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <section className="outliner">
      <h2 className="outliner__title">Oggetti</h2>
      {rootIds.length === 0 ? (
        <p className="outliner__empty">La scena è vuota. Aggiungi una forma dalla libreria.</p>
      ) : (
        <ul className="outliner__list">
          {rootIds.map((id) => (
            <Row key={id} id={id} depth={0} collapsed={collapsed} toggle={toggle} />
          ))}
        </ul>
      )}
    </section>
  );
}
