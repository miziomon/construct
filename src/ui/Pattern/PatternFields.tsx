import { useId } from 'react';
import { useResultStore } from '../../kernel/useKernel';
import { PATTERN_MAX_CELLS, faceName, hammeredDepthLimit, isAxisFace, isReliefKind, patternRelief, reliefDepthLimit, reliefToStore, reliefWarnings, woodGrainLimit } from '../../scene/pattern';
import type { BrickDesign, ReliefDesign, ReliefParams, StudLayout, StudShape } from '../../scene/relief';
import type { PatternParams } from '../../scene/types';
import { NumberField } from '../NumberField/NumberField';
import { SliderField } from '../SliderField/SliderField';
import { useUiStore } from '../uiStore';
import { TextureFields } from './TextureFields';
import { getImage } from '../../import/assets';
import { SLOW_PREVIEW_CELLS, SLOW_PREVIEW_MS, estimatedCells, estimatedNodes } from './patternToolStore';
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
  /** Se presente compare la casella "Anteprima semplificata" (solo nel pannello dello strumento). */
  onSimplified?: (simplified: boolean) => void;
  simplified?: boolean;
  /** Se presente compare "Aggiorna all'ingombro": ricalcola l'area del disegno sulle misure attuali del pezzo. */
  onRefreshBounds?: () => void;
  /** Se presente «Aggiorna all'ingombro» è spento e questo testo spiega perché. */
  refreshBlocked?: string;
}

const KIND_LABELS: Record<PatternParams['kind'], string> = { voronoi: 'Voronoi', hexagon: 'Esagoni', circle: 'Cerchi', diamond: 'Rombi', triangle: 'Triangoli', brick: 'Mattoni', studs: 'Borchie', hammered: 'Rame battuto', wood: 'Legno', texture: 'Immagine (sperimentale)' };
/** Tipi a celle e tipi in rilievo: due gruppi della tendina. */
const CELL_KINDS: PatternParams['kind'][] = ['voronoi', 'hexagon', 'circle', 'diamond', 'triangle'];
const RELIEF_KINDS: PatternParams['kind'][] = ['brick', 'studs', 'hammered', 'wood', 'texture'];
/** Disegni di ogni rilievo: muratura dei Mattoni, forma delle Borchie, lavorazione del Rame, composizione del Legno. */
const DESIGN_LABELS: Record<ReliefDesign, string> = { running: 'Sfalsati', herringbone: 'Spina di pesce', basket: 'Cesto', dome: 'Cupola', chamfered: 'Cilindro smussato', pyramid: 'Piramide', dimples: 'Martellato', facets: 'Sfaccettato', scales: 'Scaglie', planks: 'Doghe', parquet: 'Parquet (spina di pesce)', single: 'Tavola unica' };
const DESIGNS_OF: Record<'brick' | 'studs' | 'hammered' | 'wood', ReliefDesign[]> = { brick: ['running', 'herringbone', 'basket'] as BrickDesign[], studs: ['dome', 'chamfered', 'pyramid'] as StudShape[], hammered: ['dimples', 'facets', 'scales'], wood: ['planks', 'parquet', 'single'] };
/** Spiegazione della tendina «Disegno» di ogni rilievo. */
const DESIGN_TIPS: Record<'brick' | 'studs' | 'hammered' | 'wood', string> = {
  brick: "Sfalsati: file sfalsate di mezzo mattone. Spina di pesce e Cesto: la lunghezza del mattone si arrotonda a un multiplo dell'altezza (fuga compresa) perché il disegno si chiuda.",
  studs: 'Forma della borchia: cupola, cilindro con smusso o piramide a base quadrata (lato = diametro).',
  hammered: 'Martellato: una calotta per cella di Voronoi. Sfaccettato: una faccetta piana inclinata per cella. Scaglie: file sfalsate di calotte ovali che si sovrappongono.',
  wood: 'Doghe: file di doghe affiancate con venatura. Parquet: spina di pesce di listelli (la lunghezza si arrotonda a un multiplo della larghezza, fuga compresa). Tavola unica: venatura lunga con 2-4 nodi, senza fughe.',
};
/** Cosa fare quando il calcolo è lento, per tipo. */
const SLOW_TIPS: Record<PatternParams['kind'], string> = {
  voronoi: 'Riduci celle o facce, oppure aumenta il passo.',
  hexagon: 'Riduci celle o facce, oppure aumenta il passo.',
  circle: 'Riduci celle o facce, oppure aumenta il passo.',
  diamond: 'Riduci celle o facce, oppure aumenta il passo.',
  triangle: 'Riduci celle o facce, oppure aumenta il passo.',
  brick: 'Aumenta le misure del mattone o riduci le facce.',
  studs: 'Aumenta il passo o il raggio delle borchie, oppure riduci le facce.',
  hammered: 'Aumenta il diametro o riduci le facce.',
  wood: 'Aumenta la larghezza della doga o metti a 0 la venatura, oppure riduci le facce.',
  texture: 'Riduci la faccia o le facce, oppure scegli una texture meno fitta (la mappa ha un nodo ogni 0,5 mm).',
};
/** Sotto questa parete (circa due passate di un ugello da 0,4 mm) la stampa è inaffidabile. */
const MIN_PRINTABLE_WALL = 0.8;

