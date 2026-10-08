import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { NumberField } from '../NumberField/NumberField';
import { confirmDialog } from '../notify/notifyStore';
import { SETTING_LIMITS, useUiStore } from '../uiStore';
import type { BedMode, Settings } from '../uiStore';
import { localDataSummary, storageUsage, wipeAllData } from './dataActions';
import './SettingsPanel.scss';

const BED_MODES: [BedMode, string][] = [
  ['full', 'Piano visibile'],
  ['grid', 'Solo griglia e bordo'],
  ['none', 'Nascosto'],
];

/** Interruttore con descrizione. */
function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings__toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </label>
  );
}

const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

/**
 * Impostazioni: aspetto, piano di stampa, modifica (quote, passi di spostamento e rotazione), salvataggio. In fondo il
 * ripristino delle opzioni e la pulizia completa dei dati salvati nel browser.
 */
export function SettingsPanel({ run }: { run: (action: () => void | Promise<void>) => () => void }) {
  const ui = useUiStore();
  const setSettings = ui.setSettings;
  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => setSettings({ [key]: value } as Partial<Settings>);
  const [usage, setUsage] = useState<number | null>(null);
  const local = localDataSummary();
  useEffect(() => {
    void storageUsage().then(setUsage);
  }, []);

  const reset = async () => {
    if (await confirmDialog('Ripristinare tutte le impostazioni ai valori predefiniti (tema, piano di stampa, passi, quote, salvataggio)? Il progetto non viene toccato.', 'Ripristina')) ui.resetSettings();
  };
  const wipe = async () => {
    const ok = await confirmDialog(
      'Cancellare TUTTI i dati salvati dal browser? Spariscono le impostazioni, la scena salvata automaticamente, le mesh importate e i preferiti. I file di progetto salvati sul computer restano. Non si può annullare.',
      'Cancella tutto',
    );
    if (ok) await wipeAllData();
  };

  return (
    <div className="settings">
      <section>
        <h3>Aspetto</h3>
        <div className="settings__row">
          <span>Tema</span>
          <div className="settings__segmented" role="group" aria-label="Tema">
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={ui.theme === t} onClick={() => ui.theme !== t && ui.toggleTheme()}>
                {t === 'light' ? 'Chiaro' : 'Scuro'}
              </button>
            ))}
          </div>
        </div>
        <Toggle id="set-welcome" label="Schermata di benvenuto a ogni avvio" hint="Se la togli compare solo la prima volta (si riapre sempre dal menu)." checked={ui.welcomeAlways} onChange={set('welcomeAlways')} />
      </section>

      <section>
        <h3>Piano di stampa</h3>
        <div className="settings__row">
          <label htmlFor="set-bed-mode">Visualizzazione</label>
          <select id="set-bed-mode" className="settings__select" value={ui.bedMode} onChange={(e) => useUiStore.setState({ bedMode: e.target.value as BedMode })}>
            {BED_MODES.map(([mode, label]) => (
              <option key={mode} value={mode}>{label}</option>
            ))}
          </select>
        </div>
        <div className="settings__row">
          <span>Dimensioni: {ui.bedSize.width} × {ui.bedSize.depth} mm</span>
          <button type="button" className="modal__button" onClick={run(() => ui.setBedDialogOpen(true))}>Modifica…</button>
        </div>
      </section>

      <section>
        <h3>Modifica</h3>
        <Toggle id="set-dims" label="Quote sull'oggetto selezionato" hint="Le misure X, Y e Z cliccabili nella vista 3D." checked={ui.showDimensions} onChange={set('showDimensions')} />
        <Toggle id="set-ghost" label="Operandi delle booleane in trasparenza" hint="Come il # di OpenSCAD (tasto X)." checked={ui.ghostOps} onChange={() => ui.toggleGhostOps()} />
        <NumberField label="Frecce" unit="mm" value={ui.nudgeStep} min={SETTING_LIMITS.nudgeStep.min} max={SETTING_LIMITS.nudgeStep.max} step={0.1} onCommit={set('nudgeStep')} />
        <p className="settings__hint">Passo delle frecce della tastiera; con Maiusc è dieci volte tanto.</p>
        <NumberField label="Aggancio" unit="mm" value={ui.snapMove} min={SETTING_LIMITS.snapMove.min} max={SETTING_LIMITS.snapMove.max} step={0.1} onCommit={set('snapMove')} />
        <p className="settings__hint">Passo di aggancio del gizmo Sposta (Maiusc lo disattiva).</p>
        <NumberField label="Rotazione" unit="°" value={ui.snapRotate} min={SETTING_LIMITS.snapRotate.min} max={SETTING_LIMITS.snapRotate.max} step={1} onCommit={set('snapRotate')} />
        <p className="settings__hint">Passo di aggancio del gizmo Ruota (Maiusc lo disattiva).</p>
      </section>

      <section>
        <h3>Salvataggio e dati</h3>
        <Toggle id="set-autosave" label="Salvataggio automatico nel browser" hint="La scena si salva a ogni modifica e si ritrova al prossimo avvio. Spento, vale solo Salva progetto." checked={ui.autosave} onChange={set('autosave')} />
        <p className="settings__hint">
          L&apos;app ha salvato {local.keys} {local.keys === 1 ? 'voce' : 'voci'} di preferenze ({formatBytes(local.bytes)}){usage !== null && <>, e in tutto il browser usa {formatBytes(usage)} tra progetto, mesh importate e cache offline</>}.
        </p>
        <div className="settings__actions">
          <button type="button" className="modal__button" onClick={() => void reset()}>
            <RotateCcw size={14} />
            Ripristina le impostazioni
          </button>
          <button type="button" className="modal__button settings__danger" onClick={() => void wipe()}>
            <Trash2 size={14} />
            Pulisci tutti i dati…
          </button>
        </div>
      </section>
    </div>
  );
}
