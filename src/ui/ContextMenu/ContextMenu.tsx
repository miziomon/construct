import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { PRIMITIVE_LABELS, SHAPE2D_LABELS } from '../../scene/defaults';
import { useSceneStore } from '../../scene/store';
import type { PrimitiveKind, Shape2DKind } from '../../scene/types';
import { applicableGroups, helpOf, useCommandContext } from '../commands';
import { PRIMITIVE_ICONS, SHAPE2D_ICONS } from '../ShapeLibrary/ShapeLibrary';
import { shortcutText } from '../Toolbar/Toolbar';
import { TOOLBAR_HELP } from '../Toolbar/toolbarHelp';
import { useUiStore } from '../uiStore';
import './ContextMenu.scss';

/** Distanza minima (px) dal bordo della finestra. */
const MARGIN = 8;

const KINDS_3D = Object.keys(PRIMITIVE_LABELS) as PrimitiveKind[];
// L'SVG nasce dall'importazione di un file, non dal menu
const KINDS_2D = (Object.keys(SHAPE2D_LABELS) as Shape2DKind[]).filter((kind) => kind !== 'svg');

/**
 * Menu contestuale della vista 3D (tasto destro). Su un oggetto mostra solo i comandi che si possono applicare alla
 * selezione, negli stessi gruppi della barra strumenti. Sul vuoto propone di aggiungere una forma nel punto cliccato.
 * Si chiude con Esc, un clic fuori, la rotellina o un cambio di selezione.
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
    // La rotellina dentro il menu (elenco delle forme) scorre la lista: non lo chiude
    const onWheel = (e: WheelEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu, setMenu]);

  if (!menu) return null;
  const groups = menu.point ? [] : applicableGroups(ctx);
  if (!menu.point && groups.length === 0) return null;

  /** Frecce su e giù spostano il fuoco tra le voci, con giro continuo. */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  /** Una voce del menu: icona, nome ed eventuale scorciatoia; il menu si chiude prima di eseguire. */
  const item = (key: string, name: string, icon: ReactNode, run: () => void, opts: { shortcut?: string; active?: boolean } = {}) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      className={`context-menu__item${opts.active ? ' context-menu__item--active' : ''}`}
      aria-label={name}
      onClick={() => {
        setMenu(null);
        run();
      }}
    >
      <span className="context-menu__icon">{icon}</span>
      <span className="context-menu__name">{name}</span>
      {opts.shortcut && <kbd className="context-menu__shortcut">{opts.shortcut}</kbd>}
    </button>
  );

  const at = menu.point;
  const st = useSceneStore.getState();

  return (
    <div
      ref={ref}
      className={`context-menu${at ? ' context-menu--add' : ''}`}
      role="menu"
      aria-label={at ? 'Aggiungi una forma' : 'Comandi per la selezione'}
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {at ? (
        <>
          <div className="context-menu__heading">Forme 3D</div>
          {KINDS_3D.map((kind) => {
            const Icon = PRIMITIVE_ICONS[kind];
            return item(kind, PRIMITIVE_LABELS[kind], <Icon size={16} />, () => st.addPrimitive(kind, at));
          })}
          <div className="context-menu__separator" role="separator" />
          <div className="context-menu__heading">Forme 2D (estruse)</div>
          {KINDS_2D.map((kind) => {
            const Icon = SHAPE2D_ICONS[kind];
            return item(`2d-${kind}`, SHAPE2D_LABELS[kind], <Icon size={16} />, () => st.addShape2D(kind, at));
          })}
        </>
      ) : (
        groups.map(({ label, commands }, i) => (
          <Fragment key={label}>
            {i > 0 && <div className="context-menu__separator" role="separator" />}
            {commands.map((cmd) =>
              item(cmd.id, TOOLBAR_HELP[helpOf(cmd, ctx)].name, cmd.icon(ctx, 16), () => cmd.run(ctx), { shortcut: shortcutText(cmd.shortcut), active: cmd.active?.(ctx) }),
            )}
          </Fragment>
        ))
      )}
    </div>
  );
}
