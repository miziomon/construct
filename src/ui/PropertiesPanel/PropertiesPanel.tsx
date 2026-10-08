import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isAppGroup, isLocked, parentOf, useSceneStore } from '../../scene/store';
import { queueKeepBase } from '../../kernel/placement';
import { CORNER_ICONS, CORNER_NAMES, EDGE_ICONS, GROUP_ICONS, GROUP_NAMES } from '../groupIcons';
import { isCutter } from '../../scene/treatment';
import { FONTS, FONT_CATEGORIES, fontInfo } from '../../scene/fontCatalog';
import type { FontCategory, FontInfo } from '../../scene/fontCatalog';
import { Lock, Unlock } from 'lucide-react';
import { isPolygonShape, isRotational, RATIO_INFO, revolveParams } from '../../scene/shapes2d';
import { isRatioLocked, lockedPatch, scalePatch, scalePercent } from '../../scene/resize';
import { cornerSphere } from '../../scene/cornerProfile';
import { EDGE_SEGMENTS, maxFilletRadius } from '../../scene/edgeProfile';
import { CORNER_SPHERE_SEGMENTS, MAX_SEGMENTS, MIN_SEGMENTS, MIN_SPHERE_SEGMENTS, SEGMENT_PRESETS } from '../../scene/defaults';
import { isScaled, normalizeScale, scaleOf, setGroupScale } from '../../scene/groupScale';
import { round } from '../../scene/math';
import { bedReach, useBedReach, useUiStore } from '../uiStore';
import type { CornerNode, EdgeNode, GroupNode, MeshNode, PrimitiveNode, SceneNode, Shape2DNode, ShellParams, Vec3 } from '../../scene/types';
import { shellQuality } from '../../scene/shell';
import { NumberField } from '../NumberField/NumberField';
import { ArrayFields } from '../Array/ArrayFields';
import { useArrayTool } from '../Array/arrayToolStore';
import { PatternFields } from '../Pattern/PatternFields';
import { localBoundsOf, usePatternTool } from '../Pattern/patternToolStore';
import { SliderField } from '../SliderField/SliderField';
import { TIPS } from './tooltips';
import { maxPolyhedronRadius, polygonMaxRadius } from '../../scene/polyhedra';
import './PropertiesPanel.scss';

const AXES = ['X', 'Y', 'Z'] as const;

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="properties__section">
      <h3 className="properties__section-title">
        {icon}
        {title}
      </h3>
      <div className="properties__fields">{children}</div>
    </section>
  );
}

