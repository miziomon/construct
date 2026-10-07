import { Check, X } from 'lucide-react';
import { shellQuality } from '../../scene/shell';
import { useSceneStore } from '../../scene/store';
import { GROUP_ICONS } from '../groupIcons';
import { SliderField } from '../SliderField/SliderField';
import { useShellTool } from './shellToolStore';
// Stesso aspetto del pannello di Raccordo e Smusso
import '../EdgeTool/EdgeToolPanel.scss';

/**
 * Pannello del Guscio: spessore laterale e inferiore con anteprima dal vivo, OK e Annulla.
 * Flottante e non modale: la vista 3D resta utilizzabile.
 */
export function ShellPanel() {
  const { active, targetId, wall, bottom, error, groupId, cancel, commit, setOption } = useShellTool();
  // Il solido da svuotare: con la cavità scalata le pareti sono approssimate e il pannello lo dice
  const quality = useSceneStore((s) => {
    const node = targetId ? s.scene.nodes[targetId] : undefined;
    return node ? shellQuality(s.scene, node) : undefined;
  });

  if (!active) return null;
  const Icon = GROUP_ICONS.shell;

  return (
    <section className="edge-panel" aria-label="Guscio">
      <h2 className="edge-panel__title">
        <Icon size={16} aria-hidden="true" />
        Guscio
      </h2>

      <div className="edge-panel__section">
        <SliderField
          label="Laterale"
          unit="mm"
          min={0.1}
          max={20}
          step={0.1}
          hardMin={0.1}
          hardMax={256}
          tooltip="Spessore delle pareti laterali, in mm."
          history={false}
          value={wall}
          onCommit={(v) => setOption({ wall: v })}
        />
        <SliderField
          label="Inferiore"
          unit="mm"
          min={0}
          max={20}
          step={0.1}
          hardMin={0}
          hardMax={256}
          tooltip="Spessore del fondo, in mm."
          history={false}
          value={bottom}
          onCommit={(v) => setOption({ bottom: v })}
        />
        <p className="edge-panel__hint">La cima resta aperta. Lo spessore laterale vale per tutte le pareti.</p>
        {quality === 'prism' && <p className="edge-panel__hint">Solidi uniti con pareti verticali: le pareti sono uniformi anche ai giunti e non resta nessuna parete interna.</p>}
        {quality === 'parts' && (
          <p className="edge-panel__hint">Solidi uniti: ogni solido ha la sua cavità, quindi tra un solido e l'altro resta una parete interna.</p>
        )}
        {quality === 'scaled' && (
          <p className="edge-panel__hint">Questa forma non ha una cavità esatta: le pareti sono approssimate (l'oggetto rimpicciolito) e lo spessore è preciso solo nei punti estremi.</p>
        )}
        {error && (
          <p className="edge-panel__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="edge-panel__actions">
        <span className="edge-panel__spacer" />
        <button type="button" className="edge-panel__button" onClick={cancel}>
          <X size={14} />
          Annulla
        </button>
        <button type="button" className="edge-panel__button edge-panel__button--primary" disabled={!groupId} onClick={commit}>
          <Check size={14} />
          OK
        </button>
      </div>
    </section>
  );
}
