import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

/** Piatto di stampa: tutto visibile, senza la base piena (restano griglia e bordo), oppure nascosto del tutto. */
export type BedMode = 'full' | 'grid' | 'none';

const NEXT_BED: Record<BedMode, BedMode> = { full: 'grid', grid: 'none', none: 'full' };

interface UiState {
  /** Modale con il codice OpenSCAD aperta (non si salva: all'avvio è chiusa). */
  codeOpen: boolean;
  theme: Theme;
  bedMode: BedMode;
  toggleCode: () => void;
  setCodeOpen: (open: boolean) => void;
  toggleTheme: () => void;
  cycleBed: () => void;
}

// Le preferenze dell'interfaccia restano in localStorage (non fanno parte della scena né dell'undo)
export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      codeOpen: false,
      theme: 'light',
      bedMode: 'full',
      toggleCode: () => set({ codeOpen: !get().codeOpen }),
      setCodeOpen: (codeOpen) => set({ codeOpen }),
      toggleTheme: () => set({ theme: get().theme === 'light' ? 'dark' : 'light' }),
      cycleBed: () => set({ bedMode: NEXT_BED[get().bedMode] }),
    }),
    {
      name: 'webcad:ui',
      // La modale del codice non si ripristina all'avvio
      partialize: (s) => ({ theme: s.theme, bedMode: s.bedMode }),
    },
  ),
);
