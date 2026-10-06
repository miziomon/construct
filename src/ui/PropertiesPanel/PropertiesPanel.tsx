import type { ReactNode } from 'react';
import { isLocked, useSceneStore } from '../../scene/store';
import { MAX_SEGMENTS, MIN_SEGMENTS, MIN_SPHERE_SEGMENTS, SEGMENT_PRESETS } from '../../scene/defaults';
import { BED_SIZE } from '../../scene/types';
import type { GroupNode, MeshNode, PrimitiveNode, SceneNode, Shape2DNode, Vec3 } from '../../scene/types';
import { NumberField } from '../NumberField/NumberField';
import { SliderField } from '../SliderField/SliderField';
import { TIPS } from './tooltips';
import { maxPolyhedronRadius, polygonMaxRadius } from '../../scene/polyhedra';
import './PropertiesPanel.scss';

const AXES = ['X', 'Y', 'Z'] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="properties__section">
      <h3 className="properties__section-title">{title}</h3>
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
  // Bloccato lui o un gruppo che lo contiene
  const locked = useSceneStore((s) => s.selection.length === 1 && isLocked(s.scene, s.selection[0]));

  if (selection.length === 0) return <p className="properties__empty">Seleziona un oggetto per modificarne le proprietà.</p>;
  if (!node) return <p className="properties__empty">{selection.length} oggetti selezionati. Usa Ctrl+G per raggrupparli.</p>;

  const patch = (p: Partial<PrimitiveNode> | Partial<Shape2DNode> | Partial<MeshNode> | Partial<GroupNode>) => updateNode(node.id, p);
  const setVec = (key: 'position' | 'rotation', i: number, v: number) => {
    const next = [...node[key]] as Vec3;
    next[i] = v;
    patch({ [key]: next });
  };

  return (
    <div className="properties">
      <Section title="Oggetto">
        <label className="properties__row">
          <span className="properties__label">Nome</span>
          <input className="properties__text" value={node.name} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <label className="properties__row">
          <span className="properties__label">Colore</span>
          <input className="properties__color" type="color" value={node.color} onChange={(e) => patch({ color: e.target.value })} />
        </label>
        <label className="properties__row">
          <span className="properties__label">Blocco</span>
          <input type="checkbox" className="properties__checkbox" checked={!!node.locked} onChange={(e) => patch({ locked: e.target.checked })} />
          <span className="properties__hint">{locked && !node.locked ? 'Bloccato dal gruppo' : 'Impedisce spostamenti e modifiche'}</span>
        </label>
        <div className="properties__row">
          <span className="properties__label">Tipo</span>
          <div className="properties__segmented" role="group" aria-label="Solido o foro">
            {(['solid', 'hole'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`properties__segment${node.mode === mode ? ' properties__segment--active' : ''}${mode === 'hole' ? ' properties__segment--hole' : ''}`}
                aria-pressed={node.mode === mode}
                disabled={locked}
                onClick={() => patch({ mode })}
              >
                {mode === 'solid' ? 'Solido' : 'Foro'}
              </button>
            ))}
          </div>
        </div>
        {node.type === 'group' && (
          <div className="properties__row">
            <span className="properties__label">Operazione</span>
            <div className="properties__segmented" role="group" aria-label="Operazione del gruppo">
              {(['union', 'difference', 'intersection'] as const).map((op) => (
                <button key={op} type="button" className={`properties__segment${node.op === op ? ' properties__segment--active' : ''}`} aria-pressed={node.op === op} disabled={locked} onClick={() => patch({ op })}>
                  {op === 'union' ? 'Unione' : op === 'difference' ? 'Differenza' : 'Intersezione'}
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

      <Section title={inGroup ? 'Posizione (relativa al gruppo)' : 'Posizione'}>
        {AXES.map((a, i) => (
          <SliderField
            key={a}
            label={a}
            unit="mm"
            min={i === 2 ? -50 : -BED_SIZE / 2}
            max={i === 2 ? BED_SIZE : BED_SIZE / 2}
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

/** Slider delle misure in mm: da 0,5 mm fino al lato del piatto, con il campo numerico che accetta anche valori maggiori. */
const dimSlider = { min: 0.5, max: BED_SIZE, step: 0.5, hardMin: 0.1, hardMax: 2000, unit: 'mm' } as const;

function PrimitiveFields({ node, patch, locked }: { node: Extract<SceneNode, { type: 'primitive' }>; patch: (p: Partial<PrimitiveNode>) => void; locked: boolean }) {
  const dim = (label: string, value: number, key: string, tooltip: string, hardMin = 0.1, max: number = BED_SIZE / 2) => (
    <SliderField
      key={key}
      label={label}
      {...dimSlider}
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
      {...dimSlider}
      min={0.5}
      max={BED_SIZE / 2}
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
              {...dimSlider}
              tooltip={tips[i]}
              disabled={locked}
              value={node.size[i]}
              onCommit={(v) => {
                const size = [...node.size] as Vec3;
                size[i] = v;
                patch({ size } as Partial<PrimitiveNode>);
              }}
            />
          ))}
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
            dim('Altezza', node.height, 'height', TIPS.height, 0.1, BED_SIZE),
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
            dim('Altezza', node.height, 'height', TIPS.height, 0.1, BED_SIZE),
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
          {[dim('Dimensione', node.size, 'size', TIPS.polySize, 0.1, BED_SIZE), rounding(node.cornerRadius, maxPolyhedronRadius(node.size))]}
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

/** Campi di una forma 2D estrusa: profilo (cerchio o quadrato) più parametri di estrusione. */
function Shape2DFields({ node, patch, locked }: { node: Shape2DNode; patch: (p: Partial<Shape2DNode>) => void; locked: boolean }) {
  const slider = (label: string, value: number, key: string, tooltip: string, opts: { unit: string; min: number; max: number; step?: number; hardMin?: number; hardMax?: number }) => (
    <SliderField key={key} label={label} tooltip={tooltip} disabled={locked} value={value} onCommit={(v) => patch({ [key]: v } as Partial<Shape2DNode>)} {...opts} />
  );
  const length = { unit: 'mm', min: 0.5, max: BED_SIZE, step: 0.5, hardMin: 0.1, hardMax: 2000 };
  // Raggio massimo di arrotondamento: poco meno dell'inraggio del poligono, o di metà lato minore del quadrato
  const maxRounding = node.kind === 'circle' ? polygonMaxRadius(node.radius, node.segments) : Math.max(0, Math.min(node.width, node.depth) / 2 - 0.01);
  const rounding = slider('Raccordo', node.cornerRadius ?? 0, 'cornerRadius', TIPS.rounding, {
    unit: 'mm',
    min: 0,
    max: Math.max(0.5, maxRounding),
    step: 0.5,
    hardMin: 0,
    hardMax: Math.max(0, maxRounding),
  });
  return (
    <>
      <Section title="Profilo 2D">
        {node.kind === 'circle'
          ? [
              slider('Raggio X', node.radius, 'radius', TIPS.radiusX, { ...length, max: BED_SIZE / 2 }),
              <SliderField
                key="radiusY"
                label="Raggio Y"
                unit="mm"
                min={0.5}
                max={BED_SIZE / 2}
                step={0.5}
                hardMin={0.1}
                hardMax={2000}
                tooltip={TIPS.radiusY}
                disabled={locked}
                value={node.radiusY ?? node.radius}
                onCommit={(v) => patch({ radiusY: Math.abs(v - node.radius) < 1e-9 ? undefined : v } as Partial<Shape2DNode>)}
              />,
              <SegmentsControl key="segments" value={node.segments} disabled={locked} onChange={(n) => patch({ segments: n } as Partial<Shape2DNode>)} />,
              rounding,
            ]
          : [slider('Larghezza', node.width, 'width', TIPS.width, length), slider('Profondità', node.depth, 'depth', TIPS.depth, length), rounding]}
      </Section>
      <Section title="Estrusione">
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
      </Section>
    </>
  );
}
