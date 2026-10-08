import { SquareArrowDown, AlignHorizontalJustifyStart, ArrowDownToLine, FlipHorizontal2, Ruler, Copy, Lock, Unlock, Group, MousePointer2, Move3d, Rotate3d, SquaresUnite, Scaling, ArrowUpFromLine, Trash2, Ungroup, CircleDashed } from 'lucide-react';
import type { ReactNode } from 'react';
import { combineToBed, dropSelectionToBed, lowestZByRoot } from '../kernel/placement';
import { isLocked, useSceneStore } from '../scene/store';
import type { GizmoMode } from '../scene/store';
import { isCutter } from '../scene/treatment';
import type { Scene, SceneNode } from '../scene/types';
import { canArray, useArrayTool } from './Array/arrayToolStore';
import { toggleArray } from './Array/toggleArray';
import { useEdgeTool } from './EdgeTool/edgeToolStore';
import { toggleLayFlat } from './LayFlat/toggleLayFlat';
import { useLayFlat } from './LayFlat/layFlatStore';
import { toggleMeasure } from './Measure/toggleMeasure';
import { useMeasure } from './Measure/measureStore';
import { canPattern, usePatternTool } from './Pattern/patternToolStore';
import { togglePattern } from './Pattern/togglePattern';
import { canShell, toggleShell, useShellTool } from './Shell/shellToolStore';
import type { HelpKey } from './Toolbar/toolbarHelp';
import { CORNER_ICONS, EDGE_ICONS, GROUP_ICONS } from './groupIcons';
import { useUiStore } from './uiStore';
import type { ToolbarMenu } from './uiStore';

/**
 * Comandi che agiscono sulla selezione, definiti una volta sola: la barra strumenti li mostra (abilitati o no) e il menu
 * contestuale mostra soltanto quelli applicabili. Le scorciatoie da tastiera restano in useShortcuts.
 */
export type CommandId =
  | 'select' | 'translate' | 'rotate' | 'resize' | 'extrude'
  | 'group' | 'ungroup' | 'union' | 'hull' | 'hole'
  | 'fillet' | 'chamfer' | 'corner' | 'shell' | 'pattern'
  | 'align' | 'mirror' | 'layflat' | 'drop' | 'array'
  | 'duplicate' | 'lock' | 'delete' | 'measure';

/** Stato da cui dipende la disponibilità dei comandi: selezione, scena e strumenti aperti. */
export interface CommandContext {
  scene: Scene;
  selection: string[];
  gizmoMode: GizmoMode;
  hasSelection: boolean;
  hasObjects: boolean;
  /** Oggetti selezionati che stanno alla radice. */
  rootSelection: string[];
  /** Come `rootSelection`, senza gli oggetti bloccati: Allinea e Specchia agiscono solo su questi. */
  unlockedRoots: string[];
  /** Il nodo selezionato, se la selezione è uno solo. */
  single: SceneNode | undefined;
  allLocked: boolean;
  allHoles: boolean;
  edgeTool: 'fillet' | 'chamfer' | 'corner' | null;
  shellActive: boolean;
  measureActive: boolean;
  layFlatActive: boolean;
  arrayActive: boolean;
  patternActive: boolean;
}

interface ContextInput {
  scene: Scene;
  selection: string[];
  gizmoMode: GizmoMode;
  edgeTool: CommandContext['edgeTool'];
  shellActive: boolean;
  measureActive: boolean;
  layFlatActive: boolean;
  arrayActive: boolean;
  patternActive: boolean;
}

/** Calcola il contesto dei comandi da scena, selezione e strumenti aperti (funzione pura). */
export function makeContext(i: ContextInput): CommandContext {
  const { scene, selection } = i;
  const hasSelection = selection.length > 0;
  const rootSelection = selection.filter((id) => scene.rootIds.includes(id));
  return {
    ...i,
    hasSelection,
    hasObjects: scene.rootIds.length > 0,
    rootSelection,
    unlockedRoots: rootSelection.filter((id) => !isLocked(scene, id)),
    single: selection.length === 1 ? scene.nodes[selection[0]] : undefined,
    allLocked: hasSelection && selection.every((id) => scene.nodes[id]?.locked),
    allHoles: hasSelection && selection.every((id) => scene.nodes[id]?.mode === 'hole'),
  };
}

