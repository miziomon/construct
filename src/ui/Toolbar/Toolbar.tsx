import { SquareArrowDown, AlignHorizontalJustifyStart, ArrowDownToLine, FlipHorizontal2, Ruler, Code, Copy, Lock, Unlock, Group, MousePointer2, Move3d, Redo2, Rotate3d, SquaresUnite, Grid3x3, Moon, Sun, Scaling, ArrowUpFromLine, Trash2, Ungroup, Undo2, CircleDashed, FilePlus, Hash } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { isLocked, useSceneStore } from '../../scene/store';
import { useUiStore } from '../uiStore';
import type { BedMode } from '../uiStore';
import { combineToBed, dropSelectionToBed } from '../../kernel/placement';
import { ToolbarDropdown } from './ToolbarDropdown';
import { ToolTip } from './ToolTip';
import { TOOLBAR_HELP } from './toolbarHelp';
import type { HelpKey } from './toolbarHelp';
import { PlacementMenu } from './PlacementMenu';
import { useMeasure } from '../Measure/measureStore';
import { toggleMeasure } from '../Measure/toggleMeasure';
import { useLayFlat } from '../LayFlat/layFlatStore';
import { toggleLayFlat } from '../LayFlat/toggleLayFlat';
import { canArray, useArrayTool } from '../Array/arrayToolStore';
import { toggleArray } from '../Array/toggleArray';
import { canPattern, usePatternTool } from '../Pattern/patternToolStore';
import { togglePattern } from '../Pattern/togglePattern';
import { AppMenu } from '../AppMenu/AppMenu';
import { newProject } from '../fileActions';
import { CORNER_ICONS, EDGE_ICONS, GROUP_ICONS } from '../groupIcons';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { canShell, toggleShell, useShellTool } from '../Shell/shellToolStore';
import './Toolbar.scss';

interface ButtonProps {
  /** Voce di aiuto: dà il nome accessibile e il tooltip dettagliato (cosa fa, come si applica, immagine). */
  help: HelpKey;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  label?: string;
  /** Scorciatoia da tastiera, mostrata in piccolo sopra l'icona. */
  shortcut?: string;
  /** Testo in più nel tooltip, per i pulsanti il cui stato cambia. */
  extra?: string;
}

/** Scorciatoia come si legge nel tooltip: "^Z" diventa "Ctrl+Z". */
export function shortcutText(shortcut?: string): string | undefined {
  if (!shortcut) return undefined;
  if (shortcut === 'Del') return 'Canc';
  return shortcut.replace('⇧', 'Maiusc+').replace('^', 'Ctrl+');
}

/** Pulsante a icona con etichetta opzionale; il nome accessibile è quello della voce di aiuto. */
function ToolbarButton({ help, onClick, children, active, disabled, label, shortcut, extra }: ButtonProps) {
  const cls = ['toolbar__button', active && 'toolbar__button--active', label && 'toolbar__button--labeled'].filter(Boolean).join(' ');
  return (
    <ToolTip help={help} keys={shortcutText(shortcut)} extra={extra}>
      {(describedBy) => (
        <button type="button" className={cls} aria-label={TOOLBAR_HELP[help].name} aria-describedby={describedBy} aria-pressed={active} disabled={disabled} onClick={onClick}>
          {shortcut && <span className="toolbar__shortcut" aria-hidden="true">{shortcut}</span>}
          {children}
          {label && <span className="toolbar__button-label">{label}</span>}
        </button>
      )}
    </ToolTip>
  );
}

/** Nomi degli stati del piatto, per il tooltip del pulsante (stesso ciclo di cycleBed). */
const BED_LABELS: Record<BedMode, string> = { full: 'visibile', grid: 'senza base, griglia e bordo visibili', none: 'nascosto' };
const NEXT_BED: Record<BedMode, BedMode> = { full: 'grid', grid: 'none', none: 'full' };

const Divider = () => <span className="toolbar__divider" role="separator" />;

