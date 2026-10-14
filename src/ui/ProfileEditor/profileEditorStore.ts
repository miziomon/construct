import { create } from 'zustand';

/** Che cosa apre la modale: un Profilo esistente, oppure uno nuovo (nasce solo con l'OK, nel punto `at` del piatto se c'è). */
export type ProfileTarget = { nodeId: string } | { new: true; at?: [number, number] };

interface ProfileEditorState {
  /** null = modale chiusa. */
  target: ProfileTarget | null;
  open: (target: ProfileTarget) => void;
  close: () => void;
}

export const useProfileEditor = create<ProfileEditorState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
