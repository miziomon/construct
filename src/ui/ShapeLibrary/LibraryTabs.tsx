import { Suspense } from 'react';
import type { KeyboardEvent } from 'react';
import { LIBRARY_TABS, useUiStore } from '../uiStore';
import { lazyLoad } from '../lazyLoad';
import type { LibraryTab } from '../uiStore';
import { Shapes2DGrid, Shapes3DGrid } from './ShapeLibrary';
import './ShapeLibrary.scss';

// L'elenco dei simboli (con il font per le anteprime) si scarica solo quando si apre la tab
const SymbolsPanel = lazyLoad(() => import('./SymbolsPanel'));
const EmojiPanel = lazyLoad(() => import('./EmojiPanel'));

const TAB_LABELS: Record<LibraryTab, string> = { shapes3d: 'Forme 3D', shapes2d: 'Forme 2D', symbols: 'Simboli', emoji: 'Emoji' };

/**
 * Libreria della barra laterale sinistra a tab: forme 3D, forme 2D estrudibili e simboli Unicode.
 * La tab scelta si ricorda (localStorage); le frecce sinistra e destra passano da una tab all'altra.
 */
export function LibraryTabs() {
  const tab = useUiStore((s) => s.libraryTab);
  const setTab = useUiStore((s) => s.setLibraryTab);

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = LIBRARY_TABS[(LIBRARY_TABS.indexOf(tab) + step + LIBRARY_TABS.length) % LIBRARY_TABS.length];
    setTab(next);
    // Il focus segue la tab attiva (schema ARIA delle tab con una sola tab nell'ordine di Tab)
    document.getElementById(`library-tab-${next}`)?.focus();
  };

  return (
    <section className="shape-library" aria-label="Libreria">
      <div className="shape-library__tabs" role="tablist" aria-label="Libreria" onKeyDown={onKeyDown}>
        {LIBRARY_TABS.map((t) => (
          <button
            key={t}
            id={`library-tab-${t}`}
            type="button"
            role="tab"
            className={`shape-library__tab${t === tab ? ' shape-library__tab--active' : ''}`}
            aria-selected={t === tab}
            aria-controls="library-panel"
            tabIndex={t === tab ? 0 : -1}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div id="library-panel" className="shape-library__panel" role="tabpanel" aria-labelledby={`library-tab-${tab}`}>
        {tab === 'shapes3d' && <Shapes3DGrid />}
        {tab === 'shapes2d' && <Shapes2DGrid />}
        {(tab === 'symbols' || tab === 'emoji') && (
          <Suspense fallback={<p className="shape-library__loading">Caricamento…</p>}>
            {tab === 'symbols' ? <SymbolsPanel /> : <EmojiPanel />}
          </Suspense>
        )}
      </div>
    </section>
  );
}
