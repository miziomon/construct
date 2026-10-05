import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarTab = 'properties' | 'code';

interface UiState {
  /** Se false il tab "Codice" non è disponibile e la sidebar mostra solo le proprietà. */
  codeEnabled: boolean;
  sidebarTab: SidebarTab;
  setCodeEnabled: (enabled: boolean) => void;
  toggleCode: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
}

// Le preferenze dell'interfaccia restano in localStorage (non fanno parte della scena né dell'undo)
export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      codeEnabled: true,
      sidebarTab: 'properties',
      setCodeEnabled: (enabled) => set({ codeEnabled: enabled, sidebarTab: enabled ? get().sidebarTab : 'properties' }),
      // Il toggle mostra il pannello codice e lo porta in primo piano, oppure lo nasconde del tutto
      toggleCode: () => {
        const on = !get().codeEnabled;
        set({ codeEnabled: on, sidebarTab: on ? 'code' : 'properties' });
      },
      setSidebarTab: (tab) => set({ sidebarTab: tab }),
    }),
    { name: 'webcad:ui' },
  ),
);
