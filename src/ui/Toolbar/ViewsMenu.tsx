import { fitView, PRESET_LABELS, setViewPreset } from '../../viewport/cameraControl';
import type { ViewPreset } from '../../viewport/cameraControl';

/** Preset di vista con il tasto che li richiama (gli stessi di useShortcuts). */
const PRESETS: [ViewPreset, string][] = [['top', '7'], ['front', '1'], ['side', '3'], ['iso', '0']];

/**
 * Contenuto della tendina Viste: i quattro preset (alto, fronte, lato, isometrica) e Inquadra la selezione o tutto.
 * I preset tengono il centro inquadrato e la distanza; Inquadra sposta il centro sulla selezione (o sulla scena).
 */
export function ViewsMenu({ close }: { close: () => void }) {
  const run = (action: () => void) => () => {
    action();
    close();
  };
  return (
    <>
      <div className="toolbar__dropdown-row">
        {PRESETS.map(([preset, key]) => (
          <button key={preset} type="button" role="menuitem" className="toolbar__dropdown-item" title={`Vista ${PRESET_LABELS[preset].toLowerCase()} (tasto ${key})`} onClick={run(() => setViewPreset(preset))}>
            {PRESET_LABELS[preset]}
          </button>
        ))}
      </div>
      <div className="toolbar__dropdown-row">
        <button type="button" role="menuitem" className="toolbar__dropdown-item" title="Inquadra gli oggetti selezionati, o tutta la scena se non c'è selezione (tasto .)" onClick={run(() => fitView(true))}>
          Inquadra selezione
        </button>
        <button type="button" role="menuitem" className="toolbar__dropdown-item" title="Inquadra tutta la scena, o il piatto se è vuota (tasto Home)" onClick={run(() => fitView(false))}>
          Inquadra tutto
        </button>
      </div>
    </>
  );
}
