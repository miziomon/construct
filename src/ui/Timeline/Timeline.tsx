import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Eraser } from 'lucide-react';
import { useStore } from 'zustand';
import { useSceneStore } from '../../scene/store';
import { useArrayTool } from '../Array/arrayToolStore';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { usePatternTool } from '../Pattern/patternToolStore';
import { useShellTool } from '../Shell/shellToolStore';
import { confirmDialog } from '../notify/notifyStore';
import { HoverTip } from '../Toolbar/HoverTip';
import './Timeline.scss';

/**
 * Timeline delle operazioni: un indicatore per ogni stato della cronologia di Annulla/Ripeti (passati, corrente, futuri).
 * Il nome dell'operazione che ha prodotto il passo sta nel tooltip. Un clic su un indicatore ci salta direttamente (undo o
 * redo di più passi); i passi futuri restano disponibili finché non si fa una nuova modifica. L'icona in fondo svuota la
 * cronologia.
 */
export function Timeline() {
  // Si legge l'intero stato della cronologia: zundo modifica gli elenchi sul posto, quindi un selettore sull'array
  // non vedrebbe il cambiamento
  const history = useStore(useSceneStore.temporal);
  const current = useSceneStore((s) => s.op);
  // Con Raccordo, Smusso, Angolo, Guscio, Serie o Pattern aperti la cronologia è in pausa: saltare romperebbe l'anteprima
  const edgeToolOpen = useEdgeTool((s) => s.tool !== null);
  const shellOpen = useShellTool((s) => s.active);
  const arrayOpen = useArrayTool((s) => s.active);
  const patternOpen = usePatternTool((s) => s.active);
  const busy = edgeToolOpen || shellOpen || arrayOpen || patternOpen;
  const strip = useRef<HTMLOListElement>(null);

  // Passi in ordine di tempo: i futuri sono salvati dal più lontano al più vicino, quindi si invertono
  const steps = [...history.pastStates.map((p) => p.op), current, ...[...history.futureStates].reverse().map((f) => f.op)];
  const at = history.pastStates.length;

  /** Porta lo stato al passo `index`. */
  const jump = (index: number) => {
    const t = useSceneStore.temporal.getState();
    if (index < at) t.undo(at - index);
    else if (index > at) t.redo(index - at);
  };

  /** Svuota la cronologia (dopo conferma): la scena resta com'è, ma non si può più annullare. */
  const clearHistory = async () => {
    if (!(await confirmDialog('Svuotare la cronologia? La scena resta com\'è, ma i passi non si potranno più annullare o ripetere.', 'Svuota'))) return;
    useSceneStore.temporal.getState().clear();
    // `op` non fa parte dell'uguaglianza della cronologia: riportarlo a "Inizio" non crea un passo
    useSceneStore.setState({ op: 'Inizio' });
  };

  // Il passo corrente resta visibile nella striscia
  useEffect(() => {
    const list = strip.current;
    const item = list?.children[at] as HTMLElement | undefined;
    if (!list || !item) return;
    if (item.offsetLeft < list.scrollLeft) list.scrollLeft = item.offsetLeft - 8;
    else if (item.offsetLeft + item.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = item.offsetLeft + item.offsetWidth - list.clientWidth + 8;
  }, [at, steps.length]);

  return (
    <nav className="timeline" aria-label="Timeline delle operazioni">
      <button type="button" className="timeline__arrow" title="Passo precedente (Ctrl+Z)" aria-label="Passo precedente" disabled={busy || at === 0} onClick={() => jump(at - 1)}>
        <ChevronLeft size={16} />
      </button>
      <ol className="timeline__steps" ref={strip}>
        {steps.map((label, i) => {
          const text = `${i + 1} · ${label}${i === at ? ' (stato corrente)' : ''}`;
          return (
            <li key={i}>
              <HoverTip text={text}>
                {(describedBy) => (
                  <button
                    type="button"
                    className={['timeline__step', i === 0 && 'timeline__step--start', i === at && 'timeline__step--current', i > at && 'timeline__step--future'].filter(Boolean).join(' ')}
                    aria-current={i === at ? 'step' : undefined}
                    aria-label={i === at ? `${label} (stato corrente)` : `Vai a: ${label}`}
                    aria-describedby={describedBy}
                    disabled={busy}
                    onClick={() => jump(i)}
                  >
                    <span className="timeline__dot" aria-hidden="true" />
                  </button>
                )}
              </HoverTip>
            </li>
          );
        })}
      </ol>
      <button type="button" className="timeline__arrow" title="Passo successivo (Ctrl+Y)" aria-label="Passo successivo" disabled={busy || at === steps.length - 1} onClick={() => jump(at + 1)}>
        <ChevronRight size={16} />
      </button>
      <button
        type="button"
        className="timeline__arrow timeline__clear"
        title="Svuota la cronologia"
        aria-label="Svuota la cronologia"
        disabled={busy || steps.length === 1}
        onClick={() => void clearHistory()}
      >
        <Eraser size={15} />
      </button>
    </nav>
  );
}
