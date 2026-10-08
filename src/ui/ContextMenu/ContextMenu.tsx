import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSceneStore } from '../../scene/store';
import { applicableGroups, helpOf, useCommandContext } from '../commands';
import { shortcutText } from '../Toolbar/Toolbar';
import { TOOLBAR_HELP } from '../Toolbar/toolbarHelp';
import { useUiStore } from '../uiStore';
import './ContextMenu.scss';

/** Distanza minima (px) dal bordo della finestra. */
const MARGIN = 8;

/**
 * Menu contestuale della vista 3D (tasto destro su un oggetto): mostra solo i comandi che si possono applicare alla
 * selezione, negli stessi gruppi della barra strumenti. Si chiude con Esc, un clic fuori, la rotellina o un cambio
 * di selezione.
 */
export function ContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const setMenu = useUiStore((s) => s.setContextMenu);
  const selection = useSceneStore((s) => s.selection);
  const ctx = useCommandContext();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Selezione al momento dell'apertura: se cambia, il menu non è più valido (un nuovo clic destro lo riapre da capo)
  const opened = useRef<{ menu: object; selection: string[] } | null>(null);

  useEffect(() => {
    if (!menu) {
      opened.current = null;
      return;
    }
    if (!opened.current || opened.current.menu !== menu) opened.current = { menu, selection };
    else if (opened.current.selection !== selection) setMenu(null);
  }, [menu, selection, setMenu]);

  // Il menu resta dentro la finestra: si misura dopo il rendering, prima che venga disegnato
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    setPos({
      left: Math.max(MARGIN, Math.min(menu.x, window.innerWidth - el.offsetWidth - MARGIN)),
      top: Math.max(MARGIN, Math.min(menu.y, window.innerHeight - el.offsetHeight - MARGIN)),
    });
    // Il fuoco va alla prima voce, così le frecce funzionano subito
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu, setMenu]);

  if (!menu) return null;
  const groups = applicableGroups(ctx);
  if (groups.length === 0) return null;

  /** Frecce su e giù spostano il fuoco tra le voci, con giro continuo. */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Comandi per la selezione"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {groups.map(({ label, commands }, i) => (
        <Fragment key={label}>
          {i > 0 && <div className="context-menu__separator" role="separator" />}
          {commands.map((cmd) => {
            const name = TOOLBAR_HELP[helpOf(cmd, ctx)].name;
            return (
              <button
                key={cmd.id}
                type="button"
                role="menuitem"
                className={`context-menu__item${cmd.active?.(ctx) ? ' context-menu__item--active' : ''}`}
                aria-label={name}
                onClick={() => {
                  // Il menu si chiude prima: i comandi con tendina (Allinea, Specchia) la aprono sulla barra
                  setMenu(null);
                  cmd.run(ctx);
                }}
              >
                <span className="context-menu__icon">{cmd.icon(ctx, 16)}</span>
                <span className="context-menu__name">{name}</span>
                <kbd className="context-menu__shortcut">{shortcutText(cmd.shortcut)}</kbd>
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
