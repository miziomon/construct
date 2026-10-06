import { useEffect } from 'react';
import { useSceneStore } from '../scene/store';
import { useUiStore } from '../ui/uiStore';
import { dropSelectionToBed } from '../kernel/placement';

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/** Scorciatoie da tastiera globali. Sono ignorate mentre si scrive in un campo. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
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
      else if (mod && key === 'g') { e.preventDefault(); if (e.shiftKey) s.ungroupSelected(); else s.groupSelected(); }
      else if (!mod && key === 'c') useUiStore.getState().toggleCode();
      else if (!mod && key === 'd') useUiStore.getState().toggleTheme();
      else if (!mod && key === 'm') useUiStore.getState().toggleMenu();
      else if (mod && key === 'j') { e.preventDefault(); useUiStore.getState().toggleCode(); }
      else if (key === 'delete' || key === 'backspace') { e.preventDefault(); s.removeSelected(); }
      else if (!mod && key === 'h') s.toggleHoleSelected();
      else if (!mod && key === 'l') s.toggleLockSelected();
      else if (!mod && key === 'b') dropSelectionToBed();
      else if (!mod && key === 'p') useUiStore.getState().cycleBed();
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
