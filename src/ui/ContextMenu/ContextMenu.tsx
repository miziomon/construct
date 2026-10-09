import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Box, ChevronRight, FileDown, Grid3x3, House, Layers, Sigma, Smile, Square, Upload } from 'lucide-react';
import { PRIMITIVE_LABELS, SHAPE2D_LABELS } from '../../scene/defaults';
import { isProfileKind, PROFILE_KINDS } from '../../scene/profiles';
import { EMOJI_FONT, EMOJI_GROUPS } from '../../scene/emojiCatalog';
import { fontInfo } from '../../scene/fontCatalog';
import { activePlateId, hasManyPlates, platesOf } from '../../scene/plates';
import { useSceneStore } from '../../scene/store';
import { SYMBOL_GROUPS } from '../../scene/symbolCatalog';
import type { PrimitiveKind, Shape2DKind } from '../../scene/types';
import { applicableGroups, helpOf, useCommandContext } from '../commands';
import { moveSelectionToPlate } from '../Plates/plateActions';
import { PRIMITIVE_ICONS, SHAPE2D_ICONS } from '../ShapeLibrary/ShapeLibrary';
import { previewFamily, registerPreviewFonts } from '../ShapeLibrary/previewFonts';
import { shortcutText } from '../Toolbar/Toolbar';
import { TOOLBAR_HELP } from '../Toolbar/toolbarHelp';
import { useUiStore } from '../uiStore';
import './ContextMenu.scss';

/** Distanza minima (px) dal bordo della finestra. */
const MARGIN = 8;
/** Colonne delle griglie di simboli ed emoji (serve alle frecce su e giù). */
const GLYPH_COLUMNS = 8;

const KINDS_3D = Object.keys(PRIMITIVE_LABELS) as PrimitiveKind[];
// L'SVG nasce dall'importazione di un file, non dal menu; i profilati stanno nel sottomenu delle forme 3D
const KINDS_2D = (Object.keys(SHAPE2D_LABELS) as Shape2DKind[]).filter((kind) => kind !== 'svg' && !isProfileKind(kind));

/** Un carattere di una griglia (simbolo o emoji) con ciò che serve a mostrarlo e ad aggiungerlo. */
interface Glyph {
  char: string;
  /** Nome accessibile e tooltip. */
  label: string;
  font: string;
  /** Nome italiano di un simbolo (diventa il nome dell'oggetto). */
  name?: string;
}

/** Aggiunge un simbolo o un'emoji nel punto dato e lo mette tra i Recenti della libreria. */
function addGlyph(kind: 'symbols' | 'emoji', g: Glyph, at: [number, number]): void {
  useUiStore.getState().pushLibraryRecent(`${kind}:${g.char}`);
  useSceneStore.getState().addText(kind === 'symbols' ? { text: g.char, font: fontInfo(g.font).id, origin: 'symbol', label: g.name, at } : { text: g.char, font: EMOJI_FONT, origin: 'emoji', at });
}

const SYMBOL_ENTRIES = new Map(SYMBOL_GROUPS.flatMap((g) => g.symbols).map((s) => [s.char, { char: s.char, label: s.name, font: s.font, name: s.name } satisfies Glyph]));
const codeOf = (emoji: string) => `U+${emoji.codePointAt(0)!.toString(16).toUpperCase()}`;
const emojiGlyph = (emoji: string): Glyph => ({ char: emoji, label: `Emoji ${codeOf(emoji)}`, font: EMOJI_FONT });

