import { useResultStore } from '../../kernel/useKernel';
import { FACE_DIRECTIONS, PATTERN_MAX_CELLS, faceFromBounds, sameFace } from '../../scene/pattern';
import type { FaceDirection } from '../../scene/pattern';
import type { PatternParams } from '../../scene/types';
import { NumberField } from '../NumberField/NumberField';
import { SliderField } from '../SliderField/SliderField';
import { SLOW_PREVIEW_CELLS, SLOW_PREVIEW_MS, estimatedCells } from './patternToolStore';
// Stesso aspetto dei campi della Ripetizione
import '../Array/ArrayFields.scss';

interface Props {
  params: PatternParams;
  /** Modifica uno o più parametri. */
  onChange: (patch: Partial<PatternParams>) => void;
  disabled?: boolean;
  /** Falso quando la cronologia è già gestita da chi usa i campi (anteprima dello strumento, in pausa). */
  history?: boolean;
  /** Se presente compare "Scegli facce": si cliccano le facce sull'oggetto (solo nel pannello dello strumento). */
  onPickFace?: () => void;
  picking?: boolean;
  /** Se presente compare la casella "Anteprima semplificata" (solo nel pannello dello strumento). */
  onSimplified?: (simplified: boolean) => void;
  simplified?: boolean;
  /** Se presente compare "Aggiorna all'ingombro": ricalcola l'area del disegno sulle misure attuali del pezzo. */
  onRefreshBounds?: () => void;
}

const KIND_LABELS: Record<PatternParams['kind'], string> = { voronoi: 'Voronoi', hexagon: 'Esagoni', circle: 'Cerchi', diamond: 'Rombi', triangle: 'Triangoli' };
const FACE_LABELS: Record<FaceDirection, string> = { 'z+': '+Z', 'z-': '-Z', 'x+': '+X', 'x-': '-X', 'y+': '+Y', 'y-': '-Y' };
/** Sotto questa parete (circa due passate di un ugello da 0,4 mm) la stampa è inaffidabile. */
const MIN_PRINTABLE_WALL = 0.8;

/**
 * Campi di un Pattern: tipo, seme, celle, parete, margine, facce e profondità. Li usano il pannello dello strumento
 * Pattern (con anteprima dal vivo) e il pannello delle proprietà del gruppo "Pattern" già creato.
 */
