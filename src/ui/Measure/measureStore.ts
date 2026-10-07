import { create } from 'zustand';
import type { Snap } from '../../scene/snap';

/**
 * Stato dello strumento Misura. Non tocca la scena né la cronologia: i punti sono solo un'annotazione sulla vista.
 * Si sceglie un punto di partenza e uno di arrivo; un terzo clic ricomincia da capo.
 */
interface MeasureState {
  active: boolean;
  /** Punto agganciato sotto il puntatore (anteprima prima del clic). */
  hover: Snap | null;
  /** Punti scelti: da 0 a 2. */
  points: Snap[];
  start: () => void;
  cancel: () => void;
  /** Azzera i punti ma lascia lo strumento attivo. */
  reset: () => void;
  setHover: (snap: Snap | null) => void;
  pick: (snap: Snap) => void;
}

const INITIAL = { active: false, hover: null, points: [] };

export const useMeasure = create<MeasureState>()((set, get) => ({
  ...INITIAL,
  start: () => set({ ...INITIAL, active: true }),
  cancel: () => set({ ...INITIAL }),
  reset: () => set({ hover: null, points: [] }),
  setHover: (hover) => {
    const current = get().hover;
    // Stessa posizione e stesso tipo: niente aggiornamento (il puntatore si muove di continuo)
    if (current === hover || (current && hover && current.kind === hover.kind && current.point.every((v, i) => v === hover.point[i]))) return;
    set({ hover });
  },
  // Con due punti già scelti il clic successivo apre una nuova misura
  pick: (snap) => set({ points: get().points.length >= 2 ? [snap] : [...get().points, snap] }),
}));
