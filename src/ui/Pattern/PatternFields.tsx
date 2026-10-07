import { FACE_DIRECTIONS, LATTICE_MAX_CELLS, PATTERN_MAX_CELLS, faceFromBounds } from '../../scene/pattern';
import type { FaceDirection } from '../../scene/pattern';
import type { PatternParams } from '../../scene/types';
import { NumberField } from '../NumberField/NumberField';
import { SliderField } from '../SliderField/SliderField';
// Stesso aspetto dei campi della Ripetizione
import '../Array/ArrayFields.scss';

interface Props {
  params: PatternParams;
  /** Modifica uno o più parametri. */
  onChange: (patch: Partial<PatternParams>) => void;
  disabled?: boolean;
  /** Falso quando la cronologia è già gestita da chi usa i campi (anteprima dello strumento, in pausa). */
  history?: boolean;
  /** Se presente compare "Scegli faccia": si clicca la faccia sull'oggetto (solo nel pannello dello strumento). */
  onPickFace?: () => void;
  picking?: boolean;
  /** Se presente compare "Aggiorna all'ingombro": ricalcola l'area del disegno sulle misure attuali del pezzo. */
  onRefreshBounds?: () => void;
}

const KIND_LABELS: Record<PatternParams['kind'], string> = { voronoi: 'Voronoi', hexagon: 'Esagoni', circle: 'Cerchi', lattice: 'Reticolo 3D' };
const FACE_LABELS: Record<FaceDirection, string> = { 'z+': '+Z', 'z-': '-Z', 'x+': '+X', 'x-': '-X', 'y+': '+Y', 'y-': '-Y' };
/** Sotto questa parete (circa due passate di un ugello da 0,4 mm) la stampa è inaffidabile. */
const MIN_PRINTABLE_WALL = 0.8;

/** Direzione della faccia se è una delle sei dell'ingombro (normale su un asse), altrimenti null. */
function directionOf(p: PatternParams): FaceDirection | null {
  return FACE_DIRECTIONS.find((d) => {
    const face = faceFromBounds(p.bounds, d);
    return [0, 1, 2].every((i) => Math.abs(face.normal[i] - p.face.normal[i]) < 1e-3);
  }) ?? null;
}

/**
 * Campi di un Pattern: tipo, seme, celle, parete, margine, faccia e profondità. Li usano il pannello dello strumento
 * Pattern (con anteprima dal vivo) e il pannello delle proprietà del gruppo "Pattern" già creato.
 */
export function PatternFields({ params: p, onChange, disabled, history = true, onPickFace, picking, onRefreshBounds }: Props) {
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
  const slider = (label: string, tip: string, key: 'cells' | 'latticeCells' | 'regularity' | 'size' | 'angle' | 'wall' | 'rounding' | 'margin' | 'depth' | 'strut', range: { min: number; max: number; step: number; hardMin?: number; hardMax?: number; unit?: string }) => (
    <SliderField label={label} tooltip={tip} value={p[key]} disabled={disabled} history={history} onCommit={(v) => onChange({ [key]: v })} {...range} />
  );

  const lattice = p.kind === 'lattice';
  const partial = p.depth > 0;

  return (
    <div className="array-fields">
      {choice('Tipo', 'Voronoi: celle casuali riproducibili dal seme; Esagoni e Cerchi: griglia regolare; Reticolo 3D: struttura di puntoni dentro il pezzo.', p.kind, (Object.keys(KIND_LABELS) as PatternParams['kind'][]).map((k) => [k, KIND_LABELS[k]]), (kind) => onChange({ kind }))}

      {(p.kind === 'voronoi' || lattice) && (
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

      {p.kind === 'voronoi' && slider('Celle', `Numero di celle (al massimo ${PATTERN_MAX_CELLS}).`, 'cells', { min: 3, max: 150, step: 1, hardMin: 3, hardMax: PATTERN_MAX_CELLS })}
      {lattice && slider('Celle', `Numero di celle del reticolo (al massimo ${LATTICE_MAX_CELLS}: ogni spigolo è un solido).`, 'latticeCells', { min: 4, max: LATTICE_MAX_CELLS, step: 1 })}
      {(p.kind === 'voronoi' || lattice) && slider('Regolarità', '0 = celle del tutto casuali, 100 = celle quasi uniformi.', 'regularity', { min: 0, max: 100, step: 1, unit: '%' })}
      {(p.kind === 'hexagon' || p.kind === 'circle') && (
        <>
          {slider('Passo', 'Distanza tra i centri di due celle, in mm.', 'size', { min: 4, max: 60, step: 0.5, hardMin: 2, unit: 'mm' })}
          {slider('Rotazione', 'Rotazione della griglia, in gradi.', 'angle', { min: 0, max: 90, step: 1, hardMin: -360, hardMax: 360, unit: '°' })}
        </>
      )}
      {lattice && slider('Puntone', 'Diametro dei puntoni del reticolo, in mm.', 'strut', { min: 0.8, max: 8, step: 0.1, hardMin: 0.2, unit: 'mm' })}

      {!lattice && (
        <>
          {choice('Modo', 'Fori: si tolgono le celle e restano le pareti. Solchi: si tolgono le pareti e restano le celle in rilievo.', p.mode, [['holes', 'Fori'], ['grooves', 'Solchi']], (mode) => onChange({ mode }))}
          {slider('Parete', 'Spessore della parete tra due celle, in mm.', 'wall', { min: 0.4, max: 6, step: 0.1, hardMin: 0.1, unit: 'mm' })}
          {slider('Arrotondamento', 'Raggio degli angoli delle celle, in mm.', 'rounding', { min: 0, max: 5, step: 0.1, hardMin: 0, unit: 'mm' })}
          {slider('Margine', 'Cornice piena che resta attorno al disegno, in mm.', 'margin', { min: 0, max: 20, step: 0.5, hardMin: 0, unit: 'mm' })}
          {choice('Faccia', 'Faccia da cui parte il taglio (lato dell\'ingombro del pezzo).', directionOf(p), FACE_DIRECTIONS.map((d) => [d, FACE_LABELS[d]]), (d) => onChange({ face: faceFromBounds(p.bounds, d) }))}
          {onPickFace && (
            <div className="array-fields__row" title="Poi clicca una faccia piana dell'oggetto: il disegno parte da quella faccia.">
              <span className="array-fields__label" />
              <button type="button" className={`array-fields__button${picking ? ' is-active' : ''}`} aria-pressed={picking} disabled={disabled} onClick={onPickFace}>
                {picking ? 'Clicca una faccia...' : 'Scegli faccia'}
              </button>
            </div>
          )}
          {slider('Profondità', 'Quanto entra il taglio dalla faccia, in mm. 0 = passante.', 'depth', { min: 0, max: Math.max(1, Math.round(p.face.thickness)), step: 0.1, hardMin: 0, unit: 'mm' })}
          {partial && choice('Lati', 'Il taglio parte dalla sola faccia scelta oppure anche da quella opposta, con la stessa profondità.', p.sides, [['one', 'Una faccia'], ['both', 'Entrambe']], (sides) => onChange({ sides }))}
          {p.wall < MIN_PRINTABLE_WALL && <p className="array-fields__total" role="status">Parete sotto {MIN_PRINTABLE_WALL} mm: difficile da stampare.</p>}
        </>
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
