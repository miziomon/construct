import type { ReactNode } from 'react';
import { isLocked, useSceneStore } from '../../scene/store';
import { MAX_SEGMENTS, MIN_SEGMENTS } from '../../scene/defaults';
import type { GroupNode, PrimitiveNode, SceneNode, Vec3 } from '../../scene/types';
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
  // Bloccato lui o un gruppo che lo contiene
  const locked = useSceneStore((s) => s.selection.length === 1 && isLocked(s.scene, s.selection[0]));

  if (selection.length === 0) return <p className="properties__empty">Seleziona un oggetto per modificarne le proprietà.</p>;
  if (!node) return <p className="properties__empty">{selection.length} oggetti selezionati. Usa Ctrl+G per raggrupparli.</p>;

  const patch = (p: Partial<PrimitiveNode> | Partial<GroupNode>) => updateNode(node.id, p);
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
              {(['union', 'intersection'] as const).map((op) => (
                <button key={op} type="button" className={`properties__segment${node.op === op ? ' properties__segment--active' : ''}`} aria-pressed={node.op === op} disabled={locked} onClick={() => patch({ op })}>
                  {op === 'union' ? 'Unione' : 'Intersezione'}
                </button>
              ))}
            </div>
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
    </div>
  );
}

function PrimitiveFields({ node, patch, locked }: { node: Extract<SceneNode, { type: 'primitive' }>; patch: (p: Partial<PrimitiveNode>) => void; locked: boolean }) {
  // Dimensioni minime di 0,1 mm: sotto il kernel produrrebbe geometrie degeneri
  const dim = (label: string, value: number, key: string, min = 0.1) => (
    <NumberField key={key} label={label} unit="mm" min={min} max={2000} disabled={locked} value={value} onCommit={(v) => patch({ [key]: v } as Partial<PrimitiveNode>)} />
  );
  const segments = (value: number) => (
    <label className="properties__row" key="segments">
      <span className="properties__label">Segmenti</span>
      <input
        className="properties__range"
        type="range"
        min={MIN_SEGMENTS}
        max={MAX_SEGMENTS}
        step={4}
        disabled={locked}
        value={value}
        onChange={(e) => patch({ segments: Number(e.target.value) } as Partial<PrimitiveNode>)}
      />
      <output className="properties__output">{value}</output>
    </label>
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
      return <Section title="Dimensioni">{[dim('R', node.radius, 'radius'), segments(node.segments)]}</Section>;
    case 'torus':
      return <Section title="Dimensioni">{[dim('R', node.majorRadius, 'majorRadius'), dim('r', node.minorRadius, 'minorRadius'), segments(node.segments)]}</Section>;
  }
}