/**
 * Campi di un Pattern: tipo, seme, celle, parete, margine, faccia e profondità. Li usano il pannello dello strumento
 * Pattern (con anteprima dal vivo) e il pannello delle proprietà del gruppo "Pattern" già creato.
 */
export function PatternFields({ params: p, onChange, disabled, history = true, onPickFace, picking, onSimplified, simplified, onRefreshBounds, refreshBlocked }: Props) {
  const ms = useResultStore((s) => s.ms);
  // «Immagine» è una funzione sperimentale: nella tendina compare solo se accesa nelle Impostazioni, o se il Pattern la usa già
  const experimentalTexture = useUiStore((s) => s.experimentalTexture);
  const reliefKinds = RELIEF_KINDS.filter((k) => k !== 'texture' || experimentalTexture || p.kind === 'texture');
  // Id per collegare l'etichetta "Tipo" alla tendina
  const kindId = useId();
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
  // Rilievo (Mattoni o Borchie): disegno e misure, con i valori di partenza per ciò che manca
  const relief = isReliefKind(p.kind);
  const effective = patternRelief(p);
  const designId = useId();
  // Le fughe non possono attraversare il pezzo (con due facce opposte lo spessore si divide)
  const depthLimit = reliefDepthLimit(p);
  // Rame: ogni cella scende fino a profondità · (1 + variazione); Legno, tavola unica: i nodi fino a 2 volte la venatura
  const hammeredLimit = hammeredDepthLimit(p, effective.relief.kind === 'hammered' ? effective.relief.jitter : 0);
  const grainLimit = woodGrainLimit(p, effective.design);
  /** Salva una misura del rilievo: parte dai parametri salvati (non da quelli con il limite di spessore) e non ripete il disegno. */
  const setRelief = (patch: Record<string, number | string>) => onChange({ relief: { ...reliefToStore(p), ...patch } as ReliefParams });
  /** Slider di una misura del rilievo: modifica `relief` e non un campo del Pattern. */
  const reliefSlider = (label: string, tip: string, key: string, range: { min: number; max: number; step: number; hardMin?: number; hardMax?: number; unit?: string }) => (
    <SliderField label={label} tooltip={tip} value={(effective.relief as unknown as Record<string, number>)[key]} disabled={disabled} history={history} onCommit={(v) => setRelief({ [key]: v })} {...range} />
  );
  const slider = (label: string, tip: string, key: 'cells' | 'regularity' | 'size' | 'angle' | 'wall' | 'rounding' | 'margin' | 'depth', range: { min: number; max: number; step: number; hardMin?: number; hardMax?: number; unit?: string }) => (
    <SliderField label={label} tooltip={tip} value={p[key]} disabled={disabled} history={history} onCommit={(v) => onChange({ [key]: v })} {...range} />
  );

  const partial = p.depth > 0;
  // Il taglio parte da una sola faccia (i progetti vecchi possono averne più di una)
  const faceLabel = p.faces.length === 1 ? faceName(p.faces[0]) : `${p.faces.length} facce`;
  // Con una faccia inclinata il taglio parte solo da quella (niente faccia opposta)
  const bothSides = p.faces.every(isAxisFace);
  const slow = ms > SLOW_PREVIEW_MS || estimatedCells(p) > SLOW_PREVIEW_CELLS;

  return (
    <div className="array-fields">
      {/* Il tipo è una tendina: cinque scelte non stanno bene in una riga di pulsanti */}
      <div className="array-fields__row" title="Voronoi: celle casuali riproducibili dal seme; Esagoni, Cerchi, Rombi e Triangoli: griglia regolare. Rilievo Mattoni: fughe scavate sulla faccia, senza forare.">
        <label className="array-fields__label" htmlFor={kindId}>Tipo</label>
        <select id={kindId} className="array-fields__select" value={p.kind} disabled={disabled} onChange={(e) => onChange({ kind: e.target.value as PatternParams['kind'] })}>
          <optgroup label="Celle">
            {CELL_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </optgroup>
          <optgroup label="Rilievo">
            {reliefKinds.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {p.kind === 'texture' && <TextureFields params={p} onChange={onChange} disabled={disabled} history={history} />}

      {relief && p.kind !== 'texture' && (
        <>
          <div className="array-fields__row" title={DESIGN_TIPS[p.kind as 'brick' | 'studs' | 'hammered' | 'wood']}>
            <label className="array-fields__label" htmlFor={designId}>Disegno</label>
            <select id={designId} className="array-fields__select" value={effective.design} disabled={disabled} onChange={(e) => onChange({ design: e.target.value as ReliefDesign })}>
              {DESIGNS_OF[p.kind as 'brick' | 'studs' | 'hammered' | 'wood'].map((d) => (
                <option key={d} value={d}>{DESIGN_LABELS[d]}</option>
              ))}
            </select>
          </div>
          {effective.relief.kind === 'brick' && (
            <>
              {reliefSlider('Larghezza mattone', 'Lunghezza del mattone, in mm (fuga esclusa).', 'brickW', { min: 8, max: 80, step: 0.5, hardMin: 2, unit: 'mm' })}
              {reliefSlider('Altezza mattone', 'Altezza del mattone, in mm (fuga esclusa).', 'brickH', { min: 4, max: 40, step: 0.5, hardMin: 2, unit: 'mm' })}
              {reliefSlider('Fuga', 'Spessore della fuga tra due mattoni, in mm.', 'mortar', { min: 0.4, max: 5, step: 0.1, hardMin: 0.2, unit: 'mm' })}
              {reliefSlider('Profondità fuga', "Quanto si scava la fuga sotto la faccia, in mm (al massimo lo spessore dell'ingombro del pezzo, meno 0,2 mm).", 'depth', { min: Math.min(0.2, depthLimit), max: Math.min(3, depthLimit), step: 0.1, hardMin: 0.05, hardMax: depthLimit, unit: 'mm' })}
            </>
          )}
          {effective.relief.kind === 'studs' && (
            <>
              {choice('Griglia', 'Quadrata: file allineate. Sfalsata: le file dispari spostate di mezzo passo.', effective.relief.layout ?? 'square', [['square', 'Quadrata'], ['staggered', 'Sfalsata']] as [StudLayout, string][], (layout) => setRelief({ layout }))}
              {reliefSlider('Passo', 'Distanza tra i centri di due borchie, in mm.', 'pitch', { min: 4, max: 40, step: 0.5, hardMin: 2, unit: 'mm' })}
              {reliefSlider('Raggio', 'Raggio della base, in mm (per la piramide, metà del lato).', 'radius', { min: 1, max: 10, step: 0.1, hardMin: 0.5, unit: 'mm' })}
              {reliefSlider('Altezza', 'Quanto sporge la borchia dalla faccia, in mm. La cupola non supera il suo raggio.', 'height', { min: 0.4, max: 6, step: 0.1, hardMin: 0.2, unit: 'mm' })}
              {effective.design === 'chamfered' && reliefSlider('Smusso', 'Smusso a 45 gradi del bordo del cilindro, in mm.', 'chamfer', { min: 0, max: 3, step: 0.1, hardMin: 0, unit: 'mm' })}
            </>
          )}
          {(effective.relief.kind === 'hammered' || effective.relief.kind === 'wood') && (
            <div className="array-fields__row" title="Il seme decide il disegno: lo stesso seme dà sempre lo stesso risultato, anche nel codice OpenSCAD.">
              <span className="array-fields__label">Seme</span>
              <div className="array-fields__vector">
                <NumberField label="Seme" value={effective.relief.seed} min={0} max={2 ** 31} step={1} disabled={disabled} onCommit={(seed) => setRelief({ seed })} />
                <button type="button" className="array-fields__button" disabled={disabled} onClick={() => setRelief({ seed: Math.floor(Math.random() * 100000) })}>
                  Nuovo seme
                </button>
              </div>
            </div>
          )}
          {effective.relief.kind === 'hammered' && (
            <>
              {reliefSlider('Diametro', 'Diametro medio di una martellata, di una faccetta o di una scaglia, in mm (al massimo 500 celle: oltre si allargano).', 'size', { min: 3, max: 30, step: 0.5, hardMin: 2, unit: 'mm' })}
              {reliefSlider('Profondità', "Quanto si scava il rame sotto la faccia, in mm; con la variazione le celle più profonde arrivano a profondità × (1 + variazione), e il tutto non supera lo spessore dell'ingombro del pezzo meno 0,2 mm.", 'depth', { min: Math.min(0.1, hammeredLimit), max: Math.min(2, hammeredLimit), step: 0.05, hardMin: 0.05, hardMax: hammeredLimit, unit: 'mm' })}
              {reliefSlider('Variazione', 'Quanto variano a caso profondità e raggio di ogni cella (0 = tutte uguali, 0,9 = molto diverse).', 'jitter', { min: 0, max: 0.9, step: 0.05, hardMin: 0, hardMax: 0.9 })}
              {effective.design !== 'scales' && reliefSlider('Regolarità', '0 = celle del tutto casuali, 100 = celle quasi uniformi.', 'regularity', { min: 0, max: 100, step: 1, hardMin: 0, hardMax: 100, unit: '%' })}
            </>
          )}
          {effective.relief.kind === 'wood' && (
            <>
              {effective.design !== 'single' && reliefSlider(effective.design === 'parquet' ? 'Larghezza listello' : 'Larghezza doga', 'Larghezza di una doga o di un listello, in mm (fuga esclusa).', 'plankW', { min: 4, max: 30, step: 0.5, hardMin: 2, unit: 'mm' })}
              {effective.design !== 'single' && reliefSlider(effective.design === 'parquet' ? 'Lunghezza listello' : 'Lunghezza doga', 'Lunghezza media di una doga o di un listello, in mm.', 'plankL', { min: 20, max: 120, step: 1, hardMin: 5, unit: 'mm' })}
              {effective.design !== 'single' && reliefSlider('Fuga', 'Spessore della fuga tra due doghe o listelli, in mm.', 'gap', { min: 0.4, max: 3, step: 0.1, hardMin: 0.2, unit: 'mm' })}
              {effective.design !== 'single' && reliefSlider('Profondità fuga', "Quanto si scava la fuga sotto la faccia, in mm (al massimo lo spessore dell'ingombro del pezzo, meno 0,2 mm).", 'gapDepth', { min: Math.min(0.2, depthLimit), max: Math.min(3, depthLimit), step: 0.1, hardMin: 0.05, hardMax: depthLimit, unit: 'mm' })}
              {reliefSlider('Venatura', 'Profondità massima della venatura, in mm (0 = nessuna); sotto 0,3 mm si vede appena in stampa.', 'grainDepth', { min: 0, max: Math.min(1.5, grainLimit), step: 0.05, hardMin: 0, hardMax: grainLimit, unit: 'mm' })}
              {reliefSlider('Anelli', 'Distanza media tra gli anelli della venatura, in mm.', 'ringSpacing', { min: 1, max: 10, step: 0.5, hardMin: 0.5, unit: 'mm' })}
            </>
          )}
        </>
      )}

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
      {p.kind !== 'voronoi' && !relief && (
        <>
          {slider('Passo', 'Distanza tra i centri di due celle, in mm.', 'size', { min: 4, max: 60, step: 0.5, hardMin: 2, unit: 'mm' })}
          {slider('Rotazione', 'Rotazione della griglia, in gradi.', 'angle', { min: 0, max: 90, step: 1, hardMin: -360, hardMax: 360, unit: '°' })}
        </>
      )}

      {!relief && choice('Modo', 'Fori: si tolgono le celle e restano le pareti. Solchi: si tolgono le pareti e restano le celle in rilievo.', p.mode, [['holes', 'Fori'], ['grooves', 'Solchi']], (mode) => onChange({ mode }))}
      {!relief && slider('Parete', 'Spessore della parete tra due celle, in mm.', 'wall', { min: 0.4, max: 6, step: 0.1, hardMin: 0.1, unit: 'mm' })}
      {!relief && slider('Arrotondamento', 'Raggio degli angoli delle celle, in mm.', 'rounding', { min: 0, max: 5, step: 0.1, hardMin: 0, unit: 'mm' })}
      {slider('Margine', 'Cornice piena che resta attorno al disegno, in mm.', 'margin', { min: 0, max: 20, step: 0.5, hardMin: 0, unit: 'mm' })}

      <div className="array-fields__row" title="Faccia da cui parte il taglio. Per forare altre facce applica di nuovo il Pattern.">
        <span className="array-fields__label">Faccia</span>
        <span>{faceLabel}</span>
        {onPickFace && (
          <button type="button" className={`array-fields__button${picking ? ' is-active' : ''}`} aria-pressed={picking} disabled={disabled} onClick={onPickFace} title="Poi clicca una faccia piana dell'oggetto, anche inclinata.">
            {picking ? 'Fine scelta' : 'Scegli faccia'}
          </button>
        )}
      </div>
      {picking && (
        <p className="array-fields__total" role="status">
          Clicca la faccia da forare (Esc per finire).
        </p>
      )}

      {!relief && slider('Profondità', 'Quanto entra il taglio dalla faccia, in mm. 0 = passante.', 'depth', { min: 0, max: Math.max(1, Math.round(Math.max(...p.faces.map((f) => f.thickness)))), step: 0.1, hardMin: 0, unit: 'mm' })}
      {!relief && partial && bothSides && choice('Lati', 'Il taglio parte dalla sola faccia scelta oppure anche da quella opposta, con la stessa profondità.', p.sides, [['one', 'Una faccia'], ['both', 'Entrambe']], (sides) => onChange({ sides }))}
      {!relief && p.wall < MIN_PRINTABLE_WALL && <p className="array-fields__total" role="status">Parete sotto {MIN_PRINTABLE_WALL} mm: difficile da stampare.</p>}
      {reliefWarnings(p, getImage).map((text) => (
        <p key={text} className="array-fields__total" role="status">{text}</p>
      ))}

      {slow && (
        <p className="array-fields__total array-fields__warning" role="alert">
          {ms > SLOW_PREVIEW_MS ? `Calcolo lento (${Math.round(ms)} ms).` : p.kind === 'wood' || p.kind === 'texture' ? `Mappa di altezze grande (circa ${estimatedNodes(p)} nodi): il calcolo può essere lento.` : `Molte celle (circa ${estimatedCells(p)}): il calcolo può essere lento.`} {SLOW_TIPS[p.kind]}
        </p>
      )}
      {onSimplified && !relief && (
        <label className="array-fields__row array-fields__check" title="Durante l'anteprima gli angoli arrotondati hanno meno segmenti: il calcolo è più veloce. Il risultato dopo l'OK è sempre a qualità piena.">
          <span className="array-fields__label">Anteprima semplificata</span>
          <input type="checkbox" checked={!!simplified} onChange={(e) => onSimplified(e.target.checked)} />
        </label>
      )}

      {onRefreshBounds && (
        <div className="array-fields__row" title={refreshBlocked ?? "Il disegno copre l'ingombro che il pezzo aveva quando è stato applicato: se il pezzo è cambiato, ricalcolalo."}>
          <span className="array-fields__label" />
          <button type="button" className="array-fields__button" disabled={disabled || !!refreshBlocked} onClick={onRefreshBounds}>
            Aggiorna all'ingombro
          </button>
        </div>
      )}
    </div>
  );
}
