import { create } from 'zustand';
import type { NodeMesh } from '../../kernel/evaluate';

/** Faccia sotto il puntatore: la mesh e l'indice della faccia piana (vedi `faceMap`). */
export interface LayFlatHover {
  mesh: NodeMesh;
  face: number;
}

/**
 * Stato dello strumento "Appoggia su una faccia": si passa sopra un oggetto (la faccia si evidenzia) e un clic ruota
 * l'oggetto con quella faccia sul piatto. Non tocca la scena finché non si clicca e non usa la cronologia.
 */
interface LayFlatState {
  active: boolean;
  hover: LayFlatHover | null;
  start: () => void;
  cancel: () => void;
  setHover: (hover: LayFlatHover | null) => void;
}

const INITIAL = { active: false, hover: null };

export const useLayFlat = create<LayFlatState>()((set, get) => ({
  ...INITIAL,
  start: () => set({ ...INITIAL, active: true }),
  cancel: () => set({ ...INITIAL }),
  setHover: (hover) => {
    const current = get().hover;
    // Stessa faccia: niente aggiornamento (il puntatore si muove di continuo)
    if (current?.mesh === hover?.mesh && current?.face === hover?.face) return;
    set({ hover });
  },
}));
