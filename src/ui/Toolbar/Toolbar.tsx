import { ArrowDownToLine, Code, Copy, Lock, Unlock, Group, MousePointer2, Move3d, Redo2, Rotate3d, Scaling, ArrowUpFromLine, Trash2, Ungroup, Undo2, CircleDashed } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { useSceneStore } from '../../scene/store';
import { useUiStore } from '../uiStore';
import { dropSelectionToBed } from '../../kernel/placement';
import { AppMenu } from '../AppMenu/AppMenu';
import './Toolbar.scss';

interface ButtonProps {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  label?: string;
}

/** Pulsante a icona con etichetta opzionale; "title" è anche il testo accessibile. */
function ToolbarButton({ title, onClick, children, active, disabled, label }: ButtonProps) {
  const cls = ['toolbar__button', active && 'toolbar__button--active', label && 'toolbar__button--labeled'].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} title={title} aria-label={title} aria-pressed={active} disabled={disabled} onClick={onClick}>
      {children}
      {label && <span className="toolbar__button-label">{label}</span>}
    </button>
  );
}

const Divider = () => <span className="toolbar__divider" role="separator" />;

export function Toolbar() {
  const s = useSceneStore();
  const canUndo = useStore(useSceneStore.temporal, (t) => t.pastStates.length > 0);
  const canRedo = useStore(useSceneStore.temporal, (t) => t.futureStates.length > 0);
  const { codeEnabled, toggleCode } = useUiStore();

  const hasSelection = s.selection.length > 0;
  const rootSelection = s.selection.filter((id) => s.scene.rootIds.includes(id));
  const group = s.selection.length === 1 ? s.scene.nodes[s.selection[0]] : undefined;
  const allLocked = hasSelection && s.selection.every((id) => s.scene.nodes[id]?.locked);
  const allHoles = hasSelection && s.selection.every((id) => s.scene.nodes[id]?.mode === 'hole');

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        WebCAD <span className="toolbar__version">v{__APP_VERSION__}</span>
      </div>

      <div className="toolbar__group">
        <ToolbarButton title="Annulla (Ctrl+Z)" disabled={!canUndo} onClick={() => useSceneStore.temporal.getState().undo()}><Undo2 size={18} /></ToolbarButton>
        <ToolbarButton title="Ripeti (Ctrl+Y)" disabled={!canRedo} onClick={() => useSceneStore.temporal.getState().redo()}><Redo2 size={18} /></ToolbarButton>
      </div>
      <Divider />

      <div className="toolbar__group">
        <ToolbarButton title="Seleziona (Q)" active={s.gizmoMode === 'select'} onClick={() => s.setGizmoMode('select')}><MousePointer2 size={18} /></ToolbarButton>
        <ToolbarButton title="Sposta (W)" active={s.gizmoMode === 'translate'} onClick={() => s.setGizmoMode('translate')}><Move3d size={18} /></ToolbarButton>
        <ToolbarButton title="Ruota (E)" active={s.gizmoMode === 'rotate'} onClick={() => s.setGizmoMode('rotate')}><Rotate3d size={18} /></ToolbarButton>
        <ToolbarButton title="Ridimensiona con il mouse (R): trascina le maniglie, la base resta ferma" active={s.gizmoMode === 'resize'} onClick={() => s.setGizmoMode('resize')}><Scaling size={18} /></ToolbarButton>
        <ToolbarButton title="Estrudi forme 2D con il mouse (T): trascina la maniglia verticale" active={s.gizmoMode === 'extrude'} onClick={() => s.setGizmoMode('extrude')}><ArrowUpFromLine size={18} /></ToolbarButton>
      </div>
      <Divider />

      <div className="toolbar__group">
        <ToolbarButton title="Raggruppa (Ctrl+G)" disabled={rootSelection.length < 2} onClick={s.groupSelected}><Group size={18} /></ToolbarButton>
        <ToolbarButton title="Separa gruppo (Ctrl+Maiusc+G)" disabled={group?.type !== 'group' || !s.scene.rootIds.includes(group.id)} onClick={s.ungroupSelected}><Ungroup size={18} /></ToolbarButton>
        <ToolbarButton title="Solido / Foro (H)" active={allHoles} disabled={!hasSelection} onClick={s.toggleHoleSelected}><CircleDashed size={18} /></ToolbarButton>
        <ToolbarButton title={allLocked ? 'Sblocca (L)' : 'Blocca (L)'} active={allLocked} disabled={!hasSelection} onClick={s.toggleLockSelected}>{allLocked ? <Lock size={18} /> : <Unlock size={18} />}</ToolbarButton>
        <ToolbarButton title="Appoggia sul piatto (B)" disabled={rootSelection.length === 0} onClick={dropSelectionToBed}><ArrowDownToLine size={18} /></ToolbarButton>
        <ToolbarButton title="Duplica (Ctrl+D)" disabled={rootSelection.length === 0} onClick={s.duplicateSelected}><Copy size={18} /></ToolbarButton>
        <ToolbarButton title="Elimina (Canc)" disabled={!hasSelection} onClick={s.removeSelected}><Trash2 size={18} /></ToolbarButton>
      </div>

      <div className="toolbar__spacer" />

      <div className="toolbar__group">
        <ToolbarButton title="Pannello codice OpenSCAD (Ctrl+J)" active={codeEnabled} onClick={toggleCode} label="Codice"><Code size={18} /></ToolbarButton>
        <AppMenu />
      </div>
    </header>
  );
}
