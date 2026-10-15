import { create } from 'zustand';
import { useArrayTool } from '../Array/arrayToolStore';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { useLayFlat } from '../LayFlat/layFlatStore';
import { useMeasure } from '../Measure/measureStore';
import { usePatternTool } from '../Pattern/patternToolStore';
import { useShellTool } from '../Shell/shellToolStore';
import { useSplitTool } from '../Split/splitToolStore';

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
  // Un solo strumento alla volta: uno strumento della scena aperto (Serie, Guscio, Raccordo...) si annulla, altrimenti i tasti
  // della modale (Invio, Esc) lo confermerebbero e la scena cambierebbe a modale aperta
  open: (target) => {
    useEdgeTool.getState().cancel();
    useShellTool.getState().cancel();
    useMeasure.getState().cancel();
    useLayFlat.getState().cancel();
    useArrayTool.getState().cancel();
    usePatternTool.getState().cancel();
    useSplitTool.getState().cancel();
    set({ target });
  },
  close: () => set({ target: null }),
}));
