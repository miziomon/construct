import { SquareArrowDown, AlignHorizontalJustifyStart, ArrowDownToLine, FlipHorizontal2, Ruler, Code, Copy, Lock, Unlock, Group, MousePointer2, Move3d, Redo2, Rotate3d, SquaresUnite, Grid3x3, Moon, Sun, Scaling, ArrowUpFromLine, Trash2, Ungroup, Undo2, CircleDashed, FilePlus, Hash } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { isLocked, useSceneStore } from '../../scene/store';
import { useUiStore } from '../uiStore';
import type { BedMode } from '../uiStore';
import { combineToBed, dropSelectionToBed } from '../../kernel/placement';
import { ToolbarDropdown } from './ToolbarDropdown';
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
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  label?: string;
  /** Scorciatoia da tastiera, mostrata in piccolo sopra l'icona. */
  shortcut?: string;
}

/** Pulsante a icona con etichetta opzionale; "title" è anche il testo accessibile. */
function ToolbarButton({ title, onClick, children, active, disabled, label, shortcut }: ButtonProps) {
  const cls = ['toolbar__button', active && 'toolbar__button--active', label && 'toolbar__button--labeled'].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} title={title} aria-label={title} aria-pressed={active} disabled={disabled} onClick={onClick}>
      {shortcut && <span className="toolbar__shortcut" aria-hidden="true">{shortcut}</span>}
      {children}
      {label && <span className="toolbar__button-label">{label}</span>}
    </button>
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
        <ToolbarButton title="Nuovo progetto: svuota la scena (N)" shortcut="N" onClick={() => void newProject()}><FilePlus size={18} /></ToolbarButton>
      </div>
      <Divider />

      <div className="toolbar__group">
        <ToolbarButton title="Annulla (Ctrl+Z)" shortcut="^Z" disabled={!canUndo} onClick={() => useSceneStore.temporal.getState().undo()}><Undo2 size={18} /></ToolbarButton>
        <ToolbarButton title="Ripeti (Ctrl+Y o Ctrl+Maiusc+Z)" shortcut="^Y" disabled={!canRedo} onClick={() => useSceneStore.temporal.getState().redo()}><Redo2 size={18} /></ToolbarButton>
      </div>
      <Divider />

      <div className="toolbar__group">
        <ToolbarButton title="Seleziona (Q)" shortcut="Q" active={s.gizmoMode === 'select'} onClick={() => s.setGizmoMode('select')}><MousePointer2 size={18} /></ToolbarButton>
        <ToolbarButton title="Sposta (W)" shortcut="W" active={s.gizmoMode === 'translate'} onClick={() => s.setGizmoMode('translate')}><Move3d size={18} /></ToolbarButton>
        <ToolbarButton title="Ruota (E)" shortcut="E" active={s.gizmoMode === 'rotate'} onClick={() => s.setGizmoMode('rotate')}><Rotate3d size={18} /></ToolbarButton>
        <ToolbarButton title="Ridimensiona con il mouse (R)" shortcut="R" active={s.gizmoMode === 'resize'} onClick={() => s.setGizmoMode('resize')}><Scaling size={18} /></ToolbarButton>
        <ToolbarButton title="Estrudi forme 2D con il mouse (T)" shortcut="T" active={s.gizmoMode === 'extrude'} onClick={() => s.setGizmoMode('extrude')}><ArrowUpFromLine size={18} /></ToolbarButton>
      </div>
      <Divider />

      <div className="toolbar__group">
        <ToolbarButton title="Raggruppa: gli oggetti restano separati e si muovono insieme (Ctrl+G)" shortcut="^G" disabled={rootSelection.length < 2} onClick={() => combineToBed('group')}><Group size={18} /></ToolbarButton>
        <ToolbarButton title="Unisci in un solo solido, unione booleana (U)" shortcut="U" disabled={rootSelection.length < 2} onClick={() => combineToBed('union')}><SquaresUnite size={18} /></ToolbarButton>
        <ToolbarButton title="Inviluppo convesso: la forma più piccola e senza concavità che contiene gli oggetti (J)" shortcut="J" disabled={rootSelection.length < 2} onClick={() => combineToBed('hull')}><GROUP_ICONS.hull size={18} /></ToolbarButton>
        <ToolbarButton title="Separa il gruppo o l'unione (Ctrl+Maiusc+G)" shortcut="⇧^G" disabled={group?.type !== 'group' || !s.scene.rootIds.includes(group.id)} onClick={s.ungroupSelected}><Ungroup size={18} /></ToolbarButton>
        <ToolbarButton title="Solido / Foro (H)" shortcut="H" active={allHoles} disabled={!hasSelection} onClick={s.toggleHoleSelected}><CircleDashed size={18} /></ToolbarButton>
        <ToolbarButton title={allLocked ? 'Sblocca (L)' : 'Blocca (L)'} shortcut="L" active={allLocked} disabled={!hasSelection} onClick={s.toggleLockSelected}>{allLocked ? <Lock size={18} /> : <Unlock size={18} />}</ToolbarButton>
        <ToolbarButton title="Raccordo: arrotonda lo spigolo tra due superfici (F)" shortcut="F" active={edgeTool === 'fillet'} disabled={!hasObjects} onClick={() => toggleEdgeTool('fillet')}><EDGE_ICONS.fillet size={18} /></ToolbarButton>
        <ToolbarButton title="Smusso: taglia lo spigolo tra due superfici (S)" shortcut="S" active={edgeTool === 'chamfer'} disabled={!hasObjects} onClick={() => toggleEdgeTool('chamfer')}><EDGE_ICONS.chamfer size={18} /></ToolbarButton>
        <ToolbarButton title="Smusso angolare: taglia o arrotonda un angolo scegliendo il vertice (A)" shortcut="A" active={edgeTool === 'corner'} disabled={!hasObjects} onClick={() => toggleEdgeTool('corner')}><CORNER_ICONS.chamfer size={18} /></ToolbarButton>
        <ToolbarButton title="Guscio: svuota il solido selezionato con spessore laterale e inferiore (G)" shortcut="G" active={shellActive} disabled={!shellActive && !canShell(s.scene, s.selection)} onClick={toggleShell}><GROUP_ICONS.shell size={18} /></ToolbarButton>
        <ToolbarDropdown id="align" shortcut="K" title="Allinea: sceglie asse e lato su cui allineare gli oggetti selezionati (K)" icon={<AlignHorizontalJustifyStart size={18} />} disabled={unlockedRoots.length < 2}>
          {(close) => <PlacementMenu kind="align" close={close} />}
        </ToolbarDropdown>
        <ToolbarDropdown id="mirror" shortcut="Y" title="Specchia: sceglie l'asse e il lato dell'ingombro da cui passa il piano di specchio (Y)" icon={<FlipHorizontal2 size={18} />} disabled={unlockedRoots.length < 1}>
          {(close) => <PlacementMenu kind="mirror" close={close} />}
        </ToolbarDropdown>
        <ToolbarButton title="Misura: scegli un punto di partenza e uno di arrivo per leggere la distanza in mm, con aggancio a vertici e spigoli (I)" shortcut="I" active={measureActive} disabled={!hasObjects} onClick={toggleMeasure}><Ruler size={18} /></ToolbarButton>
        <ToolbarButton title="Serie: ripete l'oggetto selezionato in fila, in griglia o in cerchio; il risultato è un gruppo Ripetizione di cui si modificano i parametri (O)" shortcut="O" active={arrayActive} disabled={!arrayActive && !canArray(s.scene, s.selection)} onClick={toggleArray}><GROUP_ICONS.array size={18} /></ToolbarButton>
        <ToolbarButton title="Pattern: fora l'oggetto selezionato con un disegno Voronoi casuale, esagoni o cerchi, oppure lo trasforma in un reticolo 3D; il risultato è un gruppo Pattern di cui si modificano seme e parametri (Z)" shortcut="Z" active={patternActive} disabled={!patternActive && !canPattern(s.scene, s.selection)} onClick={togglePattern}><GROUP_ICONS.pattern size={18} /></ToolbarButton>
        <ToolbarButton title="Appoggia su una faccia: clicca la faccia che deve poggiare sul piatto e l'oggetto si ruota e si appoggia (V)" shortcut="V" active={layFlatActive} disabled={!hasObjects} onClick={toggleLayFlat}><SquareArrowDown size={18} /></ToolbarButton>
        <ToolbarButton title="Appoggia sul piatto (B)" shortcut="B" disabled={rootSelection.length === 0} onClick={dropSelectionToBed}><ArrowDownToLine size={18} /></ToolbarButton>
        <ToolbarButton title="Duplica (Ctrl+D)" shortcut="^D" disabled={rootSelection.length === 0} onClick={s.duplicateSelected}><Copy size={18} /></ToolbarButton>
        <ToolbarButton title="Elimina (Canc o Backspace)" shortcut="Del" disabled={!hasSelection} onClick={s.removeSelected}><Trash2 size={18} /></ToolbarButton>
      </div>

      <div className="toolbar__spacer" />

      <div className="toolbar__group">
        <ToolbarButton title="Operandi delle booleane in trasparenza, come # di OpenSCAD: mostra ciò che viene sottratto o intersecato (X)" shortcut="X" active={ghostOps} onClick={toggleGhostOps}><Hash size={18} /></ToolbarButton>
        <ToolbarButton title={`Piatto: ${BED_LABELS[bedMode]}, prossimo: ${BED_LABELS[NEXT_BED[bedMode]]} (P)`} shortcut="P" active={bedMode !== 'full'} onClick={cycleBed}><Grid3x3 size={18} /></ToolbarButton>
        <ToolbarButton title={theme === 'light' ? 'Passa al tema scuro (D)' : 'Passa al tema chiaro (D)'} shortcut="D" onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</ToolbarButton>
        <ToolbarButton title="Codice OpenSCAD (C o Ctrl+J)" shortcut="C" active={codeOpen} onClick={toggleCode}><Code size={18} /></ToolbarButton>
        <AppMenu />
      </div>
    </header>
  );
}