/** Contesto per i componenti: si aggiorna a ogni cambio di scena, selezione o strumento. */
export function useCommandContext(): CommandContext {
  const scene = useSceneStore((s) => s.scene);
  const selection = useSceneStore((s) => s.selection);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);
  const edgeTool = useEdgeTool((s) => s.tool);
  const shellActive = useShellTool((s) => s.active);
  const measureActive = useMeasure((s) => s.active);
  const layFlatActive = useLayFlat((s) => s.active);
  const arrayActive = useArrayTool((s) => s.active);
  const patternActive = usePatternTool((s) => s.active);
  return makeContext({ scene, selection, gizmoMode, edgeTool, shellActive, measureActive, layFlatActive, arrayActive, patternActive });
}

/** Contesto di questo istante, fuori da React (per il menu contestuale e per i test). */
export function getCommandContext(): CommandContext {
  const { scene, selection, gizmoMode } = useSceneStore.getState();
  return makeContext({
    scene,
    selection,
    gizmoMode,
    edgeTool: useEdgeTool.getState().tool,
    shellActive: useShellTool.getState().active,
    measureActive: useMeasure.getState().active,
    layFlatActive: useLayFlat.getState().active,
    arrayActive: useArrayTool.getState().active,
    patternActive: usePatternTool.getState().active,
  });
}

export interface Command {
  id: CommandId;
  /** Voce di aiuto: nome accessibile e tooltip; cambia con lo stato per Blocca e Sblocca. */
  help: HelpKey | ((c: CommandContext) => HelpKey);
  /** Scorciatoia come sulla barra ("^G" = Ctrl+G, "⇧" = Maiusc). */
  shortcut: string;
  icon: (c: CommandContext, size: number) => ReactNode;
  enabled: (c: CommandContext) => boolean;
  active?: (c: CommandContext) => boolean;
  run: (c: CommandContext) => void;
  /** Tendina della barra aperta dal comando (Allinea e Specchia), al posto di un'azione diretta. */
  dropdown?: ToolbarMenu;
  /** Il menu contestuale lo mostra. Le modalità del gizmo restano solo sulla barra. */
  menu: boolean;
  /** Condizione in più per il menu (la barra usa solo `enabled`): nasconde i comandi che per questo oggetto non hanno senso. */
  inMenu?: (c: CommandContext) => boolean;
}

/** Un solo strumento di bordo alla volta: il Guscio aperto si annulla, un secondo clic sullo stesso pulsante chiude. */
const toggleEdgeTool = (kind: 'fillet' | 'chamfer' | 'corner', c: CommandContext) => {
  useShellTool.getState().cancel();
  return c.edgeTool === kind ? useEdgeTool.getState().cancel() : useEdgeTool.getState().start(kind);
};

/** Un solo oggetto selezionato, non un raccordo o uno smusso: su di lui hanno senso gli strumenti che lavorano sulle facce. */
const singleSolid = (c: CommandContext): boolean => c.selection.length === 1 && !!c.single && !isCutter(c.single);

/** Ha facce piane su cui lavorare (raccordi, smussi, appoggio): sfere e tori no. */
const hasFlatFaces = (c: CommandContext): boolean => singleSolid(c) && !(c.single?.type === 'primitive' && (c.single.kind === 'sphere' || c.single.kind === 'torus'));

/** Qualche oggetto selezionato non poggia sul piatto (il suo punto più basso non è a Z = 0). */
const someOffBed = (c: CommandContext): boolean => {
  const lowest = lowestZByRoot();
  return c.rootSelection.some((id) => lowest[id] !== undefined && Math.abs(lowest[id]) > 0.001);
};

/** Comandi che restano per una selezione tutta bloccata: tutto il resto la modificherebbe. */
const ALLOWED_WHEN_LOCKED: CommandId[] = ['lock', 'duplicate', 'measure'];

