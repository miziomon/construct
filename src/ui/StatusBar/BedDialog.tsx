import { useState } from 'react';
import { BED_LIMITS, DEFAULT_BED, useUiStore } from '../uiStore';
import { BED_PRESETS, findPreset, presetLabel } from './bedPresets';
import { Modal } from '../Modal/Modal';
import { NumberField } from '../NumberField/NumberField';
import './BedDialog.scss';

/**
 * Modale delle dimensioni del piano di stampa: larghezza (X) e profondità (Y) in mm. Le modifiche valgono alla
 * conferma; la tendina delle stampanti riempie i due campi e "Predefinito" ripristina 256 × 256 mm.
 */
export function BedDialog() {
  const open = useUiStore((s) => s.bedDialogOpen);
  const setOpen = useUiStore((s) => s.setBedDialogOpen);
  const bedSize = useUiStore((s) => s.bedSize);
  const setBedSize = useUiStore((s) => s.setBedSize);
  // Valori in modifica: partono da quelli attuali ogni volta che la finestra si apre
  const [draft, setDraft] = useState(bedSize);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(bedSize);
  }
  // Il preset che coincide con le misure in modifica (assente = misure personalizzate)
  const preset = findPreset(draft.width, draft.depth);
  const close = () => setOpen(false);
  const apply = () => {
    setBedSize(draft);
    close();
  };

  return (
    <Modal open={open} title="Dimensioni del piano" onClose={close}>
      <div className="bed-dialog">
        <p className="bed-dialog__text">Misure del piano di stampa in millimetri, da {BED_LIMITS.min} a {BED_LIMITS.max}. Il piano è centrato sull&apos;origine: la griglia, il bordo e i limiti dei cursori seguono le nuove misure.</p>
        <label className="bed-dialog__printer">
          <span className="bed-dialog__printer-label">Stampante</span>
          {/* Ogni voce comincia dalla misura, poi elenca le stampanti che l'hanno. Scegliere compila i campi: si conferma con "Applica" */}
          <select
            className="bed-dialog__select"
            value={preset ? `${preset.width}x${preset.depth}` : 'custom'}
            onChange={(e) => {
              const chosen = BED_PRESETS.find((p) => `${p.width}x${p.depth}` === e.target.value);
              if (chosen) setDraft({ width: chosen.width, depth: chosen.depth });
            }}
          >
            {!preset && <option value="custom">{draft.width} × {draft.depth} mm · Misure personalizzate</option>}
            {BED_PRESETS.map((p) => (
              <option key={`${p.width}x${p.depth}`} value={`${p.width}x${p.depth}`}>
                {presetLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <div className="bed-dialog__fields">
          <NumberField label="Larghezza X" unit="mm" value={draft.width} min={BED_LIMITS.min} max={BED_LIMITS.max} step={1} onCommit={(width) => setDraft({ ...draft, width })} />
          <NumberField label="Profondità Y" unit="mm" value={draft.depth} min={BED_LIMITS.min} max={BED_LIMITS.max} step={1} onCommit={(depth) => setDraft({ ...draft, depth })} />
        </div>
        <div className="bed-dialog__actions">
          <button type="button" className="bed-dialog__button" onClick={() => setDraft(DEFAULT_BED)}>
            Predefinito {DEFAULT_BED.width} × {DEFAULT_BED.depth}
          </button>
          <span className="bed-dialog__spacer" />
          <button type="button" className="bed-dialog__button" onClick={close}>
            Annulla
          </button>
          <button type="button" className="bed-dialog__button bed-dialog__button--primary" onClick={apply}>
            Applica
          </button>
        </div>
      </div>
    </Modal>
  );
}
