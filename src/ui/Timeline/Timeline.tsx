import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from 'zustand';
import { useSceneStore } from '../../scene/store';
import { useEdgeTool } from '../EdgeTool/edgeToolStore';
import { useShellTool } from '../Shell/shellToolStore';
import './Timeline.scss';

/**
 * Timeline delle operazioni: un passo per ogni stato della cronologia di Annulla/Ripeti (passati, corrente, futuri),
 * con il nome dell'operazione che lo ha prodotto. Un clic su un passo ci salta direttamente (undo o redo di più passi);
 * i passi futuri restano disponibili finché non si fa una nuova modifica.
 */
export function Timeline() {
  // Si legge l'intero stato della cronologia: zundo modifica gli elenchi sul posto, quindi un selettore sull'array
  // non vedrebbe il cambiamento
  const history = useStore(useSceneStore.temporal);
  const current = useSceneStore((s) => s.op);
  // Con Raccordo, Smusso, Angolo o Guscio aperti la cronologia è in pausa: saltare romperebbe l'anteprima
  const edgeToolOpen = useEdgeTool((s) => s.tool !== null);
  const shellOpen = useShellTool((s) => s.active);
  const busy = edgeToolOpen || shellOpen;
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
        {steps.map((label, i) => (
          <li key={i}>
            <button
              type="button"
              className={['timeline__step', i === at && 'timeline__step--current', i > at && 'timeline__step--future'].filter(Boolean).join(' ')}
              aria-current={i === at ? 'step' : undefined}
              disabled={busy}
              title={i === at ? `${label} (stato corrente)` : `Vai a: ${label}`}
              onClick={() => jump(i)}
            >
              <span className="timeline__number">{i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="timeline__arrow" title="Passo successivo (Ctrl+Y)" aria-label="Passo successivo" disabled={busy || at === steps.length - 1} onClick={() => jump(at + 1)}>
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