const gizmo = (id: GizmoMode & CommandId, help: HelpKey, shortcut: string, Icon: typeof MousePointer2): Command => ({
  id,
  help,
  shortcut,
  icon: (_c, size) => <Icon size={size} />,
  enabled: () => true,
  active: (c) => c.gizmoMode === id,
  run: () => useSceneStore.getState().setGizmoMode(id),
  menu: false,
});

const sceneState = () => useSceneStore.getState();

export const COMMANDS: Record<CommandId, Command> = {
  select: gizmo('select', 'select', 'Q', MousePointer2),
  translate: gizmo('translate', 'translate', 'W', Move3d),
  rotate: gizmo('rotate', 'rotate', 'E', Rotate3d),
  resize: gizmo('resize', 'resize', 'R', Scaling),
  extrude: gizmo('extrude', 'extrude', 'T', ArrowUpFromLine),

  group: { id: 'group', help: 'group', shortcut: '^G', icon: (_c, size) => <Group size={size} />, enabled: (c) => c.rootSelection.length >= 2, run: () => combineToBed('group'), menu: true },
  ungroup: {
    id: 'ungroup', help: 'ungroup', shortcut: '⇧^G', icon: (_c, size) => <Ungroup size={size} />,
    enabled: (c) => c.single?.type === 'group' && c.scene.rootIds.includes(c.single.id), run: () => sceneState().ungroupSelected(), menu: true,
  },
  union: { id: 'union', help: 'union', shortcut: 'U', icon: (_c, size) => <SquaresUnite size={size} />, enabled: (c) => c.rootSelection.length >= 2, run: () => combineToBed('union'), menu: true },
  hull: { id: 'hull', help: 'hull', shortcut: 'J', icon: (_c, size) => <GROUP_ICONS.hull size={size} />, enabled: (c) => c.rootSelection.length >= 2, run: () => combineToBed('hull'), menu: true },
  hole: {
    id: 'hole', help: 'hole', shortcut: 'H', icon: (_c, size) => <CircleDashed size={size} />,
    enabled: (c) => c.hasSelection, active: (c) => c.allHoles, run: () => sceneState().toggleHoleSelected(), menu: true,
    // Un raccordo o uno smusso è già un taglio: solido o foro non ha senso
    inMenu: (c) => c.selection.every((id) => !isCutter(c.scene.nodes[id])),
  },

  fillet: { id: 'fillet', help: 'fillet', shortcut: 'F', icon: (_c, size) => <EDGE_ICONS.fillet size={size} />, enabled: (c) => c.hasObjects, active: (c) => c.edgeTool === 'fillet', run: (c) => toggleEdgeTool('fillet', c), menu: true, inMenu: hasFlatFaces },
  chamfer: { id: 'chamfer', help: 'chamfer', shortcut: 'S', icon: (_c, size) => <EDGE_ICONS.chamfer size={size} />, enabled: (c) => c.hasObjects, active: (c) => c.edgeTool === 'chamfer', run: (c) => toggleEdgeTool('chamfer', c), menu: true, inMenu: hasFlatFaces },
  corner: { id: 'corner', help: 'corner', shortcut: 'A', icon: (_c, size) => <CORNER_ICONS.chamfer size={size} />, enabled: (c) => c.hasObjects, active: (c) => c.edgeTool === 'corner', run: (c) => toggleEdgeTool('corner', c), menu: true, inMenu: hasFlatFaces },
  shell: {
    id: 'shell', help: 'shell', shortcut: 'G', icon: (_c, size) => <GROUP_ICONS.shell size={size} />,
    enabled: (c) => c.shellActive || canShell(c.scene, c.selection), active: (c) => c.shellActive, run: () => toggleShell(), menu: true,
  },
  pattern: {
    id: 'pattern', help: 'pattern', shortcut: 'Z', icon: (_c, size) => <GROUP_ICONS.pattern size={size} />,
    enabled: (c) => c.patternActive || canPattern(c.scene, c.selection), active: (c) => c.patternActive, run: () => togglePattern(), menu: true,
  },

  align: {
    id: 'align', help: 'align', shortcut: 'K', icon: (_c, size) => <AlignHorizontalJustifyStart size={size} />,
    enabled: (c) => c.unlockedRoots.length >= 2, run: () => useUiStore.getState().setToolbarMenu('align'), dropdown: 'align', menu: true,
  },
  mirror: {
    id: 'mirror', help: 'mirror', shortcut: 'Y', icon: (_c, size) => <FlipHorizontal2 size={size} />,
    enabled: (c) => c.unlockedRoots.length >= 1, run: () => useUiStore.getState().setToolbarMenu('mirror'), dropdown: 'mirror', menu: true,
  },
  layflat: { id: 'layflat', help: 'layflat', shortcut: 'V', icon: (_c, size) => <SquareArrowDown size={size} />, enabled: (c) => c.hasObjects, active: (c) => c.layFlatActive, run: () => toggleLayFlat(), menu: true, inMenu: hasFlatFaces },
  drop: { id: 'drop', help: 'drop', shortcut: 'B', icon: (_c, size) => <ArrowDownToLine size={size} />, enabled: (c) => c.rootSelection.length > 0, run: () => dropSelectionToBed(), menu: true, inMenu: someOffBed },
  array: {
    id: 'array', help: 'array', shortcut: 'O', icon: (_c, size) => <GROUP_ICONS.array size={size} />,
    enabled: (c) => c.arrayActive || canArray(c.scene, c.selection), active: (c) => c.arrayActive, run: () => toggleArray(), menu: true,
  },

  duplicate: { id: 'duplicate', help: 'duplicate', shortcut: '^D', icon: (_c, size) => <Copy size={size} />, enabled: (c) => c.rootSelection.length > 0, run: () => sceneState().duplicateSelected(), menu: true },
  lock: {
    id: 'lock', help: (c) => (c.allLocked ? 'unlock' : 'lock'), shortcut: 'L', icon: (c, size) => (c.allLocked ? <Lock size={size} /> : <Unlock size={size} />),
    enabled: (c) => c.hasSelection, active: (c) => c.allLocked, run: () => sceneState().toggleLockSelected(), menu: true,
  },
  delete: { id: 'delete', help: 'delete', shortcut: 'Del', icon: (_c, size) => <Trash2 size={size} />, enabled: (c) => c.hasSelection, run: () => sceneState().removeSelected(), menu: true },
  measure: { id: 'measure', help: 'measure', shortcut: 'I', icon: (_c, size) => <Ruler size={size} />, enabled: (c) => c.hasObjects, active: (c) => c.measureActive, run: () => toggleMeasure(), menu: true },
};