export function Toolbar() {
  const s = useSceneStore();
  const canUndo = useStore(useSceneStore.temporal, (t) => t.pastStates.length > 0);
  const canRedo = useStore(useSceneStore.temporal, (t) => t.futureStates.length > 0);
  const { codeOpen, toggleCode, theme, toggleTheme, bedMode, cycleBed, ghostOps, toggleGhostOps } = useUiStore();

  const edgeTool = useEdgeTool((e) => e.tool);
  const hasObjects = s.scene.rootIds.length > 0;
  /** Apre Raccordo, Smusso o Smusso angolare; un secondo clic sullo stesso pulsante annulla l'operazione. */
  const toggleEdgeTool = (kind: 'fillet' | 'chamfer' | 'corner') => {
    // Un solo strumento alla volta: il Guscio aperto si annulla prima
    useShellTool.getState().cancel();
    return edgeTool === kind ? useEdgeTool.getState().cancel() : useEdgeTool.getState().start(kind);
  };

  // Guscio: serve un solo oggetto selezionato (solido, non bloccato); un secondo clic sul pulsante annulla
  const shellActive = useShellTool((e) => e.active);
  const measureActive = useMeasure((e) => e.active);
  const layFlatActive = useLayFlat((e) => e.active);
  const arrayActive = useArrayTool((e) => e.active);
  const patternActive = usePatternTool((e) => e.active);

  const hasSelection = s.selection.length > 0;
  const rootSelection = s.selection.filter((id) => s.scene.rootIds.includes(id));
  // Allinea e Specchia agiscono solo su oggetti alla radice e non bloccati
  const unlockedRoots = rootSelection.filter((id) => !isLocked(s.scene, id));
  const group = s.selection.length === 1 ? s.scene.nodes[s.selection[0]] : undefined;
  const allLocked = hasSelection && s.selection.every((id) => s.scene.nodes[id]?.locked);
  const allHoles = hasSelection && s.selection.every((id) => s.scene.nodes[id]?.mode === 'hole');

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        WebCAD <span className="toolbar__version">v{__APP_VERSION__}</span>
      </div>

      <div className="toolbar__group">
        <ToolbarButton help="new" shortcut="N" onClick={() => void newProject()}><FilePlus size={18} /></ToolbarButton>
      </div>
      <Divider />

      <div className="toolbar__group">
        <ToolbarButton help="undo" shortcut="^Z" disabled={!canUndo} onClick={() => useSceneStore.temporal.getState().undo()}><Undo2 size={18} /></ToolbarButton>
        <ToolbarButton help="redo" shortcut="^Y" disabled={!canRedo} onClick={() => useSceneStore.temporal.getState().redo()}><Redo2 size={18} /></ToolbarButton>
      </div>
      <Divider />

      <div className="toolbar__group">
        <ToolbarButton help="select" shortcut="Q" active={s.gizmoMode === 'select'} onClick={() => s.setGizmoMode('select')}><MousePointer2 size={18} /></ToolbarButton>
        <ToolbarButton help="translate" shortcut="W" active={s.gizmoMode === 'translate'} onClick={() => s.setGizmoMode('translate')}><Move3d size={18} /></ToolbarButton>
        <ToolbarButton help="rotate" shortcut="E" active={s.gizmoMode === 'rotate'} onClick={() => s.setGizmoMode('rotate')}><Rotate3d size={18} /></ToolbarButton>
        <ToolbarButton help="resize" shortcut="R" active={s.gizmoMode === 'resize'} onClick={() => s.setGizmoMode('resize')}><Scaling size={18} /></ToolbarButton>
        <ToolbarButton help="extrude" shortcut="T" active={s.gizmoMode === 'extrude'} onClick={() => s.setGizmoMode('extrude')}><ArrowUpFromLine size={18} /></ToolbarButton>
      </div>
      <Divider />

      <div className="toolbar__group">
        <ToolbarButton help="group" shortcut="^G" disabled={rootSelection.length < 2} onClick={() => combineToBed('group')}><Group size={18} /></ToolbarButton>
        <ToolbarButton help="union" shortcut="U" disabled={rootSelection.length < 2} onClick={() => combineToBed('union')}><SquaresUnite size={18} /></ToolbarButton>
        <ToolbarButton help="hull" shortcut="J" disabled={rootSelection.length < 2} onClick={() => combineToBed('hull')}><GROUP_ICONS.hull size={18} /></ToolbarButton>
        <ToolbarButton help="ungroup" shortcut="⇧^G" disabled={group?.type !== 'group' || !s.scene.rootIds.includes(group.id)} onClick={s.ungroupSelected}><Ungroup size={18} /></ToolbarButton>
        <ToolbarButton help="hole" shortcut="H" active={allHoles} disabled={!hasSelection} onClick={s.toggleHoleSelected}><CircleDashed size={18} /></ToolbarButton>
        <ToolbarButton help={allLocked ? 'unlock' : 'lock'} shortcut="L" active={allLocked} disabled={!hasSelection} onClick={s.toggleLockSelected}>{allLocked ? <Lock size={18} /> : <Unlock size={18} />}</ToolbarButton>
        <ToolbarButton help="fillet" shortcut="F" active={edgeTool === 'fillet'} disabled={!hasObjects} onClick={() => toggleEdgeTool('fillet')}><EDGE_ICONS.fillet size={18} /></ToolbarButton>
        <ToolbarButton help="chamfer" shortcut="S" active={edgeTool === 'chamfer'} disabled={!hasObjects} onClick={() => toggleEdgeTool('chamfer')}><EDGE_ICONS.chamfer size={18} /></ToolbarButton>
        <ToolbarButton help="corner" shortcut="A" active={edgeTool === 'corner'} disabled={!hasObjects} onClick={() => toggleEdgeTool('corner')}><CORNER_ICONS.chamfer size={18} /></ToolbarButton>
        <ToolbarButton help="shell" shortcut="G" active={shellActive} disabled={!shellActive && !canShell(s.scene, s.selection)} onClick={toggleShell}><GROUP_ICONS.shell size={18} /></ToolbarButton>
        <ToolbarDropdown id="align" shortcut="K" help="align" icon={<AlignHorizontalJustifyStart size={18} />} disabled={unlockedRoots.length < 2}>
          {(close) => <PlacementMenu kind="align" close={close} />}
        </ToolbarDropdown>
        <ToolbarDropdown id="mirror" shortcut="Y" help="mirror" icon={<FlipHorizontal2 size={18} />} disabled={unlockedRoots.length < 1}>
          {(close) => <PlacementMenu kind="mirror" close={close} />}
        </ToolbarDropdown>
        <ToolbarButton help="measure" shortcut="I" active={measureActive} disabled={!hasObjects} onClick={toggleMeasure}><Ruler size={18} /></ToolbarButton>
        <ToolbarButton help="array" shortcut="O" active={arrayActive} disabled={!arrayActive && !canArray(s.scene, s.selection)} onClick={toggleArray}><GROUP_ICONS.array size={18} /></ToolbarButton>
        <ToolbarButton help="pattern" shortcut="Z" active={patternActive} disabled={!patternActive && !canPattern(s.scene, s.selection)} onClick={togglePattern}><GROUP_ICONS.pattern size={18} /></ToolbarButton>
        <ToolbarButton help="layflat" shortcut="V" active={layFlatActive} disabled={!hasObjects} onClick={toggleLayFlat}><SquareArrowDown size={18} /></ToolbarButton>
        <ToolbarButton help="drop" shortcut="B" disabled={rootSelection.length === 0} onClick={dropSelectionToBed}><ArrowDownToLine size={18} /></ToolbarButton>
        <ToolbarButton help="duplicate" shortcut="^D" disabled={rootSelection.length === 0} onClick={s.duplicateSelected}><Copy size={18} /></ToolbarButton>
        <ToolbarButton help="delete" shortcut="Del" disabled={!hasSelection} onClick={s.removeSelected}><Trash2 size={18} /></ToolbarButton>
      </div>

      <div className="toolbar__spacer" />

      <div className="toolbar__group">
        <ToolbarButton help="ghost" shortcut="X" active={ghostOps} onClick={toggleGhostOps}><Hash size={18} /></ToolbarButton>
        <ToolbarButton help="bed" extra={`Ora: ${BED_LABELS[bedMode]}. Prossimo: ${BED_LABELS[NEXT_BED[bedMode]]}.`} shortcut="P" active={bedMode !== 'full'} onClick={cycleBed}><Grid3x3 size={18} /></ToolbarButton>
        <ToolbarButton help="theme" extra={theme === 'light' ? 'Ora: tema chiaro.' : 'Ora: tema scuro.'} shortcut="D" onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</ToolbarButton>
        <ToolbarButton help="code" shortcut="C" active={codeOpen} onClick={toggleCode}><Code size={18} /></ToolbarButton>
        <AppMenu />
      </div>
    </header>
  );
}