/** Pannello delle proprietà dell'oggetto selezionato. Con selezioni multiple mostra solo un riepilogo. */
export function PropertiesPanel() {
  const selection = useSceneStore((s) => s.selection);
  const node = useSceneStore((s) => (s.selection.length === 1 ? s.scene.nodes[s.selection[0]] : undefined));
  const inGroup = useSceneStore((s) => s.selection.length === 1 && !s.scene.rootIds.includes(s.selection[0]));
  const updateNode = useSceneStore((s) => s.updateNode);
  const cycleBase = useSceneStore((s) => s.cycleBase);
  const baseName = useSceneStore((s) => {
    const n = s.selection.length === 1 ? s.scene.nodes[s.selection[0]] : undefined;
    return n?.type === 'group' && n.op === 'difference' ? s.scene.nodes[n.children[0]]?.name : undefined;
  });
  // Figlio diretto di un Raggruppa: lì i fori non hanno effetto, quindi resta sempre un solido
  const inAppGroup = useSceneStore((s) => s.selection.length === 1 && isAppGroup(s.scene.nodes[parentOf(s.scene, s.selection[0]) ?? '']));
  // Bloccato lui o un gruppo che lo contiene
  const locked = useSceneStore((s) => s.selection.length === 1 && isLocked(s.scene, s.selection[0]));
  const arrayToolActive = useArrayTool((s) => s.active);
  const patternToolActive = usePatternTool((s) => s.active);
  // Metà piatto su X e Y: i cursori della posizione coprono tutto il piano
  const bedSize = useUiStore((s) => s.bedSize);
  const bedHalf = [bedSize.width / 2, bedSize.depth / 2];
  // Lato massimo del piano: è il limite morbido dei cursori delle misure e dell'altezza (il piano non ha un'altezza propria)
  const reach = bedReach(bedSize);

  if (selection.length === 0) return <p className="properties__empty">Seleziona un oggetto per modificarne le proprietà.</p>;
  if (!node) return <p className="properties__empty">{selection.length} oggetti selezionati. Ctrl+G li raggruppa (restano separati), U li unisce in un solo solido.</p>;

  const patch = (p: Partial<PrimitiveNode> | Partial<Shape2DNode> | Partial<MeshNode> | Partial<GroupNode> | Partial<EdgeNode> | Partial<CornerNode>) => {
    // Misure e rotazione cambiano l'ingombro: la base dell'oggetto resta dov'era (sul piatto o impilata). Lo spostamento no
    if (!('position' in p)) queueKeepBase(node.id);
    updateNode(node.id, p);
  };
  const setVec = (key: 'position' | 'rotation', i: number, v: number) => {
    const next = [...node[key]] as Vec3;
    next[i] = v;
    patch({ [key]: next });
  };

  return (
    <div className="properties">
      <Section
        title={node.type === 'group' ? GROUP_NAMES[node.op] : node.type === 'edge' ? (node.treatment === 'fillet' ? 'Raccordo' : 'Smusso') : node.type === 'corner' ? CORNER_NAMES[node.treatment] : 'Oggetto'}
        icon={
          node.type === 'group' || isCutter(node)
            ? (() => {
                const Icon = node.type === 'group' ? GROUP_ICONS[node.op] : node.type === 'corner' ? CORNER_ICONS[node.treatment] : EDGE_ICONS[node.treatment];
                return <Icon size={14} className="properties__section-icon" aria-hidden="true" />;
              })()
            : undefined
        }
      >
        <label className="properties__row">
          <span className="properties__label">Nome</span>
          <input className="properties__text" value={node.name} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        {!isCutter(node) && (
          <label className="properties__row">
            <span className="properties__label">Colore</span>
            <input className="properties__color" type="color" value={node.color} onChange={(e) => patch({ color: e.target.value })} />
          </label>
        )}
        <label className="properties__row">
          <span className="properties__label">Blocco</span>
          <input type="checkbox" className="properties__checkbox" checked={!!node.locked} onChange={(e) => patch({ locked: e.target.checked })} />
          <span className="properties__hint">{locked && !node.locked ? 'Bloccato dal gruppo' : 'Impedisce spostamenti e modifiche'}</span>
        </label>
        {!isCutter(node) && (
        <div className="properties__row">
          <span className="properties__label">Tipo</span>
          <div className="properties__segmented" role="group" aria-label="Solido o foro">
            {(['solid', 'hole'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`properties__segment${node.mode === mode ? ' properties__segment--active' : ''}${mode === 'hole' ? ' properties__segment--hole' : ''}`}
                aria-pressed={node.mode === mode}
                disabled={locked || (inAppGroup && mode === 'hole')}
                title={inAppGroup && mode === 'hole' ? 'I fori hanno effetto solo dentro Unione, Differenza o Intersezione' : undefined}
                onClick={() => patch({ mode })}
              >
                {mode === 'solid' ? 'Solido' : 'Foro'}
              </button>
            ))}
          </div>
        </div>
        )}
        {isAppGroup(node) && <p className="properties__note">Gli oggetti restano separati (colori e codice propri) e si muovono insieme. Per fonderli in un solo solido usa Unisci (U).</p>}
        {/* Il Guscio ha un solo figlio e le sue misure: non si può trasformare in un'altra booleana */}
        {node.type === 'group' && node.op !== 'group' && node.op !== 'shell' && node.op !== 'array' && node.op !== 'pattern' && (
          <div className="properties__row">
            <span className="properties__label">Operazione</span>
            <div className="properties__segmented properties__segmented--wrap" role="group" aria-label="Operazione del gruppo">
              {(['union', 'difference', 'intersection', 'hull', 'minkowski'] as const).map((op) => (
                <button key={op} type="button" className={`properties__segment${node.op === op ? ' properties__segment--active' : ''}`} aria-pressed={node.op === op} disabled={locked} onClick={() => patch({ op })}>
                  {op === 'union' ? 'Unione' : op === 'difference' ? 'Differenza' : op === 'intersection' ? 'Intersezione' : op === 'hull' ? 'Inviluppo' : 'Minkowski'}
                </button>
              ))}
            </div>
          </div>
        )}
        {node.type === 'group' && node.op === 'difference' && (
          <div className="properties__row">
            <span className="properties__label">Base</span>
            <span className="properties__value">{baseName}</span>
            <button type="button" className="properties__action" disabled={locked} onClick={() => cycleBase(node.id)} title="Il figlio successivo diventa la base">
              Scambia base
            </button>
          </div>
        )}
      </Section>

      {!isCutter(node) && (
      <>
      <Section title={inGroup ? 'Posizione (relativa al gruppo)' : 'Posizione'}>
        {AXES.map((a, i) => (
          <SliderField
            key={a}
            label={a}
            unit="mm"
            min={i === 2 ? -50 : -bedHalf[i]}
            max={i === 2 ? reach : bedHalf[i]}
            tooltip={[TIPS.posX, TIPS.posY, TIPS.posZ][i]}
            disabled={locked}
            value={node.position[i]}
            onCommit={(v) => setVec('position', i, v)}
          />
        ))}
      </Section>

      <Section title="Rotazione">
        {AXES.map((a, i) => (
          <SliderField
            key={a}
            label={a}
            unit="°"
            min={-180}
            max={180}
            tooltip={[TIPS.rotX, TIPS.rotY, TIPS.rotZ][i]}
            disabled={locked}
            value={node.rotation[i]}
            onCommit={(v) => setVec('rotation', i, v)}
          />
        ))}
      </Section>

      </>
      )}

      {node.type === 'edge' && <EdgeFields node={node} patch={patch} locked={locked} />}
      {node.type === 'corner' && <CornerFields node={node} patch={patch} locked={locked} />}
      {/* Con lo strumento Serie aperto gli stessi campi sono già nel suo pannello */}
      {node.type === 'group' && <GroupScaleFields node={node} patch={patch} locked={locked} />}
      {node.type === 'group' && node.op === 'array' && node.array && !arrayToolActive && (
        <Section title="Ripetizione">
          <ArrayFields params={node.array} disabled={locked} onChange={(change) => patch({ array: { ...node.array!, ...change } })} />
        </Section>
      )}
      {node.type === 'group' && node.op === 'pattern' && node.pattern && !patternToolActive && (
        <Section title="Pattern">
          <PatternFields
            params={node.pattern}
            disabled={locked}
            onChange={(change) => patch({ pattern: { ...node.pattern!, ...change } })}
            onRefreshBounds={() => {
              // Ingombro attuale del pezzo (figlio) nel sistema del gruppo: il disegno si estende a tutta la nuova area
              const bounds = localBoundsOf(useSceneStore.getState().scene, node.children[0]);
              if (bounds) patch({ pattern: { ...node.pattern!, bounds } });
            }}
          />
        </Section>
      )}
      {node.type === 'group' && node.op === 'shell' && node.shell && <ShellFields node={node} shell={node.shell} patch={patch} locked={locked} />}
      {node.type === 'primitive' && <PrimitiveFields node={node} patch={patch} locked={locked} />}
      {node.type === 'mesh' && (
        <Section title="Mesh importata">
          <div className="properties__row">
            <span className="properties__label">File</span>
            <span className="properties__value" title={node.fileName}>{node.fileName}</span>
          </div>
          <div className="properties__row">
            <span className="properties__label">Triangoli</span>
            <span className="properties__value">{node.triangles.toLocaleString('it-IT')}</span>
          </div>
          <NumberField label="⇱" unit="%" min={0.1} max={100000} step={10} disabled={locked} value={Math.round(node.scale * 10000) / 100} onCommit={(v) => patch({ scale: v / 100 })} />
        </Section>
      )}
      {node.type === 'shape2d' && <Shape2DFields node={node} patch={patch} locked={locked} />}
    </div>
  );
}