export function PatternFields({ params: p, onChange, disabled, history = true, onPickFace, picking, onSimplified, simplified, onRefreshBounds }: Props) {
  const ms = useResultStore((s) => s.ms);
  /** Pulsanti alternativi (come i selettori della Ripetizione). */
  const choice = <T extends string>(label: string, tip: string, value: T | null, options: [T, string][], set: (v: T) => void) => (
    <div className="array-fields__row" title={tip}>
      <span className="array-fields__label">{label}</span>
      <div className="array-fields__segmented" role="group" aria-label={label}>
        {options.map(([option, text]) => (
          <button key={option} type="button" className={option === value ? 'is-active' : undefined} aria-pressed={option === value} disabled={disabled} onClick={() => set(option)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  const slider = (label: string, tip: string, key: 'cells' | 'regularity' | 'size' | 'angle' | 'wall' | 'rounding' | 'margin' | 'depth', range: { min: number; max: number; step: number; hardMin?: number; hardMax?: number; unit?: string }) => (
    <SliderField label={label} tooltip={tip} value={p[key]} disabled={disabled} history={history} onCommit={(v) => onChange({ [key]: v })} {...range} />
  );

  const partial = p.depth > 0;
  /** I sei lati dell'ingombro sono interruttori: ogni lato attivo è una faccia da cui parte il taglio. */
  const sides = FACE_DIRECTIONS.map((d) => ({ d, face: faceFromBounds(p.bounds, d) }));
  const isOn = (face: ReturnType<typeof faceFromBounds>) => p.faces.some((f) => sameFace(f, face));
  const toggleSide = (face: ReturnType<typeof faceFromBounds>) => {
    if (!isOn(face)) return onChange({ faces: [...p.faces, face] });
    // Si toglie solo se resta almeno una faccia
    const rest = p.faces.filter((f) => !sameFace(f, face));
    if (rest.length) onChange({ faces: rest });
  };
  const custom = p.faces.filter((f) => !sides.some((s) => sameFace(s.face, f))).length;
  const slow = ms > SLOW_PREVIEW_MS || estimatedCells(p) > SLOW_PREVIEW_CELLS;

  return (
    <div className="array-fields">
      {choice('Tipo', 'Voronoi: celle casuali riproducibili dal seme; Esagoni, Cerchi, Rombi e Triangoli: griglia regolare.', p.kind, (Object.keys(KIND_LABELS) as PatternParams['kind'][]).map((k) => [k, KIND_LABELS[k]]), (kind) => onChange({ kind }))}

      {p.kind === 'voronoi' && (
        <div className="array-fields__row" title="Il seme decide il disegno: lo stesso seme dà sempre lo stesso risultato, anche nel codice OpenSCAD.">
          <span className="array-fields__label">Seme</span>
          <div className="array-fields__vector">
            <NumberField label="Seme" value={p.seed} min={0} max={2 ** 31} step={1} disabled={disabled} onCommit={(seed) => onChange({ seed })} />
            <button type="button" className="array-fields__button" disabled={disabled} onClick={() => onChange({ seed: Math.floor(Math.random() * 100000) })}>
              Nuovo seme
            </button>
          </div>
        </div>
      )}

      {p.kind === 'voronoi' && slider('Celle', `Numero di celle per faccia (al massimo ${PATTERN_MAX_CELLS}).`, 'cells', { min: 3, max: 150, step: 1, hardMin: 3, hardMax: PATTERN_MAX_CELLS })}
      {p.kind === 'voronoi' && slider('Regolarità', '0 = celle del tutto casuali, 100 = celle quasi uniformi.', 'regularity', { min: 0, max: 100, step: 1, unit: '%' })}
      {p.kind !== 'voronoi' && (
        <>
          {slider('Passo', 'Distanza tra i centri di due celle, in mm.', 'size', { min: 4, max: 60, step: 0.5, hardMin: 2, unit: 'mm' })}
          {slider('Rotazione', 'Rotazione della griglia, in gradi.', 'angle', { min: 0, max: 90, step: 1, hardMin: -360, hardMax: 360, unit: '°' })}
        </>
      )}

      {choice('Modo', 'Fori: si tolgono le celle e restano le pareti. Solchi: si tolgono le pareti e restano le celle in rilievo.', p.mode, [['holes', 'Fori'], ['grooves', 'Solchi']], (mode) => onChange({ mode }))}
      {slider('Parete', 'Spessore della parete tra due celle, in mm.', 'wall', { min: 0.4, max: 6, step: 0.1, hardMin: 0.1, unit: 'mm' })}
      {slider('Arrotondamento', 'Raggio degli angoli delle celle, in mm.', 'rounding', { min: 0, max: 5, step: 0.1, hardMin: 0, unit: 'mm' })}
      {slider('Margine', 'Cornice piena che resta attorno al disegno, in mm.', 'margin', { min: 0, max: 20, step: 0.5, hardMin: 0, unit: 'mm' })}

      <div className="array-fields__row" title="Lati da cui parte il taglio: se ne possono attivare più di uno, ognuno con il proprio disegno.">
        <span className="array-fields__label">Facce</span>
        <div className="array-fields__segmented" role="group" aria-label="Facce">
          {sides.map(({ d, face }) => (
            <button key={d} type="button" className={isOn(face) ? 'is-active' : undefined} aria-pressed={isOn(face)} disabled={disabled} onClick={() => toggleSide(face)}>
              {FACE_LABELS[d]}
            </button>
          ))}
        </div>
      </div>
      {onPickFace && (
        <div className="array-fields__row" title="Poi clicca le facce piane dell'oggetto: un clic aggiunge una faccia, un secondo clic la toglie.">
          <span className="array-fields__label" />
          <button type="button" className={`array-fields__button${picking ? ' is-active' : ''}`} aria-pressed={picking} disabled={disabled} onClick={onPickFace}>
            {picking ? 'Fine scelta' : 'Scegli facce'}
          </button>
        </div>
      )}
      <p className="array-fields__total" role="status">
        {picking ? 'Clicca le facce da forare (Esc per finire). ' : ''}
        {p.faces.length === 1 ? '1 faccia' : `${p.faces.length} facce`}
        {custom > 0 ? `, di cui ${custom} scelte con il clic` : ''}
      </p>

      {slider('Profondità', 'Quanto entra il taglio dalla faccia, in mm. 0 = passante.', 'depth', { min: 0, max: Math.max(1, Math.round(Math.max(...p.faces.map((f) => f.thickness)))), step: 0.1, hardMin: 0, unit: 'mm' })}
      {partial && choice('Lati', 'Il taglio parte dalla sola faccia scelta oppure anche da quella opposta, con la stessa profondità.', p.sides, [['one', 'Una faccia'], ['both', 'Entrambe']], (sides) => onChange({ sides }))}
      {p.wall < MIN_PRINTABLE_WALL && <p className="array-fields__total" role="status">Parete sotto {MIN_PRINTABLE_WALL} mm: difficile da stampare.</p>}

      {slow && (
        <p className="array-fields__total array-fields__warning" role="alert">
          {ms > SLOW_PREVIEW_MS ? `Calcolo lento (${Math.round(ms)} ms).` : `Molte celle (circa ${estimatedCells(p)}): il calcolo può essere lento.`} Riduci celle o facce, oppure aumenta il passo.
        </p>
      )}
      {onSimplified && (
        <label className="array-fields__row array-fields__check" title="Durante l'anteprima gli angoli arrotondati hanno meno segmenti: il calcolo è più veloce. Il risultato dopo l'OK è sempre a qualità piena.">
          <span className="array-fields__label">Anteprima semplificata</span>
          <input type="checkbox" checked={!!simplified} onChange={(e) => onSimplified(e.target.checked)} />
        </label>
      )}

      {onRefreshBounds && (
        <div className="array-fields__row" title="Il disegno copre l'ingombro che il pezzo aveva quando è stato applicato: se il pezzo è cambiato, ricalcolalo.">
          <span className="array-fields__label" />
          <button type="button" className="array-fields__button" disabled={disabled} onClick={onRefreshBounds}>
            Aggiorna all'ingombro
          </button>
        </div>
      )}
    </div>
  );
}
