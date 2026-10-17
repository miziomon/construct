import { PLAN_LIMITS } from '../../scene/planShape';
import type { PlanDraft, PlanKind, PlanSym } from '../../scene/planShape';
import type { PathContour, PathNode } from '../../scene/types';
import { SliderField } from '../SliderField/SliderField';
import type { GridSettings } from './DrawingCanvas';
import type { NodeRef } from './model';
import { GridSection, NodeSection, SectionControl } from './Sidebar';
import type { SectionProps } from './Sidebar';

/** Misure della sagoma e della sezione, già calcolate da chi disegna. */
export interface PlanMeasures {
  width: number;
  depth: number;
  rmax: number;
  /** Fattore con cui il profilo è stato scalato in X (1 se è la sagoma ad adattarsi). */
  k: number;
  zs: number;
  wall: { min: number; max: number; nominal: number } | null;
}

interface Props {
  plan: PlanDraft;
  paths: PathContour[];
  selection: NodeRef[];
  grid: GridSettings;
  measures: PlanMeasures | null;
  onKind: (kind: PlanKind) => void;
  onPreset: (name: 'circle' | 'squircle' | 'hex' | 'star' | 'oval') => void;
  /** Cursori: `live` durante il trascinamento (il passo lo chiude la modale al rilascio). */
  onPatch: (patch: Partial<PlanDraft>, mode?: 'live' | 'commit') => void;
  onSym: (sym: PlanSym) => void;
  onToParams: () => void;
  onReset: () => void;
  onNodeKind: (kind: PathNode['kind']) => void;
  onCoordinate: (axis: 0 | 1, value: number) => void;
  onHandle: (side: 'in' | 'out', length: number, angle: number) => void;
  onGrid: (patch: Partial<GridSettings>) => void;
  section: SectionProps | null;
}

const KINDS: [PlanKind, string][] = [
  ['circle', 'Cerchio'],
  ['polygon', 'Poligono'],
  ['rect', 'Rettangolo'],
  ['star', 'Stella'],
  ['free', 'Libera'],
];
const PRESETS: ['circle' | 'squircle' | 'hex' | 'star' | 'oval', string][] = [
  ['circle', 'Cerchio'],
  ['squircle', 'Squircle'],
  ['hex', 'Esagono'],
  ['star', 'Stella'],
  ['oval', 'Ovale'],
];
const SYMS: [PlanSym, string][] = [
  ['none', 'Nessuna: contorno intero'],
  ['v', 'Verticale: metà destra e sinistra'],
  ['h', 'Orizzontale: metà alta e bassa'],
  ['q', 'Quattro quarti'],
];

const comma = (n: number, d = 2) => n.toFixed(d).replace('.', ',');

