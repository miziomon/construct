import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateLocalKey, STORAGE } from '../storageMigration';

export type Theme = 'light' | 'dark';

/** Piatto di stampa: tutto visibile, senza la base piena (restano griglia e bordo), oppure nascosto del tutto. */
export type BedMode = 'full' | 'grid' | 'none';

/** Dimensioni del piano di stampa in mm (larghezza su X, profondità su Y). */
export interface BedSize {
  width: number;
  depth: number;
}

/** Piano predefinito e limiti accettati: sotto 20 mm non serve a nulla, sopra 2000 mm la griglia si ingolfa. */
export const DEFAULT_BED: BedSize = { width: 256, depth: 256 };
export const BED_LIMITS = { min: 20, max: 2000 } as const;

/** Dimensione valida: numero finito entro i limiti, arrotondato al decimo di mm. Altrimenti `fallback`. */
const cleanBedSide = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(BED_LIMITS.max, Math.max(BED_LIMITS.min, value)) * 10) / 10 : fallback;

/** Lato maggiore del piano (mm): limite morbido dei cursori delle misure. Il piano non ha altezza, quindi vale anche per lo Z. */
export const bedReach = (bed: BedSize): number => Math.max(bed.width, bed.depth);

const NEXT_BED: Record<BedMode, BedMode> = { full: 'grid', grid: 'none', none: 'full' };

/** Tendine della barra strumenti che si possono aprire anche da tastiera. */
export type ToolbarMenu = 'align' | 'mirror';

/** Tab della libreria nella barra laterale sinistra. */
export type LibraryTab = 'shapes3d' | 'shapes2d' | 'symbols' | 'emoji';

export const LIBRARY_TABS: LibraryTab[] = ['shapes3d', 'shapes2d', 'symbols', 'emoji'];

/** Anteprima 3D di Allinea o Specchia mentre il puntatore è su un pulsante della tendina (non si salva). */
export interface PlacementPreview {
  kind: 'align' | 'mirror';
  axis: 0 | 1 | 2;
  target: 'min' | 'center' | 'max';
}

/** Quanti simboli ed emoji ricordare tra i Recenti e tra i Preferiti. */
export const MAX_RECENT = 12;
export const MAX_FAVORITES = 200;

/** Elenco di chiavi `tab:carattere` valido: solo stringhe, senza ripetizioni, al massimo `max` voci (il localStorage non è fidato). */
const cleanKeys = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40))].slice(0, max) : [];

interface UiState {
  /** Modale con il codice OpenSCAD aperta (non si salva: all'avvio è chiusa). */
  codeOpen: boolean;
  /** Menu a tendina dell'header aperto (non si salva). */
  menuOpen: boolean;
  /** Tendina della barra strumenti aperta (Allinea o Specchia; non si salva). */
  toolbarMenu: ToolbarMenu | null;
  /** Nodo il cui nome si sta modificando nell'elenco oggetti (non si salva). */
  renamingId: string | null;
  /** Modalità # (come in OpenSCAD): mostra in trasparenza gli operandi delle booleane dell'oggetto selezionato (non si salva). */
  ghostOps: boolean;
  theme: Theme;
  bedMode: BedMode;
  /** Dimensioni del piano di stampa (si salvano in localStorage). */
  bedSize: BedSize;
  setBedSize: (size: Partial<BedSize>) => void;
  /** Schermata di benvenuto del primo avvio aperta (non si salva: la decide `firstVisit` all'avvio). */
  welcomeOpen: boolean;
  setWelcomeOpen: (open: boolean) => void;
  /** Modale delle dimensioni del piano aperta (non si salva). */
  bedDialogOpen: boolean;
  setBedDialogOpen: (open: boolean) => void;
  /** Tab della libreria aperta (si salva in localStorage). */
  libraryTab: LibraryTab;
  setLibraryTab: (tab: LibraryTab) => void;
  /**
   * Gruppi (accordion) aperti nelle tab Simboli ed Emoji, per chiave (es. `symbols:Frecce`). Chi non è nell'elenco
   * ha il suo valore predefinito (vedi `AccordionGroup`). Si salva in localStorage.
   */
  libraryGroupsOpen: Record<string, boolean>;
  setLibraryGroupOpen: (key: string, open: boolean) => void;
  /** Apre o chiude insieme più gruppi (pulsante "Apri tutto / Chiudi tutto"). */
  setLibraryGroupsOpen: (keys: string[], open: boolean) => void;
  /** Simboli ed emoji preferiti e usati di recente, come chiavi `symbol:★` / `emoji:😂` (il più recente per primo). Si salvano in localStorage. */
  libraryFavorites: string[];
  libraryRecent: string[];
  toggleLibraryFavorite: (key: string) => void;
  pushLibraryRecent: (key: string) => void;
  placementPreview: PlacementPreview | null;
  setPlacementPreview: (preview: PlacementPreview | null) => void;
  /** Gizmo in trascinamento: le quote nella vista si nascondono finché non finisce (non si salva). */
  gizmoDragging: boolean;
  setGizmoDragging: (dragging: boolean) => void;
  /**
   * Menu contestuale aperto, con la posizione del puntatore in pixel della finestra (non si salva). Con `point` (X e Y
   * sul piano di stampa) è il menu del vuoto, che aggiunge una forma in quel punto; senza, quello dei comandi della selezione.
   */
  contextMenu: { x: number; y: number; point?: [number, number] } | null;
  setContextMenu: (menu: { x: number; y: number; point?: [number, number] } | null) => void;
  toggleGhostOps: () => void;
  /** Apre la tendina indicata (chiudendo l'altra); `null` la chiude. */
  setToolbarMenu: (menu: ToolbarMenu | null) => void;
  toggleCode: () => void;
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  setRenamingId: (id: string | null) => void;
  setCodeOpen: (open: boolean) => void;
  toggleTheme: () => void;
  cycleBed: () => void;
}