/** Gruppi della barra strumenti e del menu contestuale, nell'ordine in cui compaiono. */
export const COMMAND_GROUPS: { label: string; ids: CommandId[] }[] = [
  { label: 'Trasforma', ids: ['select', 'translate', 'rotate', 'resize', 'extrude'] },
  { label: 'Combina', ids: ['group', 'ungroup', 'union', 'hull', 'hole'] },
  { label: 'Modifica', ids: ['fillet', 'chamfer', 'corner', 'shell', 'pattern'] },
  { label: 'Disponi', ids: ['align', 'mirror', 'layflat', 'drop', 'array'] },
  { label: 'Oggetto', ids: ['duplicate', 'lock', 'delete', 'measure'] },
];

export const helpOf = (cmd: Command, c: CommandContext): HelpKey => (typeof cmd.help === 'function' ? cmd.help(c) : cmd.help);

/** Comandi del menu contestuale: per gruppo, solo quelli che si possono applicare adesso (i gruppi vuoti spariscono). */
export function applicableGroups(c: CommandContext): { label: string; commands: Command[] }[] {
  const shown = (cmd: Command) => cmd.menu && cmd.enabled(c) && (cmd.inMenu?.(c) ?? true) && (!c.allLocked || ALLOWED_WHEN_LOCKED.includes(cmd.id));
  return COMMAND_GROUPS.map(({ label, ids }) => ({ label, commands: ids.map((id) => COMMANDS[id]).filter(shown) })).filter((g) => g.commands.length > 0);
}