/** Colonna di destra con la sagoma attiva: forma, simmetria, modello e adattamento, punto selezionato, misure, griglia. */
export function PlanSidebar({ plan, paths, selection, grid, measures, onKind, onPreset, onPatch, onSym, onToParams, onReset, onNodeKind, onCoordinate, onHandle, onGrid, section }: Props) {
  const free = plan.kind === 'free';
  const corners = plan.kind === 'polygon' || plan.kind === 'rect' || plan.kind === 'star';
  const live = (key: keyof PlanDraft) => (v: number) => onPatch({ [key]: v } as Partial<PlanDraft>, 'live');
  const L = PLAN_LIMITS;

  return (
    <aside className="profile-editor__sidebar" aria-label="Opzioni della sagoma">
      <section className="profile-editor__section">
        <h3 className="profile-editor__section-title">Forma</h3>
        <div className="profile-editor__segmented profile-editor__segmented--wrap" role="group" aria-label="Forma della sagoma">
          {KINDS.map(([kind, label]) => (
            <button key={kind} type="button" aria-pressed={plan.kind === kind} onClick={() => onKind(kind)}>
              {label}
            </button>
          ))}
        </div>
        <div className="profile-editor__minirow" role="group" aria-label="Forme pronte">
          {PRESETS.map(([name, label]) => (
            <button key={name} type="button" className="profile-editor__mini" onClick={() => onPreset(name)}>
              {label}
            </button>
          ))}
        </div>
        {free ? (
          <p className="profile-editor__hint">Forma libera: sposta i nodi con Seleziona, aggiungine con la Penna sulla curva. La forma resta sempre chiusa.</p>
        ) : (
          <>
            {(plan.kind === 'polygon' || plan.kind === 'star') && (
              <SliderField label={plan.kind === 'star' ? 'Punte' : 'Lati'} min={L.n[0]} max={L.n[1]} step={1} integer tooltip="Numero di lati del poligono o di punte della stella." history={false} value={plan.n} onCommit={live('n')} />
            )}
            {plan.kind === 'star' && <SliderField label="Rapporto interno" unit="%" min={20} max={95} step={1} tooltip="Raggio delle valli della stella rispetto a quello delle punte." history={false} value={Math.round(plan.ratio * 100)} onCommit={(v) => onPatch({ ratio: v / 100 }, 'live')} />}
            {(plan.kind === 'polygon' || plan.kind === 'star') && <SliderField label="Rotazione" unit="°" min={L.rot[0]} max={L.rot[1]} step={1} tooltip="Rotazione della forma attorno al centro." history={false} value={plan.rot} onCommit={live('rot')} />}
            {corners && (
              <>
                <SliderField label="Raggio angoli" unit="mm" min={0} max={30} step={0.5} hardMin={0} hardMax={L.cornerR[1]} tooltip="Raggio degli angoli esterni. Verso il centro del solido si riduce fino a diventare un angolo vivo." history={false} value={plan.cornerR} onCommit={live('cornerR')} />
                {plan.kind === 'star' && <SliderField label="Angoli interni" unit="mm" min={0} max={15} step={0.5} hardMin={0} hardMax={L.innerR[1]} tooltip="Raggio degli angoli interni (concavi) della stella. Verso il centro si allarga." history={false} value={plan.innerR} onCommit={live('innerR')} />}
                <div className="profile-editor__segmented" role="group" aria-label="Tipo di angolo">
                  {(['arc', 'smooth'] as const).map((t) => (
                    <button key={t} type="button" aria-pressed={plan.cornerType === t} title={t === 'arc' ? 'Angolo ad arco di cerchio' : 'Angolo continuo, come le icone di Apple'} onClick={() => onPatch({ cornerType: t }, 'commit')}>
                      {t === 'arc' ? 'Arco' : 'Continuo'}
                    </button>
                  ))}
                </div>
                {plan.cornerType === 'smooth' && <SliderField label="Morbidezza" unit="%" min={0} max={100} step={1} tooltip="Quanto la curva dell'angolo continuo si allunga lungo i lati." history={false} value={Math.round(plan.smooth * 100)} onCommit={(v) => onPatch({ smooth: v / 100 }, 'live')} />}
              </>
            )}
            <SliderField label="Scala X" unit="%" min={L.sx[0]} max={L.sx[1]} step={1} tooltip="Deforma la forma in larghezza, a parità di larghezza massima." history={false} value={plan.sx} onCommit={live('sx')} />
            <SliderField label="Scala Y" unit="%" min={L.sy[0]} max={L.sy[1]} step={1} tooltip="Deforma la forma in profondità." history={false} value={plan.sy} onCommit={live('sy')} />
          </>
        )}
        <div className="profile-editor__minirow">
          {free && plan.sym === 'none' && (
            <button type="button" className="profile-editor__mini" title="Torna alla forma parametrica da cui hai iniziato, con i suoi parametri" onClick={onToParams}>
              Torna ai parametri
            </button>
          )}
          <button type="button" className="profile-editor__mini" title="Riporta la sagoma al cerchio iniziale (modello e adattamento restano)" onClick={onReset}>
            Reset sagoma
          </button>
        </div>
        {free && plan.base !== 'circle' && plan.kind === 'free' && plan.sym === 'none' && <p className="profile-editor__hint">Partita da: {KINDS.find(([k]) => k === plan.base)?.[1].toLowerCase()}.</p>}
      </section>

      {section && (
        <section className="profile-editor__section">
          <h3 className="profile-editor__section-title">Sezione</h3>
          <SectionControl {...section} />
        </section>
      )}

      {free && (
        <section className="profile-editor__section">
          <h3 className="profile-editor__section-title">Simmetria</h3>
          <select className="profile-editor__select" aria-label="Simmetria della forma libera" value={plan.sym} onChange={(e) => onSym(e.target.value as PlanSym)}>
            {SYMS.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
          <p className="profile-editor__hint">{plan.sym === 'none' ? 'Con una simmetria, spostando un nodo si muovono anche i suoi speculari. Cambiarla ricampiona la forma in nodi lisci.' : 'Gli speculari seguono ogni modifica; i nodi sugli assi restano sugli assi.'}</p>
        </section>
      )}

      <section className="profile-editor__section">
        <h3 className="profile-editor__section-title">Modello e adattamento</h3>
        <div className="profile-editor__segmented" role="group" aria-label="Modello">
          {(['offset', 'scale'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={plan.model === m} onClick={() => onPatch({ model: m }, 'commit')}>
              {m === 'offset' ? 'Equidistante' : 'Omotetico'}
            </button>
          ))}
        </div>
        <p className="profile-editor__hint">{plan.model === 'offset' ? 'Ogni anello è la sagoma rientrata di R − x: pareti di spessore costante, angoli che diventano vivi verso il centro.' : 'Ogni anello è la sagoma ridotta in scala di x / R: gli angoli si stringono in proporzione e le pareti cambiano spessore.'}</p>
        <div className="profile-editor__segmented" role="group" aria-label="Adattamento">
          {(['planToProfile', 'profileToPlan'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={plan.fit === m} title={m === 'planToProfile' ? 'La larghezza massima della sagoma è il raggio massimo del profilo' : 'La sagoma ha la sua larghezza e il profilo si scala solo in X'} onClick={() => onPatch({ fit: m }, 'commit')}>
              {m === 'planToProfile' ? 'Sagoma segue profilo' : 'Profilo segue sagoma'}
            </button>
          ))}
        </div>
        {plan.fit === 'profileToPlan' ? (
          <SliderField label="Larghezza" unit="mm" min={L.planW[0]} max={140} step={1} hardMin={L.planW[0]} hardMax={L.planW[1]} tooltip="Larghezza massima della sagoma: il profilo si scala solo in X, non in altezza." history={false} value={plan.planW} onCommit={live('planW')} />
        ) : (
          <p className="profile-editor__hint">La larghezza massima della sagoma è il raggio massimo del profilo{measures ? `: ${comma(measures.rmax * 2, 1)} mm` : ''}.</p>
        )}
      </section>

      <NodeSection paths={paths} selection={selection} onKind={onNodeKind} onCoordinate={onCoordinate} onHandle={onHandle} />

      <section className="profile-editor__section">
        <h3 className="profile-editor__section-title">Misure</h3>
        {measures ? (
          <dl className="profile-editor__measures">
            <dt>Ingombro sagoma</dt>
            <dd>{comma(measures.width, 1)} × {comma(measures.depth, 1)} mm</dd>
            <dt>Quota di sezione</dt>
            <dd>{comma(measures.zs, 1)} mm</dd>
            {measures.k !== 1 && (
              <>
                <dt>Profilo scalato in X</dt>
                <dd>× {comma(measures.k)}</dd>
              </>
            )}
            {measures.wall && (
              <>
                <dt>Parete misurata</dt>
                <dd className="profile-editor__measure-wall" data-wall-min={measures.wall.min.toFixed(3)} data-wall-max={measures.wall.max.toFixed(3)}>
                  {Math.abs(measures.wall.max - measures.wall.min) < 0.05 ? `${comma(measures.wall.min)} mm` : `${comma(measures.wall.min)} – ${comma(measures.wall.max)} mm`}
                </dd>
                <dt>Parete nel profilo</dt>
                <dd>{comma(measures.wall.nominal)} mm</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="profile-editor__hint">Disegna prima il profilo.</p>
        )}
      </section>

      <GridSection grid={grid} onGrid={onGrid} />
    </aside>
  );
}
