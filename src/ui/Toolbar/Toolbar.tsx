import { Code, Moon, Sun, Redo2, Undo2, FilePlus, Grid3x3, Hash } from 'lucide-react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { useSceneStore } from '../../scene/store';
import { useUiStore } from '../uiStore';
import type { BedMode } from '../uiStore';
import { ToolbarDropdown } from './ToolbarDropdown';
import { ToolTip } from './ToolTip';
import { TOOLBAR_HELP } from './toolbarHelp';
import type { HelpKey } from './toolbarHelp';
import { PlacementMenu } from './PlacementMenu';
import { AppMenu } from '../AppMenu/AppMenu';
import { newProject } from '../fileActions';
import { COMMANDS, COMMAND_GROUPS, helpOf, useCommandContext } from '../commands';
import type { Command, CommandContext } from '../commands';
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

/** Pulsante (o tendina) di un comando del registro: nome, scorciatoia, stato e azione vengono da `COMMANDS`. */
function CommandButton({ cmd, ctx }: { cmd: Command; ctx: CommandContext }) {
  const help = helpOf(cmd, ctx);
  if (cmd.dropdown) {
    return (
      <ToolbarDropdown id={cmd.dropdown} shortcut={cmd.shortcut} help={help} icon={cmd.icon(ctx, 18)} disabled={!cmd.enabled(ctx)}>
        {(close) => <PlacementMenu kind={cmd.dropdown!} close={close} />}
      </ToolbarDropdown>
    );
  }
  return (
    <ToolbarButton help={help} shortcut={cmd.shortcut} active={cmd.active?.(ctx)} disabled={!cmd.enabled(ctx)} onClick={() => cmd.run(ctx)}>
      {cmd.icon(ctx, 18)}
    </ToolbarButton>
  );
}

/** Sezione della barra: i pulsanti con il nome del gruppo sotto, per orientarsi a colpo d'occhio. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="toolbar__section" role="group" aria-label={label}>
      <span className="toolbar__section-label" aria-hidden="true">{label}</span>
      <div className="toolbar__group">{children}</div>
    </div>
  );
}

export function Toolbar() {
  const canUndo = useStore(useSceneStore.temporal, (t) => t.pastStates.length > 0);
  const canRedo = useStore(useSceneStore.temporal, (t) => t.futureStates.length > 0);
  const { codeOpen, toggleCode, theme, toggleTheme, bedMode, cycleBed, ghostOps, toggleGhostOps } = useUiStore();
  const ctx = useCommandContext();

  return (
    <header className="toolbar">
      <div className="toolbar__brand brand-name">Construct</div>

      <Section label="File">
        <ToolbarButton help="new" shortcut="N" onClick={() => void newProject()}><FilePlus size={18} /></ToolbarButton>
        <ToolbarButton help="undo" shortcut="^Z" disabled={!canUndo} onClick={() => useSceneStore.temporal.getState().undo()}><Undo2 size={18} /></ToolbarButton>
        <ToolbarButton help="redo" shortcut="^Y" disabled={!canRedo} onClick={() => useSceneStore.temporal.getState().redo()}><Redo2 size={18} /></ToolbarButton>
      </Section>

      {COMMAND_GROUPS.map(({ label, ids }) => (
        <Fragment key={label}>
          <Divider />
          <Section label={label}>
            {ids.map((id) => (
              <CommandButton key={id} cmd={COMMANDS[id]} ctx={ctx} />
            ))}
          </Section>
        </Fragment>
      ))}

      <div className="toolbar__spacer" />

      <Section label="Vista">
        <ToolbarButton help="ghost" shortcut="X" active={ghostOps} onClick={toggleGhostOps}><Hash size={18} /></ToolbarButton>
        <ToolbarButton help="bed" extra={`Ora: ${BED_LABELS[bedMode]}. Prossimo: ${BED_LABELS[NEXT_BED[bedMode]]}.`} shortcut="P" active={bedMode !== 'full'} onClick={cycleBed}><Grid3x3 size={18} /></ToolbarButton>
        <ToolbarButton help="theme" extra={theme === 'light' ? 'Ora: tema chiaro.' : 'Ora: tema scuro.'} shortcut="D" onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</ToolbarButton>
        <ToolbarButton help="code" shortcut="C" active={codeOpen} onClick={toggleCode}><Code size={18} /></ToolbarButton>
        <AppMenu />
      </Section>
    </header>
  );
}
