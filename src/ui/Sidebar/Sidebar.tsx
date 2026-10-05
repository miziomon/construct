import { Suspense, lazy } from 'react';
import { PropertiesPanel } from '../PropertiesPanel/PropertiesPanel';
import { useUiStore } from '../uiStore';
import './Sidebar.scss';

// Il pannello codice (e il generatore OpenSCAD) si scarica solo quando serve
const CodePanel = lazy(() => import('../CodePanel/CodePanel'));

/** Colonna destra con i tab "Proprietà" e "Codice". Il tab Codice esiste solo se abilitato dal toggle. */
export function Sidebar() {
  const { codeEnabled, sidebarTab, setSidebarTab } = useUiStore();
  const active = codeEnabled ? sidebarTab : 'properties';

  return (
    <aside className="sidebar" aria-label="Pannello laterale">
      <div className="sidebar__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={active === 'properties'} className={`sidebar__tab${active === 'properties' ? ' sidebar__tab--active' : ''}`} onClick={() => setSidebarTab('properties')}>
          Proprietà
        </button>
        {codeEnabled && (
          <button type="button" role="tab" aria-selected={active === 'code'} className={`sidebar__tab${active === 'code' ? ' sidebar__tab--active' : ''}`} onClick={() => setSidebarTab('code')}>
            Codice
          </button>
        )}
      </div>
      <div className="sidebar__body" role="tabpanel">
        {active === 'properties' ? (
          <PropertiesPanel />
        ) : (
          <Suspense fallback={<p className="sidebar__loading">Caricamento…</p>}>
            <CodePanel />
          </Suspense>
        )}
      </div>
    </aside>
  );
}
