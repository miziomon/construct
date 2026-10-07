import { useEffect } from 'react';
import { useSceneStore } from '../scene/store';
import { useUiStore } from '../ui/uiStore';
import { combineToBed, dropSelectionToBed } from '../kernel/placement';
import { useEdgeTool } from '../ui/EdgeTool/edgeToolStore';
import { newProject } from '../ui/fileActions';
import { toggleShell, useShellTool } from '../ui/Shell/shellToolStore';
import { useMeasure } from '../ui/Measure/measureStore';
import { toggleMeasure } from '../ui/Measure/toggleMeasure';
import { useLayFlat } from '../ui/LayFlat/layFlatStore';
import { useArrayTool } from '../ui/Array/arrayToolStore';
import { usePatternTool } from '../ui/Pattern/patternToolStore';
import { togglePattern } from '../ui/Pattern/togglePattern';
import { toggleArray } from '../ui/Array/toggleArray';
import { toggleLayFlat } from '../ui/LayFlat/toggleLayFlat';

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/** Scorciatoie da tastiera globali. Sono ignorate mentre si scrive in un campo. */
/** Avvia Raccordo, Smusso o Smusso angolare (i tasti F, S e A). */
const edgeStart = (kind: 'fillet' | 'chamfer' | 'corner') => useEdgeTool.getState().start(kind);

/** Tasto di ogni strumento degli spigoli. */
const EDGE_KEYS = { f: 'fillet', s: 'chamfer', a: 'corner' } as const;

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      // Guscio aperto: Esc annulla, Invio conferma, tutto il resto è ignorato
      const shell = useShellTool.getState();
      if (shell.active) {
        if (e.key === 'Escape') shell.cancel();
        else if (e.key === 'Enter') shell.commit();
        return;
      }
      // Serie aperta: Esc annulla, Invio conferma, tutto il resto è ignorato (i campi hanno già la loro tastiera)
      const array = useArrayTool.getState();
      if (array.active) {
        if (e.key === 'Escape') array.cancel();
        else if (e.key === 'Enter') array.commit();
        return;
      }
      // Pattern aperto: Esc annulla (con la scelta della faccia in corso la interrompe), Invio conferma, il resto è ignorato
      const pattern = usePatternTool.getState();
      if (pattern.active) {
        if (e.key === 'Escape') (pattern.picking ? pattern.setPicking(false) : pattern.cancel());
        else if (e.key === 'Enter') pattern.commit();
        return;
      }
      // Misura aperta: Esc o I la chiudono, il resto è ignorato (i clic scelgono punti, non modificano la scena)
      const measure = useMeasure.getState();
      if (measure.active) {
        if (e.key === 'Escape' || (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'i')) measure.cancel();
        return;
      }
      // Appoggia su una faccia aperto: Esc o V lo chiudono, il resto è ignorato (i clic scelgono una faccia)
      const layFlat = useLayFlat.getState();
      if (layFlat.active) {
        if (e.key === 'Escape' || (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'v')) layFlat.cancel();
        return;
      }
      // Raccordo, Smusso e Smusso angolare: Esc annulla, Invio conferma, il tasto dello strumento lo chiude e quello di un altro lo cambia; il resto è ignorato
      const edge = useEdgeTool.getState();
      if (edge.tool) {
        const k = e.key.toLowerCase();
        const kind = k in EDGE_KEYS ? EDGE_KEYS[k as keyof typeof EDGE_KEYS] : undefined;
        if (e.key === 'Escape' || (!e.ctrlKey && !e.metaKey && kind === edge.tool)) edge.cancel();
        else if (e.key === 'Enter') edge.commit();
        else if (!e.ctrlKey && !e.metaKey && kind) edge.start(kind);
        return;
      }
      // Con una modale aperta le scorciatoie dell'editor (Canc, G, ...) non devono agire sulla scena:
      // restano solo quelle che chiudono la modale del codice (C e Ctrl+J)
      if (document.querySelector('dialog[open]')) {
        const closesCode = useUiStore.getState().codeOpen && ((e.ctrlKey || e.metaKey) ? e.key.toLowerCase() === 'j' : e.key.toLowerCase() === 'c');
        if (!closesCode) return;
      }
      const s = useSceneStore.getState();
      const temporal = useSceneStore.temporal.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Passo di spostamento con le frecce: 1 mm, 10 mm con Shift
      const step = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number, number]> = {
        arrowleft: [-step, 0, 0], arrowright: [step, 0, 0],
        // Con Ctrl su/giù spostano in Z, altrimenti in Y
        arrowup: mod ? [0, 0, step] : [0, step, 0], arrowdown: mod ? [0, 0, -step] : [0, -step, 0],
      };

      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) temporal.redo(); else temporal.undo(); }
      else if (mod && key === 'y') { e.preventDefault(); temporal.redo(); }
      else if (mod && key === 'd') { e.preventDefault(); s.duplicateSelected(); }
      else if (mod && key === 'g') { e.preventDefault(); if (e.shiftKey) s.ungroupSelected(); else combineToBed('group'); }
      else if (!mod && key === 'c') useUiStore.getState().toggleCode();
      else if (!mod && key === 'd') useUiStore.getState().toggleTheme();
      else if (!mod && key === 'm') useUiStore.getState().toggleMenu();
      else if (mod && key === 'j') { e.preventDefault(); useUiStore.getState().toggleCode(); }
      else if (key === 'delete' || key === 'backspace') { e.preventDefault(); s.removeSelected(); }
      else if (!mod && key === 'h') s.toggleHoleSelected();
      else if (!mod && key === 'l') s.toggleLockSelected();
      else if (!mod && key === 'b') dropSelectionToBed();
      else if (!mod && key === 'x') useUiStore.getState().toggleGhostOps();
      else if (!mod && key === 'n') void newProject();
      else if (!mod && key === 'p') useUiStore.getState().cycleBed();
      else if (!mod && key === 'u') combineToBed('union');
      else if (!mod && key === 'j') combineToBed('hull');
      else if (!mod && key === 'v' && s.scene.rootIds.length) toggleLayFlat();
      else if (!mod && key === 'o') toggleArray();
      else if (!mod && key === 'z') togglePattern();
      else if (!mod && key === 'g') toggleShell();
      else if (!mod && key === 'i' && s.scene.rootIds.length) toggleMeasure();
      // Allinea (K) e Specchia (Y) aprono la loro tendina sulla barra; un secondo tasto la richiude
      else if (!mod && (key === 'k' || key === 'y')) {
        const ui = useUiStore.getState();
        const menu = key === 'k' ? 'align' : 'mirror';
        ui.setToolbarMenu(ui.toolbarMenu === menu ? null : menu);
      }
      else if (!mod && key === 'f' && s.scene.rootIds.length) edgeStart('fillet');
      else if (!mod && key === 's' && s.scene.rootIds.length) edgeStart('chamfer');
      else if (!mod && key === 'a' && s.scene.rootIds.length) edgeStart('corner');
      else if (key === 'f2') {
        // Rinomina l'oggetto selezionato nell'elenco oggetti
        e.preventDefault();
        if (s.selection.length === 1) useUiStore.getState().setRenamingId(s.selection[0]);
      }
      else if (!mod && key === 'q') s.setGizmoMode('select');
      else if (!mod && key === 'w') s.setGizmoMode('translate');
      else if (!mod && key === 'e') s.setGizmoMode('rotate');
      else if (!mod && key === 'r') s.setGizmoMode('resize');
      else if (!mod && key === 't') s.setGizmoMode('extrude');
      else if (key in arrows) { e.preventDefault(); s.nudgeSelected(arrows[key]); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