/** Spessori di un Guscio già creato, modificabili dal vivo (stessi limiti del pannello dello strumento). */
function ShellFields({ node, shell, patch, locked }: { node: GroupNode; shell: ShellParams; patch: (p: Partial<GroupNode>) => void; locked: boolean }) {
  const { wall, bottom } = shell;
  const reach = useBedReach();
  const child = useSceneStore((s) => s.scene.nodes[node.children[0]]);
  // Senza cavità esatta (sfera, toro, mesh...) le pareti sono approssimate: lo si dice
  const quality = useSceneStore((s) => (child ? shellQuality(s.scene, child) : undefined));
  return (
    <Section title="Guscio">
      {quality === 'scaled' && <p className="properties__note">Pareti approssimate: la cavità è l'oggetto rimpicciolito, lo spessore è esatto solo nei punti estremi.</p>}
      {quality === 'parts' && <p className="properties__note">Ogni solido ha la sua cavità: tra un solido e l'altro resta una parete interna.</p>}
      <SliderField
        label="Laterale"
        unit="mm"
        min={0.1}
        max={20}
        step={0.1}
        hardMin={0.1}
        hardMax={reach}
        tooltip="Spessore delle pareti laterali, in mm."
        disabled={locked}
        value={wall}
        onCommit={(v) => patch({ shell: { ...shell, wall: v } })}
      />
      <SliderField
        label="Inferiore"
        unit="mm"
        min={0}
        max={20}
        step={0.1}
        hardMin={0}
        hardMax={reach}
        tooltip="Spessore del fondo, in mm. La cima resta sempre aperta."
        disabled={locked}
        value={bottom}
        onCommit={(v) => patch({ shell: { ...shell, bottom: v } })}
      />
    </Section>
  );
}

/** Misure di uno smusso angolare già creato: tipo, distanza e, per lo sferico, i segmenti, modificabili dal vivo. */
function CornerFields({ node, patch, locked }: { node: CornerNode; patch: (p: Partial<CornerNode>) => void; locked: boolean }) {
  const maxDistance = Math.max(0.2, Math.round(Math.min(...node.lengths) * 100) / 100);
  const sphere = node.treatment === 'fillet' ? cornerSphere(node.directions, Math.min(node.distance, ...node.lengths)) : null;
  return (
    <Section title="Misure">
      <p className="properties__note">
        Angolo con {node.directions.length} spigoli{sphere ? `, raggio della sfera ${Math.round(sphere.radius * 100) / 100} mm` : ''}.
      </p>
      <div className="properties__row">
        <span className="properties__label">Tipo</span>
        <div className="properties__segmented" role="group" aria-label="Tipo di smusso angolare">
          {(['chamfer', 'fillet'] as const).map((treatment) => (
            <button
              key={treatment}
              type="button"
              className={`properties__segment${node.treatment === treatment ? ' properties__segment--active' : ''}`}
              aria-pressed={node.treatment === treatment}
              disabled={locked}
              onClick={() => patch({ treatment })}
            >
              {treatment === 'chamfer' ? 'Piano' : 'Sferico'}
            </button>
          ))}
        </div>
      </div>
      <SliderField
        label="Distanza"
        unit="mm"
        min={0.1}
        max={maxDistance}
        step={0.1}
        hardMin={0.01}
        hardMax={maxDistance}
        tooltip="Distanza dal vertice, lungo ogni spigolo, dove il taglio incontra lo spigolo, in mm."
        disabled={locked}
        value={node.distance}
        onCommit={(v) => patch({ distance: v })}
      />
      {node.treatment === 'fillet' && (
        <SliderField
          label="Segmenti"
          min={MIN_SPHERE_SEGMENTS}
          max={MAX_SEGMENTS}
          step={4}
          hardMin={MIN_SPHERE_SEGMENTS}
          hardMax={MAX_SEGMENTS}
          tooltip="Risoluzione della calotta, come per la sfera. Sono sempre multipli di 4."
          disabled={locked}
          value={node.segments ?? CORNER_SPHERE_SEGMENTS}
          onCommit={(v) => patch({ segments: Math.max(MIN_SPHERE_SEGMENTS, Math.round(v / 4) * 4) })}
        />
      )}
    </Section>
  );
}

/** Misure di un raccordo o di uno smusso già creato: stesse del pannello dello strumento, modificabili dal vivo. */
function EdgeFields({ node, patch, locked }: { node: EdgeNode; patch: (p: Partial<EdgeNode>) => void; locked: boolean }) {
  const limit = (max: number) => Math.max(0.2, Math.round(max * 100) / 100);
  return (
    <Section title="Misure">
      <p className="properties__note">
        {node.convex ? 'Spigolo convesso' : 'Spigolo concavo'}, apertura {Math.round(node.angle * 10) / 10}°, lunghezza {Math.round(node.length * 100) / 100} mm.
      </p>
      {node.treatment === 'fillet' ? (
        <>
          <SliderField
            label="Raggio"
            unit="mm"
            min={0.1}
            max={limit(maxFilletRadius(node))}
            step={0.1}
            hardMin={0.01}
            hardMax={limit(maxFilletRadius(node))}
            tooltip="Raggio del raccordo, in mm. Il massimo dipende dalla larghezza delle due superfici."
            disabled={locked}
            value={node.radius}
            onCommit={(v) => patch({ radius: v })}
          />
          {/* Scene salvate prima della 0.9.0 non hanno il campo: valgono 64 segmenti */}
          <SliderField
            label="Segmenti"
            min={MIN_SEGMENTS}
            max={MAX_SEGMENTS}
            step={1}
            hardMin={MIN_SEGMENTS}
            hardMax={MAX_SEGMENTS}
            tooltip="Risoluzione del raccordo, come per i cerchi. Conta il cerchio intero: pochi segmenti danno un arrotondamento a sfaccettature."
            disabled={locked}
            value={node.segments ?? EDGE_SEGMENTS}
            onCommit={(v) => patch({ segments: Math.round(v) })}
          />
        </>
      ) : (
        <>
          <SliderField
            label="Distanza 1"
            unit="mm"
            min={0.1}
            max={limit(node.reach)}
            step={0.1}
            hardMin={0.01}
            hardMax={limit(node.reach)}
            tooltip="Distanza dello smusso dallo spigolo lungo la prima superficie, in mm."
            disabled={locked}
            value={node.distance1}
            onCommit={(v) => patch({ distance1: v })}
          />
          <SliderField
            label="Distanza 2"
            unit="mm"
            min={0.1}
            max={limit(node.reach)}
            step={0.1}
            hardMin={0.01}
            hardMax={limit(node.reach)}
            tooltip="Distanza dello smusso dallo spigolo lungo la seconda superficie, in mm."
            disabled={locked}
            value={node.distance2}
            onCommit={(v) => patch({ distance2: v })}
          />
        </>
      )}
    </Section>
  );
}

/**
 * Ridimensionamento di un gruppo di qualsiasi tipo: scala per asse in percentuale, applicata a tutto il contenuto
 * (come il gizmo di Ridimensiona, R). Il centro della base dell'ingombro resta fermo.
 */
function GroupScaleFields({ node, patch, locked }: { node: GroupNode; patch: (p: Partial<GroupNode>) => void; locked: boolean }) {
  const scale = scaleOf(node);
  const apply = (next: Vec3) => {
    // Ingombro attuale (già scalato) dal calcolo del kernel; senza mesh si cambia solo la scala
    const box = localBoundsOf(useSceneStore.getState().scene, node.id);
    const result = box ? setGroupScale(node, box, next) : { scale: normalizeScale(next), position: node.position };
    patch({ groupScale: result.scale, position: result.position });
  };
  return (
    <Section title="Dimensioni del gruppo">
      <p className="properties__note">Scala per asse applicata a tutto il contenuto, come con Ridimensiona (R). Il centro della base resta fermo.</p>
      {AXES.map((axis, i) => (
        <NumberField
          key={axis}
          label={axis}
          unit="%"
          min={0.1}
          max={100000}
          step={1}
          disabled={locked}
          value={round(scale[i] * 100, 2)}
          onCommit={(v) => apply(scale.map((old, j) => (j === i ? v / 100 : old)) as Vec3)}
        />
      ))}
      {isScaled(node) && (
        <button type="button" className="properties__action" disabled={locked} onClick={() => apply([1, 1, 1])}>
          Ripristina 100%
        </button>
      )}
    </Section>
  );
}

/** Slider delle misure in mm: da 0,5 mm fino al lato maggiore del piano, con il campo numerico che accetta anche valori maggiori. */
const dimSlider = (reach: number) => ({ min: 0.5, max: reach, step: 0.5, hardMin: 0.1, hardMax: 2000, unit: 'mm' }) as const;

function PrimitiveFields({ node, patch, locked }: { node: Extract<SceneNode, { type: 'primitive' }>; patch: (p: Partial<PrimitiveNode>) => void; locked: boolean }) {
  const reach = useBedReach();
  const dimBase = dimSlider(reach);
  const dim = (label: string, value: number, key: string, tooltip: string, hardMin = 0.1, max: number = reach / 2) => (
    <SliderField
      key={key}
      label={label}
      {...dimBase}
      min={Math.max(hardMin, 0)}
      max={max}
      hardMin={hardMin}
      tooltip={tooltip}
      disabled={locked}
      value={value}
      onCommit={(v) => patch({ [key]: v } as Partial<PrimitiveNode>)}
    />
  );
  /** Raggio opzionale lungo Y o Z: se torna uguale a quello X la forma è di nuovo tonda e il campo si toglie. */
  const axisRadius = (label: string, value: number, base: number, key: 'radiusY' | 'radiusZ', tooltip: string) => (
    <SliderField
      key={key}
      label={label}
      {...dimBase}
      min={0.5}
      max={reach / 2}
      hardMin={0.1}
      tooltip={tooltip}
      disabled={locked}
      value={value}
      onCommit={(v) => patch({ [key]: Math.abs(v - base) < 1e-9 ? undefined : v } as Partial<PrimitiveNode>)}
    />
  );
  const segments = (value: number, sphere = false) => (
    <SegmentsControl
      key="segments"
      value={value}
      disabled={locked}
      sphere={sphere}
      onChange={(n) => patch({ segments: n } as Partial<PrimitiveNode>)}
    />
  );
  const rounding = (value: number, max: number) => (
    <SliderField
      key="rounding"
      label="Raccordo"
      unit="mm"
      min={0}
      max={Math.max(0.5, max)}
      step={0.5}
      hardMin={0}
      hardMax={Math.max(0, max)}
      tooltip={TIPS.rounding}
      disabled={locked}
      value={value}
      onCommit={(v) => patch({ cornerRadius: v } as Partial<PrimitiveNode>)}
    />
  );

  switch (node.kind) {
    case 'box': {
      const names = ['Larghezza', 'Profondità', 'Altezza'];
      const tips = [TIPS.boxSizeX, TIPS.boxSizeY, TIPS.boxSizeZ];
      return (
        <Section title="Dimensioni">
          {AXES.map((a, i) => (
            <SliderField
              key={a}
              label={names[i]}
              {...dimBase}
              tooltip={tips[i]}
              disabled={locked}
              value={node.size[i]}
              onCommit={(v) => {
                // Con il lucchetto chiuso anche gli altri lati scalano dello stesso fattore
                const coupled = isRatioLocked(node) ? lockedPatch(node, 'size', v, i) : null;
                if (coupled) return patch(coupled as Partial<PrimitiveNode>);
                const size = [...node.size] as Vec3;
                size[i] = v;
                patch({ size } as Partial<PrimitiveNode>);
              }}
            />
          ))}
          <ProportionControls node={node} patch={patch as (p: object) => void} locked={locked} />
          {rounding(node.cornerRadius ?? 0, Math.min(...node.size) / 2 - 0.01)}
        </Section>
      );
    }
    case 'cylinder':
      return (
        <Section title="Dimensioni">
          {[
            dim('Raggio X', node.radius, 'radius', TIPS.radiusX),
            axisRadius('Raggio Y', node.radiusY ?? node.radius, node.radius, 'radiusY', TIPS.radiusY),
            dim('Altezza', node.height, 'height', TIPS.height, 0.1, reach),
            segments(node.segments),
          ]}
        </Section>
      );
    case 'cone':
      return (
        <Section title="Dimensioni">
          {[
            axisRadius('Raggio Y', node.radiusY ?? Math.max(node.radiusBottom, node.radiusTop), Math.max(node.radiusBottom, node.radiusTop), 'radiusY', TIPS.radiusYCone),
            dim('Raggio ↓', node.radiusBottom, 'radiusBottom', TIPS.radiusBottom, 0),
            dim('Raggio ↑', node.radiusTop, 'radiusTop', TIPS.radiusTop, 0),
            dim('Altezza', node.height, 'height', TIPS.height, 0.1, reach),
            segments(node.segments),
          ]}
        </Section>
      );
    case 'sphere':
      return <Section title="Dimensioni">{[
            dim('Raggio X', node.radius, 'radius', TIPS.radiusX),
            axisRadius('Raggio Y', node.radiusY ?? node.radius, node.radius, 'radiusY', TIPS.radiusY),
            axisRadius('Raggio Z', node.radiusZ ?? node.radius, node.radius, 'radiusZ', TIPS.radiusZ),
            segments(node.segments, true),
          ]}</Section>;
    case 'torus':
      return (
        <Section title="Dimensioni">
          {[dim('Raggio', node.majorRadius, 'majorRadius', TIPS.majorRadius), dim('Tubo', node.minorRadius, 'minorRadius', TIPS.minorRadius), segments(node.segments)]}
        </Section>
      );
    case 'octahedron':
    case 'decahedron':
    case 'dodecahedron':
    case 'icosahedron':
      return (
        <Section title="Dimensioni">
          {[dim('Dimensione', node.size, 'size', TIPS.polySize, 0.1, reach), rounding(node.cornerRadius, maxPolyhedronRadius(node.size))]}
        </Section>
      );
  }
}

interface SegmentsControlProps {
  value: number;
  onChange: (segments: number) => void;
  disabled: boolean;
  /** La sfera geodetica accetta solo multipli di 4 e non ha poligoni regolari. */
  sphere?: boolean;
}

/**
 * Risoluzione delle curve, come $fn di OpenSCAD: pochi lati danno poligoni regolari
 * (3 triangolo, 6 esagono), molti lati un cerchio quasi liscio.
 */
function SegmentsControl({ value, onChange, disabled, sphere = false }: SegmentsControlProps) {
  return (
    <>
      {!sphere && (
        <div className="properties__row" title={TIPS.sides}>
          <span className="properties__label">Lati</span>
          <div className="properties__chips" role="group" aria-label="Numero di lati">
            {SEGMENT_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                title={p.title}
                disabled={disabled}
                aria-pressed={value === p.value}
                className={`properties__chip${value === p.value ? ' properties__chip--active' : ''}`}
                onClick={() => onChange(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="properties__row" title={TIPS.segments}>
        <span className="properties__label">Segmenti</span>
        <input
          className="properties__range"
          type="range"
          min={sphere ? MIN_SPHERE_SEGMENTS : MIN_SEGMENTS}
          max={MAX_SEGMENTS}
          step={sphere ? 4 : 1}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output className="properties__output">{value}</output>
      </label>
    </>
  );
}

/**
 * Campo di testo che modifica la scena solo alla conferma (Invio o uscita dal campo, Esc annulla): come NumberField,
 * ogni modifica è un solo passo di Annulla e un solo ricalcolo, non uno per lettera.
 */
function TextField({ label, tooltip, value, disabled, onCommit }: { label: string; tooltip: string; value: string; disabled: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  // Allinea la bozza al valore esterno (annulla, ripeti) quando non si sta scrivendo
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  // Esc annulla: la bozza si scarta senza confermarla all'uscita dal campo
  const cancelled = useRef(false);
  const commit = () => {
    if (!cancelled.current && draft !== value) onCommit(draft);
    cancelled.current = false;
  };
  return (
    <label className="properties__row" title={tooltip}>
      <span className="properties__label">{label}</span>
      <input
        className="properties__text"
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            cancelled.current = true;
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/** Campi di una forma 2D estrusa: profilo (cerchio, quadrato, forme poligonali o testo) più parametri di estrusione. */
/**
 * Lucchetto delle proporzioni e slider Scala di una forma: con il lucchetto chiuso le misure indipendenti (larghezza e
 * profondità, i lati del cubo, i due raggi) cambiano insieme; la Scala (100 % = misura iniziale della forma, o del file
 * per gli SVG) ridimensiona sempre in proporzione. Il testo ha solo la Scala.
 */
function ProportionControls({ node, patch, locked }: { node: PrimitiveNode | Shape2DNode; patch: (p: object) => void; locked: boolean }) {
  const ratioLocked = isRatioLocked(node);
  const hasLock = !(node.type === 'shape2d' && node.kind === 'text');
  return (
    <>
      {hasLock && (
        <div className="properties__row">
          <span className="properties__label">Proporzioni</span>
          <button
            type="button"
            className="properties__lock"
            aria-pressed={ratioLocked}
            disabled={locked}
            title={ratioLocked ? TIPS.ratioLocked : TIPS.ratioUnlocked}
            onClick={() => patch({ lockRatio: !ratioLocked })}
          >
            {ratioLocked ? <Lock size={14} /> : <Unlock size={14} />}
            {ratioLocked ? 'Bloccate' : 'Libere'}
          </button>
        </div>
      )}
      <SliderField
        label="Scala"
        unit="%"
        min={10}
        max={500}
        step={1}
        hardMin={1}
        hardMax={5000}
        tooltip={TIPS.scale}
        disabled={locked}
        value={Math.round(scalePercent(node))}
        onCommit={(v) => patch(scalePatch(node, v))}
      />
    </>
  );
}

/**
 * Font del menu Testo raggruppati per stile. I font di simboli (usati dalla tab Simboli) compaiono, in un gruppo a
 * parte, solo se sono quello del nodo: così il menu li mostra senza proporli come font di testo.
 */
function fontGroups(current: string): [FontCategory, FontInfo[]][] {
  const groups = FONT_CATEGORIES.map((c): [FontCategory, FontInfo[]] => [c, FONTS.filter((f) => f.category === c)]);
  const active = fontInfo(current);
  if (active.category === 'Simboli') groups.push(['Simboli', [active]]);
  return groups;
}

function Shape2DFields({ node, patch, locked }: { node: Shape2DNode; patch: (p: Partial<Shape2DNode>) => void; locked: boolean }) {
  const reach = useBedReach();
  const ratioLocked = isRatioLocked(node);
  /** Misura modificata: con il lucchetto chiuso le misure legate scalano dello stesso fattore, in un solo passo di Annulla. */
  const edit = (key: string, value: number) => patch((ratioLocked ? lockedPatch(node, key, value) : null) ?? ({ [key]: value } as Partial<Shape2DNode>));
  const slider = (label: string, value: number, key: string, tooltip: string, opts: { unit: string; min: number; max: number; step?: number; hardMin?: number; hardMax?: number }) => (
    <SliderField key={key} label={label} tooltip={tooltip} disabled={locked} value={value} onCommit={(v) => edit(key, v)} {...opts} />
  );
  const length = { unit: 'mm', min: 0.5, max: reach, step: 0.5, hardMin: 0.1, hardMax: 2000 };
  const rotational = isRotational(node);
  const revolve = revolveParams(node);
  /** Cambia il tipo di estrusione: al primo passaggio a Rotazionale scrive i valori calcolati (poi restano anche tornando a Lineare). */
  const setExtrusion = (kind: 'linear' | 'rotate') =>
    patch(
      (kind === 'rotate'
        ? { extrusion: 'rotate', revolveAngle: revolve.angle, revolveRadius: revolve.radius, revolveSegments: revolve.segments }
        : { extrusion: 'linear' }) as Partial<Shape2DNode>,
    );
  // Raggio massimo di arrotondamento: poco meno dell'inraggio del poligono, o di metà lato minore del quadrato
  const roundable = node.kind === 'circle' || node.kind === 'square';
  const maxRounding = node.kind === 'circle' ? polygonMaxRadius(node.radius, node.segments) : node.kind === 'square' ? Math.max(0, Math.min(node.width, node.depth) / 2 - 0.01) : 0;
  const rounding = roundable
    ? slider('Raccordo', node.cornerRadius ?? 0, 'cornerRadius', TIPS.rounding, {
        unit: 'mm',
        min: 0,
        max: Math.max(0.5, maxRounding),
        step: 0.5,
        hardMin: 0,
        hardMax: Math.max(0, maxRounding),
      })
    : null;
  // Forme poligonali: Larghezza, Profondità e (se la forma ne ha uno) il parametro con la sua etichetta
  const ratioInfo = isPolygonShape(node) ? RATIO_INFO[node.kind] : null;
  return (
    <>
      <Section title={node.kind === 'text' ? (node.origin === 'symbol' ? 'Simbolo' : node.origin === 'emoji' ? 'Emoji' : 'Testo') : 'Profilo 2D'}>
        {node.kind === 'text' ? (
          [
            <TextField key="text" label={node.origin ? 'Carattere' : 'Testo'} tooltip={TIPS.text} value={node.text} disabled={locked} onCommit={(v) => patch({ text: v } as Partial<Shape2DNode>)} />,
            <label key="font" className="properties__row" title={TIPS.font}>
              <span className="properties__label">Font</span>
              <select className="properties__text" value={fontInfo(node.font).id} disabled={locked} onChange={(e) => patch({ font: e.target.value } as Partial<Shape2DNode>)}>
                {fontGroups(node.font).map(([category, fonts]) => (
                  <optgroup key={category} label={category}>
                    {fonts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>,
            slider('Dimensione', node.size, 'size', TIPS.textSize, length),
            // Simboli ed emoji sono un solo carattere: la spaziatura non ha senso
            !node.origin && slider('Spaziatura', node.spacing ?? 1, 'spacing', TIPS.textSpacing, { unit: '×', min: 0.5, max: 3, step: 0.05, hardMin: 0.1, hardMax: 10 }),
          ]
        ) : isPolygonShape(node) ? (
          [
            slider('Larghezza', node.width, 'width', TIPS.width, length),
            slider('Profondità', node.depth, 'depth', TIPS.depth, length),
            ratioInfo && (
              <SliderField
                key="ratio"
                label={ratioInfo.label}
                unit="%"
                min={Math.round(ratioInfo.min * 100)}
                max={Math.round(ratioInfo.max * 100)}
                step={1}
                hardMin={Math.round(ratioInfo.min * 100)}
                hardMax={Math.round(ratioInfo.max * 100)}
                tooltip={ratioInfo.tip}
                disabled={locked}
                value={Math.round(node.ratio * 100)}
                onCommit={(v) => patch({ ratio: v / 100 } as Partial<Shape2DNode>)}
              />
            ),
          ]
        ) : node.kind === 'circle' ? (
          [
              slider('Raggio X', node.radius, 'radius', TIPS.radiusX, { ...length, max: reach / 2 }),
              <SliderField
                key="radiusY"
                label="Raggio Y"
                unit="mm"
                min={0.5}
                max={reach / 2}
                step={0.5}
                hardMin={0.1}
                hardMax={2000}
                tooltip={TIPS.radiusY}
                disabled={locked}
                value={node.radiusY ?? node.radius}
                onCommit={(v) => {
                  // Con il lucchetto chiuso cambia anche il raggio X; se i due raggi coincidono la forma torna tonda
                  const next = (ratioLocked ? lockedPatch(node, 'radiusY', v) : null) ?? { radiusY: v };
                  const radius = (next.radius as number | undefined) ?? node.radius;
                  patch({ ...next, radiusY: Math.abs((next.radiusY as number) - radius) < 1e-9 ? undefined : next.radiusY } as Partial<Shape2DNode>);
                }}
              />,
              <SegmentsControl key="segments" value={node.segments} disabled={locked} onChange={(n) => patch({ segments: n } as Partial<Shape2DNode>)} />,
              rounding,
            ]
        ) : (
          [slider('Larghezza', node.width, 'width', TIPS.width, length), slider('Profondità', node.depth, 'depth', TIPS.depth, length), rounding]
        )}
        <ProportionControls node={node} patch={patch as (p: object) => void} locked={locked} />
        {/* Contorno: offset 2D del profilo (positivo ingrandisce, negativo restringe), prima dell'estrusione */}
        {slider('Contorno', node.offset ?? 0, 'offset', TIPS.offset, { unit: 'mm', min: -20, max: 20, step: 0.5, hardMin: -2000, hardMax: 2000 })}
        {(node.offset ?? 0) !== 0 && (
          <div className="properties__row" title={TIPS.offsetJoin}>
            <span className="properties__label">Angoli</span>
            <div className="properties__segmented" role="group" aria-label="Angoli del contorno">
              {([['round', 'Arrotondati'], ['sharp', 'Vivi']] as const).map(([join, label]) => (
                <button
                  key={join}
                  type="button"
                  className={`properties__segment${(node.offsetJoin ?? 'round') === join ? ' properties__segment--active' : ''}`}
                  aria-pressed={(node.offsetJoin ?? 'round') === join}
                  disabled={locked}
                  onClick={() => patch({ offsetJoin: join } as Partial<Shape2DNode>)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>
      <Section title="Estrusione">
        <div className="properties__row" title={TIPS.extrusionKind}>
          <span className="properties__label">Tipo</span>
          <div className="properties__segmented" role="group" aria-label="Tipo di estrusione">
            {([['linear', 'Lineare'], ['rotate', 'Rotazionale']] as const).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className={`properties__segment${(rotational ? 'rotate' : 'linear') === kind ? ' properties__segment--active' : ''}`}
                aria-pressed={(rotational ? 'rotate' : 'linear') === kind}
                disabled={locked}
                onClick={() => setExtrusion(kind)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {rotational ? (
          <>
            {slider('Angolo', revolve.angle, 'revolveAngle', TIPS.revolveAngle, { unit: '°', min: 1, max: 360, step: 1, hardMin: 1, hardMax: 360 })}
            {slider('Raggio', revolve.radius, 'revolveRadius', TIPS.revolveRadius, { unit: 'mm', min: 0, max: reach, step: 0.5, hardMin: 0, hardMax: 2000 })}
            {slider('Segmenti', revolve.segments, 'revolveSegments', TIPS.revolveSegments, { unit: '', min: 8, max: 128, step: 1, hardMin: 3, hardMax: 256 })}
          </>
        ) : (
          <>
            {slider('Altezza', node.height, 'height', TIPS.extrudeHeight, length)}
            {slider('Torsione', node.twist, 'twist', TIPS.twist, { unit: '°', min: -360, max: 360, step: 5, hardMin: -3600, hardMax: 3600 })}
            <SliderField
              label="Scala cima"
              unit="%"
              min={0}
              max={300}
              step={5}
              hardMin={0}
              hardMax={500}
              tooltip={TIPS.scaleTop}
              disabled={locked}
              value={Math.round(node.scaleTop * 100)}
              onCommit={(v) => patch({ scaleTop: v / 100 })}
            />
          </>
        )}
      </Section>
    </>
  );
}