/** Sottomenu a comparsa sulla destra della voce (a sinistra se non c'è spazio), contenuto nello stesso elemento del menu. */
function Flyout({ label, columns, focusFirst, onClose, children }: { label: string; columns: number; focusFirst: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: boolean; shift: number }>({ left: false, shift: 0 });

  // Si misura dopo il rendering: va a sinistra se esce dalla finestra e si alza se esce dal fondo
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPlace({ left: r.right > window.innerWidth - MARGIN, shift: Math.min(0, window.innerHeight - MARGIN - r.bottom) });
    if (focusFirst) el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [focusFirst]);

  /** Frecce dentro il sottomenu: su e giù di una riga, destra e sinistra di una voce; sinistra sulla prima voce lo chiude. */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = ({ ArrowDown: columns, ArrowUp: -columns, ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[e.key];
    if (step === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    // In una lista (una colonna) destra non fa nulla e sinistra chiude; in una griglia sinistra chiude dalla prima voce
    if (e.key === 'ArrowLeft' && (columns === 1 || at <= 0)) return onClose();
    if (e.key === 'ArrowRight' && columns === 1) return;
    items[Math.max(0, Math.min(items.length - 1, at + step))]?.focus();
  };

  return (
    <div ref={ref} className={`context-menu__flyout${place.left ? ' context-menu__flyout--left' : ''}`} role="menu" aria-label={label} style={{ top: place.shift }} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/**
 * Menu contestuale della vista 3D (tasto destro). Su un oggetto mostra solo i comandi che si possono applicare alla
 * selezione, negli stessi gruppi della barra strumenti. Sul vuoto offre le forme (3D, 2D, simboli, emoji) in sottomenu e
 * le voci di servizio. Si chiude con Esc, un clic fuori, la rotellina fuori dal menu o un cambio di selezione.
 */
export function ContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const setMenu = useUiStore((s) => s.setContextMenu);
  const selection = useSceneStore((s) => s.selection);
  const ctx = useCommandContext();
  const favorites = useUiStore((s) => s.libraryFavorites);
  const recent = useUiStore((s) => s.libraryRecent);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Sottomenu aperto, e se si è aperto da tastiera (allora il fuoco passa alla sua prima voce)
  const [sub, setSub] = useState<{ key: string; kbd: boolean } | null>(null);
  // Selezione al momento dell'apertura: se cambia, il menu non è più valido (un nuovo clic destro lo riapre da capo)
  const opened = useRef<{ menu: object; selection: string[] } | null>(null);

  useEffect(() => {
    if (!menu) {
      opened.current = null;
      setSub(null);
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
    // La rotellina dentro il menu (elenchi lunghi dei sottomenu) scorre: non lo chiude
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

  const at = menu?.point;
  // Per i caratteri dei sottomenu servono i font di anteprima, gli stessi delle tab Simboli ed Emoji
  useEffect(() => {
    if (at) void registerPreviewFonts();
  }, [at]);

  if (!menu) return null;
  const groups = at ? [] : applicableGroups(ctx);
  // Spostare nel piatto: solo con più piatti e con oggetti selezionati che si possono spostare
  const otherPlates = !at && hasManyPlates(ctx.scene) && ctx.unlockedRoots.length > 0 ? platesOf(ctx.scene).filter((p) => p.id !== activePlateId(ctx.scene)) : [];
  if (!at && groups.length === 0 && otherPlates.length === 0) return null;

  /** Frecce su e giù spostano il fuoco tra le voci del menu principale, con giro continuo; destra apre un sottomenu. */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    // Solo le voci del livello principale: quelle dei sottomenu stanno dentro un `.context-menu__flyout`
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter((el) => !el.closest('.context-menu__flyout'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  /** Una voce del menu: icona, nome ed eventuale scorciatoia; il menu si chiude prima di eseguire. */
  const item = (key: string, name: string, icon: ReactNode, run: () => void, opts: { shortcut?: string; active?: boolean; nested?: boolean } = {}) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      className={`context-menu__item${opts.active ? ' context-menu__item--active' : ''}`}
      aria-label={name}
      // Passando su una voce del menu principale si chiude il sottomenu aperto (non quelle dentro il sottomenu)
      onMouseEnter={opts.nested ? undefined : () => setSub(null)}
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

  /** Una voce che apre un sottomenu sulla destra (con il mouse, il clic o la freccia destra). */
  const submenu = (key: string, name: string, icon: ReactNode, content: ReactNode, columns = 1) => {
    const open = sub?.key === key;
    return (
      <div key={key} className="context-menu__sub" onMouseEnter={() => setSub((cur) => (cur?.key === key ? cur : { key, kbd: false }))}>
        <button
          type="button"
          role="menuitem"
          className={`context-menu__item${open ? ' context-menu__item--open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          data-sub={key}
          onClick={() => setSub(open ? null : { key, kbd: false })}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setSub({ key, kbd: true });
            }
          }}
        >
          <span className="context-menu__icon">{icon}</span>
          <span className="context-menu__name">{name}</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {open && (
          <Flyout
            label={name}
            columns={columns}
            focusFirst={sub!.kbd}
            onClose={() => {
              setSub(null);
              ref.current?.querySelector<HTMLElement>(`[data-sub="${key}"]`)?.focus();
            }}
          >
            {content}
          </Flyout>
        )}
      </div>
    );
  };

  /** Griglia di simboli o emoji, con Preferiti e Recenti in cima (se ce ne sono) e le categorie sotto. */
  const glyphGrid = (kind: 'symbols' | 'emoji', groupsOf: { title: string; glyphs: Glyph[] }[], lookup: (char: string) => Glyph | undefined, where: [number, number]) => {
    const keys = (list: string[]) => list.filter((k) => k.startsWith(`${kind}:`)).map((k) => lookup(k.slice(kind.length + 1))).filter((g): g is Glyph => !!g);
    const sections = [
      { title: 'Preferiti', glyphs: keys(favorites) },
      { title: 'Recenti', glyphs: keys(recent) },
      ...groupsOf,
    ].filter((s) => s.glyphs.length > 0);
    return sections.map((s) => (
      <Fragment key={s.title}>
        <div className="context-menu__heading">{s.title}</div>
        <div className="context-menu__glyphs" style={{ gridTemplateColumns: `repeat(${GLYPH_COLUMNS}, 1fr)` }}>
          {s.glyphs.map((g) => (
            <button key={`${s.title}-${g.char}`} type="button" role="menuitem" className="context-menu__glyph" title={g.label} aria-label={g.label} onClick={() => { setMenu(null); addGlyph(kind, g, where); }}>
              <span style={{ fontFamily: `${previewFamily(g.font)}, sans-serif` }} aria-hidden="true">{g.char}</span>
            </button>
          ))}
        </div>
      </Fragment>
    ));
  };

  const st = useSceneStore.getState;
  const ui = useUiStore.getState;

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={at ? 'Aggiungi una forma' : 'Comandi per la selezione'}
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {at ? (
        <>
          {submenu('3d', 'Forme 3D', <Box size={16} />, [
            ...KINDS_3D.map((kind) => {
              const Icon = PRIMITIVE_ICONS[kind];
              return item(kind, PRIMITIVE_LABELS[kind], <Icon size={16} />, () => st().addPrimitive(kind, at), { nested: true });
            }),
            // Profilati: sezioni estruse, ma si usano come solidi
            ...PROFILE_KINDS.map((kind) => {
              const Icon = SHAPE2D_ICONS[kind];
              return item(kind, SHAPE2D_LABELS[kind], <Icon size={16} />, () => st().addShape2D(kind, at), { nested: true });
            }),
          ])}
          {submenu('2d', 'Forme 2D', <Square size={16} />, KINDS_2D.map((kind) => {
            const Icon = SHAPE2D_ICONS[kind];
            return item(`2d-${kind}`, SHAPE2D_LABELS[kind], <Icon size={16} />, () => st().addShape2D(kind, at), { nested: true });
          }))}
          {submenu(
            'symbols',
            'Simboli',
            <Sigma size={16} />,
            glyphGrid('symbols', SYMBOL_GROUPS.map((g) => ({ title: g.title, glyphs: g.symbols.map((s) => SYMBOL_ENTRIES.get(s.char)!) })), (c) => SYMBOL_ENTRIES.get(c), at),
            GLYPH_COLUMNS,
          )}
          {submenu(
            'emoji',
            'Emoji',
            <Smile size={16} />,
            glyphGrid('emoji', EMOJI_GROUPS.map((g) => ({ title: g.title, glyphs: g.emoji.map(emojiGlyph) })), (c) => emojiGlyph(c), at),
            GLYPH_COLUMNS,
          )}
          <div className="context-menu__separator" role="separator" />
          {item('import', 'Importa…', <Upload size={16} />, () => ui().setAppPanel('import'))}
          {item('export', 'Esporta…', <FileDown size={16} />, () => ui().setAppPanel('export'))}
          {item('bed', 'Dimensioni del piano…', <Grid3x3 size={16} />, () => ui().setBedDialogOpen(true))}
          {item('welcome', 'Schermata di benvenuto', <House size={16} />, () => ui().setWelcomeOpen(true))}
        </>
      ) : (
        <>
          {groups.map(({ label, commands }, i) => (
            <Fragment key={label}>
              {i > 0 && <div className="context-menu__separator" role="separator" />}
              {commands.map((cmd) =>
                item(cmd.id, TOOLBAR_HELP[helpOf(cmd, ctx)].name, cmd.icon(ctx, 16), () => cmd.run(ctx), { shortcut: shortcutText(cmd.shortcut), active: cmd.active?.(ctx) }),
              )}
            </Fragment>
          ))}
          {otherPlates.length > 0 && (
            <>
              {groups.length > 0 && <div className="context-menu__separator" role="separator" />}
              {submenu('plates', 'Sposta nel piatto', <Layers size={16} />, otherPlates.map((p) => item(`plate-${p.id}`, p.name, <Layers size={16} />, () => moveSelectionToPlate(p.id), { nested: true })))}
            </>
          )}
        </>
      )}
    </div>
  );
}
