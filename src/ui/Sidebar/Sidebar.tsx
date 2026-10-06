import { PropertiesPanel } from '../PropertiesPanel/PropertiesPanel';
import './Sidebar.scss';

/** Colonna destra con le proprietà dell'oggetto selezionato (il codice OpenSCAD sta in una modale). */
export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Proprietà">
      <h2 className="sidebar__title">Proprietà</h2>
      <div className="sidebar__body">
        <PropertiesPanel />
      </div>
    </aside>
  );
}
