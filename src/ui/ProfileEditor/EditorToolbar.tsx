import { useRef } from 'react';
import { Circle, Hand, Hexagon, MousePointer2, PenTool, Redo2, Square, Undo2, Upload } from 'lucide-react';
import { NumberField } from '../NumberField/NumberField';
import type { Tool } from './DrawingCanvas';
import { POLYGON_SIDES } from './model';

/** Quali disegni mostra la modale: il profilo, la sagoma vista dall'alto (sperimentale) o tutti e due. */
export type ViewMode = 'profile' | 'plan' | 'both';

interface Props {
  tool: Tool;
  onTool: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Lati del Poligono regolare (campo accanto agli strumenti, solo con il Poligono attivo). */
  sides: number;
  onSides: (sides: number) => void;
  onImportSvg: (file: File) => void;
  /** Forme base e Importa SVG non valgono per il disegno attivo (la sagoma è un contorno solo): il testo dice perché. */
  shapesOff?: string;
  /** Disegno a cui si riferiscono Annulla e Ripeti (solo con la sagoma attiva: nome nel titolo). */
  target?: string;
  /** Selettore dei disegni: assente senza la funzione sperimentale. `disabled` dice perché la sagoma non c'è. */
  views?: { mode: ViewMode; onMode: (mode: ViewMode) => void; disabled?: string };
}

const VIEWS: [ViewMode, string][] = [
  ['profile', 'Profilo'],
  ['plan', 'Sagoma'],
  ['both', 'Entrambe'],
];

/**
 * Barra sopra i disegni: strumenti (Seleziona, Penna, Sposta vista), Annulla e Ripeti a destra degli strumenti, e con la
 * sagoma sperimentale il selettore dei disegni. Gli strumenti sono uno solo per tutta la modale.
 */
export function EditorToolbar({ tool, onTool, canUndo, canRedo, onUndo, onRedo, sides, onSides, onImportSvg, shapesOff, target, views }: Props) {
  const where = target ? ` (${target})` : '';
  const fileInput = useRef<HTMLInputElement>(null);
  const off = (title: string) => shapesOff ?? title;
  return (
    <div className="profile-editor__toolbar" role="toolbar" aria-label="Strumenti di disegno">
      <div className="profile-editor__toolgroup">
        <button type="button" aria-pressed={tool === 'select'} title="Seleziona (V): sposta nodi e maniglie (Alt: la maniglia si muove da sola e il nodo è uno spigolo), clic su una curva per selezionare tutto il contorno (trascinala per spostarlo). Con la quota di sezione visibile, trascinala per cambiare la quota" onClick={() => onTool('select')}>
          <MousePointer2 size={16} />
          <span>Seleziona</span>
        </button>
        <button type="button" aria-pressed={tool === 'pen'} title="Penna (P): clic per uno spigolo, clic e trascina per una curva (tieni premuto Alt per uno spigolo), clic su una curva esistente per inserirvi un nodo (Ctrl o ⌘: no), clic su un estremo aperto per riprendere il contorno, clic sul primo nodo per chiudere (trascinando ne disegni la maniglia, Alt per uno spigolo), Invio per terminare. Nella sagoma inserisce solo nodi sulla curva: la forma resta chiusa" onClick={() => onTool('pen')}>
          <PenTool size={16} />
          <span>Penna</span>
        </button>
        <button type="button" aria-pressed={tool === 'pan'} title="Sposta vista (H): trascina per spostare il disegno nella vista. Si può anche tenere premuto Spazio, il tasto centrale o il destro" onClick={() => onTool('pan')}>
          <Hand size={16} />
          <span>Sposta vista</span>
        </button>
        <button type="button" aria-pressed={tool === 'rect'} disabled={!!shapesOff} title={off('Rettangolo (R): premi sul centro e trascina (Maiusc: quadrato). Nasce con quattro spigoli, modificabili come ogni contorno')} onClick={() => onTool('rect')}>
          <Square size={16} />
          <span>Rettangolo</span>
        </button>
        <button type="button" aria-pressed={tool === 'ellipse'} disabled={!!shapesOff} title={off('Ellisse (C): premi sul centro e trascina (Maiusc: cerchio). Nasce con quattro nodi simmetrici')} onClick={() => onTool('ellipse')}>
          <Circle size={16} />
          <span>Ellisse</span>
        </button>
        <button type="button" aria-pressed={tool === 'polygon'} disabled={!!shapesOff} title={off('Poligono regolare (G): premi sul centro e trascina, il primo vertice va verso il puntatore (Maiusc: angolo a multipli di 15°). Il numero di lati si sceglie nel campo Lati')} onClick={() => onTool('polygon')}>
          <Hexagon size={16} />
          <span>Poligono</span>
        </button>
        {tool === 'polygon' && !shapesOff && (
          <div className="profile-editor__sides">
            <NumberField label="Lati" min={POLYGON_SIDES.min} max={POLYGON_SIDES.max} integer value={sides} onCommit={onSides} />
          </div>
        )}
        <button type="button" disabled={!!shapesOff} title={off('Importa SVG: aggiunge al disegno i contorni di un file SVG conservandone le curve (in millimetri, con la X del file e il fondo a y = 0)')} onClick={() => fileInput.current?.click()}>
          <Upload size={16} />
          <span>Importa SVG</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          aria-label="File SVG da importare"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Si azzera il campo: lo stesso file si può importare di nuovo
            e.target.value = '';
            if (file) onImportSvg(file);
          }}
        />
      </div>
      <div className="profile-editor__toolgroup profile-editor__toolgroup--icons" role="group" aria-label="Cronologia">
        <button type="button" aria-label="Annulla ultima modifica" title={`Annulla${where} (⌘Z o Ctrl+Z)`} disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={16} />
        </button>
        <button type="button" aria-label="Ripeti modifica annullata" title={`Ripeti${where} (⌘⇧Z o Ctrl+Maiusc+Z)`} disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={16} />
        </button>
      </div>
      {views && (
        <div className="profile-editor__toolgroup" role="group" aria-label="Disegni mostrati">
          {VIEWS.map(([mode, label]) => {
            const off = mode !== 'profile' && !!views.disabled;
            return (
              <button key={mode} type="button" aria-pressed={views.mode === mode} disabled={off} title={off ? views.disabled : mode === 'profile' ? 'Solo il disegno del profilo' : mode === 'plan' ? 'Solo la sagoma vista dall\'alto (sperimentale)' : 'Profilo e sagoma affiancati'} onClick={() => views.onMode(mode)}>
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