// Le preferenze salvate con il vecchio nome dell'app passano alla chiave nuova prima che lo store le legga
migrateLocalKey(STORAGE.ui.legacy, STORAGE.ui.now);

// Le preferenze dell'interfaccia restano in localStorage (non fanno parte della scena né dell'undo)
export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      codeOpen: false,
      menuOpen: false,
      renamingId: null,
      toolbarMenu: null,
      ghostOps: false,
      theme: 'light',
      bedMode: 'full',
      bedSize: DEFAULT_BED,
      setBedSize: (size) => set({ bedSize: { width: cleanBedSide(size.width, get().bedSize.width), depth: cleanBedSide(size.depth, get().bedSize.depth) } }),
      welcomeOpen: false,
      setWelcomeOpen: (welcomeOpen) => set({ welcomeOpen }),
      bedDialogOpen: false,
      setBedDialogOpen: (bedDialogOpen) => set({ bedDialogOpen }),
      libraryTab: 'shapes3d',
      setLibraryTab: (libraryTab) => set({ libraryTab }),
      libraryGroupsOpen: {},
      setLibraryGroupOpen: (key, open) => set({ libraryGroupsOpen: { ...get().libraryGroupsOpen, [key]: open } }),
      setLibraryGroupsOpen: (keys, open) => set({ libraryGroupsOpen: { ...get().libraryGroupsOpen, ...Object.fromEntries(keys.map((k) => [k, open])) } }),
      libraryFavorites: [],
      libraryRecent: [],
      toggleLibraryFavorite: (key) => {
        const current = get().libraryFavorites;
        set({ libraryFavorites: current.includes(key) ? current.filter((k) => k !== key) : cleanKeys([...current, key], MAX_FAVORITES) });
      },
      // L'ultimo usato va in testa; la lista non supera MAX_RECENT voci
      pushLibraryRecent: (key) => set({ libraryRecent: cleanKeys([key, ...get().libraryRecent], MAX_RECENT) }),
      placementPreview: null,
      setPlacementPreview: (placementPreview) => set({ placementPreview }),
      gizmoDragging: false,
      setGizmoDragging: (gizmoDragging) => set({ gizmoDragging }),
      contextMenu: null,
      setContextMenu: (contextMenu) => set({ contextMenu }),
      toggleGhostOps: () => set({ ghostOps: !get().ghostOps }),
      setToolbarMenu: (toolbarMenu) => set({ toolbarMenu }),
      toggleCode: () => set({ codeOpen: !get().codeOpen }),
      setMenuOpen: (menuOpen) => set({ menuOpen }),
      toggleMenu: () => set({ menuOpen: !get().menuOpen }),
      setRenamingId: (renamingId) => set({ renamingId }),
      setCodeOpen: (codeOpen) => set({ codeOpen }),
      toggleTheme: () => set({ theme: get().theme === 'light' ? 'dark' : 'light' }),
      cycleBed: () => set({ bedMode: NEXT_BED[get().bedMode] }),
    }),
    {
      name: STORAGE.ui.now,
      // La modale del codice non si ripristina all'avvio
      partialize: (s) => ({ theme: s.theme, bedMode: s.bedMode, bedSize: s.bedSize, libraryTab: s.libraryTab, libraryGroupsOpen: s.libraryGroupsOpen, libraryFavorites: s.libraryFavorites, libraryRecent: s.libraryRecent }),
      // Si accettano solo i campi noti e validi: un valore salvato da una versione precedente (o rovinato) non rompe l'avvio
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<UiState>;
        return {
          ...current,
          theme: s.theme === 'dark' ? 'dark' : current.theme,
          bedMode: s.bedMode && s.bedMode in NEXT_BED ? s.bedMode : current.bedMode,
          bedSize: { width: cleanBedSide(s.bedSize?.width, DEFAULT_BED.width), depth: cleanBedSide(s.bedSize?.depth, DEFAULT_BED.depth) },
          libraryTab: s.libraryTab && LIBRARY_TABS.includes(s.libraryTab) ? s.libraryTab : current.libraryTab,
          // Solo valori booleani: il resto del localStorage non è fidato
          libraryGroupsOpen: Object.fromEntries(Object.entries(s.libraryGroupsOpen ?? {}).filter(([, v]) => typeof v === 'boolean')),
          libraryFavorites: cleanKeys(s.libraryFavorites, MAX_FAVORITES),
          libraryRecent: cleanKeys(s.libraryRecent, MAX_RECENT),
        };
      },
    },
  ),
);

/** Lato maggiore del piano di stampa, aggiornato quando cambia (vedi `bedReach`). */
export const useBedReach = (): number => useUiStore((s) => bedReach(s.bedSize));
