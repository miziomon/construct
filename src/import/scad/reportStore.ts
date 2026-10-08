import { create } from 'zustand';
import type { ScadIssue } from './evaluate';

/** Esito dell'importazione di un file OpenSCAD con i problemi trovati, da mostrare nella modale di dettaglio. */
export interface ScadReport {
  fileName: string;
  /** Codice originale: serve a mostrare il frammento accanto a ogni problema. */
  source: string;
  issues: ScadIssue[];
  /** Quanti oggetti sono stati importati (0 = importazione non riuscita). */
  imported: number;
}

interface ReportState {
  report: ScadReport | null;
  show: (report: ScadReport) => void;
  close: () => void;
}

/** Stato della modale con il rapporto dell'importazione OpenSCAD (si apre da `importFiles`, si monta in App). */
export const useScadReport = create<ReportState>((set) => ({
  report: null,
  show: (report) => set({ report }),
  close: () => set({ report: null }),
}));
