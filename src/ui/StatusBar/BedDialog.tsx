import { useState } from 'react';
import { BED_LIMITS, DEFAULT_BED, useUiStore } from '../uiStore';
import { Modal } from '../Modal/Modal';
import { NumberField } from '../NumberField/NumberField';
import './BedDialog.scss';

/**
 * Modale delle dimensioni del piano di stampa: larghezza (X) e profondità (Y) in mm. Le modifiche valgono alla
 * conferma; "Piano quadrato" tiene i due lati uguali e "Predefinito" ripristina 256 × 256 mm.
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
  const close = () => setOpen(false);
  const apply = () => {
    setBedSize(draft);
    close();
  };

  return (
    <Modal open={open} title="Dimensioni del piano" onClose={close}>
      <div className="bed-dialog">
        <p className="bed-dialog__text">Misure del piano di stampa in millimetri, da {BED_LIMITS.min} a {BED_LIMITS.max}. Il piano è centrato sull&apos;origine: la griglia, il bordo e i limiti dei cursori seguono le nuove misure.</p>
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
