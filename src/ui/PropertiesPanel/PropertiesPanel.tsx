import type { ReactNode } from 'react';
import { isLocked, useSceneStore } from '../../scene/store';
import { MAX_SEGMENTS, MIN_SEGMENTS, MIN_SPHERE_SEGMENTS, SEGMENT_PRESETS } from '../../scene/defaults';
import type { GroupNode, PrimitiveNode, SceneNode, Shape2DNode, Vec3 } from '../../scene/types';
import { NumberField } from '../NumberField/NumberField';
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

  const patch = (p: Partial<PrimitiveNode> | Partial<Shape2DNode> | Partial<GroupNode>) => updateNode(node.id, p);
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
          <NumberField key={a} label={a} unit="mm" disabled={locked} value={node.position[i]} onCommit={(v) => setVec('position', i, v)} />
        ))}
      </Section>

      <Section title="Rotazione">
        {AXES.map((a, i) => (
          <NumberField key={a} label={a} unit="°" step={15} disabled={locked} value={node.rotation[i]} onCommit={(v) => setVec('rotation', i, v)} />
        ))}
      </Section>

      {node.type === 'primitive' && <PrimitiveFields node={node} patch={patch} locked={locked} />}
      {node.type === 'shape2d' && <Shape2DFields node={node} patch={patch} locked={locked} />}
    </div>
  );
}

function PrimitiveFields({ node, patch, locked }: { node: Extract<SceneNode, { type: 'primitive' }>; patch: (p: Partial<PrimitiveNode>) => void; locked: boolean }) {
  // Dimensioni minime di 0,1 mm: sotto il kernel produrrebbe geometrie degeneri
  const dim = (label: string, value: number, key: string, min = 0.1) => (
    <NumberField key={key} label={label} unit="mm" min={min} max={2000} disabled={locked} value={value} onCommit={(v) => patch({ [key]: v } as Partial<PrimitiveNode>)} />
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


  switch (node.kind) {
    case 'box':
      return (
        <Section title="Dimensioni">
          {AXES.map((a, i) => (
            <NumberField
              key={a}
              label={a}
              unit="mm"
              min={0.1}
              max={2000}
              disabled={locked}
              value={node.size[i]}
              onCommit={(v) => {
                const size = [...node.size] as Vec3;
                size[i] = v;
                patch({ size } as Partial<PrimitiveNode>);
              }}
            />
          ))}
        </Section>
      );
    case 'cylinder':
      return <Section title="Dimensioni">{[dim('R', node.radius, 'radius'), dim('H', node.height, 'height'), segments(node.segments)]}</Section>;
    case 'cone':
      return (
        <Section title="Dimensioni">
          {[dim('R↓', node.radiusBottom, 'radiusBottom', 0), dim('R↑', node.radiusTop, 'radiusTop', 0), dim('H', node.height, 'height'), segments(node.segments)]}
        </Section>
      );
    case 'sphere':
      return <Section title="Dimensioni">{[dim('R', node.radius, 'radius'), segments(node.segments, true)]}</Section>;
    case 'torus':
      return <Section title="Dimensioni">{[dim('R', node.majorRadius, 'majorRadius'), dim('r', node.minorRadius, 'minorRadius'), segments(node.segments)]}</Section>;
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
        <div className="properties__row">
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
      <label className="properties__row">
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
  const field = (label: string, value: number, key: string, opts: { unit: string; min: number; max: number; step?: number }) => (
    <NumberField key={key} label={label} unit={opts.unit} min={opts.min} max={opts.max} step={opts.step} disabled={locked} value={value} onCommit={(v) => patch({ [key]: v } as Partial<Shape2DNode>)} />
  );
  return (
    <>
      <Section title="Profilo 2D">
        {node.kind === 'circle' ? (
          [
            field('R', node.radius, 'radius', { unit: 'mm', min: 0.1, max: 2000 }),
            <SegmentsControl key="segments" value={node.segments} disabled={locked} onChange={(n) => patch({ segments: n } as Partial<Shape2DNode>)} />,
          ]
        ) : (
          [
            field('X', node.width, 'width', { unit: 'mm', min: 0.1, max: 2000 }),
            field('Y', node.depth, 'depth', { unit: 'mm', min: 0.1, max: 2000 }),
            field('Rc', node.cornerRadius, 'cornerRadius', { unit: 'mm', min: 0, max: 1000 }),
          ]
        )}
      </Section>
      <Section title="Estrusione">
        {field('H', node.height, 'height', { unit: 'mm', min: 0.1, max: 2000 })}
        {field('↻', node.twist, 'twist', { unit: '°', min: -3600, max: 3600, step: 15 })}
        <NumberField
          label="⇱"
          unit="%"
          min={0}
          max={500}
          step={10}
          disabled={locked}
          value={Math.round(node.scaleTop * 100)}
          onCommit={(v) => patch({ scaleTop: v / 100 })}
        />
      </Section>
    </>
  );
}
